// One player's field and the Puyo Puyo Tsu rules: the falling pair, gravity, chains, score and
// nuisance (garbage) puyos. Runs in fixed 60 Hz steps; everything a frame needs to draw is on
// the board itself, so a remote player's board can be mirrored from a snapshot (see `snapshot`).
import { rng } from './rng.js';

export const W = 6;
export const H = 13; // row 0 is the hidden 13th row above the field
export const GARBAGE = 6;
export const DEATH_X = 2; // third column from the left
export const STEP = 1 / 60;

// Child puyo offset from the axis puyo, by rotation: up, right, down, left.
export const ROT = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Tsu scoring.
const CHAIN_POWER = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const COLOUR_BONUS = [0, 0, 3, 6, 12, 24];
const groupBonus = (n) => (n <= 4 ? 0 : n >= 11 ? 10 : [2, 3, 4, 5, 6, 7][n - 5]);
const TARGET_POINTS = 70;
const ALL_CLEAR_BONUS = 30;
const MAX_DROP = 30; // nuisance falling at once

// Frames.
const LOCK_DELAY = 30;
const LOCK_RESETS = 8;
const POP_FRAMES = 42;
const SPAWN_DELAY = 6;
const QUICK_TURN = 18; // second blocked turn within this many frames flips the pair
const FALL_G = 0.09; // cells / frame^2 for loose puyos
const FALL_MAX = 0.9;

export const chainPower = (n) => CHAIN_POWER[Math.min(n, CHAIN_POWER.length) - 1] ?? 999;

export class Board {
  // pairs: the shared queue (rng.js Pairs); seed: this board's own garbage placement.
  constructor({ pairs, seed = 1, speed = 1 }) {
    this.pairs = pairs;
    this.grid = new Uint8Array(W * H);
    this.r = rng(seed);
    this.speed = speed;
    this.next = 0; // index of the next pair in the queue
    this.piece = null;
    this.falling = []; // loose puyos: { x, y, to, v, c }
    this.popping = []; // cells flashing before they vanish
    this.phase = 'spawn';
    this.timer = SPAWN_DELAY;
    this.chain = 0;
    this.lastChain = 0; // shown as "N연쇄" while it fades
    this.chainAt = null; // { x, y } where the last chain step popped, for the label
    this.chainShow = 0;
    this.score = 0;
    this.leftover = 0; // points not yet turned into nuisance
    this.pending = 0; // nuisance that falls after this board's next move
    this.incoming = 0; // nuisance from a chain the opponent is still playing out
    this.allClear = false; // next chain gets the bonus
    this.allClearShow = 0;
    this.dead = false;
    this.time = 0;
    this.events = [];
    this.land = new Float32Array(W * H); // squash animation per cell after landing
    this.blocked = 0; // frame of the last turn that failed, for the quick turn
    this.frame = 0;
    this.attack = 0; // nuisance this board sent during the current chain (for the CPU)
  }

  at(x, y) { return x < 0 || x >= W || y >= H ? 255 : y < 0 ? 0 : this.grid[y * W + x]; }
  set(x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) this.grid[y * W + x] = c; }

  emit(type, data) { this.events.push({ type, ...data }); }

  get nextPairs() { return [this.pairs.get(this.next), this.pairs.get(this.next + 1)]; }

  // Speed in cells per frame: slow at first, faster over a long round.
  get gravity() { return Math.min(0.12, (0.022 + this.time * 0.00012) * this.speed); }

  // A puyo at a fractional row covers the rows it overlaps.
  free(x, y) {
    const a = Math.floor(y), b = Math.ceil(y);
    return this.at(x, a) === 0 && this.at(x, b) === 0;
  }

  fits(x, y, r) {
    const [dx, dy] = ROT[r];
    return this.free(x, y) && this.free(x + dx, y + dy);
  }

  spawn() {
    if (this.at(DEATH_X, 1) !== 0) {
      this.dead = true;
      this.phase = 'dead';
      this.emit('dead');
      return;
    }
    const [a, b] = this.pairs.get(this.next++);
    this.piece = { x: DEATH_X, y: 1, r: 0, a, b, lock: 0, resets: 0, kicks: 0 };
    this.phase = 'move';
    this.emit('spawn');
  }

  // input: { move: -1 | 0 | 1, turn: -1 | 0 | 1, soft: bool } for this frame.
  step(input = {}) {
    this.frame++;
    this.events.length = 0;
    if (this.chainShow > 0) this.chainShow--;
    if (this.allClearShow > 0) this.allClearShow--;
    for (let i = 0; i < this.land.length; i++) if (this.land[i] > 0) this.land[i] = Math.max(0, this.land[i] - 0.08);
    if (this.dead) return;
    this.time += STEP;
    switch (this.phase) {
      case 'spawn': if (--this.timer <= 0) this.spawn(); break;
      case 'move': this.control(input); break;
      case 'drop': this.dropStep(); break;
      case 'pop': if (--this.timer <= 0) this.clearPopped(); break;
      case 'wait': if (--this.timer <= 0) this.afterChain(); break;
    }
  }

  control({ move = 0, turn = 0, soft = false }) {
    const p = this.piece;
    if (turn) this.turn(turn);
    if (move && this.fits(p.x + move, p.y, p.r)) {
      p.x += move;
      this.emit('move');
      if (p.lock && p.resets < LOCK_RESETS) { p.lock = 0; p.resets++; }
    }
    const v = soft ? Math.max(0.5, this.gravity) : this.gravity;
    const ny = p.y + v;
    if (this.fits(p.x, ny, p.r)) {
      if (soft) {
        const rows = Math.floor(ny) - Math.floor(p.y);
        if (rows > 0) this.score += rows;
      }
      p.y = ny;
      p.lock = 0;
      return;
    }
    // Resting on something: snap to the cell and wait a moment before it locks.
    p.y = Math.floor(ny);
    while (!this.fits(p.x, p.y, p.r)) p.y--;
    if (soft || ++p.lock >= LOCK_DELAY) this.lock();
  }

  turn(dir) {
    const p = this.piece;
    const r = (p.r + dir + 4) % 4;
    const [dx, dy] = ROT[r];
    const tries = [[0, 0]];
    if (dx) tries.push([-dx, 0]); // pushed off a wall or a stack
    if (dy > 0) tries.push([0, -1]); // turned down into the floor: lift
    if (dx && p.y !== Math.floor(p.y)) tries.push([0, -0.5], [-dx, -0.5]);
    for (const [ox, oy] of tries) {
      if (oy < 0 && p.kicks >= 8) continue;
      if (this.fits(p.x + ox, p.y + oy, r)) {
        p.x += ox; p.y += oy; p.r = r;
        if (oy < 0) p.kicks++;
        if (p.lock && p.resets < LOCK_RESETS) { p.lock = 0; p.resets++; }
        this.emit('turn');
        return;
      }
    }
    // Both sides blocked (a one-column gap): a second try flips the pair upside down.
    if (this.frame - this.blocked <= QUICK_TURN) {
      const flip = (p.r + 2) % 4;
      for (const oy of [0, -1]) {
        if (this.fits(p.x, p.y + oy, flip)) {
          p.y += oy; p.r = flip;
          this.blocked = 0;
          this.emit('turn');
          return;
        }
      }
    }
    this.blocked = this.frame;
  }

  lock() {
    const p = this.piece;
    const [dx, dy] = ROT[p.r];
    const y = Math.round(p.y);
    this.piece = null;
    this.loose([[p.x, y, p.a], [p.x + dx, y + dy, p.b]]);
    this.chain = 0;
    this.attack = 0;
    this.emit('lock');
  }

  // Puts puyos into the grid and lets everything with a gap below fall.
  loose(puyos) {
    for (const [x, y, c] of puyos) if (y >= 0) this.set(x, y, c);
    this.settle();
  }

  settle() {
    this.falling = [];
    for (let x = 0; x < W; x++) {
      let to = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        const c = this.at(x, y);
        if (!c) continue;
        if (y !== to) {
          this.set(x, y, 0);
          this.falling.push({ x, y, to, v: 0, c });
        }
        to--;
      }
    }
    this.phase = 'drop';
    if (!this.falling.length) this.dropStep();
  }

  dropStep() {
    let landed = false;
    for (const f of this.falling) {
      if (f.done) continue;
      f.v = Math.min(FALL_MAX, f.v + FALL_G);
      f.y += f.v;
      if (f.y >= f.to) {
        f.y = f.to;
        f.done = true;
        this.set(f.x, f.to, f.c);
        this.land[f.to * W + f.x] = 1;
        landed = true;
      }
    }
    if (landed) this.emit('land');
    if (this.falling.every((f) => f.done)) {
      this.falling = [];
      this.checkPops();
    }
  }

  // Groups of four or more of one colour in the visible field, plus nuisance touching them.
  findPops(grid = this.grid) {
    const seen = new Uint8Array(W * H);
    const groups = [];
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y * W + x];
        if (!c || c === GARBAGE || seen[y * W + x]) continue;
        const cells = [];
        const stack = [[x, y]];
        seen[y * W + x] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          cells.push([cx, cy]);
          for (const [dx, dy] of ROT) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= W || ny < 1 || ny >= H) continue;
            const i = ny * W + nx;
            if (!seen[i] && grid[i] === c) { seen[i] = 1; stack.push([nx, ny]); }
          }
        }
        if (cells.length >= 4) groups.push({ c, cells });
      }
    }
    return groups;
  }

  checkPops() {
    const groups = this.findPops();
    if (!groups.length) {
      this.phase = 'wait';
      this.timer = 1;
      return;
    }
    this.chain++;
    const cleared = groups.reduce((s, g) => s + g.cells.length, 0);
    const colours = new Set(groups.map((g) => g.c)).size;
    const bonus = chainPower(this.chain) + COLOUR_BONUS[colours] + groups.reduce((s, g) => s + groupBonus(g.cells.length), 0);
    const points = 10 * cleared * Math.min(999, Math.max(1, bonus));
    this.score += points;
    // Nuisance: every 70 points is one puyo, cancelling what is waiting here first.
    let send = Math.floor((points + this.leftover) / TARGET_POINTS);
    this.leftover = (points + this.leftover) % TARGET_POINTS;
    if (this.allClear) { send += ALL_CLEAR_BONUS; this.allClear = false; }
    const cancel = Math.min(send, this.pending + this.incoming);
    const fromPending = Math.min(cancel, this.pending);
    this.pending -= fromPending;
    this.incoming -= cancel - fromPending;
    send -= cancel;
    this.attack += send;
    // The popping cells and the nuisance next to them.
    const pop = new Set();
    for (const g of groups) for (const [x, y] of g.cells) pop.add(y * W + x);
    for (const i of [...pop]) {
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of ROT) {
        const nx = x + dx, ny = y + dy;
        if (ny >= 1 && this.at(nx, ny) === GARBAGE) pop.add(ny * W + nx);
      }
    }
    this.popping = [...pop].map((i) => ({ x: i % W, y: Math.floor(i / W), c: this.grid[i] }));
    const mid = groups[0].cells.reduce((s, [x, y]) => [s[0] + x / groups[0].cells.length, s[1] + y / groups[0].cells.length], [0, 0]);
    this.chainAt = { x: mid[0], y: mid[1] };
    this.lastChain = this.chain;
    this.chainShow = 80;
    this.phase = 'pop';
    this.timer = POP_FRAMES;
    this.emit('pop', { chain: this.chain, points, send, cancel, cells: this.popping.length, groups: groups.length });
  }

  clearPopped() {
    for (const p of this.popping) this.set(p.x, p.y, 0);
    this.emit('cleared', { cells: this.popping });
    this.popping = [];
    this.settle();
  }

  afterChain() {
    if (this.chain > 0) {
      this.emit('chainEnd', { chain: this.chain, attack: this.attack });
      this.chain = 0;
      if (this.grid.every((c) => c === 0)) {
        this.allClear = true;
        this.allClearShow = 120;
        this.emit('allClear');
      }
    }
    // Nuisance falls after the chain is over and the field is still.
    if (this.pending > 0 && !this.garbageDone) {
      this.garbageDone = true;
      this.dropGarbage();
      return;
    }
    this.garbageDone = false;
    this.phase = 'spawn';
    this.timer = SPAWN_DELAY;
  }

  dropGarbage() {
    const n = Math.min(this.pending, MAX_DROP);
    this.pending -= n;
    const rows = Math.floor(n / W);
    const count = new Array(W).fill(rows);
    const cols = [0, 1, 2, 3, 4, 5];
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    for (let i = 0; i < n % W; i++) count[cols[i]]++;
    this.falling = [];
    for (let x = 0; x < W; x++) {
      let top = 0;
      while (top < H && this.at(x, top) === 0) top++;
      // Stacked above the field, each column falling as a block.
      for (let k = 0; k < count[x]; k++) {
        const to = top - 1 - k;
        if (to < 0) break; // no room: the rest is lost
        this.falling.push({ x, y: -1 - k - (x % 2) * 0.3, to, v: 0, c: GARBAGE });
      }
    }
    this.emit('garbage', { n });
    this.phase = 'drop';
  }

  // Nuisance from the opponent's chain step; it can still be cancelled, and it only falls once
  // their chain is over (`release`).
  receive(n) {
    if (n <= 0) return;
    this.incoming += n;
    this.emit('incoming', { n });
  }

  release() {
    this.pending += this.incoming;
    this.incoming = 0;
  }

  get warning() { return this.pending + this.incoming; }

  // Everything the renderer needs, small enough to send 20 times a second.
  snapshot() {
    const p = this.piece;
    return {
      g: Array.from(this.grid, (c) => c.toString(16)).join(''),
      p: p ? [p.x, Math.round(p.y * 100) / 100, p.r, p.a, p.b] : null,
      f: this.falling.filter((f) => !f.done).map((f) => [f.x, Math.round(f.y * 100) / 100, f.c]),
      o: this.popping.map((q) => q.y * W + q.x),
      t: this.phase === 'pop' ? this.timer : 0,
      n: this.next,
      s: this.score,
      q: this.warning,
      ch: this.chainShow > 0 ? [this.lastChain, this.chainShow, this.chainAt.x, this.chainAt.y] : null,
      ac: this.allClearShow,
      d: this.dead,
    };
  }
}

// A remote player's board, drawn from their snapshots. Read-only: it has the fields the
// renderer reads and nothing else.
export class Mirror {
  constructor(pairs) {
    this.pairs = pairs;
    this.grid = new Uint8Array(W * H);
    this.land = new Float32Array(W * H);
    this.piece = null;
    this.falling = [];
    this.popping = [];
    this.timer = 0;
    this.next = 0;
    this.score = 0;
    this.warning = 0;
    this.chainShow = 0;
    this.allClearShow = 0;
    this.dead = false;
    this.phase = 'spawn';
    this.events = [];
    this.queued = [];
  }

  get nextPairs() { return [this.pairs.get(this.next), this.pairs.get(this.next + 1)]; }

  apply(s) {
    // A new chain step shows up as a new label: tell the sound side.
    if (s.ch && (this.chainShow <= 0 || s.ch[0] !== this.lastChain)) this.queued.push({ type: 'pop', chain: s.ch[0] });
    if (s.d && !this.dead) this.queued.push({ type: 'dead' });
    const before = this.grid;
    const grid = new Uint8Array(W * H);
    for (let i = 0; i < grid.length; i++) grid[i] = parseInt(s.g[i], 16) || 0;
    // Cells that just filled get the landing squash.
    for (let i = 0; i < grid.length; i++) if (grid[i] && !before[i]) this.land[i] = 1;
    this.grid = grid;
    this.piece = s.p ? { x: s.p[0], y: s.p[1], r: s.p[2], a: s.p[3], b: s.p[4] } : null;
    this.falling = s.f.map(([x, y, c]) => ({ x, y, c }));
    this.popping = s.o.map((i) => ({ x: i % W, y: Math.floor(i / W), c: grid[i] }));
    this.phase = s.o.length ? 'pop' : s.p ? 'move' : 'drop';
    this.timer = s.t;
    this.next = s.n;
    this.score = s.s;
    this.warning = s.q;
    if (s.ch) { [this.lastChain, this.chainShow] = s.ch; this.chainAt = { x: s.ch[2], y: s.ch[3] }; } else this.chainShow = 0;
    this.allClearShow = s.ac;
    this.dead = s.d;
  }

  // Between snapshots the animations keep moving on their own.
  step() {
    this.events = this.queued;
    this.queued = [];
    if (this.chainShow > 0) this.chainShow--;
    if (this.allClearShow > 0) this.allClearShow--;
    if (this.timer > 0) this.timer--;
    for (let i = 0; i < this.land.length; i++) if (this.land[i] > 0) this.land[i] = Math.max(0, this.land[i] - 0.08);
  }
}
