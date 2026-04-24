/**
 * Minimal i18n runtime. Owns the current language, the active translation
 * bundle, and two rendering helpers (`t` for lookups, `bindStatic` for HTML).
 *
 * Keys are dot-paths into a nested object: `t('ui.button.flip')` →
 * bundle.ui.button.flip. Parameters replace `{name}` tokens in the looked-up
 * string. Missing keys fall back to the English bundle, then to the key itself.
 *
 * No build step, no ICU. Plural handling uses `Intl.PluralRules`.
 */

import { EVENTS, SUPPORTED_LANGS, RTL_LANGS, LANG_LABELS } from './constants.js';

const BUNDLE_URL = (lang) => `data/i18n/${lang}.json`;

/**
 * Module-level singleton. `i18n.t('...')` works from anywhere after bootstrap
 * has called `i18n.init(lang)`. This avoids threading an I18n instance
 * through every view/controller constructor.
 */
export const i18n = {
  _impl: null,
  bind(impl) { this._impl = impl; },
  t(k, p)    { return this._impl.t(k, p); },
  side(c)    { return this._impl.side(c); },
  piece(l)   { return this._impl.piece(l); },
  plural(n, forms) { return this._impl.plural(n, forms); },
  get lang()       { return this._impl?.lang || 'en'; },
  englishName(c)   { return this._impl.englishName(c); },
  nativeName(c)    { return this._impl.nativeName(c); },
  rebind(root)     { return this._impl.rebind(root); }
};

export class I18n {
  constructor(bus) {
    this.bus = bus;
    this.lang = 'en';
    this.bundle = null;     // current language bundle
    this.fallback = null;   // always English
  }

  /** Load English first (fallback), then the requested language if different. */
  async init(lang) {
    this.fallback = await this.#fetch('en');
    await this.load(lang);
  }

  async load(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
    this.lang = lang;
    this.bundle = (lang === 'en') ? this.fallback : await this.#fetch(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
    this.#bindStatic(document);
    this.bus.emit(EVENTS.I18N_CHANGED, { lang });
  }

  /**
   * Translate a key with optional `{name}` params.
   * Interpolation is string replace — callers must escapeHtml values that
   * contain user data if the result is about to be set as innerHTML.
   */
  t(key, params) {
    const raw = this.#lookup(this.bundle, key)
             ?? this.#lookup(this.fallback, key)
             ?? key;
    return params ? this.#interp(raw, params) : raw;
  }

  /** Lowercase variant — some languages inflect, but for en/fr/es/id/zh/ja the
   *  source string is already lowercase-friendly where we use this helper. */
  tLower(key, params) { return this.t(key, params); }

  /** Intl-driven plural form picker. */
  plural(count, forms) {
    const rule = new Intl.PluralRules(this.lang);
    const form = rule.select(count);
    return forms[form] ?? forms.other ?? '';
  }

  /** Native label for each language code (e.g. 'fr' → 'Français'). */
  nativeName(code) { return LANG_LABELS[code] || code; }

  /** The language name inserted into the LLM system prompt. */
  englishName(code) {
    return ({ en: 'English', fr: 'French', es: 'Spanish', ar: 'Arabic',
              zh: 'Chinese', ru: 'Russian', id: 'Indonesian', ja: 'Japanese' })[code] || 'English';
  }

  /** Re-bind any newly-inserted DOM with data-i18n attributes. Views call this
   *  after innerHTML assignment if the fragment contains translation hooks. */
  rebind(root) { this.#bindStatic(root || document); }

  /** Short-hand for "side to move" translation ('w'/'b' → localized White/Black). */
  side(color) { return this.t(color === 'w' ? 'game.side.white' : 'game.side.black'); }

  /** Translated piece name, case-insensitive. */
  piece(letter) { return this.t('chess.piece.' + letter.toLowerCase()); }

  // -- private -----------------------------------------------------

  async #fetch(lang) {
    const r = await fetch(BUNDLE_URL(lang), { cache: 'no-store' });
    if (!r.ok) throw new Error(`Failed to load i18n bundle: ${lang}`);
    return await r.json();
  }

  #lookup(obj, key) {
    if (!obj) return undefined;
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return (typeof cur === 'string') ? cur : undefined;
  }

  #interp(str, params) {
    return str.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] != null ? String(params[name]) : `{${name}}`);
  }

  /**
   * Walk all elements with i18n attributes and set their text/placeholder/
   * title/aria-label. Idempotent — safe to call after DOM insertions.
   */
  #bindStatic(root) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = this.t(el.getAttribute('data-i18n'));
    }
    for (const el of root.querySelectorAll('[data-i18n-html]')) {
      el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      el.title = this.t(el.getAttribute('data-i18n-title'));
    }
    for (const el of root.querySelectorAll('[data-i18n-aria-label]')) {
      el.setAttribute('aria-label', this.t(el.getAttribute('data-i18n-aria-label')));
    }
  }
}
