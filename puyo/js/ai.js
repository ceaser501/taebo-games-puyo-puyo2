// Computer opponent: tries every place the pair can go, plays the chains out on a copy of the
// field, and scores what is left (shape, connections, the biggest chain one more puyo would
// set off). It fires when the chain is big enough or it is in trouble.
import { Board, W, H, GARBAGE, DEATH_X, ROT, chainPower } from './board.js';

const findPops = (grid) => Board.prototype.findPops(grid);

export const LEVELS = {
  easy: { every: 14, think: 30, soft: false, fire: 2, look: false, noise: 30, potential: false },
  normal: { every: 6, think: 14, soft: true, fire: 3, look: false, noise: 4, potential: true },
  hard: { every: 3, think: 6, soft: true, fire: 5, look: true, noise: 0, potential: true },
};

function gravity(g) {
  for (let x = 0; x < W; x++) {
    let to = H - 1;
    for (let y = H - 1; y >= 0; y--) {
      const c = g[y * W + x];
      if (!c) continue;
      g[y * W + x] = 0;
      g[to * W + x] = c;
      to--;
    }
  }
}

// Plays out every chain on `g` in place; returns { chain, score }.
function resolve(g) {
  let chain = 0, score = 0;
  for (;;) {
    gravity(g);
    const groups = findPops(g);
    if (!groups.length) break;
    chain++;
    let cleared = 0;
    for (const { cells } of groups) {
      cleared += cells.length;
      for (const [x, y] of cells) {
        g[y * W + x] = 0;
        for (const [dx, dy] of ROT) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 1 && ny < H && g[ny * W + nx] === GARBAGE) g[ny * W + nx] = 0;
        }
      }
    }
    score += 10 * cleared * Math.max(1, chainPower(chain));
  }
  return { chain, score };
}

function top(g, x) {
  let y = 0;
  while (y < H && !g[y * W + x]) y++;
  return y; // first filled row (H when empty)
}

// The columns between the spawn and `x` must be passable at the top of the field.
function reachable(g, x) {
  const [lo, hi] = x < DEATH_X ? [x, DEATH_X] : [DEATH_X, x];
  for (let c = lo; c <= hi; c++) if (g[1 * W + c]) return false;
  return true;
}

export function place(grid, x, r, a, b) {
  const [dx, dy] = ROT[r];
  const cx = x + dx;
  if (x < 0 || x >= W || cx < 0 || cx >= W) return null;
  if (!reachable(grid, x) || !reachable(grid, cx)) return null;
  const g = grid.slice();
  // Lower puyo first when they share a column.
  const order = dy > 0 ? [[cx, b], [x, a]] : [[x, a], [cx, b]];
  for (const [col, c] of order) {
    const y = top(g, col) - 1;
    if (y >= 0) g[y * W + col] = c;
  }
  const { chain, score } = resolve(g);
  return { g, chain, score, dead: g[1 * W + DEATH_X] !== 0 };
}

// Biggest chain that dropping one or two puyos of a colour into some column would start.
function potential(g, colours) {
  let best = 0;
  for (let x = 0; x < W; x++) {
    const t = top(g, x);
    if (t < 3) continue;
    for (const c of colours) {
      for (const n of [1, 2]) {
        const h = g.slice();
        for (let k = 1; k <= n; k++) h[(t - k) * W + x] = c;
        const { chain } = resolve(h);
        if (chain > best) best = chain;
      }
    }
  }
  return best;
}

function shape(g, colours, usePotential) {
  let v = 0;
  const heights = [];
  for (let x = 0; x < W; x++) heights.push(H - top(g, x));
  // Keep the middle low (the death spot) and the field flat-ish, a little higher at the edges.
  v -= Math.max(0, heights[DEATH_X] - 8) * 40;
  v -= Math.max(0, heights[3] - 9) * 20;
  for (let x = 0; x + 1 < W; x++) v -= Math.abs(heights[x] - heights[x + 1]) * 1.5;
  v += (heights[0] + heights[5]) * 0.6;
  // Same-colour neighbours.
  for (let y = 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g[y * W + x];
      if (!c || c === GARBAGE) continue;
      if (x + 1 < W && g[y * W + x + 1] === c) v += 3;
      if (y + 1 < H && g[(y + 1) * W + x] === c) v += 3;
      // Same colour one apart in a column links up after a pop in between.
      if (y + 2 < H && g[(y + 2) * W + x] === c && g[(y + 1) * W + x] !== c) v += 0.8;
    }
  }
  if (usePotential) v += potential(g, colours) ** 2 * 9;
  return v;
}

export class Cpu {
  constructor(board, level = 'normal', opponent = null) {
    this.board = board;
    this.opponent = opponent;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.target = null;
    this.wait = 0;
    this.piece = null;
  }

  choose() {
    const b = this.board;
    const { a: a1, b: b1 } = b.piece;
    const [a2, b2] = b.nextPairs[0];
    const colours = b.pairs.colours;
    const height = Math.max(...Array.from({ length: W }, (_, x) => H - top(b.grid, x)));
    const danger = H - top(b.grid, DEATH_X) >= 9 || height >= 11;
    const threatened = b.warning >= 4;
    const oppHigh = this.opponent && H - top(this.opponent.grid, DEATH_X) >= 9;
    const options = [];
    for (let x = 0; x < W; x++) {
      for (let r = 0; r < 4; r++) {
        if (a1 === b1 && r >= 2) continue; // same colours: two turns are enough
        const res = place(b.grid, x, r, a1, b1);
        if (!res || res.dead) continue;
        let v;
        if (res.chain) {
          const fire = res.chain >= this.cfg.fire || danger || threatened || (oppHigh && res.chain >= 2);
          v = fire ? 5000 + res.score / 10 + res.chain * 200 : shape(res.g, colours, this.cfg.potential) - 60 * res.chain;
        } else {
          v = shape(res.g, colours, this.cfg.potential);
        }
        v += (Math.random() - 0.5) * this.cfg.noise;
        options.push({ x, r, v, g: res.g });
      }
    }
    if (!options.length) return { x: DEATH_X, r: 0 };
    options.sort((p, q) => q.v - p.v);
    if (this.cfg.look && a2) {
      // Look one pair further for the best few.
      for (const o of options.slice(0, 5)) {
        if (o.v >= 5000) continue;
        let best = -1e9;
        for (let x = 0; x < W; x++) {
          for (let r = 0; r < 4; r++) {
            const res = place(o.g, x, r, a2, b2);
            if (!res || res.dead) continue;
            const v = res.chain >= this.cfg.fire ? 3000 + res.score / 10 : shape(res.g, colours, false);
            if (v > best) best = v;
          }
        }
        o.v = o.v * 0.5 + best * 0.5;
      }
      options.sort((p, q) => q.v - p.v);
    }
    return options[0];
  }

  // Returns this frame's input for the board.
  input() {
    const b = this.board;
    const p = b.piece;
    if (b.phase !== 'move' || !p) { this.piece = null; return {}; }
    if (this.piece !== p) {
      this.piece = p;
      this.target = this.choose();
      this.wait = this.cfg.think;
      this.tries = 0;
    }
    if (--this.wait > 0) return {};
    this.wait = this.cfg.every;
    const t = this.target;
    if (++this.tries > 40) return { soft: true };
    if (p.r !== t.r) return { turn: (t.r - p.r + 4) % 4 === 3 ? -1 : 1 };
    if (p.x !== t.x) return { move: Math.sign(t.x - p.x) };
    this.wait = 0;
    return { soft: this.cfg.soft || this.tries > 6 };
  }
}
