/**
 * Practice tab controller. Owns the practice-game flow:
 *   - click interaction (select → move)
 *   - engine replies (scheduling + execution)
 *   - new game / undo / flip / hint / analyze controls
 *   - game-end banner + snapshot for review
 *   - coach whisper after each move
 *
 * All DOM wiring is limited to the Practice tab's controls; state mutations
 * go through GameState, and sound/particles/toast happen via services.
 */
import * as Chess from '../engine/chess.js';
import { EVENTS, MODE_IDS } from '../core/constants.js';
import { $, $$ } from '../core/dom.js';
import { i18n } from '../core/i18n.js';

export class PracticeController {
  constructor({ gameState, boardView, clock, bus, prefs, modals, promotion, hint,
                 banner, practiceSnapshot, modeRegistry, sound, particles, coachWhisper }) {
    Object.assign(this, {
      gameState, boardView, clock, bus, prefs, modals, promotion, hint,
      banner, practiceSnapshot, modeRegistry, sound, particles, coachWhisper
    });

    this.onUserRequestedReview = null;   // set by composition root

    this.#wireBoard();
    this.#wireControls();
    this.#wireTimeControls();
    this.#wireGameControls();
    this.#wireHint();
    this.#wireKeyboard();
  }

  // ============ Click interaction ============
  #wireBoard() {
    this.bus.on(EVENTS.BOARD_SQUARE_CLICKED, ({ r, c }) => this.#onSquareClick(r, c));
  }

  #onSquareClick(r, c) {
    const gs = this.gameState;
    if (gs.animating) return;
    const piece = gs.getPieceAt(r, c);
    const mode = this.modeRegistry.get(gs.mode);

    // If a piece is already selected, try to make the move.
    if (gs.selected) {
      const targetMove = gs.legalTargets.find(m => m.to[0] === r && m.to[1] === c);
      if (targetMove) { this.#tryMakeMove(targetMove); return; }
      if (piece && piece.c === gs.getTurn()) { gs.select(r, c); return; }
      gs.clearSelection();
      return;
    }
    if (!piece || piece.c !== gs.getTurn()) return;
    if (!mode || !mode.canUserMove(gs, gs.getTurn())) return;
    gs.select(r, c);
  }

  // ============ Move flow ============
  #tryMakeMove(move) {
    // If the chosen move has a promotion variant, present the picker first.
    const variants = this.gameState.legalTargets.filter(m =>
      m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
      m.to[0]   === move.to[0]   && m.to[1]   === move.to[1] && m.promotion);
    if (variants.length > 0) {
      this.promotion.show(variants, chosen => this.executeMove(chosen));
      return;
    }
    this.executeMove(move);
  }

  /** Animate, commit, then run mode-specific post-move behavior. */
  executeMove(move) {
    const gs = this.gameState;
    gs.setAnimating(true);
    this.hint.dismiss();
    // NOTE: don't clear selection here — that would emit STATE_CHANGED and
    // re-render the board, recreating the piece element we're about to animate.
    // Re-creating + transforming in the same tick skips the transition, so
    // `transitionend` never fires and `animating` never resets. gs.makeMove
    // already clears selection at commit time.

    this.boardView.animateMove(move, () => {
      gs.makeMove(move);                                          // state + SAN
      this.#afterMoveEffects(move);
      gs.setAnimating(false);
      this.#postMove(move);
    });
  }

  #afterMoveEffects(move) {
    if (move.castling)      this.sound.castle();
    else if (move.promotion) this.sound.promote();
    else if (move.captured)  this.sound.capture();
    else                     this.sound.move();

    if (move.captured) {
      const rect = this.boardView.rectOfSquare(move.to[0], move.to[1]);
      this.particles.spawnFromRect(rect, { count: 16, colors: ['#c25a3c', '#b88a3d', '#fbf6e8'] });
    }

    const st = this.gameState.getStatus();
    if (st.over) {
      if (this.gameState.mode === MODE_IDS.PRACTICE) this.handleGameOver(st);
    } else if (st.check) {
      this.sound.check();
      const k = this.#findKingSquare(this.gameState.getTurn());
      if (k) {
        const rect = this.boardView.rectOfSquare(k[0], k[1]);
        this.particles.spawnFromRect(rect, { count: 10, colors: ['#c25a3c'] });
      }
    }
  }

  #postMove(move) {
    const mode = this.modeRegistry.get(this.gameState.mode);
    if (mode && mode.id !== MODE_IDS.PRACTICE) {
      mode.onMove(move, this.#context());
      return;
    }
    this.afterUserMove(move);
  }

  #context() {
    return {
      practice: this,
      learn: this._learn,
      puzzles: this._puzzles,
      review: this._review,
      commentator: this._commentator
    };
  }

  /** Wire in companion controllers so modes can dispatch to them. */
  setCompanions({ learn, puzzles, review, commentator }) {
    this._learn = learn;
    this._puzzles = puzzles;
    this._review = review;
    this._commentator = commentator;
  }

  /** Called by PracticeMode.onMove — whisper + maybe trigger engine reply. */
  afterUserMove(move) {
    this.coachWhisper.whisper(move);
    if (this.gameState.mode !== MODE_IDS.PRACTICE) return;
    if (this.gameState.getTurn() !== this.gameState.playAs) setTimeout(() => this.#engineMove(), 180);
  }

  #engineMove() {
    const st = this.gameState.getStatus();
    if (st.over) return;
    const { move } = Chess.chooseMove(this.gameState.getChessState(), this.prefs.get('difficulty'));
    if (!move) return;
    this.executeMove(move);
  }

  // ============ Game over / snapshot ============
  handleGameOver(status) {
    this.clock.stop();
    const me = this.gameState.playAs;
    const userWon = status.winner && status.winner === me;
    const userLost = status.winner && status.winner !== me;
    let icon = '🏁', title = '', sub = '';

    if (status.result === 'checkmate') {
      title = i18n.t('game.result.checkmate');
      sub = i18n.t(status.winner === 'w' ? 'game.resultSub.whiteWins' : 'game.resultSub.blackWins');
      if (userWon)      { icon = '🏆'; this.sound.win(); this.particles.fireworks(); }
      else if (userLost) { icon = '🫡'; this.sound.lose(); }
    } else if (status.result === 'stalemate') {
      icon = '🤝'; title = i18n.t('game.result.stalemate'); sub = i18n.t('game.resultSub.stalemate'); this.sound.bad();
    } else if (status.result === 'draw-50') {
      icon = '🤝'; title = i18n.t('game.result.draw'); sub = i18n.t('game.resultSub.fiftyMove');
    } else if (status.result === 'draw-material') {
      icon = '🤝'; title = i18n.t('game.result.draw'); sub = i18n.t('game.resultSub.insufficient');
    } else if (status.result === 'time') {
      icon = '⏱'; title = i18n.t('game.result.timeout');
      sub = i18n.t(status.winner === 'w' ? 'game.resultSub.whiteWinsTime' : 'game.resultSub.blackWinsTime');
    }

    const shown = this.banner.show({ icon, title, sub });
    if (shown && this.gameState.mode === MODE_IDS.PRACTICE) {
      this.practiceSnapshot.capture(this.gameState);
    }
  }

  // ============ New game / flip / undo ============
  #wireControls() {
    $('#btn-flip').addEventListener('click', () => this.flipBoard());
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-new').addEventListener('click',  () => this.newGame());
    $('#btn-analyze').addEventListener('click', () => this.bus.emit('practice:analyze-request'));
  }

  newGame() {
    this.clock.stop();
    this.gameState.setMode(MODE_IDS.PRACTICE);
    this.gameState.resetToStart();
    this.gameState.setOrientation(this.prefs.get('playAs') === 'b' ? 'b' : 'w');
    this.gameState.setPlayAs(this.prefs.get('playAs'));
    this.banner.hide();
    this.hint.dismiss();
    this.coachWhisper.reset(i18n.t('coach.whisper.newGame'));
    this.clock.setControl(this.prefs.get('timeControl'));
    // If user plays Black, engine moves first.
    if (this.gameState.playAs === 'b') setTimeout(() => this.#engineMove(), 500);
    if (!this.clock.isUnlimited()) setTimeout(() => this.clock.start(), 200);
  }

  flipBoard() { this.gameState.flipOrientation(); }

  undo() {
    const state = this.gameState.getChessState();
    if (state.history.length === 0) return;
    this.hint.dismiss();
    this.gameState.undoLast();
    if (this.gameState.getTurn() !== this.gameState.playAs && state.history.length > 0) {
      this.gameState.undoLast();
    }
    this.banner.hide();
  }

  // ============ Settings — mode + color + time inline ============
  #wireGameControls() {
    $$('.diff-pill').forEach(p => p.addEventListener('click', () => {
      $$('.diff-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      this.prefs.set('difficulty', parseInt(p.dataset.diff));
    }));
    $$('.segmented .seg[data-color]').forEach(s => s.addEventListener('click', () => {
      $$('.segmented .seg[data-color]').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      let c = s.dataset.color;
      if (c === 'random') c = Math.random() < 0.5 ? 'w' : 'b';
      this.prefs.set('playAs', c);
    }));
  }

  #wireTimeControls() {
    $$('.seg[data-tc]').forEach(s => s.addEventListener('click', () => {
      $$('.seg[data-tc]').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      const tc = s.dataset.tc;
      const control = tc === 'none'
        ? { minutes: null, increment: 0 }
        : (() => { const [m, inc] = tc.split('+').map(n => parseInt(n)); return { minutes: m, increment: inc }; })();
      this.prefs.set('timeControl', control);
      this.clock.setControl(control);
    }));
  }

  // ============ Hint ============
  #wireHint() {
    $('#btn-hint').addEventListener('click', () => {
      const mode = this.modeRegistry.get(this.gameState.mode);
      if (!mode || !mode.canUserMove(this.gameState, this.gameState.getTurn())) {
        this.bus.emit(EVENTS.TOAST, { message: i18n.t('ui.toast.notYourTurn'), kind: 'info' });
        return;
      }
      this.hint.show();
    });
    this.bus.on('hint:play', ({ move }) => {
      // Grab a freshly-matched move from current legal moves so all flags are correct.
      const legal = Chess.legalMoves(this.gameState.getChessState(), this.gameState.getTurn());
      const fresh = legal.find(m =>
        m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
        m.to[0]   === move.to[0]   && m.to[1]   === move.to[1] &&
        (m.promotion || null) === (move.promotion || null));
      if (fresh) this.executeMove(fresh);
    });
  }

  // ============ Keyboard ============
  #wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const tag = t && t.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);

      if (e.key === 'Escape') {
        if (this.promotion.isOpen()) { this.promotion.cancel(); return; }
        if (this.modals.isOpen('settings-modal')) { this.modals.close('settings-modal'); return; }
        this.gameState.clearSelection();
        return;
      }
      if (typing) return;
      if (this.modals.stack.length > 0) return;

      if (e.key === 'f' || e.key === 'F') this.flipBoard();
      else if (e.key === 'n' || e.key === 'N') this.newGame();
      else if (e.key === 'h' || e.key === 'H') $('#btn-hint').click();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
    });
  }

  onEnterTab() {
    if (this.practiceSnapshot.has() && this.gameState.mode !== MODE_IDS.PRACTICE) {
      this.practiceSnapshot.restoreInto(this.gameState);
      return;
    }
    if (this.gameState.mode !== MODE_IDS.PRACTICE) this.newGame();
  }

  onExitTab() {
    if (this.gameState.mode === MODE_IDS.PRACTICE) this.practiceSnapshot.capture(this.gameState);
  }

  #findKingSquare(color) {
    const state = this.gameState.getChessState();
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p && p.p === 'k' && p.c === color) return [Math.floor(i / 8), i % 8];
    }
    return null;
  }
}
