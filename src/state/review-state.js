/**
 * State for Match Review. Holds the per-move analysis array, running/done
 * flags, and the currently-selected move index.
 */
export class ReviewState {
  constructor() {
    this.running = false;
    this.done = false;
    this.moves = null;
    this.selectedIdx = null;
    this.savedState = null;
  }

  start() {
    this.running = true;
    this.done = false;
    this.moves = [];
    this.selectedIdx = null;
  }

  finish() {
    this.running = false;
    this.done = true;
  }

  reset() {
    this.running = false;
    this.done = false;
    this.moves = null;
    this.selectedIdx = null;
    this.savedState = null;
  }

  select(idx) { this.selectedIdx = idx; }
  push(entry) { this.moves.push(entry); }
}
