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

  // Portrait of character `id`: the 4x face, or the top of the SD figure for those without one.
  async face(id) {
    const key = `face:${id}`;
    this.cache[key] ??= this.manifest.faces.includes(id)
      ? loadImage(`${BASE}hd/FACE${String(id).padStart(2, '0')}.png`).then((img) => img && { img, x: 0, y: 0, w: img.width, h: img.height })
      : this.load(`GRP/SD/SD_${String(id).padStart(2, '0')}`).then((p) => p && { img: p.img, x: 0, y: 0, w: 96 * p.scale, h: 112 * p.scale });
    return this.cache[key];
  }

  // Character figure: pose 0 standing, 1 happy, 2 down.
  async figure(id) {
    const p = await this.load(`GRP/SD/SD_${String(id).padStart(2, '0')}`);
    return p && { img: p.img, w: 96 * p.scale, h: 112 * p.scale };
  }
}

export const sfxUrl = (id) => `${BASE}sfx/${id}.wav`;
export const musicUrl = (id) => `${BASE}music/${id}.mid`;
