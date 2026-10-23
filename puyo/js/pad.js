// One player's controls, turned into a board input each frame. Holding left/right repeats after
// a short delay (like the original); turns happen once per press.
const DELAY = 9;
const REPEAT = 2;

export const KEYMAPS = {
  // Against the computer or online: the arrows and Z / X.
  solo: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], down: ['ArrowDown', 'KeyS'], cw: ['KeyX', 'ArrowUp', 'KeyW'], ccw: ['KeyZ'] },
  // Two on one keyboard.
  left: { left: ['KeyA'], right: ['KeyD'], down: ['KeyS'], cw: ['KeyW', 'KeyG'], ccw: ['KeyF'] },
  right: { left: ['ArrowLeft'], right: ['ArrowRight'], down: ['ArrowDown'], cw: ['ArrowUp', 'Period'], ccw: ['Comma'] },
};

export class Pad {
  constructor(map) {
    this.codes = {};
    for (const [action, list] of Object.entries(map)) for (const code of list) this.codes[code] = action;
    this.held = { left: false, right: false, down: false };
    this.queue = []; // turns pressed since the last frame
    this.dir = 0;
    this.hold = 0;
    this.fresh = false;
  }

  // Returns true when the key belongs to this pad.
  key(code, down) {
    const action = this.codes[code];
    if (!action) return false;
    this.press(action, down);
    return true;
  }

  press(action, down) {
    if (action === 'cw' || action === 'ccw') {
      if (down) this.queue.push(action === 'cw' ? 1 : -1);
      return;
    }
    if (this.held[action] === down) return;
    this.held[action] = down;
    if (down && (action === 'left' || action === 'right')) {
      this.dir = action === 'left' ? -1 : 1;
      this.hold = 0;
      this.fresh = true;
    }
  }

  release() {
    this.held = { left: false, right: false, down: false };
    this.queue = [];
    this.dir = 0;
  }

  frame() {
    const dir = this.held.left && this.held.right ? this.dir : this.held.left ? -1 : this.held.right ? 1 : 0;
    let move = 0;
    if (dir) {
      if (this.fresh || dir !== this.dir) { move = dir; this.hold = 0; this.dir = dir; this.fresh = false; }
      else if (++this.hold >= DELAY && (this.hold - DELAY) % REPEAT === 0) move = dir;
    }
    const turn = this.queue.shift() || 0;
    return { move, turn, soft: this.held.down };
  }
}
