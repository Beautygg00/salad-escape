import * as THREE from 'three';
import { findPart, angleDamp, dist2D, pick, rand, clamp } from './util.js';

const LINES = {
  spot: ['Eccola! There\'s my salad!', 'Come here, little salad!', 'Perfetto for my minestrone!', 'Ah-ha! Found you!'],
  chase: ['The soup needs one more vegetable!', 'Don\'t run, you\'ll bruise!', 'Vieni qui, insalatina!', 'You\'d be perfect with some lemon!', 'Just a little swim in the pot!'],
  lost: ['Where did my salad go?', 'Salad? Salaaad?', 'Hmm… I heard something.', 'You can\'t hide forever!'],
  cook: ['La la la… minestrone…', 'A bit more celery…', 'Mmm, smells so good!', 'Needs something green…', 'Carrots, zucchini, beans…'],
  kneel: ['Under the table? Really?', 'Ugh, my knees…'],
  check: ['What\'s in here…?', 'I saw you go in there!'],
  window: ['No no no! Not the window!', 'Don\'t you dare!'],
  caught: ['Gotcha! Into the pot!', 'Finally! Buon appetito!'],
  noise: ['Who\'s running around?', 'Did something just squeak?'],
};

// Tuning per difficulty. "hard" is the original balance; "normal" is the default.
export const DIFFICULTY = {
  easy: { chase: 1.25, walk: 0.85, bonus: 0.03, seeNear: 1.0, seeFar: 0.5, cone: 50, range: 5.5, lose: 0.9, reach: 0.4, reachHigh: 0.75, hear: 0.9, kneel: 4.2, check: 3.2, grace: 7 },
  normal: { chase: 1.45, walk: 0.95, bonus: 0.06, seeNear: 1.7, seeFar: 0.85, cone: 56, range: 6.5, lose: 1.2, reach: 0.45, reachHigh: 0.85, hear: 1.2, kneel: 3.4, check: 2.6, grace: 5 },
  hard: { chase: 1.7, walk: 1.0, bonus: 0.12, seeNear: 3.5, seeFar: 1.8, cone: 62, range: 8, lose: 1.6, reach: 0.55, reachHigh: 1.05, hear: 1.6, kneel: 2.5, check: 1.8, grace: 0 },
};

export class Maria {
  constructor(model, level, nav, audio, ui) {
    Object.assign(this, { model, level, nav, audio, ui });
    this.diff = DIFFICULTY.normal;
    this.legL = findPart(model, 'Leg_L'); this.legR = findPart(model, 'Leg_R');
    this.armL = findPart(model, 'Arm_L'); this.armR = findPart(model, 'Arm_R');
    this.head = findPart(model, 'Maria_Head');
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ray = new THREE.Raycaster();
    this.reset();
  }

  reset() {
    const chop = this.level.spots.Chop;
    this.pos = chop.clone(); this.pos.y = 0; this.yaw = 0;
    this.state = 'cook'; this.task = null; this.taskT = 0; this.phase = 0;
    this.path = null; this.pathT = 0; this.pathGoal = null;
    this.suspicion = 0; this.seesPlayer = false; this.lastSeen = null; this.lostT = 0; this.visionT = 0;
    this.stateT = 0; this.glanceT = rand(4, 7); this.glancing = 0; this.chopT = 0; this.stepT = 0;
    this.speedBonus = 0; this.frozen = false; this.cinematic = false; this.searchQueue = [];
    this.bubbleT = 0; this.lineCooldown = 0; this.checkZone = null;
    this.grace = this.diff.grace; // head start: she's busy with the soup for the first few seconds
    this.model.position.copy(this.pos); this.model.rotation.y = 0;
  }
  setDifficulty(name) { this.diff = DIFFICULTY[name] || DIFFICULTY.normal; }

  say(kind, force = false) {
    if (!force && this.lineCooldown > 0) return;
    this.ui.bubble(pick(LINES[kind]), 2.6); this.lineCooldown = 3.5;
  }

  get alertLevel() {
    if (this.state === 'chase' || this.state === 'kneel' || this.state === 'check' || this.state === 'window') return 2;
    if (this.state === 'search' || this.suspicion > 0.15) return 1;
    return 0;
  }

  // ---------------- perception ----------------
  canSee(player) {
    if (player.hidden && this.state !== 'check') return false;
    const eye = new THREE.Vector3(this.pos.x, 1.55, this.pos.z), target = player.center;
    const to = target.clone().sub(eye), d = to.length();
    if (d > this.diff.range) return false;
    const facing = this.yaw;
    const fx = Math.sin(facing), fz = Math.cos(facing), fl = Math.hypot(to.x, to.z) || 1;
    if ((to.x * fx + to.z * fz) / fl < Math.cos(THREE.MathUtils.degToRad(this.diff.cone)) && d > 0.9) return false;
    this.ray.set(eye, to.normalize()); this.ray.far = d;
    const hit = this.ray.intersectObjects(this.level.occluders, false)[0];
    return !hit || hit.distance > d - 0.18;
  }

  // ---------------- movement ----------------
  moveTo(goal, speed, dt) {
    this.pathT -= dt;
    if (!this.path || this.pathT <= 0 || !this.pathGoal || dist2D(this.pathGoal, goal) > 0.25) {
      this.path = this.nav.findPath(this.pos, goal); this.pathT = 0.3; this.pathGoal = goal.clone();
      if (this.path) this.path.shift();
    }
    if (!this.path || !this.path.length) return true;
    const wp = this.path[0], dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.08) { this.path.shift(); return !this.path.length; }
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
    this.yaw = angleDamp(this.yaw, Math.atan2(dx, dz), 9, dt);
    this.walkAnim(dt, speed);
    return false;
  }
  face(targetYaw, dt) { this.yaw = angleDamp(this.yaw, targetYaw, 6, dt); }
  faceToward(p, dt) { this.face(Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt); }

  walkAnim(dt, speed) {
    this.phase += dt * speed * 5.5;
    const s = Math.sin(this.phase) * clamp(speed, 0, 2) * 0.35;
    this.legL.rotation.x = s; this.legR.rotation.x = -s;
    if (this.state === 'chase' || this.state === 'window') { this.armL.rotation.x = -1.3 + s * 0.2; this.armR.rotation.x = -1.3 - s * 0.2; }
    else { this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8; }
    this.stepT -= dt * speed;
    if (this.stepT <= 0) { this.stepT = 0.55; this.stepSound = true; }
  }
  idleAnim(dt) {
    this.legL.rotation.x *= 0.85; this.legR.rotation.x *= 0.85;
    this.armL.rotation.x *= 0.9; this.armR.rotation.x *= 0.9; this.armR.rotation.z *= 0.9;
  }

  goState(s) { this.state = s; this.stateT = 0; this.path = null; }

  // ---------------- main update ----------------
  update(dt, player, game) {
    this.lineCooldown -= dt; this.stateT += dt; this.stepSound = false;
    if (this.frozen || this.cinematic) { this.sync(); return null; }
    const D = this.diff;
    const chase = D.chase + this.speedBonus, walk = D.walk + this.speedBonus * 0.5;

    // vision (throttled); blind during the opening grace period
    this.grace -= dt;
    this.visionT -= dt;
    if (this.visionT <= 0) { this.visionT = 0.12; this.seesPlayer = this.grace <= 0 && this.canSee(player); }
    const d = dist2D(this.pos, player.pos);
    if (this.seesPlayer) {
      this.lastSeen = player.pos.clone();
      this.suspicion = Math.min(1, this.suspicion + dt * (d < 2 ? D.seeNear : D.seeFar));
      if (this.suspicion >= 1 && this.state !== 'chase' && this.state !== 'window' && this.state !== 'kneel' && this.state !== 'check') {
        this.goState('chase'); this.say('spot', true); this.audio.alert(); this.glancing = 0;
      }
    } else if (this.state !== 'chase') this.suspicion = Math.max(0, this.suspicion - dt * 0.25);
    // she can hear you sprinting close by
    if (player.sprinting && !player.hidden && this.grace <= 0 && d < D.hear && (this.state === 'cook' || this.state === 'search')) {
      this.lastSeen = player.pos.clone(); this.suspicion = Math.max(this.suspicion, 0.6);
      if (this.state === 'cook') { this.goState('search'); this.say('noise'); }
    }

    switch (this.state) {
      case 'cook': this.cook(dt, walk, player); break;
      case 'chase': {
        const knowsSpot = player.hidden && player.seenEnter; // she saw you dive in: she heads straight there
        const underTable = this.level.underTable(player.pos, player.feet) && dist2D(this.pos, player.pos) < 2.5;
        if (knowsSpot || underTable) this.lastSeen = player.pos.clone();
        if (!this.seesPlayer && !knowsSpot && !underTable) {
          this.lostT += dt;
          if (this.lostT > D.lose) { this.goState('search'); this.say('lost'); this.lostT = 0; this.suspicion = 0.5; this.planSearch(); }
        } else this.lostT = 0;
        const target = this.seesPlayer ? player.pos : (this.lastSeen || player.pos);
        this.moveTo(new THREE.Vector3(target.x, 0, target.z), chase, dt);
        if (this.seesPlayer && d < 1.4) this.faceToward(player.pos, dt);
        if (Math.random() < dt * 0.25) this.say('chase');
        break;
      }
      case 'search': this.search(dt, walk * 1.25, player); break;
      case 'kneel': {
        this.faceToward(player.pos, dt); this.idleAnim(dt);
        this.model.position.y = -0.35 * Math.min(1, this.stateT * 2); this.armR.rotation.x = -1.4;
        if (this.stateT > D.kneel) {
          this.model.position.y = 0;
          if (this.level.underTable(player.pos, player.feet) && d < 0.95) return 'caught';
          this.goState('chase');
        }
        return null;
      }
      case 'check': {
        this.faceToward(player.pos, dt); this.idleAnim(dt); this.armR.rotation.x = -1.2; this.armL.rotation.x = -1.0;
        if (this.stateT > D.check) {
          if (player.zone === this.checkZone && d < 1.0) return 'caught';
          this.checkZone = null; this.goState('search'); this.say('lost'); this.planSearch();
        }
        break;
      }
      case 'window': {
        this.moveTo(this.nav.nearestFree(player.pos.x, player.pos.z) || this.pos, chase, dt);
        break;
      }
    }

    this.sync();
    return this.tryCatch(player, d);
  }

  tryCatch(player, d) {
    if (!['chase', 'search', 'window'].includes(this.state) || player.feet > 1.35) return null;
    if (this.level.underTable(player.pos, player.feet)) {
      if (d < 1.0 && (this.state === 'chase' || this.seesPlayer)) { this.goState('kneel'); this.say('kneel', true); }
      return null;
    }
    if (player.hidden) {
      if (player.zone && player.seenEnter && d < 0.9) { this.checkZone = player.zone; this.goState('check'); this.say('check', true); }
      return null;
    }
    const reach = player.feet > 0.35 ? this.diff.reachHigh : this.diff.reach;
    if (d > reach) return null;
    if (this.state === 'search' && !this.seesPlayer) return null;
    return 'caught';
  }

  cook(dt, walk, player) {
    if (!this.task) {
      const r = Math.random();
      this.task = r < 0.6 ? { spot: 'Chop', dur: rand(8, 12), anim: 'chop', yaw: 0 } : r < 0.9 ? { spot: 'Stir', dur: rand(4, 6), anim: 'stir', yaw: 0 } : { spot: 'Fridge', dur: rand(2, 3), anim: 'idle', yaw: -Math.PI / 2 };
      this.taskT = 0; this.arrived = false;
    }
    const goal = this.level.spots[this.task.spot];
    if (!this.arrived) { this.arrived = this.moveTo(new THREE.Vector3(goal.x, 0, goal.z), walk, dt); return; }
    this.taskT += dt;
    // occasional glance over the shoulder
    this.glanceT -= dt;
    if (this.glanceT <= 0 && this.glancing <= 0) { this.glancing = 1.8; this.glanceT = rand(5, 9); if (Math.random() < 0.3) this.say('cook'); }
    if (this.glancing > 0) { this.glancing -= dt; this.face(this.task.yaw + Math.PI * 0.85, dt); }
    else this.face(this.task.yaw, dt);
    this.legL.rotation.x *= 0.85; this.legR.rotation.x *= 0.85;
    const t = performance.now() / 1000;
    if (this.task.anim === 'chop' && this.glancing <= 0) {
      const c = Math.sin(t * 14);
      this.armR.rotation.x = -1.0 + c * 0.35; this.armL.rotation.x = -0.9;
      if (this.level.knife) this.level.knife.position.y = this.level.knifeRest.y + Math.max(0, c) * 0.05;
      this.chopT -= dt; if (this.chopT <= 0) { this.chopT = 0.45; this.chopSound = true; }
    } else if (this.task.anim === 'stir' && this.glancing <= 0) {
      this.armR.rotation.x = -1.1 + Math.sin(t * 4) * 0.15; this.armR.rotation.z = Math.cos(t * 4) * 0.2; this.armL.rotation.x = -0.3;
    } else this.idleAnim(dt);
    if (this.taskT > this.task.dur) { this.task = null; this.glancing = 0; if (this.level.knife) this.level.knife.position.copy(this.level.knifeRest); }
  }

  planSearch() {
    const from = this.lastSeen || this.pos;
    const zones = this.level.hideZones.map((z) => ({ z, c: z.box.getCenter(new THREE.Vector3()) }))
      .filter(({ c }) => dist2D(c, from) < 2.8).sort((a, b) => dist2D(a.c, from) - dist2D(b.c, from)).slice(0, 2);
    this.searchQueue = [{ p: from.clone(), look: 2.2 }, ...zones.map(({ z, c }) => ({ p: c, look: 1.4, zone: z }))];
  }

  search(dt, speed, player) {
    if (!this.searchQueue.length) { this.goState('cook'); this.task = null; this.suspicion = 0; return; }
    const cur = this.searchQueue[0];
    const goal = this.nav.nearestFree(cur.p.x, cur.p.z) || this.pos;
    if (dist2D(this.pos, goal) > 0.15) { this.moveTo(goal, speed, dt); this.lookT = 0; return; }
    this.idleAnim(dt);
    this.lookT = (this.lookT || 0) + dt;
    this.yaw += dt * 2.2 * Math.sin(this.lookT * 2);
    if (cur.zone && player.zone === cur.zone && this.lookT > 0.6) { this.checkZone = cur.zone; this.goState('check'); this.say('check', true); return; }
    if (this.lookT > cur.look) { this.searchQueue.shift(); this.lookT = 0; }
  }

  sync() {
    this.model.position.x = this.pos.x; this.model.position.z = this.pos.z;
    if (this.state !== 'kneel') this.model.position.y = 0;
    this.model.rotation.y = this.yaw;
  }
  get headPos() { return new THREE.Vector3(this.pos.x, this.model.position.y + 1.85, this.pos.z); }
  get handPos() { return this.armR.localToWorld(new THREE.Vector3(0, -0.62, -0.05)); }
}
