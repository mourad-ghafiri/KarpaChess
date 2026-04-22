import { GameMode } from './game-mode.js';
import { MODE_IDS } from '../core/constants.js';

/** Review is navigation-only — user moves on the board are disabled. */
export class ReviewMode extends GameMode {
  get id() { return MODE_IDS.REVIEW; }

  canUserMove() { return false; }

  onMove() {}
  onGameOver() {}

  opponentLabel() { return 'Opponent'; }
}
