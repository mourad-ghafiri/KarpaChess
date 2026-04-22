/**
 * Promotion picker modal. Shown when a pawn move has promotion variants —
 * user picks queen/rook/bishop/knight; the chosen move is committed.
 */
import { PIECE_UNICODE } from '../engine/chess.js';

const NAMES = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

export class PromotionView {
  constructor(modals, modalId, choicesEl) {
    this.modals = modals;
    this.modalId = modalId;
    this.choicesEl = choicesEl;
    this.pending = null;
  }

  /**
   * @param {Array} moves — the 4 promotion variants at the same from/to
   * @param {(chosenMove) => void} onChoice
   */
  show(moves, onChoice) {
    this.pending = { moves, onChoice };
    this.choicesEl.innerHTML = '';
    const color = moves[0].color;
    for (const piece of ['q', 'r', 'b', 'n']) {
      const btn = document.createElement('button');
      btn.className = 'promo-choice';
      btn.type = 'button';
      btn.innerHTML =
        `<span class="promo-glyph">${PIECE_UNICODE[color][piece]}</span>` +
        `<span class="promo-name">${NAMES[piece]}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.pending) return;
        const chosen = this.pending.moves.find(m => m.promotion === piece);
        const cb = this.pending.onChoice;
        this.pending = null;
        this.modals.close(this.modalId);
        if (chosen) cb(chosen);
      });
      this.choicesEl.appendChild(btn);
    }
    this.modals.open(this.modalId);
  }

  cancel() {
    if (!this.pending) return;
    this.pending = null;
    this.modals.close(this.modalId);
  }

  isOpen() { return this.modals.isOpen(this.modalId); }
}
