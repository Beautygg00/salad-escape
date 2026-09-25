import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Level, makeLoader } from './level.js';
import { Nav } from './nav.js';
import { Player, FollowCam } from './player.js';
import { Maria } from './maria.js';
import { Items } from './items.js';
import { AudioSys, Music } from './audio.js';
import { Input } from './input.js';
import { UI, fmt } from './ui.js';
import { B, storage, dist2D, angleDamp } from './util.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe3ff);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 60);

// Ambient occlusion (soft contact shadows where objects meet) as a post-process.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const ui = new UI(), input = new Input(canvas), audio = new AudioSys(), music = new Music(audio);
const settings = Object.assign({ music: 0.6, sfx: 0.8, sens: 1, invert: false, shadows: true, ao: !input.isTouch, difficulty: 'normal' }, storage.get('saladEscape.settings', {}));
let best = storage.get('saladEscape.best', null);

let level, nav, player, maria, items, follow;
let state = 'loading', playTime = 0, cine = null, homeT = 0, stage = 0, lastZone = null;
const START = { pos: B(3.7, -0.35, 0), yaw: Math.PI };

// ---------- loading ----------
async function boot() {
  level = new Level(scene);
  const loader = makeLoader();
  let p1 = 0, p2 = 0;
  const [, saladG, mariaG] = await Promise.all([
    level.load('assets/room.glb', (p) => { p1 = p; ui.progress(p1 * 0.85 + p2 * 0.15); }),
    loader.loadAsync('assets/salad.glb', (e) => { p2 = e.total ? e.loaded / e.total : 0.5; }),
    loader.loadAsync('assets/maria.glb'),
  ]);
  nav = new Nav(level.boxes);
  const saladModel = saladG.scene, mariaModel = mariaG.scene;
  scene.add(saladModel, mariaModel);
  player = new Player(saladModel, level, audio);
  maria = new Maria(mariaModel, level, nav, audio, ui);
  items = new Items(scene, level, audio);
  follow = new FollowCam(camera, level);
  applySettings();
  ui.progress(1);
  renderer.compile(scene, camera);
  ui.show('loading', false);
  goHome();
  window.__game = debugApi();
}

// ---------- settings ----------
function applySettings() {
  audio.setVolumes(settings.music, settings.sfx);
  if (follow) { follow.sens = settings.sens; follow.invert = settings.invert; }
  level?.setShadowQuality(settings.shadows);
  maria?.setDifficulty(settings.difficulty);
  storage.set('saladEscape.settings', settings);
}
{
  const sel = document.getElementById('sDifficulty'); sel.value = settings.difficulty;
  sel.addEventListener('change', () => { settings.difficulty = sel.value; applySettings(); });
}
const bindRange = (id, key) => { const el = document.getElementById(id); el.value = settings[key]; el.addEventListener('input', () => { settings[key] = +el.value; applySettings(); }); };
const bindCheck = (id, key) => { const el = document.getElementById(id); el.checked = settings[key]; el.addEventListener('change', () => { settings[key] = el.checked; applySettings(); }); };
bindRange('sMusic', 'music'); bindRange('sSfx', 'sfx'); bindRange('sSens', 'sens'); bindCheck('sInvert', 'invert'); bindCheck('sShadows', 'shadows'); bindCheck('sAO', 'ao');

// ---------- menus ----------
const on = (id, fn) => document.getElementById(id).addEventListener('click', () => { audio.click(); fn(); });
on('btnPlay', () => startGame());
on('btnHow', () => ui.openPanel('how', ['home']));
on('btnSettings', () => ui.openPanel('settings', ['home']));
on('btnCredits', () => ui.openPanel('credits', ['home']));
on('btnResume', () => resume());
on('btnPauseSettings', () => ui.openPanel('settings', ['pause']));
on('btnRestart', () => startGame());
on('btnQuit', () => goHome());
on('btnRetry', () => startGame());
on('btnAgain', () => startGame());
on('btnLoseHome', () => goHome());
on('btnWinHome', () => goHome());
on('pauseBtn', () => pause());
canvas.addEventListener('click', () => { if (state === 'play') input.lockPointer(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'play' && !input.isTouch) pause(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && state === 'paused') resume(); else if (e.code === 'KeyP' && state === 'play') pause(); });

function goHome() {
  state = 'home'; homeT = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.only('home');
  ui.el.best.textContent = best ? `🏆 Best escape: ${fmt(best)}` : '';
  resetWorld();
  // salad peeking out of the cardboard box by the fridge
  player.reset(B(1.08, 2.6, 0), Math.PI / 2); player.frozen = true;
  if (audio.ctx) { music.setLevel(0); }
}

function resetWorld() {
  items.reset(); maria.reset(); level.sash.rotation.y = 0; cine = null; stage = 0; lastZone = null;
  player.hidden = false; player.zone = null; player.seenEnter = false;
  nav.rebuild(level.boxes);
}

function startGame() {
  audio.init(settings.music, settings.sfx); music.start(); music.setLevel(0);
  maria.setDifficulty(settings.difficulty);
  resetWorld();
  player.reset(START.pos, START.yaw); player.frozen = false; player.model.visible = true;
  follow.yaw = 0; follow.pitch = 0.38; follow.target.copy(player.center); follow.cur = follow.dist;
  playTime = 0;
  state = 'play';
  ui.only('hud', ...(input.isTouch ? ['touch', 'pauseBtn'] : []));
  ui.el.hint.classList.toggle('hidden', input.isTouch);
  ui.setInventory(0, 0);
  updateObjective();
  ui.toast('Don\'t end up in the minestrone! 🍲', 3);
  if (!input.isTouch) input.lockPointer();
}
function pause() { if (state !== 'play') return; state = 'paused'; ui.only('pause'); }
function resume() { state = 'play'; ui.only('hud', ...(input.isTouch ? ['touch', 'pauseBtn'] : [])); input.lockPointer(); clock.getDelta(); }

function updateObjective() {
  const c = items.chopsticks, b = items.basil;
  if (c < 3) { stage = 0; ui.setObjective(`🥢 Find <b>3 chopsticks</b> to build a ramp to the sofa (${c}/3)`); }
  else if (b < 3) { stage = 1; ui.setObjective(`🌿 Ramp built! Now find the <b>3 basil leaves</b> hidden around the flat (${b}/3)`); }
  else if (!items.windowOpen) { stage = 2; ui.setObjective('🌿 <b>Super Leap!</b> Climb the ramp onto the sofa, jump onto the backrest, follow it to the window corner and hold <b>E</b>'); }
  else { stage = 3; ui.setObjective('🪟 The window is open: press <b>SPACE</b> to leap out!'); }
  maria.speedBonus = stage * maria.diff.bonus;
  ui.setInventory(c, b);
}

// ---------- per-frame ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
function loop() {
  requestAnimationFrame(loop);
  frame(Math.min(clock.getDelta(), 1 / 20), true);
}
function frame(dt, render) {
  if (state === 'loading') return;

  if (state === 'home') homeUpdate(dt);
  else if (state === 'play') playUpdate(dt);
  else if (state === 'caught' || state === 'escaping') cineUpdate(dt);
  items.fx.steam(dt, level.potTop);
  if (Math.random() < dt * 2 && audio.ctx && state === 'play' && dist2D(player.pos, level.potTop) < 1.5) audio.bubble();

  // speech bubble follows Maria's head
  tmp.copy(maria.headPos).project(camera);
  const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
  ui.update(dt, onScreen ? { x: (tmp.x + 1) / 2 * innerWidth, y: (1 - tmp.y) / 2 * innerHeight } : null);
  if (render) draw();
}
function draw() { if (settings.ao) composer.render(); else renderer.render(scene, camera); }

function homeUpdate(dt) {
  homeT += dt;
  const a = homeT * 0.12;
  // slow orbit through the middle of the room, never passing through Maria at the counter
  const c = B(2.4, 3.1, 0);
  camera.position.set(c.x + Math.sin(a) * 1.15, 1.5 + Math.sin(homeT * 0.3) * 0.12, c.z + Math.cos(a) * 1.15);
  camera.lookAt(B(1.9, 1.9, 0.75));
  // Maria cooks away; the salad (far away & hidden) never gets noticed
  player.hidden = true; player.sprinting = false;
  maria.update(dt, player, null);
  player.model.rotation.y = Math.PI / 2 + Math.sin(homeT * 1.5) * 0.4;
  player.animate(dt, 0);
  items.update(dt, { pos: new THREE.Vector3(99, 0, 99), feet: 0, superLeap: false }, false);
  soundsFromMaria();
}

function playUpdate(dt) {
  playTime += dt;
  follow.applyLook(input.consumeLook());
  player.update(dt, input, follow.yaw);

  // hiding
  const zone = level.zoneAt(player.pos, player.feet);
  if (zone && zone !== lastZone) { player.seenEnter = maria.seesPlayer; }
  if (!zone) player.seenEnter = false;
  player.zone = zone; player.hidden = !!zone; lastZone = zone;

  const result = maria.update(dt, player, null);
  const ev = items.update(dt, player, input.use);
  handleEvent(ev);
  // window open + on the sill: any jump launches you out
  if (state === 'play' && items.windowOpen && items.onSill(player) && player.vy > 0.5) startEscape();
  if (result === 'caught' && state === 'play') startCaught();
  if (state !== 'play') return;

  // HUD
  follow.update(dt, player.center.add(new THREE.Vector3(0, 0.12, 0)));
  ui.setStamina(player.stamina); ui.setTimer(playTime);
  const lvl = maria.alertLevel;
  music.setLevel(player.hidden && maria.state !== 'check' ? Math.min(lvl, 1) : lvl);
  if (player.hidden) ui.setAlert(maria.state === 'check' ? '😨 She\'s checking your spot!' : '🫥 Hidden', maria.state === 'check' ? 'chase' : 'hidden-s');
  else if (lvl === 2) ui.setAlert(maria.state === 'kneel' ? '😨 She\'s kneeling down, RUN!' : '😠 Maria is CHASING you!', 'chase');
  else if (maria.state === 'search') ui.setAlert('🔎 Maria is searching…', 'sus');
  else if (lvl === 1) ui.setAlert('🤨 Maria is suspicious…', 'sus');
  else ui.setAlert('😌 Maria is cooking', 'calm');
  ui.setVignette(lvl === 2 ? 0.6 + Math.sin(playTime * 8) * 0.2 : 0);
  if (player.superLeap && !items.windowOpen && items.onSill(player)) ui.prompt(input.isTouch ? 'Hold E to open the window' : 'Hold [E] to open the window', items.windowProgress);
  else if (items.windowOpen && items.onSill(player)) ui.prompt(input.isTouch ? 'Tap JUMP to leap out!' : 'Press [SPACE] to leap out!', 1);
  else ui.prompt(null);
  updateCompass();
  soundsFromMaria();
}

// Small arrow under the objective that points at the next thing to do.
function updateCompass() {
  let target = null;
  if (stage <= 1) {
    const kind = stage === 0 ? 'chopstick' : 'basil';
    let bd = Infinity;
    for (const p of items.pickups) {
      if (p.kind !== kind) continue;
      const d = dist2D(p.g.position, player.pos);
      if (d < bd) { bd = d; target = p.g.position; }
    }
  } else target = B(3.9, 5.33, 0.9);
  if (!target) { ui.setCompass(null); return; }
  const dx = target.x - player.pos.x, dz = target.z - player.pos.z, dist = Math.hypot(dx, dz);
  const fx = -Math.sin(follow.yaw), fz = -Math.cos(follow.yaw), rx = Math.cos(follow.yaw), rz = -Math.sin(follow.yaw);
  ui.setCompass(Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz), dist);
}

function soundsFromMaria() {
  if (!audio.ctx) return;
  const d = dist2D(maria.pos, state === 'home' ? camera.position : player.pos);
  if (maria.stepSound) audio.step(0.45 / (1 + d * d * 0.35));
  if (maria.chopSound) { audio.chop(0.18 / (1 + d * d * 0.3)); maria.chopSound = false; }
}

function handleEvent(ev) {
  if (!ev) return;
  if (ev === 'chopstick') ui.toast(`🥢 Chopstick ${items.chopsticks}/3`);
  if (ev === 'ramp') ui.toast('🥢 Ramp built! Basil leaves appeared around the flat 🌿', 3.5);
  if (ev === 'basil') ui.toast(`🌿 Basil friend ${items.basil}/3`);
  if (ev === 'superleap') ui.toast('🌿 SUPER LEAP unlocked!', 3);
  if (ev === 'windowStart') { maria.say('window', true); }
  if (ev === 'windowOpen') {
    ui.toast('🪟 The window is open! Press SPACE to leap out!', 3);
    maria.goState('window'); maria.say('window', true); audio.alert();
  }
  if (ev === 'escaped') startEscape();
  updateObjective();
}

// ---------- cinematics ----------
function startCaught() {
  state = 'caught'; cine = { t: 0, phase: 'grab' };
  if (document.pointerLockElement) document.exitPointerLock();
  ui.prompt(null); ui.show('touch', false); ui.show('pauseBtn', false);
  maria.cinematic = true; maria.model.position.y = 0; player.carried = true;
  maria.say('caught', true); audio.alert(); music.setLevel(2);
}
function startEscape() {
  // hop into the open pane first (so we never fly through the wall), then sail outside
  state = 'escaping'; cine = { t: 0, from: player.model.position.clone(), via: B(3.2, 5.52, 1.12), vel: new THREE.Vector3(0, 1.4, -2.2) };
  if (document.pointerLockElement) document.exitPointerLock();
  ui.prompt(null); ui.show('touch', false); ui.show('pauseBtn', false);
  audio.win(); music.setLevel(0); maria.frozen = true;
  ui.bubble('Noooo! My minestrone!', 3);
}

function cineUpdate(dt) {
  cine.t += dt;
  if (state === 'caught') {
    const stir = level.spots.Stir;
    if (cine.phase === 'grab') {
      maria.armR.rotation.x = -2.6; maria.armL.rotation.x = -0.5;
      player.model.position.lerp(maria.handPos, 1 - Math.exp(-10 * dt));
      if (cine.t > 0.8) cine.phase = 'walk';
    } else if (cine.phase === 'walk') {
      const arrived = maria.moveTo(new THREE.Vector3(stir.x, 0, stir.z), 1.5, dt);
      maria.armR.rotation.x = -2.6; maria.sync();
      player.model.position.copy(maria.handPos);
      if (arrived || cine.t > 8) { cine.phase = 'drop'; cine.t0 = cine.t; }
    } else if (cine.phase === 'drop') {
      maria.yaw = angleDamp(maria.yaw, 0, 6, dt); maria.sync();
      const k = Math.min(1, (cine.t - cine.t0) / 1.1);
      const top = level.potTop.clone().add(new THREE.Vector3(0, 0.35 * (1 - k * k), 0));
      player.model.position.lerp(top, 1 - Math.exp(-8 * dt));
      player.model.rotation.z += dt * 6;
      if (k >= 1) { cine.phase = 'splash'; cine.t0 = cine.t; items.fx.splash(level.potTop); audio.splash(); player.model.visible = false; ui.bubble('Buon appetito! 😋', 3); }
    } else if (cine.phase === 'splash' && cine.t - cine.t0 > 1.8) {
      state = 'over'; audio.lose(); music.setLevel(0);
      ui.el.loseText.textContent = `You lasted ${fmt(playTime)}. ${['Try hiding in the box tunnel!', 'Sprinting near Maria makes noise.', 'Maria has to kneel to reach under the table.', 'She can\'t see you while she\'s chopping.'][Math.floor(Math.random() * 4)]}`;
      ui.only('lose');
    }
    player.animate(dt, 0);
    const look = player.model.position;
    camera.position.lerp(B(2.3, 2.3, 1.7), 1 - Math.exp(-2 * dt)); camera.lookAt(look);
  } else if (state === 'escaping') {
    if (cine.t < 0.45) {
      const k = cine.t / 0.45, p = cine.from.clone().lerp(cine.via, k); p.y += Math.sin(k * Math.PI) * 0.12;
      player.model.position.copy(p); player.model.rotation.y = Math.PI;
    } else {
      cine.vel.y -= 4 * dt;
      player.model.position.addScaledVector(cine.vel, dt); player.model.rotation.x += dt * 3;
    }
    player.animate(dt, 2);
    camera.position.lerp(B(3.2, 4.9, 1.25), 1 - Math.exp(-3 * dt)); camera.lookAt(player.model.position);
    if (cine.t > 2.2) {
      state = 'over';
      const newBest = !best || playTime < best;
      if (newBest) { best = playTime; storage.set('saladEscape.best', best); }
      ui.el.winText.textContent = `Escape time: ${fmt(playTime)}${newBest ? ' (🏆 new best!)' : ` (best ${fmt(best)})`}. Maria will have to make do with carrots.`;
      ui.only('win');
    }
  }
  items.update(dt, { pos: new THREE.Vector3(99, 0, 99), feet: 0 }, false);
}

// ---------- debug hooks for testing ----------
function debugApi() {
  return {
    get state() { return state; }, get stage() { return stage; }, get bpm() { return Math.round(music.bpm); },
    player: () => ({ pos: player.pos.toArray().map((v) => +v.toFixed(2)), feet: +player.feet.toFixed(2), hidden: player.hidden, zone: player.zone?.name, superLeap: player.superLeap }),
    maria: () => ({ state: maria.state, pos: maria.pos.toArray().map((v) => +v.toFixed(2)), sees: maria.seesPlayer, suspicion: +maria.suspicion.toFixed(2) }),
    items: () => ({ chopsticks: items.chopsticks, basil: items.basil, windowOpen: items.windowOpen, pickups: items.pickups.map((p) => [p.kind, ...p.g.position.toArray().map((v) => +v.toFixed(2))]) }),
    tp(bx, by, bz = 0) { player.pos.copy(B(bx, by, bz)); player.feet = bz; player.vy = 0; },
    freeze(v = true) { maria.frozen = v; },
    give(what) {
      if (what === 'chopsticks') for (const p of [...items.pickups]) if (p.kind === 'chopstick') p.g.position.copy(player.pos), p.base = player.feet;
      if (what === 'basil') for (const p of [...items.pickups]) if (p.kind === 'basil') p.g.position.copy(player.pos), p.base = player.feet;
    },
    start: startGame, home: goHome,
    // run the simulation synchronously (tests work even when the tab isn't painting)
    sim(seconds, keys = []) {
      for (const k of keys) input.keys.add(k);
      if (keys.includes('Space')) input.jumpQueued = true;
      for (let t = 0; t < seconds; t += 1 / 60) frame(1 / 60, false);
      for (const k of keys) input.keys.delete(k);
    },
    render() { draw(); },
    get drawCalls() { return renderer.info.render.calls; },
    get mergedBatches() { return level.drawCalls; },
    raw: { get player() { return player; }, get maria() { return maria; }, get items() { return items; }, get level() { return level; }, get follow() { return follow; } },
    // test helper: walk (and optionally hop) toward a point given in Blender coordinates
    walkTo(bx, by, secs = 3, hop = false) {
      for (let t = 0; t < secs; t += 0.1) {
        const dx = bx - player.pos.x, dz = -by - player.pos.z;
        if (Math.hypot(dx, dz) < 0.06) break;
        follow.yaw = Math.atan2(-dx, -dz);
        this.sim(0.1, hop && player.onGround ? ['KeyW', 'Space'] : ['KeyW']);
      }
      return { pos: player.pos.toArray().map((v) => +v.toFixed(2)), feet: +player.feet.toFixed(2) };
    },
  };
}

boot().catch((e) => { console.error(e); document.querySelector('#loading h2').textContent = 'Could not load the game: ' + e.message; });
loop();
