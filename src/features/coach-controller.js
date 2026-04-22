/**
 * AI Coach tab controller. Wires the chat form, suggestion chips, status link,
 * provider-status readout, and Analyze (deep analysis) button.
 */
import * as Chess from '../engine/chess.js';
import { $, $$, markdownLite } from '../core/dom.js';

export class CoachController {
  constructor({ coach, gameState, bus, openSettings }) {
    Object.assign(this, { coach, gameState, bus, openSettings });
    this.#wire();
  }

  #wire() {
    $('#coach-status-change').addEventListener('click', () => this.openSettings());

    const send = async () => {
      const inp = $('#coach-text');
      const q = inp.value.trim();
      if (!q) return;
      inp.value = '';
      this.#addMessage('user', q);
      const thinking = this.#addMessage('bot', 'Thinking...', true);
      const ctx = this.#buildContext();
      const answer = await this.coach.ask(q, ctx);
      thinking.classList.remove('thinking');
      thinking.innerHTML = markdownLite(answer);
    };

    $('#coach-send').addEventListener('click', (e) => { e.preventDefault(); send(); });
    $('#coach-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('#coach-form').addEventListener('submit', (e) => e.preventDefault());

    $$('.sug').forEach(b => b.addEventListener('click', () => {
      $('#coach-text').value = b.dataset.q;
      send();
    }));

    // Practice's Analyze button deep-dives via coach
    this.bus.on('practice:analyze-request', async () => {
      this.bus.emit('tab:switch', { name: 'coach' });
      this.#addMessage('user', 'Analyze the current position.');
      const thinking = this.#addMessage('bot', 'Analyzing...', true);
      const ctx = this.#buildContext();
      const answer = await this.coach.ask('Give a clear analysis of this position: key features, threats, candidate moves, and a recommendation with reasons.', ctx);
      thinking.classList.remove('thinking');
      thinking.innerHTML = markdownLite(answer);
    });

    this.updateStatus();
  }

  updateStatus() {
    const valueEl = $('#coach-status-value');
    const { name, modelSuffix } = this.coach.describeCurrent();
    valueEl.textContent = name + modelSuffix;
  }

  greet() {
    this.#addMessage('bot', 'Hi — I\'m your chess coach. Ask me anything about the position. I explain ideas, tactics, and plans.');
  }

  #addMessage(role, text, thinking = false) {
    const chat = $('#coach-chat');
    const el = document.createElement('div');
    el.className = `msg ${role}${thinking ? ' thinking' : ''}`;
    el.innerHTML = role === 'bot'
      ? markdownLite(text)
      : text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }

  #buildContext() {
    const state = this.gameState.getChessState();
    const moves = Chess.legalMoves(state, state.turn);
    const sample = moves.slice(0, 16).map(m =>
      Chess.squareName(m.from[0], m.from[1]) + Chess.squareName(m.to[0], m.to[1]) + (m.promotion || ''));
    const evalCp = Chess.evaluate(state);
    const { move: best } = Chess.search(state, 2);
    let bestStr = null;
    if (best) {
      const clone = { ...best };
      Chess.makeMove(state, clone);
      Chess.undoLast(state);
      bestStr = clone.san || (Chess.squareName(best.from[0], best.from[1]) + Chess.squareName(best.to[0], best.to[1]));
    }
    return {
      fen: Chess.toFEN(state),
      turn: state.turn,
      lastMove: this.gameState.lastMove ? this.gameState.lastMove.san : null,
      moveHistory: state.history.map(h => h.move.san),
      legalSample: sample,
      evalScore: evalCp,
      bestMoveHint: bestStr
    };
  }
}
