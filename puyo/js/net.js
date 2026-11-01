// Two-player online matches relayed through a Supabase Realtime channel (broadcast + presence).
// The room number names the channel, presence tells who is in it, and every game
// message is a broadcast the other side receives. Results go to the puyo_results table.
import { createClient } from '@supabase/supabase-js';

// Public project URL and publishable key; Realtime broadcast needs nothing more.
const SUPABASE_URL = 'https://gxyckkinlygeasruapmj.supabase.co';
const SUPABASE_KEY = 'sb_publishable__NKAf1NZsOddwbkgqYGTbw_Smez0lcv';
const PREFIX = 'tbpuyo2-';
const CONNECT_TIMEOUT = 15000;
const FIND_HOST_TIMEOUT = 8000;
// How long a player may drop off (a phone switching apps, a flaky network) before the match ends.
const GRACE = 20000;

// Room numbers are four digits, like Worms: easy to say out loud and to type on a phone.
export const CODE_LENGTH = 4;
const roomCode = () => String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
// How long to listen for another host before taking a room number.
const ROOM_CHECK = 1200;
const randomId = () => Math.random().toString(36).slice(2, 10);

let client = null;
function realtime() {
  // Tests swap in a stand-in with the same channel API.
  const create = window.__fakeSupabase || createClient;
  client ??= create(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 50 } } });
  return client;
}

export class Net {
  // onIncoming: host only, someone entered the room. onConnected: guest only, the host is there.
  // onMessage: a game message from the other player. onClosed: the other player left.
  // onLost / onBack: the other player dropped off and is being waited for / came back.
  constructor({ onIncoming = () => {}, onConnected, onMessage, onClosed, onError, onLost = () => {}, onBack = () => {} }) {
    Object.assign(this, { onIncoming, onConnected, onMessage, onClosed, onError, onLost, onBack });
    this.channel = null;
    this.peerId = null; // host: the friend's presence key
  }

  // Joins the room's channel under `key` and resolves once subscribed.
  open(code, key) {
    this.key = key;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject({ type: 'timeout' }), CONNECT_TIMEOUT);
      this.channel = realtime().channel(PREFIX + code, { config: { broadcast: { self: false }, presence: { key } } });
      this.channel
        .on('broadcast', { event: 'm' }, ({ payload }) => this.receive(payload))
        .on('presence', { event: 'sync' }, () => this.presenceChanged())
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            await this.channel.track({ at: Date.now() });
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer);
            reject({ type: 'server' });
          }
        });
    });
  }

  // Host: opens a room and resolves with its number. With only 10,000 numbers, it first makes
  // sure nobody else is hosting under the one it drew, and draws again if so.
  async host() {
    this.role = 'host';
    for (let tries = 0; tries < 5; tries++) {
      const code = roomCode();
      await this.open(code, 'host');
      await new Promise((r) => setTimeout(r, ROOM_CHECK));
      // Our own presence is listed under 'host'; a second entry there is someone else's room.
      if ((this.channel.presenceState().host?.length ?? 0) <= 1) return code;
      this.close();
    }
    throw { type: 'server' };
  }

  // Guest: enters the room and resolves once the host is seen there.
  async join(code) {
    this.role = 'guest';
    await this.open(code.trim(), `guest-${randomId()}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject({ type: 'no-room' }), FIND_HOST_TIMEOUT);
      this.foundHost = () => { clearTimeout(timer); resolve(); };
      this.presenceChanged();
    });
    this.onConnected();
  }

  presenceChanged() {
    if (!this.channel) return;
    const keys = Object.keys(this.channel.presenceState());
    if (this.role === 'guest') {
      const hostHere = keys.includes('host');
      if (hostHere && this.foundHost) { this.foundHost(); this.foundHost = null; this.hostSeen = true; }
      else if (hostHere) this.back();
      else if (this.hostSeen) this.lost(() => { this.hostSeen = false; this.onClosed(); });
      return;
    }
    const guests = keys.filter((k) => k.startsWith('guest-'));
    if (this.peerId && guests.includes(this.peerId)) {
      this.back();
    } else if (this.peerId) {
      this.lost(() => { this.peerId = null; this.incoming = false; this.onClosed(); });
    } else if (!this.peerId && guests.length && !this.incoming) {
      this.incoming = true;
      this.onIncoming();
    } else if (!guests.length && this.incoming) {
      // Someone looked in and left before saying hello.
      this.incoming = false;
      this.onClosed();
    }
  }

  // The other player vanished from the room: wait a little before giving up on them.
  lost(giveUp) {
    if (this.lostTimer) return;
    this.lostTimer = setTimeout(() => { this.lostTimer = null; giveUp(); }, GRACE);
    this.onLost();
  }

  back() {
    if (!this.lostTimer) return;
    clearTimeout(this.lostTimer);
    this.lostTimer = null;
    this.onBack();
  }

  receive({ f, to, m }) {
    if (to && to !== this.key) return;
    if (this.role === 'guest') {
      if (f !== 'host') return;
      if (m.t === 'full') { this.onError({ type: 'full' }); return; }
      this.onMessage(m);
      return;
    }
    // Host: the first guest to say hello gets the seat; anyone else is turned away.
    if (!this.peerId && m.t === 'hello') this.peerId = f;
    if (f !== this.peerId) { if (m.t === 'hello') this.post({ to: f, m: { t: 'full' } }); return; }
    this.onMessage(m);
  }

  post(payload) {
    this.channel?.send({ type: 'broadcast', event: 'm', payload: { f: this.key, ...payload } });
  }

  get connected() { return this.role === 'host' ? !!this.peerId : !!this.hostSeen; }

  send(msg) {
    if (!this.connected) return;
    this.post(this.role === 'host' ? { to: this.peerId, m: msg } : { m: msg });
  }

  // Host: lets the current friend go but keeps the room open for the next one.
  dropGuest() {
    this.peerId = null;
    this.incoming = false;
  }

  close() {
    clearTimeout(this.lostTimer);
    this.lostTimer = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.untrack?.();
      realtime().removeChannel(channel);
    }
  }
}

// Readable messages for the connection problems a player can run into.
export function netErrorText(err) {
  switch (err?.type) {
    case 'no-room': return '그 번호의 방이 없어요. 번호를 다시 확인하거나, 방장이 대기실에 있는지 확인해 주세요.';
    case 'full': return '이미 다른 친구가 들어가 있는 방이에요.';
    case 'server': return '연결 서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.';
    case 'timeout': return '15초 동안 연결 서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.';
    default: return `연결 오류: ${err?.message || err}`;
  }
}

// ---- ranking ---------------------------------------------------------------------------------
// Online results go to the puyo_results table (anyone may read and add, nobody may change);
// the puyo_ranking views total them per name.

export async function recordResults(rows) {
  const { error } = await realtime().from('puyo_results').insert(rows);
  if (error) throw error;
}

// [{ name, points, games, wins, best_chain, best_score }] best first; `month` limits it to this month.
export async function fetchRanking(month = false) {
  const { data, error } = await realtime()
    .from(month ? 'puyo_ranking_month' : 'puyo_ranking')
    .select('name, points, games, wins, best_chain, best_score')
    .order('points', { ascending: false })
    .order('wins', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

// ---- accounts and records ------------------------------------------------------------------
// A name is the player's id; the password is asked once per phone. The server hands back a
// token the phone keeps, and every later call uses that (see the puyo_* SQL functions).

// Why signing in failed, in words for the player.
const SIGN_IN_ERRORS = {
  bad_name: '이름은 1~10자로 넣어 주세요.',
  bad_pass: '비밀번호는 4자 이상으로 넣어 주세요.',
  wrong_pass: '비밀번호가 맞지 않아요. 이미 있는 이름이면 그 이름의 비밀번호를 넣어 주세요.',
  locked: '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.',
};
export function signInErrorText(err) {
  const key = Object.keys(SIGN_IN_ERRORS).find((k) => String(err?.message ?? err).includes(k));
  return key ? SIGN_IN_ERRORS[key] : '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
}

// Signs in, or up when the name is new: { name, token, new }.
export async function signIn(name, pass) {
  const { data, error } = await realtime().rpc('puyo_login', { p_name: name, p_pass: pass });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// { name, record } for this phone's token, or null when the server no longer knows it.
export async function whoAmI(token) {
  const { data, error } = await realtime().rpc('puyo_me', { p_token: token });
  if (error) throw error;
  return data;
}

export async function signOut(token) {
  await realtime().rpc('puyo_logout', { p_token: token });
}

// One finished match: { kind: 'cpu' | 'online', level, won, chain, score, clears } -> { before, after }.
export async function recordGame(token, { kind, level = null, won, chain, score, clears }) {
  const { data, error } = await realtime().rpc('puyo_record_game', {
    p_token: token, p_kind: kind, p_level: level, p_won: won, p_chain: chain, p_score: score, p_clears: clears,
  });
  if (error) throw error;
  return data;
}

// Everyone's records for the ranking tabs: by the highest level beaten, or the longest chain.
export async function fetchRecords(by) {
  let q = realtime().from('puyo_records').select('name, best_level, best_chain, best_score, cpu_wins, cpu_games, online_wins, online_games');
  q = by === 'chain'
    ? q.gt('best_chain', 0).order('best_chain', { ascending: false }).order('best_level', { ascending: false })
    : q.gt('best_level', 0).order('best_level', { ascending: false }).order('best_chain', { ascending: false });
  const { data, error } = await q.limit(100);
  if (error) throw error;
  return data;
}
