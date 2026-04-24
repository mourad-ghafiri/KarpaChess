/**
 * Base class for every AI Coach provider. Defines the shared prompt and the
 * context block rendering used by all LLM calls. Concrete subclasses only
 * need to implement `ask(question, ctx)` with their provider-specific HTTP.
 */
import { i18n } from '../../core/i18n.js';

export function coachSystemPrompt() {
  return i18n.t('coach.system', { language: i18n.englishName(i18n.lang) });
}

export function buildContextBlock(ctx) {
  const parts = [];
  parts.push(`FEN: ${ctx.fen}`);
  parts.push(`Side to move: ${ctx.turn === 'w' ? 'White' : 'Black'}`);
  if (ctx.lastMove) parts.push(`Last move: ${ctx.lastMove}`);
  if (ctx.moveHistory?.length) parts.push(`Move history (SAN): ${ctx.moveHistory.join(' ')}`);
  if (ctx.legalSample?.length) parts.push(`Some legal moves: ${ctx.legalSample.join(', ')}`);
  if (ctx.evalScore !== undefined) parts.push(`Built-in engine evaluation (centipawns, side-to-move): ${ctx.evalScore}`);
  if (ctx.bestMoveHint) parts.push(`Engine's top pick: ${ctx.bestMoveHint}`);
  return parts.join('\n');
}

export class AIProvider {
  /** @param {{get:(k:string)=>any}} prefs — read-only access to user prefs */
  constructor(prefs) {
    this.prefs = prefs;
  }

  /** @returns {string} stable id like 'anthropic', 'openai' */
  get id() { throw new Error('subclass must implement id'); }

  /** @returns {string} human label like 'Anthropic · Claude' */
  get name() { throw new Error('subclass must implement name'); }

  /** @returns {boolean} — true if the provider requires an API key */
  get needsKey() { return true; }

  /** @returns {boolean} — true if the provider has a configurable URL */
  get hasUrl() { return false; }

  /** @returns {string} the current model id, from prefs */
  getModel() { return this.prefs.get(this.id + 'Model'); }

  /** @returns {string|null} the current API key, from prefs */
  getKey() { return this.prefs.get(this.id + 'Key') || null; }

  /** @returns {string|null} the current URL, if applicable */
  getUrl() { return this.hasUrl ? this.prefs.get(this.id + 'Url') : null; }

  /** @param {string} question — user's natural-language ask
   *  @param {object} ctx — position context from buildCoachContext
   *  @returns {Promise<string>} */
  async ask(question, ctx) { throw new Error('subclass must implement ask'); }

  /** Shared messages shape used by every OpenAI-style provider. */
  _messages(ctx, question) {
    return [
      { role: 'system', content: coachSystemPrompt() },
      { role: 'user',   content: `Position:\n${buildContextBlock(ctx)}\n\nQuestion: ${question}` }
    ];
  }
}
