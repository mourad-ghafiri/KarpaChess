/**
 * DrawingOverlay — full SVG annotation layer for the Commentator board.
 *
 * Tools:
 *   select   — click a shape to pick it; drag body to move; drag corner
 *              handles to resize; drag the halo handle to rotate.
 *   eraser   — click a shape to delete it.
 *   arrow / line / rect / circle / pen / text — create new shapes.
 *
 * Stable tool: the chosen tool stays selected until the user picks another.
 * Stable selection: once a shape is picked it stays selected across re-renders
 * (and across ply navigation it's cleared, since drawings are per-ply).
 *
 * Shape shape:
 *   { kind, color, stroke, points: [[x,y],...], text?, rotation?: degrees }
 *
 * Coordinate system: 0..8 board-units matching the SVG viewBox.
 */
import { EVENTS, DRAW_COLORS } from '../core/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TOOLS = [
  { id: 'select', label: 'Select', icon: '⬚' },
  { id: 'eraser', label: 'Erase',  icon: '✕' },
  { id: 'arrow',  label: 'Arrow',  icon: '➤' },
  { id: 'line',   label: 'Line',   icon: '╱' },
  { id: 'rect',   label: 'Box',    icon: '▭' },
  { id: 'circle', label: 'Circle', icon: '◯' },
  { id: 'pen',    label: 'Pen',    icon: '✎' },
  { id: 'text',   label: 'Text',   icon: 'T' }
];

const HANDLE_SIZE = 0.22;   // in board-units
const ROT_OFFSET = 0.55;   // distance above bounding box for the rotate handle

export class DrawingOverlay {
  constructor({ svgEl, toolbarEl, boardRootEl }, gameState, commentatorState, bus) {
    this.svg = svgEl;
    this.toolbar = toolbarEl;
    this.boardRoot = boardRootEl;
    this.gameState = gameState;
    this.commentatorState = commentatorState;
    this.bus = bus;

    this.tool = 'select';
    this.color = DRAW_COLORS[0].hex;
    this.stroke = 0.08;
    this.enabled = false;
    this.selectedIdx = null;
    this.drag = null;         // active drag descriptor

    this.#buildToolbar();
    this.#wirePointer();
    this.#wireKeys();

    bus.on(EVENTS.COMMENTATOR_NAVIGATED, () => {
      this.selectedIdx = null;
      this.#closeInlineText();
      this.render();
    });
    bus.on(EVENTS.COMMENTATOR_DRAWING_CHANGED, () => this.render());
    bus.on(EVENTS.STATE_CHANGED, (e) => {
      const t = e?.detail?.type;
      if (t === 'mode' || t === 'orientation') this.render();
    });

    this.svg.hidden = true;
  }

  // ---- lifecycle -------------------------------------------------
  enable(on) {
    this.enabled = on;
    if (!on) { this.selectedIdx = null; }
    this.#refreshPointerEvents();
    this.render();
  }
  isEnabled() { return this.enabled; }

  /**
   * Creation tools (arrow / line / rect / circle / pen / text) need to
   * capture every click on the overlay. Select / eraser tools let empty-square
   * clicks fall through to the board so the user can still play moves and
   * create variations while the drawing layer is active. Shapes themselves
   * always catch clicks via their per-shape pointer-events.
   */
  #refreshPointerEvents() {
    const capture = this.enabled && this.tool !== 'select' && this.tool !== 'eraser';
    this.svg.style.pointerEvents = capture ? 'auto' : 'none';
  }

  // ---- toolbar ---------------------------------------------------
  #buildToolbar() {
    this.toolbar.innerHTML = '';

    const tools = document.createElement('div');
    tools.className = 'draw-tools';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'draw-tool';
      b.type = 'button';
      b.dataset.tool = t.id;
      b.title = t.label;
      b.innerHTML = `<span class="draw-icon">${t.icon}</span><span class="draw-label">${t.label}</span>`;
      b.addEventListener('click', () => this.#setTool(t.id));
      tools.appendChild(b);
    }
    this.toolbar.appendChild(tools);

    // Single combined row: colors → stroke → delete / clear
    const styleRow = document.createElement('div');
    styleRow.className = 'draw-style-row';

    const colors = document.createElement('div');
    colors.className = 'draw-colors';
    for (const c of DRAW_COLORS) {
      const sw = document.createElement('button');
      sw.className = 'draw-swatch';
      sw.type = 'button';
      sw.dataset.color = c.hex;
      sw.style.background = c.hex;
      sw.title = c.id;
      sw.addEventListener('click', () => this.#setColor(c.hex));
      colors.appendChild(sw);
    }
    styleRow.appendChild(colors);

    const stroke = document.createElement('input');
    stroke.type = 'range';
    stroke.className = 'draw-width';
    stroke.min = '0.03'; stroke.max = '0.24'; stroke.step = '0.01';
    stroke.value = this.stroke;
    stroke.title = 'Stroke width';
    stroke.addEventListener('input', (e) => {
      this.stroke = parseFloat(e.target.value);
      if (this.selectedIdx != null) this.#updateSelected(s => { s.stroke = this.stroke; });
    });
    styleRow.appendChild(stroke);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'draw-iconbtn';
    delBtn.title = 'Delete selected (Del)';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => this.#deleteSelected());
    styleRow.appendChild(delBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'draw-iconbtn draw-iconbtn-warn';
    clearBtn.title = 'Clear all shapes on this move';
    clearBtn.textContent = '⌫';
    clearBtn.addEventListener('click', () => this.#clearAll());
    styleRow.appendChild(clearBtn);

    this.toolbar.appendChild(styleRow);

    this.#setTool('select');
    this.#setColor(this.color);
  }

  #setTool(id) {
    this.tool = id;
    for (const b of this.toolbar.querySelectorAll('.draw-tool'))
      b.classList.toggle('active', b.dataset.tool === id);
    // Reflect the tool on <body> so each tool can own its cursor via CSS.
    for (const c of [...document.body.classList]) {
      if (c.startsWith('draw-tool-')) document.body.classList.remove(c);
    }
    document.body.classList.add('draw-tool-' + id);
    // Switching tools deselects (eraser/arrow/etc don't need a selection).
    if (id !== 'select' && this.selectedIdx != null) { this.selectedIdx = null; this.render(); }
    this.#closeInlineText();
    this.#refreshPointerEvents();
  }

  #setColor(hex) {
    this.color = hex;
    for (const b of this.toolbar.querySelectorAll('.draw-swatch'))
      b.classList.toggle('active', b.dataset.color === hex);
    if (this.selectedIdx != null) this.#updateSelected(s => { s.color = hex; });
  }

  // ---- pointer handling -----------------------------------------
  #wirePointer() {
    this.svg.addEventListener('pointerdown', (e) => this.#onDown(e));
    this.svg.addEventListener('pointermove', (e) => this.#onMove(e));
    window.addEventListener('pointerup',     (e) => this.#onUp(e));
    // Capture pointer moves outside the SVG so drags still track
    window.addEventListener('pointermove', (e) => {
      if (this.drag) this.#onMove(e);
    });
    // Double-click on a text shape with the Select tool opens the inline
    // editor with the existing text pre-filled.
    this.svg.addEventListener('dblclick', (e) => {
      if (!this.enabled || this.tool !== 'select') return;
      const idx = this.#hitTest(e.target);
      if (idx == null) return;
      const shape = this.#currentDrawings()[idx];
      if (!shape || shape.kind !== 'text') return;
      this.#startInlineText(e, shape.points[0], idx, shape.text);
    });
  }

  #pointToBoard(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 8;
    const y = ((e.clientY - rect.top) / rect.height) * 8;
    return [clamp(x, -0.5, 8.5), clamp(y, -0.5, 8.5)];
  }

  #onDown(e) {
    if (!this.enabled) return;
    if (!this.commentatorState.hasMatch()) return;
    const pt = this.#pointToBoard(e);

    // Handle hits first (corner / rotate handles on the selected shape).
    const handle = e.target.closest('[data-handle]');
    if (handle && this.selectedIdx != null) {
      const kind = handle.dataset.handle;
      this.drag = { type: kind === 'rot' ? 'rotate' : 'resize', corner: kind, origin: pt };
      this.drag.startShape = JSON.parse(JSON.stringify(this.#selected()));
      this.svg.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (this.tool === 'select') {
      const hit = this.#hitTest(e.target);
      if (hit == null) { this.selectedIdx = null; this.render(); return; }
      this.selectedIdx = hit;
      const startShape = JSON.parse(JSON.stringify(this.#selected()));
      this.drag = { type: 'move', origin: pt, startShape };
      this.render();
      this.svg.setPointerCapture?.(e.pointerId);
      return;
    }

    if (this.tool === 'eraser') {
      const hit = this.#hitTest(e.target);
      if (hit != null) this.#deleteAt(hit);
      return;
    }

    if (this.tool === 'text') {
      this.#startInlineText(e, pt);
      return;
    }

    if (this.tool === 'pen') {
      this.drag = { type: 'pen', shape: {
        kind: 'pen', color: this.color, stroke: this.stroke, points: [pt], rotation: 0
      }};
      this.#drawPreview(this.drag.shape);
      this.svg.setPointerCapture?.(e.pointerId);
      return;
    }

    // arrow / line / rect / circle — two-point drag
    this.drag = { type: 'create', shape: {
      kind: this.tool, color: this.color, stroke: this.stroke,
      points: [pt, pt], rotation: 0
    }};
    this.#drawPreview(this.drag.shape);
    this.svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  #onMove(e) {
    if (!this.drag) return;
    const pt = this.#pointToBoard(e);

    if (this.drag.type === 'pen') {
      this.drag.shape.points.push(pt);
      this.#drawPreview(this.drag.shape);
      return;
    }

    if (this.drag.type === 'create') {
      this.drag.shape.points[1] = pt;
      this.#drawPreview(this.drag.shape);
      return;
    }

    if (this.drag.type === 'move') {
      const [dx, dy] = [pt[0] - this.drag.origin[0], pt[1] - this.drag.origin[1]];
      this.#updateSelected(s => {
        s.points = this.drag.startShape.points.map(([x, y]) => [x + dx, y + dy]);
      });
      return;
    }

    if (this.drag.type === 'resize') {
      this.#applyResize(pt);
      return;
    }

    if (this.drag.type === 'rotate') {
      this.#applyRotate(pt);
      return;
    }
  }

  #onUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;

    if (d.type === 'pen') {
      this.#clearPreview();
      if (d.shape.points.length > 1) this.#addShape(d.shape);
      // Don't auto-select: handles / chrome only appear when the user
      // explicitly picks the Select tool and clicks on a shape.
      return;
    }

    if (d.type === 'create') {
      this.#clearPreview();
      const [[x1, y1], [x2, y2]] = d.shape.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 0.1) return;
      this.#addShape(d.shape);
      return;
    }

    // move / resize / rotate — persist already happened via #updateSelected
    this.render();
  }

  // ---- inline text editor ---------------------------------------
  /**
   * Present a real HTML input overlayed on the board at the click position
   * (instead of a native `prompt()` dialog). Enter commits, Escape cancels,
   * blur commits (so clicking elsewhere saves what you typed).
   *
   * @param {PointerEvent|MouseEvent} e  — the click that triggered editing
   * @param {[number, number]} boardPt   — board-space coords for the shape
   * @param {number|null} replaceIdx    — if set, overwrite this shape instead of adding
   * @param {string} initialText
   */
  #startInlineText(e, [bx, by], replaceIdx = null, initialText = '') {
    this.#closeInlineText();
    const holder = this.svg.parentElement;   // .board-holder
    const holderRect = holder.getBoundingClientRect();
    const px = e.clientX - holderRect.left;
    const py = e.clientY - holderRect.top;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'draw-text-editor';
    input.value = initialText;
    input.placeholder = 'Type…';
    input.style.left = px + 'px';
    input.style.top  = py + 'px';
    input.style.color = this.color;
    input.style.borderColor = this.color;
    holder.appendChild(input);
    this._textEditor = input;

    // Focus next frame so the click that spawned us doesn't immediately blur
    requestAnimationFrame(() => { input.focus(); input.select(); });

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      input.remove();
      if (this._textEditor === input) this._textEditor = null;
    };
    const commit = () => {
      if (done) return;
      const v = input.value.trim();
      cleanup();
      if (!v) {
        if (replaceIdx != null) this.#deleteAt(replaceIdx);
        return;
      }
      if (replaceIdx != null) {
        this.#updateAt(replaceIdx, s => { s.text = v; s.color = this.color; });
      } else {
        this.#addShape({
          kind: 'text', color: this.color, stroke: this.stroke,
          points: [[bx, by]], text: v, rotation: 0
        });
      }
    };

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cleanup(); }
    });
    // Defer so Enter's keyup (which would blur via some OSes) doesn't race
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }

  #closeInlineText() {
    if (this._textEditor) { this._textEditor.remove(); this._textEditor = null; }
  }

  /** Replace a drawing at `idx` by running a mutator over a shallow copy. */
  #updateAt(idx, mutator) {
    const cur = this.commentatorState.currentNode();
    if (!cur || !cur.drawings[idx]) return;
    const drawings = cur.drawings.slice();
    const s = JSON.parse(JSON.stringify(drawings[idx]));
    mutator(s);
    drawings[idx] = s;
    this.commentatorState.setDrawings(cur.id, drawings);
  }

  // ---- shape creation / mutation --------------------------------
  #addShape(shape) {
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    const drawings = cur.drawings.slice();
    drawings.push(shape);
    this.commentatorState.setDrawings(cur.id, drawings);
  }

  #deleteAt(idx) {
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    const drawings = cur.drawings.slice();
    drawings.splice(idx, 1);
    this.commentatorState.setDrawings(cur.id, drawings);
    if (this.selectedIdx === idx) this.selectedIdx = null;
    else if (this.selectedIdx > idx) this.selectedIdx--;
  }

  #deleteSelected() {
    if (this.selectedIdx != null) this.#deleteAt(this.selectedIdx);
  }

  #clearAll() {
    const cur = this.commentatorState.currentNode();
    if (!cur || !cur.drawings.length) return;
    this.selectedIdx = null;
    this.commentatorState.setDrawings(cur.id, []);
  }

  #updateSelected(mutator) {
    if (this.selectedIdx == null) return;
    const cur = this.commentatorState.currentNode();
    if (!cur) return;
    const drawings = cur.drawings.slice();
    const s = JSON.parse(JSON.stringify(drawings[this.selectedIdx]));
    mutator(s);
    drawings[this.selectedIdx] = s;
    this.commentatorState.setDrawings(cur.id, drawings);
  }

  #selected() {
    if (this.selectedIdx == null) return null;
    return this.#currentDrawings()[this.selectedIdx] || null;
  }

  #currentDrawings() {
    const cur = this.commentatorState.currentNode();
    return cur ? cur.drawings : [];
  }

  // ---- resize / rotate math -------------------------------------
  #applyResize(pt) {
    const s = this.drag.startShape;
    const corner = this.drag.corner;   // 'nw'|'ne'|'sw'|'se'|'n'|'s'|'e'|'w' or end handle indices
    const box = boundingBox(s.points);

    if (s.kind === 'arrow' || s.kind === 'line') {
      // Endpoint drag
      const endIdx = corner === 'end2' ? 1 : 0;
      this.#updateSelected(out => { out.points = s.points.slice(); out.points[endIdx] = pt; });
      return;
    }

    // Compute scale factor + pivot for rect/circle/text/pen
    let pivot = [0, 0];
    let pickCorner = [0, 0];
    switch (corner) {
      case 'nw': pivot = [box.x + box.w, box.y + box.h]; pickCorner = [box.x, box.y]; break;
      case 'ne': pivot = [box.x, box.y + box.h];         pickCorner = [box.x + box.w, box.y]; break;
      case 'sw': pivot = [box.x + box.w, box.y];         pickCorner = [box.x, box.y + box.h]; break;
      case 'se': pivot = [box.x, box.y];                 pickCorner = [box.x + box.w, box.y + box.h]; break;
      case 'n':  pivot = [box.x, box.y + box.h];         pickCorner = [box.x, box.y]; break;
      case 's':  pivot = [box.x, box.y];                 pickCorner = [box.x, box.y + box.h]; break;
      case 'w':  pivot = [box.x + box.w, box.y];         pickCorner = [box.x, box.y]; break;
      case 'e':  pivot = [box.x, box.y];                 pickCorner = [box.x + box.w, box.y]; break;
    }
    const origDx = pickCorner[0] - pivot[0];
    const origDy = pickCorner[1] - pivot[1];
    const newDx = pt[0] - pivot[0];
    const newDy = pt[1] - pivot[1];
    // Axis-locked: n/s only scale Y; e/w only scale X.
    const sx = (corner === 'n' || corner === 's') ? 1 : (origDx === 0 ? 1 : newDx / origDx);
    const sy = (corner === 'e' || corner === 'w') ? 1 : (origDy === 0 ? 1 : newDy / origDy);

    this.#updateSelected(out => {
      out.points = s.points.map(([x, y]) => [
        pivot[0] + (x - pivot[0]) * sx,
        pivot[1] + (y - pivot[1]) * sy
      ]);
    });
  }

  #applyRotate(pt) {
    const s = this.drag.startShape;
    const box = boundingBox(s.points);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const origin = this.drag.origin;
    const angStart = Math.atan2(origin[1] - cy, origin[0] - cx);
    const angNow = Math.atan2(pt[1] - cy, pt[0] - cx);
    const delta = (angNow - angStart) * 180 / Math.PI;
    this.#updateSelected(out => { out.rotation = ((s.rotation || 0) + delta + 360) % 360; });
  }

  // ---- hit testing -----------------------------------------------
  /** Given a click target, return the shape index it belongs to or null. */
  #hitTest(target) {
    const g = target.closest('[data-shape-idx]');
    if (!g) return null;
    return parseInt(g.dataset.shapeIdx, 10);
  }

  // ---- key bindings ---------------------------------------------
  #wireKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === 'Escape') { this.selectedIdx = null; this.render(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedIdx != null) { e.preventDefault(); this.#deleteSelected(); }
      }
    });
  }

  // ---- rendering -------------------------------------------------
  render() {
    for (const child of [...this.svg.children]) {
      if (child.id !== 'draw-preview') child.remove();
    }

    if (this.gameState.mode !== 'commentator') { this.svg.hidden = true; return; }
    this.svg.hidden = false;
    if (!this.commentatorState.hasMatch()) return;

    // Selection chrome (outline + handles for resize / rotate) only exists
    // while the Select tool is active. Switching to another tool hides them
    // without actually clearing the selectedIdx — which is harmless because
    // no other tool reads it.
    const showChrome = this.tool === 'select';

    const drawings = this.#currentDrawings();
    drawings.forEach((d, idx) => {
      const g = this.#shapeGroup(d, showChrome && idx === this.selectedIdx);
      if (!g) return;
      g.setAttribute('data-shape-idx', idx);
      this.svg.insertBefore(g, this.#previewGroup());
    });

    if (showChrome && this.selectedIdx != null && drawings[this.selectedIdx]) {
      const h = this.#handlesFor(drawings[this.selectedIdx]);
      if (h) this.svg.insertBefore(h, this.#previewGroup());
    }
  }

  #previewGroup() {
    let g = this.svg.querySelector('#draw-preview');
    if (!g) { g = document.createElementNS(SVG_NS, 'g'); g.id = 'draw-preview'; this.svg.appendChild(g); }
    return g;
  }
  #drawPreview(shape) {
    const g = this.#previewGroup();
    g.innerHTML = '';
    const el = this.#shapeGroup(shape, true);
    if (el) g.appendChild(el);
  }
  #clearPreview() {
    const g = this.svg.querySelector('#draw-preview');
    if (g) g.innerHTML = '';
  }

  /** Returns an <g> containing the shape, rotated about its bounding-box center. */
  #shapeGroup(shape, selected) {
    const body = this.#shapeBody(shape);
    if (!body) return null;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'draw-shape-g' + (selected ? ' selected' : ''));
    const rot = shape.rotation || 0;
    if (rot) {
      const box = boundingBox(shape.points);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
    }
    g.appendChild(body);
    // Invisible hit-target atop the shape so it's easy to grab
    const hit = this.#hitTarget(shape);
    if (hit) g.appendChild(hit);
    return g;
  }

  #shapeBody(s) {
    switch (s.kind) {
      case 'arrow':  return this.#arrow(s);
      case 'line':   return this.#line(s);
      case 'rect':   return this.#rect(s);
      case 'circle': return this.#circle(s);
      case 'pen':    return this.#pen(s);
      case 'text':   return this.#text(s);
    }
    return null;
  }

  #hitTarget(s) {
    if (s.kind === 'text') return null;   // text element handles its own hit
    const box = boundingBox(s.points);
    if (s.kind === 'pen') {
      // path-based hit; fatter invisible clone
      const clone = this.#pen(s);
      clone.setAttribute('stroke', 'rgba(0,0,0,0.001)');
      clone.setAttribute('stroke-width', Math.max(0.25, s.stroke * 3));
      clone.setAttribute('class', 'draw-hit');
      return clone;
    }
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', box.x - 0.1); r.setAttribute('y', box.y - 0.1);
    r.setAttribute('width', box.w + 0.2); r.setAttribute('height', box.h + 0.2);
    r.setAttribute('fill', 'transparent');
    r.setAttribute('class', 'draw-hit');
    return r;
  }

  #arrow(s) {
    const g = document.createElementNS(SVG_NS, 'g');
    const [[x1, y1], [x2, y2]] = s.points;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.min(0.4, len * 0.3);
    const ex = x2 - (dx / len) * head;
    const ey = y2 - (dy / len) * head;

    const shaft = document.createElementNS(SVG_NS, 'line');
    shaft.setAttribute('x1', x1); shaft.setAttribute('y1', y1);
    shaft.setAttribute('x2', ex); shaft.setAttribute('y2', ey);
    shaft.setAttribute('stroke', s.color);
    shaft.setAttribute('stroke-width', s.stroke);
    shaft.setAttribute('stroke-linecap', 'round');

    const nx = -dy / len, ny = dx / len;
    const w = head * 0.55;
    const tip = document.createElementNS(SVG_NS, 'polygon');
    tip.setAttribute('points', `${x2},${y2} ${ex + nx * w},${ey + ny * w} ${ex - nx * w},${ey - ny * w}`);
    tip.setAttribute('fill', s.color);
    g.appendChild(shaft);
    g.appendChild(tip);
    return g;
  }
  #line(s) {
    const [[x1, y1], [x2, y2]] = s.points;
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', s.color);
    l.setAttribute('stroke-width', s.stroke);
    l.setAttribute('stroke-linecap', 'round');
    return l;
  }
  #rect(s) {
    const [[x1, y1], [x2, y2]] = s.points;
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', Math.min(x1, x2));
    r.setAttribute('y', Math.min(y1, y2));
    r.setAttribute('width',  Math.abs(x2 - x1));
    r.setAttribute('height', Math.abs(y2 - y1));
    r.setAttribute('stroke', s.color);
    r.setAttribute('stroke-width', s.stroke);
    r.setAttribute('fill', 'none');
    r.setAttribute('rx', 0.05);
    return r;
  }
  #circle(s) {
    const [[x1, y1], [x2, y2]] = s.points;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.max(0.15, Math.abs(x2 - x1) / 2);
    const ry = Math.max(0.15, Math.abs(y2 - y1) / 2);
    const el = document.createElementNS(SVG_NS, 'ellipse');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy);
    el.setAttribute('rx', rx); el.setAttribute('ry', ry);
    el.setAttribute('stroke', s.color);
    el.setAttribute('stroke-width', s.stroke);
    el.setAttribute('fill', 'none');
    return el;
  }
  #pen(s) {
    const d = 'M ' + s.points.map(p => p.join(' ')).join(' L ');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', s.stroke);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
  }
  #text(s) {
    const [[x, y]] = s.points;
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('fill', s.color);
    t.setAttribute('font-size', Math.max(0.35, s.stroke * 5));
    t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'draw-text');
    t.textContent = s.text || '';
    return t;
  }

  // ---- handles (selection chrome) --------------------------------
  #handlesFor(shape) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'draw-handles');
    const rot = shape.rotation || 0;
    const box = boundingBox(shape.points);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    if (rot) g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);

    const addHandle = (x, y, kind, cls = 'corner') => {
      const h = document.createElementNS(SVG_NS, 'rect');
      h.setAttribute('x', x - HANDLE_SIZE / 2);
      h.setAttribute('y', y - HANDLE_SIZE / 2);
      h.setAttribute('width',  HANDLE_SIZE);
      h.setAttribute('height', HANDLE_SIZE);
      h.setAttribute('class', 'draw-handle ' + cls);
      h.setAttribute('data-handle', kind);
      g.appendChild(h);
    };

    // Selection outline
    const outline = document.createElementNS(SVG_NS, 'rect');
    outline.setAttribute('x', box.x - 0.05); outline.setAttribute('y', box.y - 0.05);
    outline.setAttribute('width',  box.w + 0.1); outline.setAttribute('height', box.h + 0.1);
    outline.setAttribute('class', 'draw-outline');
    g.appendChild(outline);

    if (shape.kind === 'arrow' || shape.kind === 'line') {
      addHandle(shape.points[0][0], shape.points[0][1], 'end1', 'end');
      addHandle(shape.points[1][0], shape.points[1][1], 'end2', 'end');
    } else if (shape.kind !== 'pen' && shape.kind !== 'text') {
      // 8 handles for rect/circle
      addHandle(box.x,                 box.y,                 'nw');
      addHandle(box.x + box.w,         box.y,                 'ne');
      addHandle(box.x,                 box.y + box.h,         'sw');
      addHandle(box.x + box.w,         box.y + box.h,         'se');
      addHandle(box.x + box.w / 2,     box.y,                 'n',  'edge');
      addHandle(box.x + box.w / 2,     box.y + box.h,         's',  'edge');
      addHandle(box.x,                 box.y + box.h / 2,     'w',  'edge');
      addHandle(box.x + box.w,         box.y + box.h / 2,     'e',  'edge');
    } else if (shape.kind === 'text') {
      // 4 corner handles (scale font) — n/s/e/w don't make sense for text
      addHandle(box.x,                 box.y,                 'nw');
      addHandle(box.x + box.w,         box.y,                 'ne');
      addHandle(box.x,                 box.y + box.h,         'sw');
      addHandle(box.x + box.w,         box.y + box.h,         'se');
    }

    // Rotate handle — sits above bounding box center
    if (shape.kind !== 'pen') {
      const rx = box.x + box.w / 2;
      const ry = box.y - ROT_OFFSET;
      const stem = document.createElementNS(SVG_NS, 'line');
      stem.setAttribute('x1', rx); stem.setAttribute('y1', box.y - 0.05);
      stem.setAttribute('x2', rx); stem.setAttribute('y2', ry);
      stem.setAttribute('class', 'draw-rot-stem');
      g.appendChild(stem);
      const rot = document.createElementNS(SVG_NS, 'circle');
      rot.setAttribute('cx', rx); rot.setAttribute('cy', ry);
      rot.setAttribute('r', HANDLE_SIZE * 0.75);
      rot.setAttribute('class', 'draw-handle rot');
      rot.setAttribute('data-handle', 'rot');
      g.appendChild(rot);
    }

    return g;
  }
}

function boundingBox(points) {
  if (!points || points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of points) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return { x: minx, y: miny, w: Math.max(0.001, maxx - minx), h: Math.max(0.001, maxy - miny) };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
