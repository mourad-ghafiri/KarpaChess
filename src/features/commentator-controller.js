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
import { i18n } from '../core/i18n.js';

const ANALYSIS_DEPTH = 2;

const CLASSIFICATION_TONE = {
  brilliant: 'brilliant',
  best: 'good', good: 'good', inaccuracy: 'warn', mistake: 'bad', blunder: 'bad'
};

/** Per-classification quality score (0-100). Averaged across each player's
 *  moves for the end-of-match accuracy headline. Stays aligned with the
 *  brilliant/best/good/inaccuracy/mistake/blunder ladder shown in the insights
 *  panel. Brilliant matches best so the accuracy reads cleanly as a percent. */
const QUALITY_SCORE = {
  brilliant: 100, best: 100, good: 85, inaccuracy: 60, mistake: 30, blunder: 10
};

function classificationMeta(key) {
  return {
    glyph: i18n.t('classification.' + key + '.glyph'),
    label: i18n.t('classification.' + key + '.label'),
    tone:  CLASSIFICATION_TONE[key] || 'good'
  };
}

function classificationFor(delta) {
  if (delta < 20)   return 'best';
  if (delta < 60)   return 'good';
  if (delta < 150)  return 'inaccuracy';
  if (delta < 300)  return 'mistake';
  return              'blunder';
}

/** Static material total (centipawns) for `color` on the given state. Excludes
 *  the king so trades / sacs aren't dwarfed by king value. */
function materialOf(state, color) {
  let mat = 0;
  for (const piece of state.board) {
    if (!piece || piece.c !== color || piece.p === 'k') continue;
    mat += Chess.PIECE_VALUE[piece.p] || 0;
  }
  return mat;
}

/**
 * True when the player's move concedes ≥150 cp of material vs. the engine's
 * best 1-ply reply from the post-move position. Combined with a `best`-tier
 * delta this is what we surface as "brilliant" — the move is the engine's
 * top choice AND it apparently throws away a piece's worth of material.
 *
 * 150 cp ≈ 1½ pawns: catches a queen-for-pawn (~800), a knight sac (~320),
 * an exchange sac (R-for-B ~170). Plain trades / recaptures net to zero and
 * stay classified as `best`.
 */
function isSacrifice(state, move) {
  const color = move.color;
  const before = materialOf(state, color);
  const ourClone = { ...move };
  Chess.makeMove(state, ourClone);
  const oppBest = Chess.search(state, 1);
  let after = before;
  if (oppBest && oppBest.move) {
    const oppClone = { ...oppBest.move };
    Chess.makeMove(state, oppClone);
    after = materialOf(state, color);
    Chess.undoLast(state);
  }
  Chess.undoLast(state);
  return (before - after) >= 150;
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
    this._resultShownFor = null;   // node-id of the last node we opened the recap for

    this.#wireImport();
    this.#wireSamples();
    this.#wireNav();
    this.#wireBadgesToggle();
    this.#wireKeyboard();
    this.#wireResultModal();

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
    this.drawingOverlay.render();
    this.#renderInsightsForCurrent();
    this.#maybeShowAnnotTip();
  }

  onExitTab() {
    this.active = false;
    this.drawingOverlay.render();
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

  /** One-time hint card explaining the right-click annotation gestures. */
  #maybeShowAnnotTip() {
    const KEY = 'karpa.cmAnnotTipSeen';
    if (localStorage.getItem(KEY) === '1') return;
    const tip = $('#cm-annot-tip');
    if (!tip) return;
    tip.hidden = false;
    requestAnimationFrame(() => tip.classList.add('show'));
    const dismiss = () => {
      localStorage.setItem(KEY, '1');
      tip.classList.remove('show');
      setTimeout(() => { tip.hidden = true; }, 200);
    };
    $('#cm-annot-tip-dismiss')?.addEventListener('click', dismiss, { once: true });
    // Auto-dismiss after 12s if the user doesn't click
    setTimeout(() => {
      if (tip.classList.contains('show')) dismiss();
    }, 12000);
  }

  // ============ import ============
  #wireImport() {
    const ta = $('#cm-import-text');
    $('#cm-parse-btn')?.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { this.#toast(i18n.t('ui.toast.pasteFirst'), 'warn'); return; }
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
      if (!confirm(i18n.t('commentator.confirmClose'))) return;
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
      this.#toast(i18n.t('ui.toast.matchLoaded'), 'good');
    } catch (e) {
      this.#toast(i18n.t('ui.toast.parseFail', { error: e.message }), 'warn');
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
      btn.title = on ? i18n.t('commentator.badgesHide') : i18n.t('commentator.badgesShow');
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
    this.#maybeShowResultModal();
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
      this.insightsEl.innerHTML = `<div class="cm-insight-empty">${escapeHtml(i18n.t('coach.analyzing'))}</div>`;
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
    let key = classificationFor(delta);
    // Promote `best` to `brilliant` when the move is also a material sacrifice.
    // Re-parse `prev.fen` so the helper can mutate / undo without touching the
    // state we already worked with above.
    if (key === 'best' && isSacrifice(Chess.fromFEN(prev.fen), node.move)) {
      key = 'brilliant';
    }
    this.commentatorState.setClassification(node.id, key);
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
      <div class="cm-insight-empty">${escapeHtml(i18n.t('commentator.startPos'))}</div>`;
  }

  #paintInsights(node) {
    if (!this.insightsEl) return;
    const meta = classificationMeta(node.classification || 'good');
    const playedBy = i18n.side(node.move.color);
    const playedSan = node.san || '?';
    const bestSan = node.engineBest?.san || null;
    const score = node.engineBest?.score ?? null;

    const turnAtPrev = node.move.color;
    let evalStr = '';
    if (score != null) {
      const white = turnAtPrev === 'w' ? score : -score;
      const sign = white >= 0 ? '+' : '';
      evalStr = `${sign}${(white / 100).toFixed(2)}`;
    }

    const commentary = this.#composeCommentary(node, bestSan);

    const bestLine = bestSan && !sanEq(bestSan, playedSan)
      ? `<div class="cm-insight-line"><span class="cm-insight-k">${escapeHtml(i18n.t('commentator.enginePrefersLabel'))}</span><span class="cm-insight-v">${escapeHtml(bestSan)}</span></div>`
      : `<div class="cm-insight-line"><span class="cm-insight-k">${escapeHtml(i18n.t('commentator.engineAgreesLabel'))}</span><span class="cm-insight-v">${escapeHtml(i18n.t('commentator.topChoiceShort'))}</span></div>`;

    const evalHtml = evalStr
      ? `<div class="cm-insight-line"><span class="cm-insight-k">${escapeHtml(i18n.t('commentator.evalLabel'))}</span><span class="cm-insight-v">${evalStr}</span></div>`
      : '';

    this.insightsEl.innerHTML = `
      <div class="cm-insight-head tone-${meta.tone}">
        <span class="cm-insight-glyph">${escapeHtml(meta.glyph)}</span>
        <div class="cm-insight-title">
          <div class="cm-insight-label">${escapeHtml(meta.label)}</div>
          <div class="cm-insight-sub">${i18n.t('commentator.sidePlayed', { side: escapeHtml(playedBy), san: escapeHtml(playedSan) })}</div>
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
    if (move.captured)       tactics.push(i18n.t('commentator.act.captures', { piece: i18n.piece(move.captured) }));
    if (move.castling)       tactics.push(i18n.t(move.castling === 'k' ? 'commentator.act.castleK' : 'commentator.act.castleQ'));
    if (move.promotion)      tactics.push(i18n.t('commentator.act.promotes', { piece: i18n.piece(move.promotion) }));
    if (/\+$/.test(playedSan)) tactics.push(i18n.t('commentator.act.check'));
    if (/#$/.test(playedSan))  tactics.push(i18n.t('commentator.act.checkmate'));

    const lead = tactics.length
      ? i18n.t('commentator.act.leadIn', { tactics: joinWithAnd(tactics, i18n.t('commentator.act.and')) }) + ' '
      : '';

    const key = node.classification;
    const bestTag = bestSan ? `<b>${escapeHtml(bestSan)}</b>` : '';
    switch (key) {
      case 'brilliant':
        return escapeHtml(lead) + i18n.t('classification.brilliant.comment');
      case 'best':
        return escapeHtml(lead) + i18n.t('classification.best.comment');
      case 'good':
        return escapeHtml(lead) + (agreed
          ? i18n.t('classification.good.commentAgree')
          : i18n.t('classification.good.commentAlt', { best: bestTag }));
      case 'inaccuracy':
        return escapeHtml(lead) + (bestSan
          ? i18n.t('classification.inaccuracy.comment', { best: bestTag })
          : i18n.t('classification.inaccuracy.commentShort'));
      case 'mistake':
        return escapeHtml(lead) + (bestSan
          ? i18n.t('classification.mistake.comment', { best: bestTag })
          : i18n.t('classification.mistake.commentShort'));
      case 'blunder':
        return escapeHtml(lead) + (bestSan
          ? i18n.t('classification.blunder.comment', { best: bestTag })
          : i18n.t('classification.blunder.commentShort'));
    }
    return '';
  }

  // ============ board overlays ============
  #paintBoardBadge(node) {
    if (!this.badgeEl) return;
    if (!this.prefs.get('commentatorBadges')) { this.badgeEl.innerHTML = ''; return; }
    if (!node.classification || !node.move) { this.badgeEl.innerHTML = ''; return; }
    const meta = classificationMeta(node.classification);
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
    if (!this.commentatorState.hasMatch()) { t.textContent = i18n.t('commentator.noMatch'); return; }
    const header = [meta.White, meta.Black].filter(Boolean).join(' vs ') || i18n.t('commentator.untitled');
    const location = [meta.Event, meta.Site, meta.Date].filter(x => x && x !== '?').join(' · ');
    const plyStr = i18n.t('commentator.ply', { n: ply, total });
    const varStr = off ? ` <span class="cm-off-main">${escapeHtml(i18n.t('commentator.variation'))}</span>` : '';
    t.innerHTML = `<b>${escapeHtml(header)}</b>${location ? ' — ' + escapeHtml(location) : ''} · ${plyStr}${varStr}`;
    $('#cm-nav-exit-var').hidden = !off;
    document.body.classList.toggle('off-main-line', off);
  }

  #onMatchChanged() {
    if (!this.active) return;
    this._resultShownFor = null;
    if (this.modals.isOpen('cm-result-modal')) this.modals.close('cm-result-modal');
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

  // ============ end-of-match recap modal ============
  #wireResultModal() {
    $('#cm-result-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.modals.close('cm-result-modal');
    });
    // Click outside the modal body (i.e. on the backdrop) closes it.
    $('#cm-result-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.modals.close('cm-result-modal');
    });
  }

  /** Open the recap when the user lands on the end of a finished main line. */
  #maybeShowResultModal() {
    if (!this.commentatorState.hasMatch()) return;
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    if (cur.mainChild) return;                            // not the last node
    if (this.commentatorState.isOffMainLine()) return;    // exploring a variation

    const fen = this.commentatorState.currentFen();
    if (!fen) return;
    const status = Chess.status(Chess.fromFEN(fen));
    const pgnResult = (this.commentatorState.meta?.Result || '').trim();
    const isFinished = status.over || ['1-0', '0-1', '1/2-1/2'].includes(pgnResult);
    if (!isFinished) return;

    if (this._resultShownFor === cur.id) return;
    this._resultShownFor = cur.id;
    this.#openResultModal(status, pgnResult);
  }

  #openResultModal(status, pgnResult) {
    const opened = this.modals.open('cm-result-modal');
    if (!opened && !this.modals.isOpen('cm-result-modal')) return;

    // Headline
    const headlineEl = $('#cm-result-headline');
    if (headlineEl) headlineEl.textContent = this.#resultHeadline(status, pgnResult);

    // Player rows: photo + name, mirroring player-cards.js fallback glyphs.
    this.#paintResultPlayerRow('w', '♔');
    this.#paintResultPlayerRow('b', '♚');

    // Reset accuracy cells while we (re)compute.
    for (const pct of document.querySelectorAll('#cm-result-modal .cm-result-pct')) {
      pct.textContent = '—';
    }
    const statusEl = $('#cm-result-status');
    if (statusEl) {
      statusEl.textContent = i18n.t('commentator.result.analyzing');
      statusEl.hidden = false;
    }

    // Make sure every main-line move has a classification, then paint accuracy.
    this.#analyzeAllAndPaintAccuracy();
  }

  #paintResultPlayerRow(color, fallbackGlyph) {
    const row = document.querySelector(`#cm-result-modal .cm-result-player[data-color="${color}"]`);
    if (!row) return;
    const avatar = row.querySelector('.avatar');
    const nameEl = row.querySelector('.cm-result-name');
    const player = this.commentatorState.players?.[color] || {};
    const photo  = player.photoDataUrl || '';
    if (avatar) {
      if (photo) {
        avatar.style.backgroundImage = `url(${photo})`;
        avatar.classList.add('has-photo');
        avatar.textContent = '';
      } else {
        avatar.style.backgroundImage = '';
        avatar.classList.remove('has-photo');
        avatar.textContent = fallbackGlyph;
      }
    }
    if (nameEl) {
      const name = (player.name || '').trim();
      nameEl.textContent = name || i18n.side(color);
    }
  }

  #resultHeadline(status, pgnResult) {
    if (status.result === 'checkmate' && status.winner) {
      const winner = i18n.side(status.winner);
      return i18n.t('commentator.result.checkmate', { winner });
    }
    if (status.result === 'stalemate') return i18n.t('commentator.result.stalemate');
    if (status.over && !status.winner)  return i18n.t('commentator.result.drawnGame');

    // FEN isn't itself terminal — fall back to the PGN's [Result] tag (resignation, etc.).
    if (pgnResult === '1-0')      return i18n.t('commentator.result.whiteWins');
    if (pgnResult === '0-1')      return i18n.t('commentator.result.blackWins');
    if (pgnResult === '1/2-1/2')  return i18n.t('commentator.result.drawnGame');
    return '';
  }

  async #analyzeAllAndPaintAccuracy() {
    const main = this.commentatorState.mainLine();
    for (const n of main) {
      if (!n.move) continue;
      if (n.classification != null) continue;
      this.#analyseNode(n);
      // Yield to the browser between searches so the modal stays responsive.
      await new Promise(r => setTimeout(r, 0));
      if (!this.modals.isOpen('cm-result-modal')) return;
    }
    this.#paintAccuracy();
    const statusEl = $('#cm-result-status');
    if (statusEl) statusEl.hidden = true;
  }

  #paintAccuracy() {
    const totals = { w: { sum: 0, n: 0 }, b: { sum: 0, n: 0 } };
    for (const n of this.commentatorState.mainLine()) {
      if (!n.move || n.classification == null) continue;
      const score = QUALITY_SCORE[n.classification];
      if (score == null) continue;
      const bucket = totals[n.move.color];
      if (!bucket) continue;
      bucket.sum += score;
      bucket.n   += 1;
    }
    for (const color of ['w', 'b']) {
      const cell = document.querySelector(
        `#cm-result-modal .cm-result-player[data-color="${color}"] .cm-result-pct`
      );
      if (!cell) continue;
      const b = totals[color];
      cell.textContent = b.n > 0 ? `${Math.round(b.sum / b.n)}%` : '—';
    }
  }

  #toast(message, kind = 'info') {
    this.bus.emit(EVENTS.TOAST, { message, kind });
  }
}

function sanEq(a, b) {
  if (!a || !b) return false;
  return a.replace(/[+#]/g, '') === b.replace(/[+#]/g, '');
}

/** Join ['a', 'b', 'c'] as 'a, b and c' with localized "and" glue. */
function joinWithAnd(arr, and) {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return arr.join(' ' + and + ' ');
  return arr.slice(0, -1).join(', ') + ' ' + and + ' ' + arr[arr.length - 1];
}
