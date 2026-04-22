/**
 * Thin typed wrapper around localStorage. Abstracts away the "key namespace"
 * so callers can't accidentally collide and gives us a single place to
 * intercept persistence (e.g. to swap backends or add logging later).
 */
export class Storage {
  constructor(key) {
    this.key = key;
  }

  read() {
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  write(data) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }

  clear() {
    localStorage.removeItem(this.key);
  }

  // ---- Arbitrary-key access for features that want their own namespace
  // (e.g. Commentator match + drawings). `write` may throw on quota.
  readKey(k) {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  writeKey(k, data) {
    if (data === null) { localStorage.removeItem(k); return; }
    localStorage.setItem(k, JSON.stringify(data));
  }
}
