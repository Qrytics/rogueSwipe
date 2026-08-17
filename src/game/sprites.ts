import type { TileKind } from './types';

/**
 * Pixel-art sprite definitions, stored as character grids.
 *
 * The project ships no binary assets — `audio.ts` synthesizes every sound rather than loading WAVs,
 * and this file is the same idea for graphics. Sprites live in source, so they diff cleanly in a
 * review, need no loader or `preload()` step, and are immune to the `base: '/games/rogueSwipe/'`
 * path prefix that any real asset URL would have to account for. `src/scenes/pixel.ts` bakes these
 * into Phaser textures at runtime.
 *
 * Like `theme.ts`, this file is in `src/game/` and therefore must stay Phaser-free: pure data plus
 * one type-only import.
 */

export interface SpriteDef {
  /**
   * One string per pixel row, every row the same length. Each character indexes `palette`; `.` is
   * transparent. Row 0 is the top.
   */
  rows: readonly string[];
  /** Character → CSS colour. Canvas takes `fillStyle` as a string, so these are not `0x` numbers. */
  palette: Readonly<Record<string, string>>;
}

/**
 * Largest square a tile sprite is allowed to occupy inside the 116 px cell.
 *
 * Sprites are drawn at an integer scale so pixel edges stay crisp: at 100 px a 16×16 sprite renders
 * ×6 (96 px) and a 20×20 one ×5 (100 px). Both land on whole pixels, which is the whole point — a
 * fractional scale reintroduces the blurry half-pixel edges that NEAREST filtering exists to avoid.
 */
export const SPRITE_TARGET_PX = 100;

/** Integer scale factor for a sprite, chosen so it fills as much of `SPRITE_TARGET_PX` as it can. */
export function spriteScale(def: SpriteDef): number {
  return Math.max(1, Math.floor(SPRITE_TARGET_PX / def.rows.length));
}

/** Pixel dimensions a baked sprite texture should be displayed at. */
export function spriteDisplaySize(def: SpriteDef): { width: number; height: number } {
  const scale = spriteScale(def);

  return { width: (def.rows[0]?.length ?? 0) * scale, height: def.rows.length * scale };
}

// ── Palettes ────────────────────────────────────────────────────────────────────
// Shared so the cast reads as one set of creatures rather than seven unrelated doodles: every sprite
// uses the same near-black outline, and the warm/cool split is consistent (heroes and silk cool,
// flesh and embers warm).

const OUTLINE = '#0b1016';

// ── Tile sprites ────────────────────────────────────────────────────────────────

/** Hooded adventurer, sword held upright in the right hand. */
const HERO: SpriteDef = {
  rows: [
    '................',
    '.....kkkkk......',
    '....kcCCCck..m..',
    '....kcfffck..m..',
    '....kfeffefk.m..',
    '....kcfffck..m..',
    '...kkcccckk..m..',
    '..kcCCCCCCckggg.',
    '..kcCbbbbCck.k..',
    '..kcCbbbbCckBkB.',
    '..kkcbbbbckk....',
    '...kcbbbbck.....',
    '...kcCbbCck.....',
    '...kck..kck.....',
    '...kBk..kBk.....',
    '...kk....kk.....'
  ],
  palette: {
    k: OUTLINE,
    c: '#3f6f9e',
    C: '#6fa8dc',
    b: '#2b4a66',
    f: '#e8c9a0',
    e: '#16232f',
    m: '#dfe7f0',
    g: '#c8a24a',
    B: '#8a5a2b'
  }
};

/** Squat green brute: tall ears, red eyes, notched cleaver. */
const GOBLIN: SpriteDef = {
  rows: [
    '................',
    '..k..........k..',
    '..kk.kkkkk..kk..',
    '.kgkkgGGGgkkkgk.',
    '.kggkgGGGGgkggk.',
    '..kkkgeGGegkkk..',
    '....kgGGGGgk....',
    '....kgtttgk.mmm.',
    '...kdgggggdk.mmm',
    '..kdgggggggdk.w.',
    '..kdggGGGggdk.w.',
    '..kkdgggggdkk.w.',
    '....kdgggdk.....',
    '...kdk.k.kdk....',
    '...kkk...kkk....',
    '................'
  ],
  palette: {
    k: OUTLINE,
    g: '#5f8f34',
    G: '#8dc254',
    d: '#39561f',
    e: '#d8352c',
    t: '#f2ecd8',
    m: '#c9ced8',
    w: '#6b4a2a'
  }
};

/** Eight legs off the thorax, two red eye clusters, bulbous marked abdomen. */
const SPIDER: SpriteDef = {
  rows: [
    '................',
    '..k..........k..',
    '...k........k...',
    '.k..k.kkkk.k..k.',
    '..k.kksssskk.k..',
    '...kksesseskk...',
    '..k.kksssskk.k..',
    '.k...kksskk...k.',
    '..k...kssk...k..',
    '....kkSSSSkk....',
    '...kSSSSSSSSk...',
    '..kSSdSSSSdSSk..',
    '..kSSSdSSdSSSk..',
    '...kSSSSSSSSk...',
    '....kkSSSSkk....',
    '......kkkk......'
  ],
  palette: {
    k: OUTLINE,
    s: '#4a4162',
    S: '#6d6090',
    d: '#2b2440',
    e: '#ff4d4d'
  }
};

/** Chipped boulder, lit from the top-left. */
const ROCK: SpriteDef = {
  rows: [
    '................',
    '................',
    '.....kkkkk......',
    '....kRRRRRkk....',
    '...kRRRRRRRRk...',
    '..kRRRrrrrRRRk..',
    '..kRRrrrrrrrrk..',
    '.kRRrrrrrdrrrrk.',
    '.kRrrrrrddrrrrk.',
    '.krrrrrdddrrrrk.',
    '.krrrrdddrrdrrk.',
    '..krrrddrrrddk..',
    '..kddrdddrddk...',
    '...kdddddddkk...',
    '....kkkkkkkk....',
    '................'
  ],
  palette: {
    k: OUTLINE,
    r: '#8f959f',
    R: '#c3c8d0',
    d: '#5a616c'
  }
};

/**
 * Radial strands. Mostly transparent by design: the web is the one tile the hero can stand on the
 * far side of, so it reads as something lying *on* the floor rather than a block occupying the cell.
 */
const WEB: SpriteDef = {
  rows: [
    'w......ww......w',
    '.w.....ww.....w.',
    '..w....ww....w..',
    '...w.wwwwww.w...',
    '....w..ww..w....',
    '.....w.ww.w.....',
    '......wwww......',
    'dddddddwwddddddd',
    'dddddddwwddddddd',
    '......wwww......',
    '.....w.ww.w.....',
    '....w..ww..w....',
    '...w.wwwwww.w...',
    '..w....ww....w..',
    '.w.....ww.....w.',
    'w......ww......w'
  ],
  palette: {
    w: '#e6e6ee',
    d: '#9d9daa'
  }
};

/** Three stacked coins with a specular glint on each. */
const GOLD: SpriteDef = {
  rows: [
    '................',
    '................',
    '................',
    '.....kkkkk......',
    '....kYYwYYk.....',
    '...kYYYwYYYk....',
    '...kyyYYYyyk....',
    '....kddddkk.....',
    '..kkYYwYYYYkk...',
    '.kYYYYwYYYYYYk..',
    '.kyyYYYYYYYyyk..',
    '..kddddddddddk..',
    '.kkYYYYwYYYYYkk.',
    'kYYYYYYYYYYYYYYk',
    'kyyYYYYYYYYYyyk.',
    '.kkddddddddddkk.'
  ],
  palette: {
    k: OUTLINE,
    y: '#c99a24',
    Y: '#f0cd5f',
    w: '#fff6c8',
    d: '#8f6a15'
  }
};

/** The Stone-Weaver: a wide stone-plated spider-golem with four ember eyes and silk at its feet. */
const BOSS: SpriteDef = {
  rows: [
    'k..................k',
    '.k................k.',
    'k.k..............k.k',
    '.k.k............k.k.',
    '..k.k...kkkk...k.k..',
    'k..k.k.kSSSSk.k.k..k',
    '.k..k.kSSSSSSk.k..k.',
    '..k..kkSeSSeSkk..k..',
    '...k.kSSSSSSSSk.k...',
    '..k..kSdSSSSdSk..k..',
    '.k..kkSSSSSSSSkk..k.',
    'k..kkSSeSSSSeSSkk..k',
    '..kkSSSSSSSSSSSSkk..',
    '.kkSSSdSSSSSSdSSSkk.',
    'kkSSSSSdddddSSSSSSkk',
    'kSSSSSSSdddddSSSSSSk',
    'kSSsSSSSSdddSSSSsSSk',
    '.kSSsSSSSSSSSSSsSSk.',
    '..kkSSsSSSSSSsSSkk..',
    '...kkkkvvvvvvkkkk...'
  ],
  palette: {
    k: OUTLINE,
    s: '#5d5348',
    S: '#94856f',
    d: '#39312a',
    e: '#ff6a3a',
    v: '#c9a6ff'
  }
};

/** Arched stairway down: cut stone frame, descending steps, a warm glow from below. */
const DOOR: SpriteDef = {
  rows: [
    '.....kkkkkkkkkk.....',
    '....kSSSSSsssssk....',
    '...kSSkkkkkkkkssk...',
    '..kSSkddddddddkssk..',
    '..kSSkddddddddkssk..',
    '.kSSSkdddddddddkssk.',
    '.kSSSkdddddddddkssk.',
    '.kSSSkdddddddddkssk.',
    '.kSSSkdddddddddkssk.',
    '.kSSSkdddvvvdddkssk.',
    '.kSSSkddvvvvvddkssk.',
    '.kSSSkdDDDDDDDdkssk.',
    '.kSSSkkDDDDDDDkkssk.',
    '.kSSSkdDDDDDDDdkssk.',
    '.kSSSkkDDDDDDDkkssk.',
    '.kSSSkdDDDDDDDdkssk.',
    '.kSSSkkDDDDDDDkkssk.',
    '.kSSSkdDDDDDDDdkssk.',
    '.kSSSkkkkkkkkkkkssk.',
    '.kkkkkkkkkkkkkkkkkk.'
  ],
  palette: {
    k: OUTLINE,
    s: '#6f6455',
    S: '#a2947f',
    d: '#231f1a',
    D: '#463e33',
    v: '#ffd98a'
  }
};

/**
 * Every tile kind's sprite. `satisfies Record<TileKind, SpriteDef>` is load-bearing: adding a kind to
 * `TileKind` fails the build here until it has art, the same guard `COLORS.tile` provides for colour.
 */
export const TILE_SPRITES = {
  hero: HERO,
  goblin: GOBLIN,
  spider: SPIDER,
  rock: ROCK,
  web: WEB,
  gold: GOLD,
  boss: BOSS,
  door: DOOR
} satisfies Record<TileKind, SpriteDef>;

// ── Decoration ──────────────────────────────────────────────────────────────────

/** Single impact mote, flung outward in a ring by `playHitSpark`. */
export const SPARK_SPRITE: SpriteDef = {
  rows: [
    '..w..',
    '.www.',
    'wwwww',
    '.www.',
    '..w..'
  ],
  palette: { w: '#ffffff' }
};

export const TEXTURE_KEYS = {
  /** Prefix for baked tile sprites; the full key is `tile-${kind}`. */
  tile: 'tile',
  spark: 'fx-spark',
  /** Soft radial halo drawn under the hero so the player never loses track of themselves. */
  heroGlow: 'fx-hero-glow'
} as const;

export function tileTextureKey(kind: TileKind): string {
  return `${TEXTURE_KEYS.tile}-${kind}`;
}
