#!/usr/bin/env node
/**
 * Validate every lesson FEN + targetSan and every puzzle FEN + solution
 * against the project's own chess engine.
 *
 * Usage:
 *   node scripts/verify-content.mjs                 # check everything
 *   node scripts/verify-content.mjs lessons en      # one category
 *   node scripts/verify-content.mjs puzzles en
 *   node scripts/verify-content.mjs file path/to.json
 *   node scripts/verify-content.mjs fen "FEN" "Nf3 Nc6 Bc4"   # ad hoc
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Chess from '../src/engine/chess.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COLORS = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' };
const c = (color, s) => `${COLORS[color] || ''}${s}${COLORS.reset}`;

function parseFen(fen) {
  try { return Chess.fromFEN(fen); }
  catch (err) { return { _err: err.message }; }
}

/** Returns { ok, finalFen, error, finalIsMate } after applying the given SAN list. */
function playSequence(fen, sanList) {
  const state = parseFen(fen);
  if (state._err) return { ok: false, error: `bad FEN: ${state._err}` };
  for (let i = 0; i < sanList.length; i++) {
    const want = sanList[i];
    const move = Chess.findLegalBySan(state, want);
    if (!move) {
      return { ok: false, error: `move ${i + 1} (${want}) is illegal in this position` };
    }
    Chess.makeMove(state, move);
  }
  const status = Chess.status(state);
  return {
    ok: true,
    finalFen: Chess.toFEN(state),
    finalIsMate: status.over && status.result === 'checkmate',
    finalIsStalemate: status.over && status.result === 'stalemate',
    sideToMove: state.turn,
  };
}

function reportLine(file, msg, level) {
  const tag = level === 'error' ? c('red', '✗') : level === 'warn' ? c('yellow', '⚠') : c('green', '✓');
  console.log(`${tag} ${c('dim', file)}  ${msg}`);
}

let errors = 0;
let warnings = 0;

async function checkLessonFile(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const rel = path.replace(ROOT + '/', '');
  for (let s = 0; s < (data.steps || []).length; s++) {
    const step = data.steps[s];
    if (step.fen) {
      const fenState = parseFen(step.fen);
      if (fenState._err) {
        reportLine(rel, `step ${s} (${step.title || step.type}): bad FEN — ${fenState._err}`, 'error');
        errors++; continue;
      }
    }
    if (step.type === 'play' && step.targetSan) {
      const targets = Array.isArray(step.targetSan) ? step.targetSan : [step.targetSan];
      let anyLegal = false;
      for (const t of targets) {
        const move = Chess.findLegalBySan(parseFen(step.fen), t);
        if (move) { anyLegal = true; break; }
      }
      if (!anyLegal) {
        reportLine(rel, `step ${s} (${step.title || ''}): NO target SAN is legal — ${JSON.stringify(targets)}`, 'error');
        errors++;
      }
    }
  }
}

async function checkPuzzleFile(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const rel = path.replace(ROOT + '/', '');
  if (!data.fen) { reportLine(rel, 'missing fen', 'error'); errors++; return; }
  const sanList = Array.isArray(data.solution) ? data.solution : [data.solution];
  const r = playSequence(data.fen, sanList);
  if (!r.ok) { reportLine(rel, `solution invalid — ${r.error}`, 'error'); errors++; return; }

  // Heuristic checks for puzzle quality.
  const themeFromFile = path.match(/puzzles\/[a-z]+\/([a-z0-9-]+?)-\d+\.json$/i)?.[1];
  if (themeFromFile && themeFromFile.startsWith('mate-in-')) {
    if (!r.finalIsMate) {
      reportLine(rel, `expected checkmate at end of solution but got ${r.finalIsMate ? 'mate' : (r.finalIsStalemate ? 'stalemate' : 'no mate')}`, 'warn');
      warnings++;
    }
  }
  // Always at least say it parses
  // (silent on success to keep output small)
}

async function walkDir(dir, fn) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.json')) await fn(join(dir, e.name));
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'fen' && args[1]) {
    const sans = (args[2] || '').split(/\s+/).filter(Boolean);
    const r = playSequence(args[1], sans);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (args[0] === 'file' && args[1]) {
    const path = resolve(args[1]);
    if (path.includes('/lessons/')) await checkLessonFile(path);
    else if (path.includes('/puzzles/')) await checkPuzzleFile(path);
    else { console.error('not a lesson or puzzle path'); process.exit(2); }
  } else {
    const which = args[0]; // lessons | puzzles | undefined
    const lang = args[1] || 'en';

    if (!which || which === 'lessons') {
      await walkDir(join(ROOT, 'data/lessons', lang), checkLessonFile);
    }
    if (!which || which === 'puzzles') {
      await walkDir(join(ROOT, 'data/puzzles', lang), checkPuzzleFile);
    }
  }

  console.log('');
  console.log(`Done. ${c(errors ? 'red' : 'green', `${errors} error(s)`)}, ${c(warnings ? 'yellow' : 'green', `${warnings} warning(s)`)}`);
  process.exit(errors ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
