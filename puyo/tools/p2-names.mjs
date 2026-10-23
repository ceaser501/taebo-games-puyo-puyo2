// What the game uses from the original data, by file name.

// Pictures whose palette colour 0 is the backdrop of a sprite sheet: drawn transparent.
export const KEYED = [
  'GRP/PUYO_R', 'GRP/PUYO_G', 'GRP/PUYO_B', 'GRP/PUYO_Y', 'GRP/PUYO_P', 'GRP/PUYO_BP', 'GRP/PUYO_RY', 'GRP/PUYO_G_',
  'GRP/EXT_RY', 'GRP/EXT_BP', 'GRP/EXT_GP', 'GRP/KAR', 'GRP/KARADD', 'GRP/KARE-',
  ...Array.from({ length: 35 }, (_, i) => `GRP/SD/SD_${String(i).padStart(2, '0')}`),
];

// Puyo sheets: 640x64, 32x32 cells in two rows of 20. Row 0, cells 0-15: the puyo joined to
// its neighbours (bit 1 up, 2 left, 4 down, 8 right). Garbage is in PUYO_BP row 4.
export const PUYO_SHEETS = { 1: 'GRP/PUYO_R', 2: 'GRP/PUYO_G', 3: 'GRP/PUYO_B', 4: 'GRP/PUYO_Y', 5: 'GRP/PUYO_P', garbage: 'GRP/PUYO_BP' };

// Characters 00-34: SD_nn (96x336: three 96x112 poses) and FACEnn (portrait at 0,0, 160x112).
export const CHARACTERS = 35;
export const FACE = { x: 0, y: 0, w: 160, h: 112 };
// Character 00 (Arle) has no FACE file; 05's is an empty grey box.
export const NO_FACE = [0, 5];

// Versus field frames, 640x480 with two 6x12 fields of 32px cells at (32,32) and (416,32).
export const FRAMES = ['GRP/VS_N', 'GRP/VS_S', 'GRP/VS_H', 'GRP/VS_2K', 'GRP/VS_6K', 'GRP/L2_F', 'GRP/L4_F', 'GRP/L1_F'];

// Sheets also written 4x with Scale2x twice, for crisp drawing at any size.
export const HD = [...Object.values(PUYO_SHEETS), 'GRP/KAR'];
