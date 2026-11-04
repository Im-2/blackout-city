// Static/dynamic AABB collision in a uniform spatial hash. Arcade only.

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  enabled: boolean;
  /** blocks line of sight (buildings, walls, doors). Thin poles don't. */
  occluder: boolean;
  tag?: string;
  stamp?: number;
}

const CELL = 8;

export class Collision {
  private grid = new Map<number, AABB[]>();
  private stamp = 1;
  all: AABB[] = [];

  private key(ix: number, iz: number) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, occluder = true, tag?: string): AABB {
    const b: AABB = { minX, minY, minZ, maxX, maxY, maxZ, enabled: true, occluder, tag };
    this.insert(b);
    return b;
  }

  addCentered(cx: number, cz: number, w: number, d: number, h: number, y0 = 0, occluder = true, tag?: string) {
    return this.add(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, occluder, tag);
  }

  insert(b: AABB) {
    this.all.push(b);
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++)
      for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        const k = this.key(ix, iz);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(b);
      }
  }

  remove(b: AABB) {
    b.enabled = false;
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++)
      for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        const a = this.grid.get(this.key(ix, iz));
        if (a) {
          const i = a.indexOf(b);
          if (i >= 0) a.splice(i, 1);
        }
      }
    const i = this.all.indexOf(b);
    if (i >= 0) this.all.splice(i, 1);
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: AABB[] = []): AABB[] {
    out.length = 0;
    const s = ++this.stamp;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const a = this.grid.get(this.key(ix, iz));
        if (!a) continue;
        for (const b of a) {
          if (b.stamp === s || !b.enabled) continue;
          b.stamp = s;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    return out;
  }

  private tmp: AABB[] = [];

  /**
   * Push a circle (x,z,r) out of boxes whose vertical span blocks it.
   * Boxes with top <= feetY + step are ignored (can be stepped onto).
   * Returns accumulated push normal (nx, nz) and count of hits.
   */
  resolveCircle(p: { x: number; z: number }, r: number, feetY: number, step: number, headY: number, minTop = 0, occludersOnly = false): { nx: number; nz: number; hits: number; depth: number } {
    const res = { nx: 0, nz: 0, hits: 0, depth: 0 };
    const boxes = this.query(p.x - r, p.z - r, p.x + r, p.z + r, this.tmp);
    for (const b of boxes) {
      if (b.maxY <= feetY + step || b.minY >= headY || b.maxY < minTop || (occludersOnly && !b.occluder)) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2), pen: number;
      if (d < 1e-5) {
        // centre inside the box: push out along the smallest axis
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) { dx = -1; dz = 0; pen = l + r; }
        else if (m === rr) { dx = 1; dz = 0; pen = rr + r; }
        else if (m === t) { dx = 0; dz = -1; pen = t + r; }
        else { dx = 0; dz = 1; pen = bt + r; }
        d = 1;
      } else pen = r - d;
      dx /= d; dz /= d;
      p.x += dx * pen;
      p.z += dz * pen;
      res.nx += dx; res.nz += dz; res.hits++;
      res.depth = Math.max(res.depth, pen);
    }
    if (res.hits) {
      const l = Math.hypot(res.nx, res.nz) || 1;
      res.nx /= l; res.nz /= l;
    }
    return res;
  }

  /** Highest box top under the circle that is at most `maxY` (for standing on things). */
  groundUnder(x: number, z: number, r: number, maxY: number): number {
    let g = -Infinity;
    for (const b of this.query(x - r, z - r, x + r, z + r, this.tmp)) {
      if (b.maxY > maxY) continue;
      if (x + r * 0.5 < b.minX || x - r * 0.5 > b.maxX || z + r * 0.5 < b.minZ || z - r * 0.5 > b.maxZ) continue;
      if (b.maxY > g) g = b.maxY;
    }
    return g;
  }

  /**
   * Ray vs boxes (3D slab test). Returns distance to first hit or Infinity.
   * Walks the grid along the ray's XZ footprint.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, occludersOnly = false): number {
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const s = ++this.stamp;
    let best = maxDist;
    const steps = Math.ceil(maxDist / (CELL * 0.5)) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = ox + (ex - ox) * t, pz = oz + (ez - oz) * t;
      if (t * maxDist > best + CELL) break;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let ax = cx - 1; ax <= cx + 1; ax++)
        for (let az = cz - 1; az <= cz + 1; az++) {
          const a = this.grid.get(this.key(ax, az));
          if (!a) continue;
          for (const b of a) {
            if (b.stamp === s || !b.enabled) continue;
            b.stamp = s;
            if (occludersOnly && !b.occluder) continue;
            const hit = rayBox(ox, oy, oz, dx, dy, dz, b);
            if (hit >= 0 && hit < best) best = hit;
          }
        }
    }
    return best < maxDist ? best : Infinity;
  }

  /** True if nothing occludes the segment between two points. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    return this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L, true) === Infinity;
  }
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB): number {
  let tmin = -Infinity, tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return -1;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
