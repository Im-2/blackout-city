import './style.css';
import * as THREE from 'three';
import { Collision } from './world/collision';
import { City } from './world/city';
import { Bank } from './world/bank';
import { Environment } from './render/environment';
import { Post } from './render/post';
import { RigCharacter } from './characters/rig';
import { PLAYER_SKIN, COP_SKIN, ROADMAN_SKIN, ROADMAN2_SKIN } from './characters/skins';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
const env = new Environment(scene);
const col = new Collision();
const city = new City(col).build();
scene.add(city.group);
const bank = new Bank(col).build();
scene.add(bank.group);
const post = new Post(renderer);
post.setSize(innerWidth, innerHeight);
const chars = [PLAYER_SKIN, COP_SKIN, ROADMAN_SKIN, ROADMAN2_SKIN].map((s, i) => {
  const c = new RigCharacter(s);
  c.root.position.set(-87 + i * 2, 0.15, 7.5);
  scene.add(c.root);
  return c;
});
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'bank';
let t = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  chars.forEach((c, i) => c.update(dt, (['idle', 'walk', 'run', 'handsup'] as const)[i], 3));
  if (view === 'bank') { camera.position.set(-70, 8, 22); camera.lookAt(-84, 4, -14); }
  else if (view === 'chars') { camera.position.set(-84, 1.4, 11); camera.lookAt(-84, 1, 7.5); }
  else { camera.position.set(Math.cos(t * 0.1) * 120, 60, Math.sin(t * 0.1) * 120); camera.lookAt(0, 0, 0); }
  env.follow(new THREE.Vector3(-84, 0, -10), t);
  post.render(scene, camera, dt, t);
  requestAnimationFrame(frame);
}
frame();
function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}
addEventListener('resize', resize);
resize();
