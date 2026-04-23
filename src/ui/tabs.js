/**
 * Tab router. Owns the `<nav class="nav-tabs">` buttons and the tab panels.
 * When a tab activates/deactivates, emits TAB_ACTIVATED / TAB_DEACTIVATED so
 * feature controllers can do their setup/teardown without knowing about us.
 *
 * On mobile the tab row becomes a dropdown ("breadcrumb" style). The dropdown
 * toggle (`#nav-crumb`) always exists in the DOM — CSS hides it on desktop and
 * collapses the tab row into an expandable menu on mobile.
 */
import { EVENTS } from '../core/constants.js';
import { $, $$ } from '../core/dom.js';

export class TabController {
  constructor(bus) {
    this.bus = bus;
    this.current = $$('.tab.active')[0]?.dataset.tab || null;

    for (const t of $$('.tab')) {
      t.addEventListener('click', () => {
        this.activate(t.dataset.tab);
        this.#closeDropdown();
      });
    }

    this.#wireDropdown();
    this.#syncCrumbLabel();
  }

  activate(name) {
    if (this.current === name) return;
    const previous = this.current;
    if (previous) this.bus.emit(EVENTS.TAB_DEACTIVATED, { name: previous });

    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    this.current = name;
    this.#syncCrumbLabel();
    this.bus.emit(EVENTS.TAB_ACTIVATED, { name });
  }

  // ---- dropdown (mobile) -----------------------------------------
  #wireDropdown() {
    const crumb = $('#nav-crumb');
    const wrap  = crumb?.parentElement;
    if (!crumb || !wrap) return;

    crumb.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('open');
      crumb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Click outside → close
    document.addEventListener('click', (e) => {
      if (!wrap.classList.contains('open')) return;
      if (wrap.contains(e.target)) return;
      this.#closeDropdown();
    });

    // Esc → close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.classList.contains('open')) this.#closeDropdown();
    });
  }

  #closeDropdown() {
    const crumb = $('#nav-crumb');
    const wrap  = crumb?.parentElement;
    if (!wrap) return;
    wrap.classList.remove('open');
    if (crumb) crumb.setAttribute('aria-expanded', 'false');
  }

  #syncCrumbLabel() {
    const label = $('#nav-crumb-label');
    if (!label) return;
    const active = $$('.tab').find(t => t.dataset.tab === this.current);
    label.textContent = active ? active.textContent : '';
  }
}
