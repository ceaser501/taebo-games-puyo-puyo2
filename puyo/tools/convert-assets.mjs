// Converts the Puyo Puyo 2 data (ceaser501/taebo-games-puyo-puyo2-assets) into web-friendly
// PNG/WAV/MIDI files under assets/p2, plus a manifest the game reads at startup.
//
//   npm run puyo:assets -- [path/to/taebo-games-puyo-puyo2-assets]
//   (default: ../taebo-games-puyo-puyo2-assets)
import fs from 'node:fs';
import path from 'node:path';
import { readCns, readBmp, toRgba, crop, scale2x, readWlk, encodeWav, readMlk, encodePng } from './p2-formats.mjs';
import { KEYED, HD, CHARACTERS, FACE, NO_FACE, FRAMES, PUYO_SHEETS } from './p2-names.mjs';

const root = path.resolve(process.argv[2] || '../taebo-games-puyo-puyo2-assets');
const src = path.join(root, 'PUYO2');
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/p2');
if (!fs.existsSync(src)) {
  console.error(`Puyo Puyo 2 data not found at ${src}`);
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
for (const dir of ['img', 'hd', 'sfx', 'music']) fs.mkdirSync(path.join(out, dir), { recursive: true });

// Original names keep their folder: GRP/SD/SD_00.CNS becomes img/GRP_SD_SD_00.png and is called
// 'GRP/SD/SD_00' in the manifest.
const flat = (name) => name.replace(/\//g, '_');
const files = (dir) => fs.readdirSync(path.join(src, dir)).filter((f) => fs.statSync(path.join(src, dir, f)).isFile());
const keyed = new Set(KEYED);
const hd = new Set(HD);

// Writes `pic` 4x (Scale2x twice) for crisp drawing.
function writeHd(file, rgba, w, h) {
  const x2 = scale2x(rgba, w, h);
  fs.writeFileSync(file, encodePng(w * 4, h * 4, scale2x(x2, w * 2, h * 2)));
}

const manifest = { img: {}, hd: {}, sfx: {}, music: [], characters: CHARACTERS, faces: [], frames: FRAMES, puyo: PUYO_SHEETS };
const pictures = [];
for (const dir of ['', 'GRP', 'GRP/SD', 'GRP_DEMO']) {
  for (const f of files(dir).sort()) {
    const ext = path.extname(f).toUpperCase();
    if (ext !== '.CNS' && ext !== '.GCM') continue;
    pictures.push({ dir, f, name: path.posix.join(dir, path.basename(f, path.extname(f))).toUpperCase(), gcm: ext === '.GCM' });
  }
}
for (const { dir, f, name, gcm } of pictures) {
  const buf = fs.readFileSync(path.join(src, dir, f));
  const pic = gcm ? readBmp(buf) : readCns(buf);
  const rgba = toRgba(pic, keyed.has(name) ? 0 : -1);
  fs.writeFileSync(path.join(out, 'img', `${flat(name)}.png`), encodePng(pic.width, pic.height, rgba));
  manifest.img[name] = [pic.width, pic.height];
  if (hd.has(name) || name.startsWith('GRP/SD/SD_')) {
    writeHd(path.join(out, 'hd', `${flat(name)}.png`), rgba, pic.width, pic.height);
    manifest.hd[name] = [pic.width * 4, pic.height * 4];
  }
  // Portraits: just the face, 4x.
  const face = /^GRP\/FACE(\d\d)$/.exec(name);
  if (face) {
    const id = `FACE${face[1]}`;
    const part = crop(rgba, pic.width, FACE.x, FACE.y, FACE.w, FACE.h);
    if (!NO_FACE.includes(Number(face[1]))) {
      writeHd(path.join(out, 'hd', `${id}.png`), part, FACE.w, FACE.h);
      manifest.faces.push(Number(face[1]));
    }
  }
}

// Sounds: <bank>_<nn>.wav for the banks, the voice folder by clip name.
let clips = 0;
for (const dir of ['', 'VI']) {
  for (const f of files(dir).filter((n) => /\.WLK$/i.test(n)).sort()) {
    const bank = path.basename(f, path.extname(f)).toUpperCase();
    const list = readWlk(fs.readFileSync(path.join(src, dir, f)));
    manifest.sfx[bank] = list.map((c) => Math.round((c.pcm.length / 2 / c.rate) * 1000));
    list.forEach((clip, i) => {
      fs.writeFileSync(path.join(out, 'sfx', `${bank}_${String(i).padStart(2, '0')}.wav`), encodeWav(clip));
      clips++;
    });
  }
}

// Music: the MIDI files as they are; `loop` marks the ones the game repeats.
for (const f of files('').filter((n) => /\.MLK$/i.test(n)).sort()) {
  const bank = path.basename(f, path.extname(f)).toUpperCase();
  readMlk(fs.readFileSync(path.join(src, f))).forEach((song, i) => {
    const id = `${bank}_${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(out, 'music', `${id}.mid`), song.midi);
    manifest.music.push({ id, loop: song.loop });
  });
}

// Background music for the other music setting: the OGG files in BGM/ as they are.
const bgmDir = path.join(root, 'BGM');
manifest.bgm = [];
if (fs.existsSync(bgmDir)) {
  fs.mkdirSync(path.join(out, 'bgm'), { recursive: true });
  for (const f of fs.readdirSync(bgmDir).filter((n) => /\.ogg$/i.test(n)).sort()) {
    const id = path.basename(f, path.extname(f)).toUpperCase();
    fs.copyFileSync(path.join(bgmDir, f), path.join(out, 'bgm', `${id}.ogg`));
    manifest.bgm.push(id);
  }
}

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
console.log(`Wrote ${pictures.length} pictures (${Object.keys(manifest.hd).length + manifest.faces.length} also 4x), ${clips} sounds, ${manifest.music.length} songs, ${manifest.bgm.length} OGG songs to ${out}`);
