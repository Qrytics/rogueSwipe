import type { TileKind } from './types';

/**
 * Central design system. Every colour, spacing step, font size and animation timing the scenes use
 * lives here — the scenes must not contain raw hex literals or magic pixel gaps.
 *
 * Two colour vocabularies, because Phaser needs both and they are not interchangeable:
 *   - `COLORS` holds numeric `0xrrggbb` values, for Graphics, Rectangle and `setStrokeStyle`.
 *   - `INK` holds CSS strings, for `Text` styles.
 * A colour that appears in both vocabularies is written out twice on purpose; there is no runtime
 * conversion, so the pair has to be kept in step by hand.
 *
 * This file lives in `src/game/` and therefore must stay Phaser-free: pure data only, no imports
 * beyond the shared types.
 */

interface TileColors {
  fill: number;
  stroke: number;
  accent: number;
}

/**
 * One dungeon layer's look. Five of these are what make the Quest's five floors feel like five places
 * rather than the same board painted once — the floor, the cell rims, the HUD accent and the descent
 * banner all read from the active layer's entry.
 */
interface LayerTheme {
  /** The two flagstone tones a floor cell alternates between, chosen per cell by seeded RNG. */
  floor: number;
  floorAlt: number;
  /** Mortar lines between flagstones. */
  grout: number;
  /** Stone frame around the grid. */
  wall: number;
  /** Layer signature colour: cell rims and the frame edge. */
  accent: number;
  /**
   * The same colour as `accent`, as a CSS string, for the descent banner's `Text`. Written out twice
   * by hand for the reason given at the top of this file — Phaser wants two types for one idea and
   * there is no runtime conversion anywhere in the project.
   */
  accentInk: string;
  /** Vignette drawn over the floor's outer edge. */
  fog: number;
}

export const COLORS = {
  background: {
    primary: 0x08131c,
    overlay: 0x000000,
    panel: 0xd7def0,
    /** Empty board cell, tinted green so the grid reads as a dungeon floor. */
    boardCell: 0x1f4d2c
  },
  /**
   * Per-kind tile palette. Keyed by TileKind so a new kind fails the build until it is styled.
   *
   * These are **cell** colours, not creature colours — the creature is a baked sprite now, and its own
   * palette lives in `sprites.ts`. So `fill` is a dark recessed plinth carrying just a hint of the
   * occupant's hue, `stroke` is the rim that separates it from the floor, and `accent` tints the
   * kind's hit sparks and HP bar. Bright per-kind fills used to *be* the art; against a sprite they
   * only fight it for attention.
   */
  tile: {
    hero: { fill: 0x1b2f45, stroke: 0x7fb2e8, accent: 0xbcdcff },
    goblin: { fill: 0x2c3320, stroke: 0x8dc254, accent: 0xb6e87a },
    spider: { fill: 0x261f33, stroke: 0x8b7cc0, accent: 0xff6b6b },
    rock: { fill: 0x2b2f36, stroke: 0x8f959f, accent: 0xd6dae2 },
    web: { fill: 0x24262e, stroke: 0x6a6a78, accent: 0xf0f0f8 },
    gold: { fill: 0x38300f, stroke: 0xe0bd4d, accent: 0xfff0a8 },
    boss: { fill: 0x2f2a20, stroke: 0xc9a068, accent: 0xff8a4a },
    door: { fill: 0x1d1a15, stroke: 0xffd98a, accent: 0xffe6b0 }
  } satisfies Record<TileKind, TileColors>,
  /** Shared cell chrome, drawn the same way for every kind. */
  cell: {
    /** 2px inner highlight along the top and left edges, so the plinth reads as raised. */
    bevel: 0xffffff,
    /** Dark pill behind the HP number in the cell's bottom-right corner. */
    hpPill: 0x0b1016,
    /** Depleted portion of an enemy's HP bar. */
    hpBarTrack: 0x2a1616,
    hpBarFill: 0xe25555
  },
  /** Flash colour a tile turns to for a beat as it dies. */
  tileDeathFlash: 0xffffff,
  /** The Undertale-style timing bar. */
  duel: {
    scrim: 0x05090e,
    trackFill: 0x11161f,
    trackStroke: 0x64748b,
    /** Wide outer band — a normal hit. */
    good: 0xd8a13c,
    /** Narrow centre band — double damage. */
    perfect: 0x54d97a,
    marker: 0xffffff,
    /** Marker colour once the sweep is on its final pass and about to time out. */
    markerUrgent: 0xff8f6a
  },
  progress: {
    border: 0x4f667d,
    fillRun: 0x7ec8ff,
    capRun: 0xc9e3ff,
    fillBoss: 0xff8080,
    capBoss: 0xffc0c0
  },
  telegraph: {
    warning: 0xffc46a,
    imminent: 0xff6a6a
  },
  menuPanel: {
    fill: 0xd8e4f7,
    fillHover: 0xe9f1ff,
    stroke: 0x6f84a1
  },
  /**
   * Modal panels (pause, quit confirm, end of run), drawn by `createPanel`. `background.panel` is the
   * same colour and stays for the plain `add.rectangle` sites that have not been converted.
   */
  panel: {
    fill: 0xd7def0,
    stroke: 0x8fa2bd,
    /** Offset plate behind the panel, so a modal lifts off the board instead of sitting flush on it. */
    shadow: 0x03080f
  },
  /** Thin ring around the hero's cell, over the baked halo. */
  heroRing: 0xe8f2ff
} as const;

/**
 * The five Quest layers, in descent order. Indexed by `board.layer - 1`; `layerTheme()` clamps, so a
 * bossless mode sitting on layer 1 forever and a hypothetical sixth layer both stay in range.
 *
 * Colours only — each layer's *name* is game content and lives in `engine.ts` as `LAYER_NAMES`, so the
 * string exists once rather than in two files that can drift apart.
 */
export const LAYER_THEMES = [
  {
    floor: 0x1f4d2c,
    floorAlt: 0x1a4126,
    grout: 0x122c1a,
    wall: 0x2f4636,
    accent: 0x8fe0a8,
    accentInk: '#8fe0a8',
    fog: 0x05130a
  },
  {
    floor: 0x53431f,
    floorAlt: 0x47391a,
    grout: 0x2c2410,
    wall: 0x554832,
    accent: 0xe8c46a,
    accentInk: '#e8c46a',
    fog: 0x140e04
  },
  {
    floor: 0x1e3b57,
    floorAlt: 0x19314a,
    grout: 0x10202f,
    wall: 0x2e4459,
    accent: 0x7fc8ff,
    accentInk: '#7fc8ff',
    fog: 0x040d16
  },
  {
    floor: 0x4a2320,
    floorAlt: 0x3d1d1a,
    grout: 0x24100e,
    wall: 0x4a2f2a,
    accent: 0xff8a5c,
    accentInk: '#ff8a5c',
    fog: 0x150403
  },
  {
    floor: 0x33234d,
    floorAlt: 0x2b1d42,
    grout: 0x1a1029,
    wall: 0x40315c,
    accent: 0xc9a6ff,
    accentInk: '#c9a6ff',
    fog: 0x0c0416
  }
] as const satisfies readonly LayerTheme[];

/** The theme for a 1-based layer number, clamped to the table. */
export function layerTheme(layer: number): LayerTheme {
  const index = Math.min(LAYER_THEMES.length - 1, Math.max(0, layer - 1));

  return LAYER_THEMES[index];
}

export const INK = {
  /** On the dark background. */
  title: '#f2f6ff',
  body: '#dce5f4',
  bodyBright: '#e7eefc',
  muted: '#b4c4d9',
  subtle: '#9fb2c8',
  faint: '#8aa0b9',
  fainter: '#67809a',
  danger: '#ff9d9d',
  notice: '#cfd8e6',
  /** On a light panel. */
  onPanel: {
    title: '#16202d',
    body: '#243447',
    muted: '#314356',
    accent: '#1a3a50',
    victory: '#1a4a1f',
    defeat: '#4a1a1a'
  },
  /** On a tile's own fill colour. */
  onTile: {
    label: '#0d1621',
    hp: '#ffffff',
    outline: '#000000'
  },
  status: {
    ok: '#9fe7b4',
    warn: '#e7c79f'
  },
  /** Floating damage numbers. Keyed by StrikeQuality so the number itself reports the timing. */
  damage: {
    perfect: '#ffe08a',
    good: '#ffffff',
    weak: '#9fb2c8',
    /** Damage the hero *takes*, floated over the hero's own cell. */
    taken: '#ff9d9d'
  },
  /** Duel overlay text. */
  duel: {
    prompt: '#f2f6ff',
    hint: '#9fb2c8',
    perfect: '#8ff0a8',
    weak: '#c9a6a6'
  }
} as const;

/**
 * Button palettes. `text` is a CSS string (it styles a `Text`), while `fill`/`fillHover`/`stroke` are
 * numbers: buttons are drawn by a `Graphics` inside a Container now, not by a `Text` with a CSS
 * `backgroundColor`. That swap is the only reason a button can have rounded corners and a border.
 */
export const BUTTON = {
  success: { text: '#174a28', fill: 0xbfe0cf, fillHover: 0xd3ecdf, stroke: 0x6f9e83 },
  danger: { text: '#4a1717', fill: 0xe0bfbf, fillHover: 0xefd6d6, stroke: 0xa87878 },
  neutral: { text: '#16202d', fill: 0xd8e4f7, fillHover: 0xe9f1ff, stroke: 0x8298b6 },
  spell: { text: '#143b1f', fill: 0xc7e3d1, fillHover: 0xd9efe1, stroke: 0x76a487 }
} as const;

/** Alpha values that carry meaning, rather than being a one-off fade. */
export const ALPHA = {
  boardCell: 0.75,
  pauseOverlay: 0.65,
  endOverlay: 0.72,
  /** Resting opacity of the boss attack line. Raised from 0.45 — the old value was easy to miss. */
  telegraph: 0.78,
  /** Floor of the telegraph pulse once the strike is one turn away. */
  telegraphPulseMin: 0.45,
  /** Dim behind the duel's timing bar — enough to focus on the bar, light enough to still read the board. */
  duelScrim: 0.7,
  /** Vignette over the floor's outer edge, so the dungeon fades into the dark rather than stopping. */
  vignette: 0.55,
  /** Baked halo under the hero. */
  heroGlow: 0.9,
  /** A stairway tile's pulsing glow, at its dimmest. */
  doorPulseMin: 0.55,
  /** Inner top-left highlight that makes a raised surface read as raised. */
  cellBevel: 0.14,
  /** Layer-accent rim around an occupied cell. Full strength would out-shout the sprite inside it. */
  cellRim: 0.55,
  /** Accent line along the dungeon's stone frame. */
  frameAccent: 0.35,
  /** Dark pill behind a tile's HP number. */
  hpPill: 0.72,
  buttonBevel: 0.24,
  panelBevel: 0.5,
  panelShadow: 0.45,
  disabled: 0.45
} as const;

export const SPACING = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  button: {
    sm: { x: 16, y: 8 },
    md: { x: 18, y: 12 },
    lg: { x: 28, y: 14 }
  }
} as const;

export const TYPOGRAPHY = {
  family: 'Georgia, serif',
  size: {
    xs: '14px',
    sm: '16px',
    base: '18px',
    md: '20px',
    lg: '22px',
    xl: '24px',
    xxl: '28px',
    display: '34px',
    hero: '48px',
    huge: '52px',
    giant: '56px'
  },
  /**
   * Outline weights. `bold` is 4px, down from the 8px the titles used to carry — at that weight the
   * serif strokes merged into each other and read as a cheap drop-shadow.
   */
  stroke: {
    none: 0,
    light: 2,
    normal: 3,
    bold: 4
  }
} as const;

export const ANIMATION = {
  /** Hero step between cells. Short enough that holding a direction key still feels immediate. */
  fast: 80,
  /** Tile spawn / death. */
  normal: 150,
  /** Overlay fades. */
  slow: 300,
  /** Button press dip. */
  press: 50,
  pressScale: 0.95,
  /** Progress bar catching up to its new value. */
  progress: 200,
  /** One half-cycle of the boss telegraph pulse. */
  telegraphPulse: 300,
  /** Hero pop on level up. */
  levelFlash: 200,
  levelFlashScale: 1.15,
  /** Delay between cascading elements of the end-state panel. */
  stagger: 100,
  /** Per-cell delay of the opening board cascade. */
  boardCascade: 14,
  /**
   * Resting animation of every tile sprite: a slow vertical float, yoyoed forever. Each view's tween
   * is delayed by `(gridX + gridY) * bobStagger` so the board breathes in a diagonal wave instead of
   * pulsing in unison, which reads as a rendering glitch.
   */
  bob: 1400,
  bobDistance: 3,
  bobStagger: 90,
  /** White `setTintFill` flash on a sprite that just got hit. Short — any longer looks like a bug. */
  hitFlash: 70,
  /** Spark motes flying outward from an impact. */
  spark: 320,
  sparkDistance: 46,
  /** Floating damage number: rise and fade. */
  damageFloat: 620,
  damageRise: 46,
  /** Camera shake on hero damage, and the harder one for a boss weave. */
  shake: 120,
  shakeIntensity: 0.006,
  shakeHeavy: 220,
  shakeHeavyIntensity: 0.012,
  /** One pass of the duel marker across the track. Two passes (yoyo) before it times out. */
  duelSweep: 520,
  /** How long the duel's result verdict stays on screen before the turn resolves. */
  duelVerdict: 260,
  /** Layer banner: slide in, hold, slide out. */
  bannerIn: 420,
  bannerHold: 900,
  spawnEase: 'Back.easeOut',
  moveEase: 'Cubic.easeOut',
  fadeEase: 'Quad.easeOut',
  pulseEase: 'Sine.easeInOut'
} as const;
