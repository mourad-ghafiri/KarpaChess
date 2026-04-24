/**
 * MoveTreeView — renders the match's move tree with main line + variations +
 * classification icons + comments. Clicking a move jumps to that node.
 */
import { EVENTS } from '../core/constants.js';
import { i18n } from '../core/i18n.js';

function classIcon(key) {
  return {
    glyph: i18n.t('classification.' + key + '.glyph'),
    title: i18n.t('classification.' + key + '.label')
  };
}

export class MoveTreeView {
  constructor(rootEl, commentatorState, bus) {
    this.root = rootEl;
    this.state = commentatorState;
    this.bus = bus;

    bus.on(EVENTS.COMMENTATOR_MATCH_LOADED, () => this.render());
    bus.on(EVENTS.COMMENTATOR_NAVIGATED,    () => this.render());
    bus.on(EVENTS.I18N_CHANGED, () => this.render());
  }

  render() {
    const root = this.state.root;
    if (!root) {
      this.root.innerHTML = `<div class="history-empty">${escapeHtml(i18n.t('ui.empty.moveTree'))}</div>`;
      return;
    }

    const currentId = this.state.currentNode()?.id || null;

    const frag = document.createDocumentFragment();
    this.#renderLine(root, frag, { currentId, isMain: true, fromPly: 0 });
    this.root.innerHTML = '';
    this.root.appendChild(frag);

    // Scroll current move into view
    const active = this.root.querySelector('.mt-san.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * Walk `startNode.mainChild` (if isMain is true) or `startNode` itself (for
   * variations) and render each move as a chip. `fromPly` is the ply of the
   * CURRENT position (startNode's ply); the first move rendered has
   * fromPly + 1.
   */
  #renderLine(startNode, parentEl, { currentId, isMain, fromPly }) {
    const container = document.createElement('div');
    container.className = isMain ? 'mt-main' : 'mt-variation';

    let cur = isMain ? startNode.mainChild : startNode;
    let ply = fromPly + 1;
    while (cur) {
      // Move number label
      if (ply % 2 === 1) {
        const num = document.createElement('span');
        num.className = 'mt-num';
        num.textContent = Math.ceil(ply / 2) + '.';
        container.appendChild(num);
      } else if (container.children.length === 0 || container.lastElementChild.classList.contains('mt-close')) {
        // Variation starting on black's move — emit "N..."
        const num = document.createElement('span');
        num.className = 'mt-num';
        num.textContent = Math.ceil(ply / 2) + '...';
        container.appendChild(num);
      }

      // SAN chip
      const chip = document.createElement('span');
      chip.className = 'mt-san';
      if (cur.id === currentId) chip.classList.add('active');
      if (cur.classification) chip.classList.add('cls-' + cur.classification);
      chip.dataset.nodeId = cur.id;
      const icon = cur.classification ? classIcon(cur.classification) : null;
      chip.innerHTML = (icon ? `<span class="mt-cls" title="${escapeHtml(icon.title)}">${escapeHtml(icon.glyph)}</span>` : '') + escapeHtml(cur.san);
      chip.addEventListener('click', () => this.state.jumpTo(cur.id));
      container.appendChild(chip);

      if (cur.comment) {
        const c = document.createElement('span');
        c.className = 'mt-comment';
        c.textContent = '{' + cur.comment + '}';
        container.appendChild(c);
      }

      // Variations under this node — emit indented sub-trees
      for (const v of cur.variations) {
        const open = document.createElement('span');
        open.className = 'mt-open';
        open.textContent = '(';
        container.appendChild(open);
        this.#renderLine(v, container, { currentId, isMain: false, fromPly: ply - 1 });
        const close = document.createElement('span');
        close.className = 'mt-close';
        close.textContent = ')';
        container.appendChild(close);
      }

      cur = cur.mainChild;
      ply++;
    }

    parentEl.appendChild(container);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[<>&"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'
  }[c]));
}
