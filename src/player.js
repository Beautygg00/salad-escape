import * as THREE from 'three';
import { findPart, angleDamp, clamp } from './util.js';

const GRAVITY = 11;
export const STEP = 0.08;

export class Player {
  constructor(model, level, audio) {
    this.model = model; this.level = level; this.audio = audio;
    this.legL = findPart(model, 'Leg_L'); this.legR = findPart(model, 'Leg_R');
    this.armL = findPart(model, 'Arm_L'); this.armR = findPart(model, 'Arm_R');
    this.body = findPart(model, 'Salad_Body'); this.bodyY = this.body.position.y;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.radius = 0.1; this.height = 0.22;
    this.reset(new THREE.Vector3(), 0);
  }

  reset(pos, yaw) {
    this.pos = pos.clone(); this.feet = pos.y; this.vy = 0; this.onGround = true;
    this.yaw = yaw; this.phase = 0; this.stamina = 1; this.superLeap = false;
    this.sprinting = false; this.moving = false; this.frozen = false; this.carried = false;
    this.model.position.copy(this.pos); this.model.rotation.set(0, yaw, 0); this.model.scale.setScalar(1);
  }

  update(dt, input, camYaw) {
    if (this.frozen || this.carried) { this.animate(dt, 0); return; }
    const lv = this.level;
    const mv = input.move();
    const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
    let dx = fwdX * mv.y + Math.cos(camYaw) * mv.x, dz = fwdZ * mv.y - Math.sin(camYaw) * mv.x;
    const mag = Math.hypot(dx, dz);
    this.moving = mag > 0.05;
    this.sprinting = this.moving && input.sprint && this.stamina > 0.02;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt / 3.2);
    else this.stamina = Math.min(1, this.stamina + dt * (this.moving ? 0.18 : 0.3));
    const speed = (this.sprinting ? 2.4 : 1.45) * (this.onGround ? 1 : 0.85);
    if (this.moving) this.yaw = angleDamp(this.yaw, Math.atan2(dx, dz), 12, dt);

    // horizontal
    this.pos.x += dx * speed * dt; this.pos.z += dz * speed * dt;
    lv.resolve(this.pos, this.radius, this.feet, this.height, STEP);

    // vertical
    if (input.consumeJump() && this.onGround) {
      const h = this.superLeap ? 0.46 : 0.21;
      this.vy = Math.sqrt(2 * GRAVITY * h); this.onGround = false; this.audio.jump(this.superLeap);
    }
    const prevFeet = this.feet;
    this.vy -= GRAVITY * dt; this.feet += this.vy * dt;
    if (this.vy > 0) {
      const ceil = lv.ceilingBetween(this.pos.x, this.pos.z, this.radius * 0.7, prevFeet + this.height, this.feet + this.height);
      if (ceil < Infinity) { this.feet = ceil - this.height - 0.001; this.vy = 0; }
    }
    const ground = lv.groundAt(this.pos.x, this.pos.z, this.radius * 0.55, Math.max(prevFeet, this.feet) + STEP);
    if (this.feet <= ground) {
      if (!this.onGround && this.vy < -2) this.audio.land();
      this.feet = ground; this.vy = 0; this.onGround = true;
    } else if (this.feet > ground + 0.02) this.onGround = false;
    if (this.feet < -3) this.feet = 0; // safety
    this.pos.y = this.feet;

    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    this.animate(dt, this.moving ? speed : 0);
  }

  animate(dt, speed) {
    this.phase += dt * (speed > 0 ? 6 + speed * 6 : 0);
    const s = speed > 0 ? Math.sin(this.phase) : 0, air = !this.onGround && !this.carried;
    const swing = air ? 0.6 : s * 0.9;
    if (this.legL) { this.legL.rotation.x = swing; this.legR.rotation.x = air ? -0.4 : -swing; }
    if (this.armL) {
      this.armL.rotation.x = this.carried ? -2.4 : -swing * 0.8; this.armR.rotation.x = this.carried ? -2.4 : swing * 0.8;
      this.armL.rotation.z = this.carried ? 0.3 * Math.sin(performance.now() / 80) : 0;
    }
    if (this.body) this.body.position.y = this.bodyY + Math.abs(s) * 0.012 * clamp(speed, 0, 1);
  }

  get center() { return new THREE.Vector3(this.pos.x, this.feet + 0.12, this.pos.z); }
}

// Third-person orbit camera that pulls in when furniture is in the way.
export class FollowCam {
  constructor(camera, level) {
    this.cam = camera; this.level = level;
    this.yaw = 0; this.pitch = 0.38; this.dist = 1.25; this.cur = 1.25;
    this.ray = new THREE.Raycaster(); this.target = new THREE.Vector3();
    this.sens = 1; this.invert = false;
  }
  applyLook(look) {
    this.yaw -= look.dx * 0.0032 * this.sens;
    this.pitch = clamp(this.pitch + look.dy * 0.0032 * this.sens * (this.invert ? -1 : 1), -0.35, 1.2);
  }
  update(dt, focus) {
    this.target.lerp(focus, 1 - Math.exp(-18 * dt));
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.ray.set(this.target, dir); this.ray.far = this.dist; this.ray.near = 0;
    const hit = this.ray.intersectObjects(this.level.occluders, false)[0];
    const want = hit ? Math.max(0.12, hit.distance - 0.06) : this.dist;
    this.cur = want < this.cur ? want : this.cur + (want - this.cur) * (1 - Math.exp(-4 * dt));
    this.cam.position.copy(this.target).addScaledVector(dir, this.cur);
    this.cam.lookAt(this.target);
  }
}
