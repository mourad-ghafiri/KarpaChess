/**
 * WebAudio sound-effects service. Generates tones in-browser — no audio assets.
 * All effects are gated by `prefs.sound`; they silently no-op when sound is off.
 *
 * Lazy AudioContext: we can't create one until the user has interacted with the
 * page (most browsers block autoplay). The first beep creates it.
 */
export class SoundService {
  constructor(prefs) {
    this.prefs = prefs;
    this.ctx = null;
  }

  #ensureCtx() {
    if (this.ctx) return this.ctx;
    const Audio = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Audio();
    return this.ctx;
  }

  /** Play a single oscillator tone. */
  beep(freq, dur = 0.08, type = 'sine', vol = 0.18) {
    if (!this.prefs.get('sound')) return;
    const ctx = this.#ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  move()    { this.beep(520, 0.06, 'triangle', 0.14); }
  capture() { this.beep(340, 0.08, 'square', 0.18); setTimeout(() => this.beep(220, 0.1, 'sawtooth', 0.12), 40); }
  check()   { this.beep(780, 0.1, 'square', 0.18); setTimeout(() => this.beep(880, 0.12, 'square', 0.2), 60); }
  castle()  { this.beep(420, 0.05, 'triangle'); setTimeout(() => this.beep(560, 0.07, 'triangle'), 50); }
  promote() { [520, 660, 780, 1040].forEach((f, i) => setTimeout(() => this.beep(f, 0.08, 'sine'), i * 60)); }
  win()     { [520, 660, 780, 988, 1244].forEach((f, i) => setTimeout(() => this.beep(f, 0.15, 'sine'), i * 90)); }
  lose()    { [440, 330, 220, 165].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 'sawtooth', 0.14), i * 100)); }
  good()    { this.beep(880, 0.1, 'sine'); setTimeout(() => this.beep(1320, 0.12, 'sine'), 80); }
  bad()     { this.beep(180, 0.15, 'sawtooth', 0.16); }
}
