/**
 * Hint card (below the board) + coral arrow overlay (on the board).
 *
 * Computes a best-move hint synchronously via engine search and draws both
 * the card and the arrow. Auto-dismiss happens via the practice controller
 * whenever a real move is played or the user pressed New Game / Undo.
 */
import * as Chess from '../engine/chess.js';
import { i18n } from '../core/i18n.js';

export class HintView {
  constructor({ cardEl, moveEl, textEl, arrowEl, arrowLineEl, playBtn, closeBtn }, gameState, boardView, bus) {
    this.cardEl = cardEl;
    this.moveEl = moveEl;
    this.textEl = textEl;
    this.arrowEl = arrowEl;
    this.arrowLineEl = arrowLineEl;
    this.gameState = gameState;
    this.boardView = boardView;
    this.bus = bus;
    this.currentHint = null;

    playBtn.addEventListener('click', () => this.#playCurrentHint());
    closeBtn.addEventListener('click', () => this.dismiss());
  }

  /** Compute + display the hint for the current position. */
  show() {
    this.moveEl.textContent = i18n.t('hint.loading');
    this.textEl.textContent = i18n.t('hint.loadingSub');
    this.cardEl.hidden = false;

    // Defer the search one frame so the UI repaints first.
    requestAnimationFrame(() => setTimeout(() => {
      const state = this.gameState.getChessState();
      const { move } = Chess.search(state, 3);
      if (!move) { this.dismiss(); return; }
      const san = this.#sanOf(move);
      this.currentHint = { move, san };
      this.moveEl.textContent = san;
      this.textEl.innerHTML = this.#describe(move, san);
      this.#drawArrow(move);
    }, 0));
  }

  dismiss() {
    this.currentHint = null;
    if (this.cardEl) this.cardEl.hidden = true;
    if (this.arrowEl) this.arrowEl.hidden = true;
  }

  /** Render the arrow for a specific pre-computed move (used by Review). */
  showForMove(move, san) {
    this.currentHint = { move, san };
    this.#drawArrow(move);
  }

  #drawArrow(move) {
    const [fromR, fromC] = move.from;
    const [toR, toC] = move.to;
    const [vfr, vfc] = this.gameState.orientation === 'w' ? [fromR, fromC] : [7 - fromR, 7 - fromC];
    const [vtr, vtc] = this.gameState.orientation === 'w' ? [toR, toC]     : [7 - toR, 7 - toC];
    const x1 = vfc + 0.5, y1 = vfr + 0.5;
    const x2 = vtc + 0.5, y2 = vtr + 0.5;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const shrink = 0.22;
    const ex = x2 - (dx / len) * shrink;
    const ey = y2 - (dy / len) * shrink;
    this.arrowLineEl.setAttribute('x1', x1);
    this.arrowLineEl.setAttribute('y1', y1);
    this.arrowLineEl.setAttribute('x2', ex);
    this.arrowLineEl.setAttribute('y2', ey);
    this.arrowEl.hidden = false;
  }

  #sanOf(move) {
    const m = { ...move };
    Chess.makeMove(this.gameState.getChessState(), m);
    Chess.undoLast(this.gameState.getChessState());
    return m.san || (Chess.squareName(move.from[0], move.from[1]) + Chess.squareName(move.to[0], move.to[1]));
  }

  #describe(move, san) {
    const piece = i18n.piece(move.piece);
    if (san.includes('#')) return i18n.t('hint.checkmate');
    if (move.castling) {
      const dir = i18n.t(move.castling === 'k' ? 'chess.direction.kingside' : 'chess.direction.queenside');
      return i18n.t('hint.castle', { dir });
    }
    if (move.promotion) return i18n.t('hint.promote', { piece: i18n.piece(move.promotion) });
    const parts = [];
    if (move.captured) {
      parts.push(i18n.t('hint.capture', { piece, target: i18n.piece(move.captured) }));
    } else {
      const to = Chess.squareName(move.to[0], move.to[1]);
      if (move.piece === 'n' || move.piece === 'b') parts.push(i18n.t('hint.develop', { piece, square: to }));
      else if (move.piece === 'p') parts.push(i18n.t('hint.pawn', { square: to }));
      else if (move.piece === 'r') parts.push(i18n.t('hint.rook', { square: to }));
      else if (move.piece === 'q') parts.push(i18n.t('hint.queen', { square: to }));
      else parts.push(i18n.t('hint.quiet', { piece, square: to }));
    }
    if (san.endsWith('+')) parts.push(i18n.t('hint.checkSuffix').trim());
    return parts.join(' ');
  }

  #playCurrentHint() {
    if (!this.currentHint) return;
    // Emit through bus so the practice controller handles the move
    // consistently with all other user input.
    this.bus.emit('hint:play', { move: this.currentHint.move });
  }
}
