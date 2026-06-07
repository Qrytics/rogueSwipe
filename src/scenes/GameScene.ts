import Phaser from 'phaser';
import { createInitialBoard, slideBoard } from '../game/engine';
import { dailySeed } from '../game/random';
import type { Direction, RunConfig, Tile } from '../game/types';

const BOARD_SIZE = 5;
const BOARD_LEFT = 84;
const BOARD_TOP = 420;
const CELL_SIZE = 116;
const CELL_GAP = 6;

export class GameScene extends Phaser.Scene {
  private board = createInitialBoard(dailySeed());
  private runConfig: RunConfig = {
    mode: 'daily',
    seed: dailySeed(),
    progressTarget: 100,
    progressPerTurn: 8,
    spawnsPerTurn: 1,
    bossHp: 12,
    title: 'Daily Run',
    subtitle: 'Generated from the current date.'
  };
  private tileGraphics!: Phaser.GameObjects.Graphics;
  private uiText!: Phaser.GameObjects.Text;
  private tileTexts: Phaser.GameObjects.Text[] = [];
  private endOverlayShown = false;
  private swipeStart: { x: number; y: number } | null = null;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const config = this.data.get('runConfig') as RunConfig | undefined;

    if (config) {
      this.runConfig = config;
      this.board = createInitialBoard(config.seed, config.mode);
      this.board.maxProgress = config.progressTarget;
      this.board.seed = config.seed;
      this.board.progressPerTurn = config.progressPerTurn;
      this.board.spawnsPerTurn = config.spawnsPerTurn;
      this.board.mode = config.mode;
      this.board.bossMaxHp = config.bossHp;
    }

    this.cameras.main.setBackgroundColor('#08131c');
    this.tileGraphics = this.add.graphics();

    this.add.text(384, 80, this.runConfig.title, {
      fontFamily: 'Georgia, serif',
      fontSize: '52px',
      color: '#f2f6ff',
      stroke: '#000000',
      strokeThickness: 8
    }).setOrigin(0.5);

    this.add.text(384, 134, this.runConfig.subtitle, {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#9fb2c8',
      align: 'center',
      wordWrap: { width: 520 }
    }).setOrigin(0.5);

    this.uiText = this.add.text(384, 160, '', {
      fontFamily: 'Georgia, serif',
      fontSize: '24px',
      color: '#dce5f4',
      align: 'center'
    }).setOrigin(0.5, 0);

    this.add.text(384, 235, 'Swipe or use arrow keys', {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#8aa0b9'
    }).setOrigin(0.5);

    this.setupInput();
    this.renderBoard();
    this.refreshUi();
  }

  private setupInput(): void {
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const mapping: Record<string, Direction | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        KeyW: 'up',
        KeyS: 'down',
        KeyA: 'left',
        KeyD: 'right'
      };

      const direction = mapping[event.code];

      if (direction) {
        this.takeTurn(direction);
      }
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.swipeStart = { x: pointer.x, y: pointer.y };
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.swipeStart) {
        return;
      }

      const deltaX = pointer.x - this.swipeStart.x;
      const deltaY = pointer.y - this.swipeStart.y;
      const threshold = 24;

      if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
        this.swipeStart = null;
        return;
      }

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.takeTurn(deltaX > 0 ? 'right' : 'left');
      } else {
        this.takeTurn(deltaY > 0 ? 'down' : 'up');
      }

      this.swipeStart = null;
    });
  }

  private takeTurn(direction: Direction): void {
    const result = slideBoard(this.board, direction);

    if (result.moved || result.combatLog.length > 0) {
      this.renderBoard();
      this.refreshUi(result.combatLog);
    }
  }

  private refreshUi(combatLog: string[] = []): void {
    const progressWidth = 420;
    const progress = this.board.phase === 'boss'
      ? Math.floor((Math.max(0, this.board.bossHp) / Math.max(1, this.board.bossMaxHp)) * 100)
      : Math.floor((this.board.progress / this.board.maxProgress) * 100);
    const hero = this.findHero();
    const phaseLabel = this.board.phase === 'boss' ? `Boss HP ${this.board.bossHp}/${this.board.bossMaxHp}` : `Progress ${progress}%`;

    this.uiText.setText([
      `Turn ${this.board.turn}`,
      `HP ${hero?.hp ?? 0}   XP ${this.board.xp}/100   Gold ${this.board.gold}`,
      phaseLabel,
      combatLog[0] ?? ''
    ]);

    this.addExistingProgressBar(progressWidth, progress);

    if (this.board.status === 'victory') {
      this.showEndState('Victory', 'You reached the end of the run.');
    } else if (this.board.status === 'defeat') {
      this.showEndState('Defeat', 'Your hero fell in the maze.');
    }
  }

  private addExistingProgressBar(width: number, progress: number): void {
    const progressLeft = 174;
    const progressTop = 286;
    const filledWidth = (width * progress) / 100;

    this.tileGraphics.lineStyle(4, 0x4f667d, 1);
    this.tileGraphics.strokeRoundedRect(progressLeft, progressTop, width, 18, 9);
    this.tileGraphics.fillStyle(0x7ec8ff, 1);
    this.tileGraphics.fillRoundedRect(progressLeft, progressTop, filledWidth, 18, 9);
    this.tileGraphics.fillStyle(0xc9e3ff, 1);
    this.tileGraphics.fillCircle(progressLeft + filledWidth, progressTop + 9, 10);
  }

  private renderBoard(): void {
    this.clearTileTexts();
    this.tileGraphics.clear();
    this.drawBoardBackground();

    for (const tile of this.board.tiles) {
      this.drawTile(tile);
    }
  }

  private drawBoardBackground(): void {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const position = this.cellToWorld(x, y);
        this.tileGraphics.fillStyle(0x1f4d2c, 0.75);
        this.tileGraphics.fillRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);
      }
    }
  }

  private drawTile(tile: Tile): void {
    const position = this.cellToWorld(tile.x, tile.y);
    const style = this.getTileStyle(tile.kind);

    this.tileGraphics.fillStyle(style.fill, 1);
    this.tileGraphics.fillRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);
    this.tileGraphics.lineStyle(tile.kind === 'hero' ? 6 : 3, style.stroke, 1);
    this.tileGraphics.strokeRoundedRect(position.x, position.y, CELL_SIZE, CELL_SIZE, 12);

    if (tile.kind !== 'web') {
      this.tileGraphics.fillStyle(style.icon, 1);
      this.tileGraphics.fillCircle(position.x + CELL_SIZE / 2, position.y + CELL_SIZE / 2 - 4, 14);
    }

    if (tile.kind === 'hero') {
      this.tileGraphics.lineStyle(8, 0xe8f2ff, 1);
      this.tileGraphics.strokeRoundedRect(position.x - 4, position.y - 4, CELL_SIZE + 8, CELL_SIZE + 8, 14);
    }

    const label = tile.kind === 'hero' ? 'You' : tile.kind;
    this.tileTexts.push(this.add.text(position.x + CELL_SIZE / 2, position.y + CELL_SIZE / 2 + 22, label, {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#0d1621'
    }).setOrigin(0.5));

    if (tile.hp > 1 || tile.kind === 'hero') {
      this.tileTexts.push(this.add.text(position.x + CELL_SIZE / 2, position.y + CELL_SIZE / 2 - 34, String(tile.hp), {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
      }).setOrigin(0.5));
    }
  }

  private clearTileTexts(): void {
    for (const text of this.tileTexts) {
      text.destroy();
    }

    this.tileTexts = [];
  }

  private getTileStyle(kind: Tile['kind']): { fill: number; stroke: number; icon: number } {
    switch (kind) {
      case 'hero':
        return { fill: 0xb6d6ff, stroke: 0xffffff, icon: 0x1f4d8d };
      case 'goblin':
        return { fill: 0xb55f5f, stroke: 0xffb3b3, icon: 0x4d0f0f };
      case 'spider':
        return { fill: 0x5e5479, stroke: 0xff7979, icon: 0x20192e };
      case 'rock':
        return { fill: 0xbfc2ca, stroke: 0xffffff, icon: 0x69707c };
      case 'web':
        return { fill: 0x7f7f7f, stroke: 0xdedede, icon: 0xffffff };
      case 'gold':
        return { fill: 0xecc74a, stroke: 0xfff2b0, icon: 0xffd74a };
      case 'boss':
        return { fill: 0x8f5b5b, stroke: 0xffd2d2, icon: 0x421111 };
    }
  }

  private cellToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: BOARD_LEFT + x * (CELL_SIZE + CELL_GAP),
      y: BOARD_TOP + y * (CELL_SIZE + CELL_GAP)
    };
  }

  private findHero(): Tile | undefined {
    return this.board.tiles.find((tile) => tile.kind === 'hero');
  }

  private showEndState(title: string, description: string): void {
    if (this.endOverlayShown) {
      return;
    }

    this.endOverlayShown = true;
    const overlay = this.add.rectangle(384, 650, 640, 420, 0x000000, 0.72);
    const panel = this.add.rectangle(384, 650, 540, 290, 0xd7def0, 1);

    this.add.text(384, 560, title, {
      fontFamily: 'Georgia, serif',
      fontSize: '48px',
      color: '#16202d'
    }).setOrigin(0.5);

    this.add.text(384, 648, description, {
      fontFamily: 'Georgia, serif',
      fontSize: '24px',
      color: '#243447',
      align: 'center',
      wordWrap: { width: 460 }
    }).setOrigin(0.5);

    this.add.text(384, 726, 'Refresh to start a new daily seed.', {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#3e526c'
    }).setOrigin(0.5);

    const menuButton = this.add.text(384, 788, 'Return to Menu', {
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      color: '#174a28',
      backgroundColor: '#bfe0cf',
      padding: { left: 18, right: 18, top: 10, bottom: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    menuButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });

    overlay.setDepth(10);
    panel.setDepth(11);
    menuButton.setDepth(12);
  }
}