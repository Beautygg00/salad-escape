const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      loading: $('loading'), loadbar: $('loadbar'), home: $('home'), how: $('how'), settings: $('settings'), credits: $('credits'),
      hud: $('hud'), objective: $('objective'), alert: $('alert'), stamina: $('stamina').firstElementChild, inv: $('inv'),
      timer: $('timer'), toast: $('toast'), prompt: $('prompt'), promptText: $('promptText'), promptProg: $('promptProg'),
      bubble: $('bubble'), vignette: $('vignette'), pause: $('pause'), lose: $('lose'), win: $('win'), touch: $('touch'),
      best: $('bestTime'), winText: $('winText'), loseText: $('loseText'), pauseBtn: $('pauseBtn'), hint: $('crosshint'),
    };
    this.bubbleT = 0; this.toastT = 0; this.back = null;
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closePanel()));
  }
  show(name, on = true) { this.el[name].classList.toggle('hidden', !on); }
  only(...names) {
    for (const n of ['home', 'how', 'settings', 'credits', 'hud', 'pause', 'lose', 'win', 'touch', 'pauseBtn']) this.show(n, names.includes(n));
  }
  openPanel(name, back) { this.back = back; this.only(name); }
  closePanel() { const b = this.back; this.back = null; this.only(...(b || ['home'])); }

  progress(p) { this.el.loadbar.style.width = `${Math.round(p * 100)}%`; }
  setObjective(t) { this.el.objective.innerHTML = t; }
  setInventory(c, b) { this.el.inv.textContent = `🥢 ${c}/3 · 🌿 ${b}/3`; }
  setStamina(s) { this.el.stamina.style.width = `${s * 100}%`; this.el.stamina.style.background = s < 0.25 ? '#ff7043' : '#ffd54f'; }
  setTimer(sec) { this.el.timer.textContent = `⏱ ${fmt(sec)}`; }
  setAlert(text, cls) { const a = this.el.alert; if (a.textContent !== text) a.textContent = text; a.className = `pill ${cls}`; }
  setVignette(v) { this.el.vignette.style.opacity = v; }
  toast(text, dur = 2.2) { this.el.toast.textContent = text; this.el.toast.style.opacity = 1; this.toastT = dur; }
  prompt(text, prog) {
    if (text == null) { this.show('prompt', false); return; }
    this.show('prompt', true); this.el.promptText.textContent = text; this.el.promptProg.style.width = `${(prog || 0) * 100}%`;
  }
  bubble(text, dur) { this.el.bubble.textContent = text; this.bubbleT = dur; }
  update(dt, headScreen) {
    this.toastT -= dt; if (this.toastT <= 0) this.el.toast.style.opacity = 0;
    this.bubbleT -= dt;
    const b = this.el.bubble;
    if (this.bubbleT > 0 && headScreen) {
      b.classList.remove('hidden');
      b.style.left = `${Math.min(innerWidth - 130, Math.max(130, headScreen.x))}px`;
      b.style.top = `${Math.min(innerHeight - 20, Math.max(70, headScreen.y))}px`;
    } else b.classList.add('hidden');
  }
}
export const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
