import type { StrikeQuality } from './types';

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

  /** Rising blip as the timing bar opens — the cue to look at the screen and get ready. */
  playDuelStart(): void {
    this.playTone({ frequency: 420, type: 'triangle', duration: 0.12, gain: 0.14, frequency2: 760 });
  }

  /** Bright two-tone stab for a hit in the green zone. Deliberately the sharpest sound in the game. */
  playPerfectStrike(): void {
    this.playTone({ frequency: 880, type: 'square', duration: 0.09, gain: 0.16 });
    setTimeout(() => this.playTone({ frequency: 1320, type: 'square', duration: 0.16, gain: 0.15, frequency2: 990 }), 70);
  }

  /** Dull muted thud for a mistimed strike: the hit landed, it just did not land well. */
  playGlancingBlow(): void {
    this.playTone({ frequency: 180, type: 'triangle', duration: 0.16, gain: 0.12, frequency2: 120 });
  }

  /** Three descending tones as the hero takes the stairway to the next layer. */
  playDescend(): void {
    const delays = [0, 130, 260];
    const freqs = [520, 390, 260];

    delays.forEach((delay, index) => {
      setTimeout(() => this.playTone({ frequency: freqs[index], type: 'sine', duration: 0.34, gain: 0.2 }), delay);
    });
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

  /** Dull thud for swiping into the edge of the board — a non-event, so it stays quiet and short. */
  playWallBump(): void {
    this.playTone({ frequency: 120, type: 'square', duration: 0.08, gain: 0.1 });
  }

  playWeb(): void {
    this.playTone({ frequency: 180, type: 'triangle', duration: 0.15, gain: 0.16, frequency2: 90 });
  }

  playBossSpawn(): void {
    this.playTone({ frequency: 80, type: 'sawtooth', duration: 0.6, gain: 0.26, frequency2: 55 });
  }

  playPause(): void {
    this.playTone({ frequency: 440, type: 'sine', duration: 0.1, gain: 0.14 });
  }

  playDamageTaken(): void {
    this.playTone({ frequency: 240, type: 'sawtooth', duration: 0.15, gain: 0.16, frequency2: 160 });
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

  /**
   * Plays the sounds a turn earned. There are two layers, because a single turn can be several
   * events at once — killing a goblin, levelling up, and the boss winding up all in one swipe:
   *
   *   - one *primary* cue chosen from the action the player took, which is always `messages[0]`;
   *   - any *secondary* cues from what the board did back, which the engine appends after it.
   *
   * `hpLost` comes from the scene comparing hero HP either side of the turn, since no message
   * reliably reports it (the weave, a counter-attack and a boss strike all phrase it differently).
   *
   * The structured `strikeQuality` / `leveledUp` / `descended` flags are checked before any substring
   * match, on purpose. Matching message text is fragile — rewording a strike line silently changes
   * which cue fires — and in the level-up case it was outright broken: `'Level up!'` is appended
   * *after* the strike line, so `messages[0]` matched `'strike'`, won, and `playLevelUp` never played
   * on a melee kill at all.
   */
  playFromTurnResult(
    result: {
      messages: string[];
      acted: boolean;
      strikeQuality?: StrikeQuality;
      leveledUp?: boolean;
      descended?: boolean;
    },
    status: string,
    hpLost = false
  ): void {
    if (status === 'victory' || status === 'defeat') {
      return; // handled by showEndState
    }

    const msg = result.messages[0] ?? '';

    if (!result.acted) {
      // The turn never happened — a wall, or a spell with no charges left
      if (msg.includes('wall')) {
        this.playWallBump();
      }
      return;
    }

    // `good` deliberately falls through to the message-based cues below, so a normal hit still gets
    // playBossHit against a boss and playEnemyDeath on a kill. Only the two ends of the scale claim
    // a sound of their own.
    if (result.descended) {
      this.playDescend();
      return;
    }

    if (result.strikeQuality === 'perfect') {
      this.playPerfectStrike();
    } else if (result.strikeQuality === 'weak') {
      this.playGlancingBlow();
    } else if (msg.includes('web')) {
      this.playWeb();
    } else if (msg.includes('gold')) {
      this.playGoldPickup();
    } else if (msg.includes('Level up')) {
      this.playLevelUp();
    } else if (msg.includes('boss') || msg.includes('Boss')) {
      this.playBossHit();
    } else if (msg.includes('destroyed') || msg.includes('defeated')) {
      this.playEnemyDeath();
    } else if (msg.includes('strike') || msg.includes('hit') || msg.includes('for')) {
      this.playHit();
    } else {
      this.playMove();
    }

    // Secondary cues, layered a beat later so they read as a response rather than one muddy chord
    const rest = result.messages.slice(1);

    if (result.leveledUp) {
      setTimeout(() => this.playLevelUp(), 160);
    } else if (rest.some((entry) => entry.includes('awakens'))) {
      setTimeout(() => this.playBossSpawn(), 180);
    } else if (rest.some((entry) => entry.includes('weave'))) {
      setTimeout(() => this.playBossAttack(), 180);
    } else if (hpLost) {
      setTimeout(() => this.playDamageTaken(), 120);
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
