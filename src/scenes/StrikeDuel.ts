import Phaser from 'phaser';
import { spriteScale, TILE_SPRITES, tileTextureKey } from '../game/sprites';
import { ALPHA, ANIMATION, COLORS, INK, TYPOGRAPHY } from '../game/theme';
import type { StrikeQuality, TileKind } from '../game/types';

const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 1365;
const CENTER_X = CANVAS_WIDTH / 2;

/** Sits over the middle of the board, so the eye does not have to travel to find the bar. */
const TRACK_CENTRE_Y = 720;
const TRACK_WIDTH = 520;
const TRACK_HEIGHT = 46;
const TRACK_RADIUS = 8;
const TRACK_BORDER = 3;

const MARKER_WIDTH = 6;
/** How far the marker sticks out above and below the track, so it reads against a filled zone. */
const MARKER_OVERHANG = 12;

const PLATE_WIDTH = 620;
const PLATE_HEIGHT = 330;
const PLATE_RADIUS = 20;

const TARGET_OFFSET_Y = -158;
const PROMPT_OFFSET_Y = -74;
const HINT_OFFSET_Y = 60;
const VERDICT_OFFSET_Y = 96;

/**
 * Zone widths as fractions of the track. `good` is generous — a mistimed tap should cost damage, not
 * feel like a punishment — while `perfect` is where the skill lives.
 */
const GOOD_FRACTION = 0.34;
const PERFECT_FRACTION = 0.12;
/** Bosses get a tighter window, tightening again with depth. Floored so layer 5 is hard, not luck. */
const BOSS_PERFECT_FRACTION = 0.09;
const BOSS_PERFECT_NARROWING = 0.01;
const BOSS_PERFECT_FLOOR = 0.05;

/** Enlarges the target sprite over its on-board size while keeping the scale an integer. */
const TARGET_SCALE_BOOST = 2;

export interface StrikeDuelOptions {
  targetKind: TileKind;
  /** Current dungeon layer, 1-based. Only used to narrow a boss's perfect window. */
  layer: number;
  depth: number;
  onResolve: (quality: StrikeQuality) => void;
}

/**
 * The Undertale-style timing bar that stands between a swipe and a melee strike.
 *
 * Self-contained on purpose: it owns its own GameObjects, its own input handlers and its own tween, so
 * `GameScene` only has to flip `duelActive`, construct one of these, and take the quality back through
 * `onResolve`. It never touches the board — `moveHeroOneTile` resolves the whole turn atomically after
 * the fact, which is what keeps `src/game/` free of any UI concern.
 *
 * Two guarantees the rest of the game leans on:
 *   - it always resolves. If the sweep runs out the duel scores itself `weak` rather than waiting, so a
 *     player who puts the phone down never comes back to a soft-locked board.
 *   - `destroy()` resolves nothing. That is the Escape path: GameScene cancels the duel and opens pause
 *     without the turn ever being committed.
 */
export class StrikeDuel {
  private readonly scene: Phaser.Scene;
  private readonly options: StrikeDuelOptions;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly marker: Phaser.GameObjects.Rectangle;
  private readonly verdictText: Phaser.GameObjects.Text;
  private readonly perfectHalfWidth: number;
  private readonly goodHalfWidth: number;
  private sweep?: Phaser.Tweens.Tween;
  private verdictTimer?: Phaser.Time.TimerEvent;
  private resolved = false;
  private destroyed = false;

  // Stored as fields so `detachInput` can remove exactly these listeners; `scene.input.off(event)`
  // with no handler would also strip GameScene's own swipe handlers.
  private readonly onPointerDown = (): void => this.strike();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'NumpadEnter') {
      return;
    }

    // Space scrolls the page otherwise, which drags the canvas out from under the player mid-duel
    event.preventDefault();
    this.strike();
  };

  constructor(scene: Phaser.Scene, options: StrikeDuelOptions) {
    this.scene = scene;
    this.options = options;

    const perfectFraction = options.targetKind === 'boss'
      ? Math.max(BOSS_PERFECT_FLOOR, BOSS_PERFECT_FRACTION - BOSS_PERFECT_NARROWING * (options.layer - 1))
      : PERFECT_FRACTION;

    this.perfectHalfWidth = (TRACK_WIDTH * perfectFraction) / 2;
    this.goodHalfWidth = (TRACK_WIDTH * GOOD_FRACTION) / 2;

    const { depth } = options;
    const trackLeft = CENTER_X - TRACK_WIDTH / 2;

    const scrim = scene.add.rectangle(CENTER_X, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT, COLORS.duel.scrim, ALPHA.duelScrim)
      .setDepth(depth);

    const plate = scene.add.graphics({ x: CENTER_X, y: TRACK_CENTRE_Y - 20 }).setDepth(depth + 1);
    plate.fillStyle(COLORS.duel.trackFill, 1);
    plate.fillRoundedRect(-PLATE_WIDTH / 2, -PLATE_HEIGHT / 2, PLATE_WIDTH, PLATE_HEIGHT, PLATE_RADIUS);
    plate.lineStyle(TRACK_BORDER, COLORS.duel.trackStroke, 1);
    plate.strokeRoundedRect(-PLATE_WIDTH / 2, -PLATE_HEIGHT / 2, PLATE_WIDTH, PLATE_HEIGHT, PLATE_RADIUS);

    const targetDef = TILE_SPRITES[options.targetKind];
    const target = scene.add.image(CENTER_X, TRACK_CENTRE_Y + TARGET_OFFSET_Y, tileTextureKey(options.targetKind))
      .setScale(spriteScale(targetDef) + TARGET_SCALE_BOOST)
      .setDepth(depth + 2);

    const prompt = scene.add.text(CENTER_X, TRACK_CENTRE_Y + PROMPT_OFFSET_Y, 'Strike!', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.display,
      color: INK.duel.prompt,
      stroke: INK.onTile.outline,
      strokeThickness: TYPOGRAPHY.stroke.normal
    }).setOrigin(0.5).setDepth(depth + 2);

    // The track, then its two scoring zones, all in one Graphics — none of it ever changes, only the
    // marker moves across the top of it.
    const track = scene.add.graphics().setDepth(depth + 2);
    track.fillStyle(COLORS.duel.trackFill, 1);
    track.fillRoundedRect(trackLeft, TRACK_CENTRE_Y - TRACK_HEIGHT / 2, TRACK_WIDTH, TRACK_HEIGHT, TRACK_RADIUS);
    track.fillStyle(COLORS.duel.good, 1);
    track.fillRect(CENTER_X - this.goodHalfWidth, TRACK_CENTRE_Y - TRACK_HEIGHT / 2, this.goodHalfWidth * 2, TRACK_HEIGHT);
    track.fillStyle(COLORS.duel.perfect, 1);
    track.fillRect(CENTER_X - this.perfectHalfWidth, TRACK_CENTRE_Y - TRACK_HEIGHT / 2, this.perfectHalfWidth * 2, TRACK_HEIGHT);
    track.lineStyle(TRACK_BORDER, COLORS.duel.trackStroke, 1);
    track.strokeRoundedRect(trackLeft, TRACK_CENTRE_Y - TRACK_HEIGHT / 2, TRACK_WIDTH, TRACK_HEIGHT, TRACK_RADIUS);

    this.marker = scene.add.rectangle(trackLeft, TRACK_CENTRE_Y, MARKER_WIDTH, TRACK_HEIGHT + MARKER_OVERHANG * 2, COLORS.duel.marker)
      .setDepth(depth + 3);

    const hint = scene.add.text(CENTER_X, TRACK_CENTRE_Y + HINT_OFFSET_Y, 'Tap the screen or press Space in the green', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.sm,
      color: INK.duel.hint
    }).setOrigin(0.5).setDepth(depth + 2);

    this.verdictText = scene.add.text(CENTER_X, TRACK_CENTRE_Y + VERDICT_OFFSET_Y, '', {
      fontFamily: TYPOGRAPHY.family,
      fontSize: TYPOGRAPHY.size.xl,
      color: INK.duel.prompt
    }).setOrigin(0.5).setDepth(depth + 3).setVisible(false);

    this.objects.push(scrim, plate, target, prompt, track, this.marker, hint, this.verdictText);

    this.sweep = scene.tweens.add({
      targets: this.marker,
      x: trackLeft + TRACK_WIDTH,
      duration: ANIMATION.duelSweep,
      ease: 'Linear',
      yoyo: true,
      repeat: 1,
      // Second lap: the window is closing, so the marker warms up to say so
      onRepeat: () => this.marker.setFillStyle(COLORS.duel.markerUrgent),
      onComplete: () => this.resolve('weak')
    });

    scene.input.on('pointerdown', this.onPointerDown);
    scene.input.keyboard?.on('keydown', this.onKeyDown);
  }

  /** Scores wherever the marker happens to be. */
  private strike(): void {
    this.resolve(this.qualityAtMarker());
  }

  private qualityAtMarker(): StrikeQuality {
    const distance = Math.abs(this.marker.x - CENTER_X);

    if (distance <= this.perfectHalfWidth) {
      return 'perfect';
    }

    return distance <= this.goodHalfWidth ? 'good' : 'weak';
  }

  private resolve(quality: StrikeQuality): void {
    if (this.resolved || this.destroyed) {
      return;
    }

    this.resolved = true;
    this.sweep?.remove();
    this.sweep = undefined;
    this.detachInput();

    this.verdictText
      .setText(quality === 'perfect' ? 'PERFECT!' : quality === 'good' ? 'Hit!' : 'Glancing...')
      .setColor(quality === 'perfect' ? INK.duel.perfect : quality === 'good' ? INK.duel.prompt : INK.duel.weak)
      .setVisible(true);

    // The verdict is held briefly so the player sees where they landed before the board moves under
    // them. The overlay is torn down *before* onResolve, so the turn's own sparks and damage numbers
    // are not hidden behind a scrim that is about to vanish anyway.
    this.verdictTimer = this.scene.time.delayedCall(ANIMATION.duelVerdict, () => {
      if (this.destroyed) {
        return;
      }

      const { onResolve } = this.options;

      this.destroy();
      onResolve(quality);
    });
  }

  private detachInput(): void {
    this.scene.input.off('pointerdown', this.onPointerDown);
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
  }

  /**
   * Tears the duel down without scoring it. Safe to call at any point, including from inside the
   * verdict delay, and idempotent — GameScene calls it on Escape and again on scene shutdown.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.sweep?.remove();
    this.sweep = undefined;
    this.verdictTimer?.remove();
    this.verdictTimer = undefined;
    this.detachInput();

    for (const object of this.objects) {
      object.destroy();
    }

    this.objects.length = 0;
  }
}
