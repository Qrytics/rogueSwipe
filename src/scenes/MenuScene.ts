import Phaser from 'phaser';
import { getCloudIdentityLabel, hasCloudSync, syncMetaProgressToCloud } from '../game/cloud';
import { dailySeed } from '../game/random';
import { loadActiveRun, loadLeaderboard, loadMetaProgress } from '../game/persistence';
import { ANIMATION, COLORS, INK, SPACING, TYPOGRAPHY } from '../game/theme';
import { cascadeIn, createButton } from './ui';
import type { GameMode, RunConfig } from '../game/types';

const MENU_WIDTH = 768;
const MENU_HEIGHT = 1365;
const CENTER_X = MENU_WIDTH / 2;

const CONTENT_TOP = 56;

const LEADERBOARD_ROW_HEIGHT = 24;
const LEADERBOARD_MAX_ROWS = 5;

const PANEL_WIDTH = 610;
const PANEL_HEIGHT = 150;
/** Preferred centre-to-centre distance; compressed toward PANEL_HEIGHT when space is tight. */
const PANEL_SPACING = 176;
const PANEL_MIN_GAP = 12;
const PANEL_BORDER = 4;
/** Panel content offsets from the panel's centre. */
const PANEL_TITLE_OFFSET_Y = -42;
const PANEL_SUBTITLE_OFFSET_Y = 4;
const PANEL_ACTION_OFFSET_Y = 52;
/** Reserved for the two footer hint lines at the bottom of the screen. */
const FOOTER_RESERVED = 170;
/** Hover swell. Smaller than a button press dip, because a 610px panel magnifies any scale change. */
const PANEL_HOVER_SCALE = 1.015;

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

    const cloudButton = this.stack(
      createButton(this, CENTER_X, 0, 'Sync Cloud Save', {
        variant: 'neutral',
        fontSize: TYPOGRAPHY.size.base
      }),
      activeRun ? SPACING.xs : SPACING.xl
    );

    cloudButton.on('pointerdown', async () => {
      cloudButton.disableInteractive();
      statusText.setText('Syncing cloud save...');

      const result = await syncMetaProgressToCloud(meta);
      statusText.setText(result.message);

      cloudButton.setInteractive({ useHandCursor: true });
    });

    if (activeRun) {
      const resumeButton = this.stack(
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
  private stack(text: Phaser.GameObjects.Text, gapAfter: number): Phaser.GameObjects.Text {
    text.setOrigin(0.5, 0).setY(this.cursorY);
    this.cursorY += text.displayHeight + gapAfter;

    return text;
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

    shownEntries.forEach((entry, index) => {
      const victoryMark = entry.victory ? ' ✓' : ' ✗';
      const modeBadge = entry.mode === 'quest' ? '[Q]' : entry.mode === 'daily' ? '[D]' : '[∞]';

      this.add.text(
        CENTER_X,
        rowsTop + index * LEADERBOARD_ROW_HEIGHT,
        `${index + 1}. ${modeBadge} ${entry.score}  Lv${entry.level}  ${entry.turns}t${victoryMark}`,
        {
          fontFamily: TYPOGRAPHY.family,
          fontSize: TYPOGRAPHY.size.sm,
          color: entry.victory ? INK.status.ok : INK.body
        }
      ).setOrigin(0.5, 0);
    });

    this.cursorY = rowsTop + shownEntries.length * LEADERBOARD_ROW_HEIGHT;

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
        subtitle: 'Standard campaign progression with a boss floor after the track fills.',
        seed: 'quest:chapter-1',
        progressTarget: 120,
        progressPerTurn: 7,
        spawnsPerTurn: 1,
        bossHp: 12
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
        bossHp: 0
      },
      {
        mode: 'endless',
        title: 'Endless Arena',
        subtitle: 'Survive as long as you can while the board keeps crowding in.',
        seed: 'endless:arena',
        progressTarget: 9999,
        progressPerTurn: 0,
        spawnsPerTurn: 2,
        bossHp: 0
      }
    ] satisfies Array<{ mode: GameMode; title: string; subtitle: string; seed: string; progressTarget: number; progressPerTurn: number; spawnsPerTurn: number; bossHp: number }>;

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

      // The panel's parts live in a Container so hover and press can transform the whole card at
      // once. The hit area stays outside it, in world space, since it is not part of the visual.
      const background = this.add.rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, COLORS.menuPanel.fill, 1)
        .setStrokeStyle(PANEL_BORDER, COLORS.menuPanel.stroke, 1);
      const title = this.add.text(0, PANEL_TITLE_OFFSET_Y, option.title, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.display,
        color: INK.onPanel.title
      }).setOrigin(0.5);
      const subtitle = this.add.text(0, PANEL_SUBTITLE_OFFSET_Y, option.subtitle, {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.base,
        color: INK.onPanel.muted,
        align: 'center',
        wordWrap: { width: 500 }
      }).setOrigin(0.5);
      const action = this.add.text(0, PANEL_ACTION_OFFSET_Y, 'Tap to play', {
        fontFamily: TYPOGRAPHY.family,
        fontSize: TYPOGRAPHY.size.md,
        color: INK.onPanel.accent
      }).setOrigin(0.5);

      const panel = this.add.container(CENTER_X, y, [background, title, subtitle, action]);
      const hitArea = this.add.zone(CENTER_X, y, PANEL_WIDTH, PANEL_HEIGHT).setInteractive({ useHandCursor: true });

      hitArea.on('pointerover', () => {
        background.setFillStyle(COLORS.menuPanel.fillHover, 1);
        this.tweens.add({
          targets: panel,
          scale: PANEL_HOVER_SCALE,
          duration: ANIMATION.fast,
          ease: ANIMATION.fadeEase
        });
      });

      hitArea.on('pointerout', () => {
        background.setFillStyle(COLORS.menuPanel.fill, 1);
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
