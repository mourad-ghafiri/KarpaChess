import { GameMode } from './game-mode.js';
import { MODE_IDS } from '../core/constants.js';

export class LessonMode extends GameMode {
  get id() { return MODE_IDS.LESSON; }

  canUserMove(gameState, color) {
    // User moves only when it's the side-to-move AND that matches their
    // playAs for this lesson step.
    return color === gameState.getTurn() && gameState.playAs === color;
  }

  onMove(move, context) { context.learn.handleMove(move); }

  // No game-over flow in lessons — wrong moves are ghost-undone elsewhere.
  onGameOver() {}

  opponentLabel() { return 'Lesson'; }

  playerCardName(color, gameState) {
    return color === gameState.getTurn() ? 'Your move' : 'Lesson';
  }

  playerCardMeta(color, gameState) {
    return color === gameState.getTurn() ? 'Human' : 'Scripted';
  }
}
