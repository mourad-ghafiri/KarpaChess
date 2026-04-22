/** Corner notifications. Subscribes to `toast` events on the bus. */
import { EVENTS } from '../core/constants.js';

export class ToastService {
  constructor(container, bus) {
    this.container = container;
    bus.on(EVENTS.TOAST, ({ message, kind = 'info', ms = 2600 }) => this.#show(message, kind, ms));
  }

  #show(message, kind, ms) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    this.container.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove());
    }, ms);
  }
}
