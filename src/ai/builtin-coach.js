/**
 * Built-in offline heuristic coach. Parses the FEN, computes real position
 * features (material, king safety, pawn structure, loose pieces, phase, named
 * opening) and answers position-specific questions.
 *
 * All user-facing text goes through `i18n.t()`. The opening book's keys are
 * the SAN prefix → opening-id; the id looks up a translated name and tip in
 * the current language bundle.
 */
import { i18n } from '../core/i18n.js';

const FILES = 'abcdefgh';
const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

const sq = (r, c) => r * 8 + c;
const squareName = (r, c) => FILES[c] + (8 - r);
const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

const pieceLower = (p) => i18n.piece(p);
const pieceCap   = (p) => { const n = pieceLower(p); return n.charAt(0).toUpperCase() + n.slice(1); };
const sideName   = (color) => i18n.side(color);

// ----------------------------------------------------------------
// FEN parsing → structured position
// ----------------------------------------------------------------
function parseFEN(fen) {
  const out = {
    board: new Array(64).fill(null),
    turn: 'w',
    castling: { wk: false, wq: false, bk: false, bq: false },
    halfmove: 0,
    fullmove: 1,
    pieces: { w: [], b: [] },
    material: { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } },
    kingPos: { w: null, b: null }
  };
  if (!fen) return out;
  const parts = fen.trim().split(/\s+/);
  const rows = (parts[0] || '').split('/');
  for (let r = 0; r < 8 && r < rows.length; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { c += parseInt(ch, 10); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const piece = ch.toLowerCase();
      out.board[sq(r, c)] = { piece, color };
      out.pieces[color].push({ piece, color, r, c, square: squareName(r, c) });
      out.material[color][piece] = (out.material[color][piece] || 0) + 1;
      if (piece === 'k') out.kingPos[color] = { r, c };
      c++;
    }
  }
  out.turn = parts[1] === 'b' ? 'b' : 'w';
  const cast = parts[2] || '-';
  out.castling.wk = cast.includes('K');
  out.castling.wq = cast.includes('Q');
  out.castling.bk = cast.includes('k');
  out.castling.bq = cast.includes('q');
  out.halfmove = parseInt(parts[4] || '0', 10);
  out.fullmove = parseInt(parts[5] || '1', 10);
  return out;
}

// ----------------------------------------------------------------
// Position features
// ----------------------------------------------------------------
function materialReport(pos) {
  const m = pos.material;
  const nonPawnW = m.w.n + m.w.b + m.w.r + m.w.q;
  const nonPawnB = m.b.n + m.b.b + m.b.r + m.b.q;
  const ptsW = m.w.p + m.w.n * 3 + m.w.b * 3 + m.w.r * 5 + m.w.q * 9;
  const ptsB = m.b.p + m.b.n * 3 + m.b.b * 3 + m.b.r * 5 + m.b.q * 9;
  return { whitePoints: ptsW, blackPoints: ptsB, diff: ptsW - ptsB, nonPawnW, nonPawnB };
}

function phaseKey(pos, moveCount) {
  const mr = materialReport(pos);
  const totalNonPawn = mr.nonPawnW + mr.nonPawnB;
  const hasQueens = pos.material.w.q + pos.material.b.q > 0;
  if (moveCount < 12 && totalNonPawn >= 12) return 'opening';
  if (totalNonPawn <= 6 && !hasQueens) return 'endgame';
  if (totalNonPawn <= 8) return 'endgame';
  return 'middlegame';
}

function kingSafety(pos, color, gamePhase) {
  const k = pos.kingPos[color];
  if (!k) return { score: 'unknown', notes: [] };
  const notes = [];
  const backRank = color === 'w' ? 7 : 0;
  const castled = (k.r === backRank) && (k.c === 6 || k.c === 2);
  const center = (k.r === backRank) && (k.c === 4);
  const pawnRank = color === 'w' ? k.r - 1 : k.r + 1;
  const shield = [];
  for (let dc = -1; dc <= 1; dc++) {
    const pc = k.c + dc;
    if (!inBoard(pawnRank, pc)) continue;
    const x = pos.board[sq(pawnRank, pc)];
    if (x && x.piece === 'p' && x.color === color) shield.push(FILES[pc]);
  }
  const shieldCount = shield.length;
  const dangerFile = (() => {
    for (let r = 0; r < 8; r++) {
      const p = pos.board[sq(r, k.c)];
      if (p && p.color !== color && (p.piece === 'r' || p.piece === 'q')) return true;
    }
    return false;
  })();

  if (gamePhase === 'endgame') {
    let score = 'active';
    if (castled) { score = 'shelter'; notes.push(i18n.t('coach.builtin.kingNote.tuckedCorner')); }
    else if (center) { score = 'waiting'; notes.push(i18n.t('coach.builtin.kingNote.startingSquare')); }
    else notes.push(i18n.t('coach.builtin.kingNote.activeOn', { square: squareName(k.r, k.c) }));
    return { score, castled, center, shieldCount, notes };
  }

  let score = 'safe';
  if (!castled && !center) { score = 'exposed'; notes.push(i18n.t('coach.builtin.kingNote.wanderingOn', { square: squareName(k.r, k.c) })); }
  else if (center && pos.fullmove > 8) { score = 'exposed'; notes.push(i18n.t('coach.builtin.kingNote.centerAfter8')); }
  if (shieldCount <= 1 && (castled || center)) { score = 'exposed'; notes.push(i18n.t('coach.builtin.kingNote.thinShield', { count: shieldCount })); }
  if (dangerFile) { score = 'danger'; notes.push(i18n.t('coach.builtin.kingNote.enemyHeavy')); }
  if (castled && shieldCount === 3 && !dangerFile) notes.push(i18n.t('coach.builtin.kingNote.fullShield'));
  return { score, castled, center, shieldCount, notes };
}

function pawnStructure(pos, color) {
  const pawns = pos.pieces[color].filter(p => p.piece === 'p');
  const filesOccupied = {};
  for (const p of pawns) filesOccupied[p.c] = (filesOccupied[p.c] || 0) + 1;
  const isolated = [];
  const doubled = [];
  const passed = [];

  for (const p of pawns) {
    const left = filesOccupied[p.c - 1] || 0;
    const right = filesOccupied[p.c + 1] || 0;
    if (left === 0 && right === 0) isolated.push(p.square);
    if (filesOccupied[p.c] > 1) doubled.push(p.square);

    const enemy = color === 'w' ? 'b' : 'w';
    const ahead = (rr) => color === 'w' ? rr < p.r : rr > p.r;
    let isPassed = true;
    for (const ep of pos.pieces[enemy]) {
      if (ep.piece !== 'p') continue;
      if (!ahead(ep.r)) continue;
      if (Math.abs(ep.c - p.c) <= 1) { isPassed = false; break; }
    }
    if (isPassed) passed.push(p.square);
  }
  return {
    count: pawns.length,
    isolated: [...new Set(isolated)],
    doubled: [...new Set(doubled.map(s => s[0]))],
    passed: [...new Set(passed)]
  };
}

function developmentReport(pos, color) {
  const starts = color === 'w'
    ? { n: ['b1', 'g1'], b: ['c1', 'f1'], q: ['d1'] }
    : { n: ['b8', 'g8'], b: ['c8', 'f8'], q: ['d8'] };
  const minorHome = [];
  let minorDev = 0;
  for (const p of pos.pieces[color]) {
    if (p.piece === 'n' || p.piece === 'b') {
      if (starts[p.piece].includes(p.square)) minorHome.push(p.square);
      else minorDev++;
    }
  }
  const queenMoved = !pos.pieces[color].some(p => p.piece === 'q' && starts.q.includes(p.square));
  const k = pos.kingPos[color];
  const backRank = color === 'w' ? 7 : 0;
  const castled = k && k.r === backRank && (k.c === 6 || k.c === 2);
  return { minorDev, minorHome, queenMoved, castled };
}

function centerControl(pos, color) {
  const centers = [[3, 3], [3, 4], [4, 3], [4, 4]];
  let occ = 0, pawnsOnCenter = 0;
  for (const [r, c] of centers) {
    const p = pos.board[sq(r, c)];
    if (p && p.color === color) {
      occ++;
      if (p.piece === 'p') pawnsOnCenter++;
    }
  }
  return { occ, pawnsOnCenter };
}

/** Heuristic "loose pieces" — undefended enemy pieces we might target. */
function loosePieces(pos, color) {
  const loose = [];
  for (const p of pos.pieces[color]) {
    if (p.piece === 'p' || p.piece === 'k') continue;
    const pawnDir = color === 'w' ? 1 : -1;
    let defended = false;
    for (const dc of [-1, 1]) {
      const dr = p.r + pawnDir;
      if (!inBoard(dr, p.c + dc)) continue;
      const x = pos.board[sq(dr, p.c + dc)];
      if (x && x.piece === 'p' && x.color === color) { defended = true; break; }
    }
    if (!defended) {
      outer: for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (!inBoard(p.r + dr, p.c + dc)) continue;
        const x = pos.board[sq(p.r + dr, p.c + dc)];
        if (x && x.color === color && x !== p) { defended = true; break outer; }
      }
    }
    if (!defended) loose.push({ piece: p.piece, square: p.square });
  }
  return loose;
}

// ----------------------------------------------------------------
// Opening book — SAN prefix → opening id (keys live in i18n bundle)
// ----------------------------------------------------------------
const OPENING_BOOK = [
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'ruyLopezMorphy'],
  ['e4 e5 Nf3 Nc6 Bb5',    'ruyLopez'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5','italianGiuocoPiano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6','italianTwoKnights'],
  ['e4 e5 Nf3 Nc6 Bc4',    'italianGame'],
  ['e4 e5 Nf3 Nf6',        'petroff'],
  ['e4 e5 Nf3 Nc6 d4',     'scotchGame'],
  ['e4 e5 Nc3',            'viennaGame'],
  ['e4 e5 f4',             'kingsGambit'],
  ['e4 e5 Nf3',            'openGame'],
  ['e4 e5',                'kingsPawnGame'],
  ['e4 c5 Nf3 d6',         'sicilianNajdorf'],
  ['e4 c5 Nf3 Nc6',        'sicilianOpenNc6'],
  ['e4 c5 Nf3 e6',         'sicilianTaimanovKan'],
  ['e4 c5 Nc3',            'sicilianClosed'],
  ['e4 c5',                'sicilian'],
  ['e4 e6 d4 d5',          'french'],
  ['e4 e6',                'french'],
  ['e4 c6 d4 d5',          'caroKann'],
  ['e4 c6',                'caroKann'],
  ['e4 d5',                'scandinavian'],
  ['e4 d6',                'pirc'],
  ['e4 g6',                'modern'],
  ['e4 Nf6',               'alekhine'],
  ['d4 d5 c4 e6',          'queensGambitDeclined'],
  ['d4 d5 c4 c6',          'slav'],
  ['d4 d5 c4 dxc4',        'queensGambitAccepted'],
  ['d4 d5 c4',             'queensGambit'],
  ['d4 d5 Nf3',            'londonSetup'],
  ['d4 d5 Bf4',            'london'],
  ['d4 Nf6 c4 g6',         'kingsIndian'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'nimzoIndian'],
  ['d4 Nf6 c4 e6',         'queensIndian'],
  ['d4 Nf6 c4 c5',         'benoni'],
  ['d4 Nf6 Bf4',           'london'],
  ['d4 Nf6',               'indianGame'],
  ['d4 f5',                'dutch'],
  ['c4',                   'english'],
  ['Nf3 d5 c4',            'reti'],
  ['Nf3 d5',               'retiKia'],
  ['Nf3',                  'retiSetup'],
  ['b3',                   'larsen'],
  ['b4',                   'sokolsky'],
  ['g3',                   'benko']
];

function detectOpeningId(sanHistory) {
  const line = sanHistory.map(s => String(s).replace(/[+#?!]/g, '')).join(' ');
  for (const [key, id] of OPENING_BOOK) {
    if (line.startsWith(key)) return id;
  }
  return null;
}

// ----------------------------------------------------------------
// Response helpers
// ----------------------------------------------------------------
function formatEval(cp, turn) {
  if (cp === undefined || cp === null) return i18n.t('coach.builtin.eval.unclear');
  const pawns = (cp / 100).toFixed(2);
  if (Math.abs(cp) < 30) return i18n.t('coach.builtin.eval.balanced', { pawns });
  const sideColor = cp > 0 ? turn : (turn === 'w' ? 'b' : 'w');
  const side = sideName(sideColor);
  const sign = cp > 0 ? '+' : '';
  return i18n.t('coach.builtin.eval.better', { sign, pawns, side });
}

function quickPulse(mr, ph, turn) {
  const phase = i18n.t('coach.builtin.phase.' + ph);
  const bits = [];
  if (mr.diff !== 0) {
    const sideColor = mr.diff > 0 ? 'w' : 'b';
    bits.push(i18n.t('coach.builtin.summary.pulseMaterial', {
      sign: mr.diff > 0 ? '+' : '', n: Math.abs(mr.diff), side: sideName(sideColor)
    }));
  } else {
    bits.push(i18n.t('coach.builtin.summary.pulseMaterialEven'));
  }
  bits.push(i18n.t('coach.builtin.summary.pulsePhase', { phase }));
  bits.push(i18n.t('coach.builtin.summary.pulseToMove', { side: sideName(turn) }));
  return bits.join(' · ');
}

function scoreLabel(key) { return i18n.t('coach.builtin.kingScore.' + key); }

function looseList(loose) {
  return loose.map(l => `${pieceCap(l.piece)} ${i18n.t('coach.builtin.on')} ${l.square}`).join(', ');
}

// ----------------------------------------------------------------
// Responders
// ----------------------------------------------------------------
function respondBestMove(ctx, pos, mr, ph, ksW, ksB, psW, psB, loose) {
  let out = '';
  if (ctx.bestMoveHint) out += i18n.t('coach.builtin.bestMove.recommendation', { move: ctx.bestMoveHint }) + '\n\n';
  else if (ctx.legalSample?.length) out += i18n.t('coach.builtin.bestMove.shallow', { move: ctx.legalSample[0] }) + '\n\n';
  out += i18n.t('coach.builtin.bestMove.whyHeader') + '\n';

  if (ph === 'opening') {
    const dev = developmentReport(pos, ctx.turn);
    if (!dev.castled) out += i18n.t('coach.builtin.bestMove.castle') + '\n';
    if (dev.minorHome.length > 0) out += i18n.t('coach.builtin.bestMove.develop', { squares: dev.minorHome.join(', ') }) + '\n';
    const cc = centerControl(pos, ctx.turn);
    if (cc.pawnsOnCenter === 0) out += i18n.t('coach.builtin.bestMove.center') + '\n';
  } else if (ph === 'middlegame') {
    if (loose.length > 0) {
      const pieceWord = loose.length > 1
        ? i18n.t('coach.builtin.loosePieces.plural')
        : i18n.t('coach.builtin.loosePieces.singular');
      out += i18n.t('coach.builtin.bestMove.loose', { pieceWord, list: looseList(loose) }) + '\n';
    }
    const opp = ctx.turn === 'w' ? ksB : ksW;
    if (opp.score !== 'safe') out += i18n.t('coach.builtin.bestMove.oppKing', { score: scoreLabel(opp.score) }) + '\n';
    const own = ctx.turn === 'w' ? ksW : ksB;
    if (own.score === 'danger') out += i18n.t('coach.builtin.bestMove.ownKing') + '\n';
  } else {
    const ps = ctx.turn === 'w' ? psW : psB;
    if (ps.passed.length > 0) {
      const pawnWord = ps.passed.length > 1
        ? i18n.t('coach.builtin.passedPawns.plural')
        : i18n.t('coach.builtin.passedPawns.singular');
      out += i18n.t('coach.builtin.bestMove.passedEnd', { pawnWord, squares: ps.passed.join(', ') }) + '\n';
    }
    out += i18n.t('coach.builtin.bestMove.activeKing') + '\n';
    if (mr.diff !== 0) {
      const state = i18n.t(mr.diff > 0 ? 'coach.builtin.bestMove.ahead' : 'coach.builtin.bestMove.behind');
      const advice = i18n.t(mr.diff > 0 ? 'coach.builtin.bestMove.adviceAhead' : 'coach.builtin.bestMove.adviceBehind');
      out += i18n.t('coach.builtin.bestMove.aheadBehind', { state, n: Math.abs(mr.diff), advice }) + '\n';
    }
  }
  out += '\n' + i18n.t('coach.builtin.bestMove.evalSuffix', { eval: formatEval(ctx.evalScore, ctx.turn) });
  return out;
}

function respondTactics(ctx, pos, loose) {
  const turn = sideName(ctx.turn);
  const ph = phaseKey(pos, (ctx.moveHistory || []).length);
  const ksW = kingSafety(pos, 'w', ph);
  const ksB = kingSafety(pos, 'b', ph);
  const targetSide = ctx.turn === 'w' ? 'b' : 'w';
  const theirKing = targetSide === 'w' ? ksW : ksB;

  const lines = [];
  if (loose.length > 0) {
    const pieceWord = loose.length > 1
      ? i18n.t('coach.builtin.tactics.undefendedPlural')
      : i18n.t('coach.builtin.tactics.undefendedSingle');
    const list = loose.map(l => `${PIECE_GLYPH[l.piece]} ${pieceLower(l.piece)} ${i18n.t('coach.builtin.on')} <b>${l.square}</b>`).join(', ');
    lines.push(i18n.t('coach.builtin.tactics.loose', { n: loose.length, pieceWord, list }));
  } else {
    lines.push(i18n.t('coach.builtin.tactics.defended'));
  }
  if (theirKing.score !== 'safe') {
    const notes = theirKing.notes.join(', ') || i18n.t('coach.builtin.tactics.openLines');
    lines.push(i18n.t('coach.builtin.tactics.exposedKing', { score: scoreLabel(theirKing.score), notes }));
  }
  if (pos.material[targetSide].q > 0) {
    const q = pos.pieces[targetSide].find(p => p.piece === 'q');
    if (q) lines.push(i18n.t('coach.builtin.tactics.queenTarget', { square: q.square }));
  }
  if (ctx.bestMoveHint) lines.push(i18n.t('coach.builtin.tactics.engineSuggests', { move: ctx.bestMoveHint }));

  return i18n.t('coach.builtin.tactics.header', { side: turn }) + '\n\n' +
    lines.map(l => '• ' + l).join('\n') + '\n\n' +
    i18n.t('coach.builtin.tactics.footer');
}

function respondPlan(ctx, pos, mr, ph, ksW, ksB, psW, psB) {
  const turn = sideName(ctx.turn);
  const myKS = ctx.turn === 'w' ? ksW : ksB;
  const oppKS = ctx.turn === 'w' ? ksB : ksW;
  const myPawns = ctx.turn === 'w' ? psW : psB;
  const plans = [];

  if (ph === 'opening') {
    const dev = developmentReport(pos, ctx.turn);
    if (dev.minorHome.length > 0) {
      const pieceWord = dev.minorHome.length > 1
        ? i18n.t('coach.builtin.plan.minorPlural')
        : i18n.t('coach.builtin.plan.minorSingular');
      plans.push(i18n.t('coach.builtin.plan.developMinors', { pieceWord, squares: dev.minorHome.join(', ') }));
    }
    if (!dev.castled) plans.push(i18n.t('coach.builtin.plan.castle'));
    if (dev.queenMoved && dev.minorHome.length > 0) plans.push(i18n.t('coach.builtin.plan.queenEarly'));
    const cc = centerControl(pos, ctx.turn);
    if (cc.pawnsOnCenter === 0) plans.push(i18n.t('coach.builtin.plan.centerPawn'));
  } else if (ph === 'middlegame') {
    if (myKS.score === 'danger') plans.push(i18n.t('coach.builtin.plan.kingDanger'));
    if (myKS.castled && oppKS.castled && myKS.notes.length > 0) {
      plans.push(i18n.t('coach.builtin.plan.oppositeWings'));
    }
    if (myPawns.passed.length > 0) {
      const pawnWord = myPawns.passed.length > 1
        ? i18n.t('coach.builtin.plan.passedPawnPlural')
        : i18n.t('coach.builtin.plan.passedPawnSingular');
      plans.push(i18n.t('coach.builtin.plan.pushPassed', { pawnWord, squares: myPawns.passed.join(', ') }));
    }
    if (myPawns.isolated.length > 0) {
      const pawnWord = myPawns.isolated.length > 1
        ? i18n.t('coach.builtin.plan.isolatedPlural')
        : i18n.t('coach.builtin.plan.isolatedSingular');
      plans.push(i18n.t('coach.builtin.plan.isolated', { pawnWord, squares: myPawns.isolated.join(', ') }));
    }
    plans.push(i18n.t('coach.builtin.plan.improveWorst'));
  } else {
    if (myPawns.passed.length > 0) {
      const pawnWord = myPawns.passed.length > 1
        ? i18n.t('coach.builtin.plan.racePlural')
        : i18n.t('coach.builtin.plan.raceSingular');
      plans.push(i18n.t('coach.builtin.plan.racePassed', { pawnWord, squares: myPawns.passed.join(', ') }));
    }
    plans.push(i18n.t('coach.builtin.plan.activateKing'));
    if (mr.diff > 0) plans.push(i18n.t('coach.builtin.plan.aheadTrade', { n: mr.diff }));
    else if (mr.diff < 0) plans.push(i18n.t('coach.builtin.plan.behindKeep', { n: Math.abs(mr.diff) }));
    if (myPawns.count <= 2) plans.push(i18n.t('coach.builtin.plan.fewPawns'));
  }
  const phase = i18n.t('coach.builtin.phase.' + ph);
  return i18n.t('coach.builtin.plan.header', { side: turn, phase }) + '\n\n' +
    plans.map(p => '• ' + p).join('\n');
}

function respondLastMove(ctx) {
  if (!ctx.lastMove) return i18n.t('coach.builtin.lastMove.none');
  const san = ctx.lastMove;
  const anns = [];
  if (san.includes('x'))          anns.push(i18n.t('coach.builtin.lastMove.capture'));
  if (san.endsWith('+'))          anns.push(i18n.t('coach.builtin.lastMove.check'));
  if (san.endsWith('#'))          anns.push(i18n.t('coach.builtin.lastMove.checkmate'));
  if (san.startsWith('O-O-O'))    anns.push(i18n.t('coach.builtin.lastMove.castleQueenside'));
  else if (san.startsWith('O-O')) anns.push(i18n.t('coach.builtin.lastMove.castleKingside'));
  if (san.includes('='))          anns.push(i18n.t('coach.builtin.lastMove.promote'));
  let out = anns.length
    ? i18n.t('coach.builtin.lastMove.line', { san, anns: anns.join(', ') })
    : i18n.t('coach.builtin.lastMove.quiet', { san });
  out += '\n\n' + i18n.t('coach.builtin.lastMove.evalLine', { eval: formatEval(ctx.evalScore, ctx.turn) });
  if (ctx.bestMoveHint) out += i18n.t('coach.builtin.lastMove.topChoice', { move: ctx.bestMoveHint });
  return out;
}

function respondOpening(moves) {
  if (moves.length === 0) {
    return i18n.t('coach.builtin.opening.noneHeader') + '\n\n' +
      '• ' + i18n.t('coach.builtin.opening.noneE4') + '\n' +
      '• ' + i18n.t('coach.builtin.opening.noneD4') + '\n' +
      '• ' + i18n.t('coach.builtin.opening.noneNf3') + '\n' +
      '• ' + i18n.t('coach.builtin.opening.noneC4') + '\n\n' +
      i18n.t('coach.builtin.opening.nonePick');
  }
  const id = detectOpeningId(moves);
  if (id) {
    const name = i18n.t('coach.openingNames.' + id);
    const tip = i18n.t('coach.openingTips.' + id) || i18n.t('coach.openingTips.generic');
    const shown = moves.slice(0, 12).join(' ') + (moves.length > 12 ? '…' : '');
    return i18n.t('coach.builtin.opening.known', { name, tip, moves: shown });
  }
  const moveWord = moves.length === 1
    ? i18n.t('coach.builtin.opening.moveSingular')
    : i18n.t('coach.builtin.opening.movePlural');
  return i18n.t('coach.builtin.opening.unknownHeader', { n: moves.length, moveWord }) + '\n' +
    i18n.t('coach.builtin.opening.unknownP1') + '\n' +
    i18n.t('coach.builtin.opening.unknownP2') + '\n' +
    i18n.t('coach.builtin.opening.unknownP3');
}

function respondEndgame(psW, psB) {
  const none = i18n.t('coach.builtin.endgame.none');
  return [
    i18n.t('coach.builtin.endgame.header'),
    '',
    i18n.t('coach.builtin.endgame.activateKing'),
    i18n.t('coach.builtin.endgame.passed', {
      w: psW.passed.length ? psW.passed.join(', ') : none,
      b: psB.passed.length ? psB.passed.join(', ') : none
    }),
    i18n.t('coach.builtin.endgame.opposition'),
    i18n.t('coach.builtin.endgame.rookRule'),
    i18n.t('coach.builtin.endgame.tradePieces')
  ].join('\n');
}

function respondEvaluation(ctx, pos, mr, ph, ksW, ksB, psW, psB) {
  const phase = i18n.t('coach.builtin.phase.' + ph);
  const turn = sideName(ctx.turn);
  const out = [i18n.t('coach.builtin.evaluation.header', { phase, side: turn }), ''];

  let diffSuffix = i18n.t('coach.builtin.evaluation.equalSuffix');
  if (mr.diff !== 0) {
    diffSuffix = i18n.t('coach.builtin.evaluation.diffSuffix', {
      side: mr.diff > 0 ? sideName('w') : sideName('b'),
      n: Math.abs(mr.diff)
    });
  }
  out.push(i18n.t('coach.builtin.evaluation.material', { w: mr.whitePoints, b: mr.blackPoints, diff: diffSuffix }));
  out.push(i18n.t('coach.builtin.evaluation.engine', { eval: formatEval(ctx.evalScore, ctx.turn) }));

  const notesFmt = (arr) => arr.length ? i18n.t('coach.builtin.evaluation.notesFmt', { notes: arr.join(', ') }) : '';
  out.push(i18n.t('coach.builtin.evaluation.whiteKing', { score: scoreLabel(ksW.score), notes: notesFmt(ksW.notes) }));
  out.push(i18n.t('coach.builtin.evaluation.blackKing', { score: scoreLabel(ksB.score), notes: notesFmt(ksB.notes) }));

  const weakList = (ps) => {
    const bits = [];
    for (const s of ps.isolated) bits.push(i18n.t('coach.builtin.evaluation.isolatedPrefix', { sq: s }));
    for (const f of ps.doubled) bits.push(i18n.t('coach.builtin.evaluation.doubledPrefix', { file: f }));
    return bits;
  };
  const wWeak = weakList(psW);
  const bWeak = weakList(psB);
  if (wWeak.length) out.push(i18n.t('coach.builtin.evaluation.pawnWeaknessesWhite', { list: wWeak.join(', ') }));
  if (bWeak.length) out.push(i18n.t('coach.builtin.evaluation.pawnWeaknessesBlack', { list: bWeak.join(', ') }));

  if (psW.passed.length) {
    const pawnWord = psW.passed.length > 1
      ? i18n.t('coach.builtin.evaluation.passedPlural')
      : i18n.t('coach.builtin.evaluation.passedSingular');
    out.push(i18n.t('coach.builtin.evaluation.passedWhite', { pawnWord, squares: psW.passed.join(', ') }));
  }
  if (psB.passed.length) {
    const pawnWord = psB.passed.length > 1
      ? i18n.t('coach.builtin.evaluation.passedPlural')
      : i18n.t('coach.builtin.evaluation.passedSingular');
    out.push(i18n.t('coach.builtin.evaluation.passedBlack', { pawnWord, squares: psB.passed.join(', ') }));
  }
  if (ctx.bestMoveHint) out.push(i18n.t('coach.builtin.evaluation.topMove', { move: ctx.bestMoveHint }));
  return out.join('\n');
}

function respondKingSafety(ksW, ksB, turnColor) {
  const head = i18n.t('coach.builtin.kingSafety.header');
  const youStr = i18n.t('coach.builtin.kingSafety.you');
  const oppStr = i18n.t('coach.builtin.kingSafety.opponent');
  const castledW = ksW.castled ? i18n.t('coach.builtin.kingSafety.castledSuffix') : '';
  const castledB = ksB.castled ? i18n.t('coach.builtin.kingSafety.castledSuffix') : '';
  const notesW = ksW.notes.join(', ') || i18n.t('coach.builtin.kingSafety.noConcerns');
  const notesB = ksB.notes.join(', ') || i18n.t('coach.builtin.kingSafety.noConcerns');
  return head + '\n\n' +
    i18n.t('coach.builtin.kingSafety.line', {
      side: sideName('w'), who: turnColor === 'w' ? youStr : oppStr,
      score: scoreLabel(ksW.score), castled: castledW, notes: notesW
    }) + '\n' +
    i18n.t('coach.builtin.kingSafety.line', {
      side: sideName('b'), who: turnColor === 'b' ? youStr : oppStr,
      score: scoreLabel(ksB.score), castled: castledB, notes: notesB
    }) + '\n\n' +
    i18n.t('coach.builtin.kingSafety.footer');
}

function respondPawns(psW, psB) {
  const out = [i18n.t('coach.builtin.pawns.header')];
  for (const [sideColor, ps] of [['w', psW], ['b', psB]]) {
    out.push('');
    out.push(i18n.t('coach.builtin.pawns.side', { side: sideName(sideColor), n: ps.count }));
    if (ps.isolated.length) out.push(i18n.t('coach.builtin.pawns.isolated', { squares: ps.isolated.join(', ') }));
    if (ps.doubled.length)  out.push(i18n.t('coach.builtin.pawns.doubled', { files: ps.doubled.join(', ') }));
    if (ps.passed.length)   out.push(i18n.t('coach.builtin.pawns.passed', { squares: ps.passed.join(', ') }));
    if (!ps.isolated.length && !ps.doubled.length && !ps.passed.length) out.push(i18n.t('coach.builtin.pawns.clean'));
  }
  return out.join('\n');
}

function respondDevelopment(pos, ph) {
  const w = developmentReport(pos, 'w');
  const b = developmentReport(pos, 'b');
  const lines = [i18n.t('coach.builtin.development.header'), ''];
  const homeSuffix = (arr) => arr.length ? i18n.t('coach.builtin.development.homeSuffix', { squares: arr.join(', ') }) : '';
  const castledSuffix = (cast) => cast ? i18n.t('coach.builtin.development.castledSuffix') : '';
  lines.push(i18n.t('coach.builtin.development.white', { n: w.minorDev, castled: castledSuffix(w.castled), home: homeSuffix(w.minorHome) }));
  lines.push(i18n.t('coach.builtin.development.black', { n: b.minorDev, castled: castledSuffix(b.castled), home: homeSuffix(b.minorHome) }));
  if (ph === 'opening') { lines.push(''); lines.push(i18n.t('coach.builtin.development.openingNote')); }
  return lines.join('\n');
}

function respondImprovement(ph) {
  const lines = [
    i18n.t('coach.builtin.improvement.header'),
    '',
    i18n.t('coach.builtin.improvement.intro'),
    '',
    i18n.t('coach.builtin.improvement.commonHeader'),
    i18n.t('coach.builtin.improvement.bishop'),
    i18n.t('coach.builtin.improvement.knight'),
    i18n.t('coach.builtin.improvement.rook'),
    i18n.t('coach.builtin.improvement.queen')
  ];
  if (ph === 'middlegame') lines.push(i18n.t('coach.builtin.improvement.kingMid'));
  return lines.join('\n');
}

function respondSummary(ctx, pos, mr, ph, ksW, ksB, loose) {
  const pulse = quickPulse(mr, ph, ctx.turn);
  const lines = [i18n.t('coach.builtin.summary.header', { pulse }), ''];
  const diff = mr.diff
    ? i18n.t('coach.builtin.summary.diff', { sign: mr.diff > 0 ? '+' : '', n: mr.diff })
    : i18n.t('coach.builtin.summary.equal');
  lines.push(i18n.t('coach.builtin.summary.material', { w: mr.whitePoints, b: mr.blackPoints, diff }));
  const castledGlyph = i18n.t('coach.builtin.summary.castledGlyph');
  lines.push(i18n.t('coach.builtin.summary.kings', {
    wScore: scoreLabel(ksW.score), wCastled: ksW.castled ? castledGlyph : '',
    bScore: scoreLabel(ksB.score), bCastled: ksB.castled ? castledGlyph : ''
  }));
  if (ctx.evalScore !== undefined) lines.push(i18n.t('coach.builtin.summary.eval', { eval: formatEval(ctx.evalScore, ctx.turn) }));
  if (ctx.bestMoveHint)            lines.push(i18n.t('coach.builtin.summary.engineSuggests', { move: ctx.bestMoveHint }));
  if (loose.length) {
    const list = loose.map(l => `${pieceLower(l.piece)}/${l.square}`).join(', ');
    lines.push(i18n.t('coach.builtin.summary.target', { list }));
  }
  lines.push('');
  lines.push(i18n.t('coach.builtin.summary.menu'));
  return lines.join('\n');
}

// ----------------------------------------------------------------
// Public class
// ----------------------------------------------------------------
export class BuiltinCoach {
  get id() { return 'builtin'; }
  get name() { return i18n.t('coach.builtin.name'); }

  ask(question, ctx) {
    const q = (question || '').toLowerCase();
    const pos = parseFEN(ctx.fen);
    const moves = ctx.moveHistory || [];
    const mr = materialReport(pos);
    const ph = phaseKey(pos, moves.length);
    const ksW = kingSafety(pos, 'w', ph);
    const ksB = kingSafety(pos, 'b', ph);
    const psW = pawnStructure(pos, 'w');
    const psB = pawnStructure(pos, 'b');
    const loose = loosePieces(pos, ctx.turn === 'w' ? 'b' : 'w');

    if (/best move|what.*play|recommend|top move|what should.*i.*play/.test(q)) return respondBestMove(ctx, pos, mr, ph, ksW, ksB, psW, psB, loose);
    if (/tactic|motif|fork|pin|skewer|discovered|hang|threat/.test(q))           return respondTactics(ctx, pos, loose);
    if (/plan|strategy|long.?term|what.*do.*next|what.*should.*i.*do|what now/.test(q)) return respondPlan(ctx, pos, mr, ph, ksW, ksB, psW, psB);
    if (/last move|why.*that move|explain.*move|analyz.*last|explain last/.test(q)) return respondLastMove(ctx);
    if (/opening|first move/.test(q))                                             return respondOpening(moves);
    if (/endgame|pawn endgame|king.*activ/.test(q))                               return respondEndgame(psW, psB);
    if (/evaluat|eval|who.*better|winning|losing|standing|assess/.test(q))        return respondEvaluation(ctx, pos, mr, ph, ksW, ksB, psW, psB);
    if (/king safety|attack.*king|defend.*king/.test(q))                          return respondKingSafety(ksW, ksB, ctx.turn);
    if (/pawn.*structure|weak.*pawn|isolated|doubled|passed/.test(q))             return respondPawns(psW, psB);
    if (/develop|developm/.test(q))                                               return respondDevelopment(pos, ph);
    if (/weak|worst piece|improve|bad piece/.test(q))                             return respondImprovement(ph);
    return respondSummary(ctx, pos, mr, ph, ksW, ksB, loose);
  }
}
