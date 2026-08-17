import Phaser from 'phaser';
import { QUEST_LAYERS } from '../game/engine';
import { getCloudIdentityLabel, hasCloudSync, syncMetaProgressToCloud } from '../game/cloud';
import { dailySeed } from '../game/random';
import { loadActiveRun, loadLeaderboard, loadMetaProgress } from '../game/persistence';
import { ALPHA, ANIMATION, COLORS, INK, SPACING, TYPOGRAPHY } from '../game/theme';
import { spriteScale, TILE_SPRITES, tileTextureKey } from '../game/sprites';
import { bakeAllSprites } from './pixel';
import { cascadeIn, createButton, createPanel } from './ui';
import type { GameMode, TileKind, RunConfig } from '../game/types';

const MENU_WIDTH = 768;
const MENU_HEIGHT = 1365;
const CENTER_X = MENU_WIDTH / 2;

const CONTENT_TOP = 56;

const LEADERBOARD_ROW_HEIGHT = 24;
const LEADERBOARD_MAX_ROWS = 5;
/** Rows are laid out left-aligned inside this width so the sprite badges form a straight column. */
const LEADERBOARD_ROW_WIDTH = 400;
const LEADERBOARD_BADGE_X = -LEADERBOARD_ROW_WIDTH / 2;
const LEADERBOARD_TEXT_X = LEADERBOARD_BADGE_X + 28;
const LEADERBOARD_FRAME_PAD = 16;

const PANEL_WIDTH = 610;
const PANEL_HEIGHT = 150;
/** Preferred centre-to-centre distance; compressed toward PANEL_HEIGHT when space is tight. */
const PANEL_SPACING = 176;
const PANEL_MIN_GAP = 12;
/** Panel content offsets from the panel's centre. */
const PANEL_TITLE_OFFSET_Y = -42;
const PANEL_SUBTITLE_OFFSET_Y = 4;
const PANEL_ACTION_OFFSET_Y = 52;
/** The whole text block shifts right to clear the mode sprite standing on the panel's left. */
const PANEL_TEXT_OFFSET_X = 44;
const PANEL_TEXT_WRAP = 430;
const PANEL_SPRITE_X = -PANEL_WIDTH / 2 + 56;
/** Reserved for the two footer hint lines at the bottom of the screen. */
const FOOTER_RESERVED = 170;
/** Hover swell. Smaller than a button press dip, because a 610px panel magnifies any scale change. */
const PANEL_HOVER_SCALE = 1.015;

/**
 * The baked creature that fronts each mode — on its card, and as its badge in the leaderboard. Quest
 * shows what you are descending toward, Endless shows what is coming for you, Daily shows the prize.
 *
 * Replaces the `[Q] [D] [∞]` bracketed letters the leaderboard used, which were the last place in the
 * game still identifying something by writing its name down.
 */
const MODE_SPRITE: Record<GameMode, TileKind> = {
  quest: 'boss',
  daily: 'gold',
  endless: 'spider'
};

export class MenuScene extends Phaser.Scene {
  /** Top edge of the next element in the vertical flow. */
  private cursorY = CONTENT_TOP;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    const meta = loadMetaProgress();
    const activeRun = loadActiveRun();
    const leaderboard = loadLeaderboard();

    // Guarded by textures.exists inside, so this is a no-op on every visit after the first
    bakeAllSprites(this);

    this.cursorY = CONTENT_TOP;
    this.cameras.main.setBackgroundColor(COLORS.background.primary);

    this.stack(this.add.text(CENTER_X, 0, 'Rogue Swipe', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.giant,
      color: INK.title,
      stroke: INK.onTile.outline,
      strokeThickness: TYPOGRAPHY.stroke.bold
    }), SPACING.md);

    this.stack(this.add.text(CENTER_X, 0, 'Swipe to step one tile at a time, survive the run, and chase the leaderboard.', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.md,
      color: INK.muted,
      align: 'center',
      wordWrap: { width: 560 }
    }), SPACING.md);

    this.stack(this.add.text(CENTER_X, 0, `Vault Gold ${meta.bankedGold}   Best Run ${meta.bestTurnsSurvived} turns`, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.body
    }), SPACING.xs);

    const statusText = this.stack(this.add.text(CENTER_X, 0, hasCloudSync()
      ? `Cloud ready as ${getCloudIdentityLabel()}`
      : 'Cloud sync unavailable. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable it.', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.sm,
      color: hasCloudSync() ? INK.status.ok : INK.status.warn,
      align: 'center',
      wordWrap: { width: 640 }
    }), SPACING.xs);

    const cloudButton = this.stackCentred(
      createButton(this, CENTER_X, 0, 'Sync Cloud Save', {
        variant: 'neutral',
        fontSize: TYPOGRAPHY.size.base
      }),
      activeRun ? SPACING.xs : SPACING.xl
    );

    cloudButton.on('pointerdown', async () => {
      // setEnabled rather than disableInteractive/setInteractive: a UIButton is a Container, whose
      // default hit rect is anchored top-left while its label sits around its centre. Re-enabling it
      // bare would leave the clickable area offset down and to the right of the button you can see.
      cloudButton.setEnabled(false);
      statusText.setText('Syncing cloud save...');

      const result = await syncMetaProgressToCloud(meta);
      statusText.setText(result.message);

      cloudButton.setEnabled(true);
    });

    if (activeRun) {
      const resumeButton = this.stackCentred(
        createButton(this, CENTER_X, 0, `Resume ${activeRun.runConfig.title}  Turn ${activeRun.board.turn}`, {
          variant: 'spell',
          fontSize: TYPOGRAPHY.size.md
        }),
        SPACING.xl
      );

      resumeButton.on('pointerdown', () => {
        this.scene.start('GameScene', { resumeRun: activeRun });
      });
    }

    this.stack(this.add.text(CENTER_X, 0, 'Top Scores', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.xl,
      color: INK.title,
      stroke: INK.onTile.outline,
      strokeThickness: TYPOGRAPHY.stroke.bold
    }), SPACING.xs);

    this.createLeaderboard(leaderboard);
    this.createModePanels(meta);
    this.createFooter();
  }

  /**
   * Places a text object at the current flow position and advances the cursor past it. Every
   * element in the menu is laid out this way: the previous fixed y-coordinates assumed a
   * best-case stack, so the optional Resume button silently overlapped its neighbours.
   */
  private stack<T extends Phaser.GameObjects.Text>(text: T, gapAfter: number): T {
    text.setOrigin(0.5, 0).setY(this.cursorY);
    this.cursorY += text.displayHeight + gapAfter;

    return text;
  }

  /**
   * The same flow for a Container. A Container has no origin at all — its children are positioned
   * around its own coordinates — so it is placed at its own half-height instead of being re-origined
   * the way a `Text` can be.
   */
  private stackCentred<T extends Phaser.GameObjects.Container>(object: T, gapAfter: number): T {
    object.setY(this.cursorY + object.height / 2);
    this.cursorY += object.height + gapAfter;

    return object;
  }

  private createLeaderboard(leaderboard: ReturnType<typeof loadLeaderboard>): void {
    if (leaderboard.length === 0) {
      this.stack(this.add.text(CENTER_X, 0, 'No runs yet — play a mode below to get on the board!', {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.sm,
        color: INK.muted,
        align: 'center',
        wordWrap: { width: 520 }
      }), SPACING.xl);

      return;
    }

    const shownEntries = leaderboard.slice(0, LEADERBOARD_MAX_ROWS);
    const hasMore = leaderboard.length > LEADERBOARD_MAX_ROWS;
    const rowsTop = this.cursorY;

    // Frame drawn first so it sits behind the rows. A thin accent stroke rather than a filled panel:
    // the row colour already carries meaning (green for a victory), and a light panel would kill it.
    const frame = this.add.graphics();

    frame.lineStyle(2, COLORS.menuPanel.stroke, ALPHA.frameAccent);
    frame.strokeRoundedRect(
      CENTER_X - LEADERBOARD_ROW_WIDTH / 2 - LEADERBOARD_FRAME_PAD,
      rowsTop - LEADERBOARD_FRAME_PAD,
      LEADERBOARD_ROW_WIDTH + LEADERBOARD_FRAME_PAD * 2,
      shownEntries.length * LEADERBOARD_ROW_HEIGHT + LEADERBOARD_FRAME_PAD * 2,
      10
    );

    shownEntries.forEach((entry, index) => {
      const rowY = rowsTop + index * LEADERBOARD_ROW_HEIGHT;
      const badgeKind = MODE_SPRITE[entry.mode];

      // Scale 1: these are icons at their authored pixel size, which keeps the scale an integer and
      // the edges crisp under the NEAREST filtering the baker applies.
      this.add.image(CENTER_X + LEADERBOARD_BADGE_X, rowY + LEADERBOARD_ROW_HEIGHT / 2, tileTextureKey(badgeKind))
        .setScale(1)
        .setAlpha(entry.victory ? 1 : ALPHA.disabled + 0.3);

      this.add.text(
        CENTER_X + LEADERBOARD_TEXT_X,
        rowY,
        `${index + 1}. ${entry.score}   Lv${entry.level}   ${entry.turns} turns${entry.victory ? '   cleared' : ''}`,
        {
          fontFamily: TYPOGRAPHY.family,
          fontSize: TYPOGRAPHY.size.sm,
          color: entry.victory ? INK.status.ok : INK.body
        }
      ).setOrigin(0, 0);
    });

    this.cursorY = rowsTop + shownEntries.length * LEADERBOARD_ROW_HEIGHT + LEADERBOARD_FRAME_PAD;

    if (hasMore) {
      this.stack(this.add.text(CENTER_X, 0, `+${leaderboard.length - LEADERBOARD_MAX_ROWS} more runs`, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.xs,
        color: INK.faint
      }), SPACING.xl);

      return;
    }

    this.cursorY += SPACING.xl;
  }

  private createModePanels(meta: ReturnType<typeof loadMetaProgress>): void {
    const options = [
      {
        mode: 'quest',
        title: 'Quest Mode',
        subtitle: `Descend all ${QUEST_LAYERS} layers of the dungeon. Each floor ends with a boss and a stairway down.`,
        seed: 'quest:chapter-1',
        progressTarget: 120,
        progressPerTurn: 7,
        spawnsPerTurn: 1,
        bossHp: 12,
        layers: QUEST_LAYERS
      },
      {
        mode: 'daily',
        title: 'Daily Run',
        subtitle: 'Everyone shares the same seed for the day.',
        // Placeholder — the real seed is computed at launch time so a menu left open across
        // midnight still starts the correct day's run
        seed: 'daily:pending',
        progressTarget: 100,
        progressPerTurn: 8,
        spawnsPerTurn: 1,
        bossHp: 0,
        layers: 1
      },
      {
        mode: 'endless',
        title: 'Endless Arena',
        subtitle: 'Survive as long as you can while the board slowly crowds in.',
        seed: 'endless:arena',
        progressTarget: 9999,
        progressPerTurn: 0,
        // Was 2. The engine's own default for this mode is 1 and the config wins, so both had to move
        // together — changing only the engine default would have been a silent no-op.
        spawnsPerTurn: 1,
        bossHp: 0,
        layers: 1
      }
    ] satisfies Array<{ mode: GameMode; title: string; subtitle: string; seed: string; progressTarget: number; progressPerTurn: number; spawnsPerTurn: number; bossHp: number; layers: number }>;

    // Fit the panel block into whatever space is left between the flow cursor and the footer. A
    // full leaderboard pushes the cursor down, so the spacing compresses rather than letting the
    // last panel run over the footer text.
    const available = MENU_HEIGHT - FOOTER_RESERVED - this.cursorY;
    const spacing = options.length > 1
      ? Math.min(PANEL_SPACING, Math.max(PANEL_HEIGHT + PANEL_MIN_GAP, (available - PANEL_HEIGHT) / (options.length - 1)))
      : PANEL_SPACING;
    const blockHeight = (options.length - 1) * spacing + PANEL_HEIGHT;
    const firstCentre = this.cursorY + Math.max(0, (available - blockHeight) / 2) + PANEL_HEIGHT / 2;

    const panels = options.map((option, index) => {
      const y = firstCentre + index * spacing;
      const spriteKind = MODE_SPRITE[option.mode];

      // The panel's parts live in a Container so hover and press can transform the whole card at
      // once. The hit area stays outside it, in world space, since it is not part of the visual.
      //
      // Two plates rather than one recoloured plate: a `Graphics` cannot have its fill changed after
      // the fact the way a `Rectangle` could, so the hover state is a second pre-drawn copy that is
      // simply switched on. Cheaper than clearing and re-issuing a dozen draw calls per pointer move.
      const plate = createPanel(this, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
      const platehover = createPanel(this, 0, 0, PANEL_WIDTH, PANEL_HEIGHT, undefined, COLORS.menuPanel.fillHover)
        .setVisible(false);
      const creature = this.add.image(PANEL_SPRITE_X, 0, tileTextureKey(spriteKind))
        .setScale(spriteScale(TILE_SPRITES[spriteKind]));
      const title = this.add.text(PANEL_TEXT_OFFSET_X, PANEL_TITLE_OFFSET_Y, option.title, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.display,
        color: INK.onPanel.title
      }).setOrigin(0.5);
      const subtitle = this.add.text(PANEL_TEXT_OFFSET_X, PANEL_SUBTITLE_OFFSET_Y, option.subtitle, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.base,
        color: INK.onPanel.muted,
        align: 'center',
        wordWrap: { width: PANEL_TEXT_WRAP }
      }).setOrigin(0.5);
      const action = this.add.text(PANEL_TEXT_OFFSET_X, PANEL_ACTION_OFFSET_Y, 'Tap to play', {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.md,
        color: INK.onPanel.accent
      }).setOrigin(0.5);

      const panel = this.add.container(CENTER_X, y, [plate, platehover, creature, title, subtitle, action]);
      const hitArea = this.add.zone(CENTER_X, y, PANEL_WIDTH, PANEL_HEIGHT).setInteractive({ useHandCursor: true });

      hitArea.on('pointerover', () => {
        platehover.setVisible(true);
        this.tweens.add({
          targets: panel,
          scale: PANEL_HOVER_SCALE,
          duration: ANIMATION.fast,
          ease: ANIMATION.fadeEase
        });
      });

      hitArea.on('pointerout', () => {
        platehover.setVisible(false);
        this.tweens.add({
          targets: panel,
          scale: 1,
          duration: ANIMATION.fast,
          ease: ANIMATION.fadeEase
        });
      });

      hitArea.on('pointerdown', () => {
        this.tweens.add({
          targets: panel,
          scale: ANIMATION.pressScale,
          duration: ANIMATION.press,
          yoyo: true,
          ease: ANIMATION.fadeEase
        });

        const runConfig: RunConfig = option.mode === 'daily'
          ? { ...option, seed: `daily:${dailySeed()}` }
          : { ...option };

        this.scene.start('GameScene', { runConfig, metaProgress: meta });
      });

      return panel;
    });

    cascadeIn(this, panels, ANIMATION.stagger / 2);
  }

  private createFooter(): void {
    this.add.text(CENTER_X, MENU_HEIGHT - 130, 'Every swipe moves your hero exactly one tile.', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.base,
      color: INK.faint
    }).setOrigin(0.5);

    this.add.text(CENTER_X, MENU_HEIGHT - 96, 'Desktop: Arrow keys or WASD  ·  Escape to pause', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.xs,
      color: INK.fainter
    }).setOrigin(0.5);
  }
}
