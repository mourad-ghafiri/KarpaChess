/**
 * DrawingOverlay — annotation layer for the Commentator board.
 *
 * Two input paths:
 *
 * 1. **Right-click / long-press on the board** (Lichess pattern, no tool needed)
 *      • Right-click + drag from sq A → sq B  → arrow A → B
 *      • Right-click on a single square        → toggle a square highlight
 *      • Right-click on an existing shape      → delete it
 *      • Modifier keys swap the color (Shift→red, Alt→yellow, Ctrl/Cmd→blue,
 *        plain→green).
 *      • On touch, a 350 ms long-press is the right-click equivalent.
 *
 * 2. **Toolbar tool mode** (only for tools that genuinely need free input)
 *      • Pen      — freehand polyline
 *      • Text     — labelled annotation with an inline HTML editor
 *      • Rect     — bounding box for "this whole region matters"
 *
 *  Selection chrome (resize / rotate handles) appears automatically when a
 *  shape is tapped while one of the toolbar tools is active. There is no
 *  separate "Select" or "Eraser" tool — those are subsumed by the right-click
 *  gestures and the Delete key.
 *
 *  Per-ply undo / redo is delegated to commentatorState (Cmd+Z / Cmd+Shift+Z).
 *
 *  Coordinate system: 0..8 board-units matching the SVG viewBox.
 */
import { EVENTS, DRAW_COLORS, MODE_IDS } from '../core/constants.js';
import { i18n } from '../core/i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The three creation tools that need a tool-mode (free-input). */
const TOOLS = [
  { id: 'pen',  key: 'pen'  },
  { id: 'text', key: 'text' },
  { id: 'rect', key: 'box'  }
];

/** Inline 18×18 SVG icons matching the rest of the app's stroke style. */
const ICON_SVG = {
  pen: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 21l4-1 11-11-3-3L4 17l-1 4z"/>
          <path d="M14 6l3 3"/>
        </svg>`,
  text: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 6h14"/><path d="M12 6v14"/><path d="M9 20h6"/>
        </svg>`,
  rect: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="6" width="16" height="12" rx="2"/>
        </svg>`,
  undo: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 14l-4-4 4-4"/>
          <path d="M5 10h9a5 5 0 010 10h-3"/>
        </svg>`,
  redo: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 14l4-4-4-4"/>
          <path d="M19 10h-9a5 5 0 000 10h3"/>
        </svg>`,
  trash:`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16"/>
          <path d="M9 7V4h6v3"/>
          <path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/>
          <path d="M10 11v7M14 11v7"/>
        </svg>`
};

/** Modifier-key → color lookup. Plain (no modifier) is green. */
const MOD_COLOR = {
  plain: '#3b7a55',   // sage / green
  shift: '#c25a3c',   // coral / red
  alt:   '#e5b445',   // yellow
  meta:  '#2f4a6b',   // navy / blue
  ctrl:  '#2f4a6b'
};

const HANDLE_SIZE  = 0.22;
const ROT_OFFSET   = 0.55;
const LONG_PRESS_MS = 350;
const DRAG_THRESHOLD = 0.3;   // board-units to count as drag vs tap
const RIGHT_CLICK_ARROW_STROKE = 0.16;   // chunkier than toolbar default so right-click arrows pop on any square

export class DrawingOverlay {
  constructor({ svgEl, toolbarEl, boardRootEl }, gameState, commentatorState, bus) {
    this.svg = svgEl;
    this.toolbar = toolbarEl;
    this.boardRoot = boardRootEl;
    this.gameState = gameState;
    this.commentatorState = commentatorState;
    this.bus = bus;

    this.tool = null;            // null = no tool mode (right-click annotations only)
    this.color = DRAW_COLORS[0].hex;
    this.stroke = 0.08;
    this.enabled = true;         // available in every chess-board tab; toolbar gates by CSS
    this.selectedIdx = null;
    this.drag = null;            // active toolbar drag descriptor
    this._rcDrag = null;         // active right-click drag descriptor
    this._touchPress = null;     // long-press timer state

    // Ephemeral drawings backend used by every non-commentator mode (practice,
    // learn, puzzles, coach). Drawings live only as long as the position does
    // — any board move / undo / reset wipes them, mirroring how a real coach
    // erases the board between examples. Commentator continues to use the
    // per-node, persisted store on `commentatorState`.
    this._localDrawings = [];
    this._localHistory  = [];
    this._localFuture   = [];

    this.#buildToolbar();
    this.#wireToolbarPointer();
    this.#wireBoardRightClick();
    this.#wireKeys();

    bus.on(EVENTS.COMMENTATOR_NAVIGATED, () => {
      this.selectedIdx = null;
      this.#closeInlineText();
      this.#updateUndoRedoButtons();
      this.render();
    });
    bus.on(EVENTS.COMMENTATOR_DRAWING_CHANGED, () => {
      this.#updateUndoRedoButtons();
      this.render();
    });
    bus.on(EVENTS.STATE_CHANGED, (e) => {
      const t = e?.detail?.type;
      if (t === 'mode' || t === 'orientation') {
        // Mode flip → ephemeral state from another tab is no longer relevant.
        if (t === 'mode') this.#resetLocalDrawings();
        this.#updateUndoRedoButtons();
        this.render();
        return;
      }
      // For non-commentator modes a position change wipes the local board.
      if (!this.#useCommentator()
          && (t === 'move' || t === 'undo' || t === 'reset' || t === 'fen')) {
        this.#resetLocalDrawings();
        this.selectedIdx = null;
        this.#closeInlineText();
        this.#updateUndoRedoButtons();
        this.render();
      }
    });
    bus.on(EVENTS.I18N_CHANGED, () => this.#buildToolbar());

    this.svg.hidden = true;
    // Settle initial pointer-events / button states.
    this.#refreshPointerEvents();
  }

  /** True when we should read/write through commentatorState's per-node store. */
  #useCommentator() {
    return this.gameState.mode === MODE_IDS.COMMENTATOR
      && this.commentatorState?.hasMatch?.();
  }

  #resetLocalDrawings() {
    this._localDrawings = [];
    this._localHistory  = [];
    this._localFuture   = [];
  }

  // ============= lifecycle =============
  /**
   * Toggle the overlay on/off. The overlay is enabled by default in every
   * chess-board tab — callers should rarely need this. We keep the method so
   * tests / future tabs without a board can opt out.
   */
  enable(on) {
    this.enabled = !!on;
    if (!on) {
      this.selectedIdx = null;
      this.tool = null;
      this.#closeInlineText();
    }
    this.#refreshPointerEvents();
    this.#syncToolButtons();
    this.render();
  }
  isEnabled() { return this.enabled; }

  /**
   * The overlay only captures clicks while a creation tool is active. Without
   * a tool, the SVG is `pointer-events: none` so left-clicks fall through to
   * the board (so the user can play moves / create variations) and right-clicks
   * are caught by the board-root right-click handler.
   */
  #refreshPointerEvents() {
    const capture = this.enabled && this.tool != null;
    this.svg.style.pointerEvents = capture ? 'auto' : 'none';
  }

  // ============= toolbar =============
  #buildToolbar() {
    this.toolbar.innerHTML = '';

    // Row 1: tool buttons + utilities (undo / redo / clear)
    const tools = document.createElement('div');
    tools.className = 'draw-tools';
    for (const t of TOOLS) {
      const label = i18n.t('commentator.drawTools.' + t.key);
      const b = document.createElement('button');
      b.className = 'draw-tool';
      b.type = 'button';
      b.dataset.tool = t.id;
      b.title = label;
      b.innerHTML = `<span class="draw-icon">${ICON_SVG[t.id]}</span><span class="draw-label">${label}</span>`;
      b.addEventListener('click', () => this.#toggleTool(t.id));
      tools.appendChild(b);
    }

    const utilGroup = document.createElement('div');
    utilGroup.className = 'draw-utils';

    this._undoBtn = this.#mkUtil(ICON_SVG.undo, i18n.t('commentator.drawTools.undo'),
      () => this.#undo());
    this._redoBtn = this.#mkUtil(ICON_SVG.redo, i18n.t('commentator.drawTools.redo'),
      () => this.#redo());
    const clearBtn = this.#mkUtil(ICON_SVG.trash, i18n.t('commentator.drawTools.clearAll'),
      () => this.#clearAll(), 'draw-iconbtn-warn');

    utilGroup.appendChild(this._undoBtn);
    utilGroup.appendChild(this._redoBtn);
    utilGroup.appendChild(clearBtn);

    tools.appendChild(utilGroup);
    this.toolbar.appendChild(tools);

    // Row 2: colors + stroke
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
    stroke.title = i18n.t('commentator.drawTools.strokeWidth');
    stroke.addEventListener('input', (e) => {
      this.stroke = parseFloat(e.target.value);
      if (this.selectedIdx != null) this.#updateSelected(s => { s.stroke = this.stroke; });
    });
    styleRow.appendChild(stroke);

    this.toolbar.appendChild(styleRow);

    this.#syncToolButtons();
    this.#setColor(this.color);
    this.#updateUndoRedoButtons();
  }

  #mkUtil(svg, title, onClick, extraCls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'draw-iconbtn' + (extraCls ? ' ' + extraCls : '');
    b.title = title;
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  }

  #toggleTool(id) {
    this.tool = (this.tool === id) ? null : id;
    this.selectedIdx = null;
    this.#closeInlineText();
    this.#syncToolButtons();
    this.#refreshPointerEvents();
    this.render();
  }

  #syncToolButtons() {
    for (const b of this.toolbar.querySelectorAll('.draw-tool')) {
      b.classList.toggle('active', b.dataset.tool === this.tool);
    }
    // Reflect the tool on <body> so cursor styling can switch via CSS.
    for (const c of [...document.body.classList]) {
      if (c.startsWith('draw-tool-')) document.body.classList.remove(c);
    }
    if (this.tool) document.body.classList.add('draw-tool-' + this.tool);
  }

  #setColor(hex) {
    this.color = hex;
    for (const b of this.toolbar.querySelectorAll('.draw-swatch')) {
      b.classList.toggle('active', b.dataset.color === hex);
    }
    if (this.selectedIdx != null) this.#updateSelected(s => { s.color = hex; });
  }

  #canUndo() {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      return !!(cur && this.commentatorState.canUndoDrawings(cur.id));
    }
    return this._localHistory.length > 0;
  }
  #canRedo() {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      return !!(cur && this.commentatorState.canRedoDrawings(cur.id));
    }
    return this._localFuture.length > 0;
  }
  #updateUndoRedoButtons() {
    if (!this._undoBtn) return;
    this._undoBtn.disabled = !this.#canUndo();
    this._redoBtn.disabled = !this.#canRedo();
  }

  #undo() {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      if (cur) this.commentatorState.undoDrawings(cur.id);
    } else {
      if (!this._localHistory.length) return;
      this._localFuture.push(this._localDrawings.slice());
      this._localDrawings = this._localHistory.pop();
      this.#afterLocalChange();
    }
    this.selectedIdx = null;
  }
  #redo() {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      if (cur) this.commentatorState.redoDrawings(cur.id);
    } else {
      if (!this._localFuture.length) return;
      this._localHistory.push(this._localDrawings.slice());
      this._localDrawings = this._localFuture.pop();
      this.#afterLocalChange();
    }
    this.selectedIdx = null;
  }

  /**
   * Replace the active drawings array. Routes to commentatorState (which
   * persists + emits its own change event) when a match is loaded, otherwise
   * keeps the change in the in-memory ephemeral store with its own undo stack.
   */
  #writeDrawings(drawings) {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      if (cur) this.commentatorState.setDrawings(cur.id, drawings);
      return;
    }
    this._localHistory.push(this._localDrawings.map(deepCloneShape));
    if (this._localHistory.length > 30) this._localHistory.shift();
    this._localFuture = [];
    this._localDrawings = drawings;
    this.#afterLocalChange();
  }

  #afterLocalChange() {
    this.#updateUndoRedoButtons();
    this.render();
  }

  // ============= toolbar pointer (Pen / Text / Rect) =============
  #wireToolbarPointer() {
    this.svg.addEventListener('pointerdown', (e) => this.#onToolDown(e));
    this.svg.addEventListener('pointermove', (e) => this.#onToolMove(e));
    window.addEventListener('pointerup',     (e) => this.#onToolUp(e));
    window.addEventListener('pointermove',   (e) => { if (this.drag) this.#onToolMove(e); });
    // Double-click on a text shape with no tool active → reopen its inline editor.
    this.svg.addEventListener('dblclick', (e) => {
      if (!this.enabled) return;
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
    const y = ((e.clientY - rect.top)  / rect.height) * 8;
    return [clamp(x, -0.5, 8.5), clamp(y, -0.5, 8.5)];
  }

  #onToolDown(e) {
    if (!this.enabled || !this.tool) return;
    if (this.gameState.mode === MODE_IDS.COMMENTATOR && !this.commentatorState.hasMatch()) return;
    if (e.button !== 0) return;   // left click only here; right-click goes to the board handler

    const pt = this.#pointToBoard(e);

    // Check if user grabbed a resize/rotate handle (for an existing selected shape)
    const handle = e.target.closest('[data-handle]');
    if (handle && this.selectedIdx != null) {
      const kind = handle.dataset.handle;
      this.drag = { type: kind === 'rot' ? 'rotate' : 'resize', corner: kind, origin: pt };
      this.drag.startShape = JSON.parse(JSON.stringify(this.#selected()));
      this.svg.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
      return;
    }

    // Click on an existing shape with a tool active → select it (so handles appear)
    const hit = this.#hitTest(e.target);
    if (hit != null) {
      this.selectedIdx = hit;
      const startShape = JSON.parse(JSON.stringify(this.#selected()));
      this.drag = { type: 'move', origin: pt, startShape };
      this.render();
      this.svg.setPointerCapture?.(e.pointerId);
      return;
    }

    // Otherwise: tool-specific creation
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
    if (this.tool === 'rect') {
      this.drag = { type: 'create', shape: {
        kind: 'rect', color: this.color, stroke: this.stroke,
        points: [pt, pt], rotation: 0
      }};
      this.#drawPreview(this.drag.shape);
      this.svg.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
  }

  #onToolMove(e) {
    if (!this.drag) return;
    const pt = this.#pointToBoard(e);
    if (this.drag.type === 'pen') {
      this.drag.shape.points.push(pt);
      this.#drawPreview(this.drag.shape);
    } else if (this.drag.type === 'create') {
      this.drag.shape.points[1] = pt;
      this.#drawPreview(this.drag.shape);
    } else if (this.drag.type === 'move') {
      const [dx, dy] = [pt[0] - this.drag.origin[0], pt[1] - this.drag.origin[1]];
      this.#updateSelected(s => {
        s.points = this.drag.startShape.points.map(([x, y]) => [x + dx, y + dy]);
      });
    } else if (this.drag.type === 'resize') {
      this.#applyResize(pt);
    } else if (this.drag.type === 'rotate') {
      this.#applyRotate(pt);
    }
  }

  #onToolUp() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.type === 'pen') {
      this.#clearPreview();
      if (d.shape.points.length > 1) this.#addShape(d.shape);
      return;
    }
    if (d.type === 'create') {
      this.#clearPreview();
      const [[x1, y1], [x2, y2]] = d.shape.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 0.1) return;
      this.#addShape(d.shape);
      return;
    }
    this.render();
  }

  // ============= board right-click + long-press =============
  #wireBoardRightClick() {
    if (!this.boardRoot) return;

    // Don't show the browser's context menu on the board.
    this.boardRoot.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });

    this.boardRoot.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      // No board to annotate in commentator before a match is loaded.
      if (this.gameState.mode === MODE_IDS.COMMENTATOR && !this.commentatorState.hasMatch()) return;
      if (this.tool) return;        // toolbar tool active → toolbar handles input

      // Right-button mouse click, OR touch with long-press
      if (e.button === 2) {
        this.#beginRightDrag(e);
        e.preventDefault();
      } else if (e.pointerType === 'touch' && e.isPrimary) {
        this.#armLongPress(e);
      }
    });

    this.boardRoot.addEventListener('pointermove', (e) => this.#onBoardMove(e));
    window.addEventListener('pointerup',           (e) => this.#onBoardUp(e));
    window.addEventListener('pointercancel',       () => this.#cancelLongPress());
  }

  #armLongPress(e) {
    this.#cancelLongPress();
    const pt = this.#pointToBoard(e);
    const px = e.clientX, py = e.clientY;
    this._touchPress = {
      pointerId: e.pointerId,
      startPt: pt,
      startScreen: [px, py],
      timer: setTimeout(() => {
        // Convert into a right-drag on long-press
        this._touchPress.armed = true;
        this.boardRoot.classList.add('cm-annot-armed');
        this.#beginRightDrag(e, pt);
      }, LONG_PRESS_MS)
    };
  }
  #cancelLongPress() {
    if (!this._touchPress) return;
    clearTimeout(this._touchPress.timer);
    this.boardRoot.classList.remove('cm-annot-armed');
    this._touchPress = null;
  }

  #beginRightDrag(e, ptOverride) {
    const pt = ptOverride || this.#pointToBoard(e);
    const sq = this.#squareAt(pt);
    const color = this.#colorForEvent(e);
    // If the user pressed on an existing shape, mark it for deletion on up
    const hitIdx = this.#hitTestAtPoint(pt);
    this._rcDrag = {
      pointerId: e.pointerId,
      startPt: pt,
      startSq: sq,
      lastPt: pt,
      color,
      hitIdx,
      isDrag: false
    };
  }

  #onBoardMove(e) {
    if (this._touchPress && !this._touchPress.armed) {
      // If the touch moves too far before the long-press timer fires, cancel.
      const [sx, sy] = this._touchPress.startScreen;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) this.#cancelLongPress();
    }
    if (!this._rcDrag) return;
    const pt = this.#pointToBoard(e);
    this._rcDrag.lastPt = pt;
    if (!this._rcDrag.isDrag) {
      const [sx, sy] = this._rcDrag.startPt;
      if (Math.hypot(pt[0] - sx, pt[1] - sy) >= DRAG_THRESHOLD) this._rcDrag.isDrag = true;
    }
    if (this._rcDrag.isDrag) {
      // Live preview of the arrow we're about to drop
      const fromSq = this._rcDrag.startSq;
      const toSq = this.#squareAt(pt);
      const points = this.#arrowGeometry(fromSq, toSq) ||
        [this.#squareCenter(fromSq) || this._rcDrag.startPt,
         this.#squareCenter(toSq)   || pt];
      const prev = {
        kind: 'arrow',
        color: this._rcDrag.color,
        stroke: RIGHT_CLICK_ARROW_STROKE,
        points,
        rotation: 0
      };
      this.#drawPreview(prev);
    }
  }

  #onBoardUp(e) {
    this.#cancelLongPress();
    if (!this._rcDrag) return;
    const d = this._rcDrag;
    this._rcDrag = null;
    this.boardRoot.classList.remove('cm-annot-armed');
    this.#clearPreview();

    if (d.isDrag) {
      const fromSq = d.startSq;
      const toSq   = this.#squareAt(d.lastPt);
      if (!fromSq || !toSq || sameSq(fromSq, toSq)) return;
      const points = this.#arrowGeometry(fromSq, toSq) ||
        [this.#squareCenter(fromSq), this.#squareCenter(toSq)];
      this.#addShape({
        kind: 'arrow', color: d.color, stroke: RIGHT_CLICK_ARROW_STROKE,
        points, rotation: 0
      });
      return;
    }

    // Single click: shape under cursor → delete; else → toggle highlight on the square
    if (d.hitIdx != null) {
      this.#deleteAt(d.hitIdx);
      return;
    }
    if (!d.startSq) return;
    this.#toggleSquareHighlight(d.startSq, d.color);
  }

  #colorForEvent(e) {
    if (e.shiftKey)              return MOD_COLOR.shift;
    if (e.altKey)                return MOD_COLOR.alt;
    if (e.metaKey || e.ctrlKey)  return MOD_COLOR.meta;
    return MOD_COLOR.plain;
  }

  /** Map a board-units point to a board square `[r, c]` (orientation-aware). */
  #squareAt([x, y]) {
    if (x < 0 || x > 8 || y < 0 || y > 8) return null;
    const vc = Math.floor(x);
    const vr = Math.floor(y);
    if (vc < 0 || vc > 7 || vr < 0 || vr > 7) return null;
    const orient = this.gameState.orientation;
    return orient === 'w' ? [vr, vc] : [7 - vr, 7 - vc];
  }
  /** Map [r, c] (board coords) to the center of that square in board-units. */
  #squareCenter(sq) {
    if (!sq) return null;
    const [r, c] = sq;
    const orient = this.gameState.orientation;
    const vr = orient === 'w' ? r : 7 - r;
    const vc = orient === 'w' ? c : 7 - c;
    return [vc + 0.5, vr + 0.5];
  }

  /**
   * Points list for an arrow between two squares.
   *   • knight-shaped displacement → 3 points with an L-bend (longer leg first)
   *   • everything else            → straight 2-point arrow
   * Returns null if either square is missing.
   */
  #arrowGeometry(fromSq, toSq) {
    if (!fromSq || !toSq) return null;
    const dr = Math.abs(toSq[0] - fromSq[0]);
    const dc = Math.abs(toSq[1] - fromSq[1]);
    const isKnight = (dr === 1 && dc === 2) || (dr === 2 && dc === 1);
    if (!isKnight) {
      return [this.#squareCenter(fromSq), this.#squareCenter(toSq)];
    }
    // Longer leg goes first — gives the canonical chess "L" reading direction.
    const cornerSq = dr > dc
      ? [toSq[0],   fromSq[1]]
      : [fromSq[0], toSq[1]];
    return [
      this.#squareCenter(fromSq),
      this.#squareCenter(cornerSq),
      this.#squareCenter(toSq)
    ];
  }

  /**
   * Square highlights are stored as `{ kind: 'square', sq: [r, c], color, stroke }`
   * (sq in board coords, not orientation-flipped).
   */
  #toggleSquareHighlight(sq, color) {
    const drawings = this.#currentDrawings().slice();
    const idx = drawings.findIndex(s => s.kind === 'square' && s.sq && s.sq[0] === sq[0] && s.sq[1] === sq[1] && s.color === color);
    if (idx >= 0) {
      drawings.splice(idx, 1);
    } else {
      drawings.push({ kind: 'square', sq, color, stroke: this.stroke });
    }
    this.#writeDrawings(drawings);
  }

  /** Find the shape whose hit region contains the given board point, or null. */
  #hitTestAtPoint([x, y]) {
    const drawings = this.#currentDrawings();
    for (let i = drawings.length - 1; i >= 0; i--) {
      const s = drawings[i];
      if (this.#shapeContainsPoint(s, [x, y])) return i;
    }
    return null;
  }

  #shapeContainsPoint(s, [px, py]) {
    if (s.kind === 'square') {
      const [vr, vc] = this.#viewSquare(s.sq);
      if (vr == null) return false;
      return px >= vc && px <= vc + 1 && py >= vr && py >= vr && py <= vr + 1;
    }
    if (s.kind === 'pen' || s.kind === 'arrow' || s.kind === 'line') {
      // Segment-distance test; loose threshold so it's easy to hit.
      const pts = s.points;
      const r = Math.max(0.18, s.stroke * 2);
      for (let i = 0; i < pts.length - 1; i++) {
        if (distPointSeg([px, py], pts[i], pts[i + 1]) < r) return true;
      }
      return false;
    }
    if (s.kind === 'rect' || s.kind === 'circle' || s.kind === 'text') {
      const box = this.#shapeBoundingBox(s);
      return px >= box.x - 0.05 && px <= box.x + box.w + 0.05
          && py >= box.y - 0.05 && py <= box.y + box.h + 0.05;
    }
    return false;
  }

  /**
   * Bounding box for a shape. Text shapes only carry a single anchor point so
   * `boundingBox(points)` would be near-zero; we synthesize a virtual box from
   * the rendered font-size and text length so rotate/resize handles land on
   * the actual glyph extent.
   */
  #shapeBoundingBox(s) {
    if (s.kind !== 'text') return boundingBox(s.points);
    const [[x, y]] = s.points;
    const fontSize = Math.max(0.35, (s.stroke || 0.08) * 5);
    const len = Math.max(1, (s.text || '').length);
    const w = Math.max(0.5, len * fontSize * 0.55);   // approximate em-width for Fraunces
    const h = fontSize * 1.1;
    return { x: x - w / 2, y: y - h / 2, w, h };
  }

  #viewSquare(sq) {
    if (!sq) return [null, null];
    const orient = this.gameState.orientation;
    return orient === 'w' ? sq : [7 - sq[0], 7 - sq[1]];
  }

  // ============= inline text editor =============
  #startInlineText(e, [bx, by], replaceIdx = null, initialText = '') {
    this.#closeInlineText();
    const holder = this.svg.parentElement;
    const holderRect = holder.getBoundingClientRect();
    const px = e.clientX - holderRect.left;
    const py = e.clientY - holderRect.top;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'draw-text-editor';
    input.value = initialText;
    input.placeholder = i18n.t('ui.placeholder.drawText');
    input.style.left = px + 'px';
    input.style.top  = py + 'px';
    input.style.color = this.color;
    input.style.borderColor = this.color;
    holder.appendChild(input);
    this._textEditor = input;

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
        // One-shot: drop the text tool after committing so a stray click on the
        // board doesn't immediately spawn another editor.
        if (this.tool === 'text') this.#toggleTool('text');
      }
    };

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter')        { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape')  { ev.preventDefault(); cleanup(); }
    });
    input.addEventListener('blur', () => setTimeout(commit, 0));
  }
  #closeInlineText() {
    if (this._textEditor) { this._textEditor.remove(); this._textEditor = null; }
  }

  // ============= shape mutations =============
  #updateAt(idx, mutator) {
    const drawings = this.#currentDrawings().slice();
    if (!drawings[idx]) return;
    const s = deepCloneShape(drawings[idx]);
    mutator(s);
    drawings[idx] = s;
    this.#writeDrawings(drawings);
  }

  #addShape(shape) {
    const drawings = this.#currentDrawings().slice();
    drawings.push(shape);
    this.#writeDrawings(drawings);
  }
  #deleteAt(idx) {
    const drawings = this.#currentDrawings().slice();
    drawings.splice(idx, 1);
    this.#writeDrawings(drawings);
    if (this.selectedIdx === idx) this.selectedIdx = null;
    else if (this.selectedIdx > idx) this.selectedIdx--;
  }
  #deleteSelected() { if (this.selectedIdx != null) this.#deleteAt(this.selectedIdx); }
  #clearAll() {
    if (!this.#currentDrawings().length) return;
    this.selectedIdx = null;
    this.#writeDrawings([]);
  }
  #updateSelected(mutator) {
    if (this.selectedIdx == null) return;
    const drawings = this.#currentDrawings().slice();
    if (!drawings[this.selectedIdx]) return;
    const s = deepCloneShape(drawings[this.selectedIdx]);
    mutator(s);
    drawings[this.selectedIdx] = s;
    this.#writeDrawings(drawings);
  }
  #selected() {
    if (this.selectedIdx == null) return null;
    return this.#currentDrawings()[this.selectedIdx] || null;
  }
  #currentDrawings() {
    if (this.#useCommentator()) {
      const cur = this.commentatorState.currentNode();
      return (cur && cur.drawings) ? cur.drawings : [];
    }
    return this._localDrawings;
  }

  // ============= resize / rotate =============
  #applyResize(pt) {
    const s = this.drag.startShape;
    const corner = this.drag.corner;
    if (s.kind === 'arrow' || s.kind === 'line') {
      const endIdx = corner === 'end2' ? s.points.length - 1 : 0;
      this.#updateSelected(out => { out.points = s.points.slice(); out.points[endIdx] = pt; });
      return;
    }
    if (s.kind === 'text') {
      // Text scales by changing `stroke` (which drives font-size in #text).
      // We use distance-from-center so any corner handle scales uniformly.
      const box = this.#shapeBoundingBox(s);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const cornerPt = [
        box.x + (corner === 'ne' || corner === 'se' ? box.w : 0),
        box.y + (corner === 'sw' || corner === 'se' ? box.h : 0)
      ];
      const origDist = Math.hypot(cornerPt[0] - cx, cornerPt[1] - cy) || 1;
      const newDist  = Math.hypot(pt[0] - cx, pt[1] - cy);
      const scale = newDist / origDist;
      const newStroke = clamp((s.stroke || 0.08) * scale, 0.04, 0.6);
      this.#updateSelected(out => { out.stroke = newStroke; });
      return;
    }
    const box = boundingBox(s.points);
    let pivot = [0, 0]; let pickCorner = [0, 0];
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
    const origDx = pickCorner[0] - pivot[0], origDy = pickCorner[1] - pivot[1];
    const newDx  = pt[0] - pivot[0],          newDy = pt[1] - pivot[1];
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
    const box = this.#shapeBoundingBox(s);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const origin = this.drag.origin;
    const ang0 = Math.atan2(origin[1] - cy, origin[0] - cx);
    const ang1 = Math.atan2(pt[1] - cy, pt[0] - cx);
    const delta = (ang1 - ang0) * 180 / Math.PI;
    this.#updateSelected(out => { out.rotation = ((s.rotation || 0) + delta + 360) % 360; });
  }

  /** Given a click target, return the shape index it belongs to (DOM-driven). */
  #hitTest(target) {
    const g = target.closest('[data-shape-idx]');
    if (!g) return null;
    return parseInt(g.dataset.shapeIdx, 10);
  }

  // ============= keyboard =============
  #wireKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;

      if (e.key === 'Escape') {
        if (this.tool) { this.#toggleTool(this.tool); return; }
        if (this.selectedIdx != null) { this.selectedIdx = null; this.render(); return; }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedIdx != null) { e.preventDefault(); this.#deleteSelected(); return; }
      }
      // Undo / redo. Only consume the keystroke if we actually have a drawing
      // to roll back — otherwise let it fall through to practice-controller's
      // chess undo so Cmd+Z stays useful when the board is clean.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        const ok = e.shiftKey ? this.#canRedo() : this.#canUndo();
        if (!ok) return;
        e.preventDefault();
        e.stopImmediatePropagation?.();
        if (e.shiftKey) this.#redo(); else this.#undo();
        return;
      }
      // Tool shortcuts (skipped while typing in an input — guarded above).
      if (!mod) {
        if (e.key === 'p' || e.key === 'P') { e.preventDefault(); this.#toggleTool('pen'); }
        else if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.#toggleTool('text'); }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.#toggleTool('rect'); }
      }
    });
  }

  // ============= rendering =============
  render() {
    for (const child of [...this.svg.children]) {
      if (child.id !== 'draw-preview') child.remove();
    }
    if (!this.enabled) { this.svg.hidden = true; return; }
    // In commentator mode there's nothing to draw on until a match is loaded.
    if (this.gameState.mode === MODE_IDS.COMMENTATOR && !this.commentatorState.hasMatch()) {
      this.svg.hidden = true;
      return;
    }
    this.svg.hidden = false;

    // Selection chrome only when a tool is active and a shape is selected.
    const showChrome = this.tool != null;

    const drawings = this.#currentDrawings();
    drawings.forEach((d, idx) => {
      const g = this.#shapeGroup(d, showChrome && idx === this.selectedIdx);
      if (!g) return;
      g.setAttribute('data-shape-idx', idx);
      this.svg.insertBefore(g, this.#previewGroup());
    });

    if (showChrome && this.selectedIdx != null && drawings[this.selectedIdx]) {
      const sel = drawings[this.selectedIdx];
      // Square highlights aren't resizable
      if (sel.kind !== 'square') {
        const h = this.#handlesFor(sel);
        if (h) this.svg.insertBefore(h, this.#previewGroup());
      }
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

  #shapeGroup(shape, selected) {
    const body = this.#shapeBody(shape);
    if (!body) return null;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'draw-shape-g' + (selected ? ' selected' : ''));
    const rot = shape.rotation || 0;
    if (rot && shape.kind !== 'square') {
      const box = this.#shapeBoundingBox(shape);
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
    }
    g.appendChild(body);
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
      case 'square': return this.#square(s);
    }
    return null;
  }

  #hitTarget(s) {
    if (s.kind === 'square') {
      const [vr, vc] = this.#viewSquare(s.sq);
      if (vr == null) return null;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', vc); r.setAttribute('y', vr);
      r.setAttribute('width', 1); r.setAttribute('height', 1);
      r.setAttribute('fill', 'transparent');
      r.setAttribute('class', 'draw-hit');
      return r;
    }
    if (s.kind === 'text') {
      // Text shapes only carry one anchor point — synthesize a hit rect over
      // the rendered glyph so a single click can select / move the text.
      const box = this.#shapeBoundingBox(s);
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', box.x); r.setAttribute('y', box.y);
      r.setAttribute('width', box.w); r.setAttribute('height', box.h);
      r.setAttribute('fill', 'transparent');
      r.setAttribute('class', 'draw-hit');
      return r;
    }
    const box = this.#shapeBoundingBox(s);
    if (s.kind === 'pen') {
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

  // ============= shape primitives =============
  #arrow(s) {
    const g = document.createElementNS(SVG_NS, 'g');
    const pts = s.points;
    if (!pts || pts.length < 2) return g;

    // Last segment carries the arrowhead direction.
    const [px1, py1] = pts[pts.length - 2];
    const [px2, py2] = pts[pts.length - 1];
    const dx = px2 - px1, dy = py2 - py1;
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.min(0.4, len * 0.3);
    const ex = px2 - (dx / len) * head;
    const ey = py2 - (dy / len) * head;

    // Truncate the last point of the path so the shaft stops where the head starts.
    const shaftPts = pts.slice(0, -1).concat([[ex, ey]]);
    const d = 'M ' + shaftPts.map(p => p.join(' ')).join(' L ');

    // Subtle dark underlay so the arrow stands out on both light and dark squares.
    const outline = document.createElementNS(SVG_NS, 'path');
    outline.setAttribute('d', d);
    outline.setAttribute('stroke', 'rgba(0,0,0,0.35)');
    outline.setAttribute('stroke-width', s.stroke + 0.04);
    outline.setAttribute('stroke-linecap', 'round');
    outline.setAttribute('stroke-linejoin', 'round');
    outline.setAttribute('fill', 'none');
    g.appendChild(outline);

    const shaft = document.createElementNS(SVG_NS, 'path');
    shaft.setAttribute('d', d);
    shaft.setAttribute('stroke', s.color);
    shaft.setAttribute('stroke-width', s.stroke);
    shaft.setAttribute('stroke-linecap', 'round');
    shaft.setAttribute('stroke-linejoin', 'round');
    shaft.setAttribute('fill', 'none');
    g.appendChild(shaft);

    const nx = -dy / len, ny = dx / len;
    const w = head * 0.55;
    const tip = document.createElementNS(SVG_NS, 'polygon');
    tip.setAttribute('points', `${px2},${py2} ${ex + nx * w},${ey + ny * w} ${ex - nx * w},${ey - ny * w}`);
    tip.setAttribute('fill', s.color);
    tip.setAttribute('stroke', 'rgba(0,0,0,0.35)');
    tip.setAttribute('stroke-width', 0.025);
    tip.setAttribute('stroke-linejoin', 'round');
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
  /** Square highlight — a translucent fill in the chosen color, with a soft border. */
  #square(s) {
    const [vr, vc] = this.#viewSquare(s.sq);
    if (vr == null) return null;
    const g = document.createElementNS(SVG_NS, 'g');
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', vc + 0.05); r.setAttribute('y', vr + 0.05);
    r.setAttribute('width', 0.9); r.setAttribute('height', 0.9);
    r.setAttribute('rx', 0.08);
    r.setAttribute('fill', s.color);
    r.setAttribute('fill-opacity', '0.32');
    r.setAttribute('stroke', s.color);
    r.setAttribute('stroke-opacity', '0.85');
    r.setAttribute('stroke-width', 0.04);
    g.appendChild(r);
    return g;
  }

  // ============= selection chrome =============
  #handlesFor(shape) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'draw-handles');
    const rot = shape.rotation || 0;
    const box = this.#shapeBoundingBox(shape);
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
    const outline = document.createElementNS(SVG_NS, 'rect');
    outline.setAttribute('x', box.x - 0.05); outline.setAttribute('y', box.y - 0.05);
    outline.setAttribute('width',  box.w + 0.1); outline.setAttribute('height', box.h + 0.1);
    outline.setAttribute('class', 'draw-outline');
    g.appendChild(outline);
    if (shape.kind === 'arrow' || shape.kind === 'line') {
      const last = shape.points[shape.points.length - 1];
      addHandle(shape.points[0][0], shape.points[0][1], 'end1', 'end');
      addHandle(last[0], last[1], 'end2', 'end');
    } else if (shape.kind !== 'pen' && shape.kind !== 'text') {
      addHandle(box.x,         box.y,          'nw');
      addHandle(box.x + box.w, box.y,          'ne');
      addHandle(box.x,         box.y + box.h,  'sw');
      addHandle(box.x + box.w, box.y + box.h,  'se');
      addHandle(box.x + box.w / 2, box.y,          'n', 'edge');
      addHandle(box.x + box.w / 2, box.y + box.h,  's', 'edge');
      addHandle(box.x,             box.y + box.h / 2, 'w', 'edge');
      addHandle(box.x + box.w,     box.y + box.h / 2, 'e', 'edge');
    } else if (shape.kind === 'text') {
      addHandle(box.x,         box.y,          'nw');
      addHandle(box.x + box.w, box.y,          'ne');
      addHandle(box.x,         box.y + box.h,  'sw');
      addHandle(box.x + box.w, box.y + box.h,  'se');
    }
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

// ============= helpers =============
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
function sameSq(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
function distPointSeg(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}
function deepCloneShape(s) { return JSON.parse(JSON.stringify(s)); }
