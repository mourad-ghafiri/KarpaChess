/**
 * Match Review controller. Walks the saved practice game, asks the engine
 * for best-move-per-ply and classifies each of the user's moves.
 */
import * as Chess from '../engine/chess.js';
import { EVENTS, MODE_IDS } from '../core/constants.js';
import { $ } from '../core/dom.js';
import { normalizeSan } from '../engine/chess.js';
import { i18n } from '../core/i18n.js';

function classificationFor(delta) {
  if (delta < 20)   return { key: 'good',       note: i18n.t('classification.review.good') };
  if (delta < 60)   return { key: 'ok',         note: i18n.t('classification.review.ok') };
  if (delta < 150)  return { key: 'inaccuracy', note: i18n.t('classification.review.inaccuracy') };
  if (delta < 300)  return { key: 'mistake',    note: i18n.t('classification.review.mistake') };
  return              { key: 'blunder',    note: i18n.t('classification.review.blunder') };
}

export class ReviewController {
  constructor({ gameState, reviewState, practiceSnapshot, bus, hint }) {
    Object.assign(this, { gameState, reviewState, practiceSnapshot, bus, hint });
    $('#review-exit').addEventListener('click', () => this.exit());
    this.bus.on(EVENTS.REVIEW_START, () => this.enter());
  }

  enter() {
    const history = this.practiceSnapshot.has()
      ? this.practiceSnapshot.saved.history
      : this.gameState.getHistory();
    if (!history || history.length === 0) {
      this.bus.emit(EVENTS.TOAST, { message: i18n.t('ui.toast.noReview'), kind: 'info' });
      return;
    }
    $('#practice-view-standard').hidden = true;
    $('#practice-view-review').hidden = false;
    this.#run(history);
  }

  exit() {
    this.gameState.setMode(MODE_IDS.PRACTICE);
    this.reviewState.reset();
    this.hint.dismiss();

    $('#practice-view-standard').hidden = false;
    $('#practice-view-review').hidden = true;
    $('#review-running').hidden = true;
    $('#review-done').hidden = true;

    if (this.practiceSnapshot.has()) {
      this.practiceSnapshot.restoreInto(this.gameState);
    }
  }

  async #run(history) {
    this.gameState.setMode(MODE_IDS.REVIEW);
    this.reviewState.start();
    $('#review-running').hidden = false;
    $('#review-done').hidden = true;

    const workState = Chess.create();
    const moves = history.map(h => h.move);
    const total = moves.length;
    const fill = $('#review-progress-fill');
    const progTxt = $('#review-progress-text');
    const playAs = this.practiceSnapshot.saved?.playAs || this.gameState.playAs;

    for (let i = 0; i < total; i++) {
      const userMove = moves[i];
      const isUserTurn = userMove.color === playAs;

      let bestSan = null, classification = 'na', note = '', delta = 0;
      if (isUserTurn) {
        const best = Chess.search(workState, 2);
        let evalBest = 0;
        if (best && best.move) {
          const bestClone = { ...best.move };
          Chess.makeMove(workState, bestClone);
          evalBest = -Chess.evaluate(workState);
          bestSan = bestClone.san;
          Chess.undoLast(workState);
        }
        const actualClone = { ...userMove };
        Chess.makeMove(workState, actualClone);
        const evalAfter = -Chess.evaluate(workState);
        delta = evalBest - evalAfter;
        const c = classificationFor(delta);
        classification = c.key;
        note = c.note + (bestSan && classification !== 'good' && classification !== 'ok' ? ' ' + i18n.t('review.enginePreferred', { best: bestSan }) : '');
      } else {
        const clone = { ...userMove };
        Chess.makeMove(workState, clone);
      }

      this.reviewState.push({
        idx: i,
        move: userMove,
        san: userMove.san || '?',
        color: userMove.color,
        isUserTurn,
        classification,
        note,
        bestSan,
        delta
      });

      const pct = ((i + 1) / total) * 100;
      fill.style.width = pct + '%';
      progTxt.textContent = i18n.t('review.progress', { i: i + 1, total });
      await new Promise(r => setTimeout(r, 0));
    }

    this.reviewState.finish();
    $('#review-running').hidden = true;
    $('#review-done').hidden = false;
    this.#renderResults();
  }

  #renderResults() {
    const tallies = { good: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    for (const m of this.reviewState.moves) {
      if (m.isUserTurn && tallies[m.classification] !== undefined) tallies[m.classification]++;
    }
    const stats = $('#review-stats');
    stats.innerHTML = '';
    const labels = [
      ['good',       i18n.t('review.tally.best')],
      ['inaccuracy', i18n.t('review.tally.inaccurate')],
      ['mistake',    i18n.t('review.tally.mistake')],
      ['blunder',    i18n.t('review.tally.blunder')]
    ];
    for (const [k, label] of labels) {
      const el = document.createElement('div');
      el.className = `review-stat ${k}`;
      el.innerHTML = `<span class="stat-num">${tallies[k]}</span><span class="stat-lbl">${esc(label)}</span>`;
      stats.appendChild(el);
    }

    const list = $('#review-moves');
    list.innerHTML = '';
    for (const m of this.reviewState.moves) {
      if (!m.isUserTurn) continue;
      const row = document.createElement('div');
      row.className = 'review-row';
      if (this.reviewState.selectedIdx === m.idx) row.classList.add('active');
      const moveNum = Math.floor(m.idx / 2) + 1;
      const prefix = m.color === 'w' ? `${moveNum}.` : `${moveNum}…`;
      const badge = m.classification === 'ok'
        ? i18n.t('review.badge.ok')
        : i18n.t('review.badge.' + m.classification);
      row.innerHTML = `
        <span class="rv-num">${prefix}</span>
        <span class="rv-san">${esc(m.san)}</span>
        <span class="rv-note">${esc(m.note)}</span>
        <span class="rv-badge ${m.classification}">${esc(badge)}</span>`;
      row.addEventListener('click', () => this.#selectMove(m.idx));
      list.appendChild(row);
    }

    const detailEl = $('#review-detail');
    if (this.reviewState.selectedIdx === null) {
      detailEl.innerHTML = '';
    } else {
      const m = this.reviewState.moves[this.reviewState.selectedIdx];
      let html = `<b>${esc(m.san)}</b> — ${esc(m.note)}`;
      if (m.bestSan && m.bestSan !== normalizeSan(m.san)) {
        html += `<br><span class="muted small">${i18n.t('review.engineTopChoice', { san: esc(m.bestSan) })}</span>`;
      }
      detailEl.innerHTML = html;
    }
  }

  #selectMove(idx) {
    this.reviewState.select(idx);
    const history = this.practiceSnapshot.saved?.history || this.gameState.getHistory();
    const work = Chess.create();
    for (let i = 0; i < idx; i++) {
      const m = { ...history[i].move };
      Chess.makeMove(work, m);
    }
    // Use loadFen to replace state and emit change; preserve history up to idx.
    this.gameState.loadFen(Chess.toFEN(work));
    this.gameState.getChessState().history = history.slice(0, idx).map(h => ({ move: h.move, info: h.info }));
    this.gameState.lastMove = idx > 0 ? history[idx - 1].move : null;
    this.hint.dismiss();

    const entry = this.reviewState.moves[idx];
    if (entry.bestSan && entry.isUserTurn) {
      // Redraw the hint arrow pointing at the engine's pick.
      // We don't need to call hint.show() (which runs search again); we reuse
      // its draw helper by invoking showForMove if available. Fallback: noop.
      const legal = Chess.legalMoves(this.gameState.getChessState(), this.gameState.getTurn());
      const best = legal.find(m => {
        const c = { ...m };
        Chess.makeMove(this.gameState.getChessState(), c);
        Chess.undoLast(this.gameState.getChessState());
        return normalizeSan(c.san) === normalizeSan(entry.bestSan);
      });
      if (best && this.hint.showForMove) this.hint.showForMove(best, entry.bestSan, '');
    }

    this.#renderResults();
  }
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
