/**
 * Tiny pub/sub. Single shared instance is injected everywhere by the composition
 * root, so modules exchange messages without importing each other.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map(); // event → Set<handler>
  }

  on(event, handler) {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    // Clone so handlers that mutate the set don't break iteration.
    for (const h of [...set]) h(payload);
  }
}
