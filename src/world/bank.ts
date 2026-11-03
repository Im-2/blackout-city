// THE BANK: hand-placed hero building with enterable lobby, back office and vault.
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { GeoBuilder } from './geo';
import { Collision, AABB } from './collision';
import { worldMaterials } from './materials';
import { worldMat } from '../render/patch';
import { CURB_H } from './layout';

export interface Door {
  name: string;
  mesh: THREE.Object3D;
  col: AABB;
  locked: boolean;
  open: number; // 0..1 animated
  target: number;
  pos: THREE.Vector3;
  kind: 'slide' | 'swing' | 'double';
  closedPos: THREE.Vector3;
  extra?: THREE.Object3D;
}

export interface CamDef { pos: THREE.Vector3; yaw: number; pitch: number; inside: boolean; mount: 'pole' | 'wall'; }

// Footprint (world coords)
const X0 = -97, X1 = -71, Z0 = -40, Z1 = -14;
const FLOOR_Y = 0.95;
const TOP = 9;
const INNER_H = 6;

export class Bank {
  group = new THREE.Group();
  doors: Door[] = [];
  cams: CamDef[] = [];
  loot!: THREE.Group;
  lootPos = new THREE.Vector3(-92, FLOOR_Y + 0.9, -35.5);
  lootTaken = false;
  guardRoutes: THREE.Vector3[][] = [];
  getawaySpot = { x: -88, z: -43.2, heading: Math.PI / 2 };
  playerStart = { x: -75, z: -8.6, heading: Math.PI };
  /** interior bounds (inside walls) */
  interior = { x0: X0 + 0.6, x1: X1 - 0.6, z0: Z0 + 0.6, z1: Z1 - 0.6 };
  /** restricted zone: bank lot behind/around the building + interior */
  restricted = { x0: -101, x1: -67, z0: -46, z1: -14 };
  floorY = FLOOR_Y;
  alarmLights: THREE.Mesh[] = [];

  constructor(private col: Collision) {}

  isInside(x: number, z: number) {
    const i = this.interior;
    return x > i.x0 && x < i.x1 && z > i.z0 && z < i.z1;
  }
  isRestricted(x: number, z: number) {
    const r = this.restricted;
    return (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) || this.isInside(x, z);
  }

  build() {
    const M = worldMaterials();
    const brick = new GeoBuilder();
    const stone = new GeoBuilder();
    const props = new GeoBuilder();
    const glow = new GeoBuilder();
    const fb = M.facades.brick;
    const C = this.col;
    const wall = (x0: number, z0: number, x1: number, z1: number, y0 = 0, y1 = TOP, occ = true) => {
      brick.box(x0, y0, z0, x1, y1, z1, { tile: fb.tile, uvOffset: [0.125, 0] });
      C.add(x0, y0, z0, x1, y1, z1, occ, 'building');
    };
    const inner = (x0: number, z0: number, x1: number, z1: number, h = INNER_H) => {
      props.box(x0, FLOOR_Y, z0, x1, h, z1, { color: '#a89c86', shadeSides: true });
      C.add(x0, 0, z0, x1, h, z1, true, 'building');
    };

    // --- floor slab + stepped stone base
    stone.box(X0 - 0.6, 0, Z0 - 0.6, X1 + 0.6, FLOOR_Y, Z1 + 0.6, { tile: [4, 4], skip: { ny: true } });
    C.add(X0 - 0.6, 0, Z0 - 0.6, X1 + 0.6, FLOOR_Y, Z1 + 0.6, false, 'floor');
    stone.box(X0 - 0.9, 0, Z0 - 0.9, X1 + 0.9, 0.5, Z1 + 0.9, { tile: [4, 4], skip: { ny: true } });
    // marble checker floor
    for (let x = X0 + 0.6; x < X1 - 0.6; x += 2)
      for (let z = Z0 + 0.6; z < Z1 - 0.6; z += 2) {
        const odd = (Math.round((x - X0) / 2) + Math.round((z - Z0) / 2)) % 2;
        const inVault = x < -84 && z < -26;
        props.box(x, FLOOR_Y, z, Math.min(x + 2, X1 - 0.6), FLOOR_Y + 0.02, Math.min(z + 2, Z1 - 0.6), {
          color: inVault ? (odd ? '#6f7174' : '#7c7e80') : odd ? '#c9c1b0' : '#8f8a7e',
          skip: { ny: true },
        });
      }

    // --- shell walls
    // front (door gap x -86..-82)
    wall(X0, Z1 - 0.6, -86, Z1);
    wall(-82, Z1 - 0.6, X1, Z1);
    wall(-86, Z1 - 0.6, -82, Z1, FLOOR_Y + 4.3, TOP);
    // back (door gap x -79..-77)
    wall(X0, Z0, -79, Z0 + 0.6);
    wall(-77, Z0, X1, Z0 + 0.6);
    wall(-79, Z0, -77, Z0 + 0.6, FLOOR_Y + 2.7, TOP);
    // sides
    wall(X0, Z0, X0 + 0.6, Z1);
    wall(X1 - 0.6, Z0, X1, Z1);
    // interior plaster lining (so the inside isn't brick-with-windows)
    props.box(X0 + 0.6, FLOOR_Y, Z0 + 0.6, X0 + 0.65, INNER_H, Z1 - 0.6, { color: '#b3a58c' });
    props.box(X1 - 0.65, FLOOR_Y, Z0 + 0.6, X1 - 0.6, INNER_H, Z1 - 0.6, { color: '#b3a58c' });
    props.box(X0 + 0.6, FLOOR_Y, Z1 - 0.65, -86, INNER_H, Z1 - 0.6, { color: '#b3a58c' });
    props.box(-82, FLOOR_Y, Z1 - 0.65, X1 - 0.6, INNER_H, Z1 - 0.6, { color: '#b3a58c' });
    props.box(X0 + 0.6, FLOOR_Y, Z0 + 0.6, -79, INNER_H, Z0 + 0.65, { color: '#9c917e' });
    props.box(-77, FLOOR_Y, Z0 + 0.6, X1 - 0.6, INNER_H, Z0 + 0.65, { color: '#9c917e' });
    // interior dividers: lobby | back (z = -26), doorway x -80..-78
    inner(X0 + 0.6, -26.3, -80, -25.7);
    inner(-78, -26.3, X1 - 0.6, -25.7);
    // vault | office (x = -84), vault door gap z -34..-31
    props.box(-84.6, FLOOR_Y, Z0 + 0.6, -83.4, INNER_H, -34, { color: '#6c6e70', shadeSides: true });
    props.box(-84.6, FLOOR_Y, -31, -83.4, INNER_H, -26.3, { color: '#6c6e70', shadeSides: true });
    props.box(-84.6, FLOOR_Y + 3.2, -34, -83.4, INNER_H, -31, { color: '#6c6e70' });
    C.add(-84.6, 0, Z0 + 0.6, -83.4, INNER_H, -34, true, 'building');
    C.add(-84.6, 0, -31, -83.4, INNER_H, -26.3, true, 'building');

    // ceiling (faces down; invisible from above) + roof (faces up)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(Math.PI / 2).translate((X0 + X1) / 2, INNER_H, (Z0 + Z1) / 2), worldMat({ color: '#8c8576' }));
    this.group.add(ceil);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + 1.6, Z1 - Z0 + 1.6).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, TOP + 0.6, (Z0 + Z1) / 2), M.roof.clone());
    (roof.material as THREE.Material).shadowSide = THREE.DoubleSide;
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.group.add(roof);
    // ceiling lights
    for (const [x, z] of [[-90, -18], [-78, -18], [-90, -23], [-78, -22], [-78, -32], [-91, -33], [-74, -36]])
      glow.cbox(x, INNER_H - 0.03, z, 1.6, 0.04, 0.5, { color: '#f0d9a0' });

    // --- green cornice with dentils (concept 1 & 2)
    const g = PAL.bankGreen, gd = PAL.bankGreenDark;
    props.box(X0 - 0.9, TOP - 0.2, Z0 - 0.9, X1 + 0.9, TOP + 0.6, Z1 + 0.9, { color: g, shadeSides: true, skip: { py: true } });
    props.box(X0 - 0.5, TOP - 1.0, Z0 - 0.5, X1 + 0.5, TOP - 0.2, Z1 + 0.5, { color: gd, shadeSides: true, skip: { py: true } });
    props.box(X0 - 0.9, TOP + 0.6, Z0 - 0.9, X1 + 0.9, TOP + 1.1, Z0 - 0.5, { color: g });
    props.box(X0 - 0.9, TOP + 0.6, Z1 + 0.5, X1 + 0.9, TOP + 1.1, Z1 + 0.9, { color: g });
    props.box(X0 - 0.9, TOP + 0.6, Z0 - 0.5, X0 - 0.5, TOP + 1.1, Z1 + 0.5, { color: g });
    props.box(X1 + 0.5, TOP + 0.6, Z0 - 0.5, X1 + 0.9, TOP + 1.1, Z1 + 0.5, { color: g });
    for (let x = X0 - 0.4; x < X1 + 0.4; x += 0.9) {
      props.box(x, TOP - 1.0, Z1 + 0.5, x + 0.4, TOP - 0.55, Z1 + 0.75, { color: '#3f4f31' });
      props.box(x, TOP - 1.0, Z0 - 0.75, x + 0.4, TOP - 0.55, Z0 - 0.5, { color: '#3f4f31' });
    }
    for (let z = Z0 - 0.4; z < Z1 + 0.4; z += 0.9) {
      props.box(X0 - 0.75, TOP - 1.0, z, X0 - 0.5, TOP - 0.55, z + 0.4, { color: '#3f4f31' });
      props.box(X1 + 0.5, TOP - 1.0, z, X1 + 0.75, TOP - 0.55, z + 0.4, { color: '#3f4f31' });
    }
    // sign band above the door
    props.box(-90, FLOOR_Y + 5.0, Z1 - 0.05, -78, FLOOR_Y + 6.0, Z1 + 0.1, { color: gd });
    for (let i = 0; i < 12; i++) if (i % 3 !== 2) props.box(-89.4 + i * 0.95, FLOOR_Y + 5.25, Z1 + 0.1, -88.9 + i * 0.95, FLOOR_Y + 5.75, Z1 + 0.16, { color: '#c9b37a' });

    // --- columns (stone) across the front
    for (const x of [-95, -88.6, -79.4, -73]) {
      stone.cbox(x, FLOOR_Y + 3.6, Z1 + 0.9, 1.5, 7.2, 1.5, { tile: [2, 2] });
      stone.cbox(x, FLOOR_Y + 0.25, Z1 + 0.9, 1.9, 0.5, 1.9, { tile: [2, 2] });
      stone.cbox(x, FLOOR_Y + 7.35, Z1 + 0.9, 1.9, 0.5, 1.9, { tile: [2, 2] });
      C.addCentered(x, Z1 + 0.9, 1.6, 1.6, TOP, 0, true, 'column');
    }
    // stone pilasters at the corners
    for (const x of [X0 + 0.3, X1 - 0.3]) for (const z of [Z0 + 0.3, Z1 - 0.3]) stone.cbox(x, (FLOOR_Y + TOP) / 2, z, 1.3, TOP - FLOOR_Y, 1.3, { tile: [2, 2] });
    // tall lit windows in the front wall
    for (const x of [-92.3, -76.2]) {
      props.cbox(x, FLOOR_Y + 3.4, Z1 + 0.02, 3.2, 5.2, 0.1, { color: '#2b3530' });
      glow.cbox(x, FLOOR_Y + 3.4, Z1 + 0.08, 2.8, 4.8, 0.04, { color: '#b99a5c' });
      props.cbox(x, FLOOR_Y + 3.4, Z1 + 0.1, 0.12, 4.8, 0.06, { color: '#2b3530' });
      props.cbox(x, FLOOR_Y + 3.0, Z1 + 0.1, 2.8, 0.12, 0.06, { color: '#2b3530' });
    }

    // --- front steps
    for (let k = 0; k < 3; k++) {
      const top = CURB_H + (k + 1) * 0.27;
      const zf = Z1 + 3.4 - k * 1.0;
      stone.box(-91, 0, Z1, -77, top, zf, { tile: [2, 2], skip: { ny: true } });
      C.add(-91, 0, Z1, -77, top, zf, false, 'step');
    }
    // back stoop
    stone.box(-80.5, 0, Z0 - 2, -75.5, 0.55, Z0, { tile: [2, 2] });
    stone.box(-80.5, 0, Z0 - 1, -75.5, FLOOR_Y, Z0, { tile: [2, 2] });
    C.add(-80.5, 0, Z0 - 2, -75.5, 0.55, Z0, false, 'step');
    C.add(-80.5, 0, Z0 - 1, -75.5, FLOOR_Y, Z0, false, 'step');
    props.box(-80, 3.7, Z0 - 1.2, -76, 3.85, Z0, { color: gd }); // awning
    glow.cbox(-78, 3.6, Z0 - 0.4, 0.4, 0.1, 0.3, { color: PAL.lamp });

    // --- interior furniture
    // teller counter (vaultable) with glass partition
    props.box(-95.8, FLOOR_Y, -24.2, -86.5, FLOOR_Y + 1.15, -23.4, { color: '#5b4330', shadeSides: true });
    props.box(-95.8, FLOOR_Y + 1.15, -24.25, -86.5, FLOOR_Y + 1.25, -23.35, { color: '#3b2c20' });
    C.add(-95.8, 0, -24.2, -86.5, FLOOR_Y + 1.25, -23.4, false, 'counter');
    for (let x = -95; x < -87; x += 2.2) props.cbox(x, FLOOR_Y + 1.25 + 0.6, -23.8, 0.08, 1.2, 0.08, { color: '#c9a245' });
    // queue posts
    for (let x = -94; x < -87; x += 1.6) props.cbox(x, FLOOR_Y + 0.45, -20.5, 0.15, 0.9, 0.15, { color: '#c9a245' });
    props.box(-94, FLOOR_Y + 0.75, -20.55, -88, FLOOR_Y + 0.82, -20.45, { color: '#8a2a22' });
    // benches + plant
    props.box(-76, FLOOR_Y, -18.5, -72.5, FLOOR_Y + 0.5, -17.5, { color: '#5b4330', shadeSides: true });
    C.add(-76, 0, -18.5, -72.5, FLOOR_Y + 0.5, -17.5, false, 'prop');
    props.cbox(-72.8, FLOOR_Y + 0.4, -15.5, 0.9, 0.8, 0.9, { color: PAL.planter });
    props.cbox(-72.8, FLOOR_Y + 1.4, -15.5, 1.1, 1.2, 1.1, { color: PAL.foliage });
    C.addCentered(-72.8, -15.5, 0.9, 0.9, FLOOR_Y + 2, 0, false, 'prop');
    // office: desks + tall filing shelves (cover from guards)
    for (const [x, z] of [[-80.5, -29], [-74.5, -29], [-80.5, -36.6]]) {
      props.cbox(x, FLOOR_Y + 0.4, z, 2.4, 0.8, 1.2, { color: '#6b5038', shadeSides: true });
      props.cbox(x, FLOOR_Y + 1.05, z - 0.2, 0.7, 0.5, 0.1, { color: '#1d2228' });
      glow.cbox(x, FLOOR_Y + 1.05, z - 0.14, 0.6, 0.4, 0.02, { color: '#5aa0a8' });
      C.addCentered(x, z, 2.4, 1.2, FLOOR_Y + 0.85, 0, false, 'desk');
    }
    for (const [x, z, w, d] of [[-76.5, -33.2, 4.0, 0.9], [-72.6, -30.8, 1.2, 3.5]]) {
      props.cbox(x, FLOOR_Y + 1.2, z, w, 2.4, d, { color: '#4f5458', shadeSides: true });
      for (let y = 0.5; y < 2.4; y += 0.6) props.cbox(x, FLOOR_Y + y, z + (d > w ? 0 : d / 2 + 0.01), w * 0.9, 0.06, 0.02 + (d > w ? d * 0.9 : 0), { color: '#9b9387' });
      C.addCentered(x, z, w, d, FLOOR_Y + 2.4, 0, true, 'shelf');
    }
    // vault: deposit boxes on the walls, gold stacks
    for (let z = -39.2; z < -26.6; z += 0.6)
      for (let y = FLOOR_Y + 0.3; y < 4.0; y += 0.45) props.box(X0 + 0.65, y, z, X0 + 0.8, y + 0.4, z + 0.55, { color: (z * 7 + y * 3) % 2 > 1 ? '#8a8c8e' : '#9b9da0' });
    for (let x = -96; x < -85; x += 0.6) for (let y = FLOOR_Y + 0.3; y < 4.0; y += 0.45) props.box(x, y, Z0 + 0.65, x + 0.55, y + 0.4, Z0 + 0.8, { color: '#8e9092' });
    props.cbox(-92, FLOOR_Y + 0.45, -35.5, 2.2, 0.9, 1.2, { color: '#4a4c4e', shadeSides: true });
    C.addCentered(-92, -35.5, 2.2, 1.2, FLOOR_Y + 0.9, 0, false, 'table');
    for (let i = 0; i < 6; i++) props.cbox(-95.5 + (i % 3) * 0.5, FLOOR_Y + 0.15 + Math.floor(i / 3) * 0.2, -28 + 0.0, 0.45, 0.18, 0.25, { color: '#d9b04a' });
    for (const [x, z] of [[-94.5, -29], [-89, -29]]) {
      props.cbox(x, FLOOR_Y + 0.5, z, 1.6, 1.0, 0.8, { color: '#4a4c4e' });
      for (let i = 0; i < 4; i++) props.cbox(x - 0.5 + (i % 2) * 0.8, FLOOR_Y + 1.1 + Math.floor(i / 2) * 0.2, z, 0.6, 0.18, 0.3, { color: '#d9b04a' });
      C.addCentered(x, z, 1.6, 0.8, FLOOR_Y + 1.3, 0, false, 'table');
    }

    // --- alley: low wall + dumpster on the side
    props.cbox(-99, CURB_H + 0.75, -42, 1.6, 1.5, 2.6, { color: '#2f4a5a', shadeSides: true });
    C.addCentered(-99, -42, 1.6, 2.6, 1.6, 0, false, 'prop');

    // --- loot: gold bag + briefcase on the vault table
    this.loot = new THREE.Group();
    const lb = new GeoBuilder();
    lb.cbox(0, 0.25, 0, 0.7, 0.5, 0.55, { color: '#6b5236', shadeSides: true });
    lb.cbox(0, 0.55, 0, 0.35, 0.15, 0.3, { color: '#5a4430' });
    lb.cbox(0.1, 0.52, 0.29, 0.25, 0.12, 0.02, { color: '#d9b04a' });
    lb.cbox(-0.6, 0.18, 0.05, 0.5, 0.36, 0.12, { color: '#2a2422' });
    lb.cbox(-0.6, 0.39, 0.05, 0.18, 0.06, 0.06, { color: '#888' });
    const lootMesh = new THREE.Mesh(lb.build(), M.props);
    lootMesh.castShadow = true;
    this.loot.add(lootMesh);
    this.loot.position.copy(this.lootPos).setY(FLOOR_Y + 0.9);
    this.group.add(this.loot);

    // --- doors
    // front glass doors (double slide)
    const fd = new THREE.Group();
    const leaf = new THREE.BoxGeometry(2, 4.3, 0.15).translate(0, 2.15, 0);
    const l = new THREE.Mesh(leaf, M.bankDoor), r = new THREE.Mesh(leaf, M.bankDoor);
    l.position.x = -1;
    r.position.x = 1;
    fd.add(l, r);
    fd.position.set(-84, FLOOR_Y, Z1 - 0.3);
    this.group.add(fd);
    this.addDoor('Front doors', fd, C.add(-86, 0, Z1 - 0.6, -82, FLOOR_Y + 4.3, Z1, true, 'door'), 'double', true);
    // back door (steel, slide)
    const bdg = new GeoBuilder();
    bdg.box(-1, 0, -0.08, 1, 2.7, 0.08, { color: '#4d5457', shadeSides: true });
    bdg.box(0.6, 1.1, 0.08, 0.8, 1.3, 0.12, { color: '#b0b0a8' });
    bdg.box(-0.8, 2.2, 0.08, 0.8, 2.3, 0.1, { color: '#383d40' });
    const bd = new THREE.Mesh(bdg.build(), M.props);
    bd.position.set(-78, FLOOR_Y, Z0 + 0.3);
    bd.castShadow = true;
    this.group.add(bd);
    this.addDoor('Back door', bd, C.add(-79, 0, Z0, -77, FLOOR_Y + 2.7, Z0 + 0.6, true, 'door'), 'slide', true);
    // vault door (swing)
    const vd = new THREE.Group();
    const vdm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 3).translate(0, 1.6, 1.5), M.vaultDoor);
    vdm.castShadow = true;
    vd.add(vdm);
    vd.position.set(-84, FLOOR_Y, -34);
    this.group.add(vd);
    this.addDoor('Vault door', vd, C.add(-84.6, 0, -34, -83.4, FLOOR_Y + 3.2, -31, true, 'door'), 'swing', true);

    // --- security cameras
    this.cams.push(
      { pos: new THREE.Vector3(-70.2, 4.6, -44.6), yaw: Math.atan2(-78 + 70.2, -40 + 44.6) - 0.15, pitch: -0.35, inside: false, mount: 'pole' },
      { pos: new THREE.Vector3(X0 - 0.2, 5.0, Z0 - 0.4), yaw: Math.PI / 2 + 0.35, pitch: -0.4, inside: false, mount: 'wall' },
      { pos: new THREE.Vector3(X1 - 1.0, 5.2, Z0 + 1.0), yaw: -Math.PI * 0.68, pitch: -0.55, inside: true, mount: 'wall' },
      { pos: new THREE.Vector3(X0 + 1.0, 5.2, Z1 - 1.0), yaw: Math.PI * 0.72, pitch: -0.5, inside: true, mount: 'wall' },
    );

    // --- guard patrol routes
    const y = FLOOR_Y;
    this.guardRoutes = [
      [new THREE.Vector3(-93, y, -17.5), new THREE.Vector3(-74.5, y, -17.5), new THREE.Vector3(-74.5, y, -21.5), new THREE.Vector3(-85, y, -21.5)],
      [new THREE.Vector3(-79, y, -28), new THREE.Vector3(-73.5, y, -27.5), new THREE.Vector3(-73.5, y, -37.8), new THREE.Vector3(-82, y, -38), new THREE.Vector3(-82, y, -31.5)],
    ];

    // alarm beacons on the facade
    for (const x of [X0 + 1, X1 - 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: '#552a10' }));
      a.position.set(x, TOP - 1.6, Z1 + 0.4);
      this.group.add(a);
      this.alarmLights.push(a);
    }

    // finalize meshes
    for (const [geo, mat] of [[brick, fb.lit], [stone, M.stone], [props, M.props], [glow, M.glow]] as const) {
      const mesh = new THREE.Mesh(geo.build(), mat);
      mesh.castShadow = mat !== M.glow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return this;
  }

  private addDoor(name: string, mesh: THREE.Object3D, col: AABB, kind: Door['kind'], locked: boolean) {
    this.doors.push({ name, mesh, col, locked, open: 0, target: 0, pos: mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), kind, closedPos: mesh.position.clone() });
  }

  openDoor(d: Door) {
    d.locked = false;
    d.target = 1;
    d.col.enabled = false;
  }

  update(dt: number, time: number, alarm: boolean) {
    for (const d of this.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 3);
      if (d.kind === 'double') {
        d.mesh.children[0].position.x = -1 - d.open * 1.8;
        d.mesh.children[1].position.x = 1 + d.open * 1.8;
      } else if (d.kind === 'slide') {
        d.mesh.position.x = d.closedPos.x + d.open * 1.9;
      } else {
        d.mesh.rotation.y = -d.open * 1.9;
      }
    }
    for (const a of this.alarmLights) {
      const on = alarm && Math.sin(time * 12) > 0;
      (a.material as THREE.MeshBasicMaterial).color.set(on ? '#ff3b20' : alarm ? '#ffb000' : '#552a10');
    }
    if (!this.lootTaken) this.loot.rotation.y = Math.sin(time * 0.8) * 0.1;
  }
}
