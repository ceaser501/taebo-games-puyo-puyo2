// Loads the converted Puyo Puyo 2 data (assets/p2). Pictures keep their original names,
// e.g. 'GRP/PUYO_R' is img/GRP_PUYO_R.png (and hd/GRP_PUYO_R.png at 4x where the manifest says so).
const BASE = 'assets/p2/';
const flat = (name) => name.replace(/\//g, '_');

export function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function loadManifest() {
  try {
    const res = await fetch(`${BASE}manifest.json`);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch {
    return null;
  }
}

// Pictures load on first use and are shared afterwards. `hd` picks the 4x copy when there is one;
// `scale` says how many image pixels make one original pixel.
export class Pictures {
  constructor(manifest) {
    this.manifest = manifest;
    this.cache = {};
  }

  load(name, hd = true) {
    const big = hd && this.manifest.hd[name];
    const key = big ? `hd:${name}` : name;
    this.cache[key] ??= loadImage(`${BASE}${big ? 'hd' : 'img'}/${flat(name)}.png`).then((img) => (img ? { img, scale: big ? 4 : 1 } : null));
    return this.cache[key];
  }

  // Portrait of character `id`: the 4x face, or the top of the standing figure for those without one.
  async face(id) {
    const key = `face:${id}`;
    this.cache[key] ??= this.manifest.faces.includes(id)
      ? loadImage(`${BASE}hd/FACE${String(id).padStart(2, '0')}.png`).then((img) => img && { img, x: 0, y: 0, w: img.width, h: img.height })
      : this.figure(id).then((f) => f && { img: f.img, ...f.poses[0] });
    return this.cache[key];
  }

  // Character figure: the sheet and where its three poses are (0 standing, 1 happy, 2 down),
  // each trimmed to the drawing, in image pixels.
  async figure(id) {
    const key = `fig:${id}`;
    this.cache[key] ??= this.load(`GRP/SD/SD_${String(id).padStart(2, '0')}`).then((p) => p && { img: p.img, poses: findPoses(p.img) });
    return this.cache[key];
  }
}

export const sfxUrl = (id) => `${BASE}sfx/${id}.wav`;
export const musicUrl = (id) => `${BASE}music/${id}.mid`;
export const bgmUrl = (id) => `${BASE}bgm/${id}.ogg`;

// The poses are stacked top to bottom, but the sheets differ: 96 to 160 pixels wide (before the
// 4x copy), poses 112 to 128 tall, not always the same height within a sheet. Each pose ends at
// the empty rows nearest a third of the height (or exactly there if it touches the next), then
// is trimmed to what is drawn.
function findPoses(img) {
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, W, H).data;
  const filled = (x, y) => a[(y * W + x) * 4 + 3] > 0;
  const emptyRow = [];
  for (let y = 0; y < H; y++) {
    let e = true;
    for (let x = 0; x < W && e; x++) if (filled(x, y)) e = false;
    emptyRow.push(e);
  }
  const cuts = [[0, 0]]; // [end of the pose above, start of the next]
  for (const k of [1, 2]) {
    const want = Math.round((H * k) / 3), reach = Math.round(H / 6);
    let best = null;
    for (let y = Math.max(1, want - reach); y < Math.min(H, want + reach); y++) {
      if (!emptyRow[y] || (best && Math.abs(y - want) >= Math.abs(best - want))) continue;
      best = y;
    }
    if (best == null) { cuts.push([want, want]); continue; }
    let lo = best, hi = best;
    while (lo > 0 && emptyRow[lo - 1]) lo--;
    while (hi < H - 1 && emptyRow[hi + 1]) hi++;
    cuts.push([lo, hi + 1]);
  }
  cuts.push([H, H]);
  const poses = [];
  for (let k = 0; k < 3; k++) {
    const y0 = cuts[k][1], y1 = cuts[k + 1][0];
    let top = y1, bottom = y0, left = W, right = 0;
    for (let y = y0; y < y1; y++) {
      if (emptyRow[y]) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      for (let x = 0; x < W; x++) if (filled(x, y)) { left = Math.min(left, x); right = Math.max(right, x + 1); }
    }
    poses.push(right > left ? { x: left, y: top, w: right - left, h: bottom - top } : { x: 0, y: y0, w: W, h: Math.max(1, y1 - y0) });
  }
  return poses;
}
