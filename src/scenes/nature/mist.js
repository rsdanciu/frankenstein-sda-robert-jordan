import * as THREE from 'three';
import { NATURE_NOISE } from './glsl.js';

/**
 * Low drifting mist: soft, noisy sheets that always turn to face the camera (about the
 * vertical axis only), placed between the tree layers. One instanced draw call.
 *
 *   const mist = createMist(sheets)   // [{ x, y, z, width, height }]
 *   mist.uniforms.uColor / uOpacity / uTime
 */

const vertexShader = /* glsl */ `
attribute vec3 iOffset;
attribute vec2 iSize;
attribute float iSeed;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = iSeed;
  vec3 toCam = cameraPosition - iOffset;
  toCam.y = 0.0;
  toCam = normalize(toCam + vec3(1e-5, 0.0, 0.0));
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  vec3 world = iOffset + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_fragment>
${NATURE_NOISE}
void main() {
  float edge = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x) * smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  float n = fbm2(vec2(vUv.x * 3.2 + uTime * 0.025 + vSeed * 7.0, vUv.y * 1.4 + vSeed * 3.0 - uTime * 0.01));
  float a = edge * smoothstep(0.3, 0.78, n) * uOpacity;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;

export function createMist(sheets) {
  const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  const offsets = new Float32Array(sheets.length * 3);
  const sizes = new Float32Array(sheets.length * 2);
  const seeds = new Float32Array(sheets.length);
  sheets.forEach((s, i) => {
    offsets.set([s.x, s.y, s.z], i * 3);
    sizes.set([s.width, s.height], i * 2);
    seeds[i] = i * 0.618 + 0.3;
  });
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 2));
  geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.instanceCount = sheets.length;

  const uniforms = {
    uColor: { value: new THREE.Color('#8090a8') },
    uOpacity: { value: 0.25 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  Object.assign(material.uniforms, uniforms);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}
