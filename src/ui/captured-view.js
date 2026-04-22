/**
 * Renders captured pieces per side + material advantage badge.
 *
 * Practice / Lesson / Puzzle / Review → reads from gameState.getHistory().
 * Commentator → reads from the cursor path in commentatorState, so captures
 * appear "as they play" while you step through the imported game.
 */
import { EVENTS, MODE_IDS } from '../core/constants.js';
import { PIECE_UNICODE, PIECE_VALUE } from '../engine/chess.js';

const ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4 };

export class CapturedView {
  constructor(topEl, bottomEl, gameState, commentatorState, bus) {
    this.topEl = topEl;
    this.bottomEl = bottomEl;
    this.gameState = gameState;
    this.commentatorState = commentatorState;
    bus.on(EVENTS.STATE_CHANGED, () => this.render());
    bus.on(EVENTS.COMMENTATOR_MATCH_LOADED, () => this.render());
    bus.on(EVENTS.COMMENTATOR_NAVIGATED,    () => this.render());
    this.render();
  }

  render() {
    const { capW, capB } = this.#collectCaptures();
    const topIsBlack = this.gameState.orientation === 'w';
    const topCaps = topIsBlack ? capB : capW;
    const botCaps = topIsBlack ? capW : capB;
    this.#renderRow(this.topEl,    topCaps, this.#materialAdvantage(topIsBlack ? 'w' : 'b'));
    this.#renderRow(this.bottomEl, botCaps, this.#materialAdvantage(topIsBlack ? 'b' : 'w'));
  }

  /**
   * capW = pieces white has captured (black material off the board)
   * capB = pieces black has captured (white material off the board)
   * Each entry is `{p, c}` so the row renders the correct color glyph.
   */
  #collectCaptures() {
    const capW = [], capB = [];
    if (this.gameState.mode === MODE_IDS.COMMENTATOR && this.commentatorState?.hasMatch()) {
      // Only captures on moves up to the current cursor — matches the
      // "replay as you step" behavior of the left-panel history.
      for (const node of this.commentatorState.path) {
        if (!node.move || !node.move.captured) continue;
        const piece = { p: node.move.captured, c: node.move.color === 'w' ? 'b' : 'w' };
        if (piece.c === 'w') capB.push(piece); else capW.push(piece);
      }
    } else {
      for (const entry of this.gameState.getHistory()) {
        if (!entry.info.captured) continue;
        const cap = entry.info.captured;
        if (cap.c === 'w') capB.push(cap); else capW.push(cap);
      }
    }
    return { capW, capB };
  }

  #renderRow(row, pieces, advantage) {
    row.innerHTML = '';
    pieces.sort((a, b) => ORDER[a.p] - ORDER[b.p]);
    for (const p of pieces) {
      const s = document.createElement('span');
      s.textContent = PIECE_UNICODE[p.c][p.p];
      row.appendChild(s);
    }
    if (advantage > 0) {
      const adv = document.createElement('span');
      adv.className = 'adv';
      adv.textContent = `+${advantage}`;
      row.appendChild(adv);
    }
  }

  /**
   * In commentator mode, count material from the CURRENT NODE's fen so
   * the advantage matches the visible position. Outside, read the live
   * gameState board.
   */
  #materialAdvantage(forColor) {
    const board = this.#currentBoard();
    if (!board) return 0;
    let w = 0, b = 0;
    for (const p of board) {
      if (!p || p.p === 'k') continue;
      const v = (PIECE_VALUE[p.p] / 100) | 0;
      if (p.c === 'w') w += v; else b += v;
    }
    return forColor === 'w' ? w - b : b - w;
  }

  #currentBoard() {
    if (this.gameState.mode === MODE_IDS.COMMENTATOR && this.commentatorState?.hasMatch()) {
      // gameState is loaded to the current node's FEN on navigation, so its
      // board is already correct.
      return this.gameState.getChessState().board;
    }
    return this.gameState.getChessState().board;
  }
}
