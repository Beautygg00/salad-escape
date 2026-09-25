import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { B, clamp } from './util.js';

export const ROOM = { W: 4.6, L: 5.5, H: 2.5 };

// One shared glTF loader that understands Draco-compressed meshes.
export function makeLoader() {
  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  return new GLTFLoader().setDRACOLoader(draco);
}

// Meshes that never block anything (decals, foliage, ceiling bits, soft cloth, handles, tiny props).
const SOFT = new RegExp([
  'Ceiling', 'Seam', 'Rim_', '^Spot_\\d', 'Backdrop', 'Curtain', 'Leaves', 'Stems', 'Plant_Spider', 'HideZone', 'Crown', 'Soup_',
  'Art\\d*$', 'Photo_Frame_Print', 'Melvin', 'Calendar', '^Apron', 'Spray', 'Hide_Blanket', 'Hide_CardboardBox_Flap', 'Hide_CardboardBox_Tape',
  'Hide_LaundryBasket', 'Window_Sash', 'Window_Handle', 'Towel', 'Oven_Mitt', 'Magnet', 'Utensil', 'Dish_Brush', 'Carrot', 'Celery', 'Tomato',
  'Diced', 'Zucchini', 'Chef_Knife', 'Bowl_Veg', 'Water_Heater', 'Heater_Pipe', 'Boiler', 'Hood', 'Socket', 'Switch', 'Sticker', 'Display', 'Knob',
  'Handle', '_Post\\d', 'Faucet', 'Hob_Ring', 'Sink_Drain', 'Paper_Towel', 'Pantry_', 'Cart_Item_', 'Spice_', 'Toy_', 'Tshirt', 'Kettle_Spout',
  'Label', 'Tape', 'Hall_Door_Panel', 'Hall_Door_Rose', 'Dial', 'Coffee_Cup', 'Fruit', 'Water_Filter_Lid', 'Pillow', 'Sock',
].join('|'));
const TRANSPARENT = /Glass|Curtain|Clear|Carafe|Spray|Pasta_Bag|Frosted|HideZone|Jug_Smoke|Bottle_Oil|Bottle_Green/;
// Meshes the game moves at runtime: keep them as separate objects.
const DYNAMIC = /^Window_Sash|^Window_Handle|^Chef_Knife|^HideZone/;

function planksTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const rowH = 128, plankW = 512;
  for (let r = 0; r < 4; r++) {
    const off = (r % 2) * plankW * 0.45;
    for (let i = -1; i < 3; i++) {
      const x = i * plankW + off;
      const t = 205 + Math.random() * 22;
      g.fillStyle = `rgb(${t},${t - 6},${t - 16})`;
      g.fillRect(x, r * rowH, plankW, rowH);
      for (let k = 0; k < 14; k++) { // wood grain
        g.strokeStyle = `rgba(120,95,70,${0.04 + Math.random() * 0.06})`; g.lineWidth = 1 + Math.random() * 2;
        const y = r * rowH + Math.random() * rowH; g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + plankW * 0.3, y + (Math.random() - 0.5) * 14, x + plankW * 0.7, y + (Math.random() - 0.5) * 14, x + plankW, y); g.stroke();
      }
      g.fillStyle = 'rgba(90,75,60,0.55)'; g.fillRect(x, r * rowH, 3, rowH);
    }
    g.fillStyle = 'rgba(90,75,60,0.6)'; g.fillRect(0, r * rowH, 1024, 3);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function tilesTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, 256, 256);
  const grad = g.createLinearGradient(0, 0, 256, 256); grad.addColorStop(0, '#fbfbfb'); grad.addColorStop(1, '#ececec');
  g.fillStyle = grad; g.fillRect(5, 5, 246, 246);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// World-space planar UVs so the canvas textures tile at real-world size.
function planarUV(mesh, axisU, axisV, sizeU, sizeV) {
  const geo = mesh.geometry, pos = geo.attributes.position, v = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    uv[i * 2] = v[axisU] / sizeU; uv[i * 2 + 1] = v[axisV] / sizeV;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export class Level {
  constructor(scene) {
    this.scene = scene;
    this.boxes = [];        // static colliders { box: Box3, name, mesh }
    this.dynamic = [];      // colliders that can be removed at runtime
    this.occluders = [];    // meshes used for line-of-sight and camera raycasts
    this.hideZones = [];
    this.spots = {};
    this.ramp = null;
  }

  async load(url, onProgress) {
    const gltf = await makeLoader().loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    let planks = null, tiles = null; // canvas fallbacks, only used if the export has no textures

    this.root.traverse((o) => {
      if (o.name.startsWith('Spot_') && !o.isMesh) this.spots[o.name.slice(5)] = o.getWorldPosition(new THREE.Vector3());
      if (!o.isMesh) return;
      const name = o.name;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (TRANSPARENT.test(m.name) || m.opacity < 1) { m.transparent = true; m.depthWrite = false; m.opacity = Math.min(m.opacity, /Glass/.test(m.name) ? 0.2 : 0.65); }
        if (/Curtain/.test(m.name)) { m.opacity = 0.5; m.side = THREE.DoubleSide; }
        if (/Leaf|Monstera_Leaf/.test(m.name)) m.side = THREE.DoubleSide; // single-sided leaf cards
        if (m.name === 'IMG_Window_View') { m.toneMapped = false; m.emissiveIntensity = 1.0; }
        if (m.map) m.map.anisotropy = 8;
      }
      if ((name === 'Floor' || name === 'Hall_Floor') && !o.material.map) {
        planarUV(o, 'x', 'z', 2.6, 0.76); planks ??= planksTexture();
        o.material = o.material.clone(); o.material.map = planks; o.material.color.set(0xffffff); o.material.roughness = 0.55;
      }
      if (name === 'Backsplash_Tiles' && !o.material.map) {
        planarUV(o, 'x', 'y', 0.15, 0.15); tiles ??= tilesTexture();
        o.material = o.material.clone(); o.material.map = tiles; o.material.color.set(0xffffff); o.material.roughness = 0.15;
      }
      if (/Backdrop/.test(name)) { o.castShadow = o.receiveShadow = false; return; }
      o.castShadow = !/Glass|Curtain|Spot_|Rim_|Seam/.test(name);
      o.receiveShadow = true;

      if (name.startsWith('HideZone_')) {
        o.visible = false;
        this.hideZones.push({ name: name.slice(9), box: new THREE.Box3().setFromObject(o) });
        return;
      }
      if (SOFT.test(name)) return;
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      this.boxes.push({ box, name, mesh: o });
      if (size.x + size.y + size.z > 0.12) this.occluders.push(o);
    });

    // Laundry basket: only its closed end blocks, so you can crawl in from the open side.
    this.addBox('Basket_Bottom', B(3.3, 3.85, 0), B(3.35, 4.25, 0.42));
    // Invisible glass in the small east window (so you can't skip the puzzle).
    this.addBox('East_Glass', B(4.6, 5.4, 0.85), B(4.72, 4.75, 2.3));
    const eg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.4), new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.12, depthWrite: false }));
    eg.position.copy(B(4.64, 5.1, 1.6)); eg.rotation.y = Math.PI / 2; this.scene.add(eg);

    // Window sash: swings open at the end, so it's a removable collider.
    this.sash = this.root.getObjectByName('Window_Sash');
    this.sashCollider = { box: new THREE.Box3().setFromObject(this.sash), name: 'Sash', mesh: this.sash };
    this.dynamic.push(this.sashCollider);
    this.occluders.push(this.sash);

    this.knife = this.root.getObjectByName('Chef_Knife');
    this.knifeRest = this.knife?.position.clone();
    this.potTop = B(0.86, 0.32, 1.07);
    this.table = { center: B(1.2, 4.3, 0), r: 0.6, top: 0.73 };
    this.mergeStatic();
    this.addLights();
  }

  // Merge every static mesh that shares a material into one draw call.
  // Colliders and raycast occluders keep pointing at the original (now detached) meshes.
  mergeStatic() {
    const groups = new Map(), victims = [];
    this.root.traverse((o) => {
      if (!o.isMesh || !o.visible || Array.isArray(o.material)) return;
      let p = o, dyn = false;
      while (p) { if (DYNAMIC.test(p.name)) { dyn = true; break; } p = p.parent; }
      if (dyn) return;
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
      if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      g.morphAttributes = {};
      groups.get(key).geos.push(g);
      victims.push(o);
    });
    for (const o of victims) o.parent.remove(o);
    this.merged = new THREE.Group(); this.merged.name = 'MergedStatic';
    for (const { mat, cast, recv, geos } of groups.values()) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; m.matrixAutoUpdate = false;
      this.merged.add(m);
    }
    this.scene.add(this.merged);
    this.drawCalls = this.merged.children.length;
  }

  addBox(name, a, b) {
    const box = new THREE.Box3(a.clone().min(b), a.clone().max(b));
    this.boxes.push({ box, name, mesh: null });
  }
  allBoxes() { return this.dynamic.length ? this.boxes.concat(this.dynamic) : this.boxes; }
  removeDynamic(c) { this.dynamic = this.dynamic.filter((d) => d !== c); }

  addLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xe8eeff, 0xb49c80, 0.75));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sun.position.copy(B(1.5, 10, 6)); sun.target.position.copy(B(2.3, 3.2, 0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    s.add(sun, sun.target); this.sun = sun;
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6); fill.position.copy(B(2.3, 2, 2.4)); s.add(fill);
    for (const [x, y] of [[1.0, 1.2], [2.3, 1.2], [3.6, 1.2], [1.2, 3.8], [2.6, 3.0], [3.2, 4.5]]) {
      const p = new THREE.PointLight(0xffe2bf, 1.4, 4.5, 2); p.position.copy(B(x, y, 2.35)); s.add(p);
    }
  }

  setShadowQuality(high) { this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }

  // Highest walkable surface under a circle at (x, z) that is no higher than maxY.
  groundAt(x, z, r, maxY) {
    let g = -10;
    for (const { box } of this.allBoxes()) {
      if (box.max.y > maxY || box.max.y <= g) continue;
      if (x + r < box.min.x || x - r > box.max.x || z + r < box.min.z || z - r > box.max.z) continue;
      g = box.max.y;
    }
    if (this.ramp) {
      const R = this.ramp;
      if (x > R.x0 - 0.05 && x < R.x1 + 0.05 && z > R.z0 && z < R.z1) {
        const h = clamp((x - R.x0) / (R.x1 - R.x0), 0, 1) * R.h;
        if (h <= maxY + 0.1 && h > g) g = h;
      }
    }
    return g;
  }

  // Push a vertical cylinder out of every collider that overlaps its height band.
  resolve(pos, r, feet, height, step) {
    for (let iter = 0; iter < 2; iter++) {
      for (const { box } of this.allBoxes()) {
        if (box.max.y <= feet + step || box.min.y >= feet + height) continue;
        if (this.ramp && box === this.ramp.chaise && feet > 0.3 && pos.z > this.ramp.z0 && pos.z < this.ramp.z1) continue;
        const cx = clamp(pos.x, box.min.x, box.max.x), cz = clamp(pos.z, box.min.z, box.max.z);
        const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k;
        } else { // centre inside the box: leave along the shallowest side
          const opts = [[pos.x - box.min.x + r, -1, 'x'], [box.max.x - pos.x + r, 1, 'x'], [pos.z - box.min.z + r, -1, 'z'], [box.max.z - pos.z + r, 1, 'z']];
          opts.sort((a, b) => a[0] - b[0]); pos[opts[0][2]] += opts[0][0] * opts[0][1];
        }
      }
    }
  }

  // Lowest ceiling above the circle between y0 and y1 (for head bumps).
  ceilingBetween(x, z, r, y0, y1) {
    let c = Infinity;
    for (const { box } of this.allBoxes()) {
      if (box.min.y < y0 - 0.001 || box.min.y > y1) continue;
      if (x + r < box.min.x || x - r > box.max.x || z + r < box.min.z || z - r > box.max.z) continue;
      c = Math.min(c, box.min.y);
    }
    return c;
  }

  zoneAt(p, feet) {
    for (const z of this.hideZones) {
      const b = z.box;
      if (p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && feet >= b.min.y - 0.06 && feet < b.max.y) return z;
    }
    return null;
  }

  underTable(p, feet) {
    return feet < 0.5 && Math.hypot(p.x - this.table.center.x, p.z - this.table.center.z) < this.table.r - 0.05;
  }
}
