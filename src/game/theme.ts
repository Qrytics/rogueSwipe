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
  icon: number;
}

export const COLORS = {
  background: {
    primary: 0x08131c,
    overlay: 0x000000,
    panel: 0xd7def0,
    /** Empty board cell, tinted green so the grid reads as a dungeon floor. */
    boardCell: 0x1f4d2c
  },
  /** Per-kind tile palette. Keyed by TileKind so a new kind fails the build until it is styled. */
  tile: {
    hero: { fill: 0xb6d6ff, stroke: 0xffffff, icon: 0x1f4d8d },
    goblin: { fill: 0xb55f5f, stroke: 0xffb3b3, icon: 0x4d0f0f },
    spider: { fill: 0x5e5479, stroke: 0xff7979, icon: 0x20192e },
    rock: { fill: 0xbfc2ca, stroke: 0xffffff, icon: 0x69707c },
    web: { fill: 0x7f7f7f, stroke: 0xdedede, icon: 0xffffff },
    gold: { fill: 0xecc74a, stroke: 0xfff2b0, icon: 0xffd74a },
    boss: { fill: 0x8f5b5b, stroke: 0xffd2d2, icon: 0x421111 }
  } satisfies Record<TileKind, TileColors>,
  /** Extra ring drawn outside the hero tile so the player never loses track of themselves. */
  heroRing: 0xe8f2ff,
  /** Flash colour a tile turns to for a beat as it dies. */
  tileDeathFlash: 0xffffff,
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
  }
} as const;

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
  }
} as const;

/**
 * Button palettes. `fill`/`fillHover` are CSS strings because Phaser `Text` takes its
 * `backgroundColor` as CSS, not as a number.
 */
export const BUTTON = {
  success: { text: '#174a28', fill: '#bfe0cf', fillHover: '#d3ecdf' },
  danger: { text: '#4a1717', fill: '#e0bfbf', fillHover: '#efd6d6' },
  neutral: { text: '#16202d', fill: '#d8e4f7', fillHover: '#e9f1ff' },
  spell: { text: '#143b1f', fill: '#c7e3d1', fillHover: '#d9efe1' }
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
  spawnEase: 'Back.easeOut',
  moveEase: 'Cubic.easeOut',
  fadeEase: 'Quad.easeOut',
  pulseEase: 'Sine.easeInOut'
} as const;
