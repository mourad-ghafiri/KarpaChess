/**
 * Small registry of GameMode instances, indexed by id. The composition root
 * registers each concrete mode once; everything else looks up by id.
 */
export class ModeRegistry {
  constructor() { this.map = new Map(); }
  register(mode) { this.map.set(mode.id, mode); return this; }
  get(id) { return this.map.get(id); }
}
