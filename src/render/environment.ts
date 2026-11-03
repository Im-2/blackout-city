// Sky dome with blocky pixel clouds, sun + hemisphere light, fog.
import * as THREE from 'three';
import { PAL } from '../core/palette';

export class Environment {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  private sunOffset = new THREE.Vector3(-70, 55, 45);

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(PAL.haze);
    scene.fog = new THREE.Fog(PAL.haze, 70, 270);

    this.hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.35);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(PAL.sun, 1.9);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    const ext = 75;
    s.camera.left = -ext;
    s.camera.right = ext;
    s.camera.top = ext;
    s.camera.bottom = -ext;
    s.camera.near = 1;
    s.camera.far = 260;
    s.bias = -0.0006;
    s.normalBias = 0.04;
    s.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(PAL.skyTop) },
          horizon: { value: new THREE.Color(PAL.haze) },
          cloud: { value: new THREE.Color('#bdb8ae') },
          time: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 cloud; uniform float time;
          varying vec3 vDir;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
          void main(){
            float y = clamp(vDir.y, 0.0, 1.0);
            vec3 col = mix(horizon, top, smoothstep(0.0, 0.45, y));
            // pixel clouds: project onto a plane, quantize to blocks
            vec2 p = vDir.xz / max(vDir.y, 0.06) * 2.2 + vec2(time*0.01, 0.0);
            p = floor(p * 6.0) / 6.0;
            float c = n(p*0.7) * 0.65 + n(p*1.7) * 0.35;
            c = step(0.58, c) * 0.55 + step(0.68, c) * 0.25;
            col = mix(col, cloud, c * smoothstep(0.02, 0.25, y));
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
  }

  /** Keep the shadow frustum centred on the action. */
  follow(target: THREE.Vector3, time: number) {
    // snap to texel grid to avoid shadow swimming
    const snap = 150 / 2048;
    const x = Math.round(target.x / snap) * snap, z = Math.round(target.z / snap) * snap;
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.position.set(x, 0, z);
    this.sky.position.copy(target);
    (this.sky.material as THREE.ShaderMaterial).uniforms.time.value = time;
  }
}
