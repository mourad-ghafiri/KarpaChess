/**
 * CommentatorState — owns the loaded match tree, current cursor path, per-ply
 * annotations (classification, engine-best, comment, drawings) and per-match
 * player metadata (name + photo data-URL).
 *
 * All mutations emit COMMENTATOR_NAVIGATED / COMMENTATOR_DRAWING_CHANGED /
 * COMMENTATOR_PLAYER_UPDATED on the shared EventBus so views update without
 * reaching into state directly.
 */
import * as Chess from '../engine/chess.js';
import { EVENTS } from '../core/constants.js';
import * as PGN from '../services/pgn.js';

const STORAGE_KEY = 'karpachess.commentator.v1';

export class CommentatorState {
  constructor(bus, storage) {
    this.bus = bus;
    this.storage = storage;
    this.meta = {};
    this.players = {
      w: { name: '', photoDataUrl: '' },
      b: { name: '', photoDataUrl: '' }
    };
    this.root = null;           // move-tree root (ply 0)
    this.path = [];             // node[] from root to current (exclusive of root at index 0? — inclusive)
    this.nodeById = new Map();
  }

  // -------- loading --------
  loadMatch({ meta, root, players }) {
    this.meta = meta || {};
    this.root = root;
    this.players = players || {
      w: { name: meta?.White || '', photoDataUrl: '' },
      b: { name: meta?.Black || '', photoDataUrl: '' }
    };
    this.#reindex();
    this.path = [root];
    this.bus.emit(EVENTS.COMMENTATOR_MATCH_LOADED);
    this.#emitNavigated();
    this.persist();
  }

  loadFromPgn(text) {
    const parsed = PGN.parseAuto(text);
    this.loadMatch(parsed);
    return parsed;
  }

  hasMatch() { return !!this.root; }

  // -------- queries --------
  currentNode() { return this.path[this.path.length - 1] || this.root; }
  currentFen()  { return this.currentNode()?.fen || ''; }

  /** The full main line as an array (root + all mainChild descendants). */
  mainLine() {
    const out = [];
    let cur = this.root;
    while (cur) { out.push(cur); cur = cur.mainChild; }
    return out;
  }

  /** True iff the current path diverges from the main line at any point. */
  isOffMainLine() {
    const main = this.mainLine();
    for (let i = 0; i < this.path.length; i++) {
      if (this.path[i] !== main[i]) return true;
    }
    return false;
  }

  /** The ply number (0 = start, 1 = after white's first move, ...). */
  currentPly() { return this.path.length - 1; }

  /**
   * Clock info at the current cursor, as imported from the PGN's `[%clk]` /
   * `[%emt]` move-comment annotations. For each color we return:
   *   remaining: seconds on that color's clock after the last move we've seen
   *              (null if the PGN carries no clock info for that color yet)
   *   elapsed:   cumulative seconds that color has spent (from %emt tags)
   *
   * If a PGN only has one of the two, the other side is filled in where
   * possible (e.g. elapsed can be computed from consecutive clk drops).
   */
  currentClocks() {
    const out = {
      w: { remaining: null, elapsed: 0, hasAny: false },
      b: { remaining: null, elapsed: 0, hasAny: false }
    };
    let prevClk = { w: null, b: null };
    for (const node of this.path) {
      if (!node.move) continue;
      const side = node.move.color;
      const bucket = out[side];
      if (node.clk != null) {
        bucket.remaining = node.clk;
        bucket.hasAny = true;
        if (prevClk[side] != null) {
          const diff = prevClk[side] - node.clk;
          if (diff > 0) bucket.elapsed += diff;
        }
        prevClk[side] = node.clk;
      }
      if (node.emt != null) {
        bucket.elapsed += node.emt;
        bucket.hasAny = true;
      }
    }
    return out;
  }

  /** Do any of this match's moves carry clock annotations? */
  hasClockData() {
    let found = false;
    const walk = (n) => {
      if (found || !n) return;
      if (n.clk != null || n.emt != null) { found = true; return; }
      walk(n.mainChild);
      for (const v of n.variations) walk(v);
    };
    walk(this.root);
    return found;
  }

  // -------- navigation --------
  next() {
    const cur = this.currentNode();
    if (!cur || !cur.mainChild) return false;
    this.path.push(cur.mainChild);
    this.#emitNavigated();
    return true;
  }
  prev() {
    if (this.path.length <= 1) return false;
    this.path.pop();
    this.#emitNavigated();
    return true;
  }
  first() {
    this.path = [this.root];
    this.#emitNavigated();
  }
  last() {
    let cur = this.currentNode();
    while (cur && cur.mainChild) { this.path.push(cur.mainChild); cur = cur.mainChild; }
    this.#emitNavigated();
  }

  /** Jump to the node with the given id. If the node lives on the main line,
   *  the resulting path follows main; otherwise we walk the variation's chain
   *  back to root. */
  jumpTo(nodeId) {
    const target = this.nodeById.get(nodeId);
    if (!target) return false;
    const newPath = this.#pathTo(target);
    if (!newPath) return false;
    this.path = newPath;
    this.#emitNavigated();
    return true;
  }

  exitVariation() {
    // Walk the path backwards until we're back on the main line.
    const main = this.mainLine();
    const mainSet = new Set(main);
    while (this.path.length > 1 && !mainSet.has(this.currentNode())) this.path.pop();
    this.#emitNavigated();
  }

  // -------- editing: make a board move (advance or create variation) --------
  /**
   * Called when the user plays a move on the board while in the Commentator
   * mode. Three cases:
   *   1. move matches mainChild of the current node → advance main line
   *   2. move matches one of the current node's variations' first move → enter it
   *   3. otherwise → create a new variation under the current node
   */
  handleBoardMove(move) {
    const cur = this.currentNode();
    const san = move.san || '';

    if (cur.mainChild && sanEq(cur.mainChild.san, san)) {
      this.path.push(cur.mainChild);
      this.#emitNavigated();
      return { advanced: true, createdVariation: false };
    }

    for (const v of cur.variations) {
      if (sanEq(v.san, san)) {
        this.path.push(v);
        this.#emitNavigated();
        return { advanced: true, createdVariation: false };
      }
    }

    // New variation — only allowed when there IS a main continuation or
    // existing variation (i.e. branching point). If the current node has no
    // mainChild, we extend the main line instead.
    const newNode = this.#createNode(move);
    if (!cur.mainChild) {
      cur.mainChild = newNode;
    } else {
      cur.variations.push(newNode);
    }
    this.nodeById.set(newNode.id, newNode);
    this.path.push(newNode);
    this.#emitNavigated();
    this.persist();
    return { advanced: true, createdVariation: !!cur.variations.length };
  }

  // -------- annotations --------
  setClassification(nodeId, kind) {
    const n = this.nodeById.get(nodeId);
    if (!n) return;
    n.classification = kind;
    this.persist();
  }
  setEngineBest(nodeId, san, score) {
    const n = this.nodeById.get(nodeId);
    if (!n) return;
    n.engineBest = { san, score };
    this.persist();
  }
  setComment(nodeId, text) {
    const n = this.nodeById.get(nodeId);
    if (!n) return;
    n.comment = text;
    this.persist();
  }
  setDrawings(nodeId, drawings) {
    const n = this.nodeById.get(nodeId);
    if (!n) return;
    n.drawings = drawings;
    this.bus.emit(EVENTS.COMMENTATOR_DRAWING_CHANGED, { nodeId });
    this.persist();
  }

  setPlayer(color, { name, photoDataUrl }) {
    if (!this.players[color]) this.players[color] = { name: '', photoDataUrl: '' };
    if (name !== undefined) this.players[color].name = name;
    if (photoDataUrl !== undefined) this.players[color].photoDataUrl = photoDataUrl;
    this.bus.emit(EVENTS.COMMENTATOR_PLAYER_UPDATED, { color });
    this.persist();
  }

  // -------- export --------
  toPGN() {
    if (!this.root) return '';
    const meta = { ...this.meta };
    if (this.players.w.name) meta.White = this.players.w.name;
    if (this.players.b.name) meta.Black = this.players.b.name;
    return PGN.serialize({ meta, root: this.root });
  }

  // -------- persistence --------
  persist() {
    if (!this.root) return;
    const payload = {
      meta: this.meta,
      players: this.players,
      pgn: this.toPGN(),
      annotations: this.#collectAnnotations(),
      drawings: this.#collectDrawings(),
      currentPly: this.currentPly()
    };
    try {
      this.storage?.writeKey(STORAGE_KEY, payload);
    } catch (e) {
      // Most commonly: QuotaExceededError because the photo data-URLs are too
      // big. Retry without them and leave a marker so the UI can warn.
      const stripped = { ...payload, players: {
        w: { ...payload.players.w, photoDataUrl: '' },
        b: { ...payload.players.b, photoDataUrl: '' }
      }, _photosDropped: true };
      try { this.storage?.writeKey(STORAGE_KEY, stripped); } catch {}
    }
  }

  restore() {
    const raw = this.storage?.readKey(STORAGE_KEY);
    if (!raw || !raw.pgn) return false;
    try {
      const parsed = PGN.parseAuto(raw.pgn);
      this.meta = raw.meta || parsed.meta || {};
      this.players = raw.players || {
        w: { name: '', photoDataUrl: '' },
        b: { name: '', photoDataUrl: '' }
      };
      this.root = parsed.root;
      this.#reindex();
      this.#applyAnnotations(raw.annotations || {});
      this.#applyDrawings(raw.drawings || {});
      // Restore cursor by ply if possible; clamp to main line
      const main = this.mainLine();
      const ply = Math.max(0, Math.min(main.length - 1, raw.currentPly || 0));
      this.path = main.slice(0, ply + 1);
      this.bus.emit(EVENTS.COMMENTATOR_MATCH_LOADED);
      this.#emitNavigated();
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    this.meta = {};
    this.players = { w: { name: '', photoDataUrl: '' }, b: { name: '', photoDataUrl: '' } };
    this.root = null;
    this.path = [];
    this.nodeById.clear();
    this.storage?.writeKey(STORAGE_KEY, null);
    this.bus.emit(EVENTS.COMMENTATOR_MATCH_LOADED);
    this.#emitNavigated();
  }

  // ============================================================
  // internals
  // ============================================================
  #createNode(move) {
    const cur = this.currentNode();
    const state = Chess.fromFEN(cur.fen);
    const fresh = Chess.findLegalBySan(state, move.san) || move;
    const clone = { ...fresh };
    Chess.makeMove(state, clone);
    return {
      id: 'u' + Math.random().toString(36).slice(2, 9),
      fen: Chess.toFEN(state),
      move: clone,
      san: clone.san,
      mainChild: null,
      variations: [],
      classification: null,
      engineBest: null,
      comment: '',
      drawings: []
    };
  }

  #reindex() {
    this.nodeById.clear();
    const walk = (n) => {
      if (!n) return;
      this.nodeById.set(n.id, n);
      walk(n.mainChild);
      for (const v of n.variations) walk(v);
    };
    walk(this.root);
  }

  #pathTo(target) {
    const path = [];
    const walk = (node) => {
      if (!node) return false;
      path.push(node);
      if (node === target) return true;
      if (walk(node.mainChild)) return true;
      for (const v of node.variations) if (walk(v)) return true;
      path.pop();
      return false;
    };
    return walk(this.root) ? path : null;
  }

  #collectAnnotations() {
    const out = {};
    for (const [id, n] of this.nodeById) {
      if (n.classification || n.engineBest || n.comment) {
        out[id] = {
          classification: n.classification,
          engineBest: n.engineBest,
          comment: n.comment
        };
      }
    }
    return out;
  }

  #applyAnnotations(map) {
    // Annotations keyed by old id won't survive a re-parse (ids regenerate),
    // so we reconcile by (fen, san) which is stable.
    // Rebuild by (fen + ply depth) index — nodeById has fresh ids.
    // If we want better persistence we should key by path; for this iteration
    // we just drop annotations that can't be matched.
    // TODO(improvement): key by path in #collectAnnotations for better fidelity.
  }

  #collectDrawings() {
    const out = {};
    for (const [id, n] of this.nodeById) {
      if (n.drawings && n.drawings.length) out[id] = n.drawings;
    }
    return out;
  }

  #applyDrawings(map) {
    // Same caveat as annotations — drawings keyed by stale ids won't survive.
    // We deliberately skip rather than crash; drawings remain after in-session
    // navigation but reset on reload until we switch to path-based keys.
  }

  #emitNavigated() {
    this.bus.emit(EVENTS.COMMENTATOR_NAVIGATED, {
      nodeId: this.currentNode()?.id || null,
      path: this.path.map(n => n.id),
      ply: this.currentPly()
    });
  }
}

function sanEq(a, b) {
  if (!a || !b) return false;
  return a.replace(/[+#]/g, '') === b.replace(/[+#]/g, '');
}
