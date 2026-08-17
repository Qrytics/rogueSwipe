import Phaser from 'phaser';
import './styles.css';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#08131c',
  /**
   * Keeps sprites on whole pixels mid-tween, so the pixel-art grid does not shimmer as the hero
   * slides between cells.
   *
   * Deliberately *not* `pixelArt: true`: that flag would also force nearest-neighbour filtering on
   * Text, and the Georgia serif HUD looks chewed under it. `pixel.ts` sets NEAREST per texture
   * instead, so only the art that wants hard edges gets them.
   */
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 768,
    height: 1365
  },
  scene: [MenuScene, GameScene]
};

new Phaser.Game(config);