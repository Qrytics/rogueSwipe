import Phaser from 'phaser';
import { dailySeed } from '../game/random';
import { loadActiveRun, loadMetaProgress } from '../game/persistence';
import type { GameMode, RunConfig } from '../game/types';

const MENU_WIDTH = 768;
const MENU_HEIGHT = 1365;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create(): void {
    const meta = loadMetaProgress();
    const activeRun = loadActiveRun();

    this.cameras.main.setBackgroundColor('#08131c');

    this.add.text(MENU_WIDTH / 2, 90, 'Rogue Swipe', {
      fontFamily: 'Georgia, serif',
      fontSize: '56px',
      color: '#f2f6ff',
      stroke: '#000000',
      strokeThickness: 8
    }).setOrigin(0.5);

    this.add.text(MENU_WIDTH / 2, 160, 'Slide through the board, survive the run, and chase the leaderboard.', {
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      color: '#b4c4d9',
      align: 'center',
      wordWrap: { width: 560 }
    }).setOrigin(0.5);

    this.add.text(MENU_WIDTH / 2, 210, `Vault Gold ${meta.bankedGold}   Best Run ${meta.bestTurnsSurvived} turns`, {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#d8e4f7'
    }).setOrigin(0.5);

    if (activeRun) {
      const resumeButton = this.add.text(MENU_WIDTH / 2, 252, `Resume ${activeRun.runConfig.title}  Turn ${activeRun.board.turn}`, {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#18311f',
        backgroundColor: '#c7e3d1',
        padding: { left: 18, right: 18, top: 12, bottom: 12 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      resumeButton.on('pointerdown', () => {
        this.scene.start('GameScene', { resumeRun: activeRun });
      });
    }

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
        seed: `daily:${dailySeed()}`,
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

    const panelTop = 280;

    options.forEach((option, index) => {
      const y = panelTop + index * 220;
      const background = this.add.rectangle(MENU_WIDTH / 2, y, 610, 170, 0xd8e4f7, 1).setStrokeStyle(4, 0x6f84a1, 1);
      const title = this.add.text(MENU_WIDTH / 2, y - 32, option.title, {
        fontFamily: 'Georgia, serif',
        fontSize: '34px',
        color: '#15202d'
      }).setOrigin(0.5);
      const subtitle = this.add.text(MENU_WIDTH / 2, y + 18, option.subtitle, {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#314356',
        align: 'center',
        wordWrap: { width: 500 }
      }).setOrigin(0.5);
      const buttonLabel = this.add.text(MENU_WIDTH / 2, y + 64, 'Tap to play', {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#234a2d'
      }).setOrigin(0.5);

      const hitArea = this.add.zone(MENU_WIDTH / 2, y, 610, 170).setInteractive({ useHandCursor: true });
      hitArea.on('pointerdown', () => {
        this.scene.start('GameScene', {
          runConfig: option as RunConfig,
          metaProgress: meta
        });
      });

      hitArea.on('pointerover', () => {
        background.setFillStyle(0xe9f1ff, 1);
        title.setColor('#0f1720');
        subtitle.setColor('#203041');
        buttonLabel.setColor('#1d6b35');
      });

      hitArea.on('pointerout', () => {
        background.setFillStyle(0xd8e4f7, 1);
        title.setColor('#15202d');
        subtitle.setColor('#314356');
        buttonLabel.setColor('#234a2d');
      });
    });

    this.add.text(MENU_WIDTH / 2, MENU_HEIGHT - 110, 'Swipe in-game. The menu is just the first board.', {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#8aa0b9'
    }).setOrigin(0.5);
  }
}