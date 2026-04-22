import { GameMode } from './game-mode.js';
import { MODE_IDS } from '../core/constants.js';

/**
 * CommentatorMode — the user can play *either* color at any time; board moves
 * are routed into CommentatorState, which advances the main line, switches to
 * an existing variation, or creates a new variation branch.
 */
export class CommentatorMode extends GameMode {
  get id() { return MODE_IDS.COMMENTATOR; }

  canUserMove(gameState, color) {
    // Both colors are driveable in the studio: commentary is free exploration.
    return color === gameState.getTurn();
  }

  onMove(move, context) {
    context.commentator.handleBoardMove(move);
  }

  onGameOver() { /* no banner in commentator — studying, not playing */ }

  opponentLabel() { return 'Opponent'; }

  playerCardName(color, gameState) {
    return color === gameState.getTurn() ? 'On move' : 'Waiting';
  }

  playerCardMeta(color) {
    return color === 'w' ? 'White' : 'Black';
  }
}
