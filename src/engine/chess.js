/* =========================================================================
   KarpaChess — chess engine (ES module)
   Pure JS, no dependencies. Legal move generation, SAN, FEN, search.
   ========================================================================= */

export const FILES = 'abcdefgh';

export const PIECE_UNICODE = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

export const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const sq = (r, c) => r * 8 + c;
export const squareName = (r, c) => FILES[c] + (8 - r);
export const parseSquare = (s) => [8 - parseInt(s[1], 10), FILES.indexOf(s[0])];
const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const opp = (c) => (c === 'w' ? 'b' : 'w');

function createInitialBoard() {
  const b = new Array(64).fill(null);
  const backRank = ['r','n','b','q','k','b','n','r'];
  for (let c = 0; c < 8; c++) {
    b[sq(0, c)] = { p: backRank[c], c: 'b' };
    b[sq(1, c)] = { p: 'p', c: 'b' };
    b[sq(6, c)] = { p: 'p', c: 'w' };
    b[sq(7, c)] = { p: backRank[c], c: 'w' };
  }
  return b;
}

export function create() {
  return {
    board: createInitialBoard(),
    turn: 'w',
    castling: { wk: true, wq: true, bk: true, bq: true },
    ep: null,
    halfmove: 0,
    fullmove: 1,
    history: []
  };
}

function pieceAt(state, r, c) {
  if (!inBoard(r, c)) return null;
  return state.board[sq(r, c)];
}

// -----------------------------------------------------------------------
// Pseudo-legal move generation
// -----------------------------------------------------------------------
function pseudoMoves(state, color) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[sq(r, c)];
      if (!p || p.c !== color) continue;
      piecePseudoMoves(state, r, c, p, out);
    }
  }
  return out;
}

function piecePseudoMoves(state, r, c, piece, out) {
  switch (piece.p) {
    case 'p': return pawnMoves(state, r, c, piece, out);
    case 'n': return knightMoves(state, r, c, piece, out);
    case 'b': return slideMoves(state, r, c, piece, [[-1,-1],[-1,1],[1,-1],[1,1]], out);
    case 'r': return slideMoves(state, r, c, piece, [[-1,0],[1,0],[0,-1],[0,1]], out);
    case 'q': return slideMoves(state, r, c, piece, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]], out);
    case 'k': return kingMoves(state, r, c, piece, out);
  }
}

function pawnMoves(state, r, c, piece, out) {
  const dir = piece.c === 'w' ? -1 : 1;
  const startRow = piece.c === 'w' ? 6 : 1;
  const promoRow = piece.c === 'w' ? 0 : 7;

  if (inBoard(r + dir, c) && !pieceAt(state, r + dir, c)) {
    pushPawn(out, r, c, r + dir, c, piece, null, promoRow);
    if (r === startRow && !pieceAt(state, r + dir * 2, c)) {
      out.push({ from: [r, c], to: [r + dir * 2, c], piece: 'p', color: piece.c, double: true });
    }
  }
  for (const dc of [-1, 1]) {
    const nr = r + dir, nc = c + dc;
    if (!inBoard(nr, nc)) continue;
    const tgt = pieceAt(state, nr, nc);
    if (tgt && tgt.c !== piece.c) {
      pushPawn(out, r, c, nr, nc, piece, tgt.p, promoRow);
    } else if (state.ep && state.ep[0] === nr && state.ep[1] === nc) {
      out.push({ from: [r, c], to: [nr, nc], piece: 'p', color: piece.c, captured: 'p', ep: true });
    }
  }
}

function pushPawn(out, fr, fc, tr, tc, piece, captured, promoRow) {
  if (tr === promoRow) {
    for (const p of ['q', 'r', 'b', 'n']) {
      out.push({ from: [fr, fc], to: [tr, tc], piece: 'p', color: piece.c, captured, promotion: p });
    }
  } else {
    out.push({ from: [fr, fc], to: [tr, tc], piece: 'p', color: piece.c, captured: captured || null });
  }
}

const KNIGHT_OFFSETS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
function knightMoves(state, r, c, piece, out) {
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (!inBoard(nr, nc)) continue;
    const tgt = pieceAt(state, nr, nc);
    if (!tgt) out.push({ from: [r, c], to: [nr, nc], piece: 'n', color: piece.c, captured: null });
    else if (tgt.c !== piece.c) out.push({ from: [r, c], to: [nr, nc], piece: 'n', color: piece.c, captured: tgt.p });
  }
}

function slideMoves(state, r, c, piece, dirs, out) {
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const tgt = pieceAt(state, nr, nc);
      if (!tgt) {
        out.push({ from: [r, c], to: [nr, nc], piece: piece.p, color: piece.c, captured: null });
      } else {
        if (tgt.c !== piece.c)
          out.push({ from: [r, c], to: [nr, nc], piece: piece.p, color: piece.c, captured: tgt.p });
        break;
      }
      nr += dr; nc += dc;
    }
  }
}

const KING_OFFSETS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
function kingMoves(state, r, c, piece, out) {
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (!inBoard(nr, nc)) continue;
    const tgt = pieceAt(state, nr, nc);
    if (!tgt) out.push({ from: [r, c], to: [nr, nc], piece: 'k', color: piece.c, captured: null });
    else if (tgt.c !== piece.c) out.push({ from: [r, c], to: [nr, nc], piece: 'k', color: piece.c, captured: tgt.p });
  }

  const row = piece.c === 'w' ? 7 : 0;
  if (r !== row || c !== 4) return;
  if (isSquareAttacked(state, row, 4, opp(piece.c))) return;

  const rights = state.castling;
  const cr = piece.c === 'w' ? { k: rights.wk, q: rights.wq } : { k: rights.bk, q: rights.bq };
  if (cr.k && !pieceAt(state, row, 5) && !pieceAt(state, row, 6) &&
      pieceAt(state, row, 7) && pieceAt(state, row, 7).p === 'r' && pieceAt(state, row, 7).c === piece.c &&
      !isSquareAttacked(state, row, 5, opp(piece.c)) &&
      !isSquareAttacked(state, row, 6, opp(piece.c))) {
    out.push({ from: [row, 4], to: [row, 6], piece: 'k', color: piece.c, castling: 'k', captured: null });
  }
  if (cr.q && !pieceAt(state, row, 1) && !pieceAt(state, row, 2) && !pieceAt(state, row, 3) &&
      pieceAt(state, row, 0) && pieceAt(state, row, 0).p === 'r' && pieceAt(state, row, 0).c === piece.c &&
      !isSquareAttacked(state, row, 3, opp(piece.c)) &&
      !isSquareAttacked(state, row, 2, opp(piece.c))) {
    out.push({ from: [row, 4], to: [row, 2], piece: 'k', color: piece.c, castling: 'q', captured: null });
  }
}

function isSquareAttacked(state, r, c, byColor) {
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const p = pieceAt(state, r + pawnDir, c + dc);
    if (p && p.c === byColor && p.p === 'p') return true;
  }
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const p = pieceAt(state, r + dr, c + dc);
    if (p && p.c === byColor && p.p === 'n') return true;
  }
  for (const [dr, dc] of KING_OFFSETS) {
    const p = pieceAt(state, r + dr, c + dc);
    if (p && p.c === byColor && p.p === 'k') return true;
  }
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const p = pieceAt(state, nr, nc);
      if (p) { if (p.c === byColor && (p.p === 'b' || p.p === 'q')) return true; break; }
      nr += dr; nc += dc;
    }
  }
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const p = pieceAt(state, nr, nc);
      if (p) { if (p.c === byColor && (p.p === 'r' || p.p === 'q')) return true; break; }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function findKing(state, color) {
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p && p.p === 'k' && p.c === color) return [Math.floor(i / 8), i % 8];
  }
  return null;
}

export function inCheck(state, color) {
  const k = findKing(state, color);
  if (!k) return false;
  return isSquareAttacked(state, k[0], k[1], opp(color));
}

export function legalMoves(state, color) {
  const psm = pseudoMoves(state, color || state.turn);
  const legal = [];
  for (const m of psm) {
    const info = applyMove(state, m);
    if (!inCheck(state, m.color)) legal.push(m);
    undoMove(state, info);
  }
  return legal;
}

export function legalMovesFrom(state, r, c) {
  const p = pieceAt(state, r, c);
  if (!p || p.c !== state.turn) return [];
  return legalMoves(state, state.turn).filter(m => m.from[0] === r && m.from[1] === c);
}

// -----------------------------------------------------------------------
// Apply / undo
// -----------------------------------------------------------------------
export function applyMove(state, move) {
  const info = {
    move,
    prevCastling: { ...state.castling },
    prevEp: state.ep,
    prevHalfmove: state.halfmove,
    prevFullmove: state.fullmove,
    captured: null,
    capturedFrom: null
  };

  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = state.board[sq(fr, fc)];
  state.board[sq(fr, fc)] = null;

  if (move.ep) {
    const capRow = piece.c === 'w' ? tr + 1 : tr - 1;
    info.captured = state.board[sq(capRow, tc)];
    info.capturedFrom = [capRow, tc];
    state.board[sq(capRow, tc)] = null;
  } else if (state.board[sq(tr, tc)]) {
    info.captured = state.board[sq(tr, tc)];
    info.capturedFrom = [tr, tc];
  }

  if (move.promotion) state.board[sq(tr, tc)] = { p: move.promotion, c: piece.c };
  else state.board[sq(tr, tc)] = piece;

  if (move.castling) {
    const row = piece.c === 'w' ? 7 : 0;
    if (move.castling === 'k') {
      state.board[sq(row, 5)] = state.board[sq(row, 7)];
      state.board[sq(row, 7)] = null;
    } else {
      state.board[sq(row, 3)] = state.board[sq(row, 0)];
      state.board[sq(row, 0)] = null;
    }
  }

  if (piece.p === 'k') {
    if (piece.c === 'w') { state.castling.wk = false; state.castling.wq = false; }
    else { state.castling.bk = false; state.castling.bq = false; }
  }
  if (piece.p === 'r') {
    if (piece.c === 'w' && fr === 7 && fc === 0) state.castling.wq = false;
    if (piece.c === 'w' && fr === 7 && fc === 7) state.castling.wk = false;
    if (piece.c === 'b' && fr === 0 && fc === 0) state.castling.bq = false;
    if (piece.c === 'b' && fr === 0 && fc === 7) state.castling.bk = false;
  }
  if (info.captured && info.captured.p === 'r') {
    const [cr, cc] = info.capturedFrom;
    if (cr === 7 && cc === 0) state.castling.wq = false;
    if (cr === 7 && cc === 7) state.castling.wk = false;
    if (cr === 0 && cc === 0) state.castling.bq = false;
    if (cr === 0 && cc === 7) state.castling.bk = false;
  }

  state.ep = move.double ? [piece.c === 'w' ? tr + 1 : tr - 1, tc] : null;

  if (piece.p === 'p' || info.captured) state.halfmove = 0;
  else state.halfmove += 1;
  if (state.turn === 'b') state.fullmove += 1;

  state.turn = opp(state.turn);
  return info;
}

export function undoMove(state, info) {
  const move = info.move;
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = state.board[sq(tr, tc)];

  state.board[sq(fr, fc)] = move.promotion ? { p: 'p', c: piece.c } : piece;
  state.board[sq(tr, tc)] = null;

  if (info.captured) {
    const [cr, cc] = info.capturedFrom;
    state.board[sq(cr, cc)] = info.captured;
  }

  if (move.castling) {
    const row = move.color === 'w' ? 7 : 0;
    if (move.castling === 'k') {
      state.board[sq(row, 7)] = state.board[sq(row, 5)];
      state.board[sq(row, 5)] = null;
    } else {
      state.board[sq(row, 0)] = state.board[sq(row, 3)];
      state.board[sq(row, 3)] = null;
    }
  }

  state.castling = info.prevCastling;
  state.ep = info.prevEp;
  state.halfmove = info.prevHalfmove;
  state.fullmove = info.prevFullmove;
  state.turn = opp(state.turn);
}

export function makeMove(state, move) {
  const info = applyMove(state, move);
  move.san = toSAN(state, move, info);
  state.history.push({ move, info });
  return move;
}

export function undoLast(state) {
  const entry = state.history.pop();
  if (!entry) return null;
  undoMove(state, entry.info);
  return entry.move;
}

export function status(state) {
  const color = state.turn;
  const moves = legalMoves(state, color);
  const check = inCheck(state, color);
  if (moves.length === 0) {
    return check ? { over: true, result: 'checkmate', winner: opp(color) }
                 : { over: true, result: 'stalemate', winner: null };
  }
  if (state.halfmove >= 100) return { over: true, result: 'draw-50', winner: null };
  if (isInsufficientMaterial(state)) return { over: true, result: 'draw-material', winner: null };
  return { over: false, check };
}

function isInsufficientMaterial(state) {
  const pieces = [];
  for (const p of state.board) if (p) pieces.push(p);
  if (pieces.length === 2) return true;
  if (pieces.length === 3 && pieces.some(p => p.p === 'b' || p.p === 'n')) return true;
  return false;
}

// -----------------------------------------------------------------------
// SAN
// -----------------------------------------------------------------------
function toSAN(stateAfter, move, info) {
  if (move.castling === 'k') return appendCheck('O-O', stateAfter);
  if (move.castling === 'q') return appendCheck('O-O-O', stateAfter);

  const pieceLetter = move.piece === 'p' ? '' : move.piece.toUpperCase();
  const capture = move.captured ? 'x' : '';
  const dest = squareName(move.to[0], move.to[1]);
  const promo = move.promotion ? '=' + move.promotion.toUpperCase() : '';

  let disambig = '';
  if (move.piece !== 'p' && move.piece !== 'k') {
    // Temporarily roll back to pre-move position to inspect sibling moves
    undoMove(stateAfter, info);
    const alts = legalMoves(stateAfter, move.color).filter(m =>
      m !== move && m.piece === move.piece &&
      m.to[0] === move.to[0] && m.to[1] === move.to[1] &&
      !(m.from[0] === move.from[0] && m.from[1] === move.from[1]));
    applyMove(stateAfter, move);
    if (alts.length > 0) {
      const sameFile = alts.some(a => a.from[1] === move.from[1]);
      const sameRank = alts.some(a => a.from[0] === move.from[0]);
      if (!sameFile) disambig = FILES[move.from[1]];
      else if (!sameRank) disambig = String(8 - move.from[0]);
      else disambig = FILES[move.from[1]] + (8 - move.from[0]);
    }
  }

  if (move.piece === 'p' && move.captured) disambig = FILES[move.from[1]];

  return appendCheck(`${pieceLetter}${disambig}${capture}${dest}${promo}`, stateAfter);
}

function appendCheck(san, state) {
  const st = status(state);
  if (st.over && st.result === 'checkmate') return san + '#';
  if (st.check) return san + '+';
  return san;
}

// -----------------------------------------------------------------------
// FEN
// -----------------------------------------------------------------------
export function toFEN(state) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = state.board[sq(r, c)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.c === 'w' ? p.p.toUpperCase() : p.p;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let cast = '';
  if (state.castling.wk) cast += 'K';
  if (state.castling.wq) cast += 'Q';
  if (state.castling.bk) cast += 'k';
  if (state.castling.bq) cast += 'q';
  cast = cast || '-';
  const ep = state.ep ? squareName(state.ep[0], state.ep[1]) : '-';
  return `${rows.join('/')} ${state.turn} ${cast} ${ep} ${state.halfmove} ${state.fullmove}`;
}

export function fromFEN(fen) {
  const state = {
    board: new Array(64).fill(null),
    turn: 'w',
    castling: { wk: false, wq: false, bk: false, bq: false },
    ep: null, halfmove: 0, fullmove: 1, history: []
  };
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) c += parseInt(ch, 10);
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        state.board[sq(r, c)] = { p: ch.toLowerCase(), c: color };
        c++;
      }
    }
  }
  state.turn = parts[1] || 'w';
  const cast = parts[2] || '-';
  state.castling.wk = cast.includes('K');
  state.castling.wq = cast.includes('Q');
  state.castling.bk = cast.includes('k');
  state.castling.bq = cast.includes('q');
  if (parts[3] && parts[3] !== '-') state.ep = parseSquare(parts[3]);
  state.halfmove = parseInt(parts[4] || '0', 10);
  state.fullmove = parseInt(parts[5] || '1', 10);
  return state;
}

// -----------------------------------------------------------------------
// Evaluation + Search
// -----------------------------------------------------------------------
const PST = {
  p: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [ 5,  5, 10, 25, 25, 10,  5,  5],
    [ 0,  0,  0, 20, 20,  0,  0,  0],
    [ 5, -5,-10,  0,  0,-10, -5,  5],
    [ 5, 10, 10,-20,-20, 10, 10,  5],
    [ 0,  0,  0,  0,  0,  0,  0,  0]
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ],
  r: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [ 5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [ 0,  0,  0,  5,  5,  0,  0,  0]
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20]
  ]
};

export function evaluate(state) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[sq(r, c)];
      if (!p) continue;
      const mat = PIECE_VALUE[p.p];
      const tbl = PST[p.p];
      const psv = p.c === 'w' ? tbl[r][c] : tbl[7 - r][c];
      const val = mat + psv;
      score += p.c === 'w' ? val : -val;
    }
  }
  return state.turn === 'w' ? score : -score;
}

export function search(state, depth) {
  const moves = legalMoves(state, state.turn);
  if (moves.length === 0) return { move: null, score: inCheck(state, state.turn) ? -99999 : 0 };

  orderMoves(moves);
  let best = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const m of moves) {
    const info = applyMove(state, m);
    const sc = -negamax(state, depth - 1, -beta, -alpha);
    undoMove(state, info);
    if (sc > bestScore) { bestScore = sc; best = m; }
    if (sc > alpha) alpha = sc;
  }
  return { move: best, score: bestScore };
}

function negamax(state, depth, alpha, beta) {
  if (depth <= 0) return quiesce(state, alpha, beta);
  const moves = legalMoves(state, state.turn);
  if (moves.length === 0) return inCheck(state, state.turn) ? -99000 - depth : 0;
  orderMoves(moves);
  let best = -Infinity;
  for (const m of moves) {
    const info = applyMove(state, m);
    const sc = -negamax(state, depth - 1, -beta, -alpha);
    undoMove(state, info);
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return best;
}

function quiesce(state, alpha, beta) {
  const stand = evaluate(state);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const moves = legalMoves(state, state.turn).filter(m => m.captured || m.promotion);
  orderMoves(moves);
  for (const m of moves) {
    const info = applyMove(state, m);
    const sc = -quiesce(state, -beta, -alpha);
    undoMove(state, info);
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function orderMoves(moves) { moves.sort((a, b) => moveScore(b) - moveScore(a)); }
function moveScore(m) {
  let s = 0;
  if (m.captured)  s += 10 * PIECE_VALUE[m.captured] - PIECE_VALUE[m.piece];
  if (m.promotion) s += PIECE_VALUE[m.promotion];
  if (m.castling)  s += 50;
  return s;
}

export function chooseMove(state, difficulty) {
  const moves = legalMoves(state, state.turn);
  if (moves.length === 0) return { move: null, eval: 0 };
  if (difficulty <= 1) {
    if (Math.random() < 0.3) return { move: moves[Math.floor(Math.random() * moves.length)], eval: 0 };
    return search(state, 1);
  }
  return search(state, Math.max(1, Math.min(4, difficulty)));
}

// -----------------------------------------------------------------------
// SAN helpers (moved from the old app.js — belong to the engine)
// -----------------------------------------------------------------------
export function normalizeSan(s) { return String(s || '').replace(/[+#]/g, '').trim(); }

/** Locate a candidate move in the legal move list whose SAN matches wantSan. */
export function findLegalBySan(state, wantSan) {
  const legal = legalMoves(state, state.turn);
  const want = normalizeSan(wantSan);
  for (const m of legal) {
    const clone = { ...m };
    makeMove(state, clone);
    const san = normalizeSan(clone.san);
    undoLast(state);
    if (san === want) return m;
  }
  return null;
}
