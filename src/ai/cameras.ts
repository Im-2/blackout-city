// Security cameras: sweep, spot the player (bank suspicion / police reports),
// can be blinded by hacks or killed by blackouts.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { basicMat } from '../render/patch';
import { wrapAngle } from '../core/math';
import { blockAt, BLOCKS } from '../world/layout';
import type { Game } from '../core/game';

export interface SecCam {
  id: number;
  head: THREE.Group;
  led: THREE.Mesh;
  cone: THREE.Mesh;
  pos: THREE.Vector3;
  baseYaw: number;
  yaw: number;
  pitch: number;
  sweep: number;
  range: number;
  fov: number;
  blindT: number;
  bank: boolean;
  inside: boolean;
  block: number;
  seeing: boolean;
  t: number;
}

let coneGeo: THREE.BufferGeometry | null = null;

export class SecurityCameras {
  cams: SecCam[] = [];
  group = new THREE.Group();

  constructor(private g: Game) {
    g.scene.add(this.group);
  }

  build() {
    const g = this.g;
    // bank cameras
    for (const c of g.bank.cams) this.add(c.pos, c.yaw, c.pitch, true, c.inside, c.mount === 'pole', 16, 0.5);
    // street cameras on poles at some corners (like the concept art)
    const spots: [number, number, number][] = [
      [-10, -10, -2.4], [46, 10, -0.8], [-46, 66, 2.4], [102, -46, -0.8], [10, 122, 2.4], [-122, -10, -2.4], [66, 46, -0.8], [-66, -66, 0.8], [122, 102, 2.4], [-10, -122, -2.4], [-66, 10, 0.8],
    ];
    for (const [x, z, twist] of spots) {
      // look across the intersection, twisted a little down one street
      const n = g.city.graph.nearestNode(x, z);
      const yaw = Math.atan2(n.x - x, n.z - z) + Math.sign(twist) * 0.35;
      this.add(new THREE.Vector3(x, 4.4, z), yaw, -0.35, false, false, true, 26, 0.55);
    }
  }

  private add(pos: THREE.Vector3, yaw: number, pitch: number, bank: boolean, inside: boolean, pole: boolean, range: number, fov: number) {
    const M = worldMaterials();
    if (pole) {
      const pg = new GeoBuilder();
      pg.cbox(0, pos.y / 2, 0, 0.22, pos.y, 0.22, { color: PAL.metal, shadeSides: true });
      pg.cbox(0, 0.3, 0, 0.5, 0.6, 0.5, { color: '#2e3032' });
      const pm = new THREE.Mesh(pg.build(), M.props);
      pm.position.set(pos.x, 0, pos.z);
      pm.castShadow = true;
      this.group.add(pm);
      this.g.col.addCentered(pos.x, pos.z, 0.3, 0.3, pos.y, 0, false, 'pole');
    }
    const head = new THREE.Group();
    const hg = new GeoBuilder();
    hg.cbox(0, 0, 0.15, 0.32, 0.3, 0.62, { color: '#d8d6cf', shadeSides: true });
    hg.cbox(0, 0.17, 0.12, 0.38, 0.05, 0.72, { color: '#c4c2bb' });
    hg.cbox(0, 0, 0.47, 0.22, 0.2, 0.04, { color: '#1a1a1a' });
    hg.cbox(0, -0.2, -0.05, 0.1, 0.25, 0.1, { color: '#3a3c3e' });
    const hm = new THREE.Mesh(hg.build(), M.props);
    hm.castShadow = true;
    head.add(hm);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), basicMat({ color: '#ff2a1a' }));
    led.position.set(0.09, 0.07, 0.47);
    head.add(led);
    head.position.copy(pos);
    this.group.add(head);
    if (!coneGeo) {
      // a flat fan, 1 unit long, unit half-angle scaled later
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      const seg = 12;
      for (let i = 0; i <= seg; i++) {
        const a = -1 + (2 * i) / seg;
        shape.lineTo(Math.sin(a * 0.5) * 1, Math.cos(a * 0.5) * 1);
      }
      shape.lineTo(0, 0);
      coneGeo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    }
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    cone.scale.set(range * (fov / 0.5), 1, range);
    cone.renderOrder = 2;
    this.group.add(cone);
    const b = blockAt(pos.x, pos.z);
    this.cams.push({ id: this.cams.length, head, led, cone, pos: pos.clone(), baseYaw: yaw, yaw, pitch, sweep: bank ? 0.35 : 0.6, range, fov, blindT: 0, bank, inside, block: b ? b[1] * BLOCKS + b[0] : -1, seeing: false, t: Math.random() * 10 });
  }

  reset() {
    for (const c of this.cams) { c.blindT = 0; c.seeing = false; }
  }

  isOffline(c: SecCam) {
    return c.blindT > 0 || this.g.hack.isBlackedOut(c.pos.x, c.pos.z);
  }

  blind(c: SecCam, dur = 20) {
    c.blindT = dur;
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    const py = g.player.vehicle ? P.y + 1.0 : g.player.pos.y + 1.2;
    for (const c of this.cams) {
      c.t += dt;
      if (c.blindT > 0) c.blindT -= dt;
      const off = this.isOffline(c);
      if (!off) c.yaw = c.baseYaw + Math.sin(c.t * 0.5) * c.sweep;
      c.head.rotation.set(0, c.yaw, 0);
      c.head.children[0].rotation.x = -c.pitch;
      const ledOn = !off && (c.seeing ? Math.sin(c.t * 20) > 0 : Math.sin(c.t * 3) > -0.2);
      (c.led.material as THREE.MeshBasicMaterial).color.set(off ? '#1a1a1a' : c.seeing ? '#ffffff' : '#ff2a1a');
      c.led.visible = ledOn || off;
      // ground cone
      const groundY = c.inside ? g.bank.floorY + 0.03 : 0.2;
      c.cone.position.set(c.pos.x, groundY, c.pos.z);
      c.cone.rotation.y = c.yaw;
      const showCone = !off && (c.bank || g.hack.active);
      c.cone.visible = showCone;
      const cm = c.cone.material as THREE.MeshBasicMaterial;
      cm.color.set(c.seeing ? '#ff3a2a' : g.hack.active ? '#46e6ff' : '#ff6a3a');
      cm.opacity = c.seeing ? 0.28 : 0.12;
      // spotting
      c.seeing = false;
      if (off || g.player.busted) continue;
      const dx = P.x - c.pos.x, dz = P.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > c.range || d < 0.5) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - c.yaw));
      if (ang > c.fov) continue;
      if (c.inside !== g.bank.isInside(P.x, P.z)) continue;
      if (!g.col.lineOfSight(c.pos.x + Math.sin(c.yaw) * 0.6, c.pos.y, c.pos.z + Math.cos(c.yaw) * 0.6, P.x, py, P.z)) continue;
      if (g.hack.isBlackedOut(P.x, P.z) && d > 6) continue;
      c.seeing = true;
      g.onCameraSpotted(c, dt);
    }
  }
}
