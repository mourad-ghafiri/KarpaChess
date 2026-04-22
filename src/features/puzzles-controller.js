/**
 * Puzzles tab controller. Mirrors learn-controller's shape but for themes →
 * themed puzzle sets → puzzle-by-puzzle navigation.
 */
import * as Chess from '../engine/chess.js';
import { $ } from '../core/dom.js';
import { MODE_IDS } from '../core/constants.js';
import { normalizeSan } from '../engine/chess.js';

export class PuzzlesController {
  constructor({ gameState, content, puzzleState, sound, particles, practice }) {
    Object.assign(this, { gameState, content, puzzleState, sound, particles, practice });

    $('#puzzle-back-to-themes').addEventListener('click', () => {
      this.puzzleState.goToThemes();
      this.gameState.setMode(MODE_IDS.PRACTICE);
      this.render();
    });
    $('#btn-puzzle-hint').addEventListener('click', () => this.#showHint());
    $('#btn-puzzle-skip').addEventListener('click', () => this.#nextPuzzle());
    $('#btn-puzzle-next').addEventListener('click', () => this.#nextPuzzle());
  }

  onEnterTab() {
    if (this.puzzleState.view === 'set' && this.puzzleState.themeId) {
      this.gameState.setMode(MODE_IDS.PUZZLE);
    }
    this.render();
  }

  render() {
    $('#puzzle-themes-view').hidden = this.puzzleState.view !== 'themes';
    $('#puzzle-set-view').hidden    = this.puzzleState.view !== 'set';
    if (this.puzzleState.view === 'themes') this.#renderThemeList();
    else this.#renderCurrent();
  }

  #renderThemeList() {
    const list = $('#theme-list');
    list.innerHTML = '';
    const data = this.content.puzzles;
    if (!data) {
      list.innerHTML = '<div class="review-empty">Puzzles are loading…</div>';
      return;
    }
    for (const theme of data.themes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-card';
      btn.innerHTML = `
        <div class="theme-icon">${theme.icon || '⚡'}</div>
        <div>
          <div class="theme-title">${esc(theme.name)}</div>
          <div class="theme-desc">${esc(theme.description || '')}</div>
        </div>
        <div class="theme-count">${theme.puzzles.length} puzzles</div>`;
      btn.addEventListener('click', () => this.#startTheme(theme.id));
      list.appendChild(btn);
    }
  }

  #startTheme(themeId) {
    const theme = this.content.puzzles.themes.find(t => t.id === themeId);
    if (!theme) return;
    this.gameState.setMode(MODE_IDS.PUZZLE);
    this.puzzleState.startTheme(themeId);
    this.#loadCurrent();
    this.render();
  }

  #loadCurrent() {
    const theme = this.#currentTheme();
    const puzzle = theme?.puzzles[this.puzzleState.puzzleIdx];
    if (!puzzle) return;
    this.puzzleState.resetSolution();
    this.gameState.loadFen(puzzle.fen);
    this.gameState.setPlayAs(this.gameState.getTurn());
    this.gameState.setOrientation(this.gameState.playAs);
    $('#btn-puzzle-next').hidden = true;
    $('#puzzle-feedback').textContent = '';
    $('#puzzle-feedback').className = 'puzzle-feedback';
  }

  #renderCurrent() {
    const theme = this.#currentTheme();
    if (!theme) { this.puzzleState.goToThemes(); this.render(); return; }
    const puzzle = theme.puzzles[this.puzzleState.puzzleIdx];
    if (!puzzle) return;
    $('#puzzle-theme-title').textContent = theme.name;
    $('#puzzle-theme-desc').textContent = theme.description || '';
    const total = theme.puzzles.length;
    $('#puzzle-counter').textContent = `Puzzle ${this.puzzleState.puzzleIdx + 1} of ${total}`;
    $('#puzzle-progress').style.width = ((this.puzzleState.puzzleIdx) / total * 100) + '%';
    const turnLabel = this.gameState.getTurn() === 'w' ? 'White' : 'Black';
    $('#puzzle-prompt').innerHTML = `<b>${turnLabel} to move.</b> Find the best move.`;
  }

  /** Called by PuzzleMode.onMove. */
  handleMove(move) {
    const theme = this.#currentTheme();
    if (!theme) return;
    const puzzle = theme.puzzles[this.puzzleState.puzzleIdx];
    if (!puzzle) return;
    const expected = puzzle.solution[this.puzzleState.solutionIdx];
    if (!expected) return;

    if (normalizeSan(move.san) === normalizeSan(expected)) {
      this.puzzleState.advanceSolution();
      this.sound.good();
      if (this.puzzleState.solutionIdx >= puzzle.solution.length) {
        $('#puzzle-feedback').textContent = '✅ Solved — great job!';
        $('#puzzle-feedback').className = 'puzzle-feedback good';
        $('#puzzle-progress').style.width = ((this.puzzleState.puzzleIdx + 1) / theme.puzzles.length * 100) + '%';
        $('#btn-puzzle-next').hidden = false;
        this.particles.spawnFromRect(document.getElementById('board').getBoundingClientRect(), { count: 60 });
      } else {
        const reply = puzzle.solution[this.puzzleState.solutionIdx];
        this.puzzleState.advanceSolution();
        setTimeout(() => {
          const moves = Chess.legalMoves(this.gameState.getChessState(), this.gameState.getTurn());
          const found = moves.find(m => this.#sanMatches(m, reply));
          if (found) this.practice.executeMove(found);
        }, 450);
      }
    } else {
      $('#puzzle-feedback').textContent = '❌ Not this move. Try again.';
      $('#puzzle-feedback').className = 'puzzle-feedback bad';
      this.sound.bad();
      setTimeout(() => {
        Chess.undoLast(this.gameState.getChessState());
        this.gameState.lastMove = this.gameState.getChessState().history.length
          ? this.gameState.getChessState().history[this.gameState.getChessState().history.length - 1].move
          : null;
        this.gameState.clearSelection();
      }, 800);
    }
  }

  #nextPuzzle() {
    const theme = this.#currentTheme();
    if (!theme) return;
    if (this.puzzleState.puzzleIdx + 1 >= theme.puzzles.length) {
      $('#puzzle-prompt').innerHTML = `<b>🏆 Theme complete.</b> You've finished all puzzles in <b>${esc(theme.name)}</b>.`;
      $('#puzzle-feedback').textContent = '';
      $('#puzzle-progress').style.width = '100%';
      $('#btn-puzzle-next').hidden = true;
      return;
    }
    this.puzzleState.nextPuzzle();
    this.#loadCurrent();
    this.#renderCurrent();
  }

  #showHint() {
    const theme = this.#currentTheme();
    const puzzle = theme?.puzzles[this.puzzleState.puzzleIdx];
    if (!puzzle) return;
    const msg = puzzle.hint
      ? `💡 ${puzzle.hint}`
      : `💡 Try: ${puzzle.solution[this.puzzleState.solutionIdx] || ''}`;
    $('#puzzle-feedback').textContent = msg;
    $('#puzzle-feedback').className = 'puzzle-feedback';
  }

  /** Fast SAN matcher — avoids computing full SAN just to compare. */
  #sanMatches(move, wantSan) {
    const want = wantSan.replace(/[+#]/g, '');
    if (want === 'O-O') return move.castling === 'k';
    if (want === 'O-O-O') return move.castling === 'q';
    const destSq = Chess.squareName(move.to[0], move.to[1]);
    if (!want.endsWith(destSq) && !want.includes(destSq + '=')) return false;
    const startsWithPiece = /^[KQRBN]/.test(want);
    if (startsWithPiece) {
      if (want[0].toLowerCase() !== move.piece) return false;
    } else {
      if (move.piece !== 'p') return false;
    }
    if (!startsWithPiece && move.captured) {
      const fromFile = 'abcdefgh'[move.from[1]];
      if (want[0] !== fromFile) return false;
    }
    const promoMatch = want.match(/=([QRBN])/);
    if (promoMatch && move.promotion !== promoMatch[1].toLowerCase()) return false;
    if (!promoMatch && move.promotion) return false;
    return true;
  }

  #currentTheme() {
    if (!this.content.puzzles) return null;
    return this.content.puzzles.themes.find(t => t.id === this.puzzleState.themeId);
  }
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
