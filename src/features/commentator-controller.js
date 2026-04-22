/**
 * CommentatorController — orchestrates the Commentator tab.
 *
 *   • Import (paste / file / sample) → parse → load into state
 *   • Navigate (buttons, move-tree clicks, keyboard)
 *   • Auto-analysis: every time the cursor lands on a new ply we run a
 *     short engine search, classify the played move (best / good /
 *     inaccuracy / mistake / blunder), cache it on the node, render an
 *     insights panel, paint a classification badge on the destination
 *     square, and drop a green arrow for the engine's top choice when it
 *     differs.
 *
 *  Board is the SHARED BoardView. Tab enter switches gameState.mode to
 *  COMMENTATOR and loads the current node's FEN; tab exit restores the
 *  practice snapshot.
 */
import * as Chess from '../engine/chess.js';
import { EVENTS, MODE_IDS } from '../core/constants.js';
import { $, escapeHtml } from '../core/dom.js';
import { COMMENTATOR_SAMPLES } from './commentator-samples.js';

const ANALYSIS_DEPTH = 2;

const CLASSIFICATION_META = {
  best:       { glyph: '★',  label: 'Best move',   tone: 'good' },
  good:       { glyph: '✓',  label: 'Solid',        tone: 'good' },
  inaccuracy: { glyph: '?!', label: 'Inaccuracy',   tone: 'warn' },
  mistake:    { glyph: '?',  label: 'Mistake',      tone: 'bad'  },
  blunder:    { glyph: '??', label: 'Blunder',      tone: 'bad'  }
};

function classificationFor(delta) {
  if (delta < 20)   return 'best';
  if (delta < 60)   return 'good';
  if (delta < 150)  return 'inaccuracy';
  if (delta < 300)  return 'mistake';
  return              'blunder';
}

export class CommentatorController {
  constructor({ gameState, boardView, bus, commentatorState, drawingOverlay, moveTreeView,
                 modals, hint, practiceSnapshot, prefs }) {
    Object.assign(this, { gameState, boardView, bus, commentatorState, drawingOverlay,
                          moveTreeView, modals, hint, practiceSnapshot, prefs });

    this.active = false;
    this.insightsEl = $('#cm-insights');
    this.badgeEl    = $('#cm-insight-overlay');
    this._analyzing = null;  // guard against overlapping async analyses

    this.#wireImport();
    this.#wireSamples();
    this.#wireNav();
    this.#wireBadgesToggle();
    this.#wireKeyboard();

    bus.on(EVENTS.COMMENTATOR_MATCH_LOADED, () => this.#onMatchChanged());
    bus.on(EVENTS.COMMENTATOR_NAVIGATED,    () => this.#onNavigated());
    bus.on(EVENTS.PREFS_CHANGED, (patch) => {
      if (patch && 'commentatorBadges' in patch) this.#renderInsightsForCurrent();
    });
  }

  // ============ board interaction (invoked from CommentatorMode.onMove) ============
  handleBoardMove(move) {
    if (!this.commentatorState.hasMatch()) return;
    this.commentatorState.handleBoardMove(move);
  }

  // ============ tab lifecycle ============
  onEnterTab() {
    this.active = true;
    if (this.gameState.mode === MODE_IDS.PRACTICE) {
      this.practiceSnapshot.capture(this.gameState);
    }
    if (!this.commentatorState.hasMatch()) this.commentatorState.restore();

    this.gameState.setMode(MODE_IDS.COMMENTATOR);

    if (this.commentatorState.hasMatch()) {
      this.#syncBoardToCurrentNode();
    } else {
      this.gameState.resetToStart();
    }

    this.#toggleViews();
    this.#renderStatus();
    this.moveTreeView.render();
    this.drawingOverlay.enable(true);
    this.drawingOverlay.render();
    this.#renderInsightsForCurrent();
  }

  onExitTab() {
    this.active = false;
    this.drawingOverlay.enable(false);
    document.body.classList.remove('off-main-line', 'cm-has-match');
    for (const c of [...document.body.classList]) {
      if (c.startsWith('draw-tool-')) document.body.classList.remove(c);
    }
    this.#clearBoardBadge();
    this.hint.dismiss();
    if (this.practiceSnapshot.has()) {
      this.practiceSnapshot.restoreInto(this.gameState);
    }
  }

  // ============ import ============
  #wireImport() {
    const ta = $('#cm-import-text');
    $('#cm-parse-btn')?.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { this.#toast('Paste PGN or a move list first.', 'warn'); return; }
      this.#importFromText(text);
    });

    $('#cm-file-btn')?.addEventListener('click', () => $('#cm-file').click());
    $('#cm-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await f.text();
      ta.value = text;
      this.#importFromText(text);
      e.target.value = '';
    });

    $('#cm-new-match')?.addEventListener('click', () => {
      if (!confirm('Close this match and return to import?')) return;
      this.commentatorState.clear();
      $('#cm-import-text').value = '';
      this.gameState.resetToStart();
    });
  }

  #wireSamples() {
    const host = $('#cm-samples');
    if (!host) return;
    host.innerHTML = '';
    for (const s of COMMENTATOR_SAMPLES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cm-sample';
      card.innerHTML = `
        <div class="cm-sample-title">${escapeHtml(s.title)}</div>
        <div class="cm-sample-byline">${escapeHtml(s.byline)}</div>
        <div class="cm-sample-tag">${escapeHtml(s.tag)}</div>`;
      card.addEventListener('click', () => this.#importFromText(s.pgn));
      host.appendChild(card);
    }
  }

  #importFromText(text) {
    try {
      this.commentatorState.loadFromPgn(text);
      this.#toast('Match loaded.', 'good');
    } catch (e) {
      this.#toast('Could not parse: ' + e.message, 'warn');
    }
  }

  #toggleViews() {
    const has = this.commentatorState.hasMatch();
    const imp   = $('#cm-import-view');
    const study = $('#cm-study-view');
    if (imp)   imp.hidden   = has;
    if (study) study.hidden = !has;
    document.body.classList.toggle('cm-has-match', has);
  }

  // ============ navigation ============
  #wireNav() {
    $('#cm-nav-first')?.addEventListener('click', () => this.commentatorState.first());
    $('#cm-nav-prev')?.addEventListener('click',  () => this.commentatorState.prev());
    $('#cm-nav-next')?.addEventListener('click',  () => this.commentatorState.next());
    $('#cm-nav-last')?.addEventListener('click',  () => this.commentatorState.last());
    $('#cm-nav-exit-var')?.addEventListener('click', () => this.commentatorState.exitVariation());
  }

  /** Eye-toggle that shows/hides the on-board classification badge. Off by
   *  default so casual viewers don't see the engine's verdict. */
  #wireBadgesToggle() {
    const btn = $('#cm-badges-toggle');
    if (!btn) return;
    const sync = () => {
      const on = !!this.prefs.get('commentatorBadges');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Hide engine icons on board' : 'Show engine icons on board';
    };
    sync();
    btn.addEventListener('click', () => {
      this.prefs.set('commentatorBadges', !this.prefs.get('commentatorBadges'));
      sync();
    });
  }

  #onNavigated() {
    if (!this.active) return;
    this.#syncBoardToCurrentNode();
    this.#renderStatus();
    this.#renderInsightsForCurrent();
  }

  #syncBoardToCurrentNode() {
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    this.gameState.loadFen(cur.fen, cur.move || null);
  }

  // ============ per-ply analysis ============
  /**
   * If the current node hasn't been analysed yet, do it now (async so the UI
   * stays responsive). Then paint the insights panel, board badge and the
   * engine's preferred-move arrow.
   */
  async #renderInsightsForCurrent() {
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    this.#clearBoardBadge();
    this.hint.dismiss();

    if (!cur.move) {
      this.#renderStartingInsight();
      return;
    }

    if (cur.classification == null) {
      this.insightsEl.innerHTML = '<div class="cm-insight-empty">Analysing…</div>';
      // Await a frame so the placeholder paints before the search blocks.
      await new Promise(r => requestAnimationFrame(() => r()));
      this.#analyseNode(cur);
      // Guard: user may have navigated away while we were searching.
      if (this.commentatorState.currentNode() !== cur) return;
    }

    this.#paintInsights(cur);
    this.#paintBoardBadge(cur);
    this.#drawEngineBestArrow(cur);
  }

  /**
   * Synchronously compute classification + engineBest for this node.
   * Cached onto the node via commentatorState.set*, so later revisits skip
   * the search entirely.
   */
  #analyseNode(node) {
    const prev = this.#parentNode(node);
    if (!prev) return;
    const preState = Chess.fromFEN(prev.fen);

    // Engine's top choice from prev position
    let bestSan = null, evalBest = 0;
    const best = Chess.search(preState, ANALYSIS_DEPTH);
    if (best && best.move) {
      const bClone = { ...best.move };
      Chess.makeMove(preState, bClone);
      evalBest = -Chess.evaluate(preState);
      bestSan = bClone.san;
      Chess.undoLast(preState);
    }

    // Actual move's resulting eval (from the same side-to-move perspective)
    const actual = { ...node.move };
    Chess.makeMove(preState, actual);
    const evalAfter = -Chess.evaluate(preState);
    Chess.undoLast(preState);

    const delta = Math.max(0, evalBest - evalAfter);
    this.commentatorState.setClassification(node.id, classificationFor(delta));
    if (bestSan) this.commentatorState.setEngineBest(node.id, bestSan, evalBest);
    this.moveTreeView.render();
  }

  #parentNode(node) {
    const idx = this.commentatorState.path.indexOf(node);
    return idx > 0 ? this.commentatorState.path[idx - 1] : null;
  }

  // ============ insights panel ============
  #renderStartingInsight() {
    if (!this.insightsEl) return;
    this.insightsEl.innerHTML = `
      <div class="cm-insight-empty">Starting position. Click ▶ or press → to step into the game.</div>`;
  }

  #paintInsights(node) {
    if (!this.insightsEl) return;
    const meta = CLASSIFICATION_META[node.classification] || CLASSIFICATION_META.good;
    const playedBy = node.move.color === 'w' ? 'White' : 'Black';
    const playedSan = node.san || '?';
    const bestSan = node.engineBest?.san || null;
    const score = node.engineBest?.score ?? null;

    // Evaluation line (the engineBest.score is in centipawns from the side-
    // to-move POV at the prev node — white-positive when it's white to move)
    const turnAtPrev = node.move.color;   // whose move it was at the prev node
    let evalStr = '';
    if (score != null) {
      const white = turnAtPrev === 'w' ? score : -score;
      const sign = white >= 0 ? '+' : '';
      evalStr = `${sign}${(white / 100).toFixed(2)}`;
    }

    // Small natural-language line — no LLM, just templated phrases.
    const commentary = this.#composeCommentary(node, bestSan);

    const bestLine = bestSan && !sanEq(bestSan, playedSan)
      ? `<div class="cm-insight-line"><span class="cm-insight-k">Engine prefers</span><span class="cm-insight-v">${escapeHtml(bestSan)}</span></div>`
      : `<div class="cm-insight-line"><span class="cm-insight-k">Engine agrees</span><span class="cm-insight-v">top choice</span></div>`;

    const evalHtml = evalStr
      ? `<div class="cm-insight-line"><span class="cm-insight-k">Eval</span><span class="cm-insight-v">${evalStr}</span></div>`
      : '';

    this.insightsEl.innerHTML = `
      <div class="cm-insight-head tone-${meta.tone}">
        <span class="cm-insight-glyph">${meta.glyph}</span>
        <div class="cm-insight-title">
          <div class="cm-insight-label">${meta.label}</div>
          <div class="cm-insight-sub">${escapeHtml(playedBy)} played <b>${escapeHtml(playedSan)}</b></div>
        </div>
      </div>
      <div class="cm-insight-body">
        ${bestLine}
        ${evalHtml}
      </div>
      ${commentary ? `<div class="cm-insight-comment">${commentary}</div>` : ''}
      ${node.comment ? `<div class="cm-insight-pgn-comment">“${escapeHtml(node.comment)}”</div>` : ''}`;
  }

  /** Short sentence explaining the classification, based on move features. */
  #composeCommentary(node, bestSan) {
    const move = node.move;
    const playedSan = node.san || '';
    const agreed = bestSan && sanEq(bestSan, playedSan);

    const tactics = [];
    if (move.captured)       tactics.push(`captures a ${pieceName(move.captured)}`);
    if (move.castling)       tactics.push(move.castling === 'k' ? 'castles kingside' : 'castles queenside');
    if (move.promotion)      tactics.push(`promotes to a ${pieceName(move.promotion)}`);
    if (/\+$/.test(playedSan)) tactics.push('gives check');
    if (/#$/.test(playedSan))  tactics.push('delivers checkmate');

    const lead = tactics.length ? `Move ${tactics.join(' and ')}. ` : '';

    switch (node.classification) {
      case 'best':
        return escapeHtml(lead) + 'This is the engine\'s top pick — no better move on the board.';
      case 'good':
        return escapeHtml(lead) + (agreed
          ? 'Engine approves — a solid choice.'
          : `A reasonable continuation. The engine slightly preferred <b>${escapeHtml(bestSan || '')}</b>.`);
      case 'inaccuracy':
        return escapeHtml(lead) + (bestSan
          ? `Small slip — <b>${escapeHtml(bestSan)}</b> would have been a touch stronger.`
          : 'Small slip.');
      case 'mistake':
        return escapeHtml(lead) + (bestSan
          ? `A mistake — <b>${escapeHtml(bestSan)}</b> was noticeably better.`
          : 'A mistake.');
      case 'blunder':
        return escapeHtml(lead) + (bestSan
          ? `A blunder. <b>${escapeHtml(bestSan)}</b> was needed.`
          : 'A blunder.');
    }
    return '';
  }

  // ============ board overlays ============
  #paintBoardBadge(node) {
    if (!this.badgeEl) return;
    if (!this.prefs.get('commentatorBadges')) { this.badgeEl.innerHTML = ''; return; }
    const meta = CLASSIFICATION_META[node.classification];
    if (!meta || !node.move) { this.badgeEl.innerHTML = ''; return; }
    const [tr, tc] = node.move.to;
    const orient = this.gameState.orientation;
    const vr = orient === 'w' ? tr : 7 - tr;
    const vc = orient === 'w' ? tc : 7 - tc;
    const cx = vc + 0.86;
    const cy = vr + 0.14;
    this.badgeEl.innerHTML = `
      <g class="cm-badge tone-${meta.tone}">
        <circle cx="${cx}" cy="${cy}" r="0.2"></circle>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${escapeHtml(meta.glyph)}</text>
      </g>`;
  }

  #clearBoardBadge() {
    if (this.badgeEl) this.badgeEl.innerHTML = '';
  }

  /** Green arrow for the engine's preferred move when it differs from played. */
  #drawEngineBestArrow(node) {
    if (!node.engineBest || !node.engineBest.san) return;
    if (sanEq(node.engineBest.san, node.san)) return;   // agreed — no arrow
    const prev = this.#parentNode(node);
    if (!prev) return;
    const preState = Chess.fromFEN(prev.fen);
    const legal = Chess.legalMoves(preState, preState.turn);
    const want = node.engineBest.san.replace(/[+#]/g, '');
    let pick = null;
    for (const m of legal) {
      const clone = { ...m };
      Chess.makeMove(preState, clone);
      Chess.undoLast(preState);
      if ((clone.san || '').replace(/[+#]/g, '') === want) { pick = m; break; }
    }
    if (pick && this.hint.showForMove) this.hint.showForMove(pick, node.engineBest.san, '');
  }

  // ============ keyboard ============
  #wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if      (e.key === 'ArrowLeft')  { e.preventDefault(); this.commentatorState.prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.commentatorState.next(); }
      else if (e.key === 'Home')       { e.preventDefault(); this.commentatorState.first(); }
      else if (e.key === 'End')        { e.preventDefault(); this.commentatorState.last(); }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); this.commentatorState.exitVariation(); }
    });
  }

  // ============ status line ============
  #renderStatus() {
    const ply = this.commentatorState.currentPly();
    const main = this.commentatorState.mainLine();
    const total = main.length - 1;
    const off = this.commentatorState.isOffMainLine();
    const meta = this.commentatorState.meta;
    const t = $('#cm-status');
    if (!t) return;
    if (!this.commentatorState.hasMatch()) { t.textContent = 'No match loaded.'; return; }
    const header = [meta.White, meta.Black].filter(Boolean).join(' vs ') || 'Untitled';
    const location = [meta.Event, meta.Site, meta.Date].filter(x => x && x !== '?').join(' · ');
    t.innerHTML = `<b>${escapeHtml(header)}</b>${location ? ' — ' + escapeHtml(location) : ''} · ply ${ply}/${total}${off ? ' <span class="cm-off-main">(variation)</span>' : ''}`;
    $('#cm-nav-exit-var').hidden = !off;
    document.body.classList.toggle('off-main-line', off);
  }

  #onMatchChanged() {
    if (!this.active) return;
    this.#toggleViews();
    if (this.commentatorState.hasMatch()) {
      this.#syncBoardToCurrentNode();
    } else {
      this.gameState.resetToStart();
    }
    this.#renderStatus();
    this.moveTreeView.render();
    this.drawingOverlay.render();
    this.#renderInsightsForCurrent();
  }

  #toast(message, kind = 'info') {
    this.bus.emit(EVENTS.TOAST, { message, kind });
  }
}

function sanEq(a, b) {
  if (!a || !b) return false;
  return a.replace(/[+#]/g, '') === b.replace(/[+#]/g, '');
}

function pieceName(ch) {
  return { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[ch] || 'piece';
}
