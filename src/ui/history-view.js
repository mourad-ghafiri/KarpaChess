/**
 * Renders the left-panel move history.
 *
 * Practice / Lesson / Puzzle / Review modes → the gameState's own history.
 * Commentator mode → the imported match's main line, with the active ply
 * highlighted and each SAN clickable to jump there (so the left-panel
 * history mirrors the collapsed move tree in the right panel).
 */
import { EVENTS, MODE_IDS } from '../core/constants.js';
import { escapeHtml } from '../core/dom.js';
import { i18n } from '../core/i18n.js';

export class HistoryView {
  constructor(rootEl, gameState, commentatorState, bus) {
    this.root = rootEl;
    this.gameState = gameState;
    this.commentatorState = commentatorState;
    bus.on(EVENTS.STATE_CHANGED, () => this.render());
    bus.on(EVENTS.COMMENTATOR_MATCH_LOADED, () => this.render());
    bus.on(EVENTS.COMMENTATOR_NAVIGATED,    () => this.render());
    bus.on(EVENTS.I18N_CHANGED, () => this.render());
    this.render();
  }

  render() {
    if (this.gameState.mode === MODE_IDS.COMMENTATOR && this.commentatorState?.hasMatch()) {
      this.#renderCommentator();
    } else {
      this.#renderPractice();
    }
  }

  #renderPractice() {
    const history = this.gameState.getHistory();
    if (history.length === 0) {
      this.root.innerHTML = `<div class="history-empty">${escapeHtml(i18n.t('ui.empty.moveHistory'))}</div>`;
      return;
    }
    let html = '';
    for (let i = 0; i < history.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const w = history[i].move;
      const b = history[i + 1]?.move;
      html += `<div class="move-pair"><span class="move-num">${num}.</span>`;
      html += `<span class="move-san">${escapeHtml(w.san || '?')}</span>`;
      html += `<span class="move-san">${b ? escapeHtml(b.san || '?') : ''}</span></div>`;
    }
    this.root.innerHTML = html;
    this.root.scrollTop = this.root.scrollHeight;
  }

  #renderCommentator() {
    // Only render moves up to the current cursor — it should read like a
    // replay, not a full spoiler of the game.
    const moves = this.commentatorState.path.slice(1); // skip root
    if (moves.length === 0) {
      this.root.innerHTML = `<div class="history-empty">${escapeHtml(i18n.t('ui.empty.moveHistoryCommentator'))}</div>`;
      return;
    }
    const currentId = this.commentatorState.currentNode()?.id || null;
    let html = '';
    for (let i = 0; i < moves.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const w = moves[i];
      const b = moves[i + 1];
      const wActive = w.id === currentId ? ' active' : '';
      const bActive = b && b.id === currentId ? ' active' : '';
      html += `<div class="move-pair"><span class="move-num">${num}.</span>`;
      html += `<span class="move-san clickable${wActive}" data-node-id="${w.id}">${escapeHtml(w.san || '?')}</span>`;
      html += b
        ? `<span class="move-san clickable${bActive}" data-node-id="${b.id}">${escapeHtml(b.san || '?')}</span>`
        : `<span class="move-san"></span>`;
      html += `</div>`;
    }
    this.root.innerHTML = html;

    for (const el of this.root.querySelectorAll('[data-node-id]')) {
      el.addEventListener('click', () => this.commentatorState.jumpTo(el.dataset.nodeId));
    }
    const active = this.root.querySelector('.move-san.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
}
