// The win celebration behind the result panel: party poppers firing from both bottom corners
// once, then fireworks bursting near the top until stopped.
const COLOURS = ['#ffd95a', '#ff7aa2', '#6fc3ff', '#4be3a4', '#ffffff', '#ffae1f'];
const pick = () => COLOURS[Math.floor(Math.random() * COLOURS.length)];

export class Fireworks {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.raf = 0;
  }

  start() {
    this.stop();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canvas.hidden = false;
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.k = Math.min(this.w, 480) / 360; // sizes follow a phone-sized screen
    this.canvas.width = this.w * d;
    this.canvas.height = this.h * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.parts = [];
    this.popper(true);
    this.popper(false);
    this.next = 0.35;
    if (still) {
      for (let i = 0; i < 3; i++) this.burst(this.w * (0.25 + i * 0.25), this.h * 0.14);
      this.draw(true);
      return;
    }
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.next -= dt;
      if (this.next <= 0) {
        this.burst(this.w * (0.15 + Math.random() * 0.7), this.h * (0.07 + Math.random() * 0.17));
        this.next = 0.55 + Math.random() * 0.5;
      }
      this.draw(false);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.parts = [];
    this.canvas.hidden = true;
  }

  // A round firework: sparks in two colours flying out and falling.
  burst(x, y) {
    const c = pick(), c2 = pick(), n = 46, k = this.k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = (2.2 + Math.random() * 1.6) * k;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.012 + Math.random() * 0.01, c: i % 3 ? c : c2, r: 1.6 * k, g: 0.035 * k });
    }
  }

  // A party popper from a bottom corner: paper ribbons shot up and inwards.
  popper(left) {
    const k = this.k;
    for (let i = 0; i < 70; i++) {
      const a = ((left ? -62 : -118) * Math.PI) / 180 + (Math.random() - 0.5) * 0.7, v = (6 + Math.random() * 6) * k;
      this.parts.push({
        x: left ? 6 * k : this.w - 6 * k, y: this.h - 90 * k, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 1, decay: 0.006 + Math.random() * 0.006, c: pick(), r: (2 + Math.random() * 2.4) * k, g: 0.16 * k,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, ribbon: true,
      });
    }
  }

  draw(still) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const p of this.parts) {
      if (!still) {
        const drag = p.ribbon ? 0.985 : 0.97;
        p.vx *= drag;
        p.vy = p.vy * drag + p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.ribbon) p.rot += p.vr;
      }
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.fillStyle = p.c;
      if (p.ribbon) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9 * Math.abs(Math.cos(p.rot * 2)) + 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + p.life * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < this.h + 40);
  }
}
