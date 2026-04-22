/**
 * Snapshots a practice game so it can be restored after a lesson/puzzle/review
 * detour. Single-slot by design — we only need "the most recent practice game."
 */
import * as Chess from '../engine/chess.js';

export class PracticeSnapshot {
  constructor() {
    this.saved = null;
  }

  /** Save a gameState's relevant pieces. */
  capture(gameState) {
    this.saved = {
      state: Chess.fromFEN(gameState.toFEN()),
      history: gameState.getChessState().history.slice(),
      lastMove: gameState.lastMove,
      orientation: gameState.orientation,
      playAs: gameState.playAs,
      mode: gameState.mode
    };
  }

  /** Restore into a gameState. Returns true if there was anything to restore. */
  restoreInto(gameState) {
    if (!this.saved) return false;
    const s = this.saved;
    gameState.state = s.state;
    gameState.state.history = s.history;
    gameState.lastMove = s.lastMove;
    gameState.orientation = s.orientation;
    gameState.playAs = s.playAs;
    gameState.setMode(s.mode);
    return true;
  }

  has() { return !!this.saved; }

  clear() { this.saved = null; }
}
