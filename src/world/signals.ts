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
  override: null | 'green' | 'red';
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

  constructor(private city: City, scene: THREE.Scene) {
    this.nodes = city.graph.nodes.map((n) => ({
      t: ((n.i + n.j) * 2.3) % (GREEN + YELLOW + ALLRED),
      green: (n.i + n.j) % 2 ? 'x' : 'z',
      stage: 0,
      override: null,
      overrideT: 0,
    }));
    const geo = new THREE.BoxGeometry(0.34, 0.34, 0.08);
    this.lamps = new THREE.InstancedMesh(geo, basicMat({ color: 0xffffff }), city.signalHeads.length);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(city.signalHeads.length * 3), 3);
    scene.add(this.lamps);
    this.refresh();
  }

  state(node: number, axis: 'x' | 'z'): Light {
    const s = this.nodes[node];
    if (s.override === 'green') return 'green';
    if (s.override === 'red') return 'red';
    if (s.stage === 2) return 'red';
    if (s.green !== axis) return 'red';
    return s.stage === 1 ? 'yellow' : 'green';
  }

  hack(node: number, mode: 'green' | 'red', duration = 12) {
    const s = this.nodes[node];
    s.override = mode;
    s.overrideT = duration;
  }

  update(dt: number) {
    this.blink += dt;
    for (const s of this.nodes) {
      if (s.override) {
        s.overrideT -= dt;
        if (s.overrideT <= 0) s.override = null;
        continue;
      }
      s.t += dt;
      if (s.stage === 0 && s.t > GREEN) { s.stage = 1; s.t = 0; }
      else if (s.stage === 1 && s.t > YELLOW) { s.stage = 2; s.t = 0; }
      else if (s.stage === 2 && s.t > ALLRED) { s.stage = 0; s.t = 0; s.green = s.green === 'x' ? 'z' : 'x'; }
    }
    this.refresh();
  }

  private refresh() {
    const heads = this.city.signalHeads;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const st = this.state(h.node, h.axis);
      const ov = this.nodes[h.node].override;
      const dy = st === 'red' ? 0.42 : st === 'yellow' ? 0 : -0.42;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h.facing);
      const fx = Math.sin(h.facing) * 0.0, fz = Math.cos(h.facing) * 0.0;
      // hacked lights strobe so the effect reads on camera
      const strobe = ov && Math.sin(this.blink * 18) > 0.3 ? 0.35 : 1;
      this.m.compose(new THREE.Vector3(h.pos.x + fx, h.pos.y + dy, h.pos.z + fz), this.q, new THREE.Vector3(1, 1, 1));
      this.lamps.setMatrixAt(i, this.m);
      this.c.set(st === 'red' ? '#ff3a2a' : st === 'yellow' ? '#ffb42a' : '#4dff7a').multiplyScalar(strobe * 1.4);
      this.lamps.setColorAt(i, this.c);
    }
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
