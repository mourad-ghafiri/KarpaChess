/**
 * Facade over every coach. Given the user's chosen provider in prefs, either
 * dispatches to the built-in heuristic coach or to a concrete AIProvider
 * from the registry.
 *
 * If an API call fails, the caller gets both the error message and a built-in
 * fallback answer, so the coach chat never leaves the user empty-handed.
 */
import { i18n } from '../core/i18n.js';

export class CoachService {
  /**
   * @param {ProviderRegistry} registry
   * @param {PrefsStore} prefs
   * @param {BuiltinCoach} builtin
   */
  constructor(registry, prefs, builtin) {
    this.registry = registry;
    this.prefs = prefs;
    this.builtin = builtin;
  }

  /** Look up current provider description for the status bar. */
  describeCurrent() {
    const id = this.prefs.get('provider');
    if (id === 'builtin') return { name: i18n.t('coach.builtin.name'), modelSuffix: '' };
    const p = this.registry.get(id);
    if (!p) return { name: id, modelSuffix: ' · ' + i18n.t('coach.status.unknown') };
    if (p.needsKey && !p.getKey()) return { name: p.name, modelSuffix: ' · ' + i18n.t('coach.status.missingKey') };
    const model = p.getModel();
    return { name: p.name, modelSuffix: model ? ` · ${model}` : '' };
  }

  /** Answer a position-grounded question. */
  async ask(question, ctx) {
    const id = this.prefs.get('provider');
    if (id === 'builtin') return this.builtin.ask(question, ctx);
    const provider = this.registry.get(id);
    if (!provider) return this.builtin.ask(question, ctx);

    try {
      return await provider.ask(question, ctx);
    } catch (err) {
      return i18n.t('coach.fallbackPrefix', {
        provider: provider.name,
        error: err.message,
        fallback: this.builtin.ask(question, ctx)
      });
    }
  }
}
