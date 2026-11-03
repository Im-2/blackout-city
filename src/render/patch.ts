// Shader patch applied to every world material: localized "blackout" darkness
// bubbles (power cuts / blown lamps) evaluated in world space.
import * as THREE from 'three';

export const MAX_BLACKOUTS = 8;

export const worldUniforms = {
  uBlack: { value: Array.from({ length: MAX_BLACKOUTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

const VERT_DECL = /* glsl */ `varying vec3 vBWorld;\n`;
const VERT_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  vBWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vBWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;
const FRAG_DECL = /* glsl */ `varying vec3 vBWorld;\nuniform vec4 uBlack[${MAX_BLACKOUTS}];\n`;
const FRAG_BODY = /* glsl */ `
{
  float dk = 0.0; float rim = 0.0;
  for (int i = 0; i < ${MAX_BLACKOUTS}; i++) {
    vec4 b = uBlack[i];
    if (b.w <= 0.0) continue;
    float d = length(vBWorld.xz - b.xy);
    dk = max(dk, (1.0 - smoothstep(b.z - 5.0, b.z, d)) * b.w);
    rim = max(rim, (smoothstep(b.z - 1.0, b.z - 0.3, d) - smoothstep(b.z - 0.3, b.z + 0.3, d)) * b.w);
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.11, 0.14, 0.22) + vec3(0.0, 0.004, 0.012), dk);
  gl_FragColor.rgb += vec3(0.27, 0.9, 1.0) * rim * 0.18;
}
`;

export function patchWorld<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBlack = worldUniforms.uBlack;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>\n' + FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'bw1';
  return mat;
}

/** Lambert (matte, no specular) world material with the blackout patch. */
export function worldMat(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  return patchWorld(new THREE.MeshLambertMaterial(params));
}

export function basicMat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return patchWorld(new THREE.MeshBasicMaterial(params));
}
