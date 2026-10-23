// Plays the original MIDI music with a small General MIDI-ish synthesizer built from WebAudio
// oscillators: one tone recipe per instrument family, drums from noise and sine sweeps.
// The songs were written for a GM module, channel 10 (index 9) is drums, and channels 11-16
// are mostly echo layers of 1-6, which the songs play quietly on purpose.

// ---- parsing -----------------------------------------------------------------------------

export function parseMidi(buf) {
  const d = new DataView(buf);
  const u8 = (i) => d.getUint8(i);
  const str = (i) => String.fromCharCode(u8(i), u8(i + 1), u8(i + 2), u8(i + 3));
  if (str(0) !== 'MThd') throw new Error('not a MIDI file');
  const tracks = d.getUint16(10), div = d.getUint16(12);
  const events = [];
  let p = 8 + d.getUint32(4);
  let end = 0;
  for (let t = 0; t < tracks && p < buf.byteLength; t++) {
    const len = d.getUint32(p + 4);
    let i = p + 8;
    const stop = i + len;
    let tick = 0, run = 0;
    const vlq = () => { let v = 0, b; do { b = u8(i++); v = (v << 7) | (b & 127); } while (b & 128); return v; };
    while (i < stop) {
      tick += vlq();
      let st = u8(i);
      if (st >= 0x80) { i++; if (st < 0xf0) run = st; } else st = run;
      if (st === 0xff) {
        const type = u8(i++), n = vlq();
        if (type === 0x51) events.push({ tick, type: 'tempo', v: (u8(i) << 16) | (u8(i + 1) << 8) | u8(i + 2) });
        i += n;
      } else if (st === 0xf0 || st === 0xf7) {
        i += vlq();
      } else {
        const hi = st & 0xf0, ch = st & 15;
        const a = u8(i++), b = hi === 0xc0 || hi === 0xd0 ? 0 : u8(i++);
        events.push({ tick, type: hi, ch, a, b });
      }
    }
    end = Math.max(end, tick);
    p = stop;
  }
  events.sort((x, y) => x.tick - y.tick);
  // Ticks to seconds through the tempo changes.
  let us = 500000, last = 0, sec = 0;
  for (const e of events) {
    sec += ((e.tick - last) * us) / div / 1e6;
    last = e.tick;
    e.t = sec;
    if (e.type === 'tempo') us = e.v;
  }
  const length = sec + ((end - last) * us) / div / 1e6;
  return { events: events.filter((e) => e.type !== 'tempo'), length };
}

// ---- instruments -------------------------------------------------------------------------

// Per GM family (program / 8): oscillator type, filter cutoff, envelope (attack, decay to
// sustain level, release), and an optional second oscillator an octave/partial up.
const FAMILY = [
  { wave: 'triangle', cut: 4000, a: 0.004, d: 1.4, s: 0.15, r: 0.35, extra: [2, 'sine', 0.3] }, // piano
  { wave: 'sine', cut: 8000, a: 0.002, d: 0.6, s: 0, r: 0.4, extra: [3.5, 'sine', 0.25] }, // chromatic perc
  { wave: 'sine', cut: 5000, a: 0.01, d: 0.1, s: 0.9, r: 0.08, extra: [2, 'square', 0.12] }, // organ
  { wave: 'sawtooth', cut: 2200, a: 0.003, d: 0.9, s: 0.1, r: 0.2 }, // guitar
  { wave: 'triangle', cut: 1200, a: 0.004, d: 0.5, s: 0.6, r: 0.1, extra: [1, 'square', 0.25] }, // bass
  { wave: 'sawtooth', cut: 2600, a: 0.08, d: 0.3, s: 0.8, r: 0.4 }, // strings
  { wave: 'sawtooth', cut: 2400, a: 0.12, d: 0.3, s: 0.8, r: 0.5, detune: 8 }, // ensemble
  { wave: 'sawtooth', cut: 3200, a: 0.03, d: 0.2, s: 0.75, r: 0.15 }, // brass
  { wave: 'square', cut: 2600, a: 0.03, d: 0.2, s: 0.75, r: 0.12 }, // reed
  { wave: 'sine', cut: 6000, a: 0.04, d: 0.2, s: 0.85, r: 0.15, extra: [2, 'triangle', 0.15] }, // pipe
  { wave: 'square', cut: 3500, a: 0.005, d: 0.2, s: 0.7, r: 0.12 }, // synth lead
  { wave: 'sawtooth', cut: 1800, a: 0.25, d: 0.5, s: 0.8, r: 0.8, detune: 10 }, // synth pad
  { wave: 'triangle', cut: 3000, a: 0.05, d: 0.6, s: 0.5, r: 0.6 }, // synth fx
  { wave: 'triangle', cut: 3000, a: 0.003, d: 0.7, s: 0.1, r: 0.2 }, // ethnic
  { wave: 'sine', cut: 4000, a: 0.002, d: 0.3, s: 0, r: 0.2 }, // percussive
  { wave: 'triangle', cut: 2000, a: 0.02, d: 0.5, s: 0.3, r: 0.3 }, // sound fx
];

const freq = (note) => 440 * 2 ** ((note - 69) / 12);

export class MidiPlayer {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.song = null;
    this.timer = null;
    this.noise = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const c = b.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = Math.random() * 2 - 1;
      return b;
    })();
  }

  play(song, loop = true) {
    this.stop();
    this.song = song;
    this.loop = loop;
    this.chans = Array.from({ length: 16 }, () => ({ prog: 0, vol: 100 / 127, expr: 1, pan: 0, bend: 0, panNode: null }));
    this.voices = new Map();
    this.start = this.ctx.currentTime + 0.1;
    this.index = 0;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(1, this.ctx.currentTime);
    this.tick();
    this.timer = setInterval(() => this.tick(), 50);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.voices) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices.values()) for (const x of v) this.release(x, t, 0.05);
    this.voices.clear();
    this.song = null;
  }

  get playing() { return !!this.timer; }

  // Schedules everything due in the next quarter second.
  tick() {
    const song = this.song;
    if (!song) return;
    const ahead = this.ctx.currentTime + 0.25;
    for (;;) {
      if (this.index >= song.events.length) {
        if (!this.loop) {
          if (this.start + song.length < this.ctx.currentTime) this.stop();
          return;
        }
        this.start += song.length;
        this.index = 0;
      }
      const e = song.events[this.index];
      const t = this.start + e.t;
      if (t > ahead) return;
      this.event(e, Math.max(t, this.ctx.currentTime));
      this.index++;
    }
  }

  channelOut(ch) {
    const c = this.chans[ch];
    if (!c.panNode) {
      c.gain = this.ctx.createGain();
      c.gain.gain.value = c.vol * c.vol * c.expr;
      c.panNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
      c.gain.connect(c.panNode).connect(this.out);
    }
    return c;
  }

  event(e, t) {
    const c = this.channelOut(e.ch);
    switch (e.type) {
      case 0x90: if (e.b) { this.noteOn(e.ch, e.a, e.b / 127, t); break; } // velocity 0: off
      // falls through
      case 0x80: this.noteOff(e.ch, e.a, t); break;
      case 0xc0: c.prog = e.a; break;
      case 0xb0:
        if (e.a === 7) c.vol = e.b / 127;
        else if (e.a === 11) c.expr = e.b / 127;
        else if (e.a === 10 && c.panNode.pan) c.panNode.pan.setValueAtTime((e.b - 64) / 64, t);
        else if (e.a === 120 || e.a === 123) this.allOff(e.ch, t);
        c.gain.gain.setValueAtTime(c.vol * c.vol * c.expr, t);
        break;
      case 0xe0: {
        c.bend = (((e.b << 7) | e.a) - 8192) / 8192 * 2; // semitones
        for (const [key, list] of this.voices) {
          if (key >> 7 !== e.ch) continue;
          for (const v of list) for (const o of v.oscs) o.detune.setValueAtTime(c.bend * 100 + (o.base || 0), t);
        }
        break;
      }
    }
  }

  noteOn(ch, note, vel, t) {
    const c = this.chans[ch];
    if (ch === 9) { this.drum(note, vel, t, c.gain); return; }
    const f = FAMILY[c.prog >> 3];
    const ctx = this.ctx;
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(f.cut * (0.6 + vel * 0.6), 12000);
    filter.connect(env).connect(c.gain);
    const peak = 0.16 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + f.a);
    env.gain.setTargetAtTime(peak * f.s, t + f.a, f.d / 3);
    const oscs = [];
    const osc = (type, mult, level, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq(note) * mult;
      o.base = detune;
      o.detune.value = c.bend * 100 + detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(t);
      oscs.push(o);
    };
    osc(f.wave, 1, 1, f.detune ? -f.detune : 0);
    if (f.detune) osc(f.wave, 1, 0.7, f.detune);
    if (f.extra) osc(f.extra[1], f.extra[0], f.extra[2]);
    const v = { env, oscs, r: f.r, s: f.s };
    const key = (ch << 7) | note;
    if (!this.voices.has(key)) this.voices.set(key, []);
    this.voices.get(key).push(v);
    // Decaying sounds end on their own.
    if (f.s === 0) this.release(v, t + f.d * 1.5, f.r);
  }

  noteOff(ch, note, t) {
    const key = (ch << 7) | note;
    const list = this.voices.get(key);
    if (!list?.length) return;
    this.release(list.shift(), t, null);
    if (!list.length) this.voices.delete(key);
  }

  allOff(ch, t) {
    for (const [key, list] of this.voices) {
      if (key >> 7 !== ch) continue;
      for (const v of list) this.release(v, t, 0.05);
      this.voices.delete(key);
    }
  }

  release(v, t, r) {
    if (v.done) return;
    v.done = true;
    const time = r ?? v.r;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, time / 3);
    for (const o of v.oscs) o.stop(t + time + 0.05);
  }

  drum(note, vel, t, out) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(out);
    const noise = (dur, type, f, q = 1, level = 0.5) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const fl = ctx.createBiquadFilter();
      fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const e = ctx.createGain();
      e.gain.setValueAtTime(level * vel, t);
      e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(fl).connect(e).connect(g);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.02);
    };
    const tone = (dur, f0, f1, level = 0.8) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(level * vel, t);
      e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(e).connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    if (note === 35 || note === 36) tone(0.28, 140, 45, 0.9);
    else if (note === 38 || note === 40 || note === 37 || note === 39) { noise(0.18, 'bandpass', 1800, 0.8, 0.5); tone(0.1, 220, 120, 0.35); }
    else if (note === 42 || note === 44) noise(0.05, 'highpass', 8000, 1, 0.22);
    else if (note === 46) noise(0.25, 'highpass', 7000, 1, 0.2);
    else if (note === 49 || note === 57 || note === 52 || note === 55) noise(1.0, 'highpass', 5000, 0.7, 0.25);
    else if (note === 51 || note === 59 || note === 53) noise(0.4, 'bandpass', 6000, 2, 0.15);
    else if (note >= 41 && note <= 50) tone(0.3, 90 + (note - 41) * 22, 60 + (note - 41) * 15, 0.6);
    else noise(0.08, 'bandpass', 3000, 1.5, 0.2);
  }
}
