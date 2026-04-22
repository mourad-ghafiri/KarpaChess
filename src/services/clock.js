/**
 * Chess clock. Ticks down whoever's turn it currently is.
 * Emits CLOCK_TICK every ~200ms and CLOCK_TIMEOUT when a clock hits zero.
 *
 * Unlimited mode (`setControl({ minutes: null })`) simply never starts and
 * displays ∞. Safety: if someone switches to Unlimited mid-game while a tick
 * is pending, the tick bails out rather than firing a phantom timeout.
 */
import { EVENTS } from '../core/constants.js';

export class ClockService {
  constructor(bus) {
    this.bus = bus;
    this.control = { minutes: null, increment: 0 };
    this.clocks = { w: 0, b: 0 };
    this.turn = 'w';
    this.interval = null;
  }

  isUnlimited() { return this.control.minutes == null; }

  setControl(control) {
    this.control = control;
    this.reset();
  }

  setTurn(color) { this.turn = color; }

  reset() {
    this.stop();                // drop any pending tick before rewriting clocks
    const sec = this.isUnlimited() ? 0 : this.control.minutes * 60;
    this.clocks = { w: sec, b: sec };
    this.bus.emit(EVENTS.CLOCK_TICK, { ...this.clocks, unlimited: this.isUnlimited() });
  }

  start() {
    if (this.interval || this.isUnlimited()) return;
    let prev = performance.now();
    this.interval = setInterval(() => {
      if (this.isUnlimited()) { this.stop(); return; }
      const now = performance.now();
      const dt = (now - prev) / 1000;
      prev = now;
      this.clocks[this.turn] = Math.max(0, this.clocks[this.turn] - dt);
      if (this.clocks[this.turn] <= 0) {
        const loser = this.turn;
        this.clocks[loser] = 0;
        this.stop();
        this.bus.emit(EVENTS.CLOCK_TIMEOUT, { loser, winner: loser === 'w' ? 'b' : 'w' });
      }
      this.bus.emit(EVENTS.CLOCK_TICK, { ...this.clocks, unlimited: false });
    }, 200);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  static format(sec, unlimited) {
    if (unlimited) return '∞';
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
