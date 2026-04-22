/**
 * Built-in offline heuristic coach. Parses the FEN, computes real position
 * features (material, king safety, pawn structure, loose pieces, phase, named
 * opening) and answers position-specific questions.
 *
 * Intent-routed responders: given the user's natural-language question, we
 * match a small set of intents and dispatch to a specialist responder that
 * assembles a concrete, position-grounded reply.
 *
 * No network, no keys — always available.
 */

const FILES = 'abcdefgh';
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PIECE_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

const sq = (r, c) => r * 8 + c;
const squareName = (r, c) => FILES[c] + (8 - r);
const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

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

function phaseOf(pos, moveCount) {
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
    if (castled) { score = 'shelter'; notes.push(`still tucked in the corner — centralize him`); }
    else if (center) { score = 'waiting'; notes.push(`king on his starting square — walk him out`); }
    else notes.push(`active king on ${squareName(k.r, k.c)}`);
    return { score, castled, center, shieldCount, notes };
  }

  let score = 'safe';
  if (!castled && !center) { score = 'exposed'; notes.push(`king wandering on ${squareName(k.r, k.c)}`); }
  else if (center && pos.fullmove > 8) { score = 'exposed'; notes.push('king still in the center after move 8'); }
  if (shieldCount <= 1 && (castled || center)) { score = 'exposed'; notes.push(`thin pawn cover (${shieldCount}/3)`); }
  if (dangerFile) { score = 'danger'; notes.push(`enemy heavy piece on the king's file`); }
  if (castled && shieldCount === 3 && !dangerFile) notes.push('castled with a full pawn shield');
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
// Opening book
// ----------------------------------------------------------------
const OPENING_BOOK = [
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez — Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game — Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game — Two Knights'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nf6', 'Petroff Defense'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nc3', 'Vienna Game'],
  ['e4 e5 f4', 'King\'s Gambit'],
  ['e4 e5 Nf3', 'Open Game'],
  ['e4 e5', 'King\'s Pawn Game'],
  ['e4 c5 Nf3 d6', 'Sicilian — Najdorf complex'],
  ['e4 c5 Nf3 Nc6', 'Sicilian — Open with ...Nc6'],
  ['e4 c5 Nf3 e6', 'Sicilian — Taimanov/Kan'],
  ['e4 c5 Nc3', 'Sicilian — Closed'],
  ['e4 c5', 'Sicilian Defense'],
  ['e4 e6 d4 d5', 'French Defense'],
  ['e4 e6', 'French Defense'],
  ['e4 c6 d4 d5', 'Caro-Kann'],
  ['e4 c6', 'Caro-Kann Defense'],
  ['e4 d5', 'Scandinavian Defense'],
  ['e4 d6', 'Pirc Defense'],
  ['e4 g6', 'Modern Defense'],
  ['e4 Nf6', 'Alekhine\'s Defense'],
  ['d4 d5 c4 e6', 'Queen\'s Gambit Declined'],
  ['d4 d5 c4 c6', 'Slav Defense'],
  ['d4 d5 c4 dxc4', 'Queen\'s Gambit Accepted'],
  ['d4 d5 c4', 'Queen\'s Gambit'],
  ['d4 d5 Nf3', 'London System setup'],
  ['d4 d5 Bf4', 'London System'],
  ['d4 Nf6 c4 g6', 'King\'s Indian Defense'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian'],
  ['d4 Nf6 c4 e6', 'Queen\'s Indian complex'],
  ['d4 Nf6 c4 c5', 'Benoni Defense'],
  ['d4 Nf6 Bf4', 'London System'],
  ['d4 Nf6', 'Indian Game'],
  ['d4 f5', 'Dutch Defense'],
  ['c4', 'English Opening'],
  ['Nf3 d5 c4', 'Réti Opening'],
  ['Nf3 d5', 'Réti / KIA setup'],
  ['Nf3', 'Réti setup'],
  ['b3', 'Larsen\'s Opening'],
  ['b4', 'Sokolsky / Polish'],
  ['g3', 'Benko Opening']
];

const OPENING_TIPS = {
  'Ruy Lopez': 'The oldest serious opening in chess. The Bb5 pins the knight — Black usually plays ...a6 to force a decision. After Ba4, play develops into long strategic battles.',
  'Ruy Lopez — Morphy Defense': 'Black\'s main response. White usually chooses between the Main Line (Ba4 Nf6 0-0) and the Exchange Variation (Bxc6). Rich, classical chess awaits.',
  'Italian Game': 'Bc4 targets f7 — the weakest point in Black\'s camp. Develop knights to f3/c3, castle kingside, and look for d3/d4 breaks.',
  'Italian Game — Giuoco Piano': '"Quiet game" — both bishops point at each king\'s weak square. Classical setup: develop, castle, then push d4.',
  'Italian Game — Two Knights': 'Sharp play! White can try the Fried Liver (Ng5) or the quieter d4 break. Black has to navigate some tactical waters.',
  'Petroff Defense': 'Rock-solid symmetric defense. Black copies White and develops naturally — notorious for its drawish tendencies at high levels.',
  'Scotch Game': 'White opens the center early with d4. Active play for both sides, less theoretical than the Ruy.',
  'Vienna Game': 'Develops Nc3 before Nf3, keeping f-pawn free for attacking possibilities (f4 later).',
  'King\'s Gambit': 'Romantic-era sacrifice! White offers the f-pawn for rapid development and attacks on f7. Rare but thrilling.',
  'Open Game': 'Classical chess at its finest. Expect principled, center-based play.',
  'King\'s Pawn Game': 'Both sides claim central space with pawns. Sharp, direct chess is ahead.',
  'Sicilian Defense': 'The most popular answer to 1.e4. Asymmetric — White attacks on the kingside, Black counter-attacks on the queenside. Sharp, decisive games.',
  'Sicilian — Najdorf complex': 'The ultimate fighting opening. Every move is rich in theory. Prepare for dynamic, unbalanced play.',
  'Sicilian — Open with ...Nc6': 'Classical Sicilian. Expect a race between White\'s kingside attack and Black\'s queenside counter.',
  'Sicilian — Taimanov/Kan': 'Flexible, modern Sicilian. Black keeps options open for ...a6, ...b5 expansion.',
  'Sicilian — Closed': 'White avoids the Open Sicilian with Nc3. Slower, more positional game. Avoid if you love tactics.',
  'French Defense': 'Black builds a granite pawn chain. Look for ...c5 or ...f6 breaks to free the light-squared bishop.',
  'Caro-Kann': 'Solid like the French, but the light-squared bishop develops freely. Famously hard to beat.',
  'Caro-Kann Defense': 'Solid and flexible. ...d5 is coming next with full central counterplay.',
  'Scandinavian Defense': 'Black attacks the e4 pawn immediately. After Nc3 the queen gets chased — careful with her placement.',
  'Pirc Defense': 'Hypermodern. Black invites White to build a big center, then strikes it with pawn breaks.',
  'Modern Defense': 'Similar to the Pirc but even more flexible. Black delays committing to a setup.',
  'Alekhine\'s Defense': 'Provocative! Black lures White\'s pawns forward, then attacks them. Sharp and unconventional.',
  'Queen\'s Gambit': 'Offer the c-pawn to deflect Black\'s d-pawn and dominate the center. Classical, principled, top-tier.',
  'Queen\'s Gambit Declined': 'Black refuses the pawn and builds a solid structure. The quintessential positional opening.',
  'Queen\'s Gambit Accepted': 'Black takes the pawn, plans to give it back for active piece play.',
  'Slav Defense': 'Supports the d5 pawn with ...c6. Solid, hard to break down, keeps the bishop on c8 alive.',
  'London System setup': 'White\'s universal system — Bf4 and stable development. Less theory, reliable results.',
  'London System': 'Solid and easy to learn. Claim d4, develop Bf4, play Nf3, Nbd2, c3, e3. Stable foundation.',
  'King\'s Indian Defense': 'Hypermodern classic. Let White build a huge center, then blast it with ...e5 or ...c5. Kingside attacks are legendary.',
  'Nimzo-Indian': 'Black pins the knight with Bb4 and plays to double White\'s pawns on c-file. Strategic, high-class chess.',
  'Queen\'s Indian complex': 'Solid, fianchetto-based setup. Popular at master level for its drawing chances.',
  'Benoni Defense': 'Sharp, unbalanced, tactical. Black gives up the center for activity.',
  'Indian Game': 'Hypermodern response. Wait to see White\'s plan before committing.',
  'Dutch Defense': 'Black plays ...f5 to fight for e4. Sharp, double-edged. Careful with king safety!',
  'English Opening': 'Flexible flank opening. Often transposes into Queen\'s Gambit or King\'s Indian structures. Hard for Black to prepare against.',
  'Réti Opening': 'Hypermodern — attack the center from the flanks. Great if you love positional play.',
  'Réti / KIA setup': 'Flexible — can transpose into the King\'s Indian Attack or other closed setups.',
  'Réti setup': 'Quiet flexibility. Often transposes.',
  'Larsen\'s Opening': 'Fianchetto the queen\'s bishop early. Unusual but sound.',
  'Sokolsky / Polish': 'Bb2 fianchetto with b4 thrown in. Offbeat — catch your opponent unprepared!',
  'Benko Opening': 'Quiet fianchetto system. Flexible, low-theory, positional.'
};

function detectOpening(sanHistory) {
  const line = sanHistory.map(s => String(s).replace(/[+#?!]/g, '')).join(' ');
  for (const [key, name] of OPENING_BOOK) {
    if (line.startsWith(key)) return name;
  }
  return null;
}

// ----------------------------------------------------------------
// Response helpers
// ----------------------------------------------------------------
function formatEval(cp, turn) {
  if (cp === undefined || cp === null) return 'unclear';
  const pawns = (cp / 100).toFixed(2);
  if (Math.abs(cp) < 30) return `balanced (${pawns})`;
  const side = cp > 0 ? (turn === 'w' ? 'White' : 'Black') : (turn === 'w' ? 'Black' : 'White');
  return cp > 0 ? `+${pawns} — **${side}** is better` : `${pawns} — **${side}** is better`;
}

function quickPulse(mr, ph, turn) {
  const bits = [];
  if (mr.diff !== 0) bits.push(`material ${mr.diff > 0 ? '+' : ''}${mr.diff} for ${mr.diff > 0 ? 'White' : 'Black'}`);
  else bits.push('material even');
  bits.push(`${ph} phase`);
  bits.push(`${turn === 'w' ? 'White' : 'Black'} to move`);
  return bits.join(' · ');
}

// ----------------------------------------------------------------
// Responders — each returns the final Markdown text for one intent.
// ----------------------------------------------------------------
function respondBestMove(ctx, pos, mr, ph, ksW, ksB, psW, psB, loose) {
  let out = '';
  if (ctx.bestMoveHint) out += `My recommendation: **${ctx.bestMoveHint}**.\n\n`;
  else if (ctx.legalSample?.length) out += `Without deeper search, consider: **${ctx.legalSample[0]}**.\n\n`;
  out += `**Why this makes sense here:**\n`;

  if (ph === 'opening') {
    const dev = developmentReport(pos, ctx.turn);
    if (!dev.castled) out += `• King still in the center — castling is a top priority.\n`;
    if (dev.minorHome.length > 0) out += `• Minor pieces still on ${dev.minorHome.join(', ')} — develop them.\n`;
    const cc = centerControl(pos, ctx.turn);
    if (cc.pawnsOnCenter === 0) out += `• No pawn on the central four — a central pawn push is valuable.\n`;
  } else if (ph === 'middlegame') {
    if (loose.length > 0) {
      out += `• Opponent has **loose piece${loose.length > 1 ? 's' : ''}**: ` +
        loose.map(l => `${PIECE_NAME[l.piece]} on ${l.square}`).join(', ') + `. Look for ways to win them.\n`;
    }
    const opp = ctx.turn === 'w' ? ksB : ksW;
    if (opp.score !== 'safe') out += `• Opponent's king is **${opp.score}** — attacking moves often work.\n`;
    const own = ctx.turn === 'w' ? ksW : ksB;
    if (own.score === 'danger') out += `• Your king is under fire — consider defense first.\n`;
  } else {
    const ps = ctx.turn === 'w' ? psW : psB;
    if (ps.passed.length > 0) out += `• You have **passed pawn${ps.passed.length > 1 ? 's' : ''}** on ${ps.passed.join(', ')} — push them!\n`;
    out += `• Activate your king — in endgames, he's a fighting piece.\n`;
    if (mr.diff !== 0) out += `• You're ${mr.diff > 0 ? 'ahead' : 'behind'} ${Math.abs(mr.diff)} points — ${mr.diff > 0 ? 'trade pieces, keep pawns' : 'create complications'}.\n`;
  }
  out += `\n_Eval: ${formatEval(ctx.evalScore, ctx.turn)}_`;
  return out;
}

function respondTactics(ctx, pos, loose) {
  const turn = ctx.turn === 'w' ? 'White' : 'Black';
  const ph = phaseOf(pos, (ctx.moveHistory || []).length);
  const ksW = kingSafety(pos, 'w', ph);
  const ksB = kingSafety(pos, 'b', ph);
  const targetSide = ctx.turn === 'w' ? 'b' : 'w';
  const theirKing = targetSide === 'w' ? ksW : ksB;

  const lines = [];
  if (loose.length > 0) {
    lines.push(`Opponent has ${loose.length} undefended piece${loose.length > 1 ? 's' : ''}: ` +
      loose.map(l => `${PIECE_GLYPH[l.piece]} ${PIECE_NAME[l.piece]} on **${l.square}**`).join(', ') + `.`);
  } else {
    lines.push(`Opponent's pieces look defended. Harder tactics — look for pins, decoys, or clearance moves.`);
  }
  if (theirKing.score !== 'safe') {
    lines.push(`Their king is **${theirKing.score}** (${theirKing.notes.join(', ') || 'open lines'}) — mating patterns may be lurking.`);
  }
  if (pos.material[targetSide].q > 0) {
    const q = pos.pieces[targetSide].find(p => p.piece === 'q');
    if (q) lines.push(`Their queen on **${q.square}** — can you attack her cheaply to gain tempo?`);
  }
  if (ctx.bestMoveHint) lines.push(`Engine suggests **${ctx.bestMoveHint}** — does that move fit any of the patterns above?`);

  return `**Tactical scan for ${turn}**\n\n` + lines.map(l => '• ' + l).join('\n') +
    `\n\n_Train your eye to spot these three every move: loose pieces, exposed kings, overworked defenders._`;
}

function respondPlan(ctx, pos, mr, ph, ksW, ksB, psW, psB) {
  const turn = ctx.turn === 'w' ? 'White' : 'Black';
  const myKS = ctx.turn === 'w' ? ksW : ksB;
  const oppKS = ctx.turn === 'w' ? ksB : ksW;
  const myPawns = ctx.turn === 'w' ? psW : psB;
  const plans = [];

  if (ph === 'opening') {
    const dev = developmentReport(pos, ctx.turn);
    if (dev.minorHome.length > 0) plans.push(`Develop remaining minor piece${dev.minorHome.length > 1 ? 's' : ''} from ${dev.minorHome.join(', ')}.`);
    if (!dev.castled) plans.push(`Castle — king safety first.`);
    if (dev.queenMoved && dev.minorHome.length > 0) plans.push(`Careful — queen moved before all minor pieces were developed. Don't let her be chased.`);
    const cc = centerControl(pos, ctx.turn);
    if (cc.pawnsOnCenter === 0) plans.push(`Put a pawn on the central four (d4/e4/d5/e5).`);
  } else if (ph === 'middlegame') {
    if (myKS.score === 'danger') plans.push(`Your king is in danger — improve defense before attacking.`);
    if (myKS.castled && oppKS.castled && myKS.notes.length > 0) {
      plans.push(`You both castled — attack the opposite wing with pawns if castled on opposite sides.`);
    }
    if (myPawns.passed.length > 0) plans.push(`Push your passed pawn${myPawns.passed.length > 1 ? 's' : ''} on ${myPawns.passed.join(', ')}.`);
    if (myPawns.isolated.length > 0) plans.push(`Watch your isolated pawn${myPawns.isolated.length > 1 ? 's' : ''} on ${myPawns.isolated.join(', ')} — activity compensates for weakness.`);
    plans.push(`Improve your worst piece. Every move should make one of your pieces better.`);
  } else {
    if (myPawns.passed.length > 0) plans.push(`Race your passed pawn${myPawns.passed.length > 1 ? 's' : ''} on ${myPawns.passed.join(', ')} to promotion.`);
    plans.push(`Activate your king — walk him into the action.`);
    if (mr.diff > 0) plans.push(`You're up ${mr.diff} points — trade pieces (not pawns) to simplify to a winning endgame.`);
    else if (mr.diff < 0) plans.push(`You're down ${Math.abs(mr.diff)} points — keep pieces on the board, create counterplay, avoid trades.`);
    if (myPawns.count <= 2) plans.push(`Few pawns left — think about opposition, zugzwang, and key squares.`);
  }
  return `**Plan for ${turn}** _(${ph})_\n\n` + plans.map(p => '• ' + p).join('\n');
}

function respondLastMove(ctx) {
  if (!ctx.lastMove) return `No moves played yet — start with a central pawn (e4 or d4) or a knight move (Nf3).`;
  const san = ctx.lastMove;
  const anns = [];
  if (san.includes('x'))       anns.push('captured material');
  if (san.endsWith('+'))        anns.push('delivered check');
  if (san.endsWith('#'))        anns.push('delivered checkmate');
  if (san.startsWith('O-O-O')) anns.push('castled queenside');
  else if (san.startsWith('O-O')) anns.push('castled kingside');
  if (san.includes('='))        anns.push('promoted a pawn');
  let out = `**${san}** — `;
  out += anns.length ? anns.join(', ') + '.\n\n' : 'a quiet positional move.\n\n';
  out += `Eval now: ${formatEval(ctx.evalScore, ctx.turn)}. `;
  if (ctx.bestMoveHint) out += `Engine's top choice going forward: **${ctx.bestMoveHint}**.`;
  return out;
}

function respondOpening(moves) {
  if (moves.length === 0) {
    return `**The classical first moves:**\n\n` +
      `• **1.e4** — opens lines for queen and bishop, fights for the center. Leads to sharp tactical play.\n` +
      `• **1.d4** — claims the center, prepares c4 (Queen's Gambit). Strategic, positional.\n` +
      `• **1.Nf3** — flexible, delays revealing your plan. Often transposes.\n` +
      `• **1.c4** — English. Flank attack on the center, hypermodern style.\n\n` +
      `Pick one, play it a hundred times, and learn its secrets.`;
  }
  const name = detectOpening(moves);
  if (name) {
    const tip = OPENING_TIPS[name] || 'Focus on the ideas — piece placement, pawn breaks, typical endgames.';
    return `**${name}**\n\n${tip}\n\n_Moves played: ${moves.slice(0, 12).join(' ')}${moves.length > 12 ? '…' : ''}_`;
  }
  return `${moves.length} move${moves.length === 1 ? '' : 's'} played — no clear opening match yet. ` +
    `Stick to three principles:\n` +
    `• Control the center with pawns or pieces\n` +
    `• Develop every minor piece before moving the queen\n` +
    `• Castle before launching attacks`;
}

function respondEndgame(psW, psB) {
  return [
    '**Endgame essentials**',
    '',
    `• **Activate your king** — in the endgame, he's worth about three pawns. Walk him into the center.`,
    `• **Passed pawns** are gold. White has ${psW.passed.length ? psW.passed.join(', ') : 'none'}; Black has ${psB.passed.length ? psB.passed.join(', ') : 'none'}.`,
    `• **Opposition** decides king-and-pawn endgames — the side not to move often wins the key square.`,
    `• **Rook endings** follow the rule: rook belongs BEHIND the passed pawn (yours or theirs).`,
    `• When winning, trade pieces not pawns. When losing, keep pieces and seek tactics.`
  ].join('\n');
}

function respondEvaluation(ctx, pos, mr, ph, ksW, ksB, psW, psB) {
  const turn = ctx.turn === 'w' ? 'White' : 'Black';
  const out = [`**Position assessment** _(${ph}, ${turn} to move)_`, ''];
  out.push(`• **Material:** White ${mr.whitePoints} vs Black ${mr.blackPoints}${mr.diff === 0 ? ' (equal)' : ` — ${mr.diff > 0 ? 'White' : 'Black'} is +${Math.abs(mr.diff)}`}`);
  out.push(`• **Engine:** ${formatEval(ctx.evalScore, ctx.turn)}`);
  out.push(`• **White king:** ${ksW.score}${ksW.notes.length ? ' (' + ksW.notes.join(', ') + ')' : ''}`);
  out.push(`• **Black king:** ${ksB.score}${ksB.notes.length ? ' (' + ksB.notes.join(', ') + ')' : ''}`);
  const wWeak = [...psW.isolated.map(s => 'isolated ' + s), ...psW.doubled.map(f => 'doubled on ' + f)];
  const bWeak = [...psB.isolated.map(s => 'isolated ' + s), ...psB.doubled.map(f => 'doubled on ' + f)];
  if (wWeak.length) out.push(`• **White pawn issues:** ${wWeak.join(', ')}`);
  if (bWeak.length) out.push(`• **Black pawn issues:** ${bWeak.join(', ')}`);
  if (psW.passed.length) out.push(`• **White passed pawn${psW.passed.length > 1 ? 's' : ''}:** ${psW.passed.join(', ')}`);
  if (psB.passed.length) out.push(`• **Black passed pawn${psB.passed.length > 1 ? 's' : ''}:** ${psB.passed.join(', ')}`);
  if (ctx.bestMoveHint) out.push(`• **Engine's top move:** **${ctx.bestMoveHint}**`);
  return out.join('\n');
}

function respondKingSafety(ksW, ksB, turn) {
  return `**King Safety**\n\n` +
    `• **White king** (${turn === 'White' ? 'you' : 'opponent'}): ${ksW.score}${ksW.castled ? ' — castled' : ''}. ${ksW.notes.join(', ') || 'No immediate concerns.'}\n` +
    `• **Black king** (${turn === 'Black' ? 'you' : 'opponent'}): ${ksB.score}${ksB.castled ? ' — castled' : ''}. ${ksB.notes.join(', ') || 'No immediate concerns.'}\n\n` +
    `If your king is exposed: defend first. If your opponent's is exposed: look for checks, rook lifts, and queen infiltration.`;
}

function respondPawns(psW, psB) {
  const out = ['**Pawn Structure**'];
  for (const [side, ps] of [['White', psW], ['Black', psB]]) {
    out.push('');
    out.push(`**${side}** (${ps.count} pawns)`);
    if (ps.isolated.length) out.push(`• Isolated: ${ps.isolated.join(', ')} — hard to defend, but often active.`);
    if (ps.doubled.length)  out.push(`• Doubled on ${ps.doubled.join(', ')} — can't defend each other, often a long-term weakness.`);
    if (ps.passed.length)   out.push(`• **Passed:** ${ps.passed.join(', ')} — push them with piece support!`);
    if (!ps.isolated.length && !ps.doubled.length && !ps.passed.length) out.push(`• Clean structure — no notable weaknesses or passed pawns.`);
  }
  return out.join('\n');
}

function respondDevelopment(pos, ph) {
  const w = developmentReport(pos, 'w');
  const b = developmentReport(pos, 'b');
  const lines = ['**Development**', ''];
  lines.push(`• White: ${w.minorDev}/4 minors developed${w.castled ? ', castled ✓' : ''}${w.minorHome.length ? ` — still home: ${w.minorHome.join(', ')}` : ''}`);
  lines.push(`• Black: ${b.minorDev}/4 minors developed${b.castled ? ', castled ✓' : ''}${b.minorHome.length ? ` — still home: ${b.minorHome.join(', ')}` : ''}`);
  if (ph === 'opening') lines.push('', `In the opening, every move should either (1) develop a piece, (2) control the center, or (3) improve king safety. Moves that don't do one of these are suspect.`);
  return lines.join('\n');
}

function respondImprovement(ph) {
  const lines = [
    '**Improve your worst piece**',
    '',
    `Look at each of your pieces and ask: "What is this doing?" Your goal each move is to give the least active piece a meaningful job.`,
    '',
    '**Common worst pieces:**',
    `• A bishop behind its own pawns — reroute or trade.`,
    `• A knight on the rim (h3, a6 etc.) — centralize to d4/e4/d5/e5.`,
    `• A rook on its starting square with no open file — find one and invade.`,
    `• The queen too early and exposed — bring her back to safety first.`
  ];
  if (ph === 'middlegame') lines.push(`• A king still in the center past move 10 — castle immediately.`);
  return lines.join('\n');
}

function respondSummary(ctx, pos, mr, ph, ksW, ksB, loose) {
  const lines = [
    `**Position snapshot** — _${quickPulse(mr, ph, ctx.turn)}_`,
    ''
  ];
  lines.push(`• **Material:** W ${mr.whitePoints} · B ${mr.blackPoints}${mr.diff ? ` (${mr.diff > 0 ? '+' : ''}${mr.diff})` : ' (equal)'}`);
  lines.push(`• **Kings:** White ${ksW.score}${ksW.castled ? ' ✓' : ''}, Black ${ksB.score}${ksB.castled ? ' ✓' : ''}`);
  if (ctx.evalScore !== undefined) lines.push(`• **Eval:** ${formatEval(ctx.evalScore, ctx.turn)}`);
  if (ctx.bestMoveHint)            lines.push(`• **Engine suggests:** **${ctx.bestMoveHint}**`);
  if (loose.length)                lines.push(`• **Target:** opponent's loose ${loose.map(l => `${PIECE_NAME[l.piece]}/${l.square}`).join(', ')}`);
  lines.push('');
  lines.push(`Ask me: **best move · tactics · plan · king safety · pawns · development · evaluation**`);
  return lines.join('\n');
}

// ----------------------------------------------------------------
// Public class
// ----------------------------------------------------------------
export class BuiltinCoach {
  get id() { return 'builtin'; }
  get name() { return 'Built-in (offline)'; }

  ask(question, ctx) {
    const q = (question || '').toLowerCase();
    const pos = parseFEN(ctx.fen);
    const moves = ctx.moveHistory || [];
    const mr = materialReport(pos);
    const ph = phaseOf(pos, moves.length);
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
    if (/king safety|attack.*king|defend.*king/.test(q))                          return respondKingSafety(ksW, ksB, ctx.turn === 'w' ? 'White' : 'Black');
    if (/pawn.*structure|weak.*pawn|isolated|doubled|passed/.test(q))             return respondPawns(psW, psB);
    if (/develop|developm/.test(q))                                               return respondDevelopment(pos, ph);
    if (/weak|worst piece|improve|bad piece/.test(q))                             return respondImprovement(ph);
    return respondSummary(ctx, pos, mr, ph, ksW, ksB, loose);
  }
}
