/**
 * Settings modal view. Handles board toggles, theme selection, and — the
 * bulk of it — the per-provider config blocks (API key / URL / model select
 * with Custom-model override).
 *
 * All behaviour is data-driven off the provider registry and a preset map,
 * so adding a new provider needs zero edits here.
 */
import { $, $$ } from '../core/dom.js';

/**
 * Current-flagship preset models per provider (April 2026). Most-powerful
 * first, budget last. Extend these freely. The user can always pick
 * "Custom…" and enter any exact model identifier.
 */
export const PROVIDER_PRESETS = {
  anthropic: [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5'
  ],
  openai: [
    'gpt-5.4',
    'o3-pro',
    'gpt-5.4-mini',
    'o3',
    'gpt-4.1',
    'gpt-5.4-nano'
  ],
  ollama: [
    'llama4:scout',
    'llama3.3:70b',
    'qwen3:32b',
    'deepseek-r1:32b',
    'gemma3:27b',
    'mistral-small:24b',
    'phi4:14b'
  ],
  lmstudio: [
    'llama-3.3-70b-instruct',
    'qwen3-32b',
    'deepseek-r1-distill-qwen-32b',
    'gemma-3-27b-it',
    'mistral-small-24b-instruct',
    'qwen2.5-coder-32b-instruct',
    'phi-4'
  ],
  openrouter: [
    'anthropic/claude-opus-4.7',
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4.6',
    'google/gemini-3-pro',
    'x-ai/grok-4.1-fast',
    'deepseek/deepseek-v3.2',
    'deepseek/deepseek-r1',
    'meta-llama/llama-4-maverick',
    'qwen/qwen3-max',
    'minimax/minimax-m2.7'
  ],
  mistral: [
    'mistral-large-latest',
    'magistral-medium-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
    'pixtral-large-latest',
    'ministral-8b-latest'
  ],
  deepseek: [
    'deepseek-reasoner',
    'deepseek-chat'
  ],
  xai: [
    'grok-4.20-multi-agent',
    'grok-4',
    'grok-4-1-fast-reasoning',
    'grok-4-fast-reasoning',
    'grok-code-fast-1',
    'grok-4-1-fast-non-reasoning'
  ],
  qwen: [
    'qwen3-max',
    'qwen3.5-plus',
    'qwen3-coder-plus',
    'qwq-plus',
    'qwen-flash',
    'qwen3-coder-flash'
  ],
  glm: [
    'glm-4.6',
    'glm-4.5',
    'glm-4.5-air',
    'glm-4-plus',
    'glm-4.6v-flash',
    'glm-4-flash'
  ],
  minimax: [
    'MiniMax-M2.7',
    'MiniMax-M2.7-highspeed',
    'MiniMax-M2.5',
    'MiniMax-M2.1',
    'MiniMax-M2'
  ]
};

export class SettingsView {
  constructor(modals, modalId, prefs, bus, onProviderChange) {
    this.modals = modals;
    this.modalId = modalId;
    this.prefs = prefs;
    this.bus = bus;
    this.onProviderChange = onProviderChange;
    this.wired = false;
  }

  open() {
    this.modals.open(this.modalId, { onOpen: () => this.#populate() });
  }
  close() { this.modals.close(this.modalId); }

  wire() {
    if (this.wired) return;
    this.wired = true;

    // Board toggles
    $('#opt-coords').addEventListener('change', (e) => this.prefs.set('coords', e.target.checked));
    $('#opt-legal').addEventListener('change',  (e) => this.prefs.set('legalHighlight', e.target.checked));
    $('#opt-last').addEventListener('change',   (e) => this.prefs.set('lastMoveHighlight', e.target.checked));
    $('#opt-sound').addEventListener('change',  (e) => this.prefs.set('sound', e.target.checked));
    $('#opt-anim').addEventListener('change',   (e) => this.prefs.set('animations', e.target.checked));

    // Theme swatches
    $$('.theme-swatch').forEach(s => s.addEventListener('click', () => {
      $$('.theme-swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      this.prefs.set('theme', s.dataset.theme);
    }));

    // Provider select
    $('#sel-provider').addEventListener('change', (e) => {
      this.prefs.set('provider', e.target.value);
      this.#showProviderBlock(e.target.value);
      this.onProviderChange();
    });

    // Keys / URLs — one handler per provider, only wired if the inputs exist
    for (const p of Object.keys(PROVIDER_PRESETS)) {
      this.#bindInput(`#key-${p}`, `${p}Key`);
      this.#bindInput(`#url-${p}`, `${p}Url`);

      const sel = document.getElementById(`sel-model-${p}`);
      const customField = document.querySelector(`.provider-custom[data-for="${p}"]`);
      const customInput = document.getElementById(`custom-model-${p}`);
      if (!sel || !customField || !customInput) continue;

      sel.addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '__custom__') {
          customField.hidden = false;
          if (customInput.value) this.prefs.set(`${p}Model`, customInput.value);
          customInput.focus();
        } else {
          customField.hidden = true;
          this.prefs.set(`${p}Model`, v);
        }
        this.onProviderChange();
      });
      customInput.addEventListener('input', (e) => {
        if (sel.value === '__custom__') {
          this.prefs.set(`${p}Model`, e.target.value);
          this.onProviderChange();
        }
      });
    }

    // Close and backdrop
    $('#btn-close-settings').addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    $('#settings-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.close();
    });

    // Reset progress
    $('#btn-reset-all').addEventListener('click', () => {
      if (confirm('Reset all progress, keys, and settings?')) this.prefs.reset();
    });
  }

  #bindInput(selector, key) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.addEventListener('input', (e) => {
      this.prefs.set(key, e.target.value);
      this.onProviderChange();
    });
  }

  #populate() {
    const p = this.prefs;
    $('#opt-coords').checked = p.get('coords');
    $('#opt-legal').checked  = p.get('legalHighlight');
    $('#opt-last').checked   = p.get('lastMoveHighlight');
    $('#opt-sound').checked  = p.get('sound');
    $('#opt-anim').checked   = p.get('animations');
    $$('.theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === p.get('theme')));
    $('#sel-provider').value = p.get('provider');

    for (const id of Object.keys(PROVIDER_PRESETS)) {
      const keyInput = document.getElementById(`key-${id}`);
      if (keyInput) keyInput.value = p.get(`${id}Key`) || '';
      const urlInput = document.getElementById(`url-${id}`);
      if (urlInput && p.get(`${id}Url`)) urlInput.value = p.get(`${id}Url`);
      this.#syncModelSelect(id);
    }
    this.#showProviderBlock(p.get('provider'));
  }

  #syncModelSelect(provider) {
    const stored = this.prefs.get(`${provider}Model`) || PROVIDER_PRESETS[provider][0];
    const sel = document.getElementById(`sel-model-${provider}`);
    const customField = document.querySelector(`.provider-custom[data-for="${provider}"]`);
    const customInput = document.getElementById(`custom-model-${provider}`);
    if (!sel || !customField || !customInput) return;
    const presets = PROVIDER_PRESETS[provider];
    if (presets.includes(stored)) {
      sel.value = stored;
      customField.hidden = true;
      customInput.value = '';
    } else {
      sel.value = '__custom__';
      customField.hidden = false;
      customInput.value = stored;
    }
  }

  #showProviderBlock(provider) {
    $$('.provider-config').forEach(cfg => {
      cfg.hidden = cfg.dataset.provider !== provider;
    });
  }
}
