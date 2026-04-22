/**
 * GameState holds the current chess position + orientation + `playAs` + current
 * mode. It's the shared display-state for whatever's on the board — regardless
 * of whether the active tab is practice, a lesson, a puzzle, or review.
 *
 * Mutations go through methods; every mutation emits STATE_CHANGED so views
 * can re-render without polling.
 */
import * as Chess from '../engine/chess.js';
import { EVENTS, MODE_IDS } from '../core/constants.js';

export class GameState {
  constructor(bus) {
    this.bus = bus;
    this.state = Chess.create();
    this.orientation = 'w';
    this.playAs = 'w';
    this.mode = MODE_IDS.PRACTICE;
    this.lastMove = null;
    this.selected = null;       // [r, c] of selected square
    this.legalTargets = [];     // Move[] legal from selected square
    this.animating = false;
  }

  // ------ Queries ------
  getChessState() { return this.state; }
  toFEN() { return Chess.toFEN(this.state); }
  getStatus() { return Chess.status(this.state); }
  getTurn() { return this.state.turn; }
  getHistory() { return this.state.history; }
  getPieceAt(r, c) { return this.state.board[r * 8 + c]; }

  isGameOver() { return Chess.status(this.state).over; }

  // ------ Mutations ------
  resetToStart() {
    this.state = Chess.create();
    this.lastMove = null;
    this.selected = null;
    this.legalTargets = [];
    this.#emitChange({ type: 'reset' });
  }

  loadFen(fen, lastMove = null) {
    this.state = Chess.fromFEN(fen);
    this.lastMove = lastMove;
    this.selected = null;
    this.legalTargets = [];
    this.#emitChange({ type: 'fen', fen });
  }

  /** Commit a move to the state. Caller is responsible for animations. */
  makeMove(move) {
    Chess.makeMove(this.state, move);
    this.lastMove = move;
    this.selected = null;
    this.legalTargets = [];
    this.#emitChange({ type: 'move', move });
  }

  undoLast() {
    Chess.undoLast(this.state);
    this.lastMove = this.state.history.length
      ? this.state.history[this.state.history.length - 1].move
      : null;
    this.selected = null;
    this.legalTargets = [];
    this.#emitChange({ type: 'undo' });
  }

  /** Select a square — used to highlight legal moves. */
  select(r, c) {
    this.selected = [r, c];
    this.legalTargets = Chess.legalMovesFrom(this.state, r, c);
    this.#emitChange({ type: 'select' });
  }

  clearSelection() {
    if (!this.selected && this.legalTargets.length === 0) return;
    this.selected = null;
    this.legalTargets = [];
    this.#emitChange({ type: 'clearSelection' });
  }

  setOrientation(color) {
    if (this.orientation === color) return;
    this.orientation = color;
    this.#emitChange({ type: 'orientation' });
  }

  flipOrientation() {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  }

  setPlayAs(color) { this.playAs = color; }
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.#emitChange({ type: 'mode', mode });
  }

  setAnimating(v) { this.animating = v; }

  #emitChange(detail) {
    this.bus.emit(EVENTS.STATE_CHANGED, { state: this, detail });
  }
}
