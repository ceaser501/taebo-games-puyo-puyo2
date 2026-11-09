// Item battle (a room rule, 1:1): chains fill a gauge, a full gauge gives an item, and a tap
// uses it. Three items help me, three get in the other player's way. Each player's items are
// worked out on their own phone; an item aimed at the friend goes over as a message and takes
// effect on their phone (see Match.receive).
import { H, W } from './board.js';

export const ITEMS = {
  double: { icon: '🔥', name: '공격 2배', foe: false },
  shield: { icon: '🛡', name: '방패', foe: false },
  clear: { icon: '🧹', name: '한 줄 지우기', foe: false },
  fog: { icon: '🌫', name: 'NEXT 가리기', foe: true, secs: 8 },
  reverse: { icon: '🔄', name: '거꾸로', foe: true, secs: 5 },
  speed: { icon: '⚡', name: '빨리 떨어지기', foe: true, secs: 6 },
};
const KINDS = Object.keys(ITEMS);
const ATTACK = new Set(['double', 'fog', 'reverse', 'speed']);
export const GAUGE = 3; // chain steps for one item
export const SLOTS = 3;
// Seconds the short note naming an attack stays at the top of the field it hit, and the
// seconds an attack takes to fly from one field to the other.
const NOTE_TIME = 1.2;
export const SHOT_TIME = 0.55;
const SPEED_BOOST = 2.2;

const height = (b) => {
  let h = 0;
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H && !b.grid[y * W + x]) y++;
    h = Math.max(h, H - y);
  }
  return h;
};

export class Items {
  // match: the Match it belongs to; onChange: my slots or gauge changed (to redraw the buttons).
  constructor(match, onChange = () => {}) {
    this.match = match;
    this.onChange = onChange;
    this.reset();
  }

  // A fresh start each round.
  reset() {
    this.players = [0, 1].map(() => ({ gauge: 0, slots: [], until: {}, double: false, doubleUsed: false, nextCpu: 0 }));
    this.notes = []; // { i, text, t }: shown at the top of field i
    this.shots = []; // { from, to, icon, t }: an attack flying from field `from` to field `to`
    this.onChange();
  }

  // A chain step on a board this phone plays (mine, or the computer's).
  chained(i) {
    const p = this.players[i];
    if (p.slots.length >= SLOTS) { p.gauge = GAUGE; return; }
    p.gauge++;
    while (p.gauge >= GAUGE && p.slots.length < SLOTS) {
      p.gauge -= GAUGE;
      const kind = this.pick(i);
      p.slots.push(kind);
      this.match.sound?.sfx('select', 0, 0.7);
    }
    if (p.slots.length >= SLOTS) p.gauge = Math.min(p.gauge, GAUGE);
    this.onChange();
  }

  // A random item; whoever is stacked higher gets the attacking ones more often.
  pick(i) {
    const m = this.match, behind = height(m.boards[i]) > height(m.boards[1 - i]) + 1;
    const weights = KINDS.map((k) => (behind && ATTACK.has(k) ? 2 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let k = 0; k < KINDS.length; k++) if ((r -= weights[k]) < 0) return KINDS[k];
    return KINDS[0];
  }

  // Uses slot `n` of player i. Returns the item, or null.
  use(i, n) {
    const m = this.match, p = this.players[i], kind = p.slots[n];
    if (!kind || m.state !== 'play' || m.boards[i].dead) return null;
    p.slots.splice(n, 1);
    const item = ITEMS[kind];
    if (item.foe) {
      const foe = 1 - i;
      this.shots.push({ from: i, to: foe, icon: item.icon, t: m.time });
      if (m.net) m.net.send({ t: 'item', k: m.seed, kind });
      else this.hit(foe, kind, true);
    } else {
      if (kind === 'double') { p.double = true; p.doubleUsed = false; }
      if (kind === 'shield') m.boards[i].shield = true;
      if (kind === 'clear') m.boards[i].clearRow();
    }
    m.sound?.sfx('decide', 0, 0.8);
    this.onChange();
    return kind;
  }

  // An item aimed at player i takes effect on their board (this phone plays it), and the note
  // naming it shows once the shot lands. `shot`: the shot is already flying (fired on this phone).
  hit(i, kind, shot = false) {
    const item = ITEMS[kind];
    if (!item?.secs) return;
    const m = this.match;
    this.players[i].until[kind] = m.time + item.secs;
    if (!shot) this.shots.push({ from: 1 - i, to: i, icon: item.icon, t: m.time });
    this.notes.push({ i, text: `${item.icon} ${item.name}!`, t: m.time + SHOT_TIME });
    m.sound?.sfx('garbageSmall', 0, 0.7);
  }

  active(i, kind) { return (this.players[i].until[kind] ?? 0) > this.match.time; }

  // Before a board steps: its input as the items change it (reversed), and its speed.
  input(i, input) {
    this.match.boards[i].boost = this.active(i, 'speed') ? SPEED_BOOST : 1;
    if (this.active(i, 'reverse') && input.move) return { ...input, move: -input.move };
    return input;
  }

  // Nuisance a chain step of player i sends: doubled while their 🔥 lasts (one whole chain).
  sends(i, n) {
    const p = this.players[i];
    if (!p.double || !n) return n;
    p.doubleUsed = true;
    return n * 2;
  }

  chainEnded(i) {
    const p = this.players[i];
    if (p.double && p.doubleUsed) { p.double = false; p.doubleUsed = false; this.onChange(); }
  }

  // The computer uses what it has, a moment after getting it: the shield when nuisance is
  // coming, clearing a row when it is stacked high, anything else straight away.
  cpu(i) {
    const m = this.match, p = this.players[i], b = m.boards[i];
    if (!p.slots.length || m.time < p.nextCpu) return;
    const n = p.slots.findIndex((k) => (k === 'shield' ? b.warning > 0 : k === 'clear' ? height(b) >= 8 : true));
    if (n < 0) { p.nextCpu = m.time + 1; return; }
    this.use(i, n);
    p.nextCpu = m.time + 1.5 + Math.random() * 2.5;
  }

  // What the renderer shows over player i's field: effects running on them now.
  badges(i) {
    const m = this.match, p = this.players[i], out = [];
    if (p.double) out.push('🔥 공격 2배');
    if (m.boards[i].shield) out.push('🛡 방패');
    for (const kind of ['fog', 'reverse', 'speed']) {
      if (this.active(i, kind)) out.push(`${ITEMS[kind].icon} ${Math.ceil(p.until[kind] - m.time)}`);
    }
    return out;
  }

  liveNotes() {
    this.notes = this.notes.filter((n) => this.match.time - n.t < NOTE_TIME);
    return this.notes.filter((n) => n.t <= this.match.time);
  }

  liveShots() {
    this.shots = this.shots.filter((s) => this.match.time - s.t < SHOT_TIME + 0.35);
    return this.shots;
  }

  // Seconds left of an effect on player i.
  left(i, kind) { return Math.max(0, Math.ceil((this.players[i].until[kind] ?? 0) - this.match.time)); }
}
