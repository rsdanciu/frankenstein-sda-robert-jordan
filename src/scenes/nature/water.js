import * as THREE from 'three';
import { NATURE_NOISE } from './glsl.js';

/**
 * A narrow stream: a centre line through (x, z) points, a width along its length, fast
 * nearest-point queries (to carve the ground and keep trees and grass out of the water)
 * and a water ribbon with slow flowing ripples, ripple rings, and reflections of the sky,
 * the forest edge, the sun and the moon.
 */

const vertexShader = /* glsl */ `
attribute vec2 aFlow;
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vFlow;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFlow = aFlow;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uForest;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform float uMoonVis;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uLight;
uniform float uHighlight;
uniform vec4 uRipples[6]; // x, z, start time, strength
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vFlow;
#include <fog_pars_fragment>

${NATURE_NOISE}

float flowNoise(vec2 p) {
  vec2 drift = vFlow * uTime;
  return vnoise(p * 1.9 - drift * 0.9) * 0.6 + vnoise(p * 4.3 - drift * 1.6 + 7.0) * 0.3 + vnoise(p * 9.0 - drift * 2.4 + 3.0) * 0.1;
}

void main() {
  vec2 p = vWorld.xz;
  float e = 0.06;
  float h0 = flowNoise(p);
  vec2 grad = vec2(flowNoise(p + vec2(e, 0.0)) - h0, flowNoise(p + vec2(0.0, e)) - h0) / e;
  grad *= 0.05;

  // Slow ripple rings
  for (int i = 0; i < 6; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 5.0) continue;
    vec2 dv = p - r.xy;
    float d = length(dv);
    float radius = age * 0.28;
    float ring = sin((d - radius) * 34.0) * exp(-pow((d - radius) * 9.0, 2.0)) * exp(-age * 0.7) * r.w;
    grad += (dv / max(d, 1e-3)) * ring * 0.35;
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  // Reflected sky, with the dark forest edge at low angles.
  vec3 refl = mix(uHorizon, uTop, smoothstep(0.0, 0.7, R.y)) * 0.78;
  refl = mix(refl, uForest, 1.0 - smoothstep(0.03, 0.22, R.y));
  refl *= 0.85 + 0.3 * vnoise(p * 3.0 - vFlow * uTime); // broken up by the moving surface

  // Sun and moon: a sharp reflection plus a glittering path toward each, as on real water.
  vec2 toFrag = normalize(vWorld.xz - cameraPosition.xz);
  float glint = vnoise(p * 7.0 - vFlow * uTime * 2.2) * vnoise(p * 13.0 + vFlow * uTime * 1.3 + 5.0);
  float sparkle = smoothstep(0.32, 0.62, glint);
  // The path narrows with distance, like a real moon path on water.
  float far = smoothstep(4.0, 60.0, length(vWorld.xz - cameraPosition.xz));
  float moonPath = smoothstep(mix(0.993, 0.9994, far), 1.0, dot(toFrag, normalize(uMoonDir.xz + 1e-5))) * step(0.0, uMoonDir.y);
  float sunPath = smoothstep(mix(0.985, 0.998, far), 1.0, dot(toFrag, normalize(uSunDir.xz + 1e-5))) * step(0.0, uSunDir.y);
  // A wider, fainter scatter of glints on the ripples toward each body.
  float moonSheen = pow(max(dot(toFrag, normalize(uMoonDir.xz + 1e-5)), 0.0), 6.0) * step(0.0, uMoonDir.y);
  float sunSheen = pow(max(dot(toFrag, normalize(uSunDir.xz + 1e-5)), 0.0), 6.0) * step(0.0, uSunDir.y);
  vec3 moonRefl = vec3(0.85, 0.9, 1.0) * (pow(max(dot(R, uMoonDir), 0.0), 900.0) * 4.0 + (moonPath * 0.55 + moonSheen * 0.14) * sparkle) * uMoonVis;
  vec3 sunRefl = uSunColor * (pow(max(dot(R, uSunDir), 0.0), 600.0) * 6.0 + (sunPath * 0.9 + sunSheen * 0.25) * sparkle) * uSunVis;

  vec3 body = mix(uShallow, uDeep, 0.55 + 0.45 * sin(vUv.y * 3.14159)) * uLight;
  vec3 col = mix(body, refl, fres) + moonRefl + sunRefl;
  col *= 1.0 + uHighlight * 0.5;

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export class Stream {
  /**
   * @param points  [[x, z], …] from the near end to the far end
   * @param widthAt (s, length) → width in metres at distance s along the stream
   * @param level   water surface height
   */
  constructor(points, { widthAt = () => 1.2, level = -0.14, spacing = 0.5 } = {}) {
    this.level = level;
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    this.length = curve.getLength();
    const n = Math.max(8, Math.ceil(this.length / spacing));
    this.samples = [];
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      const s = u * this.length;
      this.samples.push({ x: p.x, z: p.z, s, tx: t.x, tz: t.z, w: widthAt(s, this.length) });
    }
    this.maxWidth = Math.max(...this.samples.map((q) => q.w));
    this.#buildGrid();
  }

  #buildGrid() {
    this.cell = 4;
    this.grid = new Map();
    const reach = this.maxWidth + 14;
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / this.cell);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / this.cell);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach) / this.cell);
      const z1 = Math.floor((Math.max(a.z, b.z) + reach) / this.cell);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const key = gx * 100003 + gz;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(i);
        }
      }
    }
  }

  /** Nearest point on the centre line within ~14 m: { d, s, w, x, z } or null when farther. */
  nearest(x, z) {
    const list = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, s: a.s + (b.s - a.s) * t, w: a.w + (b.w - a.w) * t, x: px, z: pz };
    }
    return best;
  }

  /** Point and unit tangent at distance s along the stream. */
  at(s) {
    const i = Math.max(0, Math.min(this.samples.length - 2, Math.floor((s / this.length) * (this.samples.length - 1))));
    const a = this.samples[i];
    const b = this.samples[i + 1];
    const t = THREE.MathUtils.clamp((s - a.s) / (b.s - a.s || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz, w: a.w + (b.w - a.w) * t };
  }

  /** The water ribbon. It extends a little under each bank so the shoreline is where the ground meets it. */
  createWater({ overlap = 0.35, heightAt = () => 0, flowSpeed = 0.35 } = {}) {
    const positions = [];
    const uvs = [];
    const flows = [];
    const indices = [];
    this.samples.forEach((q, i) => {
      const nx = -q.tz;
      const nz = q.tx;
      const half = q.w / 2 + overlap;
      const y = heightAt(q.x, q.z) + this.level;
      for (const side of [-1, 1]) {
        positions.push(q.x + nx * half * side, y, q.z + nz * half * side);
        uvs.push(q.s, side < 0 ? 0 : 1);
        flows.push(q.tx * flowSpeed, q.tz * flowSpeed);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    this.uniforms = {
      uTime: { value: 0 },
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uForest: { value: new THREE.Color('#0d140f') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunVis: { value: 0 },
      uMoonVis: { value: 0 },
      uDeep: { value: new THREE.Color('#1c2a26') },
      uShallow: { value: new THREE.Color('#3e4a3a') },
      uLight: { value: 1 },
      uHighlight: { value: 0 },
      uRipples: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0)) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader,
      fragmentShader,
      fog: true,
    });
    Object.assign(material.uniforms, this.uniforms);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = false;
    return this.mesh;
  }
}
