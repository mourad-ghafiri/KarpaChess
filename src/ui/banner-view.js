/**
 * Game-end banner. Shows result + icon, plus Review / New Game actions.
 * Idempotent: if already shown for this game, won't re-trigger.
 */
export class BannerView {
  constructor({ rootEl, iconEl, titleEl, subEl, reviewBtn, newBtn, closeBtn }, onReview, onNewGame) {
    this.rootEl = rootEl;
    this.iconEl = iconEl;
    this.titleEl = titleEl;
    this.subEl = subEl;
    reviewBtn.addEventListener('click', onReview);
    newBtn.addEventListener('click', onNewGame);
    closeBtn.addEventListener('click', () => this.hide());
  }

  show({ icon, title, sub }) {
    if (!this.rootEl.hidden) return false;   // idempotent
    this.iconEl.textContent = icon;
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.rootEl.hidden = false;
    return true;
  }

  hide() { this.rootEl.hidden = true; }
}
