import Phaser from 'phaser';
import { ALPHA, ANIMATION, BUTTON, COLORS, SPACING, TYPOGRAPHY } from '../game/theme';

export type ButtonVariant = keyof typeof BUTTON;

export interface ButtonOptions {
  variant: ButtonVariant;
  fontSize: string;
  /** Defaults to `SPACING.button.md`. */
  padding?: { x: number; y: number };
  depth?: number;
  align?: 'left' | 'center' | 'right';
}

const BUTTON_RADIUS = 10;
const BUTTON_BORDER = 3;
/** Height of the bevel highlight, as a fraction of the button's own height. */
const BUTTON_BEVEL_FRACTION = 0.42;

const PANEL_RADIUS = 18;
const PANEL_BORDER = 4;
const PANEL_SHADOW_OFFSET = 10;
const PANEL_BEVEL_INSET = 8;

/**
 * A themed button: a rounded `Graphics` plate with a `Text` label, wrapped in a Container.
 *
 * It used to be a bare `Text` with a CSS `backgroundColor`, which is why `BUTTON` fills were CSS
 * strings. That could only ever be a hard-edged rectangle — no radius, no border, no bevel — and it
 * was the least finished-looking thing on screen. A Container costs one extra object per button and
 * buys all three.
 *
 * Being a Container, it keeps the GameObject surface the call sites already use (`on`, `setAlpha`,
 * `setDepth`, and `cascadeIn`'s `AlphaSingle`). The two things a `Text` gave away for free need
 * methods here instead: `setLabel` (which must re-measure and re-lay-out) and `setEnabled` (which
 * must rebuild the hit area, since a Container has no implicit one).
 */
export class UIButton extends Phaser.GameObjects.Container {
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly variant: ButtonVariant;
  private readonly labelPadding: { x: number; y: number };
  private hovered = false;

  constructor(scene: Phaser.Scene, x: number, y: number, label: string, options: ButtonOptions) {
    super(scene, x, y);

    this.variant = options.variant;
    this.labelPadding = options.padding ?? SPACING.button.md;

    // `scene.add.*` then `Container.add` — the container re-parents them off the display list. Same
    // pattern MenuScene's mode panels already use.
    this.plate = scene.add.graphics();
    this.labelText = scene.add.text(0, 0, label, {
      fontFamily: TYPOGRAPHY.family,
      fontSize: options.fontSize,
      color: BUTTON[options.variant].text,
      align: options.align ?? 'center'
    }).setOrigin(0.5);

    this.add([this.plate, this.labelText]);
    scene.add.existing(this);

    if (options.depth !== undefined) {
      this.setDepth(options.depth);
    }

    this.layout();
    this.setEnabled(true);

    this.on('pointerover', () => {
      this.hovered = true;
      this.draw();
    });

    this.on('pointerout', () => {
      this.hovered = false;
      this.draw();
    });

    this.on('pointerdown', () => {
      // Scaled from the button's own resting scale rather than a hard-coded 1, so this still behaves
      // if a caller has scaled the button itself.
      this.scene.tweens.add({
        targets: this,
        scale: ANIMATION.pressScale,
        duration: ANIMATION.press,
        yoyo: true,
        ease: ANIMATION.fadeEase
      });
    });
  }

  /** Replaces the label and re-fits the plate around it. */
  setLabel(value: string): this {
    this.labelText.setText(value);
    this.layout();

    return this;
  }

  /**
   * Toggles input. Re-enabling has to rebuild the hit area rather than call `setInteractive({...})`
   * bare: a Container's default hit rect is anchored at its top-left, but its children are laid out
   * around its centre, so the default rect would sit down and to the right of the visible button.
   */
  setEnabled(enabled: boolean): this {
    if (enabled) {
      this.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-this.width / 2, -this.height / 2, this.width, this.height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true
      });
    } else {
      this.hovered = false;
      this.disableInteractive();
      this.draw();
    }

    return this;
  }

  private layout(): void {
    this.setSize(
      Math.ceil(this.labelText.width + this.labelPadding.x * 2),
      Math.ceil(this.labelText.height + this.labelPadding.y * 2)
    );

    const hitArea = this.input?.hitArea as Phaser.Geom.Rectangle | undefined;

    hitArea?.setTo(-this.width / 2, -this.height / 2, this.width, this.height);
    this.draw();
  }

  private draw(): void {
    const palette = BUTTON[this.variant];
    const left = -this.width / 2;
    const top = -this.height / 2;

    this.plate.clear();
    this.plate.fillStyle(this.hovered ? palette.fillHover : palette.fill, 1);
    this.plate.fillRoundedRect(left, top, this.width, this.height, BUTTON_RADIUS);
    this.plate.fillStyle(COLORS.cell.bevel, ALPHA.buttonBevel);
    this.plate.fillRoundedRect(
      left + BUTTON_BORDER,
      top + BUTTON_BORDER,
      this.width - BUTTON_BORDER * 2,
      this.height * BUTTON_BEVEL_FRACTION,
      BUTTON_RADIUS - 2
    );
    this.plate.lineStyle(BUTTON_BORDER, palette.stroke, 1);
    this.plate.strokeRoundedRect(left, top, this.width, this.height, BUTTON_RADIUS);
  }
}

/**
 * Builds a themed button with the shared press-and-hover feedback both scenes use: the plate lightens
 * on hover and the whole button dips to 95% scale on press. Callers attach their own `pointerdown`
 * handler for the action — the feedback here is purely visual and never swallows the event.
 *
 * Lives in `src/scenes/` rather than `src/game/` because it imports Phaser.
 */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  options: ButtonOptions
): UIButton {
  return new UIButton(scene, x, y, label, options);
}

/**
 * A rounded modal panel with a drop shadow and an inner top highlight, drawn around (x, y).
 *
 * Replaces six separate `add.rectangle` calls across the pause, quit-confirm, end-of-run and menu
 * overlays. Returns the `Graphics` itself, which satisfies `cascadeIn`'s `AlphaSingle` requirement.
 *
 * `fill` overrides the panel colour. A `Graphics` cannot be recoloured after the fact the way a
 * `Rectangle` can, so a caller that needs a hover state draws a second panel in the hover colour and
 * toggles its visibility — see MenuScene's mode cards.
 */
export function createPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  depth?: number,
  fill: number = COLORS.panel.fill
): Phaser.GameObjects.Graphics {
  const panel = scene.add.graphics({ x, y });
  const left = -width / 2;
  const top = -height / 2;

  panel.fillStyle(COLORS.panel.shadow, ALPHA.panelShadow);
  panel.fillRoundedRect(left + PANEL_SHADOW_OFFSET, top + PANEL_SHADOW_OFFSET, width, height, PANEL_RADIUS);
  panel.fillStyle(fill, 1);
  panel.fillRoundedRect(left, top, width, height, PANEL_RADIUS);
  panel.lineStyle(2, COLORS.cell.bevel, ALPHA.panelBevel);
  panel.strokeRoundedRect(
    left + PANEL_BEVEL_INSET,
    top + PANEL_BEVEL_INSET,
    width - PANEL_BEVEL_INSET * 2,
    height - PANEL_BEVEL_INSET * 2,
    PANEL_RADIUS - 4
  );
  panel.lineStyle(PANEL_BORDER, COLORS.panel.stroke, 1);
  panel.strokeRoundedRect(left, top, width, height, PANEL_RADIUS);

  if (depth !== undefined) {
    panel.setDepth(depth);
  }

  return panel;
}

/**
 * Anything with a single overall alpha. `AlphaSingle` rather than `Alpha` on purpose: Rectangle,
 * Graphics and Container only carry one alpha value, not the four per-corner ones a Text has.
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
