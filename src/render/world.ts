// Dynamic city: time of day (lighting, lamps, sky), rain (streaks, darker
// roads, less grip), rush hour (traffic density) and a street-market event.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Rng, clamp, lerp } from '../core/math';
import { GeoBuilder } from '../world/geo';
import { worldMaterials } from '../world/materials';
import { CURB_H, roadCoord } from '../world/layout';
import type { Game } from '../core/game';

const DAY_MIN = 8; // real minutes per in-game day

export class WorldTime {
  hour = 17.6;
  rain = 0; // 0..1
  private rainTarget = 0;
  private weatherT = 140;
  private drops: THREE.InstancedMesh;
  private rng = new Rng(1999);
  private m = new THREE.Matrix4();
  private base = { sun: 1.9, hemi: 1.35 };
  private sky = new THREE.Color();
  eventGroup = new THREE.Group();
  eventEdge = -1;
  frozen = false;

  constructor(private g: Game) {
    const geo = new THREE.BoxGeometry(0.02, 0.7, 0.02);
    this.drops = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#a8b8c8', transparent: true, opacity: 0.35, depthWrite: false }), 900);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    g.scene.add(this.drops);
    this.buildMarket();
  }

  reset() {
    this.hour = this.g.save.data.hour;
    this.rain = 0;
    this.rainTarget = 0;
    this.weatherT = 140;
  }

  get rushHour() {
    const h = this.hour;
    return (h > 7.5 && h < 9.5) || (h > 17 && h < 19);
  }

  get night() {
    return this.hour > 19.5 || this.hour < 6;
  }

  skipHours(n: number) {
    this.hour = (this.hour + n) % 24;
  }

  toggleRain() {
    this.rainTarget = this.rainTarget > 0.5 ? 0 : 1;
    this.g.hud.toast(this.rainTarget ? 'RAIN ROLLING IN' : 'RAIN CLEARING', 'dim');
  }

  /** street market: closes one road edge with stalls and barriers */
  private buildMarket() {
    const g = this.g;
    const G = g.city.graph;
    const e = G.edges.find((x) => x.name === 'Mill St' && G.nodes[x.a].i === 5) ?? G.edges[0];
    this.eventEdge = e.id;
    e.closed = true;
    const A = G.nodes[e.a], B = G.nodes[e.b];
    const z = A.z, xa = Math.min(A.x, B.x) + 10, xb = Math.max(A.x, B.x) - 10;
    const b = new GeoBuilder();
    const cols = ['#9b3b2f', '#c4a03c', '#3f7b88', '#4a5b39', '#d8d0bc'];
    for (let x = xa + 2; x < xb - 2; x += 5) {
      for (const side of [-1, 1]) {
        const cz = z + side * 3.6;
        b.box(x - 1.6, 0, cz - 1.0, x + 1.6, 0.95, cz + 1.0, { color: '#6b4a30', shadeSides: true });
        for (const [sx, sz] of [[-1.5, -0.9], [1.5, -0.9], [-1.5, 0.9], [1.5, 0.9]]) b.cbox(x + sx, 1.3, cz + sz, 0.08, 2.6, 0.08, { color: PAL.metal });
        b.box(x - 1.8, 2.6, cz - 1.2, x + 1.8, 2.75, cz + 1.2, { color: cols[Math.floor(Math.abs(x * 3 + side)) % cols.length] });
        for (let i = 0; i < 5; i++) b.cbox(x - 1.2 + i * 0.6, 1.08, cz, 0.4, 0.25, 0.5, { color: cols[(i + Math.abs(Math.round(x))) % cols.length] });
        g.col.add(x - 1.6, 0, cz - 1.0, x + 1.6, 1.0, cz + 1.0, false, 'stall');
      }
    }
    // barriers at both ends
    for (const x of [xa - 1, xb + 1]) {
      for (let k = -6; k <= 6; k += 2) { b.cbox(x, 0.5, z + k, 0.3, 1.0, 1.6, { color: k % 4 === 0 ? '#d8782a' : '#e6e0d4' }); }
      g.col.add(x - 0.2, 0, z - 7, x + 0.2, 1.0, z + 7, false, 'barrier');
    }
    const mesh = new THREE.Mesh(b.build(), worldMaterials().props);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.eventGroup.add(mesh);
    g.scene.add(this.eventGroup);
    // crowd chat spots inside the market
    for (let x = xa + 4; x < xb - 4; x += 6) g.street.chatSpots.push({ x, z: z + this.rng.range(-1, 1), heading: 0 });
    void CURB_H; void roadCoord;
  }

  update(dt: number) {
    const g = this.g;
    if (!this.frozen) this.hour = (this.hour + (dt / (DAY_MIN * 60)) * 24) % 24;
    const h = this.hour;
    // daylight 0..1 (sunrise ~6, sunset ~19.5)
    const day = clamp(Math.min((h - 5.5) / 2, (20 - h) / 2), 0, 1);
    const dusk = 1 - Math.abs(clamp((h - 18.5) / 2, -1, 1));
    const env = g.env;
    env.sun.intensity = lerp(0.18, this.base.sun, day) * (1 - this.rain * 0.55);
    env.sun.color.set(PAL.sun).lerp(new THREE.Color('#ff9a5a'), dusk * 0.35);
    env.hemi.intensity = lerp(0.45, this.base.hemi, day) * (1 - this.rain * 0.25);
    const fogC = new THREE.Color(PAL.haze).lerp(new THREE.Color('#1a2230'), 1 - day).lerp(new THREE.Color('#5a6068'), this.rain * 0.5);
    (g.scene.fog as THREE.Fog).color.copy(fogC);
    const view = g.quality.p.view;
    (g.scene.fog as THREE.Fog).far = lerp(view, view * 0.65, this.rain);
    (g.scene.background as THREE.Color).copy(fogC);
    const skyU = (env.sky.material as THREE.ShaderMaterial).uniforms;
    skyU.top.value.copy(this.sky.set(PAL.skyTop).lerp(new THREE.Color('#0e1420'), 1 - day));
    skyU.horizon.value.copy(fogC);
    skyU.cloud.value.set('#bdb8ae').lerp(new THREE.Color('#2a3040'), 1 - day).lerp(new THREE.Color('#6a6e74'), this.rain);
    // windows + lamps glow stronger at night
    const glow = 0.5 + (1 - day) * 0.9;
    for (const f of Object.values(worldMaterials().facades)) f.lit.emissiveIntensity = glow;
    g.city.lampPool.visible = day < 0.85;
    // weather
    this.weatherT -= dt;
    if (this.weatherT <= 0) { this.weatherT = this.rng.range(120, 260); this.rainTarget = this.rng.chance(0.35) ? 1 : 0; }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.25);
    worldMaterials().asphalt.color.setScalar(1 - this.rain * 0.35);
    for (const v of g.vehicles) v.wet = this.rain;
    this.drawRain();
  }

  private drawRain() {
    const on = this.rain > 0.05;
    this.drops.visible = on;
    if (!on) return;
    const c = this.g.camera.position;
    const n = Math.floor(900 * this.rain);
    const t = performance.now() * 0.001;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0.1));
    for (let i = 0; i < n; i++) {
      const fx = ((i * 73.13) % 40) - 20, fz = ((i * 51.71) % 40) - 20;
      const y = 14 - ((t * 22 + i * 3.17) % 16);
      this.m.compose(new THREE.Vector3(c.x + fx, c.y - 3 + y, c.z + fz), q, new THREE.Vector3(1, 1, 1));
      this.drops.setMatrixAt(i, this.m);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
  }
}
