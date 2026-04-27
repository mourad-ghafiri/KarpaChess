/**
 * KarpaChess — composition root.
 *
 * This is the only place that knows about every module. It instantiates
 * services/state/views/controllers, injects dependencies, and kicks off
 * first-paint. Nothing else in the codebase reaches across module boundaries.
 */
import { EventBus } from './core/event-bus.js';
import { STORAGE_KEY, EVENTS, SUPPORTED_LANGS } from './core/constants.js';
import { $ } from './core/dom.js';
import { I18n, i18n } from './core/i18n.js';

// Services
import { Storage } from './services/storage.js';
import { ContentLoader } from './services/content-loader.js';
import { SoundService } from './services/sound.js';
import { ParticleService } from './services/particles.js';
import { ToastService } from './services/toast.js';
import { ModalManager } from './services/modals.js';
import { ClockService } from './services/clock.js';

// State
import { PrefsStore } from './state/prefs.js';
import { GameState } from './state/game-state.js';
import { LearnState } from './state/learn-state.js';
import { PuzzleState } from './state/puzzle-state.js';
import { ReviewState } from './state/review-state.js';
import { PracticeSnapshot } from './state/practice-snapshot.js';
import { CommentatorState } from './state/commentator-state.js';

// Modes
import { ModeRegistry } from './modes/registry.js';
import { PracticeMode } from './modes/practice-mode.js';
import { LessonMode } from './modes/lesson-mode.js';
import { PuzzleMode } from './modes/puzzle-mode.js';
import { ReviewMode } from './modes/review-mode.js';
import { CommentatorMode } from './modes/commentator-mode.js';

// AI
import { ProviderRegistry } from './ai/registry.js';
import { BuiltinCoach } from './ai/builtin-coach.js';
import { CoachService } from './ai/coach-service.js';
import { AnthropicProvider } from './ai/providers/anthropic.js';
import { OpenAIProvider } from './ai/providers/openai.js';
import { OllamaProvider } from './ai/providers/ollama.js';
import { LMStudioProvider } from './ai/providers/lmstudio.js';
import { OpenRouterProvider } from './ai/providers/openrouter.js';
import { MistralProvider } from './ai/providers/mistral.js';
import { DeepSeekProvider } from './ai/providers/deepseek.js';
import { XAIProvider } from './ai/providers/xai.js';
import { QwenProvider } from './ai/providers/qwen.js';
import { GLMProvider } from './ai/providers/glm.js';
import { MiniMaxProvider } from './ai/providers/minimax.js';

// UI
import { BoardView } from './ui/board-view.js';
import { HistoryView } from './ui/history-view.js';
import { PlayerCardsView } from './ui/player-cards.js';
import { CapturedView } from './ui/captured-view.js';
import { CoachWhisperView } from './ui/coach-whisper.js';
import { HintView } from './ui/hint-view.js';
import { BannerView } from './ui/banner-view.js';
import { PromotionView } from './ui/promotion-view.js';
import { SettingsView } from './ui/settings-view.js';
import { TabController } from './ui/tabs.js';
import { LangSwitcherView } from './ui/lang-switcher.js';
import { DrawingOverlay } from './ui/drawing-overlay.js';
import { MoveTreeView } from './ui/move-tree-view.js';

// Features
import { PracticeController } from './features/practice-controller.js';
import { LearnController } from './features/learn-controller.js';
import { PuzzlesController } from './features/puzzles-controller.js';
import { ReviewController } from './features/review-controller.js';
import { CoachController } from './features/coach-controller.js';
import { CommentatorController } from './features/commentator-controller.js';

async function bootstrap() {
  // ---------- core
  const bus = new EventBus();
  const storage = new Storage(STORAGE_KEY);

  // ---------- state
  const prefs = new PrefsStore(storage, bus);
  prefs.load();

  // ---------- i18n: ?lang=<code> query string > saved pref > navigator.language
  // The query-string path is what makes the hreflang alternates in index.html
  // actually flip the UI when a search engine sends a user to e.g. ?lang=fr.
  const queryLang = langFromQuery();
  if (queryLang) {
    prefs.set('lang', queryLang);
  } else if (!storage.read()?.lang) {
    const detected = detectLanguage();
    prefs.set('lang', detected);
  }
  const i18nImpl = new I18n(bus);
  i18n.bind(i18nImpl);
  await i18nImpl.init(prefs.get('lang'));
  // Reload bundle + content + re-render when language changes
  bus.on(EVENTS.PREFS_CHANGED, async (patch) => {
    if (patch && 'lang' in patch) {
      await i18nImpl.load(patch.lang);
      await content.loadAll(patch.lang);
      bus.emit(EVENTS.CONTENT_RELOADED);
    }
  });
  const gameState = new GameState(bus);
  gameState.setPlayAs(prefs.get('playAs'));
  const learnState = new LearnState();
  const puzzleState = new PuzzleState();
  const reviewState = new ReviewState();
  const practiceSnapshot = new PracticeSnapshot();
  const commentatorState = new CommentatorState(bus, storage);

  // Apply stored theme to the body immediately.
  applyTheme(prefs.get('theme'));
  bus.on(EVENTS.PREFS_CHANGED, (patch) => {
    if (patch && 'theme' in patch) applyTheme(patch.theme);
  });

  // Reflect the active game-mode on the body so per-mode UI (practice
  // controls vs commentator drawing tools) can switch via CSS alone.
  applyModeClass(gameState.mode);
  bus.on(EVENTS.STATE_CHANGED, (e) => {
    if (e?.detail?.type === 'mode') applyModeClass(gameState.mode);
  });

  // ---------- services
  const sound = new SoundService(prefs);
  const particles = new ParticleService(document.getElementById('particles'));
  new ToastService(document.getElementById('toast-wrap'), bus);
  const modals = new ModalManager();
  const clock = new ClockService(bus);
  const content = new ContentLoader();

  // ---------- modes
  const modeRegistry = new ModeRegistry()
    .register(new PracticeMode())
    .register(new LessonMode())
    .register(new PuzzleMode())
    .register(new ReviewMode())
    .register(new CommentatorMode());

  // ---------- AI
  const providers = new ProviderRegistry()
    .register(new AnthropicProvider(prefs))
    .register(new OpenAIProvider(prefs))
    .register(new OllamaProvider(prefs))
    .register(new LMStudioProvider(prefs))
    .register(new OpenRouterProvider(prefs))
    .register(new MistralProvider(prefs))
    .register(new DeepSeekProvider(prefs))
    .register(new XAIProvider(prefs))
    .register(new QwenProvider(prefs))
    .register(new GLMProvider(prefs))
    .register(new MiniMaxProvider(prefs));
  const builtin = new BuiltinCoach();
  const coach = new CoachService(providers, prefs, builtin);

  // ---------- UI views that depend on board + state
  const boardView = new BoardView(
    document.getElementById('board'),
    gameState,
    bus,
    prefs,
    { top: $('#file-labels-top'), bottom: $('#file-labels-bottom') },
    { left: $('#rank-labels-left'), right: $('#rank-labels-right') }
  );
  new HistoryView(document.getElementById('move-history'), gameState, commentatorState, bus);
  new PlayerCardsView({
    top: $('#player-top'),
    bottom: $('#player-bottom'),
    topName: $('#player-top .player-name'),
    botName: $('#player-bottom .player-name'),
    topMeta: $('#player-top-mode'),
    botMeta: $('#player-bottom-mode'),
    topTimer: $('#timer-top'),
    botTimer: $('#timer-bottom')
  }, gameState, prefs, modeRegistry, commentatorState, bus);
  new CapturedView($('#captured-top'), $('#captured-bottom'), gameState, commentatorState, bus);

  const coachWhisper = new CoachWhisperView($('#coach-whisper'), gameState);

  const hint = new HintView({
    cardEl: $('#hint-card'),
    moveEl: $('#hint-move'),
    textEl: $('#hint-text'),
    arrowEl: $('#hint-arrow'),
    arrowLineEl: $('#hint-arrow-line'),
    playBtn: $('#btn-play-hint'),
    closeBtn: $('#btn-close-hint')
  }, gameState, boardView, bus);

  // Settings modal is assumed mounted in the HTML already; wire it now.
  const settings = new SettingsView(modals, 'settings-modal', prefs, bus,
    () => coachCtrl.updateStatus());
  settings.wire();
  $('#btn-settings').addEventListener('click', (e) => { e.stopPropagation(); settings.open(); });

  // Topbar language switcher (flag dropdown next to settings)
  new LangSwitcherView(prefs, bus);

  // Promotion
  const promotion = new PromotionView(modals, 'promotion-modal', $('#promotion-choices'));
  $('#promotion-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) promotion.cancel();
  });

  // ---------- clock sync: keep ClockService.turn in step with gameState
  bus.on(EVENTS.STATE_CHANGED, () => clock.setTurn(gameState.getTurn()));

  // ---------- controllers (features)
  const banner = new BannerView({
    rootEl: $('#game-banner'),
    iconEl: $('#banner-icon'),
    titleEl: $('#banner-title'),
    subEl: $('#banner-sub'),
    reviewBtn: $('#banner-review'),
    newBtn: $('#banner-new'),
    closeBtn: $('#banner-close')
  },
  () => {                                      // Review clicked
    banner.hide();
    bus.emit(EVENTS.REVIEW_START);
  },
  () => {                                      // New Game clicked
    banner.hide();
    tabs.activate('practice');
    practice.newGame();
  });

  const practice = new PracticeController({
    gameState, boardView, clock, bus, prefs, modals, promotion, hint,
    banner, practiceSnapshot, modeRegistry, sound, particles, coachWhisper
  });

  const learn = new LearnController({
    gameState, content, prefs, learnState, sound,
    toast: { emit: (m, k) => bus.emit(EVENTS.TOAST, { message: m, kind: k }) }
  });

  const puzzles = new PuzzlesController({
    gameState, content, puzzleState, sound, particles, practice
  });

  const review = new ReviewController({ gameState, reviewState, practiceSnapshot, bus, hint });

  const coachCtrl = new CoachController({
    coach, gameState, bus,
    openSettings: () => settings.open()
  });
  coachCtrl.greet();
  // Keep coach status fresh when prefs change (models, keys)
  bus.on(EVENTS.PREFS_CHANGED, () => coachCtrl.updateStatus());

  // ---------- Commentator UI (depends on board + hint + coach + state)
  const drawingOverlay = new DrawingOverlay({
    svgEl: $('#cm-draw-svg'),
    toolbarEl: $('#cm-draw-toolbar'),
    // The right-click handler attaches to `.board-holder` (parent of both
    // #board and the SVG overlays) so right-click works no matter which
    // sibling element is the topmost target at click time.
    boardRootEl: document.querySelector('.board-holder')
  }, gameState, commentatorState, bus);

  const moveTreeView = new MoveTreeView($('#cm-move-tree'), commentatorState, bus);

  const commentator = new CommentatorController({
    gameState, boardView, bus, commentatorState, drawingOverlay, moveTreeView,
    modals, hint, practiceSnapshot, prefs
  });

  practice.setCompanions({ learn, puzzles, review, commentator });

  // ---------- tabs: orchestrate per-tab onEnter/onExit
  const tabs = new TabController(bus);
  bus.on(EVENTS.TAB_DEACTIVATED, ({ name }) => {
    if (name === 'practice') practice.onExitTab();
    else if (name === 'commentator') commentator.onExitTab();
  });
  bus.on(EVENTS.TAB_ACTIVATED, ({ name }) => {
    if (name === 'practice') practice.onEnterTab();
    else if (name === 'learn') learn.onEnterTab();
    else if (name === 'puzzles') puzzles.onEnterTab();
    else if (name === 'commentator') commentator.onEnterTab();
  });
  // CoachController listens directly for its tab-switch via TAB_ACTIVATED if needed.
  bus.on('tab:switch', ({ name }) => tabs.activate(name));

  // ---------- content + first game
  await content.loadAll(prefs.get('lang'));
  // Re-render learn/puzzles lists now that content is in.
  learn.render();
  puzzles.render();

  // Re-render tab UIs when content reloads (language switch)
  bus.on(EVENTS.CONTENT_RELOADED, () => {
    learn.render();
    puzzles.render();
    coachCtrl.updateStatus();
    coachCtrl.greet();
    // Re-render insights / move tree so commentator text flips languages too
    if (commentator && commentatorState.hasMatch()) {
      drawingOverlay.render();
      moveTreeView.render();
    }
  });

  practice.newGame();
}

/** Pick the best matching supported language from navigator.language. */
function detectLanguage() {
  const nav = (navigator.language || 'en').toLowerCase();
  const code = nav.split('-')[0];
  return SUPPORTED_LANGS.includes(code) ? code : 'en';
}

/** Read `?lang=<code>` from the current URL. Returns null if absent or unsupported. */
function langFromQuery() {
  try {
    const code = new URLSearchParams(window.location.search).get('lang');
    if (!code) return null;
    const lower = code.toLowerCase();
    return SUPPORTED_LANGS.includes(lower) ? lower : null;
  } catch {
    return null;
  }
}

function applyTheme(name) {
  document.body.classList.remove('theme-royal','theme-midnight','theme-emerald','theme-rose','theme-ice');
  document.body.classList.add('theme-' + name);
}

function applyModeClass(mode) {
  for (const c of [...document.body.classList]) {
    if (c.startsWith('mode-')) document.body.classList.remove(c);
  }
  document.body.classList.add('mode-' + mode);
}

document.addEventListener('DOMContentLoaded', bootstrap);
