/**
 * PGN (Portable Game Notation) parser + serializer.
 *
 * Produces and consumes the same move-tree shape used by CommentatorState:
 *
 *   node = {
 *     id, fen, move, san,
 *     mainChild: node | null,
 *     variations: node[],
 *     classification: 'good'|'inaccuracy'|'mistake'|'blunder'|null,
 *     engineBest: { san, score } | null,
 *     comment: string,
 *     drawings: Drawing[]
 *   }
 *
 * Supported PGN features:
 *   - [Key "Value"] headers (7-tag roster + arbitrary extras)
 *   - Standard SAN with disambiguation, captures, castling, promotion, check/mate
 *   - Move numbers (1. / 1...), skipped cleanly
 *   - Variations via (...) — recursive, arbitrarily nested
 *   - NAG glyphs ($1, $3, $5) and the short suffixes !, ?, !!, ??, !?, ?!
 *   - Inline { ... } and ; end-of-line comments
 *   - Result tokens 1-0, 0-1, 1/2-1/2, *
 *
 * Non-supported (on purpose, for this iteration): SetUp FEN headers pointing
 * at non-standard start positions — if a [FEN "..."] header is present we use
 * it as the root position, so custom start positions DO work — but Chess960
 * and other variants are not.
 */
import * as Chess from '../engine/chess.js';
import { NAG_MAP } from '../core/constants.js';

let _id = 0;
function nextId() { return 'n' + (++_id).toString(36); }

function newNode(overrides = {}) {
  return {
    id: nextId(),
    fen: '',
    move: null,
    san: null,
    mainChild: null,
    variations: [],
    classification: null,
    engineBest: null,
    comment: '',
    drawings: [],
    ...overrides
  };
}

// ============================================================
// Tokenizer
// ============================================================

/** Break the movetext into typed tokens. */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }

    // Line comment: ; ... end of line
    if (c === ';') {
      const end = text.indexOf('\n', i);
      tokens.push({ t: 'comment', v: text.slice(i + 1, end === -1 ? n : end).trim() });
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Block comment: { ... }
    if (c === '{') {
      const end = text.indexOf('}', i);
      if (end === -1) { i = n; break; }
      tokens.push({ t: 'comment', v: text.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }

    // Variation open / close
    if (c === '(') { tokens.push({ t: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ t: ')' }); i++; continue; }

    // NAG glyph: $N
    if (c === '$') {
      let j = i + 1;
      while (j < n && /[0-9]/.test(text[j])) j++;
      tokens.push({ t: 'nag', v: parseInt(text.slice(i + 1, j), 10) });
      i = j;
      continue;
    }

    // Result token
    if (text.startsWith('1-0', i)) { tokens.push({ t: 'result', v: '1-0' }); i += 3; continue; }
    if (text.startsWith('0-1', i)) { tokens.push({ t: 'result', v: '0-1' }); i += 3; continue; }
    if (text.startsWith('1/2-1/2', i)) { tokens.push({ t: 'result', v: '1/2-1/2' }); i += 7; continue; }
    if (c === '*' && (i === 0 || /\s/.test(text[i - 1]))) {
      tokens.push({ t: 'result', v: '*' }); i++; continue;
    }

    // Move number: digits optionally followed by one or more dots
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9]/.test(text[j])) j++;
      if (j < n && text[j] === '.') {
        while (j < n && text[j] === '.') j++;
        // Just skip — don't emit; move numbers are redundant given turn
        i = j;
        continue;
      }
      // A lone number without a dot is weird; treat as move token
    }

    // SAN token: read until whitespace or punctuation (but keep trailing !?+#)
    let j = i;
    while (j < n && !/[\s(){};]/.test(text[j])) j++;
    const raw = text.slice(i, j);
    // Strip trailing short suffixes, encode as NAG
    const suffixMatch = raw.match(/(!!|\?\?|!\?|\?!|[!?])$/);
    let san = raw;
    if (suffixMatch) {
      const suf = suffixMatch[0];
      san = raw.slice(0, -suf.length);
      tokens.push({ t: 'san', v: san });
      tokens.push({ t: 'nag', v: suffixToNag(suf) });
    } else {
      tokens.push({ t: 'san', v: san });
    }
    i = j;
  }

  return tokens;
}

function suffixToNag(suf) {
  switch (suf) {
    case '!':  return 1;
    case '?':  return 2;
    case '!!': return 3;
    case '??': return 4;
    case '!?': return 5;
    case '?!': return 6;
  }
  return 0;
}

// ============================================================
// Header parsing
// ============================================================

function parseHeaders(text) {
  const meta = {};
  const lineRe = /\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g;
  let m;
  let lastIdx = 0;
  while ((m = lineRe.exec(text)) !== null) {
    meta[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    lastIdx = m.index + m[0].length;
  }
  // Movetext = everything from the last header's end forward; if no headers,
  // the whole text is movetext.
  const movetext = lastIdx > 0 ? text.slice(lastIdx) : text;
  return { meta, movetext };
}

// ============================================================
// Parse movetext → tree
// ============================================================

/**
 * Walk tokens starting at position `pos`, applying moves onto `state`, building
 * a linked-list of main-line nodes under `parent`. Returns the updated pos.
 * When we encounter '(' we recurse on a CLONED state to build a variation.
 */
function parseLine(tokens, pos, parent, state) {
  let last = parent;          // move node most recently appended (starts at the parent stub)

  while (pos < tokens.length) {
    const tok = tokens[pos];

    if (tok.t === ')') return pos;              // caller will consume
    if (tok.t === 'result') { pos++; continue; }

    if (tok.t === 'comment') {
      // PGN comments refer to the move that *just played*. Attach to `last`
      // unless we're still at the parent stub (in which case it's a pre-line
      // comment — we drop it silently).
      if (last !== parent) {
        const { clk, emt, cleaned } = extractClockInfo(tok.v);
        if (clk != null) last.clk = clk;
        if (emt != null) last.emt = emt;
        if (cleaned) {
          last.comment = last.comment ? last.comment + ' ' + cleaned : cleaned;
        }
      }
      pos++;
      continue;
    }

    if (tok.t === 'nag') {
      if (last !== parent) {
        const entry = NAG_MAP[tok.v];
        if (entry && entry.classification && !last.classification) {
          last.classification = entry.classification;
        }
      }
      pos++;
      continue;
    }

    if (tok.t === '(') {
      // Variation branches from the LAST move we added. Walk the state back
      // to the position BEFORE that move, let the variation parser apply its
      // own moves on top, then wind everything back to exactly this point
      // before resuming the main line.
      if (last === parent || !last.move) { pos++; continue; }
      Chess.undoLast(state);
      const baseHistory = state.history.length;
      pos = parseVariation(tokens, pos + 1, last, state);
      while (state.history.length > baseHistory) Chess.undoLast(state);
      Chess.makeMove(state, last.move);
      continue;
    }

    if (tok.t === 'san') {
      const move = Chess.findLegalBySan(state, tok.v);
      if (!move) { pos++; continue; }   // skip unknown SAN rather than throw
      const clone = { ...move };
      Chess.makeMove(state, clone);
      const node = newNode({
        fen: Chess.toFEN(state),
        move: clone,
        san: clone.san
      });
      if (last === parent) parent.mainChild = node;
      else last.mainChild = node;
      last = node;
      pos++;
      continue;
    }

    pos++;
  }
  return pos;
}

function parseVariation(tokens, pos, siblingOf, state) {
  // Variation parent is the node BEFORE `siblingOf`: the variation's first
  // move is a sibling of siblingOf.mainChild-parent. We use a synthetic parent
  // whose `mainChild` will be the variation's first node.
  const stub = { mainChild: null, variations: [] };
  const end = parseLine(tokens, pos, stub, state);
  if (stub.mainChild) {
    // Attach as variation on the node whose position we were at. `siblingOf`
    // shares the same parent; find that parent and push our variation onto its
    // siblings list. Simpler: variations live alongside the main-line move. We
    // attach the variation head to siblingOf.variations.
    siblingOf.variations.push(stub.mainChild);
  }
  // Consume the trailing ')'
  return tokens[end] && tokens[end].t === ')' ? end + 1 : end;
}

/**
 * Pull `[%clk h:mm:ss]` and `[%emt h:mm:ss]` annotations out of a PGN
 * comment. Returns seconds for each, and the comment text with those tags
 * stripped so the UI doesn't show raw clock markers.
 */
function extractClockInfo(comment) {
  const clkMatch = comment.match(/\[%clk\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\]/);
  const emtMatch = comment.match(/\[%emt\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\]/);
  const toSec = (m) => (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
  return {
    clk: clkMatch ? toSec(clkMatch) : null,
    emt: emtMatch ? toSec(emtMatch) : null,
    cleaned: comment
      .replace(/\[%clk\s+[^\]]+\]/g, '')
      .replace(/\[%emt\s+[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse a full PGN document.
 * @param {string} text
 * @returns {{meta: object, root: node}}
 */
export function parse(text) {
  const { meta, movetext } = parseHeaders(text);
  const startFen = meta.FEN || null;
  const state = startFen ? Chess.fromFEN(startFen) : Chess.create();
  const root = newNode({ fen: Chess.toFEN(state) });
  const tokens = tokenize(movetext);
  parseLine(tokens, 0, root, state);
  return { meta, root };
}

/**
 * Parse a plain shorthand move list (no headers, no variations).
 * Tolerates commas, pipes, and extra whitespace.
 */
export function parsePlain(text) {
  const cleaned = text.replace(/[|,;]/g, ' ');
  const state = Chess.create();
  const root = newNode({ fen: Chess.toFEN(state) });
  const tokens = tokenize(cleaned);
  parseLine(tokens, 0, root, state);
  return { meta: {}, root };
}

/**
 * Auto-detect whether the text looks like full PGN (has [Tag "..."] lines)
 * or plain shorthand, and parse accordingly.
 */
export function parseAuto(text) {
  return /^\s*\[\w+\s+"/m.test(text) ? parse(text) : parsePlain(text);
}

/**
 * Serialize a tree back to a PGN string.
 * Required tags are emitted first (STR), then any extras, then movetext.
 */
export function serialize({ meta = {}, root }) {
  const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const lines = [];
  for (const k of SEVEN_TAG_ROSTER) {
    lines.push(`[${k} "${escapeTag(meta[k] || '?')}"]`);
  }
  for (const [k, v] of Object.entries(meta)) {
    if (SEVEN_TAG_ROSTER.includes(k)) continue;
    lines.push(`[${k} "${escapeTag(v)}"]`);
  }
  lines.push('');
  const movetext = serializeLine(root, true) + ' ' + (meta.Result || '*');
  lines.push(wrapMovetext(movetext.trim()));
  return lines.join('\n') + '\n';
}

function serializeLine(node, isRoot) {
  const parts = [];
  let cur = isRoot ? node.mainChild : node;
  let plyFromRoot = isRoot ? 1 : -1;   // unknown for non-root starting points
  while (cur) {
    if (plyFromRoot > 0) {
      const moveNum = Math.ceil(plyFromRoot / 2);
      if (plyFromRoot % 2 === 1) parts.push(`${moveNum}.`);
      else if (parts.length === 0 || /\)$/.test(parts[parts.length - 1]))
        parts.push(`${moveNum}...`);
    }
    parts.push(cur.san);
    if (cur.classification) {
      const nag = classToNag(cur.classification);
      if (nag) parts.push(`$${nag}`);
    }
    const commentBits = [];
    if (cur.clk != null) commentBits.push(`[%clk ${formatClockSec(cur.clk)}]`);
    if (cur.emt != null) commentBits.push(`[%emt ${formatClockSec(cur.emt)}]`);
    if (cur.comment)     commentBits.push(cur.comment);
    if (commentBits.length) parts.push(`{${commentBits.join(' ')}}`);
    for (const v of cur.variations) {
      parts.push(`(${serializeLine(v, false)})`);
    }
    cur = cur.mainChild;
    if (plyFromRoot > 0) plyFromRoot++;
  }
  return parts.join(' ');
}

function classToNag(cls) {
  switch (cls) {
    case 'blunder':    return 4;
    case 'mistake':    return 2;
    case 'inaccuracy': return 6;
    case 'good':       return 1;
    case 'best':       return 3;
  }
  return 0;
}

function escapeTag(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function formatClockSec(total) {
  const sec = Math.max(0, Math.round(total));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function wrapMovetext(text, max = 80) {
  const out = [];
  let line = '';
  for (const tok of text.split(' ')) {
    if (!line) { line = tok; continue; }
    if (line.length + 1 + tok.length > max) { out.push(line); line = tok; }
    else line += ' ' + tok;
  }
  if (line) out.push(line);
  return out.join('\n');
}
