/**
 * Quick contextual bubbles shown in the Practice panel after each move.
 * Driven by the built-in heuristic coach's local evaluation.
 */
import * as Chess from '../engine/chess.js';
import { PIECE_NAME_LOWER } from '../core/constants.js';

const TIPS = [
  'Nice — now what about your next piece?',
  'Every move, ask: am I improving my worst piece?',
  'Watch for forks and tactics after each exchange.',
  'Keep your king safe. Castle if you haven\'t.',
  'Look for pieces without defenders — yours and theirs.'
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
    const turn = state.turn === 'w' ? 'White' : 'Black';
    const evalStr = evalCp === 0
      ? 'even'
      : (evalCp > 0 ? `+${(evalCp / 100).toFixed(1)} for ${turn}` : `${(evalCp / 100).toFixed(1)} for ${turn}`);

    const b = document.createElement('div');
    b.className = 'whisper-bubble';
    let text = '';
    if (st.check) {
      text = `⚠️ <b>${turn}</b> is in check!`;
      b.classList.add('coach-warn');
    } else if (move.captured) {
      text = `💥 ${this.#name(move.piece)} takes ${this.#name(move.captured)} on ${Chess.squareName(move.to[0], move.to[1])}. Eval: ${evalStr}.`;
    } else if (move.castling) {
      text = `🏰 Nicely castled! King safety matters. Eval: ${evalStr}.`;
      b.classList.add('coach-good');
    } else if (move.promotion) {
      text = `✨ Promoted to ${this.#name(move.promotion)}! Eval: ${evalStr}.`;
      b.classList.add('coach-good');
    } else {
      text = `${TIPS[Math.floor(Math.random() * TIPS.length)]} (${evalStr})`;
    }
    b.innerHTML = text;
    this.root.appendChild(b);

    // Keep the latest three bubbles. Use the live `children` collection so
    // its length updates as we remove — `querySelectorAll` returns a static
    // NodeList whose length doesn't shrink, which loops forever.
    while (this.root.children.length > 3) this.root.firstElementChild.remove();
  }

  #name(pieceChar) {
    const name = PIECE_NAME_LOWER[pieceChar];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : pieceChar;
  }
}
