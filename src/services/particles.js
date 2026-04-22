/**
 * Tiny canvas confetti layer. No dependencies. Runs rAF only while particles
 * are alive, so it's idle when no celebration is happening.
 */
const DEFAULT_COLORS = ['#b88a3d', '#3b7a55', '#c25a3c', '#2f4a6b', '#fbf6e8'];

export class ParticleService {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.#resize();
    window.addEventListener('resize', () => this.#resize());
  }

  #resize() {
    this.canvas.width = innerWidth * devicePixelRatio;
    this.canvas.height = innerHeight * devicePixelRatio;
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  /** Spawn a burst at (x, y) in screen coordinates. */
  spawn(x, y, { count = 24, colors = DEFAULT_COLORS } = {}) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 10 - 2,
        g: 0.35,
        size: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 60 + Math.random() * 40,
        rot: Math.random() * 6, vrot: (Math.random() - 0.5) * 0.3
      });
    }
    if (this.particles.length === count) requestAnimationFrame(() => this.#tick());
  }

  spawnFromRect(rect, opts = {}) {
    this.spawn(rect.left + rect.width / 2, rect.top + rect.height / 2, opts);
  }

  fireworks() {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const x = cx + (Math.random() - 0.5) * innerWidth * 0.5;
        const y = cy + (Math.random() - 0.5) * innerHeight * 0.3;
        this.spawn(x, y, { count: 40 });
      }, i * 220);
    }
  }

  #tick() {
    const { ctx, canvas, particles } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.particles = particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.life--;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / 100);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.8);
      ctx.restore();
    }
    if (this.particles.length) requestAnimationFrame(() => this.#tick());
  }
}
