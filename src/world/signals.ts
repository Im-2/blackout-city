// Traffic-light state machine per intersection + instanced lit lamps.
// Hackable: force ALL GREEN (chaos) or ALL RED (gridlock) for a while.
import * as THREE from 'three';
import type { City } from './city';
import { basicMat } from '../render/patch';

export type Light = 'green' | 'yellow' | 'red';

interface NodeSignal {
  t: number;
  green: 'x' | 'z';
  stage: 0 | 1 | 2; // 0 green, 1 yellow, 2 all-red
  override: null | 'green' | 'red' | 'wave';
  waveAxis: 'x' | 'z';
  waveDir: [number, number];
  /** red that police obey too (green wave closing behind the player) */
  copStop: boolean;
  overrideT: number;
}

const GREEN = 9, YELLOW = 2, ALLRED = 1;

export class Signals {
  nodes: NodeSignal[];
  lamps: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();
  private blink = 0;
  private activeHeads: number[] = [];

  constructor(private city: City, scene: THREE.Scene) {
    this.nodes = city.graph.nodes.map((n) => ({
      t: ((n.i + n.j) * 2.3) % (GREEN + YELLOW + ALLRED),
      green: (n.i + n.j) % 2 ? 'x' : 'z',
      stage: 0,
      override: null,
      waveAxis: 'x' as 'x' | 'z',
      waveDir: [0, 0] as [number, number],
      copStop: false,
      overrideT: 0,
    }));
    const geo = new THREE.BoxGeometry(0.34, 0.34, 0.08);
    this.lamps = new THREE.InstancedMesh(geo, basicMat({ color: 0xffffff }), city.signalHeads.length);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(city.signalHeads.length * 3), 3);
    this.lamps.frustumCulled = false;
    scene.add(this.lamps);
    this.activeHeads = city.signalHeads.map((_, i) => i);
    this.refresh();
  }

  state(node: number, axis: 'x' | 'z'): Light {
    const s = this.nodes[node];
    if (s.override === 'green') return 'green';
    if (s.override === 'red') return 'red';
    if (s.override === 'wave') return axis === s.waveAxis ? 'green' : 'red';
    if (s.stage === 2) return 'red';
    if (s.green !== axis) return 'red';
    return s.stage === 1 ? 'yellow' : 'green';
  }

  /** how long this axis stays red from now: 0 if traffic may already go */
  redLeft(node: number, axis: 'x' | 'z') {
    const s = this.nodes[node];
    if (s.override === 'green') return 0;
    if (s.override === 'red') return Math.max(0, s.overrideT);
    if (s.override === 'wave') return axis === s.waveAxis ? 0 : Math.max(0, s.overrideT);
    if (s.green === axis) return s.stage === 2 ? ALLRED - s.t + GREEN + YELLOW + ALLRED : 0;
    if (s.stage === 0) return GREEN - s.t + YELLOW + ALLRED;
    if (s.stage === 1) return YELLOW - s.t + ALLRED;
    return ALLRED - s.t;
  }

  hack(node: number, mode: 'green' | 'red', duration = 12) {
    const s = this.nodes[node];
    s.override = mode;
    s.copStop = false;
    s.overrideT = duration;
  }

  /** Green for the driver's axis, red for cross traffic; flips to red behind them so pursuers stop. */
  wave(node: number, axis: 'x' | 'z', dirX: number, dirZ: number, duration = 14) {
    const s = this.nodes[node];
    s.override = 'wave';
    s.waveAxis = axis;
    s.waveDir = [dirX, dirZ];
    s.copStop = false;
    s.overrideT = duration;
  }

  /** must a police car heading along `axis` stop at this node? */
  copsHeld(node: number, axis: 'x' | 'z') {
    const s = this.nodes[node];
    return s.copStop || (s.override === 'wave' && axis !== s.waveAxis);
  }

  /** close each wave node once the player has driven past it */
  followWave(px: number, pz: number) {
    const G = this.city.graph.nodes;
    this.nodes.forEach((s, i) => {
      if (s.override !== 'wave') return;
      const dx = px - G[i].x, dz = pz - G[i].z;
      if (dx * s.waveDir[0] + dz * s.waveDir[1] > 10) { s.override = 'red'; s.copStop = true; s.overrideT = 7; }
    });
  }

  /** only write lit lamps near the player */
  stream(x: number, z: number, radius: number) {
    const heads = this.city.signalHeads;
    this.activeHeads = [];
    for (let i = 0; i < heads.length; i++) if (Math.hypot(heads[i].pos.x - x, heads[i].pos.z - z) < radius + 20) this.activeHeads.push(i);
  }

  reset() {
    for (const s of this.nodes) { s.override = null; s.copStop = false; s.overrideT = 0; }
  }

  update(dt: number) {
    this.blink += dt;
    for (const s of this.nodes) {
      if (s.override) {
        s.overrideT -= dt;
        if (s.overrideT <= 0) { s.override = null; s.copStop = false; }
        continue;
      }
      s.t += dt;
      if (s.stage === 0 && s.t > GREEN) { s.stage = 1; s.t = 0; }
      else if (s.stage === 1 && s.t > YELLOW) { s.stage = 2; s.t = 0; }
      else if (s.stage === 2 && s.t > ALLRED) { s.stage = 0; s.t = 0; s.green = s.green === 'x' ? 'z' : 'x'; }
    }
    this.refresh();
  }

  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);

  private refresh() {
    const heads = this.city.signalHeads;
    let n = 0;
    for (const i of this.activeHeads) {
      const h = heads[i];
      const st = this.state(h.node, h.axis);
      const ov = this.nodes[h.node].override;
      const dy = st === 'red' ? 0.42 : st === 'yellow' ? 0 : -0.42;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h.facing);
      // hacked lights strobe so the effect reads on camera
      const strobe = ov && Math.sin(this.blink * 18) > 0.3 ? 0.35 : 1;
      this.m.compose(this.tmpP.set(h.pos.x, h.pos.y + dy, h.pos.z), this.q, this.tmpS);
      this.lamps.setMatrixAt(n, this.m);
      this.c.set(st === 'red' ? '#ff3a2a' : st === 'yellow' ? '#ffb42a' : '#4dff7a').multiplyScalar(strobe * 1.4);
      this.lamps.setColorAt(n, this.c);
      n++;
    }
    this.lamps.count = n;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
