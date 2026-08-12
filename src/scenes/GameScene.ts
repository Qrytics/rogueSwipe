import Phaser from 'phaser';
import { createInitialBoardWithBonuses, moveHeroOneTile, useBackpackSpell } from '../game/engine';
import { syncMetaProgressToCloud } from '../game/cloud';
import { dailySeed } from '../game/random';
import { clearActiveRun, loadMetaProgress, recordLeaderboardEntry, recordRunCompletion, saveActiveRun } from '../game/persistence';
import { SoundEngine } from '../game/audio';
import type { Direction, LeaderboardEntry, PersistentProgress, RunConfig, RunSnapshot, Tile } from '../game/types';

const BOARD_SIZE = 5;
const BOARD_LEFT = 84;
const BOARD_TOP = 420;
const CELL_SIZE = 116;
const CELL_GAP = 6;
// Maximum tile text objects (label + hp per cell)
const TILE_TEXT_POOL_SIZE = BOARD_SIZE * BOARD_SIZE * 2;

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
  private tileGraphics!: Phaser.GameObjects.Graphics;
  private uiText!: Phaser.GameObjects.Text;
  private spellButton!: Phaser.GameObjects.Text;
  private muteButton!: Phaser.GameObjects.Text;
  // Pre-allocated text pool to avoid per-frame allocation
  private tileTextPool: Phaser.GameObjects.Text[] = [];
  private tileTextPoolUsed = 0;
  private endOverlayShown = false;
  private runFinalized = false;
  private paused = false;
  private pauseOverlayObjects: Phaser.GameObjects.GameObject[] = [];
  private swipeStart: { x: number; y: number } | null = null;
  private lastActionMessage = '';
  private metaProgress: PersistentProgress = loadMetaProgress();
  private lastRunRank = 0;
  private soundEngine!: SoundEngine;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const resumeRun = this.data.get('resumeRun') as RunSnapshot | undefined;
    const config = this.data.get('runConfig') as RunConfig | undefined;
    const metaProgress = this.data.get('metaProgress') as PersistentProgress | undefined;

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

    this.cameras.main.setBackgroundColor('#08131c');
    this.tileGraphics = this.add.graphics();

    this.add.text(384, 80, this.runConfig.title, {
      fontFamily: 'Georgia, serif',
      fontSize: '52px',
      color: '#f2f6ff',
      stroke: '#000000',
      strokeThickness: 8
    }).setOrigin(0.5);

    this.add.text(384, 134, this.runConfig.subtitle, {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#9fb2c8',
      align: 'center',
      wordWrap: { width: 520 }
    }).setOrigin(0.5);

    this.uiText = this.add.text(384, 160, '', {
      fontFamily: 'Georgia, serif',
      fontSize: '24px',
      color: '#dce5f4',
      align: 'center'
    }).setOrigin(0.5, 0);

    this.add.text(384, 235, 'Swipe or use arrow keys to move 1 tile', {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#8aa0b9'
    }).setOrigin(0.5);

    this.createSpellButton();
    this.createMuteButton();
    this.initTileTextPool();
    this.setupInput();
    this.renderBoard();
    this.refreshUi();
    this.persistRun();
  }

  // ----- Text pool -----

  private initTileTextPool(): void {
    for (let index = 0; index < TILE_TEXT_POOL_SIZE; index += 1) {
      const text = this.add.text(0, 0, '', {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#0d1621'
      }).setOrigin(0.5).setVisible(false);
      this.tileTextPool.push(text);
    }
  }

  private acquireText(x: number, y: number, value: string, style: Partial<Phaser.Types.GameObjects.Text.TextStyle>): void {
    if (this.tileTextPoolUsed >= this.tileTextPool.length) {
      return;
    }
    const text = this.tileTextPool[this.tileTextPoolUsed];
    this.tileTextPoolUsed += 1;
    text.setPosition(x, y).setText(value).setStyle({ fontFamily: 'Georgia, serif', fontSize: '18px', color: '#0d1621', ...style }).setVisible(true);
  }

  private releaseAllTexts(): void {
    for (let index = 0; index < this.tileTextPoolUsed; index += 1) {
      this.tileTextPool[index].setVisible(false);
    }
    this.tileTextPoolUsed = 0;
  }

  // ----- Input -----

  private setupInput(): void {
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
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

    const result = moveHeroOneTile(this.board, direction);

    if (result.acted || result.messages.length > 0) {
      this.lastActionMessage = result.messages[0] ?? this.lastActionMessage;
      this.soundEngine.playFromTurnResult(result, this.board.status);
      this.persistRun();
      this.renderBoard();
      this.refreshUi(result.messages);
    }
  }

  // ----- Pause -----

  private togglePause(): void {
    if (this.board.status !== 'playing') {
      return;
    }

    if (this.paused) {
      this.hidePauseOverlay();
    } else {
      this.showPauseOverlay();
    }
  }

  private showPauseOverlay(): void {
    this.paused = true;

    const overlay = this.add.rectangle(384, 683, 768, 1365, 0x000000, 0.65).setDepth(20);
    const panel = this.add.rectangle(384, 683, 480, 320, 0xd7def0, 1).setDepth(21);

    const titleText = this.add.text(384, 590, 'Paused', {
      fontFamily: 'Georgia, serif',
      fontSize: '48px',
      color: '#16202d'
    }).setOrigin(0.5).setDepth(22);

    const resumeBtn = this.add.text(384, 680, 'Resume', {
      fontFamily: 'Georgia, serif',
      fontSize: '28px',
      color: '#174a28',
      backgroundColor: '#bfe0cf',
      padding: { left: 28, right: 28, top: 14, bottom: 14 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(22);

    const quitBtn = this.add.text(384, 770, 'Quit to Menu', {
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      color: '#4a1717',
      backgroundColor: '#e0bfbf',
      padding: { left: 22, right: 22, top: 12, bottom: 12 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(22);

    resumeBtn.on('pointerdown', () => {
      this.hidePauseOverlay();
    });

    quitBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });

    this.pauseOverlayObjects = [overlay, panel, titleText, resumeBtn, quitBtn];
  }

  private hidePauseOverlay(): void {
    for (const obj of this.pauseOverlayObjects) {
      obj.destroy();
    }
    this.pauseOverlayObjects = [];
    this.paused = false;
  }

  // ----- Spell button -----

  private createSpellButton(): void {
    this.spellButton = this.add.text(620, 1260, 'Backpack\nFireball x1', {
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      color: '#143b1f',
      backgroundColor: '#c7e3d1',
      align: 'center',
      padding: { left: 18, right: 18, top: 14, bottom: 14 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.spellButton.on('pointerdown', () => {
      if (this.paused || this.board.status !== 'playing') {
        return;
      }

      const result = useBackpackSpell(this.board);

      if (result.used) {
        this.lastActionMessage = result.message;
        this.soundEngine.playSpell();
        this.persistRun();
        this.renderBoard();
        this.refreshUi([result.message]);
      }
    });
  }

  // ----- Mute button -----

  private createMuteButton(): void {
    const label = () => this.soundEngine.isMuted() ? '🔇' : '🔊';

    this.muteButton = this.add.text(720, 50, label(), {
      fontFamily: 'Georgia, serif',
      fontSize: '28px',
      color: '#b4c4d9'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.muteButton.on('pointerdown', () => {
      if (this.soundEngine.isMuted()) {
        this.soundEngine.unmute();
      } else {
        this.soundEngine.mute();
      }
      this.muteButton.setText(label());
    });
  }

  // ----- UI -----

  private refreshUi(messages: string[] = []): void {
    const progressWidth = 420;
    const progress = this.board.phase === 'boss'
      ? Math.floor((Math.max(0, this.board.bossHp) / Math.max(1, this.board.bossMaxHp)) * 100)
      : Math.floor((this.board.progress / this.board.maxProgress) * 100);
    const hero = this.findHero();
    const xpNeeded = 100 + (this.board.heroLevel - 1) * 20;
    const phaseLabel = this.board.phase === 'boss'
      ? `Boss HP ${this.board.bossHp}/${this.board.bossMaxHp}`
      : `Progress ${progress}%`;
    const bossTelegraph = this.board.phase === 'boss'
      ? `Stone-Weaver ${this.board.bossAttackCountdown <= 1 ? 'STRIKES NEXT!' : `charges in ${this.board.bossAttackCountdown} turns`}`
      : '';
    const slowedLine = this.board.heroIsSlowed ? 'Slowed — next turn skips spawns.' : '';
    const actionLine = messages[0] ?? this.lastActionMessage;

    this.uiText.setText([
      `Turn ${this.board.turn}`,
      `Lvl ${this.board.heroLevel}   HP ${hero?.hp ?? 0}/${this.board.heroMaxHp}   XP ${this.board.xp}/${xpNeeded}   Gold ${this.board.gold}`,
      phaseLabel,
      `Fireball x${this.board.spellCharges}/${this.board.spellMaxCharges}`,
      bossTelegraph,
      slowedLine,
      actionLine
    ]);

    this.spellButton.setText(`Backpack\nFireball x${this.board.spellCharges}`);
    this.spellButton.setAlpha(this.board.spellCharges > 0 ? 1 : 0.45);

    this.drawProgressBar(progressWidth, progress);

    if (this.board.status === 'victory') {
      this.showEndState('Victory!', this.buildVictoryMessage());
    } else if (this.board.status === 'defeat') {
      this.showEndState('Defeat', 'Your hero fell in the maze.');
    }
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

  private drawProgressBar(width: number, progress: number): void {
    const progressLeft = 174;
    const progressTop = 286;
    const filledWidth = Math.max(0, (width * Math.min(100, progress)) / 100);

    this.tileGraphics.lineStyle(4, 0x4f667d, 1);
    this.tileGraphics.strokeRoundedRect(progressLeft, progressTop, width, 18, 9);
    this.tileGraphics.fillStyle(this.board.phase === 'boss' ? 0xff8080 : 0x7ec8ff, 1);
    this.tileGraphics.fillRoundedRect(progressLeft, progressTop, filledWidth, 18, 9);
    this.tileGraphics.fillStyle(this.board.phase === 'boss' ? 0xffc0c0 : 0xc9e3ff, 1);

    if (filledWidth > 0) {
      this.tileGraphics.fillCircle(progressLeft + filledWidth, progressTop + 9, 10);
    }
  }

  // ----- Board rendering -----

  private renderBoard(): void {
    this.releaseAllTexts();
    this.tileGraphics.clear();
    this.drawBoardBackground();
    this.drawBossTelegraph();

    for (const tile of this.board.tiles) {
      this.drawTile(tile);
    }
  }

  private drawBossTelegraph(): void {
    if (this.board.phase !== 'boss' || this.board.status !== 'playing') {
      return;
    }

    const highlightColor = this.board.bossAttackCountdown <= 1 ? 0xff6a6a : 0xffc46a;
    this.tileGraphics.lineStyle(8, highlightColor, 0.45);

    for (let index = 0; index < BOARD_SIZE; index += 1) {
      const x = this.board.bossAttackAxis === 'column' ? this.board.bossAttackLine : index;
      const y = this.board.bossAttackAxis === 'row' ? this.board.bossAttackLine : index;
      const position = this.cellToWorld(x, y);

      this.tileGraphics.strokeRoundedRect(position.x - 2, position.y - 2, CELL_SIZE + 4, CELL_SIZE + 4, 12);
    }
  }

  private drawBoardBackground(): void {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const position = this.cellToWorld(x, y);
        this.tileGraphics.fillStyle(0x1f4d2c, 0.75);
        this.tileGraphics.fillRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);
      }
    }
  }

  private drawTile(tile: Tile): void {
    const position = this.cellToWorld(tile.x, tile.y);
    const style = this.getTileStyle(tile.kind);

    this.tileGraphics.fillStyle(style.fill, 1);
    this.tileGraphics.fillRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);
    this.tileGraphics.lineStyle(tile.kind === 'hero' ? 6 : 3, style.stroke, 1);
    this.tileGraphics.strokeRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);

    if (tile.kind !== 'web') {
      this.tileGraphics.fillStyle(style.icon, 1);
      this.tileGraphics.fillCircle(position.x + CELL_SIZE / 2, position.y + CELL_SIZE / 2 - 4, 14);
    }

    if (tile.kind === 'hero') {
      this.tileGraphics.lineStyle(8, 0xe8f2ff, 1);
      this.tileGraphics.strokeRoundedRect(position.x - 4, position.y - 4, CELL_SIZE + 8, CELL_SIZE + 8, 14);
    }

    const label = tile.kind === 'hero' ? 'You' : tile.kind;
    this.acquireText(
      position.x + CELL_SIZE / 2,
      position.y + CELL_SIZE / 2 + 22,
      label,
      { fontSize: '18px', color: '#0d1621' }
    );

    if (tile.hp > 1 || tile.kind === 'hero') {
      this.acquireText(
        position.x + CELL_SIZE / 2,
        position.y + CELL_SIZE / 2 - 34,
        String(tile.hp),
        { fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 } as Partial<Phaser.Types.GameObjects.Text.TextStyle>
      );
    }
  }

  private getTileStyle(kind: Tile['kind']): { fill: number; stroke: number; icon: number } {
    switch (kind) {
      case 'hero':
        return { fill: 0xb6d6ff, stroke: 0xffffff, icon: 0x1f4d8d };
      case 'goblin':
        return { fill: 0xb55f5f, stroke: 0xffb3b3, icon: 0x4d0f0f };
      case 'spider':
        return { fill: 0x5e5479, stroke: 0xff7979, icon: 0x20192e };
      case 'rock':
        return { fill: 0xbfc2ca, stroke: 0xffffff, icon: 0x69707c };
      case 'web':
        return { fill: 0x7f7f7f, stroke: 0xdedede, icon: 0xffffff };
      case 'gold':
        return { fill: 0xecc74a, stroke: 0xfff2b0, icon: 0xffd74a };
      case 'boss':
        return { fill: 0x8f5b5b, stroke: 0xffd2d2, icon: 0x421111 };
    }
  }

  private cellToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: BOARD_LEFT + x * (CELL_SIZE + CELL_GAP),
      y: BOARD_TOP + y * (CELL_SIZE + CELL_GAP)
    };
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

    if (this.board.status === 'victory') {
      this.soundEngine.playVictory();
    } else {
      this.soundEngine.playDefeat();
    }

    const hero = this.findHero();
    const score = this.computeRunScore(hero?.hp ?? 0);
    const modeBonus = this.getModeBonus();
    const victoryBonus = this.board.status === 'victory' ? 800 : 0;

    const overlay = this.add.rectangle(384, 683, 768, 1365, 0x000000, 0.72).setDepth(10);
    const panel = this.add.rectangle(384, 620, 600, 520, 0xd7def0, 1).setDepth(11);

    this.add.text(384, 400, title, {
      fontFamily: 'Georgia, serif',
      fontSize: '52px',
      color: this.board.status === 'victory' ? '#1a4a1f' : '#4a1a1a'
    }).setOrigin(0.5).setDepth(12);

    this.add.text(384, 472, description, {
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      color: '#243447',
      align: 'center',
      wordWrap: { width: 500 }
    }).setOrigin(0.5).setDepth(12);

    // Score breakdown
    const breakdownLines = [
      `Turns:   ${this.board.turn} × 10 = ${this.board.turn * 10}`,
      `Gold:    ${this.board.gold} × 20 = ${this.board.gold * 20}`,
      `Level:   ${this.board.heroLevel} × 60 = ${this.board.heroLevel * 60}`,
      `HP:      ${hero?.hp ?? 0} × 15 = ${(hero?.hp ?? 0) * 15}`,
      victoryBonus > 0 ? `Victory bonus: +${victoryBonus}` : `Mode bonus: +${modeBonus}`,
      `─────────────────────`,
      `Final Score: ${score}`
    ];

    this.add.text(384, 580, breakdownLines, {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#243447',
      align: 'center',
      lineSpacing: 6
    }).setOrigin(0.5, 0).setDepth(12);

    if (this.lastRunRank > 0) {
      this.add.text(384, 790, `Leaderboard rank: #${this.lastRunRank}`, {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#1a3a50'
      }).setOrigin(0.5).setDepth(12);
    }

    const menuButton = this.add.text(384, 840, 'Return to Menu', {
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      color: '#174a28',
      backgroundColor: '#bfe0cf',
      padding: { left: 18, right: 18, top: 10, bottom: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(12);

    menuButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
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
    const victoryBonus = this.board.status === 'victory' ? 800 : 0;

    return (
      this.board.turn * 10 +
      this.board.gold * 20 +
      this.board.heroLevel * 60 +
      heroHp * 15 +
      victoryBonus +
      this.getModeBonus()
    );
  }
}
