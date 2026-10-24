// A match: two boards, rounds until someone has won `toWin` of them, and who sends nuisance to
// whom. Against the computer and on one keyboard both boards run here; online each player runs
// their own board and the other one is a Mirror of the friend's snapshots (see net.js).
import { Board, Mirror } from './board.js';
import { Pairs, randomSeed } from './rng.js';
import { Cpu } from './ai.js';

export const DT = 1 / 60;
const READY = 1.4; // "READY?" before the first pair
const GO = 0.5;
const RESULT = 3.2; // round result on screen before the next round
const SNAPSHOT_EVERY = 3; // frames between snapshots sent online (20 a second)
const PAN = [-0.35, 0.35];

export class Match {
  // players: [{ name, char, cpu: null | 'easy' | 'normal' | 'hard' }], pads: [Pad | null, Pad | null]
  // net (online only): { me: 0 | 1, host: bool, send(msg) }
  // onFx(i, event): every board event, for effects outside the game (shaking, vibration, achievements).
  constructor({ players, pads, sound, toWin = 2, net = null, onEnd = () => {}, onRound = () => {}, onFx = () => {} }) {
    // score / best: points and best chain over the whole match, for the ranking.
    this.players = players.map((p) => ({ ...p, wins: 0, score: 0, best: 0 }));
    this.pads = pads;
    this.sound = sound;
    this.toWin = toWin;
    this.net = net;
    this.onEnd = onEnd;
    this.onRound = onRound;
    this.onFx = onFx;
    this.time = 0;
    this.playTime = 0; // seconds of play in this match, shown at the top
    this.acc = 0;
    this.paused = false;
    this.over = false;
  }

  // Online the host picks the seed and tells the guest (`start` message).
  startRound(seed = randomSeed()) {
    this.seed = seed;
    const pairs = new Pairs(seed);
    this.boards = [0, 1].map((i) => (this.net && i !== this.net.me ? new Mirror(pairs) : new Board({ pairs, seed: seed + 1 + i })));
    this.cpus = this.players.map((p, i) => (p.cpu && !this.net ? new Cpu(this.boards[i], p.cpu, this.boards[1 - i]) : null));
    this.state = 'ready';
    this.clock = 0;
    this.result = null;
    this.message = { text: 'READY?', sub: '준비는 다 됐나요?', t: 0 };
    this.frame = 0;
    this.pads.forEach((p) => p?.release());
    this.sound?.preloadGame(this.players.map((p) => p.char));
  }

  update(dt) {
    if (this.paused || this.over) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
  }

  tick() {
    this.time += DT;
    this.clock += DT;
    this.resendStart();
    if (this.state === 'ready') {
      this.message.t = this.clock;
      if (this.clock >= READY) {
        this.state = 'go';
        this.clock = 0;
        this.message = { text: 'GO!', t: 0 };
        this.sound?.sfx('decide');
      }
      return;
    }
    if (this.state === 'go') {
      this.message.t = this.clock * 2;
      if (this.clock >= GO) { this.state = 'play'; this.message = null; }
    }
    if (this.state === 'result') {
      // Boards keep animating (the loser sinking) while the result shows.
      for (const b of this.boards) if (b.dead) b.step({});
      if (this.clock >= RESULT && (!this.net || this.net.host)) this.nextRound();
      return;
    }
    this.frame++;
    this.playTime += DT;
    this.boards.forEach((b, i) => {
      const input = this.cpus[i]?.input() ?? this.pads[i]?.frame() ?? {};
      b.step(input);
      for (const e of b.events) this.event(i, e);
    });
    if (this.net && this.frame % SNAPSHOT_EVERY === 0) this.net.send({ t: 'st', k: this.seed, s: this.boards[this.net.me].snapshot() });
    if (!this.net || this.net.host) this.checkRound();
  }

  // Host: messages can go missing, so the round start is repeated until the friend's board
  // reports from the same round.
  resendStart() {
    if (!this.net?.host || this.peerSeed === this.seed || this.state === 'result') return;
    if (Math.floor(this.clock) !== Math.floor(this.clock - DT)) this.net.send({ t: 'start', seed: this.seed, wins: this.players.map((p) => p.wins) });
  }

  // One board's event: sounds, and nuisance for the other board.
  event(i, e) {
    const s = this.sound, other = this.boards[1 - i];
    const pan = PAN[i];
    const human = !this.cpus[i];
    const local = !(this.boards[i] instanceof Mirror);
    switch (e.type) {
      case 'move': if (human) s?.sfx('move', pan, 0.5); break;
      case 'turn': if (human) s?.sfx('turn', pan, 0.6); break;
      case 'land': s?.sfx('land', pan, 0.45); break;
      case 'hardDrop': s?.sfx('land', pan, 0.8); break;
      case 'pop':
        s?.chain(e.chain, pan);
        s?.chainVoice(this.players[i].char, e.chain, pan);
        if (e.cancel) s?.sfx('offset', pan, 0.6);
        if (local && e.send) {
          if (this.net) this.net.send({ t: 'atk', k: this.seed, n: e.send });
          else other.receive(e.send);
        }
        break;
      case 'chainEnd':
        if (!local) break;
        if (this.net) this.net.send({ t: 'rel', k: this.seed });
        else other.release();
        break;
      case 'garbage': s?.sfx(e.n >= 6 ? 'garbageBig' : 'garbageSmall', pan, 0.8); break;
      case 'allClear': s?.sfx('allClear', pan); break;
      case 'dead':
        s?.sfx('lose', pan);
        s?.loseVoice(this.players[i].char, pan);
        if (local && this.net) this.net.send({ t: 'st', k: this.seed, s: this.boards[i].snapshot() });
        break;
    }
    this.onFx(i, e);
  }

  // Messages from the friend (online). Round messages carry the round's seed (`k`), so a late
  // one from the round before is dropped.
  receive(m) {
    const mine = this.boards?.[this.net.me];
    if ('k' in m && m.k !== this.seed) return;
    switch (m.t) {
      case 'st': this.peerSeed = m.k; this.boards?.[1 - this.net.me].apply(m.s); break;
      case 'atk': if (this.state === 'play' || this.state === 'go') mine?.receive(m.n); break;
      case 'rel': mine?.release(); break;
      case 'round': if (this.state !== 'result') this.showResult(m.winner, m.wins); break;
      case 'start':
        if (m.seed === this.seed) break;
        this.players.forEach((p, i) => { p.wins = m.wins?.[i] ?? p.wins; });
        this.startRound(m.seed);
        break;
      case 'end': if (!this.over) this.finish(m.winner); break;
    }
  }

  checkRound() {
    if (this.state !== 'play') return;
    const [a, b] = this.boards.map((x) => x.dead);
    if (!a && !b) return;
    const winner = a && b ? -1 : a ? 1 : 0;
    const wins = this.players.map((p, i) => p.wins + (i === winner ? 1 : 0));
    this.showResult(winner, wins);
    this.net?.send({ t: 'round', winner, wins });
  }

  showResult(winner, wins) {
    this.state = 'result';
    this.clock = 0;
    this.result = { winner };
    this.players.forEach((p, i) => {
      p.wins = wins[i];
      p.score += this.boards[i].score;
      p.best = Math.max(p.best, this.boards[i].maxChain ?? 0);
    });
    this.onRound(winner);
  }

  nextRound() {
    const champ = this.players.findIndex((p) => p.wins >= this.toWin);
    if (champ >= 0) {
      // Sent a few times: it is the last message of the match.
      for (const ms of [0, 400, 1200]) setTimeout(() => this.net?.send({ t: 'end', winner: champ }), ms);
      this.finish(champ);
      return;
    }
    const seed = randomSeed();
    this.net?.send({ t: 'start', seed, wins: this.players.map((p) => p.wins) });
    this.startRound(seed);
  }

  finish(winner) {
    this.over = true;
    this.onEnd(winner);
  }
}
