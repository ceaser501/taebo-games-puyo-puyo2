// Achievements and titles, kept in this browser. They are earned on their own as you play, and
// the best title earned is worn on its own: it shows by your character in the game (and on your
// friend's screen online) and on the home screen.

const KEY = 'puyo-achieve';

// rank: the higher, the better the title; the one worn is the highest earned.
export const ACHIEVEMENTS = [
  { id: 'game1', title: '뿌요 새내기', desc: '첫 게임 하기', rank: 1, test: (s) => s.games >= 1 },
  { id: 'win1', title: '첫 승리', desc: '처음으로 이기기', rank: 2, test: (s) => s.wins >= 1 },
  { id: 'chain3', title: '연쇄 입문', desc: '3연쇄 하기', rank: 3, test: (s) => s.bestChain >= 3 },
  { id: 'clear1', title: '싹쓸이', desc: '전부 지우기 1번', rank: 4, test: (s) => s.allClears >= 1 },
  { id: 'streak3', title: '연승 행진', desc: '3연승', rank: 5, test: (s) => s.bestStreak >= 3 },
  { id: 'online1', title: '온라인 데뷔', desc: '온라인 대전에서 이기기', rank: 6, test: (s) => s.onlineWins >= 1 },
  { id: 'chain5', title: '연쇄의 달인', desc: '5연쇄 하기', rank: 7, test: (s) => s.bestChain >= 5 },
  { id: 'wins10', title: '베테랑', desc: '10번 이기기', rank: 8, test: (s) => s.wins >= 10 },
  { id: 'hard', title: '어려움 정복', desc: '컴퓨터(어려움) 이기기', rank: 9, test: (s) => s.hardWins >= 1 },
  { id: 'clear10', title: '청소의 신', desc: '전부 지우기 10번', rank: 10, test: (s) => s.allClears >= 10 },
  { id: 'games100', title: '뿌요 중독', desc: '100판 하기', rank: 11, test: (s) => s.games >= 100 },
  { id: 'chain7', title: '바요엔 마스터', desc: '7연쇄 하기', rank: 12, test: (s) => s.bestChain >= 7 },
  { id: 'online10', title: '랭킹 도전자', desc: '온라인 대전 10번 이기기', rank: 13, test: (s) => s.onlineWins >= 10 },
  { id: 'wins50', title: '뿌요 고수', desc: '50번 이기기', rank: 14, test: (s) => s.wins >= 50 },
  { id: 'streak10', title: '무적', desc: '10연승', rank: 15, test: (s) => s.bestStreak >= 10 },
  { id: 'chain10', title: '전설의 연쇄왕', desc: '10연쇄 하기', rank: 16, test: (s) => s.bestChain >= 10 },
];

const blank = () => ({ games: 0, wins: 0, streak: 0, bestStreak: 0, bestChain: 0, allClears: 0, onlineWins: 0, hardWins: 0 });

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && d.stats) return { stats: { ...blank(), ...d.stats }, got: d.got ?? {} };
  } catch { /* storage blocked */ }
  return { stats: blank(), got: {} };
}

let data = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ } };

// Newly earned achievements since the last check, saved as earned.
function check() {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!data.got[a.id] && a.test(data.stats)) {
      data.got[a.id] = Date.now();
      fresh.push(a);
    }
  }
  save();
  return fresh;
}

// The title worn: the best one earned, or none yet.
export function title() {
  let best = null;
  for (const a of ACHIEVEMENTS) if (data.got[a.id] && (!best || a.rank > best.rank)) best = a;
  return best?.title ?? '';
}

export const earned = (id) => data.got[id] ?? null;
export const stats = () => ({ ...data.stats });

// During a game, for my own board.
export function chainDone(n) {
  if (n <= data.stats.bestChain) return [];
  data.stats.bestChain = n;
  return check();
}
export function allClear() {
  data.stats.allClears++;
  return check();
}

// At the end of a match I played: won or not, online or against which computer.
export function matchDone({ won, online, cpu }) {
  const s = data.stats;
  s.games++;
  if (won) {
    s.wins++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (online) s.onlineWins++;
    if (cpu === 'hard') s.hardWins++;
  } else s.streak = 0;
  return check();
}
