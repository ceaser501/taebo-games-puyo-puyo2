// Draws a match. Everything is laid out on the original 640x480 screen (fields of 6x12 cells of
// 32 px at (32, 32) and (416, 32)) and scaled to the window at full device resolution, so lines
// and puyos stay smooth at any size.
//
// Two looks: 'modern' draws the puyos as glossy vector blobs on glass panels over a soft-focus
// stage; 'classic' uses the original frame and puyo pictures (the 4x Scale2x copies, drawn
// smoothed). Text, warnings and effects are the same for both.
import { W, H, ROT, GARBAGE, DEATH_X } from './board.js';

export const SCREEN = { w: 640, h: 480 };
export const CELL = 32;
export const FIELDS = [{ x: 32, y: 32 }, { x: 416, y: 32 }];
const FIELD_W = W * CELL, FIELD_H = (H - 1) * CELL;

// Where things go. Fields are drawn at FIELDS and moved/scaled to `fields`. 'wide' is the
// original screen; 'tall' (phones held upright) gives the player's own field the full width
// and shows the other one small beside it.
function layout(tall, me) {
  if (!tall) {
    return {
      screen: SCREEN,
      fields: [{ x: 32, y: 32, s: 1 }, { x: 416, y: 32, s: 1 }],
      next: [{ x: 232, y: 32 }, { x: 328, y: 32 }],
      face: [{ x: 232, y: 172 }, { x: 328, y: 172 }],
      figure: [{ x: 272, y: 448 }, { x: 368, y: 448 }],
    };
  }
  // Upright: the status bar on top (time, scores, chains), my field, and NEXT and the other
  // field in the column beside it. The touch buttons take the rest of the screen below.
  const o = 1 - me;
  const L = { screen: { w: 360, h: 490 }, hud: true, fields: [], next: [], face: [null, null], figure: [null, null] };
  L.fields[me] = { x: 20, y: 84, s: 1 };
  L.fields[o] = { x: 246, y: 252, s: 0.54 };
  L.next[me] = { x: 242, y: 60 };
  L.next[o] = null;
  return L;
}

const MIN_CONTROLS = 190; // CSS pixels kept for the touch buttons on an upright phone
const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", system-ui, sans-serif';

// Body colours: [light, base, dark].
const COLOURS = {
  1: ['#ffb3bf', '#ff3d5a', '#a3102a'],
  2: ['#b6f7c6', '#2fd16a', '#0d7f37'],
  3: ['#b5d6ff', '#3d8bff', '#1648b0'],
  4: ['#fff3a8', '#ffc61f', '#c27f00'],
  5: ['#e6c2ff', '#b057ff', '#6a1fb4'],
  [GARBAGE]: ['#ffffff', '#cfd6e6', '#7d86a0'],
};
const PLAYER_COLOURS = ['#ff5a7a', '#4aa3ff'];

// Nuisance warning icons, biggest first: [puyos, kind].
const WARN = [[720, 'crown'], [360, 'moon'], [180, 'star'], [30, 'rock'], [6, 'big'], [1, 'small']];

// Pieces of the original PUYO_RY sheet (640x240): [x, y, w, h].
const RY = {
  ren: [248, 32, 32, 14], // "연쇄"
  crown: [192, 128, 32, 32], star: [224, 128, 32, 32], rock: [256, 128, 32, 32],
  big: [288, 128, 32, 32], small: [320, 144, 16, 16], moon: [336, 128, 32, 32],
  allClear: [16, 144, 160, 48], // "싹쓸이!"
};
// Two fonts on the same sheet, 16 px wide: big pink (32 high) and white (16 high).
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ :-.';
const FONTS = { big: { y: 0, h: 32 }, white: { y: 208, h: 16 } };
// The left NEXT window on the original frames, with its border.
const NEXT_WINDOW = [232, 56, 80, 144];
// The original frames' lower middle window, where the characters stand.
const STAGE_WINDOW = [240, 224, 160, 176];

const ease = (t) => 1 - (1 - t) ** 3;

export class Renderer {
  constructor(canvas, pictures, manifest) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pictures = pictures;
    this.manifest = manifest;
    this.skin = 'modern';
    this.me = 0; // whose field is the big one on a tall screen
    this.particles = [];
    this.rings = []; // original pop bursts (classic look)
    this.memo = [{}, {}];
    this.sprites = {};
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Loads what a match draws: the stage frame, puyo sheets for the classic look, portraits.
  async prepare({ frame, chars }) {
    const m = this.manifest;
    const [frameImg, ry, ...rest] = await Promise.all([
      this.pictures.load(frame, false),
      this.pictures.load('GRP/PUYO_RY'),
      ...Object.values(m.puyo).map((n) => this.pictures.load(n)),
    ]);
    this.frame = frameImg;
    this.ry = ry;
    this.sheets = {};
    Object.keys(m.puyo).forEach((k, i) => { this.sheets[k] = rest[i]; });
    this.faces = await Promise.all(chars.map((c) => this.pictures.face(c)));
    this.figures = await Promise.all(chars.map((c) => this.pictures.figure(c)));
    this.backdrop = null;
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Upright, the game sits at the top at full width and the touch buttons get everything
    // below it (at least MIN_CONTROLS); on its side, the 4:3 screen is centred and the buttons
    // go in the margins left and right.
    this.tall = h > w * 1.15;
    this.layout = layout(this.tall, this.me);
    const screen = this.layout.screen;
    if (this.tall) {
      const room = this.touch ? MIN_CONTROLS : 0;
      this.scale = Math.min(w / screen.w, (h - room) / screen.h);
      this.ox = (w - screen.w * this.scale) / 2;
      this.oy = this.touch ? 0 : (h - screen.h * this.scale) / 2;
    } else {
      this.scale = Math.min(w / screen.w, h / screen.h);
      this.ox = (w - screen.w * this.scale) / 2;
      this.oy = (h - screen.h * this.scale) / 2;
    }
    this.controls = { tall: this.tall, top: this.oy + screen.h * this.scale, side: this.ox };
    this.onLayout?.(this.controls);
    this.dpr = dpr;
    this.px = this.scale * dpr; // device pixels per screen unit
    this.cellPx = CELL * this.scale * this.layout.fields[this.me].s; // CSS pixels per cell of my field
    this.sprites = {};
    this.backdrop = null;
  }

  // ---- puyo pictures ----------------------------------------------------------------------

  // A modern puyo body with its face, drawn once per colour at the current size.
  sprite(c) {
    const key = c;
    if (this.sprites[key]) return this.sprites[key];
    const s = Math.ceil(CELL * this.px);
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const x = cv.getContext('2d');
    x.scale(s / CELL, s / CELL);
    const [light, base, dark] = COLOURS[c];
    const r = CELL * 0.47, cx = CELL / 2, cy = CELL / 2 + 0.5;
    // Body: a soft ball, lit from the top left.
    const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r);
    g.addColorStop(0, light);
    g.addColorStop(0.45, base);
    g.addColorStop(1, dark);
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.28)';
    x.lineWidth = 1;
    x.stroke();
    // Shine.
    x.fillStyle = 'rgba(255,255,255,0.75)';
    x.beginPath();
    x.ellipse(cx - r * 0.42, cy - r * 0.5, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
    x.fill();
    // Eyes.
    if (c === GARBAGE) {
      x.fillStyle = 'rgba(60,66,90,0.85)';
      for (const ex of [-0.3, 0.3]) { x.beginPath(); x.arc(cx + ex * r, cy - r * 0.05, r * 0.13, 0, Math.PI * 2); x.fill(); }
    } else {
      for (const ex of [-0.32, 0.32]) {
        x.fillStyle = '#fff';
        x.beginPath(); x.ellipse(cx + ex * r, cy - r * 0.02, r * 0.24, r * 0.28, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#1b1530';
        x.beginPath(); x.ellipse(cx + ex * r + r * 0.04, cy + r * 0.06, r * 0.12, r * 0.15, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(cx + ex * r + r * 0.08, cy - r * 0.02, r * 0.045, 0, Math.PI * 2); x.fill();
      }
    }
    this.sprites[key] = cv;
    return cv;
  }

  // Draws one puyo centred at (cx, cy) in screen units. mask: neighbours of the same colour
  // (1 up, 2 left, 4 down, 8 right) for the classic sheets; sx/sy squash; flash 0-1 whitens.
  puyo(ctx, c, cx, cy, { mask = 0, sx = 1, sy = 1, alpha = 1, flash = 0, size = CELL } = {}) {
    const w = size * sx, h = size * sy;
    const x0 = cx - w / 2, y0 = cy + size / 2 - h; // squash from the bottom
    ctx.globalAlpha = alpha;
    if (this.classic && this.sheets) {
      const sheet = c === GARBAGE ? this.sheets.garbage : this.sheets[c];
      if (sheet) {
        const k = 32 * sheet.scale;
        const [col, row] = c === GARBAGE ? [0, 4] : [mask, 0];
        ctx.drawImage(sheet.img, col * k, row * k, k, k, x0, y0, w, h);
      }
    } else {
      ctx.drawImage(this.sprite(c), x0, y0, w, h);
    }
    if (flash > 0) {
      ctx.globalAlpha = alpha * flash;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx, y0 + h / 2, w * 0.47, h * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Same-colour neighbours are joined by a bridge of the body colour (modern look).
  bridges(ctx, grid, fx, fy, skip) {
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y * W + x];
        if (!c || c === GARBAGE || skip.has(y * W + x)) continue;
        const [light, base, dark] = COLOURS[c];
        const cx = fx + x * CELL + CELL / 2, cy = fy + (y - 1) * CELL + CELL / 2;
        const t = CELL * 0.36; // half the bridge's thickness
        if (x + 1 < W && grid[y * W + x + 1] === c && !skip.has(y * W + x + 1)) {
          const g = ctx.createLinearGradient(0, cy - t, 0, cy + t);
          g.addColorStop(0, light); g.addColorStop(0.35, base); g.addColorStop(1, dark);
          ctx.fillStyle = g;
          roundRect(ctx, cx, cy - t, CELL, t * 2, t * 0.6);
          ctx.fill();
        }
        if (y + 1 < H && grid[(y + 1) * W + x] === c && !skip.has((y + 1) * W + x)) {
          const g = ctx.createLinearGradient(cx - t, 0, cx + t, 0);
          g.addColorStop(0, light); g.addColorStop(0.35, base); g.addColorStop(1, dark);
          ctx.fillStyle = g;
          roundRect(ctx, cx - t, cy, t * 2, CELL, t * 0.6);
          ctx.fill();
        }
      }
    }
  }

  maskAt(grid, x, y) {
    const c = grid[y * W + x];
    if (!c || c === GARBAGE) return 0;
    const same = (nx, ny) => nx >= 0 && nx < W && ny >= 1 && ny < H && grid[ny * W + nx] === c;
    return (same(x, y - 1) ? 1 : 0) | (same(x - 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x + 1, y) ? 8 : 0);
  }

  // ---- background -------------------------------------------------------------------------

  drawBackdrop(ctx) {
    if (!this.backdrop) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(SCREEN.w * this.px);
      cv.height = Math.ceil(SCREEN.h * this.px);
      const x = cv.getContext('2d');
      x.scale(this.px, this.px);
      if (this.classic && this.frame) {
        x.imageSmoothingQuality = 'high';
        x.drawImage(this.frame.img, 0, 0, 640, 480, 0, 0, 640, 480);
        // Upright phones: the frame only as a dimmed backdrop; fields bring their own border.
        if (!this.framed) { x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(0, 0, SCREEN.w, SCREEN.h); }
      } else {
        const g = x.createLinearGradient(0, 0, 0, SCREEN.h);
        g.addColorStop(0, '#141a3a');
        g.addColorStop(1, '#2a1240');
        x.fillStyle = g;
        x.fillRect(0, 0, SCREEN.w, SCREEN.h);
        // The stage's own frame, out of focus, for its colours.
        if (this.frame) {
          x.save();
          x.globalAlpha = 0.45;
          x.filter = 'blur(10px) saturate(1.3)';
          x.drawImage(this.frame.img, 0, 0, 640, 480, -20, -20, 680, 520);
          x.restore();
        }
        const v = x.createRadialGradient(320, 240, 120, 320, 240, 420);
        v.addColorStop(0, 'rgba(10,8,30,0)');
        v.addColorStop(1, 'rgba(6,4,20,0.65)');
        x.fillStyle = v;
        x.fillRect(0, 0, SCREEN.w, SCREEN.h);
      }
      this.backdrop = cv;
    }
    if (this.framed) ctx.drawImage(this.backdrop, 0, 0, SCREEN.w, SCREEN.h);
  }

  get classic() { return this.skin === 'classic'; }
  // The whole original frame picture only fits the wide screen.
  get framed() { return this.classic && !this.tall; }

  // A piece of the frame picture, copied to the same place (callers move it with the transform).
  frameCut(ctx, [sx, sy, sw, sh], dx = sx, dy = sy) {
    if (this.frame) ctx.drawImage(this.frame.img, sx, sy, sw, sh, dx, dy, sw, sh);
  }

  ryCut(ctx, key, x, y, w, h) {
    if (!this.ry) return;
    const [sx, sy, sw, sh] = RY[key], k = this.ry.scale;
    ctx.drawImage(this.ry.img, sx * k, sy * k, sw * k, sh * k, x, y, w ?? sw, h ?? sh);
  }

  // Text in one of the original fonts; returns the width. align: 'left' | 'right' | 'center'.
  glyphs(ctx, text, x, y, font = 'white', align = 'left', size = 1) {
    if (!this.ry) return 0;
    const f = FONTS[font], k = this.ry.scale;
    const w = 16 * size * text.length;
    let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    for (const ch of text.toUpperCase()) {
      const i = GLYPHS.indexOf(ch);
      if (i >= 0 && ch !== ' ') ctx.drawImage(this.ry.img, i * 16 * k, f.y * k, 16 * k, f.h * k, cx, y, 16 * size, f.h * size);
      cx += 16 * size;
    }
    return w;
  }

  // ---- frame ------------------------------------------------------------------------------

  // match: { boards, players: [{ name, char, wins }], state, message, result, time }
  draw(match) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.px, 0, 0, this.px, this.ox * this.dpr, this.oy * this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.drawBackdrop(ctx);
    if (!this.framed) {
      // The soft-focus stage fills the whole window, not just the 640x480 screen.
      const cw = this.canvas.width, ch = this.canvas.height, bw = this.backdrop.width, bh = this.backdrop.height;
      const k = Math.max(cw / bw, ch / bh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.backdrop, (cw - bw * k) / 2, (ch - bh * k) / 2, bw * k, bh * k);
      ctx.setTransform(this.px, 0, 0, this.px, this.ox * this.dpr, this.oy * this.dpr);
    }
    match.boards.forEach((b, i) => {
      const at = this.layout.fields[i], home = FIELDS[i];
      ctx.save();
      ctx.translate(at.x - home.x * at.s, at.y - home.y * at.s);
      ctx.scale(at.s, at.s);
      this.drawField(ctx, b, i, match);
      this.drawParticles(ctx, i);
      this.drawResult(ctx, i, match);
      ctx.restore();
    });
    this.drawCentre(ctx, match);
    this.drawHud(ctx, match);
    this.drawBanner(ctx, match);
  }

  drawField(ctx, b, i, match) {
    const { x: fx, y: fy } = FIELDS[i];
    const memo = this.memo[i];
    const modern = !this.classic;
    // Upright phones, original look: the field with its border, cut out of the frame.
    if (this.classic && !this.framed) this.frameCut(ctx, [fx - 16, fy - 16, FIELD_W + 32, FIELD_H + 32]);
    if (modern) {
      // Glass panel.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(8,10,26,0.72)';
      roundRect(ctx, fx - 6, fy - 6, FIELD_W + 12, FIELD_H + 12, 14);
      ctx.fill();
      ctx.restore();
      const edge = ctx.createLinearGradient(fx, fy, fx, fy + FIELD_H);
      edge.addColorStop(0, PLAYER_COLOURS[i]);
      edge.addColorStop(1, 'rgba(255,255,255,0.15)');
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      roundRect(ctx, fx - 6, fy - 6, FIELD_W + 12, FIELD_H + 12, 14);
      ctx.stroke();
      // Faint cell dots.
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
        ctx.beginPath(); ctx.arc(fx + x * CELL + CELL / 2, fy + (y - 1) * CELL + CELL / 2, 2, 0, Math.PI * 2); ctx.fill();
      }
      // The spot that ends the game.
      ctx.strokeStyle = 'rgba(255,80,110,0.45)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const dx = fx + DEATH_X * CELL + CELL / 2, dy = fy + CELL / 2;
      ctx.beginPath();
      ctx.moveTo(dx - 7, dy - 7); ctx.lineTo(dx + 7, dy + 7);
      ctx.moveTo(dx + 7, dy - 7); ctx.lineTo(dx - 7, dy + 7);
      ctx.stroke();
    }

    // Pops finishing: burst into particles.
    const popKeys = b.popping.map((p) => p.y * W + p.x).join(',');
    if (memo.pops && memo.pops.length && !b.popping.length) {
      for (const p of memo.pops) {
        const x = fx + p.x * CELL + CELL / 2, y = fy + (p.y - 1) * CELL + CELL / 2;
        if (this.classic) this.rings.push({ x, y, c: p.c, t: 0, field: i });
        else this.burst(x, y, p.c, i);
      }
    }
    memo.pops = b.popping.length ? b.popping.map((p) => ({ ...p })) : memo.popKeys === popKeys ? memo.pops : [];
    memo.popKeys = popKeys;

    // When the board is lost, the whole stack sinks out of the field.
    let sink = 0, fade = 1;
    if (b.dead) {
      memo.deadAt ??= match.time;
      const t = Math.min(1, (match.time - memo.deadAt) / 1.2);
      sink = ease(t) * FIELD_H * 0.9;
      fade = 1 - t * 0.8;
    } else memo.deadAt = null;

    ctx.save();
    ctx.beginPath();
    ctx.rect(fx - 2, fy - 2, FIELD_W + 4, FIELD_H + 4);
    ctx.clip();
    ctx.translate(0, sink);
    ctx.globalAlpha = fade;

    const popSet = new Set(b.popping.map((p) => p.y * W + p.x));
    const popT = b.phase === 'pop' ? 1 - b.timer / 42 : 0;
    if (modern) this.bridges(ctx, b.grid, fx, fy, new Set());
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = b.grid[y * W + x];
        if (!c) continue;
        const cx = fx + x * CELL + CELL / 2, cy = fy + (y - 1) * CELL + CELL / 2;
        const land = b.land[y * W + x] || 0;
        const squash = land > 0 ? Math.sin(land * Math.PI) * 0.22 : 0;
        const opts = { mask: this.maskAt(b.grid, x, y), sx: 1 + squash * 0.6, sy: 1 - squash, alpha: fade };
        if (popSet.has(y * W + x)) {
          if (popT < 0.72) opts.flash = Math.floor(b.timer / 3) % 2 ? 0.75 : 0.1;
          else { const k = (popT - 0.72) / 0.28; opts.sx = opts.sy = 1 + k * 0.35; opts.alpha = fade * (1 - k); opts.flash = 0.6; }
        }
        this.puyo(ctx, c, cx, cy, opts);
      }
    }
    // Loose puyos falling (also the nuisance coming down).
    for (const f of b.falling) {
      if (f.done) continue;
      this.puyo(ctx, f.c, fx + f.x * CELL + CELL / 2, fy + (f.y - 1) * CELL + CELL / 2, { alpha: fade });
    }
    // The pair being played, with where it would land.
    const p = b.piece;
    if (p && !b.dead) {
      const [dx, dy] = ROT[p.r];
      this.ghost(ctx, b, p, fx, fy);
      const pulse = 0.5 + 0.5 * Math.sin(match.time * 10);
      const ax = fx + p.x * CELL + CELL / 2, ay = fy + (p.y - 1) * CELL + CELL / 2;
      this.puyo(ctx, p.b, ax + dx * CELL, ay + dy * CELL, { alpha: fade });
      this.puyo(ctx, p.a, ax, ay, { alpha: fade, flash: modern ? 0 : pulse * 0.25 });
      if (modern) {
        // The axis puyo (the one the pair turns around) wears a soft ring.
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.35})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ax, ay + 0.5, CELL * 0.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Chain label.
    if (b.chainShow > 0 && b.chainAt) {
      const life = 1 - b.chainShow / 80;
      const cx = fx + Math.min(W - 1.5, Math.max(1.5, b.chainAt.x + 0.5)) * CELL;
      const cy = fy + (b.chainAt.y - 1) * CELL - life * 28;
      const pop = life < 0.15 ? 0.6 + (life / 0.15) * 0.55 : life < 0.25 ? 1.15 - ((life - 0.15) / 0.1) * 0.15 : 1;
      const alpha = life > 0.8 ? (1 - life) / 0.2 : 1;
      if (this.classic) {
        // The original: the count in the big font, then "연쇄".
        const n = String(b.lastChain), w = n.length * 16 + 34;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.scale(pop, pop);
        this.glyphs(ctx, n, -w / 2, -16, 'big');
        this.ryCut(ctx, 'ren', -w / 2 + n.length * 16 + 2, 2);
        ctx.restore();
      } else this.label(ctx, `${b.lastChain}연쇄!`, cx, cy, 22 * pop, { alpha });
    }
    if (b.allClearShow > 0) {
      const life = 1 - b.allClearShow / 120;
      const alpha = life > 0.8 ? (1 - life) / 0.2 : 1;
      if (this.classic) {
        ctx.globalAlpha = alpha;
        const bob = Math.sin(life * Math.PI * 6) * 3;
        this.ryCut(ctx, 'allClear', fx + FIELD_W / 2 - 80, fy + FIELD_H * 0.38 + bob);
        ctx.globalAlpha = 1;
      } else {
        this.label(ctx, 'ALL CLEAR', fx + FIELD_W / 2, fy + FIELD_H * 0.42, 24, { alpha, colours: ['#fffbe0', '#ffd34d', '#ff8a00'] });
        this.label(ctx, '전부 지웠다!', fx + FIELD_W / 2, fy + FIELD_H * 0.42 + 26, 14, { alpha });
      }
    }

    // Nuisance about to fall, as icons above the field.
    this.warnings(ctx, b.warning ?? b.pending ?? 0, fx, fy - 4);

    // Score (upright, it is in the status bar instead).
    if (this.layout.hud) return;
    if (this.classic && b.maxChain > 1) {
      ctx.font = `800 10px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(`최대 ${b.maxChain}연쇄`, fx + 2, fy + FIELD_H + 17);
      ctx.fillStyle = '#ffd84a';
      ctx.fillText(`최대 ${b.maxChain}연쇄`, fx + 2, fy + FIELD_H + 17);
    }
    if (this.classic) {
      this.glyphs(ctx, String(b.score).padStart(8, ' '), fx + FIELD_W, fy + FIELD_H + 8, 'white', 'right');
      return;
    }
    const sy = fy + FIELD_H + 12;
    if (modern) {
      ctx.fillStyle = 'rgba(8,10,26,0.72)';
      roundRect(ctx, fx - 6, sy, FIELD_W + 12, 28, 10);
      ctx.fill();
    }
    ctx.font = `800 11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('SCORE', fx + 4, sy + 14);
    ctx.font = `800 19px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(b.score).padStart(8, '0'), fx + FIELD_W - 2, sy + 15);
  }

  ghost(ctx, b, p, fx, fy) {
    const [dx, dy] = ROT[p.r];
    // The field is settled while a pair is in play, so the first gap from the bottom is where it lands.
    const land = (x) => { let y = H - 1; while (y >= 0 && b.grid[y * W + x]) y--; return y; };
    let ya, yb;
    if (dx === 0) {
      const y = land(p.x);
      if (dy > 0) { yb = y; ya = y - 1; } else { ya = y; yb = y - 1; }
    } else { ya = land(p.x); yb = land(p.x + dx); }
    const dot = (x, y, c) => {
      if (y < 1) return;
      ctx.fillStyle = COLOURS[c][1];
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(fx + x * CELL + CELL / 2, fy + (y - 1) * CELL + CELL / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    dot(p.x, ya, p.a);
    dot(p.x + dx, yb, p.b);
  }

  warnings(ctx, n, fx, y) {
    let x = fx + 4;
    let left = n;
    let count = 0;
    for (const [v, kind] of WARN) {
      while (left >= v && count < 6) {
        this.warnIcon(ctx, kind, x + 12, y - 12);
        x += kind === 'small' ? 18 : 28;
        left -= v;
        count++;
      }
    }
  }

  warnIcon(ctx, kind, x, y) {
    if (this.classic && this.ry) {
      const [, , w, h] = RY[kind];
      this.ryCut(ctx, kind, x - w / 2, y + 12 - h);
      return;
    }
    ctx.save();
    if (kind === 'small' || kind === 'big') {
      const s = kind === 'small' ? 14 : 24;
      ctx.drawImage(this.sprite(GARBAGE), x - s / 2, y - s / 2 + (kind === 'small' ? 4 : 0), s, s);
    } else if (kind === 'rock') {
      const g = ctx.createLinearGradient(x - 11, y - 11, x + 11, y + 11);
      g.addColorStop(0, '#c9cbd6'); g.addColorStop(1, '#5d6275');
      ctx.fillStyle = g;
      roundRect(ctx, x - 11, y - 10, 22, 21, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    } else if (kind === 'star') {
      ctx.fillStyle = '#ffd84a';
      ctx.strokeStyle = '#b57a00';
      ctx.lineWidth = 1.5;
      star(ctx, x, y, 12, 5.5);
      ctx.fill(); ctx.stroke();
    } else if (kind === 'moon') {
      ctx.fillStyle = '#ffe680';
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.arc(x + 5, y - 3, 9, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else {
      ctx.fillStyle = '#ffcf3a';
      ctx.strokeStyle = '#a86b00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 12, y + 8); ctx.lineTo(x - 12, y - 6); ctx.lineTo(x - 6, y); ctx.lineTo(x, y - 10);
      ctx.lineTo(x + 6, y); ctx.lineTo(x + 12, y - 6); ctx.lineTo(x + 12, y + 8); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawCentre(ctx, match) {
    const L = this.layout;
    match.boards.forEach((b, i) => {
      // NEXT and the one after.
      if (L.next[i]) this.drawNext(ctx, b, i, L.next[i]);
      if (this.framed) {
        // On the original frame: the characters in the lower window, names under it.
        ctx.save();
        ctx.beginPath();
        ctx.rect(...STAGE_WINDOW);
        ctx.clip();
        this.drawFigure(ctx, b, i, { x: i === 0 ? 280 : 360, y: 402 }, match);
        ctx.restore();
        this.drawName(ctx, i, i === 0 ? 272 : 368, 418, match);
      } else {
        if (L.face[i]) this.drawFace(ctx, b, i, L.face[i], match);
        if (L.figure[i]) this.drawFigure(ctx, b, i, L.figure[i], match);
      }
    });
  }

  drawName(ctx, i, x, y, match) {
    const p = match.players[i];
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(p.name, x, y, 78);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, x, y, 78);
    this.drawWins(ctx, p, x, y + 16, match);
  }

  drawWins(ctx, p, x, y, match) {
    for (let k = 0; k < match.toWin; k++) {
      const sx = x + (k - (match.toWin - 1) / 2) * 16;
      ctx.fillStyle = k < p.wins ? '#ffd84a' : 'rgba(255,255,255,0.25)';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      star(ctx, sx, y, 6, 2.8);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawNext(ctx, b, i, { x, y }) {
    if (this.classic) {
      // The original NEXT window (the frame already has it on the wide screen).
      if (!this.framed) this.frameCut(ctx, NEXT_WINDOW, x + 4, y + 14);
    } else {
      ctx.fillStyle = 'rgba(8,10,26,0.72)';
      roundRect(ctx, x, y, 80, 128, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `800 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('NEXT', x + 40, y + 11);
    }
    const [n1, n2] = b.nextPairs;
    const near = i === 0 ? x + 28 : x + 52, far = i === 0 ? x + 58 : x + 22;
    if (n1) { this.puyo(ctx, n1[1], near, y + 38, {}); this.puyo(ctx, n1[0], near, y + 70, {}); }
    if (n2) { this.puyo(ctx, n2[1], far, y + 74, { size: 22 }); this.puyo(ctx, n2[0], far, y + 96, { size: 22 }); }
  }

  // Portrait card, name and the rounds won.
  drawFace(ctx, b, i, { x: px, y: py }, match) {
    const p = match.players[i];
    ctx.save();
    roundRect(ctx, px, py, 80, 56, 10);
    ctx.clip();
    ctx.fillStyle = '#111';
    ctx.fillRect(px, py, 80, 56);
    const face = this.faces?.[i];
    if (face) {
      const sw = face.w, sh = face.w * 0.7;
      ctx.save();
      if (i === 1) { ctx.translate(px * 2 + 80, 0); ctx.scale(-1, 1); }
      ctx.drawImage(face.img, face.x, face.y, sw, Math.min(face.h, sh), px, py, 80, 56);
      ctx.restore();
    }
    if (b.dead) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(px, py, 80, 56); }
    ctx.restore();
    ctx.strokeStyle = PLAYER_COLOURS[i];
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, 80, 56, 10);
    ctx.stroke();
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, px + 40, py + 66, 78);
    this.drawWins(ctx, p, px + 40, py + 82, match);
  }

  // The character standing at the bottom, bouncing when its chain goes off.
  drawFigure(ctx, b, i, { x: cx, y: by }, match) {
    const fig = this.figures?.[i];
    if (fig) {
      const pose = b.dead ? 2 : match.result?.winner === i ? 1 : 0;
      const hop = b.chainShow > 50 ? Math.sin(((80 - b.chainShow) / 30) * Math.PI) * 8 : 0;
      const w = 80, h = (fig.h / fig.w) * 80;
      ctx.save();
      ctx.translate(cx, by - hop);
      if (i === 1) ctx.scale(-1, 1);
      ctx.drawImage(fig.img, 0, pose * fig.h, fig.w, fig.h, -w / 2, -h, w, h);
      ctx.restore();
    }
  }

  // ---- status bar ------------------------------------------------------------------------

  // Play time; upright also both players' score, chain and best chain, and the rounds won.
  drawHud(ctx, match) {
    const L = this.layout;
    const time = clock(match.playTime ?? 0);
    if (!L.hud) {
      // Wide: the time over the top border, in the middle.
      ctx.fillStyle = 'rgba(6,8,20,0.75)';
      roundRect(ctx, 276, 4, 88, 24, 12);
      ctx.fill();
      this.hudText(ctx, time, 320, 16, 16, 'center', '#fff');
      return;
    }
    const right = L.screen.w - 52; // the pause button sits beyond this
    ctx.fillStyle = 'rgba(6,8,20,0.8)';
    roundRect(ctx, 4, 4, right - 4, 48, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const mid = (4 + right) / 2;
    this.hudText(ctx, time, mid, 20, 18, 'center', '#fff');
    // Rounds won under the time: mine on the left, theirs on the right.
    const me = this.me, other = 1 - me;
    for (const [i, dir] of [[me, -1], [other, 1]]) {
      const p = match.players[i];
      for (let k = 0; k < match.toWin; k++) {
        ctx.fillStyle = k < p.wins ? '#ffd84a' : 'rgba(255,255,255,0.22)';
        star(ctx, mid + dir * (10 + k * 11), 40, 4.5, 2);
        ctx.fill();
      }
    }
    this.hudSide(ctx, match, me, 12, 'left');
    this.hudSide(ctx, match, other, right - 8, 'right');
  }

  // One player's corner of the status bar: name and chains on top, score below.
  hudSide(ctx, match, i, x, align) {
    const b = match.boards[i], p = match.players[i];
    const now = b.chainShow > 0 ? b.lastChain : 0;
    ctx.font = `800 10px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.fillStyle = PLAYER_COLOURS[i];
    const name = p.name.length > 5 ? `${p.name.slice(0, 5)}…` : p.name;
    ctx.fillText(name, x, 15);
    const nameW = ctx.measureText(name).width;
    const chain = now ? `${now}연쇄!` : b.maxChain ? `최대 ${b.maxChain}` : '';
    if (chain) {
      ctx.fillStyle = now ? '#ffd84a' : 'rgba(255,255,255,0.6)';
      ctx.fillText(chain, align === 'left' ? x + nameW + 6 : x - nameW - 6, 15);
    }
    this.hudText(ctx, String(b.score), x, 35, 15, align, '#fff');
  }

  // Numbers and times in the status bar: the original white font, or plain text when modern.
  hudText(ctx, text, x, y, size, align, colour) {
    if (this.classic && this.ry) {
      this.glyphs(ctx, text, x, y - size / 2, 'white', align, size / 16);
      return;
    }
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y + 1);
  }

  // READY / GO.
  drawBanner(ctx, match) {
    if (!match.message) return;
    const { text, sub, t = 1 } = match.message;
    const k = ease(Math.min(1, t * 3));
    const { w, h } = this.layout.screen;
    this.label(ctx, text, w / 2, h * 0.46, 46 * (0.6 + 0.4 * k), { alpha: k });
    if (sub) this.label(ctx, sub, w / 2, h * 0.46 + 38, 16, { alpha: k, colours: ['#ffffff', '#dfe8ff', '#9fb4ff'] });
  }

  // The round result over a field.
  drawResult(ctx, i, match) {
    if (!match.result) return;
    const { x, y } = FIELDS[i];
    const won = match.result.winner === i;
    const draw = match.result.winner === -1;
    this.label(ctx, draw ? 'DRAW' : won ? 'WIN!' : 'LOSE', x + FIELD_W / 2, y + FIELD_H * 0.38, 38,
      { colours: won ? ['#fffbe0', '#ffd34d', '#ff8a00'] : ['#ffffff', '#c7d0ea', '#6f7a9e'] });
  }

  // Big outlined text with a gradient, centred.
  label(ctx, text, x, y, size, { alpha = 1, colours = ['#fff6d8', '#ffcf3a', '#ff6a00'] } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = 'rgba(20,10,40,0.9)';
    ctx.strokeText(text, x, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, colours[0]);
    g.addColorStop(0.5, colours[1]);
    g.addColorStop(1, colours[2]);
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ---- particles --------------------------------------------------------------------------

  burst(x, y, c, field) {
    const colour = (COLOURS[c] || COLOURS[GARBAGE])[1];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + Math.random() * 0.6;
      const v = 1.5 + Math.random() * 2.5;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, r: 2.5 + Math.random() * 3, life: 1, colour, field });
    }
  }

  step() {
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.97;
      p.life -= 0.03;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.t++;
    this.rings = this.rings.filter((r) => r.t < 18);
  }

  drawParticles(ctx, field) {
    // The original pop: a ring of little puyos (sheet row 1, cells 1 and 2) spreading out.
    for (const r of this.rings) {
      if (r.field !== field) continue;
      const sheet = this.sheets?.[r.c === GARBAGE ? 'garbage' : r.c];
      if (!sheet || r.c === GARBAGE) continue;
      const k = 32 * sheet.scale, size = 32 * (1 + r.t / 18);
      ctx.globalAlpha = 1 - (r.t / 18) ** 2;
      ctx.drawImage(sheet.img, (r.t < 9 ? 1 : 2) * k, k, k, k, r.x - size / 2, r.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    for (const p of this.particles) {
      if (p.field !== field) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.max(0, p.life) * 0.8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Forget per-board animation state between rounds.
  reset() {
    this.memo = [{}, {}];
    this.particles = [];
    this.rings = [];
  }

  // Screen point (CSS pixels) to screen units, for taps on the canvas.
  toScreen(clientX, clientY) {
    return { x: (clientX - this.ox) / this.scale, y: (clientY - this.oy) / this.scale };
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, x, y, outer, inner) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? inner : outer;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}
