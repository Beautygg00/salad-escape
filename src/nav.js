import * as THREE from 'three';

// Grid navigation for Maria. Anything that overlaps her body (0.05–1.0 m) blocks a cell.
export class Nav {
  constructor(boxes, { minX = -0.1, maxX = 4.7, minZ = -5.6, maxZ = 2.1, cell = 0.1, radius = 0.22 } = {}) {
    Object.assign(this, { minX, minZ, cell });
    this.nx = Math.ceil((maxX - minX) / cell); this.nz = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.radius = radius;
    this.rebuild(boxes);
  }

  rebuild(boxes) {
    this.blocked.fill(0);
    const r = this.radius, c = this.cell;
    for (const { box } of boxes) {
      if (box.min.y > 1.0 || box.max.y < 0.05) continue;
      const i0 = Math.max(0, Math.floor((box.min.x - r - this.minX) / c)), i1 = Math.min(this.nx - 1, Math.floor((box.max.x + r - this.minX) / c));
      const j0 = Math.max(0, Math.floor((box.min.z - r - this.minZ) / c)), j1 = Math.min(this.nz - 1, Math.floor((box.max.z + r - this.minZ) / c));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.blocked[i + j * this.nx] = 1;
    }
  }

  toCell(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  center(i, j) { return new THREE.Vector3(this.minX + (i + 0.5) * this.cell, 0, this.minZ + (j + 0.5) * this.cell); }
  free(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && !this.blocked[i + j * this.nx]; }
  freeAt(x, z) { const [i, j] = this.toCell(x, z); return this.free(i, j); }

  nearestFree(x, z, maxR = 25) {
    const [ci, cj] = this.toCell(x, z);
    if (this.free(ci, cj)) return this.center(ci, cj);
    let best = null, bd = Infinity;
    for (let r = 1; r <= maxR && !best; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !this.free(i, j)) continue;
        const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = [i, j]; }
      }
    }
    return best ? this.center(best[0], best[1]) : null;
  }

  lineFree(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (this.cell * 0.5));
    for (let k = 1; k < n; k++) { const t = k / n; if (!this.freeAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
    return true;
  }

  findPath(from, to) {
    const start = this.nearestFree(from.x, from.z, 6), goal = this.nearestFree(to.x, to.z);
    if (!start || !goal) return null;
    const [si, sj] = this.toCell(start.x, start.z), [gi, gj] = this.toCell(goal.x, goal.z);
    const N = this.nx * this.nz, gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const s = si + sj * this.nx, g = gi + gj * this.nx;
    const heap = [[0, s]]; gScore[s] = 0;
    const h = (i, j) => Math.hypot(i - gi, j - gj);
    const push = (item) => { heap.push(item); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    let found = false, iters = 0;
    while (heap.length && iters++ < 20000) {
      const [, cur] = pop();
      if (cur === g) { found = true; break; }
      if (closed[cur]) continue; closed[cur] = 1;
      const ci = cur % this.nx, cj = (cur / this.nx) | 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue; // no corner cutting
        const n = ni + nj * this.nx, cost = gScore[cur] + (di && dj ? 1.4142 : 1);
        if (cost < gScore[n]) { gScore[n] = cost; came[n] = cur; push([cost + h(ni, nj), n]); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = g; c !== -1; c = came[c]) cells.push(this.center(c % this.nx, (c / this.nx) | 0));
    cells.reverse();
    // string-pull: keep only the points we can't walk straight past
    const out = [cells[0]];
    let anchor = cells[0];
    for (let k = 2; k < cells.length; k++) {
      if (!this.lineFree(anchor, cells[k])) { anchor = cells[k - 1]; out.push(anchor); }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}
