/**
 * Topbar language switcher: a flag button that opens a dropdown of all
 * supported languages (flag + native-script label). Clicking a language
 * sets `lang` on PrefsStore — the existing PREFS_CHANGED handler in app.js
 * reloads the i18n bundle and content for the new language.
 */
import { $ } from '../core/dom.js';
import { SUPPORTED_LANGS, LANG_LABELS, LANG_FLAGS, EVENTS } from '../core/constants.js';

export class LangSwitcherView {
  constructor(prefs, bus) {
    this.prefs = prefs;
    this.bus = bus;
    this.wrap = $('#lang-switcher');
    this.toggle = $('#btn-lang');
    this.menu = $('#lang-menu');
    this.flagEl = $('#lang-flag-current');

    this.#renderMenu();
    this.#syncFlag();
    this.#wire();
    bus.on(EVENTS.I18N_CHANGED, () => this.#syncFlag());
  }

  #renderMenu() {
    this.menu.innerHTML = '';
    for (const code of SUPPORTED_LANGS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lang-item';
      item.dataset.lang = code;
      item.role = 'menuitem';
      item.innerHTML = `
        <span class="lang-flag">${LANG_FLAGS[code]}</span>
        <span class="lang-name">${LANG_LABELS[code]}</span>`;
      item.addEventListener('click', () => {
        this.prefs.set('lang', code);
        this.#close();
      });
      this.menu.appendChild(item);
    }
  }

  #syncFlag() {
    const lang = this.prefs.get('lang') || 'en';
    if (this.flagEl) this.flagEl.textContent = LANG_FLAGS[lang] || '🇬🇧';
    for (const el of this.menu.querySelectorAll('.lang-item')) {
      el.classList.toggle('active', el.dataset.lang === lang);
    }
  }

  #wire() {
    this.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = this.wrap.classList.toggle('open');
      this.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.menu.hidden = !open;
    });
    document.addEventListener('click', (e) => {
      if (!this.wrap.classList.contains('open')) return;
      if (this.wrap.contains(e.target)) return;
      this.#close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.wrap.classList.contains('open')) this.#close();
    });
  }

  #close() {
    this.wrap.classList.remove('open');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
  }
}
