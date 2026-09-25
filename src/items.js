import * as THREE from 'three';
import { B, shuffle, dist2D } from './util.js';

const CHOPSTICK_SPOTS = [
  [1.35, 4.45, 0.02], [0.4, 3.15, 0], [3.12, 0.25, 0.17], [3.62, -1.9, 0], [2.3, 1.8, 0], [0.12, 5.33, 0], [1.6, 2.9, 0],
];
// Basil hides all over the flat (3 are picked each round, at most one on the sofa).
const BASIL_SPOTS = [
  { p: [3.12, 4.05, 0.0], tag: 'basket' },       // inside the tipped laundry basket
  { p: [0.62, 3.95, 0.0], tag: 'blanket' },      // in the blanket tent under the chair
  { p: [1.02, 4.12, 0.06], tag: 'table' },       // on the tulip table's base
  { p: [3.5, -1.42, 0.1], tag: 'shoe' },         // on top of a sneaker in the hallway
  { p: [0.9, 2.6, 0.01], tag: 'box' },           // inside the cardboard box
  { p: [1.5, 0.74, 0.0], tag: 'kitchen' },       // in front of the sink, between Maria's two work spots
  { p: [3.25, 4.95, 0.505], tag: 'sofa' },       // on the chaise, via the ramp
];

function chopstickMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.5 });
  for (const off of [-0.012, 0.012]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0065, 0.24, 8), mat);
    m.rotation.z = Math.PI / 2; m.position.z = off; m.castShadow = true; g.add(m);
  }
  return g;
}
function basilMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f9b2c, roughness: 0.4, emissive: 0x0d3308 });
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat);
    leaf.scale.set(1, 0.18, 0.6); leaf.rotation.y = (i * Math.PI * 2) / 3; leaf.position.set(Math.cos(i * 2.1) * 0.025, 0, Math.sin(i * 2.1) * 0.025);
    leaf.castShadow = true; g.add(leaf);
  }
  return g;
}
function glowRing(color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; return m;
}

export class Items {
  constructor(scene, level, audio) {
    Object.assign(this, { scene, level, audio });
    this.group = new THREE.Group(); scene.add(this.group);
    this.fx = new Effects(scene);
  }

  reset() {
    this.group.clear();
    this.chopsticks = 0; this.basil = 0; this.windowProgress = 0; this.windowOpen = false; this.sashAngle = 0;
    this.level.ramp = null;
    if (this.rampMesh) { this.scene.remove(this.rampMesh); this.rampMesh = null; }
    if (!this.level.dynamic.includes(this.level.sashCollider)) this.level.dynamic.push(this.level.sashCollider);
    this.level.sash.rotation.y = 0;
    this.pickups = [];
    for (const s of shuffle([...CHOPSTICK_SPOTS]).slice(0, 3)) this.addPickup('chopstick', B(...s));
  }

  addPickup(kind, pos) {
    const obj = kind === 'chopstick' ? chopstickMesh() : basilMesh();
    const ring = glowRing(kind === 'chopstick' ? 0xffd54f : 0x9cff57);
    const g = new THREE.Group(); g.add(obj, ring); g.position.copy(pos);
    this.group.add(g);
    this.pickups.push({ kind, g, obj, ring, base: pos.y, t: Math.random() * 6 });
  }

  spawnBasil() {
    for (const s of shuffle([...BASIL_SPOTS]).slice(0, 3)) this.addPickup('basil', B(...s.p));
  }

  buildRamp() {
    // three chopsticks side by side, from the floor up to the sofa chaise
    const x0 = 2.1, x1 = 2.8, h = 0.5;
    const chaise = this.level.boxes.find((b) => b.name === 'Sofa_Chaise');
    this.level.ramp = { x0, x1, z0: -5.15, z1: -4.75, h, chaise: chaise?.box };
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.5 });
    const len = Math.hypot(x1 - x0, h), ang = Math.atan2(h, x1 - x0);
    for (const y of [4.8, 4.95, 5.1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, len, 10), mat);
      m.rotation.z = -(Math.PI / 2 - ang); m.position.copy(B((x0 + x1) / 2, y, h / 2)); m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    // a little woven "deck" so it reads as walkable
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.006, 0.38), new THREE.MeshStandardMaterial({ color: 0xa87945, roughness: 0.7 }));
    deck.rotation.z = ang; deck.position.copy(B((x0 + x1) / 2, 4.95, h / 2 + 0.012)); deck.receiveShadow = true; g.add(deck);
    this.rampMesh = g; this.scene.add(g);
    this.fx.burst(B(2.45, 4.95, 0.3), 0xffd54f, 30);
  }

  // Returns an event string when something important happens.
  update(dt, player, useHeld) {
    for (const p of this.pickups) {
      p.t += dt; p.g.position.y = p.base + 0.06 + Math.sin(p.t * 3) * 0.025; p.obj.rotation.y += dt * 2;
      p.ring.position.y = -0.055 - Math.sin(p.t * 3) * 0.025; p.ring.material.opacity = 0.35 + Math.sin(p.t * 5) * 0.2;
    }
    let event = null;
    for (const p of [...this.pickups]) {
      if (dist2D(p.g.position, player.pos) < 0.16 && Math.abs(p.base - player.feet) < 0.25) {
        this.group.remove(p.g); this.pickups.splice(this.pickups.indexOf(p), 1);
        this.fx.burst(p.g.position, p.kind === 'chopstick' ? 0xffd54f : 0x9cff57, 16);
        if (p.kind === 'chopstick') {
          this.chopsticks++; this.audio.pickup(); event = 'chopstick';
          if (this.chopsticks === 3) { this.buildRamp(); this.spawnBasil(); this.audio.bigPickup(); event = 'ramp'; }
        } else {
          this.basil++; this.audio.pickup(); event = 'basil';
          if (this.basil === 3) { player.superLeap = true; this.audio.bigPickup(); event = 'superleap'; }
        }
      }
    }
    // window: stand on the sill in front of the openable pane and hold E
    const onSill = this.onSill(player);
    if (!this.windowOpen && player.superLeap && onSill) {
      if (useHeld) {
        if (this.windowProgress === 0) { this.audio.creak(); event = 'windowStart'; }
        this.windowProgress = Math.min(1, this.windowProgress + dt / 1.2);
        if (this.windowProgress >= 1) {
          this.windowOpen = true; this.level.removeDynamic(this.level.sashCollider); this.audio.creak(); event = 'windowOpen';
        }
      } else this.windowProgress = Math.max(0, this.windowProgress - dt * 0.5);
    }
    if (this.windowOpen && this.sashAngle > -1.35) { this.sashAngle -= dt * 2.2; this.level.sash.rotation.y = this.sashAngle; }
    if (this.windowOpen && player.pos.z < -(5.5 + 0.13)) event = 'escaped';
    this.fx.update(dt);
    return event;
  }

  onSill(player) {
    // the openable pane, plus the corner where the sofa back meets the sill (no cactus hop needed)
    const b = { x0: 2.55, x1: 4.05 };
    return player.feet > 0.8 && player.feet < 1.2 && player.pos.x > b.x0 && player.pos.x < b.x1 && player.pos.z < -5.15;
  }
}

// Tiny particle system: sparkles, pot steam, splash.
export class Effects {
  constructor(scene) {
    this.scene = scene; this.parts = [];
    this.geo = new THREE.SphereGeometry(1, 6, 4);
    this.steamT = 0;
  }
  spawn(pos, color, vel, life, size, opts = {}) {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1, depthWrite: false }));
    m.position.copy(pos); m.scale.setScalar(size); this.scene.add(m);
    this.parts.push({ m, vel, life, max: life, grow: opts.grow || 0, grav: opts.grav ?? 0, fade: opts.opacity ?? 1 });
  }
  burst(pos, color, n) {
    for (let i = 0; i < n; i++) this.spawn(pos, color, new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.6, (Math.random() - 0.5) * 1.6), 0.6, 0.012, { grav: 4 });
  }
  splash(pos) {
    for (let i = 0; i < 40; i++) this.spawn(pos, i % 3 ? 0xc0461a : 0xf0a060, new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5), 1.0, 0.012, { grav: 6 });
  }
  steam(dt, pos) {
    this.steamT -= dt;
    if (this.steamT > 0) return;
    this.steamT = 0.12;
    const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15));
    this.spawn(p, 0xffffff, new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.25, (Math.random() - 0.5) * 0.05), 2.2, 0.025, { grow: 0.04, opacity: 0.35 });
  }
  update(dt) {
    for (const p of [...this.parts]) {
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.m); p.m.material.dispose(); this.parts.splice(this.parts.indexOf(p), 1); continue; }
      p.vel.y -= p.grav * dt; p.m.position.addScaledVector(p.vel, dt);
      p.m.scale.addScalar(p.grow * dt); p.m.material.opacity = p.fade * (p.life / p.max);
    }
  }
}
