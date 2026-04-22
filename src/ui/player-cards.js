/**
 * Renders the top and bottom player cards (avatar / name / meta / timer).
 *
 * In non-commentator modes the cards are read-only and labels are driven by
 * the active GameMode. In Commentator mode the cards become editable:
 *   • click / Enter on the name → inline rename (contenteditable)
 *   • click the avatar → upload a photo (downscaled + persisted per match)
 * Photos fall back to the classic ♔/♚ glyph when none is set.
 */
import { EVENTS, DIFFICULTY_NAMES, MODE_IDS } from '../core/constants.js';
import { ClockService } from '../services/clock.js';
import { imageFileToDataUrl } from '../core/dom.js';

export class PlayerCardsView {
  constructor(els, gameState, prefs, modeRegistry, commentatorState, bus) {
    // els = { top, bottom, topName, botName, topMeta, botMeta, topTimer, botTimer }
    this.els = els;
    this.gameState = gameState;
    this.prefs = prefs;
    this.modeRegistry = modeRegistry;
    this.commentatorState = commentatorState;
    this.bus = bus;

    this.#wireEditing();

    bus.on(EVENTS.STATE_CHANGED, () => this.render());
    bus.on(EVENTS.CLOCK_TICK, (c) => this.#renderClocks(c));
    bus.on(EVENTS.COMMENTATOR_MATCH_LOADED,   () => this.render());
    bus.on(EVENTS.COMMENTATOR_NAVIGATED,      () => this.render());
    bus.on(EVENTS.COMMENTATOR_PLAYER_UPDATED, () => this.render());
    this.render();
  }

  // ------ render ------
  render() {
    const topIsBlack = this.gameState.orientation === 'w';
    const topColor = topIsBlack ? 'b' : 'w';
    const botColor = topIsBlack ? 'w' : 'b';

    const over = this.gameState.isGameOver();
    const turn = this.gameState.getTurn();
    this.els.top.classList.toggle('turn', turn === topColor && !over);
    this.els.bottom.classList.toggle('turn', turn === botColor && !over);

    const commentator = this.#isCommentator();
    this.els.top.classList.toggle('editable', commentator);
    this.els.bottom.classList.toggle('editable', commentator);

    this.#renderAvatar(this.els.top, topColor, topIsBlack ? '♛' : '♕');
    this.#renderAvatar(this.els.bottom, botColor, topIsBlack ? '♕' : '♛');

    this.els.topName.textContent = this.#name(topColor);
    this.els.botName.textContent = this.#name(botColor);
    this.els.topMeta.textContent = this.#meta(topColor);
    this.els.botMeta.textContent = this.#meta(botColor);

    // In commentator mode, the timer shows the imported game's clock at
    // the current ply (instead of the live practice clock) — or a dash
    // when no match / no clock annotations are available.
    if (this.gameState.mode === MODE_IDS.COMMENTATOR) {
      this.#renderCommentatorClocks(topColor, botColor);
    }
  }

  #renderCommentatorClocks(topColor, botColor) {
    const hasData = this.commentatorState?.hasMatch() && this.commentatorState.hasClockData();
    if (!hasData) {
      this.els.topTimer.textContent = '—';
      this.els.botTimer.textContent = '—';
      this.els.topTimer.classList.remove('low');
      this.els.botTimer.classList.remove('low');
      this.els.topTimer.title = '';
      this.els.botTimer.title = '';
      return;
    }
    const clocks = this.commentatorState.currentClocks();
    this.#paintClock(this.els.topTimer, clocks[topColor]);
    this.#paintClock(this.els.botTimer, clocks[botColor]);
  }

  #paintClock(el, bucket) {
    if (!bucket || !bucket.hasAny) {
      el.textContent = '—';
      el.classList.remove('low');
      el.title = '';
      return;
    }
    if (bucket.remaining != null) {
      el.textContent = formatSeconds(bucket.remaining);
      el.classList.toggle('low', bucket.remaining < 30);
      el.title = `${formatSeconds(bucket.elapsed)} used`;
    } else {
      // %emt only — show cumulative time used instead
      el.textContent = formatSeconds(bucket.elapsed);
      el.classList.remove('low');
      el.title = 'time used';
    }
  }

  #renderAvatar(cardEl, color, fallbackGlyph) {
    const avatar = cardEl.querySelector('.avatar');
    if (!avatar) return;
    const photo = this.#isCommentator()
      ? (this.commentatorState?.players?.[color]?.photoDataUrl || '')
      : '';
    if (photo) {
      avatar.style.backgroundImage = `url(${photo})`;
      avatar.classList.add('has-photo');
      avatar.textContent = '';
    } else {
      avatar.style.backgroundImage = '';
      avatar.classList.remove('has-photo');
      avatar.textContent = fallbackGlyph;
    }
    // Stash the color so the click handler knows who we're editing
    avatar.dataset.color = color;
    cardEl.dataset.color = color;
  }

  #renderClocks({ w, b, unlimited }) {
    // In commentator mode the live practice clock is irrelevant — the timer
    // cells show the imported game's clock from the PGN. Skip the update so
    // the practice ClockService ticks don't overwrite that.
    if (this.#isCommentator()) return;
    const topIsBlack = this.gameState.orientation === 'w';
    const topColor = topIsBlack ? 'b' : 'w';
    const botColor = topIsBlack ? 'w' : 'b';
    this.els.topTimer.textContent = ClockService.format(topColor === 'w' ? w : b, unlimited);
    this.els.botTimer.textContent = ClockService.format(botColor === 'w' ? w : b, unlimited);
    this.els.topTimer.classList.toggle('low', !unlimited && (topColor === 'w' ? w : b) < 30);
    this.els.botTimer.classList.toggle('low', !unlimited && (botColor === 'w' ? w : b) < 30);
  }

  // ------ label resolution ------
  #isCommentator() {
    return this.gameState.mode === MODE_IDS.COMMENTATOR && this.commentatorState?.hasMatch();
  }

  #name(color) {
    if (this.#isCommentator()) {
      const p = this.commentatorState.players[color] || {};
      return p.name && p.name.trim() ? p.name : (color === 'w' ? 'White' : 'Black');
    }
    const mode = this.modeRegistry.get(this.gameState.mode);
    return mode.playerCardName(color, this.gameState);
  }

  #meta(color) {
    if (this.#isCommentator()) {
      return color === 'w' ? 'White' : 'Black';
    }
    const mode = this.modeRegistry.get(this.gameState.mode);
    return mode.playerCardMeta(color, this.gameState, this.prefs, DIFFICULTY_NAMES);
  }

  // ------ inline editing (commentator only) ------
  #wireEditing() {
    // Bind once on construction. Handlers are active for all modes but guard
    // on `#isCommentator()` before doing anything.
    for (const [cardEl, nameEl] of [[this.els.top, this.els.topName], [this.els.bottom, this.els.botName]]) {
      nameEl.addEventListener('click', (e) => {
        if (!this.#isCommentator()) return;
        e.stopPropagation();
        this.#startEditName(nameEl, cardEl.dataset.color);
      });
      const avatar = cardEl.querySelector('.avatar');
      avatar?.addEventListener('click', (e) => {
        if (!this.#isCommentator()) return;
        e.stopPropagation();
        this.#pickPhoto(cardEl.dataset.color);
      });
    }
  }

  #startEditName(el, color) {
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('editing');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    el.focus();

    const finish = (commit) => {
      el.removeAttribute('contenteditable');
      el.classList.remove('editing');
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      if (commit) {
        const name = el.textContent.trim();
        this.commentatorState.setPlayer(color, { name });
      } else {
        this.render();   // revert
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  #pickPhoto(color) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await imageFileToDataUrl(f, 192);
        this.commentatorState.setPlayer(color, { photoDataUrl: dataUrl });
      } catch (err) {
        this.bus.emit(EVENTS.TOAST, { message: 'Could not load that image.', kind: 'warn' });
      }
    };
    input.click();
  }
}

function formatSeconds(total) {
  const sec = Math.max(0, Math.round(total));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
