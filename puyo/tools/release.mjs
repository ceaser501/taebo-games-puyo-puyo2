// One command from a Mac: fetch the original data, convert it, build and deploy.
//
//   npm run release
//
// The private data repo is looked for next to this repo and in the home folder, and cloned
// next to this repo when it is in neither place. Later runs just pull it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'taebo-games-puyo-puyo2-assets';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

const candidates = [path.resolve(root, '..', NAME), path.join(os.homedir(), NAME)];
let assets = candidates.find((dir) => fs.existsSync(path.join(dir, '.git')));
if (assets) {
  console.log(`\n▶ 원본 데이터 최신으로 받기: ${assets}`);
  run('git pull --ff-only origin main', assets);
} else {
  assets = candidates[0];
  console.log(`\n▶ 원본 데이터 받기: ${assets}`);
  run(`git clone https://github.com/ceaser501/${NAME}.git "${assets}"`);
}

// Deploy only what is on GitHub: stop when this folder is behind or has its own edits.
console.log('\n▶ 게임 코드 확인');
run('git fetch -q origin main');
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim();
const behind = Number(out('git rev-list --count HEAD..origin/main'));
// npm on another machine may rewrite package-lock.json; that changes nothing that ships.
const dirty = out('git status --porcelain --untracked-files=no -- . ":(exclude)package-lock.json"');
if (behind || dirty) {
  console.error(`\n배포를 멈췄어요. 이 폴더(${root})의 게임 코드가 GitHub 최신이 아니에요.`);
  if (behind) console.error(`- 최신보다 ${behind}개 커밋 뒤에 있어요.`);
  if (dirty) console.error(`- 이 폴더에서 바뀐 파일이 있어요:\n${dirty}`);
  console.error('\n최신으로 맞추려면(이 폴더에서 바꾼 내용은 사라져요):\n  git fetch origin main && git reset --hard origin/main\n그다음 다시 npm run release');
  process.exit(1);
}
console.log(`게임 코드 ${out('git rev-parse --short HEAD')} (최신)`);

console.log('\n▶ 변환');
run(`node puyo/tools/convert-assets.mjs "${assets}"`);
console.log('\n▶ 빌드');
// A fresh clone (or one whose packages changed) needs its build tools first.
if (!fs.existsSync(path.join(root, 'node_modules', 'webpack-cli')) || !fs.existsSync(path.join(root, 'node_modules', 'webpack'))) {
  console.log('빌드 도구 설치 (처음 한 번)');
  run('npm install --no-audit --no-fund');
}
run('npm run build');
console.log('\n▶ 배포');
run('npm run deploy');
