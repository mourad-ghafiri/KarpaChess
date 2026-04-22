/**
 * Tab router. Owns the `<nav class="nav-tabs">` buttons and the tab panels.
 * When a tab activates/deactivates, emits TAB_ACTIVATED / TAB_DEACTIVATED so
 * feature controllers can do their setup/teardown without knowing about us.
 */
import { EVENTS } from '../core/constants.js';
import { $$ } from '../core/dom.js';

export class TabController {
  constructor(bus) {
    this.bus = bus;
    this.current = $$('.tab.active')[0]?.dataset.tab || null;
    for (const t of $$('.tab')) {
      t.addEventListener('click', () => this.activate(t.dataset.tab));
    }
  }

  activate(name) {
    if (this.current === name) return;
    const previous = this.current;
    if (previous) this.bus.emit(EVENTS.TAB_DEACTIVATED, { name: previous });

    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    this.current = name;
    this.bus.emit(EVENTS.TAB_ACTIVATED, { name });
  }
}
