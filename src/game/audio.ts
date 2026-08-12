const MUTE_KEY = 'rogueSwipe.muted';

interface ToneOptions {
  frequency: number;
  type?: OscillatorType;
  duration: number;
  gain?: number;
  fadeOut?: boolean;
  frequency2?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  private getContext(): AudioContext | null {
    if (this.muted) {
      return null;
    }
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    // Resume suspended context (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(options: ToneOptions): void {
    const ctx = this.getContext();
    if (!ctx) {
      return;
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(options.frequency, ctx.currentTime);

    if (options.frequency2 !== undefined) {
      oscillator.frequency.linearRampToValueAtTime(options.frequency2, ctx.currentTime + options.duration * 0.5);
    }

    const peakGain = options.gain ?? 0.18;
    gainNode.gain.setValueAtTime(peakGain, ctx.currentTime);

    if (options.fadeOut !== false) {
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + options.duration);
    }

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + options.duration + 0.01);
  }

  // ── Public sound methods ───────────────────────────────────────────────────

  playMove(): void {
    this.playTone({ frequency: 280, type: 'sine', duration: 0.06, gain: 0.1 });
  }

  playHit(): void {
    this.playTone({ frequency: 320, type: 'square', duration: 0.12, gain: 0.14, frequency2: 180 });
  }

  playEnemyDeath(): void {
    this.playTone({ frequency: 520, type: 'triangle', duration: 0.18, gain: 0.16, frequency2: 180 });
  }

  playGoldPickup(): void {
    this.playTone({ frequency: 660, type: 'sine', duration: 0.14, gain: 0.15, frequency2: 880 });
  }

  playLevelUp(): void {
    const ctx = this.getContext();
    if (!ctx) {
      return;
    }
    // Two ascending tones for level up
    this.playTone({ frequency: 440, type: 'sine', duration: 0.15, gain: 0.2 });
    setTimeout(() => this.playTone({ frequency: 660, type: 'sine', duration: 0.25, gain: 0.22 }), 120);
    setTimeout(() => this.playTone({ frequency: 880, type: 'sine', duration: 0.35, gain: 0.22 }), 280);
  }

  playSpell(): void {
    this.playTone({ frequency: 880, type: 'sine', duration: 0.3, gain: 0.2, frequency2: 440 });
  }

  playBossHit(): void {
    this.playTone({ frequency: 200, type: 'sawtooth', duration: 0.2, gain: 0.18, frequency2: 140 });
  }

  playBossAttack(): void {
    this.playTone({ frequency: 140, type: 'sawtooth', duration: 0.4, gain: 0.25, frequency2: 80 });
  }

  playVictory(): void {
    const delays = [0, 140, 280, 460];
    const freqs = [440, 550, 660, 880];
    delays.forEach((delay, index) => {
      setTimeout(() => this.playTone({ frequency: freqs[index], type: 'sine', duration: 0.4, gain: 0.22 }), delay);
    });
  }

  playDefeat(): void {
    const delays = [0, 160, 340];
    const freqs = [330, 220, 110];
    delays.forEach((delay, index) => {
      setTimeout(() => this.playTone({ frequency: freqs[index], type: 'triangle', duration: 0.5, gain: 0.2 }), delay);
    });
  }

  /** Plays the right sound based on a turn result */
  playFromTurnResult(result: { messages: string[]; acted: boolean }, status: string): void {
    if (status === 'victory' || status === 'defeat') {
      return; // handled by showEndState
    }

    const msg = result.messages[0] ?? '';

    if (msg.includes('gold')) {
      this.playGoldPickup();
    } else if (msg.includes('Level up')) {
      this.playLevelUp();
    } else if (msg.includes('boss') || msg.includes('Boss')) {
      this.playBossHit();
    } else if (msg.includes('destroyed') || msg.includes('defeated')) {
      this.playEnemyDeath();
    } else if (msg.includes('strike') || msg.includes('hit') || msg.includes('for')) {
      this.playHit();
    } else if (result.acted) {
      this.playMove();
    }
  }

  // ── Mute controls ─────────────────────────────────────────────────────────

  mute(): void {
    this.muted = true;
    localStorage.setItem(MUTE_KEY, '1');
  }

  unmute(): void {
    this.muted = false;
    localStorage.setItem(MUTE_KEY, '0');
  }

  isMuted(): boolean {
    return this.muted;
  }
}
