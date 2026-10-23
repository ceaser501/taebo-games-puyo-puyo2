import { loadManifest, Pictures } from './assets.js';
import { Sound } from './sound.js';
import { Match } from './game.js';
import { Renderer } from './render.js';
import { Pad, KEYMAPS } from './pad.js';
import { Net, netErrorText } from './net.js';
import { randomSeed } from './rng.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
let manifest;
let pictures;
let renderer;
let sound = null;
let match = null;
let pads = [null, null];
let lastSetup = null;

// Characters 00-34 from the original. 05 is a joke card, not a fighter. Names only where the
// picture leaves no doubt; the rest show just their picture.
const ROSTER = Array.from({ length: 35 }, (_, i) => i).filter((i) => i !== 5);
const NAMES = {
  0: '아르르', 1: '스켈레톤 T', 10: '파노티', 11: '세리리', 15: '미이라', 19: '하피', 21: '나스 그레이브',
  23: '스케토우다라', 25: '위치', 28: '미노타우로스', 29: '드라코 켄타우로스', 30: '조우 다이마왕', 31: '셰조', 32: '루루', 33: '사탄', 34: '사탄',
};
const charName = (id) => NAMES[id] ?? `#${id}`;
const pick = { me: 0, cpu: 'random' };
let picking = 'me';

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

function ensureSound() {
  sound ??= new Sound();
  sound.resume();
  syncMusicButtons();
  return sound;
}

// ---- menu --------------------------------------------------------------------------------

function buildRoster() {
  const box = $('roster');
  box.innerHTML = '';
  const add = (id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = id;
    if (id === 'random') {
      b.className = 'random';
      b.textContent = '?';
    } else {
      b.style.backgroundImage = `url("assets/p2/hd/GRP_SD_SD_${String(id).padStart(2, '0')}.png")`;
    }
    b.title = id === 'random' ? '랜덤' : charName(id);
    b.onclick = () => {
      if (picking === 'me' && id === 'random') return;
      pick[picking] = id;
      store.set(`puyo-${picking}`, String(id));
      sound?.sfx('select');
      renderRoster();
    };
    box.append(b);
  };
  add('random');
  ROSTER.forEach(add);
  renderRoster();
}

function renderRoster() {
  for (const b of $('roster').children) {
    const id = b.dataset.id === 'random' ? 'random' : Number(b.dataset.id);
    b.classList.toggle('me', pick.me === id);
    b.classList.toggle('cpu', pick.cpu === id);
    b.disabled = picking === 'me' && id === 'random';
  }
  for (const b of $('pick-who').children) b.classList.toggle('on', b.dataset.who === picking);
  const vs = pick.cpu === 'random' ? '랜덤' : charName(pick.cpu);
  $('roster-note').textContent = `나: ${charName(pick.me)} · 상대: ${vs}`;
}

for (const b of $('pick-who').children) b.onclick = () => { picking = b.dataset.who; renderRoster(); };

async function init() {
  manifest = await loadManifest();
  if (!manifest) {
    $('notice').textContent = '원본 데이터가 없어요. npm run puyo:assets 로 먼저 변환해 주세요.';
    $('start').textContent = '데이터 없음';
    return;
  }
  pictures = new Pictures(manifest);
  renderer = new Renderer(canvas, pictures, manifest);
  const me = Number(store.get('puyo-me', '0'));
  pick.me = ROSTER.includes(me) ? me : 0;
  const cpu = store.get('puyo-cpu', 'random');
  pick.cpu = cpu === 'random' || !ROSTER.includes(Number(cpu)) ? 'random' : Number(cpu);
  $('player-name').value = store.get('puyo-name', '');
  $('skin').value = store.get('puyo-skin', 'classic');
  $('rounds').value = store.get('puyo-rounds', '2');
  $('opponent').value = store.get('puyo-opponent', 'normal');
  buildRoster();
  $('start').disabled = false;
  $('start').textContent = '시작';
  if (new URLSearchParams(location.search).has('sfx')) showSfxBoard();
}

const randomChar = (not) => {
  const list = ROSTER.filter((c) => c !== not);
  return list[Math.floor(Math.random() * list.length)];
};
const stageFrame = () => manifest.frames[Math.floor(Math.random() * manifest.frames.length)];
const myName = () => $('player-name').value.trim().slice(0, 8);

function pickSetup() {
  const cpu = $('opponent').value || null;
  const name = myName() || '나';
  store.set('puyo-name', myName());
  store.set('puyo-opponent', $('opponent').value);
  store.set('puyo-rounds', $('rounds').value);
  const other = pick.cpu === 'random' ? randomChar(pick.me) : pick.cpu;
  return {
    toWin: Number($('rounds').value),
    players: [
      { name, char: pick.me, cpu: null },
      { name: cpu ? NAMES[other] ?? '컴퓨터' : '2P', char: other, cpu },
    ],
  };
}

// online: { me, host, send } for a friend match.
async function start(setup = pickSetup(), online = null) {
  ensureSound();
  $('start').disabled = true;
  $('start').textContent = '불러오는 중…';
  renderer.skin = $('skin').value;
  renderer.me = online?.me ?? 0;
  store.set('puyo-skin', renderer.skin);
  const frame = setup.frame ?? stageFrame();
  await renderer.prepare({ frame, chars: setup.players.map((p) => p.char) });
  renderer.reset();
  if (!online) lastSetup = { ...setup, frame };
  const local = !online && !setup.players[1].cpu;
  pads = online
    ? [0, 1].map((i) => (i === online.me ? new Pad(KEYMAPS.solo) : null))
    : local ? [new Pad(KEYMAPS.left), new Pad(KEYMAPS.right)] : [new Pad(KEYMAPS.solo), null];
  const m = new Match({
    players: setup.players,
    pads,
    sound,
    toWin: setup.toWin,
    net: online,
    onEnd: (winner) => { if (match === m) setTimeout(() => showEnd(winner), 1200); },
  });
  match = m;
  m.startRound(online?.seed);
  $('lobby').hidden = true;
  $('menu').hidden = true;
  $('end').hidden = true;
  setTouch(touchDevice);
  const songs = manifest.music.filter((s) => s.loop && s.id.startsWith('PUYO2'));
  sound.playSong(songs[Math.floor(Math.random() * songs.length)]);
  $('start').disabled = false;
  $('start').textContent = '시작';
}

function showEnd(winner) {
  const me = net ? lobby?.me : match?.players[1].cpu ? 0 : null;
  let title = '무승부!';
  if (winner >= 0) title = me != null ? (winner === me ? '승리!' : '패배…') : `${match.players[winner].name} 승리!`;
  $('end-title').textContent = title;
  const [a, b] = match.players;
  $('end-note').textContent = `${a.name} ${a.wins} : ${b.wins} ${b.name}` + (net && !lobby?.host ? ' · 방장이 다시 시작하면 따라가요.' : '');
  $('again').hidden = !!net && (!lobby?.host || !net.connected);
  $('to-lobby').hidden = !net || !lobby?.host;
  $('end').hidden = false;
  setTouch(false);
}

function toMenu() {
  closePause();
  leaveOnline();
  match = null;
  $('lobby').hidden = true;
  $('end').hidden = true;
  $('net-status').textContent = '';
  setTouch(false);
  $('menu').hidden = false;
  sound?.stopMusic();
}

$('start').onclick = () => start();
$('again').onclick = () => (net ? hostStart() : start(lastSetup));
$('to-menu').onclick = toMenu;

// ---- input ---------------------------------------------------------------------------------

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (match && $('end').hidden) togglePause();
    return;
  }
  if (!match || !$('menu').hidden || !$('pause').hidden) return;
  if (document.activeElement?.tagName === 'INPUT') return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  for (const p of pads) if (p?.key(e.code, true)) break;
});
window.addEventListener('keyup', (e) => { for (const p of pads) p?.key(e.code, false); });
window.addEventListener('blur', () => pads.forEach((p) => p?.release()));

const touchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', touchDevice);
function setTouch(on) {
  $('touch').hidden = !on;
  if (!renderer) return;
  renderer.touchReserve = on ? Math.min(150, innerHeight * 0.28) : 0;
  renderer.resize();
}
const myPad = () => pads[net ? lobby.me : 0];
for (const button of document.querySelectorAll('#touch [data-act]')) {
  const act = button.dataset.act;
  let held = false;
  const press = (e) => {
    e.preventDefault();
    try { button.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (held) return;
    held = true;
    button.classList.add('held');
    myPad()?.press(act, true);
  };
  const release = () => {
    if (!held) return;
    held = false;
    button.classList.remove('held');
    myPad()?.press(act, false);
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
}
$('t-menu').onclick = () => togglePause();

// Finger on the field: drag sideways to move a column at a time, drag down to drop fast,
// tap to turn (right half of the screen clockwise, left half the other way).
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!match || !myPad() || !$('pause').hidden || !$('end').hidden) return;
  e.preventDefault();
  gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t0: performance.now(), moved: false, soft: false };
});
canvas.addEventListener('pointermove', (e) => {
  const g = gesture, pad = myPad();
  if (!g || g.id !== e.pointerId || !pad) return;
  const step = Math.max(18, renderer.cellPx * 0.75);
  while (Math.abs(e.clientX - g.x) >= step) {
    const dir = Math.sign(e.clientX - g.x);
    pad.nudge(dir);
    g.x += dir * step;
    g.moved = true;
  }
  const dy = e.clientY - g.y0, dx = Math.abs(e.clientX - g.x0);
  if (!g.soft && dy > step * 1.2 && dy > dx) { g.soft = true; g.moved = true; pad.press('down', true); }
  else if (g.soft && dy < step * 0.6) { g.soft = false; pad.press('down', false); }
});
const endGesture = (e) => {
  const g = gesture;
  if (!g || g.id !== e.pointerId) return;
  gesture = null;
  const pad = myPad();
  if (!pad) return;
  if (g.soft) pad.press('down', false);
  if (!g.moved && performance.now() - g.t0 < 350) pad.press(e.clientX > innerWidth / 2 ? 'cw' : 'ccw', true);
};
canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', (e) => { if (gesture?.soft) myPad()?.press('down', false); gesture = null; });

// In-game menu: the match waits while it is open (not online).
let quitArmed = null;
function togglePause() {
  if ($('pause').hidden) openPause(); else closePause();
}
function openPause() {
  if (!match) return;
  $('pause-note').textContent = net ? '온라인 게임은 메뉴를 열어도 계속 진행돼요. 나가면 친구와의 게임이 끝나요.' : '';
  $('pause').hidden = false;
  pads.forEach((p) => p?.release());
  if (!net) match.paused = true;
}
function closePause() {
  $('pause').hidden = true;
  $('quit').textContent = '게임 나가기';
  clearTimeout(quitArmed);
  quitArmed = null;
  if (match) match.paused = false;
}
$('resume').onclick = closePause;
$('quit').onclick = () => {
  if (!quitArmed) {
    $('quit').textContent = '정말 나갈까요? 한 번 더 누르세요';
    quitArmed = setTimeout(() => { $('quit').textContent = '게임 나가기'; quitArmed = null; }, 3000);
    return;
  }
  toMenu();
};

function syncMusicButtons() {
  const label = sound?.musicOn === false ? '배경음악 꺼짐' : '배경음악 켜짐 ♪';
  for (const id of ['menu-music', 'pause-music']) $(id).textContent = label;
}
for (const id of ['menu-music', 'pause-music']) {
  $(id).onclick = () => { ensureSound().toggleMusic(); syncMusicButtons(); };
}

// `?sfx`: every original sound on a button, and the songs, to find out which is which.
function showSfxBoard() {
  $('menu').hidden = true;
  $('sfx').hidden = false;
  const list = $('sfx-list');
  for (const [bank, clips] of Object.entries(manifest.sfx)) {
    const row = document.createElement('div');
    row.className = 'sfx-row';
    row.append(Object.assign(document.createElement('b'), { textContent: bank }));
    clips.forEach((ms, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(i);
      b.title = `${ms}ms`;
      b.onclick = () => ensureSound().play(`${bank}_${String(i).padStart(2, '0')}`);
      row.append(b);
    });
    list.append(row);
  }
  const row = document.createElement('div');
  row.className = 'sfx-row';
  row.append(Object.assign(document.createElement('b'), { textContent: '음악' }));
  for (const song of manifest.music) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = song.id.replace('PUYO2_', '').replace('NAZOP_', 'N');
    b.onclick = () => ensureSound().playSong(song);
    row.append(b);
  }
  const stop = Object.assign(document.createElement('button'), { type: 'button', textContent: '■' });
  stop.onclick = () => sound?.stopMusic();
  row.append(stop);
  list.append(row);
}

// ---- online 1:1 --------------------------------------------------------------------------
// The host opens a room and waits in the lobby; the friend joins with the code and says hello
// with their name and character; the host presses Start. Each screen runs its own board and
// streams it to the other (game.js), nuisance goes across as messages.

let net = null;
let lobby = null; // { host, me, code, hostName, hostChar, guestName, guestChar, guestState }
let goMsg = null; // host: the start message, repeated until the friend's board shows up

function netStatus(text) { $('net-status').textContent = text; }
function lobbyStatus(text) { $('lobby-status').textContent = text; }

function onlineName() {
  const name = myName();
  if (!name) {
    netStatus('먼저 내 이름을 입력해 주세요.');
    $('player-name').focus();
    return null;
  }
  store.set('puyo-name', name);
  return name;
}

function showLobby() {
  match = null;
  setTouch(false);
  $('menu').hidden = true;
  $('end').hidden = true;
  $('lobby').hidden = false;
  renderLobby();
}

function renderLobby() {
  $('lobby-code').textContent = lobby.code;
  $('slot-host').querySelector('span').textContent = lobby.hostName ? `${lobby.hostName} · ${charName(lobby.hostChar)}` : '방장';
  const guest = $('slot-guest');
  guest.className = lobby.guestState;
  guest.querySelector('span').textContent = { waiting: '친구를 기다리는 중', connecting: '들어오는 중', joined: `${lobby.guestName} · ${charName(lobby.guestChar)}` }[lobby.guestState];
  guest.querySelector('em').textContent = lobby.guestState === 'joined' ? '입장' : '';
  $('lobby-start').hidden = !lobby.host;
  $('lobby-start').disabled = lobby.guestState !== 'joined';
}

function openNet() {
  net?.close();
  net = new Net({
    onIncoming: () => { lobby.guestState = 'connecting'; lobbyStatus('친구가 들어오고 있어요…'); renderLobby(); },
    onConnected: () => { if (!lobby.host) net.send({ t: 'hello', name: lobby.guestName, char: lobby.guestChar }); },
    onMessage: (msg) => { if (net) (lobby.host ? fromGuest : fromHost)(msg); },
    onClosed: () => friendLeft(),
    onLost: () => netBanner(lobby?.host ? '친구 연결이 잠시 끊겼어요. 다시 들어오길 기다리는 중…' : '방장과 연결이 잠시 끊겼어요. 다시 연결하는 중…'),
    onBack: () => netBanner(''),
    onError: (err) => {
      if (lobby?.host) { lobby.guestState = 'waiting'; renderLobby(); }
      ($('lobby').hidden ? netStatus : lobbyStatus)(netErrorText(err));
    },
  });
  return net;
}

async function hostRoom() {
  const name = onlineName();
  if (!name) return;
  ensureSound();
  netStatus('방을 만드는 중…');
  try {
    const code = await openNet().host();
    lobby = { host: true, me: 0, code, hostName: name, hostChar: pick.me, guestState: 'waiting' };
    netStatus('');
    showLobby();
    lobbyStatus('친구에게 방 코드를 알려 주세요.');
  } catch (err) {
    netStatus(netErrorText(err));
  }
}

async function joinRoom() {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 5) { netStatus('5자리 방 코드를 입력해 주세요.'); return; }
  const name = onlineName();
  if (!name) return;
  ensureSound();
  lobby = { host: false, me: 1, code, guestName: name, guestChar: pick.me, guestState: 'joined' };
  showLobby();
  $('slot-host').querySelector('span').textContent = '방 찾는 중…';
  lobbyStatus('방에 연결하는 중…');
  try {
    await openNet().join(code);
  } catch (err) {
    lobbyStatus(netErrorText(err));
  }
}

const lobbyMsg = () => ({ t: 'lobby', host: lobby.hostName, hostChar: lobby.hostChar, guest: lobby.guestName, guestChar: lobby.guestChar });
const sendNet = (msg) => net?.send(msg);

function setupFrom(msg) {
  return {
    toWin: msg.toWin,
    frame: msg.frame,
    players: [{ name: msg.host, char: msg.hostChar, cpu: null }, { name: msg.guest, char: msg.guestChar, cpu: null }],
  };
}

// Host: starts (or restarts) the match.
async function hostStart() {
  if (!lobby?.host || lobby.guestState !== 'joined') return;
  goMsg = { ...lobbyMsg(), t: 'go', id: Math.random().toString(36).slice(2), seed: randomSeed(), toWin: Number($('rounds').value), frame: stageFrame() };
  net.send(goMsg);
  await start(setupFrom(goMsg), { me: 0, host: true, seed: goMsg.seed, send: sendNet });
}

setInterval(() => {
  if (!goMsg || !lobby?.host || !net?.connected) return;
  if (match?.peerSeed != null) { goMsg = null; return; }
  net.send(goMsg);
}, 1500);

function backToLobby() {
  if (!lobby?.host) return;
  goMsg = null;
  net?.send(lobbyMsg());
  showLobby();
  lobbyStatus(lobby.guestState === 'joined' ? '준비되면 게임 시작을 누르세요.' : '친구에게 방 코드를 알려 주세요.');
}

function chime() {
  sound?.sfx('decide');
}

function fromGuest(msg) {
  if (msg.t === 'bye') { net.dropGuest(); friendLeft(); return; }
  if (msg.t === 'hello') {
    lobby.guestName = String(msg.name || '친구').slice(0, 8);
    lobby.guestChar = ROSTER.includes(msg.char) ? msg.char : 0;
    lobby.guestState = 'joined';
    if (!$('lobby').hidden) renderLobby();
    lobbyStatus(`${lobby.guestName} 님이 들어왔어요. 게임 시작을 누르세요.`);
    chime();
    net.send(lobbyMsg());
    return;
  }
  match?.receive(msg);
}

let joinedGo = null;
async function fromHost(msg) {
  if (msg.t === 'bye') { friendLeft(); return; }
  if (msg.t === 'lobby') {
    Object.assign(lobby, { hostName: msg.host, hostChar: msg.hostChar, guestName: msg.guest, guestChar: msg.guestChar, guestState: 'joined' });
    showLobby();
    lobbyStatus('방장이 게임을 시작하길 기다리는 중…');
    return;
  }
  if (msg.t === 'go') {
    if (msg.id === joinedGo) return;
    joinedGo = msg.id;
    await start(setupFrom(msg), { me: 1, host: false, seed: msg.seed, send: sendNet });
    return;
  }
  match?.receive(msg);
}

function netBanner(text) {
  $('net-banner').textContent = text;
  $('net-banner').hidden = !text;
}

function friendLeft() {
  if (!net || !lobby) return;
  netBanner('');
  closePause();
  if (lobby.host) {
    lobby.guestState = 'waiting';
    lobby.guestName = null;
    goMsg = null;
    if (match) { match.paused = true; endWithText('친구와 연결이 끊겼어요'); return; }
    renderLobby();
    lobbyStatus('친구가 나갔어요. 같은 코드로 다시 들어올 수 있어요.');
  } else {
    net.close();
    net = null;
    if (match) { match.paused = true; endWithText('방장과 연결이 끊겼어요'); return; }
    lobbyStatus('방장이 방을 닫았어요.');
  }
}

function endWithText(text) {
  $('end-title').textContent = text;
  $('end-note').textContent = '';
  $('again').hidden = true;
  $('to-lobby').hidden = !lobby?.host;
  $('end').hidden = false;
  setTouch(false);
}

function leaveOnline() {
  const leaving = net;
  leaving?.send({ t: 'bye' });
  setTimeout(() => leaving?.close(), 500);
  netBanner('');
  net = null;
  lobby = null;
  goMsg = null;
  joinedGo = null;
}

$('host').onclick = hostRoom;
$('join').onclick = joinRoom;
$('lobby-start').onclick = hostStart;
$('lobby-leave').onclick = () => toMenu();
$('to-lobby').onclick = backToLobby;
$('copy-code').onclick = async () => {
  try {
    await navigator.clipboard.writeText(lobby.code);
    $('copy-code').textContent = '복사됨';
    setTimeout(() => { $('copy-code').textContent = '복사'; }, 1500);
  } catch { /* clipboard blocked: the code is selectable text */ }
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
window.addEventListener('pagehide', () => net?.send({ t: 'bye' }));

// ---- loop ----------------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (match && renderer) {
    match.update(dt);
    for (let k = Math.round(dt * 60); k > 0; k--) renderer.step();
    renderer.draw(match);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- full screen, installing, in-app browsers ----------------------------------------------

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

async function enterFullscreen() {
  if (!canFullscreen || standalone || document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement;
  try {
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
  } catch { /* the browser said no; play on as is */ }
}

if (touchDevice && canFullscreen && !standalone) {
  for (const id of ['start', 'again', 'host', 'join', 'lobby-start']) $(id).addEventListener('click', enterFullscreen);
  for (const id of ['menu-full', 'pause-full']) { $(id).hidden = false; $(id).onclick = enterFullscreen; }
}
if (isIOS && !standalone) $('ios-help').hidden = false;

if (/KAKAOTALK/i.test(ua)) {
  const openOutside = () => { location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`; };
  $('kakao').hidden = false;
  $('kakao-open').onclick = openOutside;
  $('kakao-stay').onclick = () => { $('kakao').hidden = true; };
  let tried = false;
  try { tried = sessionStorage.getItem('kakao-external') === '1'; sessionStorage.setItem('kakao-external', '1'); } catch { /* try once anyway */ }
  if (!tried) openOutside();
}

$('build').textContent = `버전 ${typeof BUILD_ID === 'undefined' ? 'dev' : BUILD_ID}`;
init();

// For automated checks.
window.puyo = { get match() { return match; }, get renderer() { return renderer; } };
