// Bank guards: patrol routes, visible vision cones, suspicion -> alarm,
// chase + bust inside the bank.
import * as THREE from 'three';
import { damp, dampAngle, wrapAngle } from '../core/math';
import { createCharacter } from '../characters/loader';
import { GUARD_SKIN } from '../characters/skins';
import type { CharacterView, AnimState } from '../characters/rig';
import type { Game } from '../core/game';

const FOV = 0.68; // half-angle
const RANGE = 11;

interface Guard {
  view: CharacterView;
  pos: THREE.Vector3;
  heading: number;
  route: THREE.Vector3[];
  wp: number;
  waitT: number;
  cone: THREE.Mesh;
  sees: boolean;
  alert: boolean;
  goal: THREE.Vector3 | null;
  lookT: number;
  state: AnimState;
  stunT: number;
}

export class Guards {
  guards: Guard[] = [];
  private coneGeo: THREE.BufferGeometry;

  constructor(private g: Game) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (let i = 0; i <= 14; i++) {
      const a = -FOV + (2 * FOV * i) / 14;
      shape.lineTo(Math.sin(a) * RANGE, Math.cos(a) * RANGE);
    }
    shape.lineTo(0, 0);
    this.coneGeo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
  }

  reset() {
    for (const gd of this.guards) { this.g.scene.remove(gd.view.root, gd.cone); }
    this.guards = [];
    for (const route of this.g.bank.guardRoutes) {
      const view = createCharacter('cop', GUARD_SKIN);
      this.g.scene.add(view.root);
      const cone = new THREE.Mesh(this.coneGeo, new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      cone.renderOrder = 2;
      this.g.scene.add(cone);
      this.guards.push({ view, pos: route[0].clone(), heading: 0, route, wp: 1, waitT: 0, cone, sees: false, alert: false, goal: null, lookT: 0, state: 'idle', stunT: 0 });
    }
  }

  /** a guard is close enough to grab the player */
  pressing() {
    const P = this.g.player.pos;
    return this.guards.some((gd) => gd.alert && gd.stunT <= 0 && gd.pos.distanceTo(P) < 1.7);
  }

  alertAll(pos: THREE.Vector3) {
    for (const gd of this.guards) { gd.alert = true; gd.goal = pos.clone(); }
  }

  /** distraction: guards investigate a point (if not already chasing) */
  lure(pos: THREE.Vector3) {
    for (const gd of this.guards) if (!gd.sees && gd.pos.distanceTo(pos) < 30) { gd.goal = pos.clone(); gd.lookT = 4; }
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player.worldPos;
    const pIn = g.bank.isInside(P.x, P.z) || g.bank.isRestricted(P.x, P.z);
    for (const gd of this.guards) {
      // perception
      gd.sees = false;
      if (!g.player.busted && !g.player.vehicle) {
        const dx = P.x - gd.pos.x, dz = P.z - gd.pos.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - gd.heading));
        const range = g.hack.isBlackedOut(gd.pos.x, gd.pos.z) ? RANGE * 0.45 : RANGE;
        if (d < range && (ang < FOV || d < 1.4 || (gd.alert && d < range * 1.3)) && pIn) {
          if (g.col.lineOfSight(gd.pos.x, gd.pos.y + 1.6, gd.pos.z, P.x, g.player.pos.y + 1.2, P.z)) gd.sees = true;
        }
      }
      if (gd.sees) {
        g.onGuardSpotted(dt);
        if (g.heist.alarm) { gd.alert = true; gd.goal = P.clone(); }
      }

      // movement
      let tx = gd.pos.x, tz = gd.pos.z, speed = 0;
      if (gd.stunT > 0) gd.stunT -= dt;
      else if (gd.alert && gd.goal) {
        tx = gd.goal.x; tz = gd.goal.z;
        speed = gd.sees ? 5.6 : 3.4;
        if (Math.hypot(tx - gd.pos.x, tz - gd.pos.z) < 1.2) { if (!gd.sees) gd.goal = null; speed = 0; }
      } else if (gd.goal) {
        tx = gd.goal.x; tz = gd.goal.z; speed = 2.6;
        if (Math.hypot(tx - gd.pos.x, tz - gd.pos.z) < 1.2) { speed = 0; gd.lookT -= dt; if (gd.lookT <= 0) gd.goal = null; }
      } else if (!gd.alert) {
        const w = gd.route[gd.wp];
        if (gd.waitT > 0) {
          gd.waitT -= dt;
          gd.heading += Math.sin(gd.waitT * 2) * dt * 0.8; // look around
        } else {
          tx = w.x; tz = w.z; speed = 1.6;
          if (Math.hypot(tx - gd.pos.x, tz - gd.pos.z) < 0.4) { gd.wp = (gd.wp + 1) % gd.route.length; gd.waitT = 1.6; }
        }
      }
      const dx = tx - gd.pos.x, dz = tz - gd.pos.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.3 && speed > 0) {
        gd.pos.x += (dx / dl) * speed * dt;
        gd.pos.z += (dz / dl) * speed * dt;
        gd.heading = dampAngle(gd.heading, Math.atan2(dx, dz), 7, dt);
      } else speed = 0;
      g.col.resolveCircle(gd.pos, 0.34, gd.pos.y, 0.45, gd.pos.y + 1.7);
      gd.pos.y = Math.max(g.col.groundUnder(gd.pos.x, gd.pos.z, 0.3, gd.pos.y + 0.46), 0.15);
      gd.state = gd.stunT > 0 ? 'handsup' : speed > 4 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
      gd.view.update(dt, gd.state, speed);
      gd.view.root.position.copy(gd.pos);
      gd.view.root.rotation.y = gd.heading;
      // cone
      gd.cone.position.set(gd.pos.x, gd.pos.y + 0.04, gd.pos.z);
      gd.cone.rotation.y = gd.heading;
      const m = gd.cone.material as THREE.MeshBasicMaterial;
      const sus = g.heist.suspicion;
      m.color.set(gd.sees ? '#ff3a2a' : gd.alert ? '#ff8a2a' : '#ffd24a');
      m.opacity = gd.sees ? 0.3 : 0.14 + sus * 0.1;
      gd.cone.visible = gd.stunT <= 0;
      void damp;
    }
  }
}
