export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.stick = { x: 0, y: 0 };
    this.touchSprint = false; this.touchUse = false; this.jumpQueued = false;
    this.canvas = canvas;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse look: pointer lock when available, drag otherwise
    let dragging = false;
    canvas.addEventListener('mousedown', () => { dragging = true; });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || (dragging && !this.isTouch)) { this.look.dx += e.movementX; this.look.dy += e.movementY; }
    });

    // touch: left stick + right-side drag to look
    const stick = document.getElementById('stick'), knob = stick.firstElementChild;
    let stickId = null, lookId = null, lx = 0, ly = 0;
    stick.addEventListener('touchstart', (e) => { stickId = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          let x = (t.clientX - cx) / (r.width / 2), y = (t.clientY - cy) / (r.height / 2); const m = Math.hypot(x, y);
          if (m > 1) { x /= m; y /= m; }
          this.stick.x = x; this.stick.y = y;
          knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
        } else if (t.identifier === lookId) {
          this.look.dx += (t.clientX - lx) * 1.4; this.look.dy += (t.clientY - ly) * 1.4; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (lookId == null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: true });
    addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    });
    const hold = (id, prop) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { this[prop] = true; if (prop === 'jumpQueued') this.jumpQueued = true; e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', () => { if (prop !== 'jumpQueued') this[prop] = false; });
    };
    hold('tJump', 'jumpQueued'); hold('tSprint', 'touchSprint'); hold('tUse', 'touchUse');
  }

  move() {
    let x = this.stick.x, y = -this.stick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint; }
  get use() { return this.keys.has('KeyE') || this.touchUse; }
  consumeJump() { const j = this.jumpQueued; this.jumpQueued = false; return j; }
  consumeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = 0; return l; }
  lockPointer() { if (!this.isTouch && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
}
