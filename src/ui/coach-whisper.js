/**
 * Quick contextual bubbles shown in the Practice panel after each move.
 * Driven by the built-in heuristic coach's local evaluation.
 */
import * as Chess from '../engine/chess.js';
import { i18n } from '../core/i18n.js';

const TIP_KEYS = [
  'coach.whisper.tip1',
  'coach.whisper.tip2',
  'coach.whisper.tip3',
  'coach.whisper.tip4',
  'coach.whisper.tip5'
];

export class CoachWhisperView {
  constructor(rootEl, gameState) {
    this.root = rootEl;
    this.gameState = gameState;
  }

  reset(message) {
    this.root.innerHTML = `<div class="whisper-bubble">${message}</div>`;
  }

  /** Called by the practice controller after every user/engine move. */
  whisper(move) {
    const state = this.gameState.getChessState();
    const st = Chess.status(state);
    // Game-end feedback is handled by the banner elsewhere — stay quiet here.
    if (st.over) return;

    const evalCp = Chess.evaluate(state);
    const side = i18n.side(state.turn);
    const evalStr = evalCp === 0
      ? '0.0'
      : (evalCp > 0 ? `+${(evalCp / 100).toFixed(1)} · ${side}` : `${(evalCp / 100).toFixed(1)} · ${side}`);

    const b = document.createElement('div');
    b.className = 'whisper-bubble';
    let text = '';
    if (st.check) {
      text = i18n.t('coach.whisper.check', { side });
      b.classList.add('coach-warn');
    } else if (move.captured) {
      text = i18n.t('coach.whisper.capture', {
        piece: this.#pieceLabel(move.piece),
        target: this.#pieceLabel(move.captured),
        square: Chess.squareName(move.to[0], move.to[1]),
        eval: evalStr
      });
    } else if (move.castling) {
      text = i18n.t('coach.whisper.castle', { eval: evalStr });
      b.classList.add('coach-good');
    } else if (move.promotion) {
      text = i18n.t('coach.whisper.promote', { piece: this.#pieceLabel(move.promotion), eval: evalStr });
      b.classList.add('coach-good');
    } else {
      const tip = i18n.t(TIP_KEYS[Math.floor(Math.random() * TIP_KEYS.length)]);
      text = i18n.t('coach.whisper.tipWithEval', { tip, eval: evalStr });
    }
    b.innerHTML = text;
    this.root.appendChild(b);

    // Keep the latest three bubbles. Use the live `children` collection so
    // its length updates as we remove — `querySelectorAll` returns a static
    // NodeList whose length doesn't shrink, which loops forever.
    while (this.root.children.length > 3) this.root.firstElementChild.remove();
  }

  #pieceLabel(pieceChar) {
    const name = i18n.piece(pieceChar);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}
