import Phaser from 'phaser';
import { createInitialBoardWithBonuses, moveHeroOneTile, useBackpackSpell, xpForNextLevel } from '../game/engine';
import { syncMetaProgressToCloud } from '../game/cloud';
import { dailySeed } from '../game/random';
import { clearActiveRun, loadMetaProgress, recordLeaderboardEntry, recordRunCompletion, saveActiveRun } from '../game/persistence';
import { SoundEngine } from '../game/audio';
import { ALPHA, ANIMATION, COLORS, INK, SPACING, TYPOGRAPHY } from '../game/theme';
import { cascadeIn, createButton } from './ui';
import type { Direction, LeaderboardEntry, PersistentProgress, RunConfig, RunSnapshot, Tile, TileKind } from '../game/types';

const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 1365;
const CENTER_X = CANVAS_WIDTH / 2;

const BOARD_SIZE = 5;
const BOARD_LEFT = 84;
const BOARD_TOP = 420;
const CELL_SIZE = 116;
const CELL_GAP = 6;

// Tile interior geometry, all measured from the centre of the cell because every tile is a Container
// positioned at its cell centre — that is what lets a single tile be tweened independently.
const TILE_RADIUS = 12;
const TILE_ICON_RADIUS = 14;
const TILE_ICON_OFFSET_Y = -4;
const TILE_LABEL_OFFSET_Y = 22;
const TILE_HP_OFFSET_Y = -34;
const TILE_BORDER = 3;
const TILE_BORDER_HERO = 6;
const HERO_RING_WIDTH = 8;
const HERO_RING_INSET = 4;
/** How far a dying tile's burst ring swells past its own cell, and how thick that ring is. */
const TILE_DEATH_BURST_SCALE = 1.45;
const TILE_DEATH_BURST_WIDTH = 6;

/**
 * Render order. The hero sits above the other tiles so its ring is never clipped, and dying tiles
 * sit above the hero: killing a tile moves the hero onto that same cell in the same turn (see
 * `moveHeroOneTile`), so a death effect drawn underneath would never be seen. It only gets away
 * with being on top because it is a hollow expanding ring, not a filled tile — see `playTileDeath`.
 */
const DEPTH = {
  board: 0,
  telegraph: 1,
  tile: 2,
  hero: 3,
  dyingTile: 4,
  hud: 5,
  endOverlay: 10,
  pauseOverlay: 20,
  confirmOverlay: 30
} as const;

// Payload handed over by MenuScene via scene.start('GameScene', data). Phaser routes this to
// init(data)/create(data) and Scene.settings.data — it does NOT populate the scene's DataManager,
// so read it from the create() argument, never from this.data.
interface GameSceneData {
  runConfig?: RunConfig;
  resumeRun?: RunSnapshot;
  metaProgress?: PersistentProgress;
}

/**
 * Everything needed to draw and animate one tile. The Container is the tween target; `kind`, `hp`
 * and the grid coordinates are the last-rendered values, compared against board state each turn to
 * decide whether this tile needs a repaint, a move, or nothing at all.
 */
interface TileView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  kind: TileKind;
  hp: number;
  gridX: number;
  gridY: number;
  moveTween?: Phaser.Tweens.Tween;
}

// HUD layout. Each line owns a fixed slot rather than living in one multi-line Text block: the
// boss telegraph and slowed notice are conditional, and a single block padded them out with blank
// lines, which pushed the action message down on top of the progress bar.
const HUD_TITLE_Y = 72;
const HUD_SUBTITLE_Y = 118;
const HUD_STATS_Y = 152;
const HUD_PHASE_Y = 182;
const HUD_BOSS_Y = 240;
const HUD_SLOWED_Y = 266;
const HUD_ACTION_Y = 294;
const HUD_HINT_Y = 336;

const PROGRESS_BAR_LEFT = 174;
const PROGRESS_BAR_TOP = 206;
const PROGRESS_BAR_WIDTH = 420;
const PROGRESS_BAR_HEIGHT = 16;
const PROGRESS_BAR_BORDER = 4;

// End-of-run panel layout
const END_PANEL_TITLE_Y = 400;
const END_PANEL_DESCRIPTION_Y = 472;
const END_PANEL_BREAKDOWN_Y = 536;
const END_PANEL_BREAKDOWN_LEFT = 154;
const END_PANEL_BREAKDOWN_RIGHT = 614;
const END_PANEL_ROW_HEIGHT = 26;

const SCORE_PER_TURN = 10;
const SCORE_PER_GOLD = 20;
const SCORE_PER_LEVEL = 60;
const SCORE_PER_HP = 15;
const VICTORY_BONUS = 800;

export class GameScene extends Phaser.Scene {
  private board = createInitialBoardWithBonuses(dailySeed());
  private runConfig: RunConfig = {
    mode: 'daily',
    seed: dailySeed(),
    progressTarget: 100,
    progressPerTurn: 8,
    spawnsPerTurn: 1,
    bossHp: 12,
    title: 'Daily Run',
    subtitle: 'Generated from the current date.'
  };
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private telegraphGraphics!: Phaser.GameObjects.Graphics;
  private hudGraphics!: Phaser.GameObjects.Graphics;
  private statsText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private bossTelegraphText!: Phaser.GameObjects.Text;
  private slowedText!: Phaser.GameObjects.Text;
  private actionText!: Phaser.GameObjects.Text;
  private spellButton!: Phaser.GameObjects.Text;
  private muteButton!: Phaser.GameObjects.Text;
  /** One Container per live tile, keyed by tile id. */
  private tileViews = new Map<string, TileView>();
  private telegraphTween?: Phaser.Tweens.Tween;
  private progressTween?: Phaser.Tweens.Tween;
  /** Progress the bar is currently showing, which lags the board while the tween catches up. */
  private displayedProgress = 0;
  /** Hero level the HUD last showed, so a level-up can be detected and celebrated exactly once. */
  private displayedHeroLevel = 1;
  private endOverlayShown = false;
  private runFinalized = false;
  private paused = false;
  private pauseOverlayObjects: Phaser.GameObjects.GameObject[] = [];
  private quitConfirmObjects: Phaser.GameObjects.GameObject[] = [];
  private swipeStart: { x: number; y: number } | null = null;
  private lastActionMessage = '';
  private metaProgress: PersistentProgress = loadMetaProgress();
  private lastRunRank = 0;
  private soundEngine!: SoundEngine;

  constructor() {
    super('GameScene');
  }

  create(data: GameSceneData = {}): void {
    // Phaser reuses the same Scene instance across scene.start(), so class field initialisers only
    // ever run once. Every piece of per-run state has to be reset by hand or the second run
    // inherits the first one's flags (and a map full of destroyed Containers).
    this.resetSceneState();

    const { resumeRun, runConfig: config, metaProgress } = data;

    if (metaProgress) {
      this.metaProgress = metaProgress;
    }

    if (resumeRun) {
      this.applyRunSnapshot(resumeRun);
    } else if (config) {
      this.runConfig = config;
      this.board = createInitialBoardWithBonuses(
        config.seed,
        config.mode,
        this.metaProgress.permanentMaxHpBonus,
        this.metaProgress.permanentAttackBonus
      );
      this.board.maxProgress = config.progressTarget;
      this.board.seed = config.seed;
      this.board.progressPerTurn = config.progressPerTurn;
      this.board.spawnsPerTurn = config.spawnsPerTurn;
      this.board.mode = config.mode;
      this.board.bossMaxHp = config.bossHp;
      this.runFinalized = false;
      this.lastActionMessage = '';
    }

    this.soundEngine = new SoundEngine();

    this.cameras.main.setBackgroundColor(COLORS.background.primary);
    this.boardGraphics = this.add.graphics().setDepth(DEPTH.board);
    this.telegraphGraphics = this.add.graphics().setDepth(DEPTH.telegraph);
    this.hudGraphics = this.add.graphics().setDepth(DEPTH.hud);

    this.add.text(CENTER_X, HUD_TITLE_Y, this.runConfig.title, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.huge,
      color: INK.title,
      stroke: INK.onTile.outline,
      strokeThickness: TYPOGRAPHY.stroke.bold
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.add.text(CENTER_X, HUD_SUBTITLE_Y, this.runConfig.subtitle, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.subtle,
      align: 'center',
      wordWrap: { width: 520 }
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.statsText = this.add.text(CENTER_X, HUD_STATS_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.body
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.phaseText = this.add.text(CENTER_X, HUD_PHASE_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.body
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.bossTelegraphText = this.add.text(CENTER_X, HUD_BOSS_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.danger
    }).setOrigin(0.5).setDepth(DEPTH.hud).setVisible(false);

    this.slowedText = this.add.text(CENTER_X, HUD_SLOWED_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.sm,
      color: INK.notice
    }).setOrigin(0.5).setDepth(DEPTH.hud).setVisible(false);

    this.actionText = this.add.text(CENTER_X, HUD_ACTION_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.bodyBright,
      align: 'center',
      wordWrap: { width: 620 }
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.add.text(CENTER_X, HUD_HINT_Y, 'Swipe or use arrow keys to move 1 tile', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.sm,
      color: INK.faint
    }).setOrigin(0.5).setDepth(DEPTH.hud);

    this.createSpellButton();
    this.createMuteButton();
    this.setupInput();

    // The empty grid never changes, so it is painted once rather than every turn
    this.drawBoardBackground();

    // Seed the animated values from the board being loaded, so resuming a run part-way through
    // doesn't replay its progress bar from zero or fire a spurious level-up flash
    this.displayedProgress = this.computeProgressPercent();
    this.displayedHeroLevel = this.board.heroLevel;

    this.syncTiles(true);
    this.refreshUi();
    this.persistRun();
  }

  private resetSceneState(): void {
    this.tileViews = new Map();
    this.telegraphTween = undefined;
    this.progressTween = undefined;
    this.displayedProgress = 0;
    this.displayedHeroLevel = 1;
    this.endOverlayShown = false;
    this.runFinalized = false;
    this.paused = false;
    this.pauseOverlayObjects = [];
    this.quitConfirmObjects = [];
    this.swipeStart = null;
    this.lastRunRank = 0;
  }

  // ----- Input -----

  private setupInput(): void {
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        // Escape backs out of the quit prompt first, so it can never be the key that quits
        if (this.quitConfirmObjects.length > 0) {
          this.hideQuitConfirm();
          return;
        }

        this.togglePause();
        return;
      }

      if (this.paused || this.board.status !== 'playing') {
        return;
      }

      const mapping: Record<string, Direction | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        KeyW: 'up',
        KeyS: 'down',
        KeyA: 'left',
        KeyD: 'right'
      };

      const direction = mapping[event.code];

      if (direction) {
        this.takeTurn(direction);
      }
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.swipeStart = { x: pointer.x, y: pointer.y };
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.swipeStart) {
        return;
      }

      const deltaX = pointer.x - this.swipeStart.x;
      const deltaY = pointer.y - this.swipeStart.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      // Minimum total movement and minimum dominant-axis movement to avoid accidental swipes
      const minTotal = 20;
      const minDominant = 50;

      this.swipeStart = null;

      if (absX < minTotal && absY < minTotal) {
        return;
      }

      if (this.paused) {
        return;
      }

      if (absX > absY && absX >= minDominant) {
        this.takeTurn(deltaX > 0 ? 'right' : 'left');
      } else if (absY > absX && absY >= minDominant) {
        this.takeTurn(deltaY > 0 ? 'down' : 'up');
      }
    });
  }

  private takeTurn(direction: Direction): void {
    if (this.paused || this.board.status !== 'playing') {
      return;
    }

    // No message reliably reports incoming damage — a counter-attack, the weave and a boss strike
    // all word it differently — so the HP delta is measured directly and handed to the sound engine
    const hpBefore = this.findHero()?.hp ?? 0;
    const result = moveHeroOneTile(this.board, direction);

    if (!result.acted && result.messages.length === 0) {
      return;
    }

    const hpAfter = this.findHero()?.hp ?? hpBefore;

    this.lastActionMessage = result.messages[0] ?? this.lastActionMessage;
    this.soundEngine.playFromTurnResult(result, this.board.status, hpAfter < hpBefore);
    this.persistRun();
    this.syncTiles();
    this.refreshUi(result.messages);
  }

  // ----- Pause -----

  private togglePause(): void {
    if (this.board.status !== 'playing') {
      return;
    }

    this.soundEngine.playPause();

    if (this.paused) {
      this.hidePauseOverlay();
    } else {
      this.showPauseOverlay();
    }
  }

  private showPauseOverlay(): void {
    this.paused = true;

    const overlay = this.add.rectangle(CENTER_X, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT, COLORS.background.overlay, ALPHA.pauseOverlay)
      .setDepth(DEPTH.pauseOverlay);
    const panel = this.add.rectangle(CENTER_X, 683, 480, 320, COLORS.background.panel, 1)
      .setDepth(DEPTH.pauseOverlay + 1);

    const titleText = this.add.text(CENTER_X, 590, 'Paused', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.hero,
      color: INK.onPanel.title
    }).setOrigin(0.5).setDepth(DEPTH.pauseOverlay + 2);

    const resumeBtn = createButton(this, CENTER_X, 680, 'Resume', {
      variant: 'success',
      fontSize: TYPOGRAPHY.size.xxl,
      padding: SPACING.button.lg,
      depth: DEPTH.pauseOverlay + 2
    });

    const quitBtn = createButton(this, CENTER_X, 770, 'Quit to Menu', {
      variant: 'danger',
      fontSize: TYPOGRAPHY.size.lg,
      depth: DEPTH.pauseOverlay + 2
    });

    resumeBtn.on('pointerdown', () => {
      this.hidePauseOverlay();
    });

    quitBtn.on('pointerdown', () => {
      this.showQuitConfirm();
    });

    this.pauseOverlayObjects = [overlay, panel, titleText, resumeBtn, quitBtn];
    cascadeIn(this, [overlay, panel, titleText, resumeBtn, quitBtn], ANIMATION.stagger / 2);
  }

  private hidePauseOverlay(): void {
    this.hideQuitConfirm();

    for (const object of this.pauseOverlayObjects) {
      object.destroy();
    }

    this.pauseOverlayObjects = [];
    this.paused = false;
  }

  /**
   * Confirmation step in front of "Quit to Menu". The run is saved either way, but a mis-tap on a
   * touchscreen used to drop the player straight out of a boss fight with no warning.
   */
  private showQuitConfirm(): void {
    if (this.quitConfirmObjects.length > 0) {
      return;
    }

    const scrim = this.add.rectangle(CENTER_X, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT, COLORS.background.overlay, ALPHA.pauseOverlay)
      .setDepth(DEPTH.confirmOverlay);
    // Deliberately larger than the pause panel it covers, so that panel's edges don't peek out
    const panel = this.add.rectangle(CENTER_X, 683, 560, 360, COLORS.background.panel, 1)
      .setDepth(DEPTH.confirmOverlay + 1);

    const titleText = this.add.text(CENTER_X, 580, 'Save and quit?', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.display,
      color: INK.onPanel.title
    }).setOrigin(0.5).setDepth(DEPTH.confirmOverlay + 2);

    const bodyText = this.add.text(CENTER_X, 650, 'Your progress is saved. You can resume this run from the menu.', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.onPanel.body,
      align: 'center',
      wordWrap: { width: 440 }
    }).setOrigin(0.5).setDepth(DEPTH.confirmOverlay + 2);

    const confirmBtn = createButton(this, CENTER_X - 120, 750, 'Save & Quit', {
      variant: 'danger',
      fontSize: TYPOGRAPHY.size.md,
      depth: DEPTH.confirmOverlay + 2
    });

    const cancelBtn = createButton(this, CENTER_X + 120, 750, 'Cancel', {
      variant: 'neutral',
      fontSize: TYPOGRAPHY.size.md,
      depth: DEPTH.confirmOverlay + 2
    });

    confirmBtn.on('pointerdown', () => {
      // Save before leaving so the run is resumable from the menu
      this.persistRun();
      this.scene.start('MenuScene');
    });

    cancelBtn.on('pointerdown', () => {
      this.hideQuitConfirm();
    });

    this.quitConfirmObjects = [scrim, panel, titleText, bodyText, confirmBtn, cancelBtn];
    cascadeIn(this, [scrim, panel, titleText, bodyText, confirmBtn, cancelBtn], ANIMATION.stagger / 3);
  }

  private hideQuitConfirm(): void {
    for (const object of this.quitConfirmObjects) {
      object.destroy();
    }

    this.quitConfirmObjects = [];
  }

  // ----- Spell button -----

  private createSpellButton(): void {
    this.spellButton = createButton(this, 620, 1260, 'Backpack\nFireball x1', {
      variant: 'spell',
      fontSize: TYPOGRAPHY.size.md,
      padding: SPACING.button.lg,
      depth: DEPTH.hud
    });

    this.spellButton.on('pointerdown', () => {
      if (this.paused || this.board.status !== 'playing') {
        return;
      }

      const hpBefore = this.findHero()?.hp ?? 0;
      const result = useBackpackSpell(this.board);

      if (result.used) {
        this.lastActionMessage = result.message;
        this.soundEngine.playSpell();
        this.persistRun();
        this.syncTiles();
        this.refreshUi([result.message]);

        if ((this.findHero()?.hp ?? hpBefore) < hpBefore) {
          this.soundEngine.playDamageTaken();
        }
      }
    });
  }

  // ----- Mute button -----

  private createMuteButton(): void {
    // Text rather than an emoji glyph: 🔊/🔇 render inconsistently across platforms
    const label = () => this.soundEngine.isMuted() ? 'Sound Off' : 'Sound On';

    this.muteButton = this.add.text(700, 50, label(), {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.sm,
      color: INK.muted
    }).setOrigin(1, 0.5).setDepth(DEPTH.hud).setInteractive({ useHandCursor: true });

    // No background to lighten, so hover brightens the label itself instead
    this.muteButton.on('pointerover', () => this.muteButton.setColor(INK.title));
    this.muteButton.on('pointerout', () => this.muteButton.setColor(INK.muted));

    this.muteButton.on('pointerdown', () => {
      if (this.soundEngine.isMuted()) {
        this.soundEngine.unmute();
      } else {
        this.soundEngine.mute();
      }

      this.muteButton.setText(label());
      this.tweens.add({
        targets: this.muteButton,
        scale: ANIMATION.pressScale,
        duration: ANIMATION.press,
        yoyo: true,
        ease: ANIMATION.fadeEase
      });
    });
  }

  // ----- UI -----

  private refreshUi(messages: string[] = []): void {
    const progress = this.computeProgressPercent();
    const hero = this.findHero();
    // A dead hero has negative hp; never show it as a negative number
    const heroHp = Math.max(0, hero?.hp ?? 0);
    const xpNeeded = xpForNextLevel(this.board.heroLevel);

    this.statsText.setText(
      `Turn ${this.board.turn}   Lvl ${this.board.heroLevel}   HP ${heroHp}/${this.board.heroMaxHp}   XP ${this.board.xp}/${xpNeeded}   Gold ${this.board.gold}`
    );

    this.phaseText.setText(this.board.phase === 'boss'
      ? `Boss HP ${Math.max(0, this.board.bossHp)}/${this.board.bossMaxHp}`
      : `Progress ${progress}%`);

    const inBossPhase = this.board.phase === 'boss';
    this.bossTelegraphText.setVisible(inBossPhase);

    if (inBossPhase) {
      this.bossTelegraphText.setText(`Stone-Weaver ${this.board.bossAttackCountdown <= 1
        ? 'STRIKES NEXT!'
        : `charges in ${this.board.bossAttackCountdown} turns`}`);
    }

    this.slowedText.setVisible(this.board.heroIsSlowed);

    if (this.board.heroIsSlowed) {
      this.slowedText.setText('Snared — the web cost you a turn.');
    }

    this.actionText.setText(messages[0] ?? this.lastActionMessage);

    this.spellButton.setText(`Backpack\nFireball x${this.board.spellCharges}/${this.board.spellMaxCharges}`);
    this.spellButton.setAlpha(this.board.spellCharges > 0 ? 1 : ALPHA.disabled);

    if (this.board.heroLevel > this.displayedHeroLevel) {
      this.displayedHeroLevel = this.board.heroLevel;
      this.flashHeroLevelUp();
    }

    this.updateTelegraph();
    this.animateProgressTo(progress);

    if (this.board.status === 'victory') {
      this.showEndState('Victory!', this.buildVictoryMessage());
    } else if (this.board.status === 'defeat') {
      this.showEndState('Defeat', 'Your hero fell in the maze.');
    }
  }

  /** During the boss phase the bar retargets to show the boss's remaining HP instead of progress. */
  private computeProgressPercent(): number {
    return this.board.phase === 'boss'
      ? Math.floor((Math.max(0, this.board.bossHp) / Math.max(1, this.board.bossMaxHp)) * 100)
      : Math.floor((this.board.progress / this.board.maxProgress) * 100);
  }

  private buildVictoryMessage(): string {
    if (this.board.mode === 'quest') {
      return 'You slew the Stone-Weaver and cleared the dungeon!';
    }
    if (this.board.mode === 'daily') {
      return 'You completed today\'s run. Come back tomorrow!';
    }
    return `Survived ${this.board.turn} turns in the endless arena.`;
  }

  // ----- Progress bar -----

  private animateProgressTo(target: number): void {
    this.progressTween?.remove();

    if (this.displayedProgress === target) {
      this.drawProgressBar(target);
      return;
    }

    this.progressTween = this.tweens.addCounter({
      from: this.displayedProgress,
      to: target,
      duration: ANIMATION.progress,
      ease: ANIMATION.fadeEase,
      onUpdate: (tween) => {
        this.displayedProgress = tween.getValue() ?? target;
        this.drawProgressBar(this.displayedProgress);
      },
      onComplete: () => {
        this.displayedProgress = target;
        this.drawProgressBar(target);
        this.progressTween = undefined;
      }
    });
  }

  private drawProgressBar(progress: number): void {
    const radius = PROGRESS_BAR_HEIGHT / 2;
    const filledWidth = (PROGRESS_BAR_WIDTH * Phaser.Math.Clamp(progress, 0, 100)) / 100;
    const inBossPhase = this.board.phase === 'boss';

    this.hudGraphics.clear();
    this.hudGraphics.lineStyle(PROGRESS_BAR_BORDER, COLORS.progress.border, 1);
    this.hudGraphics.strokeRoundedRect(PROGRESS_BAR_LEFT, PROGRESS_BAR_TOP, PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT, radius);

    if (filledWidth <= 0) {
      return;
    }

    this.hudGraphics.fillStyle(inBossPhase ? COLORS.progress.fillBoss : COLORS.progress.fillRun, 1);
    this.hudGraphics.fillRoundedRect(PROGRESS_BAR_LEFT, PROGRESS_BAR_TOP, filledWidth, PROGRESS_BAR_HEIGHT, radius);
    this.hudGraphics.fillStyle(inBossPhase ? COLORS.progress.capBoss : COLORS.progress.capRun, 1);
    this.hudGraphics.fillCircle(PROGRESS_BAR_LEFT + filledWidth, PROGRESS_BAR_TOP + radius, radius + 2);
  }

  // ----- Boss telegraph -----

  /**
   * Redraws the line the boss is about to sweep. Once the strike is one turn away the whole Graphics
   * object pulses, which is why the telegraph owns its own layer — alpha is tweened on the object,
   * not baked into the stroke.
   */
  private updateTelegraph(): void {
    const active = this.board.phase === 'boss' && this.board.status === 'playing';

    this.telegraphGraphics.clear();
    this.telegraphGraphics.setVisible(active);

    if (!active) {
      this.stopTelegraphPulse();
      return;
    }

    const imminent = this.board.bossAttackCountdown <= 1;

    this.telegraphGraphics.lineStyle(HERO_RING_WIDTH, imminent ? COLORS.telegraph.imminent : COLORS.telegraph.warning, 1);

    for (let index = 0; index < BOARD_SIZE; index += 1) {
      const x = this.board.bossAttackAxis === 'column' ? this.board.bossAttackLine : index;
      const y = this.board.bossAttackAxis === 'row' ? this.board.bossAttackLine : index;
      const cell = this.cellTopLeft(x, y);

      this.telegraphGraphics.strokeRoundedRect(cell.x - 2, cell.y - 2, CELL_SIZE + 4, CELL_SIZE + 4, TILE_RADIUS);
    }

    if (!imminent) {
      this.stopTelegraphPulse();
      return;
    }

    if (!this.telegraphTween) {
      this.telegraphTween = this.tweens.add({
        targets: this.telegraphGraphics,
        alpha: { from: ALPHA.telegraphPulseMin, to: 1 },
        duration: ANIMATION.telegraphPulse,
        yoyo: true,
        repeat: -1,
        ease: ANIMATION.pulseEase
      });
    }
  }

  private stopTelegraphPulse(): void {
    this.telegraphTween?.remove();
    this.telegraphTween = undefined;
    this.telegraphGraphics.setAlpha(ALPHA.telegraph);
  }

  // ----- Board rendering -----

  private drawBoardBackground(): void {
    this.boardGraphics.clear();
    this.boardGraphics.fillStyle(COLORS.background.boardCell, ALPHA.boardCell);

    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cell = this.cellTopLeft(x, y);
        this.boardGraphics.fillRoundedRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE, TILE_RADIUS);
      }
    }
  }

  /**
   * Brings the tile Containers in line with board state: new tiles pop in, changed tiles repaint,
   * a moved tile slides, and tiles that are gone from the board play their death animation. This
   * replaced a full Graphics repaint per turn — individual tiles can only be tweened if each one is
   * a persistent object rather than a shape redrawn from scratch every frame.
   */
  private syncTiles(initial = false): void {
    const live = new Set<string>();

    this.board.tiles.forEach((tile, index) => {
      live.add(tile.id);

      const view = this.tileViews.get(tile.id);

      if (view) {
        this.updateTileView(view, tile);
        return;
      }

      // The opening board cascades in cell by cell; mid-run spawns pop immediately
      this.spawnTileView(tile, initial ? index * ANIMATION.boardCascade : 0);
    });

    for (const [id, view] of this.tileViews) {
      if (!live.has(id)) {
        this.tileViews.delete(id);
        this.playTileDeath(view);
      }
    }
  }

  private spawnTileView(tile: Tile, delay: number): void {
    const centre = this.cellCentre(tile.x, tile.y);

    const body = this.add.graphics();
    const label = this.add.text(0, TILE_LABEL_OFFSET_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.onTile.label
    }).setOrigin(0.5);
    const hpText = this.add.text(0, TILE_HP_OFFSET_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.onTile.hp,
      // Outlined, because the HP number sits over each tile's own fill colour
      stroke: INK.onTile.outline,
      strokeThickness: TYPOGRAPHY.stroke.bold
    }).setOrigin(0.5);

    const container = this.add.container(centre.x, centre.y, [body, label, hpText])
      .setDepth(tile.kind === 'hero' ? DEPTH.hero : DEPTH.tile);

    const view: TileView = {
      container,
      body,
      label,
      hpText,
      kind: tile.kind,
      hp: tile.hp,
      gridX: tile.x,
      gridY: tile.y
    };

    this.paintTileView(view);
    this.tileViews.set(tile.id, view);

    container.setScale(0.5).setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: ANIMATION.normal,
      delay,
      ease: ANIMATION.spawnEase
    });
  }

  private updateTileView(view: TileView, tile: Tile): void {
    if (view.kind !== tile.kind || view.hp !== tile.hp) {
      view.kind = tile.kind;
      view.hp = tile.hp;
      this.paintTileView(view);
    }

    if (view.gridX === tile.x && view.gridY === tile.y) {
      return;
    }

    view.gridX = tile.x;
    view.gridY = tile.y;

    const centre = this.cellCentre(tile.x, tile.y);

    // Retarget rather than block input: a second swipe during the 80ms slide replaces this tween
    // instead of being dropped, so holding a direction key never feels like it missed a step.
    view.moveTween?.remove();
    view.moveTween = this.tweens.add({
      targets: view.container,
      x: centre.x,
      y: centre.y,
      duration: ANIMATION.fast,
      ease: ANIMATION.moveEase,
      onComplete: () => {
        view.moveTween = undefined;
      }
    });
  }

  /** Everything inside a tile is drawn around (0, 0) — the Container carries the cell position. */
  private paintTileView(view: TileView): void {
    const palette = COLORS.tile[view.kind];
    const half = CELL_SIZE / 2;

    view.body.clear();
    view.body.fillStyle(palette.fill, 1);
    view.body.fillRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, TILE_RADIUS);
    view.body.lineStyle(view.kind === 'hero' ? TILE_BORDER_HERO : TILE_BORDER, palette.stroke, 1);
    view.body.strokeRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, TILE_RADIUS);

    if (view.kind !== 'web') {
      view.body.fillStyle(palette.icon, 1);
      view.body.fillCircle(0, TILE_ICON_OFFSET_Y, TILE_ICON_RADIUS);
    }

    if (view.kind === 'hero') {
      view.body.lineStyle(HERO_RING_WIDTH, COLORS.heroRing, 1);
      view.body.strokeRoundedRect(
        -half - HERO_RING_INSET,
        -half - HERO_RING_INSET,
        CELL_SIZE + HERO_RING_INSET * 2,
        CELL_SIZE + HERO_RING_INSET * 2,
        TILE_RADIUS + 2
      );
    }

    view.label.setText(view.kind === 'hero' ? 'You' : view.kind);

    const showHp = view.hp > 1 || view.kind === 'hero';
    view.hpText.setText(showHp ? String(view.hp) : '').setVisible(showHp);
  }

  /**
   * Bursts the tile into an expanding white ring. The Container is detached from `tileViews` first.
   *
   * A filled flash was the obvious thing here and it was invisible: the hero advances onto every
   * tile it kills, so the effect spent its whole life hidden under the arriving hero. Swapping the
   * fill for a ring and lifting it above the hero means the impact always reads, and because the
   * middle is hollow it frames the hero's arrival instead of covering it.
   */
  private playTileDeath(view: TileView): void {
    const half = CELL_SIZE / 2;

    view.moveTween?.remove();
    // Cancels a spawn tween still in flight, so a tile killed the turn after it appeared still fades
    this.tweens.killTweensOf(view.container);

    view.body.clear();
    view.body.lineStyle(TILE_DEATH_BURST_WIDTH, COLORS.tileDeathFlash, 1);
    view.body.strokeRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, TILE_RADIUS);
    view.label.setVisible(false);
    view.hpText.setVisible(false);
    view.container.setDepth(DEPTH.dyingTile).setAlpha(1).setScale(1);

    this.tweens.add({
      targets: view.container,
      alpha: 0,
      scale: TILE_DEATH_BURST_SCALE,
      duration: ANIMATION.normal,
      ease: ANIMATION.fadeEase,
      onComplete: () => view.container.destroy()
    });
  }

  private flashHeroLevelUp(): void {
    const hero = this.findHero();
    const view = hero ? this.tileViews.get(hero.id) : undefined;

    if (!view) {
      return;
    }

    this.tweens.add({
      targets: view.container,
      scale: ANIMATION.levelFlashScale,
      duration: ANIMATION.levelFlash / 2,
      yoyo: true,
      ease: ANIMATION.pulseEase
    });
  }

  private cellTopLeft(x: number, y: number): { x: number; y: number } {
    return {
      x: BOARD_LEFT + x * (CELL_SIZE + CELL_GAP),
      y: BOARD_TOP + y * (CELL_SIZE + CELL_GAP)
    };
  }

  private cellCentre(x: number, y: number): { x: number; y: number } {
    const cell = this.cellTopLeft(x, y);

    return { x: cell.x + CELL_SIZE / 2, y: cell.y + CELL_SIZE / 2 };
  }

  private findHero(): Tile | undefined {
    return this.board.tiles.find((tile) => tile.kind === 'hero');
  }

  // ----- End state overlay -----

  private showEndState(title: string, description: string): void {
    if (this.endOverlayShown) {
      return;
    }

    this.endOverlayShown = true;
    this.finalizeRun();

    // The boss line is meaningless once the fight is over, and it showed through the overlay
    this.stopTelegraphPulse();
    this.telegraphGraphics.setVisible(false);
    this.bossTelegraphText.setVisible(false);

    if (this.board.status === 'victory') {
      this.soundEngine.playVictory();
    } else {
      this.soundEngine.playDefeat();
    }

    const hero = this.findHero();
    const survivingHp = Math.max(0, hero?.hp ?? 0);
    const score = this.computeRunScore(survivingHp);
    const modeBonus = this.getModeBonus();
    const victoryBonus = this.board.status === 'victory' ? VICTORY_BONUS : 0;

    const overlay = this.add.rectangle(CENTER_X, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT, COLORS.background.overlay, ALPHA.endOverlay)
      .setDepth(DEPTH.endOverlay);
    const panel = this.add.rectangle(CENTER_X, 620, 600, 520, COLORS.background.panel, 1)
      .setDepth(DEPTH.endOverlay + 1);

    const titleText = this.add.text(CENTER_X, END_PANEL_TITLE_Y, title, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.huge,
      color: this.board.status === 'victory' ? INK.onPanel.victory : INK.onPanel.defeat
    }).setOrigin(0.5).setDepth(DEPTH.endOverlay + 2);

    const descriptionText = this.add.text(CENTER_X, END_PANEL_DESCRIPTION_Y, description, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.onPanel.body,
      align: 'center',
      wordWrap: { width: 500 }
    }).setOrigin(0.5).setDepth(DEPTH.endOverlay + 2);

    // Score breakdown — every line here is a real addend of computeRunScore, so it sums to the total
    const breakdownRows: Array<[string, number]> = [
      [`Turns survived  ×${SCORE_PER_TURN}`, this.board.turn * SCORE_PER_TURN],
      [`Gold collected  ×${SCORE_PER_GOLD}`, this.board.gold * SCORE_PER_GOLD],
      [`Hero level  ×${SCORE_PER_LEVEL}`, this.board.heroLevel * SCORE_PER_LEVEL],
      [`HP remaining  ×${SCORE_PER_HP}`, survivingHp * SCORE_PER_HP],
      ['Mode bonus', modeBonus]
    ];

    if (victoryBonus > 0) {
      breakdownRows.push(['Victory bonus', victoryBonus]);
    }

    const breakdownLabels = this.add.text(END_PANEL_BREAKDOWN_LEFT, END_PANEL_BREAKDOWN_Y, breakdownRows.map(([label]) => label), {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.onPanel.body,
      align: 'left',
      lineSpacing: SPACING.xs
    }).setOrigin(0, 0).setDepth(DEPTH.endOverlay + 2);

    const breakdownValues = this.add.text(END_PANEL_BREAKDOWN_RIGHT, END_PANEL_BREAKDOWN_Y, breakdownRows.map(([, value]) => String(value)), {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.onPanel.body,
      align: 'right',
      lineSpacing: SPACING.xs
    }).setOrigin(1, 0).setDepth(DEPTH.endOverlay + 2);

    const totalText = this.add.text(
      CENTER_X,
      END_PANEL_BREAKDOWN_Y + breakdownRows.length * END_PANEL_ROW_HEIGHT + SPACING.sm,
      `Final Score  ${score}`,
      {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.xl,
        color: INK.onPanel.title
      }
    ).setOrigin(0.5, 0).setDepth(DEPTH.endOverlay + 2);

    // The rank line is conditional and the breakdown grows by a row on a victory, so everything
    // below the total flows from the total's own bottom edge instead of a fixed y
    let flowY = totalText.y + totalText.displayHeight + SPACING.md;

    const rankText = this.lastRunRank > 0
      ? this.add.text(CENTER_X, flowY, `Leaderboard rank: #${this.lastRunRank}`, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.base,
        color: INK.onPanel.accent
      }).setOrigin(0.5, 0).setDepth(DEPTH.endOverlay + 2)
      : undefined;

    if (rankText) {
      flowY += rankText.displayHeight + SPACING.md;
    }

    const menuButton = createButton(this, CENTER_X, flowY + SPACING.lg, 'Return to Menu', {
      variant: 'success',
      fontSize: TYPOGRAPHY.size.lg,
      padding: { x: SPACING.md, y: SPACING.xs + 2 },
      depth: DEPTH.endOverlay + 2
    });

    menuButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });

    const cascade: Array<Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.AlphaSingle> = [
      overlay,
      panel,
      titleText,
      descriptionText,
      breakdownLabels,
      breakdownValues,
      totalText
    ];

    if (rankText) {
      cascade.push(rankText);
    }

    cascade.push(menuButton);
    cascadeIn(this, cascade, ANIMATION.stagger / 2);
  }

  // ----- Persistence -----

  private persistRun(): void {
    if (this.board.status !== 'playing') {
      return;
    }

    saveActiveRun({
      board: this.cloneBoardState(this.board),
      runConfig: this.runConfig,
      lastActionMessage: this.lastActionMessage,
      savedAt: new Date().toISOString()
    });
  }

  private finalizeRun(): void {
    if (this.runFinalized) {
      return;
    }

    this.runFinalized = true;
    this.metaProgress = recordRunCompletion(this.board.turn, this.board.gold, this.board.status === 'victory');
    const hero = this.findHero();
    const score = this.computeRunScore(hero?.hp ?? 0);

    const leaderboard = recordLeaderboardEntry({
      mode: this.board.mode,
      score,
      turns: this.board.turn,
      gold: this.board.gold,
      level: this.board.heroLevel,
      victory: this.board.status === 'victory'
    });

    this.lastRunRank = this.computeRank(leaderboard, score);

    clearActiveRun();
    void syncMetaProgressToCloud(this.metaProgress);
  }

  private computeRank(leaderboard: LeaderboardEntry[], score: number): number {
    const index = leaderboard.findIndex((entry) => entry.score <= score);
    return index === -1 ? leaderboard.length : index + 1;
  }

  private applyRunSnapshot(snapshot: RunSnapshot): void {
    this.runConfig = snapshot.runConfig;
    this.board = this.cloneBoardState(snapshot.board);
    this.lastActionMessage = snapshot.lastActionMessage;
    this.runFinalized = false;
  }

  private cloneBoardState(boardState: typeof this.board): typeof this.board {
    return structuredClone(boardState);
  }

  // ----- Score -----

  private getModeBonus(): number {
    return this.board.mode === 'quest' ? 150 : this.board.mode === 'daily' ? 300 : 200;
  }

  private computeRunScore(heroHp: number): number {
    const victoryBonus = this.board.status === 'victory' ? VICTORY_BONUS : 0;

    return (
      this.board.turn * SCORE_PER_TURN +
      this.board.gold * SCORE_PER_GOLD +
      this.board.heroLevel * SCORE_PER_LEVEL +
      // A dead hero has negative hp; surviving hp is a bonus, dying is never a penalty
      Math.max(0, heroHp) * SCORE_PER_HP +
      victoryBonus +
      this.getModeBonus()
    );
  }
}
