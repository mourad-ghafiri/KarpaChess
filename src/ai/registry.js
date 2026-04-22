/**
 * Provider registry. Holds AIProvider instances keyed by id. The composition
 * root registers every concrete provider once; everything else looks up by id.
 *
 * Open/Closed principle: adding a provider means one `registry.register(…)`
 * line — no edits to existing provider files.
 */
export class ProviderRegistry {
  constructor() { this.map = new Map(); }

  register(provider) { this.map.set(provider.id, provider); return this; }

  get(id) { return this.map.get(id) || null; }

  has(id) { return this.map.has(id); }

  /** @returns {AIProvider[]} in insertion order */
  all() { return [...this.map.values()]; }

  /** @returns {string[]} all ids */
  ids() { return [...this.map.keys()]; }
}
