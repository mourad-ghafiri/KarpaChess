import { GameMode } from './game-mode.js';
import { MODE_IDS } from '../core/constants.js';

export class PuzzleMode extends GameMode {
  get id() { return MODE_IDS.PUZZLE; }

  canUserMove(gameState, color) {
    return color === gameState.getTurn() && gameState.playAs === color;
  }

  onMove(move, context) { context.puzzles.handleMove(move); }

  onGameOver() { /* puzzles own their terminal handling */ }

  opponentLabel() { return 'Opponent'; }

  playerCardName(color, gameState) {
    return color === gameState.getTurn() ? 'Your move' : 'Opponent';
  }

  playerCardMeta(color, gameState) {
    return color === gameState.getTurn() ? 'Human' : 'Scripted';
  }
}
