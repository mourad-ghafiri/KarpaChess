/**
 * State for the Puzzles tab. Tracks which theme and which puzzle within it.
 */
export class PuzzleState {
  constructor() {
    this.view = 'themes';   // 'themes' | 'set'
    this.themeId = null;
    this.puzzleIdx = 0;
    this.solutionIdx = 0;
  }

  goToThemes() { this.view = 'themes'; }
  startTheme(themeId) {
    this.themeId = themeId;
    this.puzzleIdx = 0;
    this.solutionIdx = 0;
    this.view = 'set';
  }
  resetSolution() { this.solutionIdx = 0; }
  advanceSolution() { this.solutionIdx++; }
  nextPuzzle() { this.puzzleIdx++; this.solutionIdx = 0; }
}
