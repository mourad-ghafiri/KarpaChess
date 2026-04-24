/** Single place for app-wide constants. Any magic string used in more than one
 *  file ends up here. */

export const STORAGE_KEY = 'karpachess.v1';

export const PIECE_NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
export const PIECE_NAME_LOWER = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const DIFFICULTY_NAMES = { 1: 'Beginner', 2: 'Casual', 3: 'Club', 4: 'Master' };

/** Supported UI languages. `en` is canonical; everything else is translated. */
export const SUPPORTED_LANGS = ['en', 'fr', 'es', 'ar', 'zh', 'ru', 'id', 'ja'];

/** Languages that render right-to-left. Applied to <html dir>. */
export const RTL_LANGS = ['ar'];

/** Native-script label shown in the Settings language dropdown. */
export const LANG_LABELS = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  zh: '中文',
  ru: 'Русский',
  id: 'Bahasa Indonesia',
  ja: '日本語'
};

/** Emoji flag per language code (used by the topbar language switcher). */
export const LANG_FLAGS = {
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
  ar: '🇸🇦',
  zh: '🇨🇳',
  ru: '🇷🇺',
  id: '🇮🇩',
  ja: '🇯🇵'
};

export const TAB_IDS = {
  LEARN: 'learn',
  PUZZLES: 'puzzles',
  PRACTICE: 'practice',
  COACH: 'coach',
  COMMENTATOR: 'commentator'
};

export const MODE_IDS = {
  PRACTICE: 'practice',
  LESSON: 'lesson',
  PUZZLE: 'puzzle',
  REVIEW: 'review',
  COMMENTATOR: 'commentator'
};

/** Default practice preferences — matches the initially-active UI selections. */
export const DEFAULT_PRACTICE = {
  difficulty: 1,
  playAs: 'w',
  timeControl: { minutes: null, increment: 0 }
};

export const EVENTS = {
  PREFS_CHANGED: 'prefs:changed',
  I18N_CHANGED: 'i18n:changed',                // {lang}
  CONTENT_RELOADED: 'content:reloaded',        // after ContentLoader re-reads lessons/puzzles

  STATE_RESET: 'state:reset',
  STATE_MOVE: 'state:move',
  STATE_CHANGED: 'state:changed',

  MOVE_REQUEST: 'move:request',             // user asked to make a move {move}
  MOVE_COMMITTED: 'move:committed',         // move executed + rendered

  GAME_OVER: 'game:over',                   // {result, winner}
  GAME_NEW: 'game:new',

  CLOCK_TICK: 'clock:tick',
  CLOCK_TIMEOUT: 'clock:timeout',

  TAB_ACTIVATED: 'tab:activated',           // {name}
  TAB_DEACTIVATED: 'tab:deactivated',

  TOAST: 'toast',                           // {message, kind}

  HINT_SHOW: 'hint:show',                   // {move, text}
  HINT_DISMISS: 'hint:dismiss',

  BOARD_SQUARE_CLICKED: 'board:squareClicked', // [r, c]
  BOARD_FLIP: 'board:flip',

  COACH_ASK: 'coach:ask',                   // {question}
  COACH_ANSWER: 'coach:answer',             // {text}

  REVIEW_START: 'review:start',
  REVIEW_EXIT: 'review:exit',
  REVIEW_JUMP: 'review:jump',               // {idx}

  COMMENTATOR_MATCH_LOADED: 'commentator:match-loaded',
  COMMENTATOR_NAVIGATED: 'commentator:navigated',            // {nodeId, path}
  COMMENTATOR_ANALYSIS_PROGRESS: 'commentator:analysis-progress',  // {i, total}
  COMMENTATOR_ANALYSIS_COMPLETE: 'commentator:analysis-complete',
  COMMENTATOR_DRAWING_CHANGED: 'commentator:drawing-changed',
  COMMENTATOR_PLAYER_UPDATED: 'commentator:player-updated'   // {color}
};

/** NAG code → { classification, text } mapping. */
export const NAG_MAP = {
  1:  { classification: null,        text: 'Good move' },            // !
  2:  { classification: 'mistake',   text: 'Mistake' },               // ?
  3:  { classification: null,        text: 'Brilliant move' },        // !!
  4:  { classification: 'blunder',   text: 'Blunder' },               // ??
  5:  { classification: null,        text: 'Interesting move' },      // !?
  6:  { classification: 'inaccuracy',text: 'Dubious move' },          // ?!
  10: { classification: null,        text: 'Equal position' },        // =
  13: { classification: null,        text: 'Unclear position' },      // ∞
  14: { classification: null,        text: 'White is slightly better' },
  15: { classification: null,        text: 'Black is slightly better' },
  16: { classification: null,        text: 'White is better' },
  17: { classification: null,        text: 'Black is better' },
  18: { classification: null,        text: 'White is winning' },
  19: { classification: null,        text: 'Black is winning' }
};

export const DRAW_COLORS = [
  { id: 'red',    hex: '#c25a3c' },
  { id: 'orange', hex: '#d88a3d' },
  { id: 'yellow', hex: '#e5b445' },
  { id: 'green',  hex: '#3b7a55' },
  { id: 'blue',   hex: '#2f4a6b' },
  { id: 'purple', hex: '#7a4f8a' },
  { id: 'white',  hex: '#fbf6e8' }
];
