/**
 * Abstract base for per-mode behavior. Every concrete mode answers the same
 * small set of questions, replacing the if-else-mode cascade that used to
 * be scattered across the old monolith.
 *
 * The `context` object given to onMove / onGameOver / onEnter is the mode
 * context bag, constructed in the composition root — it holds the
 * controllers, state, services, and anything else modes might touch.
 */
export class GameMode {
  /** @returns {string} — id like 'practice' | 'lesson' | 'puzzle' | 'review' */
  get id() { throw new Error('subclass must implement id'); }

  /** Is the human allowed to make a move right now, for this color? */
  canUserMove(gameState, color) { return color === gameState.playAs; }

  /** Called AFTER the move is applied to gameState (and SAN is set). */
  onMove(move, context) { /* default: nothing */ }

  /** Called when the engine reports the position is terminal. */
  onGameOver(status, context) { /* default: nothing */ }

  /** Called when this mode becomes active. */
  onEnter(context) { /* default: nothing */ }

  /** Called when switching away from this mode. */
  onExit(context) { /* default: nothing */ }

  /** Display label for the opposing player card. */
  opponentLabel() { return 'Computer'; }

  /**
   * Player-card name for the given color. Default: "You" if this color is the
   * user's, otherwise the opponent label. Modes with scripted opponents
   * (lesson/puzzle) override to drive off turn-order instead.
   */
  playerCardName(color, gameState) {
    if (color === gameState.playAs) return 'You';
    return this.opponentLabel();
  }

  /**
   * Player-card meta-line for the given color. Default: "Human" for the user,
   * "AI · <difficulty>" for the opponent.
   */
  playerCardMeta(color, gameState, prefs, difficultyNames) {
    if (color === gameState.playAs) return 'Human';
    return `AI · ${difficultyNames[prefs.get('difficulty')]}`;
  }
}
