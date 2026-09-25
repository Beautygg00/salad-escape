// All sound is synthesised with Web Audio: no files to download.
export class AudioSys {
  constructor() { this.ctx = null; }

  init(musicVol, sfxVol) {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    const len = ctx.sampleRate; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(musicVol, sfxVol);
  }
  setVolumes(music, sfx) {
    if (!this.ctx) return;
    this.musicBus.gain.value = music * 0.55; this.sfxBus.gain.value = sfx;
  }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  tone(freq, dur, { type = 'square', vol = 0.2, when = 0, slide = null, bus = this.sfxBus, attack = 0.005, filter = null } = {}) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, { vol = 0.2, when = 0, type = 'highpass', freq = 1000, bus = this.sfxBus, q = 1 } = {}) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ---- sound effects ----
  pickup() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.25, when: this.now + i * 0.07 })); }
  bigPickup() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.25, when: this.now + i * 0.08 })); }
  jump(big) { this.tone(big ? 300 : 420, big ? 0.3 : 0.18, { type: 'square', vol: 0.08, slide: big ? 1100 : 900, filter: 2500 }); }
  land() { this.noise(0.06, { vol: 0.12, type: 'lowpass', freq: 600 }); }
  alert() { this.tone(988, 0.12, { type: 'square', vol: 0.15 }); this.tone(1318, 0.3, { type: 'square', vol: 0.15, when: this.now + 0.12 }); }
  chop(vol = 0.15) { this.noise(0.05, { vol, type: 'bandpass', freq: 3200, q: 2 }); this.tone(180, 0.05, { type: 'sine', vol: vol * 0.8 }); }
  step(vol) { if (vol > 0.01) this.tone(90, 0.09, { type: 'sine', vol: Math.min(0.4, vol), slide: 45 }); }
  creak() { this.tone(160, 0.9, { type: 'sawtooth', vol: 0.06, slide: 90, filter: 900 }); }
  splash() { this.noise(0.9, { vol: 0.35, type: 'lowpass', freq: 1400 }); this.tone(300, 0.4, { type: 'sine', vol: 0.2, slide: 80 }); }
  bubble() { this.tone(300 + Math.random() * 400, 0.06, { type: 'sine', vol: 0.03, slide: 700 }); }
  click() { this.tone(900, 0.04, { type: 'triangle', vol: 0.1 }); }
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, { type: 'square', vol: 0.12, when: this.now + i * 0.12, filter: 3000 })); }
  lose() { [392, 370, 349, 262].forEach((f, i) => this.tone(f, 0.45, { type: 'triangle', vol: 0.2, when: this.now + i * 0.3 })); }
}

// Adaptive music: a tarantella-flavoured loop whose tempo and layers follow Maria's alert level.
const MEL = [
  [69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 76, 74, 0, 72, 0],
  [65, 0, 69, 0, 72, 0, 69, 0, 77, 0, 76, 0, 74, 0, 72, 0],
  [67, 0, 71, 0, 74, 0, 71, 0, 79, 0, 77, 0, 76, 0, 74, 0],
  [68, 0, 71, 0, 76, 0, 74, 0, 72, 0, 71, 0, 69, 0, 68, 0],
];
const ROOTS = [45, 41, 43, 40]; // A, F, G, E
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(audio) { this.a = audio; this.bpm = 92; this.targetBpm = 92; this.level = 0; this.step = 0; this.timer = null; }
  start() {
    if (!this.a.ctx || this.timer) return;
    this.next = this.a.now + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  setLevel(level) { this.level = level; this.targetBpm = [92, 128, 168][level]; }
  tick() {
    const a = this.a;
    while (this.next < a.now + 0.12) {
      this.bpm += (this.targetBpm - this.bpm) * 0.04; // smooth tempo glide
      this.play(this.step, this.next);
      this.next += 60 / this.bpm / 4;
      this.step = (this.step + 1) % 64;
    }
  }
  play(step, t) {
    const a = this.a, bus = a.musicBus, s = step % 16, bar = (step / 16) | 0, lv = this.level;
    const root = ROOTS[bar];
    // bass
    const bassHits = lv === 2 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 6, 8, 12];
    if (bassHits.includes(s)) {
      const note = root + (s === 6 || s === 10 || (lv === 2 && s % 4 === 2) ? 7 : 0);
      a.tone(mtof(note), 0.16, { type: 'square', vol: 0.18, when: t, bus, filter: lv === 2 ? 900 : 600 });
    }
    // melody (chase fills the gaps an octave up)
    let m = MEL[bar][s];
    if (!m && lv === 2) m = MEL[bar][s - 1] ? MEL[bar][s - 1] + 12 : 0;
    if (m) a.tone(mtof(m + (lv === 0 ? 0 : 12)), lv === 2 ? 0.09 : 0.14, { type: lv === 0 ? 'triangle' : 'square', vol: lv === 0 ? 0.13 : 0.07, when: t, bus, filter: 3500 });
    // drums
    if (s % 4 === 2 || (lv >= 1 && s % 2 === 1) || lv === 2) a.noise(0.03, { vol: lv === 2 ? 0.07 : 0.05, when: t, type: 'highpass', freq: 7000, bus });
    if (lv >= 1 && (s === 4 || s === 12)) a.noise(0.12, { vol: 0.16, when: t, type: 'bandpass', freq: 1800, bus });
    if (lv === 2 && s % 4 === 0) a.tone(150, 0.12, { type: 'sine', vol: 0.45, when: t, slide: 45, bus });
    if (lv === 0 && s === 0) a.tone(110, 0.2, { type: 'sine', vol: 0.18, when: t, slide: 55, bus });
  }
}
