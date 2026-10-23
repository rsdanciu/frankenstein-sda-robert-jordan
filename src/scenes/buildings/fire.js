import * as THREE from 'three';
import { NATURE_NOISE } from '../nature/glsl.js';

/**
 * Animated fire and smoke without textures or particles on the CPU.
 *
 *   createFlames({ width, height, count })  crossed, additively blended flame cards
 *       (a hearth fire, a candle flame); returns { mesh, uniforms }; advance uniforms.uTime
 *   createSmoke({ origin, count, height })  camera-facing puffs rising and drifting from
 *       `origin` (a chimney); returns { mesh, uniforms }; advance uniforms.uTime
 */

const flameVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform vec3 uHot;
uniform vec3 uCool;
varying vec2 vUv;
${NATURE_NOISE}
void main() {
  vec2 p = vUv;
  float t = uTime * 1.0 + uSeed * 17.0;
  float n = fbm2(vec2(p.x * 3.2 + uSeed * 5.0, p.y * 2.4 - t * 2.3));
  float n2 = vnoise(vec2(p.x * 7.0 - uSeed, p.y * 5.0 - t * 3.7));
  // Wide at the base, licking up into ragged tongues.
  float x = (p.x - 0.5) + (n - 0.5) * 0.35 * p.y;
  float width = mix(0.42, 0.05, pow(p.y, 0.8));
  float body = smoothstep(width, width * 0.35, abs(x));
  float top = smoothstep(1.0, 0.25, p.y + (n2 - 0.5) * 0.45 + (n - 0.5) * 0.3);
  float base = smoothstep(0.0, 0.08, p.y);
  float f = body * top * base;
  vec3 col = mix(uCool, uHot, smoothstep(0.25, 0.9, f));
  gl_FragColor = vec4(col * f * uIntensity, 1.0);
}`;

export function createFlames({ width = 0.6, height = 0.55, count = 3, hot = '#ffd48a', cool = '#ff5a14', intensity = 2.4 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uHot: { value: new THREE.Color(hot) },
    uCool: { value: new THREE.Color(cool) },
  };
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
  for (let i = 0; i < count; i++) {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uSeed: { value: i * 0.37 + 0.11 } },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const card = new THREE.Mesh(geo, material);
    card.rotation.y = (i / count) * Math.PI;
    card.scale.setScalar(1 - i * 0.12);
    group.add(card);
  }
  return { mesh: group, uniforms };
}

const smokeVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uHeight;
uniform vec3 uOrigin;
uniform vec2 uWind;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
void main() {
  float age = fract(uTime * 0.07 + aSeed);
  vec3 c = uOrigin;
  c.y += age * uHeight;
  c.xz += uWind * age * age * uHeight * 0.8 + vec2(sin(aSeed * 40.0 + uTime * 0.3), cos(aSeed * 23.0)) * age * 0.6;
  float size = mix(0.35, 2.4, age);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age));
  vUv = uv;
  vSeed = aSeed;
}`;

const smokeFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
${NATURE_NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float n = fbm2(vUv * 3.0 + vSeed * 9.0 + vec2(0.0, -uTime * 0.05));
  float puff = smoothstep(0.5, 0.1, length(p) + (n - 0.5) * 0.35);
  float a = puff * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export function createSmoke({ origin, count = 16, height = 7 } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uHeight: { value: height },
    uOrigin: { value: origin.clone() },
    uWind: { value: new THREE.Vector2(0.35, -0.1) },
    uColor: { value: new THREE.Color('#6d7486') },
    uOpacity: { value: 0.32 },
  };
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = count;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(count).map((_, i) => i / count), 1));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: smokeVertex, fragmentShader: smokeFragment, transparent: true, depthWrite: false }),
  );
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
