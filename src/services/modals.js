/**
 * Unified modal manager. Every modal in the app goes through this:
 *   - `open(id, { onOpen })`    idempotent; guards against double-open
 *   - `close(id)`                idempotent; waits for transition, then hides
 *   - `closeTop()` / `isOpen(id)`
 *
 * Modals must use `hidden` for off-state and a `.is-open` class for on-state
 * (the CSS drives the animation from `.is-open` only, so transitions play
 * exactly once per explicit open).
 */
export class ModalManager {
  constructor() {
    this.stack = [];
  }

  isOpen(id) { return this.stack.includes(id); }

  open(id, { onOpen } = {}) {
    const modal = document.getElementById(id);
    if (!modal) return false;
    if (this.stack.includes(id)) return false;          // idempotent

    this.stack.push(id);
    document.body.classList.add('modal-open');

    modal.hidden = false;
    void modal.offsetWidth;                             // reflow
    requestAnimationFrame(() => {
      if (!this.stack.includes(id)) return;             // rapid open→close guard
      modal.classList.add('is-open');
    });

    if (onOpen) { try { onOpen(modal); } catch (err) { console.error(err); } }
    return true;
  }

  close(id) {
    const modal = document.getElementById(id);
    if (!modal) return false;
    const idx = this.stack.indexOf(id);
    if (idx === -1) return false;

    this.stack.splice(idx, 1);
    modal.classList.remove('is-open');
    if (this.stack.length === 0) document.body.classList.remove('modal-open');

    const hideIfStillClosed = () => {
      if (!this.stack.includes(id)) modal.hidden = true;
    };
    let safety;
    const onEnd = (ev) => {
      if (ev.target !== modal) return;
      modal.removeEventListener('transitionend', onEnd);
      clearTimeout(safety);
      hideIfStillClosed();
    };
    modal.addEventListener('transitionend', onEnd);
    safety = setTimeout(() => {
      modal.removeEventListener('transitionend', onEnd);
      hideIfStillClosed();
    }, 360);

    return true;
  }

  closeTop() {
    if (this.stack.length === 0) return false;
    return this.close(this.stack[this.stack.length - 1]);
  }
}
