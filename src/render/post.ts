// Single full-screen post pass: colour grade, vignette, hacker vision,
// flashes and damage tint. Plus an overlay scene (hack outlines) drawn on top.
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uHack;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDamage;
uniform float uBlackoutPulse;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  // RGB split in hacker mode
  float split = uHack * 0.0025 + uBlackoutPulse * 0.004;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + c * split).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - c * split).b;
  col = linearToOutputTexel(vec4(col, 1.0)).rgb; // RT is linear; grade in display space

  // Base grade: slight desaturation, lifted blacks (art bible §5)
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), 0.12);
  col = col * 0.96 + 0.025;

  // Hacker vision
  if (uHack > 0.001) {
    vec3 h = vec3(lum) * vec3(0.55, 0.95, 1.1) + vec3(0.0, 0.03, 0.06);
    float scan = 0.88 + 0.12 * sin(gl_FragCoord.y * 1.6 + uTime * 6.0);
    float grid = step(0.985, fract(gl_FragCoord.x / 48.0)) + step(0.985, fract(gl_FragCoord.y / 48.0));
    h *= scan;
    h += vec3(0.1, 0.5, 0.6) * grid * 0.08;
    col = mix(col, h, uHack * 0.85);
  }

  // Vignette
  float v = smoothstep(0.85, 0.25, length(c * vec2(1.1, 1.0)));
  col *= mix(0.62, 1.0, v);

  // Damage: red edge
  col = mix(col, vec3(0.55, 0.05, 0.03), uDamage * (1.0 - v) * 0.8);
  // Flash (hacks, impacts, blackout)
  col = mix(col, uFlashColor, uFlash * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  mat: THREE.ShaderMaterial;
  overlay = new THREE.Scene();
  hack = 0;
  flash = 0;
  damage = 0;
  blackoutPulse = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: size },
        uTime: { value: 0 },
        uHack: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uDamage: { value: 0 },
        uBlackoutPulse: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  }

  triggerFlash(color: THREE.ColorRepresentation, amount = 1) {
    (this.mat.uniforms.uFlashColor.value as THREE.Color).set(color);
    this.flash = Math.max(this.flash, amount);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number, time: number) {
    this.flash = Math.max(0, this.flash - dt * 3);
    this.blackoutPulse = Math.max(0, this.blackoutPulse - dt * 1.5);
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uHack.value = this.hack;
    u.uFlash.value = this.flash;
    u.uDamage.value = this.damage;
    u.uBlackoutPulse.value = this.blackoutPulse;

    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    if (this.overlay.children.length) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlay, camera);
      r.autoClear = true;
    }
  }
}
