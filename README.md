# taebo-games-puyo-puyo2

뿌요뿌요 투(通) 스타일의 대전 퍼즐 게임 (브라우저, HTML5 Canvas). 게임은 `puyo/` 폴더에 있습니다.

- 원본 데이터: 비공개 저장소 `ceaser501/taebo-games-puyo-puyo2-assets`
  (Windows 95 한국어판 설치 폴더 `PUYO2/`)
- 구조는 `ceaser501/taebo-games-fortress2blue`(그리고 `taebo-games-worms`)를 따릅니다.
- 온라인 대전 중계: Supabase Realtime (`puyo/js/net.js`, 웜즈·포트리스와 같은 프로젝트)

## 실행

```bash
npm install
npm run puyo:assets -- ../taebo-games-puyo-puyo2-assets   # 원본 데이터 변환 (최초 1회)
npm start                                                  # 개발 서버
npm run build                                              # dist/ 로 빌드
```

## 손으로 배포 (Cloudflare Pages)

맥에서는 아래 한 줄이면 원본 데이터 받기(없으면 clone, 있으면 pull)·변환·빌드·배포까지 합니다.

```bash
npm run release
```

나눠서 하려면:

```bash
npm run build
npm run deploy          # dist/ 를 Cloudflare Pages 프로젝트 taesu-puyo2 로 올림
```

처음 한 번은 `npx wrangler login`(브라우저 로그인)과
`npx wrangler pages project create taesu-puyo2 --production-branch main`이 필요합니다. 주소는 `https://taesu-puyo2.pages.dev`입니다.
빌드 전에 `npm run puyo:assets`로 변환해 두어야 그림·소리가 함께 올라갑니다.

## 자동 배포 (GitHub Actions)

`main`에 푸시하면 `.github/workflows/deploy.yml`이 원본 데이터(`taebo-games-puyo-puyo2-assets`)를 받아 변환·빌드한 뒤
Cloudflare Pages 프로젝트 `taesu-puyo2`에 배포합니다(처음에는 프로젝트도 만듭니다).
저장소 Settings → Secrets and variables → Actions에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PUYO_ASSETS_TOKEN`이 있어야 하며,
없으면 배포 단계는 건너뜁니다.

게임 규칙·조작은 [`puyo/README.md`](puyo/README.md)에 있습니다.

## 원본 데이터 변환

```bash
npm run puyo:assets -- ../taebo-games-puyo-puyo2-assets
```

`puyo/assets/p2/`에 그림(PNG)·소리(WAV)·음악(MIDI)과 `manifest.json`을 만듭니다. 이 폴더는 git에 올리지 않습니다.

| 원본 | 형식 | 변환 결과 |
|---|---|---|
| `*.CNS` 208개 | LZ77 압축 + 16/256색 팔레트 비트맵 (행은 아래에서 위로) | `img/<폴더>_<이름>.png` |
| `*.GCM` 3개 | 이름만 다른 8비트 BMP | `img/<이름>.png` |
| `*.WLK` 79개 | 소리 묶음: 11025Hz 16비트 PCM 134개 | `sfx/<묶음>_<번호>.wav` |
| `*.MLK` 2개 | 표준 MIDI 19곡 묶음 (반복 여부 표시) | `music/<묶음>_<번호>.mid` |

- 뿌요·캐릭터 그림은 Scale2x를 두 번 걸어 4배로도 만듭니다(`hd/`). 브라우저에서 부드럽게 줄여 그리면 픽셀 계단이 사라집니다.
- 스프라이트 시트는 팔레트 0번 색을 투명으로 바꿉니다.
- CNS 해독은 원작 실행 파일의 루틴(`PUYO2W95.EXE` 0x423b90 압축 풀기, 0x40c960 비트맵 읽기)을 그대로 옮겼습니다: `puyo/tools/p2-formats.mjs`
- 무엇을 어디에 쓰는지: `puyo/tools/p2-names.mjs`
