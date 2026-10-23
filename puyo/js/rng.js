// Small seeded random numbers, so both players of a match get the same puyo pairs.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

// The pair queue of a match: four of the five colours (picked by the seed), pairs drawn on demand
// and kept so every board reads the same list.
export class Pairs {
  constructor(seed, colours = 4) {
    const r = rng(seed);
    const all = [1, 2, 3, 4, 5];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    this.colours = all.slice(0, colours);
    this.r = r;
    this.list = [];
  }

  get(i) {
    while (this.list.length <= i) {
      const c = this.colours;
      this.list.push([c[Math.floor(this.r() * c.length)], c[Math.floor(this.r() * c.length)]]);
    }
    return this.list[i];
  }
}
