// Sound effects, character voices and music, all through one AudioContext (phones unlock it on
// the first tap). The sound banks have no names, so which clip is which was picked by length and
// shape: the seven chain pops are PUYO01_02-08, rising in pitch. `?sfx` on the page lists every
// clip to listen to.
import { sfxUrl, musicUrl, bgmUrl } from './assets.js';
import { parseMidi, MidiPlayer } from './midi.js';

const SFX = {
  move: 'PUYO01_14',
  turn: 'PUYO01_12',
  land: 'PUYO01_00',
  garbageSmall: 'PUYO01_17',
  garbageBig: 'PUYO01_10',
  offset: 'PUYO01_09',
  allClear: 'PUYO01_11',
  lose: 'PUYO01_23',
  select: 'PUYO04_01',
  decide: 'PUYO04_02',
};
const CHAIN = ['PUYO01_02', 'PUYO01_03', 'PUYO01_04', 'PUYO01_05', 'PUYO01_06', 'PUYO01_07', 'PUYO01_08'];
// Arle's spell for each chain step (1, 2, 3, ... 7+), and her "bataan kyuu" when she loses.
const ARLE = { chain: ['ARLE_GM_00', 'ARLE_GM_01', 'ARLE_GM_02', 'ARLE_GM_03', 'ARLE_GM_04', 'ARLE_GM_06', 'ARLE_GM_11'], lose: 'ARLE_GM_08' };
const voice = (id, kind) => `VOIC${String(id).padStart(2, '0')}${kind}_00`;

const KEY = 'puyo-music';
const MUSIC_VOLUME = 0.32;
// The OGG songs are mastered much louder than the synth plays the MIDI ones.
const OGG_VOLUME = 0.55;

export class Sound {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = MUSIC_VOLUME;
    this.musicGain.connect(this.ctx.destination);
    this.player = new MidiPlayer(this.ctx, this.musicGain);
    this.oggGain = this.ctx.createGain();
    this.oggGain.gain.value = OGG_VOLUME;
    this.oggGain.connect(this.musicGain);
    this.track = null; // the OGG song playing
    this.buffers = {};
    this.songs = {};
    try { this.musicOn = localStorage.getItem(KEY) !== 'off'; } catch { this.musicOn = true; }
    this.wanted = null; // the song that should be playing
    const unlock = () => this.resume();
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx.suspend?.();
      else this.resume();
    });
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.wanted && this.musicOn && !this.player.playing && !this.track) this.playSong(this.wanted);
  }

  buffer(id) {
    this.buffers[id] ??= fetch(sfxUrl(id))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => b && new Promise((res) => this.ctx.decodeAudioData(b, res, () => res(null))))
      .catch(() => null);
    return this.buffers[id];
  }

  preload(ids) { return Promise.all(ids.map((id) => this.buffer(id))); }

  preloadGame(chars) {
    return this.preload([...Object.values(SFX), ...CHAIN, ...ARLE.chain, ARLE.lose, ...chars.flatMap((c) => [voice(c, 'S'), voice(c, 'L')])]);
  }

  async play(id, gain = 1, pan = 0) {
    const buf = await this.buffer(id);
    if (!buf || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.master);
    src.start();
  }

  sfx(name, pan = 0, gain = 0.8) { if (SFX[name]) this.play(SFX[name], gain, pan); }
  chain(n, pan = 0) { this.play(CHAIN[Math.min(n, CHAIN.length) - 1], 0.8, pan); }

  // A character's voice for a chain step: Arle names her spells; the others have a short and a
  // long line, the long one for big chains.
  chainVoice(char, n, pan = 0) {
    if (char === 0) this.play(ARLE.chain[Math.min(n, ARLE.chain.length) - 1], 1, pan);
    else if (n === 2) this.play(voice(char, 'S'), 1, pan);
    else if (n === 4) this.play(voice(char, 'L'), 1, pan);
  }

  loseVoice(char, pan = 0) { if (char === 0) this.play(ARLE.lose, 1, pan); }

  // ---- music ----

  async song(id) {
    this.songs[id] ??= fetch(musicUrl(id))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? parseMidi(b) : null))
      .catch(() => null);
    return this.songs[id];
  }

  // entry: { id, loop } for a MIDI song, { id, ogg: true, fallback } for an OGG one. An OGG
  // the browser can't decode plays its MIDI fallback instead.
  async playSong(entry) {
    this.wanted = entry;
    if (!this.musicOn || this.ctx.state !== 'running') return;
    if (entry.ogg) {
      const buf = await this.oggBuffer(entry.id);
      if (this.wanted !== entry) return;
      if (!buf) { if (entry.fallback) this.playSong(entry.fallback); return; }
      if (this.track?.entry === entry) return;
      this.stopTracks();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.oggGain);
      src.start();
      this.track = { src, entry };
      return;
    }
    const song = await this.song(entry.id);
    if (song && this.wanted === entry) {
      this.stopTracks();
      this.player.play(song, entry.loop);
    }
  }

  oggBuffer(id) {
    this.songs[`ogg:${id}`] ??= fetch(bgmUrl(id))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => b && new Promise((res) => this.ctx.decodeAudioData(b, res, () => res(null))))
      .catch(() => null);
    return this.songs[`ogg:${id}`];
  }

  stopTracks() {
    this.player.stop();
    try { this.track?.src.stop(); } catch { /* already stopped */ }
    this.track = null;
  }

  stopMusic() {
    this.wanted = null;
    this.stopTracks();
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem(KEY, this.musicOn ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (!this.musicOn) this.stopTracks();
    else if (this.wanted) this.playSong(this.wanted);
    return this.musicOn;
  }
}
