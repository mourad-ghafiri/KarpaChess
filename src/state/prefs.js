/**
 * User preferences store. Persists via Storage, emits PREFS_CHANGED on change.
 * The PrefsStore is the single source of truth for theme, board flags, AI
 * provider selection, and every provider's key/URL/model.
 */
import { EVENTS, DEFAULT_PRACTICE } from '../core/constants.js';

const DEFAULTS = Object.freeze({
  // Board / UI
  theme: 'emerald',
  coords: true,
  legalHighlight: true,
  lastMoveHighlight: true,
  sound: true,
  animations: true,

  // Language — auto-detected from navigator.language at first boot.
  lang: 'en',

  // AI Coach
  provider: 'builtin',
  anthropicKey: '',  anthropicModel:  'claude-opus-4-7',
  openaiKey: '',     openaiModel:     'gpt-5.4',
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.3:70b',
  lmstudioUrl: 'http://localhost:1234/v1', lmstudioModel: 'llama-3.3-70b-instruct',
  openrouterKey: '', openrouterModel: 'anthropic/claude-opus-4.7',
  mistralKey: '',    mistralModel:    'mistral-large-latest',
  deepseekKey: '',   deepseekModel:   'deepseek-reasoner',
  xaiKey: '',        xaiModel:        'grok-4',
  qwenUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  qwenKey: '',       qwenModel:       'qwen3-max',
  glmUrl: 'https://open.bigmodel.cn/api/paas/v4',
  glmKey: '',        glmModel:        'glm-4.6',
  minimaxUrl: 'https://api.minimaxi.chat/v1',
  minimaxKey: '',    minimaxModel:    'MiniMax-M2.7',

  // Practice defaults
  difficulty: DEFAULT_PRACTICE.difficulty,
  playAs: DEFAULT_PRACTICE.playAs,
  timeControl: { ...DEFAULT_PRACTICE.timeControl },

  // Commentator — badge visibility on the board (off by default so the
  // classification doesn't spoil the move for viewers).
  commentatorBadges: false,

  // Progress (lessons only — no scoring)
  lessonsCompleted: {}
});

export class PrefsStore {
  constructor(storage, bus) {
    this.storage = storage;
    this.bus = bus;
    this.data = { ...DEFAULTS, timeControl: { ...DEFAULTS.timeControl }, lessonsCompleted: { ...DEFAULTS.lessonsCompleted } };
  }

  load() {
    const persisted = this.storage.read();
    if (!persisted) return;
    // Shallow merge is safe because every persistable key is a scalar or a
    // plain object (timeControl, lessonsCompleted).
    this.data = {
      ...this.data,
      ...persisted,
      timeControl: { ...this.data.timeControl, ...(persisted.timeControl || {}) },
      lessonsCompleted: { ...(persisted.lessonsCompleted || {}) }
    };
  }

  get(key) { return this.data[key]; }
  getAll() { return this.data; }

  set(key, value) {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.#persist();
    // Emit a patch-shape object ({[key]: value}) so subscribers can use
    // `'theme' in patch` uniformly for both set() and update() paths.
    this.bus.emit(EVENTS.PREFS_CHANGED, { [key]: value });
  }

  update(patch) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (this.data[k] !== v) { this.data[k] = v; changed = true; }
    }
    if (!changed) return;
    this.#persist();
    this.bus.emit(EVENTS.PREFS_CHANGED, patch);
  }

  markLessonComplete(id) {
    this.data.lessonsCompleted[id] = true;
    this.#persist();
    this.bus.emit(EVENTS.PREFS_CHANGED, { lessonsCompleted: this.data.lessonsCompleted });
  }

  isLessonComplete(id) { return !!this.data.lessonsCompleted[id]; }

  reset() {
    this.storage.clear();
    location.reload();
  }

  #persist() { this.storage.write(this.data); }
}
