import Phaser from 'phaser';
import { SPARK_SPRITE, TEXTURE_KEYS, TILE_SPRITES, tileTextureKey } from '../game/sprites';
import type { SpriteDef } from '../game/sprites';

/**
 * Bakes the character-grid sprites in `src/game/sprites.ts` into Phaser textures at runtime.
 *
 * This is the widget half of the pair: `sprites.ts` is pure data and lives in `src/game/`, this file
 * imports Phaser and therefore lives in `src/scenes/` — the same split `theme.ts` and `ui.ts` follow.
 *
 * Textures are baked at 1 px per source pixel and scaled up at display time, so the atlas stays tiny
 * and one texture serves every zoom level.
 */

/**
 * The TextureManager is game-global, and Phaser reuses a single Scene instance across `scene.start()`,
 * so `create()` runs many times over a session while textures persist. Every bake is guarded by
 * `textures.exists` — re-adding a key logs a warning and returns the *old* texture, so without the
 * guard the second run would silently paint from a stale canvas.
 */
function needsBake(scene: Phaser.Scene, key: string): boolean {
  return !scene.textures.exists(key);
}

/**
 * Draws one `SpriteDef` into a canvas texture, one `fillRect` per opaque pixel.
 *
 * Canvas rather than Graphics + `generateTexture` because it is synchronous and exact: Graphics
 * strokes and fills antialias, which would put soft edges on art whose whole point is hard ones.
 */
export function bakeSprite(scene: Phaser.Scene, key: string, def: SpriteDef): void {
  if (!needsBake(scene, key)) {
    return;
  }

  const height = def.rows.length;
  const width = def.rows[0]?.length ?? 0;

  if (width === 0 || height === 0) {
    throw new Error(`Sprite "${key}" is empty.`);
  }

  // A ragged grid would bake without complaint and just render as a clipped sprite, which is a
  // miserable thing to debug by eye. One row miscounted by a character is the likely authoring
  // mistake, so fail loudly and name the row.
  const raggedRow = def.rows.findIndex((row) => row.length !== width);

  if (raggedRow !== -1) {
    throw new Error(
      `Sprite "${key}" row ${raggedRow} is ${def.rows[raggedRow].length} chars, expected ${width}.`
    );
  }

  const texture = scene.textures.createCanvas(key, width, height);

  if (!texture) {
    throw new Error(`Could not create canvas texture for sprite "${key}".`);
  }

  const ctx = texture.getContext();

  def.rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) {
      const char = row[x];

      if (char === '.') {
        continue;
      }

      const colour = def.palette[char];

      if (colour === undefined) {
        throw new Error(`Sprite "${key}" uses "${char}" at ${x},${y} but its palette has no such key.`);
      }

      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  });

  texture.refresh();

  // Per-texture NEAREST, deliberately not `pixelArt: true` in the game config: the global flag also
  // switches Text rendering to nearest-neighbour, which turns the Georgia serif HUD into mush.
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/**
 * Bakes a soft radial halo, used behind the hero so the player can always find themselves on a busy
 * board. Kept apart from `bakeSprite` because it is the one texture that *wants* smooth interpolation
 * — a nearest-filtered gradient shows visible banding rings.
 */
export function bakeGlowTexture(scene: Phaser.Scene, key: string, size: number, colour: string): void {
  if (!needsBake(scene, key)) {
    return;
  }

  const texture = scene.textures.createCanvas(key, size, size);

  if (!texture) {
    throw new Error(`Could not create canvas texture for glow "${key}".`);
  }

  const ctx = texture.getContext();
  const centre = size / 2;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);

  gradient.addColorStop(0, colour);
  gradient.addColorStop(0.55, colour);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/** Diameter of the baked hero halo, in texture pixels. */
const HERO_GLOW_SIZE = 96;
const HERO_GLOW_COLOUR = 'rgba(120, 200, 255, 0.42)';

/**
 * Bakes every texture the game needs. Called at the top of each scene's `create()`; the per-key
 * guards make the repeat calls free.
 */
export function bakeAllSprites(scene: Phaser.Scene): void {
  Object.entries(TILE_SPRITES).forEach(([kind, def]) => {
    bakeSprite(scene, tileTextureKey(kind as keyof typeof TILE_SPRITES), def);
  });

  bakeSprite(scene, TEXTURE_KEYS.spark, SPARK_SPRITE);
  bakeGlowTexture(scene, TEXTURE_KEYS.heroGlow, HERO_GLOW_SIZE, HERO_GLOW_COLOUR);
}
