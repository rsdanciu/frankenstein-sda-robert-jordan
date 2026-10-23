import * as THREE from 'three';
import { Rng } from './random.js';

/**
 * Light falling snow: one draw call of soft points that drift down through a box kept
 * around the camera (each flake wraps to the other side as the box moves), so the snow
 * is everywhere the camera goes without simulating a whole valley of it.
 *
 *   const snow = createSnowfall({ count, box })
 *   snow.update(time, camera, renderer)   each frame
 *   snow.uniforms.uColor / uOpacity
 */

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSize;
uniform float uPixels;
attribute float aSpeed;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.y -= uTime * aSpeed;
  p.x += uTime * 0.35 + sin(uTime * 0.6 + aPhase) * 0.35;
  p.z += cos(uTime * 0.45 + aPhase * 1.7) * 0.3;
  p = mod(p - uCenter + uBox * 0.5, uBox) + uCenter - uBox * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  gl_PointSize = max(1.0, uSize * uPixels / max(d, 0.1));
  gl_Position = projectionMatrix * mv;
  // Fade in past the lens and out toward the edge of the box, so neither shows.
  vAlpha = smoothstep(0.9, 2.6, d) * (1.0 - smoothstep(uBox.z * 0.3, uBox.z * 0.48, d));
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, r) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export function createSnowfall({ count = 2400, box = [44, 20, 44], size = 0.014, seed = 9 } = {}) {
  const rng = new Rng(seed);
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([rng.float(0, box[0]), rng.float(0, box[1]), rng.float(0, box[2])], i * 3);
    speeds[i] = rng.float(0.55, 1.1);
    phases[i] = rng.float(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(...box) },
    uSize: { value: size },
    uPixels: { value: 500 },
    uColor: { value: new THREE.Color('#ffffff') },
    uOpacity: { value: 0.8 },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  points.renderOrder = 2;
  const size2 = new THREE.Vector2();
  return {
    points,
    uniforms,
    update(time, camera, renderer) {
      uniforms.uTime.value = time;
      uniforms.uCenter.value.copy(camera.position);
      renderer.getDrawingBufferSize(size2);
      uniforms.uPixels.value = size2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); // metres → pixels at 1 m
    },
  };
}
