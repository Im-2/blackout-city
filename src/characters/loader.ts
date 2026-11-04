// Character factory: uses /assets/models/*.glb when present (GLTFLoader +
// AnimationMixer), otherwise falls back to the procedural RigCharacter.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimState, CharacterView, RigCharacter } from './rig';
import { Skin } from './skins';

export type ModelKind = 'player' | 'cop' | 'pedestrian1' | 'pedestrian2';
const FILES: Record<ModelKind, string> = {
  player: 'player.glb',
  cop: 'cop.glb',
  pedestrian1: 'pedestrian1.glb',
  pedestrian2: 'pedestrian2.glb',
};

const models = new Map<ModelKind, GLTF>();

/** the .glb files in assets/models, listed by vite.config.ts when the server or build starts */
declare const __GLB_MODELS__: string[];

/** Load the optional GLBs that exist. Never throws; a bad file is simply skipped. */
export async function loadCharacterModels(onProgress?: (msg: string) => void): Promise<string[]> {
  const loader = new GLTFLoader();
  const found: string[] = [];
  await Promise.all(
    (Object.keys(FILES) as ModelKind[]).map(async (k) => {
      const url = `${import.meta.env.BASE_URL}assets/models/${FILES[k]}`;
      if (!__GLB_MODELS__.includes(FILES[k])) return; // asking for a missing file is a 404 in the console
      try {
        const gltf = await loader.loadAsync(url);
        models.set(k, gltf);
        found.push(FILES[k]);
        onProgress?.(`model ${FILES[k]}`);
      } catch (e) {
        console.warn('[models] failed to load', url, e);
      }
    }),
  );
  return found;
}

const NAME_MAP: Record<string, string[]> = {
  idle: ['idle', 'stand', 'breath'],
  walk: ['walk'],
  run: ['run', 'sprint', 'jog'],
  drive: ['drive', 'sit', 'seat'],
  panic: ['panic', 'scared', 'flee', 'run'],
  handsup: ['handsup', 'hands_up', 'surrender', 'idle'],
  cuffed: ['cuff', 'arrest', 'kneel', 'idle'],
  fall: ['fall', 'death', 'die', 'knock', 'idle'],
  vault: ['jump', 'vault', 'run'],
  hack: ['phone', 'hack', 'idle'],
  carry: ['carry', 'idle'],
};

/** GLB-backed character: crossfades mapped clips. */
class GltfCharacter implements CharacterView {
  root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;

  constructor(gltf: GLTF) {
    const model = SkeletonUtils.clone(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    // normalize height to ~1.8m, feet on the ground
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    const s = 1.8 / h;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const [state, keys] of Object.entries(NAME_MAP)) {
      const clip = gltf.animations.find((c) => keys.some((k) => c.name.toLowerCase().includes(k)));
      if (clip) this.actions.set(state, this.mixer.clipAction(clip));
    }
    if (!this.actions.size && gltf.animations[0]) this.actions.set('idle', this.mixer.clipAction(gltf.animations[0]));
  }

  update(dt: number, state: AnimState, speed: number) {
    const a = this.actions.get(state) ?? this.actions.get(state === 'run' ? 'walk' : 'idle') ?? this.actions.get('idle');
    if (a && a !== this.current) {
      a.reset().fadeIn(0.2).play();
      this.current?.fadeOut(0.2);
      this.current = a;
    }
    if (a && (state === 'walk' || state === 'run')) a.timeScale = Math.max(0.6, speed / (state === 'run' ? 6 : 3));
    this.mixer.update(dt);
  }
}

export function createCharacter(kind: ModelKind, skin: Skin): CharacterView {
  const gltf = models.get(kind);
  if (gltf) return new GltfCharacter(gltf);
  return new RigCharacter(skin);
}
