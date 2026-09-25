import * as THREE from 'three';

// Blender (x, y, z-up) -> three.js (x, y-up, z)
export const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function angleDamp(a, b, rate, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-rate * dt));
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// glTF node names are sanitised by three ("Arm_L.001" -> "Arm_L001"), so match by prefix.
export function findPart(root, prefix) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.name.startsWith(prefix)) hit = o; });
  return hit;
}
export const storage = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
