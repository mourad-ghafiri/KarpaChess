/**
 * BoardView — renders the 8×8 grid + pieces + overlays from GameState.
 *
 * Responsibilities (only these):
 *   - Build the 64 square cells once on construction.
 *   - Render pieces, selection highlights, legal-move dots, last-move shading,
 *     and check glow every time state changes.
 *   - Translate click events on squares into `board:squareClicked` events on
 *     the bus. It does NOT know about modes, lessons, or puzzles.
 *   - Animate a moving piece when requested via `animateMove()`.
 */
import { FILES } from '../engine/chess.js';
import * as Chess from '../engine/chess.js';
import { EVENTS } from '../core/constants.js';
import { $ } from '../core/dom.js';

export class BoardView {
  constructor(rootEl, gameState, bus, prefs, fileLabelEls, rankLabelEls) {
    this.root = rootEl;
    this.gameState = gameState;
    this.bus = bus;
    this.prefs = prefs;
    this.fileLabelEls = fileLabelEls;   // { top, bottom }
    this.rankLabelEls = rankLabelEls;   // { left, right }

    this.#build();
    this.#buildLabels();
    this.render();

    bus.on(EVENTS.STATE_CHANGED, () => {
      this.#buildLabels();
      this.render();
    });

    bus.on(EVENTS.PREFS_CHANGED, (patch) => {
      if (patch && ('coords' in patch || 'legalHighlight' in patch || 'lastMoveHighlight' in patch)) {
        this.#buildLabels();
        this.render();
      }
    });
  }

  // ------ Build once ------
  #build() {
    this.root.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.className = `sq ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
        cell.dataset.r = r; cell.dataset.c = c;
        cell.addEventListener('click', (e) => this.#onClick(e));
        this.root.appendChild(cell);
      }
    }
  }

  #buildLabels() {
    const { top, bottom } = this.fileLabelEls;
    const { left, right } = this.rankLabelEls;
    const show = !!this.prefs.get('coords');
    top.hidden = bottom.hidden = left.hidden = right.hidden = !show;
    if (!show) return;
    const orient = this.gameState.orientation;
    const files = orient === 'w' ? 'abcdefgh' : 'hgfedcba';
    const ranks = orient === 'w' ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
    const fillFiles = (el) => { el.innerHTML = ''; for (const f of files) { const s = document.createElement('span'); s.textContent = f; el.appendChild(s); } };
    const fillRanks = (el) => { el.innerHTML = ''; for (const r of ranks) { const s = document.createElement('span'); s.textContent = r; el.appendChild(s); } };
    fillFiles(top); fillFiles(bottom);
    fillRanks(left); fillRanks(right);
  }

  // ------ Coordinate helpers ------
  #viewCoord(r, c) {
    return this.gameState.orientation === 'w' ? [r, c] : [7 - r, 7 - c];
  }
  domSquare(r, c) {
    const [vr, vc] = this.#viewCoord(r, c);
    return this.root.children[vr * 8 + vc];
  }

  // ------ Click → squareClicked event ------
  #onClick(e) {
    if (this.gameState.animating) return;
    const r = parseInt(e.currentTarget.dataset.r);
    const c = parseInt(e.currentTarget.dataset.c);
    const [br, bc] = this.gameState.orientation === 'w' ? [r, c] : [7 - r, 7 - c];
    this.bus.emit(EVENTS.BOARD_SQUARE_CLICKED, { r: br, c: bc });
  }

  // ------ Render pass ------
  render() {
    // 1. Clear all squares
    for (const cell of this.root.children) {
      cell.classList.remove('selected', 'last-move', 'check', 'capture');
      cell.innerHTML = '';
    }

    // 2. Place pieces
    const state = this.gameState.getChessState();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r * 8 + c];
        if (!p) continue;
        const cell = this.domSquare(r, c);
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${p.c === 'w' ? 'white' : 'black'}`;
        pieceEl.textContent = Chess.PIECE_UNICODE[p.c][p.p];
        cell.appendChild(pieceEl);
      }
    }

    // 3. Last-move shading
    if (this.prefs.get('lastMoveHighlight') && this.gameState.lastMove) {
      const m = this.gameState.lastMove;
      this.domSquare(m.from[0], m.from[1]).classList.add('last-move');
      this.domSquare(m.to[0], m.to[1]).classList.add('last-move');
    }

    // 4. Selection + legal target dots
    if (this.gameState.selected) {
      this.domSquare(this.gameState.selected[0], this.gameState.selected[1]).classList.add('selected');
      if (this.prefs.get('legalHighlight')) {
        for (const m of this.gameState.legalTargets) {
          const cell = this.domSquare(m.to[0], m.to[1]);
          if (m.captured || m.ep) cell.classList.add('capture');
          else {
            const dot = document.createElement('div');
            dot.className = 'dot';
            cell.appendChild(dot);
          }
        }
      }
    }

    // 5. King-in-check glow
    const st = Chess.status(state);
    if (st.check) {
      const k = this.#findKingSquare(state.turn);
      if (k) this.domSquare(k[0], k[1]).classList.add('check');
    }
  }

  #findKingSquare(color) {
    const state = this.gameState.getChessState();
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p && p.p === 'k' && p.c === color) return [Math.floor(i / 8), i % 8];
    }
    return null;
  }

  /** Animate the piece element sliding from `move.from` to `move.to`, then
   *  invoke `onDone`. Caller handles state commit. */
  animateMove(move, onDone) {
    const fromEl = this.domSquare(move.from[0], move.from[1]);
    const toEl = this.domSquare(move.to[0], move.to[1]);
    const pieceEl = fromEl.querySelector('.piece');
    if (!this.prefs.get('animations') || !pieceEl || fromEl === toEl) {
      onDone();
      return;
    }

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;

    // Captured piece fade — needs to happen a hair before the landing.
    let capturedEl = null;
    if (move.captured && !move.ep) capturedEl = toEl.querySelector('.piece');
    else if (move.ep) {
      const epR = move.color === 'w' ? move.to[0] + 1 : move.to[0] - 1;
      capturedEl = this.domSquare(epR, move.to[1]).querySelector('.piece');
    }
    if (capturedEl) setTimeout(() => capturedEl.classList.add('captured'), 120);

    pieceEl.classList.add('moving');
    pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
    pieceEl.addEventListener('transitionend', () => setTimeout(onDone, 20), { once: true });
  }

  rectOfSquare(r, c) {
    return this.domSquare(r, c).getBoundingClientRect();
  }
}
