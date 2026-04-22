import { GameMode } from './game-mode.js';
import { MODE_IDS } from '../core/constants.js';

export class PracticeMode extends GameMode {
  get id() { return MODE_IDS.PRACTICE; }

  canUserMove(gameState, color) { return color === gameState.playAs; }

  onMove(move, context) {
    context.practice.afterUserMove(move);
  }

  onGameOver(status, context) {
    context.practice.handleGameOver(status);
  }

  opponentLabel() { return 'Computer'; }
}
