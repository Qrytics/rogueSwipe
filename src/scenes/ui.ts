import Phaser from 'phaser';
import { ANIMATION, BUTTON, SPACING, TYPOGRAPHY } from '../game/theme';

export type ButtonVariant = keyof typeof BUTTON;

export interface ButtonOptions {
  variant: ButtonVariant;
  fontSize: string;
  /** Defaults to `SPACING.button.md`. */
  padding?: { x: number; y: number };
  depth?: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * Builds a themed text button with the shared press-and-hover feedback both scenes use: the label
 * lightens on hover and dips to 95% scale on press. Callers attach their own `pointerdown` handler
 * for the action — the feedback here is purely visual and never swallows the event.
 *
 * Lives in `src/scenes/` rather than `src/game/` because it imports Phaser.
 */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  options: ButtonOptions
): Phaser.GameObjects.Text {
  const palette = BUTTON[options.variant];
  const padding = options.padding ?? SPACING.button.md;

  const button = scene.add.text(x, y, label, {
    fontFamily: TYPOGRAPHY.family,
    fontSize: options.fontSize,
    color: palette.text,
    backgroundColor: palette.fill,
    align: options.align ?? 'center',
    padding: { left: padding.x, right: padding.x, top: padding.y, bottom: padding.y }
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });

  if (options.depth !== undefined) {
    button.setDepth(options.depth);
  }

  attachButtonFeedback(button, options.variant);

  return button;
}

/** Adds hover and press feedback to an existing text button. */
export function attachButtonFeedback(button: Phaser.GameObjects.Text, variant: ButtonVariant): void {
  const palette = BUTTON[variant];

  button.on('pointerover', () => button.setBackgroundColor(palette.fillHover));
  button.on('pointerout', () => button.setBackgroundColor(palette.fill));

  button.on('pointerdown', () => {
    // Scaled from the button's own resting scale rather than a hard-coded 1, so this still behaves
    // if a caller has scaled the button itself.
    button.scene.tweens.add({
      targets: button,
      scale: ANIMATION.pressScale,
      duration: ANIMATION.press,
      yoyo: true,
      ease: ANIMATION.fadeEase
    });
  });
}

/**
 * Anything with a single overall alpha. `AlphaSingle` rather than `Alpha` on purpose: Rectangle and
 * Container only carry one alpha value, not the four per-corner ones a Text has.
 */
type Fadeable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.AlphaSingle;

/**
 * Fades a set of objects in from transparent with a stagger, in the order given. Used for the pause
 * and end-of-run panels so they arrive as a composed card instead of appearing all at once.
 *
 * Each object fades to whatever alpha the caller already gave it, so a semi-transparent scrim
 * settles at its own opacity instead of going fully opaque.
 */
// `stagger: number` is annotated rather than inferred: ANIMATION is `as const`, so the default would
// narrow the parameter to the literal type 100 and reject every other value.
export function cascadeIn(scene: Phaser.Scene, objects: Fadeable[], stagger: number = ANIMATION.stagger): void {
  objects.forEach((object, index) => {
    const restingAlpha = object.alpha;
    object.setAlpha(0);

    scene.tweens.add({
      targets: object,
      alpha: restingAlpha,
      duration: ANIMATION.slow,
      delay: index * stagger,
      ease: ANIMATION.fadeEase
    });
  });
}
