/**
 * Hint card (below the board) + coral arrow overlay (on the board).
 *
 * Computes a best-move hint synchronously via engine search and draws both
 * the card and the arrow. Auto-dismiss happens via the practice controller
 * whenever a real move is played or the user pressed New Game / Undo.
 */
import * as Chess from '../engine/chess.js';
import { PIECE_NAME_LOWER } from '../core/constants.js';

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
    this.moveEl.textContent = '…';
    this.textEl.textContent = 'Looking a few moves ahead…';
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
    const nm = (p) => PIECE_NAME_LOWER[p] || 'piece';
    if (san.includes('#')) return 'Delivers <b>checkmate</b>. End it!';
    if (move.castling) return `Castles ${move.castling === 'k' ? 'kingside' : 'queenside'} — tucks the king behind a wall of pawns.`;
    if (move.promotion) return `Pushes to the last rank and promotes to a <b>${nm(move.promotion)}</b>.`;
    const parts = [];
    if (move.captured) {
      parts.push(`Wins material: your <b>${nm(move.piece)}</b> captures the <b>${nm(move.captured)}</b>.`);
    } else {
      const to = Chess.squareName(move.to[0], move.to[1]);
      if (move.piece === 'n' || move.piece === 'b') parts.push(`Develops your <b>${nm(move.piece)}</b> to <b>${to}</b>, improving activity and eyeing the center.`);
      else if (move.piece === 'p') parts.push(`Advances your <b>pawn</b> to <b>${to}</b>, claiming space.`);
      else if (move.piece === 'r') parts.push(`Activates your <b>rook</b> on <b>${to}</b> — open files love rooks.`);
      else if (move.piece === 'q') parts.push(`Brings the <b>queen</b> to <b>${to}</b> with purpose.`);
      else parts.push(`Moves your <b>${nm(move.piece)}</b> to <b>${to}</b>.`);
    }
    if (san.endsWith('+')) parts.push('Also gives <b>check</b>.');
    return parts.join(' ');
  }

  #playCurrentHint() {
    if (!this.currentHint) return;
    // Emit through bus so the practice controller handles the move
    // consistently with all other user input.
    this.bus.emit('hint:play', { move: this.currentHint.move });
  }
}
