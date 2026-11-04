// GPS: routes the player along the road graph to the active mission target, side
// job or custom waypoint. Draws flowing chevrons on the road in the world; the
// minimap and full map read `path`.
import * as THREE from 'three';
import { basicMat } from '../render/patch';
import { RING, lanePoint, surfaceHeight } from '../world/layout';
import type { Game } from '../core/game';

const MAX = 70;
const SPACING = 3.6;
const REACH = 110;

export class Gps {
  waypoint: THREE.Vector3 | null = null;
  /** polyline from the player to the target (x,z pairs) */
  path: { x: number; z: number }[] = [];
  private mesh: THREE.InstancedMesh;
  private mat: THREE.MeshBasicMaterial;
  private t = 0;
  private repathT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(private g: Game) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.8, -0.5);
    shape.lineTo(0, 0.4);
    shape.lineTo(0.8, -0.5);
    shape.lineTo(0.8, -0.05);
    shape.lineTo(0, 0.85);
    shape.lineTo(-0.8, -0.05);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    this.mat = basicMat({ color: '#ffd24a', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    g.scene.add(this.mesh);
  }

  setWaypoint(x: number, z: number) {
    this.waypoint = new THREE.Vector3(x, 1, z);
    this.repathT = 0;
    this.g.audio.checkpoint();
  }

  clearWaypoint() {
    this.waypoint = null;
    this.repathT = 0;
  }

  /** mission target beats side job beats custom waypoint */
  get target(): THREE.Vector3 | null {
    return this.g.missionTarget();
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    const P = g.player.worldPos;
    const T = this.target;
    if (this.waypoint && !g.missions.run && !g.jobs.active && Math.hypot(this.waypoint.x - P.x, this.waypoint.z - P.z) < 8) {
      this.waypoint = null;
      g.hud.toast('WAYPOINT REACHED', 'cool');
    }
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.repathT = 0.7;
      this.path = T && P.y > -2 ? this.route(P.x, P.z, T.x, T.z) : [];
    }
    this.draw(P, !!g.missions.run);
  }

  /** player -> along the road graph -> nearest road point to the target */
  private route(px: number, pz: number, tx: number, tz: number) {
    if (Math.hypot(tx - px, tz - pz) < 14) return [];
    const G = this.g.city.graph;
    const from = G.edgeAt(px, pz), to = G.edgeAt(tx, tz);
    const pt = (e: typeof from) => {
      const A = G.nodes[e.edge.a], B = G.nodes[e.edge.b];
      return { x: A.x + (B.x - A.x) * e.t, z: A.z + (B.z - A.z) * e.t };
    };
    const start = pt(from), end = pt(to);
    // same stretch of road: straight there
    if (from.edge.id === to.edge.id) return [{ x: px, z: pz }, start, end];
    const cost = (e: typeof G.edges[0]) => (e.closed ? 40 : e.name === RING ? 0.7 : 1);
    const len = (nodes: number[], sx: number, sz: number, ex: number, ez: number) => {
      let L = Math.hypot(G.nodes[nodes[0]].x - sx, G.nodes[nodes[0]].z - sz) + Math.hypot(G.nodes[nodes[nodes.length - 1]].x - ex, G.nodes[nodes[nodes.length - 1]].z - ez);
      for (let i = 1; i < nodes.length; i++) L += G.edgeBetween(nodes[i - 1], nodes[i])?.len ?? 56;
      return L;
    };
    let best: number[] = [], bestL = Infinity;
    for (const a of [from.edge.a, from.edge.b])
      for (const b of [to.edge.a, to.edge.b]) {
        const p = G.path(a, b, cost);
        const L = len(p, start.x, start.z, end.x, end.z);
        if (L < bestL) { bestL = L; best = p; }
      }
    return [{ x: px, z: pz }, start, ...best.map((n) => ({ x: G.nodes[n].x, z: G.nodes[n].z })), end];
  }

  private draw(P: THREE.Vector3, mission: boolean) {
    this.mat.color.set(mission ? '#ffd24a' : '#46e6ff');
    const path = this.path;
    let n = 0, walked = 0, y = P.y;
    const flow = (this.t * 5) % SPACING;
    for (let i = 1; i < path.length && n < MAX && walked < REACH; i++) {
      const a = path[i - 1], b = path[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.5) continue;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      for (let d = i === 1 ? 5 : flow; d < L && n < MAX && walked + d < REACH; d += SPACING) {
        // right-hand lane, except the first leg which starts wherever the player is
        const p = i === 1 ? { x: a.x + (b.x - a.x) * (d / L), z: a.z + (b.z - a.z) * (d / L) } : lanePoint(a.x, a.z, b.x, b.z, d / L, 1.8);
        y = surfaceHeight(p.x, p.z, y);
        this.m.compose(this.v.set(p.x, y + 0.06, p.z), this.q, this.s);
        this.mesh.setMatrixAt(n++, this.m);
      }
      walked += L;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
