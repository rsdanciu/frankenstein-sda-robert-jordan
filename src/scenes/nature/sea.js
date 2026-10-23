import * as THREE from 'three';
import { NATURE_NOISE } from './glsl.js';

/**
 * Open sea around an island: a large plane with a rolling swell, the sky reflected more
 * strongly toward the horizon, and white surf where the water meets the land, with
 * breakers surging up the shore. The coastline is read from a height texture baked from
 * the terrain, so the foam follows the real shore.
 *
 *   const sea = createSea({ heightAt, level, center, extent })
 *   sea.mesh; sea.uniforms.uTime / uSky / uHorizon / uDeep / uLight / uFoamColor
 *   const spray = createSpray(points)   bursts of spray where waves hit rocks
 *   spray.burst(i, time); spray.uniforms.uTime / uColor
 */

const SEA_VERTEX = /* glsl */ `
uniform float uTime;
uniform sampler2D uShore;
uniform vec4 uShoreRect; // x0, z0, size, depth scale
varying vec3 vWorld;
varying float vDepth;
#include <fog_pars_vertex>
float swell(vec2 p, float t) {
  return sin(dot(p, vec2(0.21, 0.13)) - t * 0.9) * 0.18
       + sin(dot(p, vec2(-0.11, 0.27)) - t * 1.3 + 1.7) * 0.11
       + sin(dot(p, vec2(0.37, -0.29)) - t * 1.9 + 4.1) * 0.05;
}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 uv = (world.xz - uShoreRect.xy) / uShoreRect.z;
  float land = texture2D(uShore, uv).r; // 0.5 = sea level
  float depth = (0.5 - land) * uShoreRect.w;
  // The swell flattens in the shallows.
  world.y += swell(world.xz, uTime) * smoothstep(0.0, 3.0, depth);
  vWorld = world.xyz;
  vDepth = depth;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SEA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uFoamColor;
uniform float uLight;
varying vec3 vWorld;
varying float vDepth;
#include <fog_pars_fragment>
${NATURE_NOISE}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  // Ripples on the swell for the normal.
  float e = 0.15;
  float h0 = fbm2(p * 0.35 + vec2(t * 0.05, t * 0.03));
  float hx = fbm2((p + vec2(e, 0.0)) * 0.35 + vec2(t * 0.05, t * 0.03));
  float hz = fbm2((p + vec2(0.0, e)) * 0.35 + vec2(t * 0.05, t * 0.03));
  vec3 N = normalize(vec3(-(hx - h0) / e * 0.6, 1.0, -(hz - h0) / e * 0.6));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.6, R.y));
  vec3 body = uDeep * (0.7 + 0.3 * h0);
  vec3 col = mix(body, sky, clamp(fres * 1.4, 0.0, 1.0));

  // Surf: a band along the shore, and breakers running in toward it.
  float d = max(vDepth, 0.0);
  float n = fbm2(p * 0.9 + vec2(t * 0.15, -t * 0.1));
  float wash = smoothstep(0.9, 0.0, d + (n - 0.5) * 0.5);
  float surge = sin(d * 5.5 - t * 1.6 + n * 3.0);
  float breakers = smoothstep(0.55, 0.95, surge) * smoothstep(3.2, 0.4, d) * smoothstep(0.35, 0.7, n + 0.2);
  float foam = clamp(wash * (0.55 + 0.45 * n) + breakers * 0.8, 0.0, 1.0);
  col = mix(col, uFoamColor, foam);

  gl_FragColor = vec4(col * uLight, 1.0);
  #include <fog_fragment>
}`;

/** Bakes heightAt over a square into a texture: 0.5 = sea level, ±depthScale/2 metres at the ends. */
function shoreTexture(heightAt, level, center, extent, depthScale, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = center.x - extent / 2 + ((i + 0.5) / size) * extent;
      const z = center.z - extent / 2 + ((j + 0.5) / size) * extent;
      const v = THREE.MathUtils.clamp(0.5 + (heightAt(x, z) - level) / depthScale, 0, 1);
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createSea({ heightAt, level = 0, center = new THREE.Vector3(), extent = 140, size = 420, depthScale = 8 }) {
  const shore = shoreTexture(heightAt, level, center, extent, depthScale);
  const uniforms = {
    uTime: { value: 0 },
    uShore: { value: shore },
    uShoreRect: { value: new THREE.Vector4(center.x - extent / 2, center.z - extent / 2, extent, depthScale) },
    uSky: { value: new THREE.Color('#58657a') },
    uHorizon: { value: new THREE.Color('#8b95a3') },
    uDeep: { value: new THREE.Color('#1b2730') },
    uFoamColor: { value: new THREE.Color('#c9d2d8') },
    uLight: { value: 1 },
  };
  const geo = new THREE.PlaneGeometry(size, size, 220, 220).rotateX(-Math.PI / 2);
  // Denser near the island: pull vertices toward the middle.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (size / 2);
    const z = pos.getZ(i) / (size / 2);
    pos.setX(i, Math.sign(x) * Math.abs(x) ** 1.8 * (size / 2) + center.x);
    pos.setZ(i, Math.sign(z) * Math.abs(z) ** 1.8 * (size / 2) + center.z);
    pos.setY(i, level);
  }
  geo.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: SEA_VERTEX,
    fragmentShader: SEA_FRAGMENT,
    fog: true,
  });
  Object.assign(material.uniforms, uniforms);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms, shore };
}

const SPRAY_VERTEX = /* glsl */ `
attribute vec3 aOrigin;
attribute float aStart;
attribute float aSeed;
uniform float uTime;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
void main() {
  float age = uTime - aStart;
  float life = 1.8;
  float k = clamp(age / life, 0.0, 1.0);
  vec3 c = aOrigin;
  vec2 dir = vec2(sin(aSeed * 31.0), cos(aSeed * 17.0));
  c.xz += dir * k * 1.2;
  c.y += 3.4 * k - 3.0 * k * k; // up and falling back
  float size = mix(0.6, 2.8, sqrt(k));
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vAlpha = (age > 0.0 && age < life) ? smoothstep(0.0, 0.08, k) * (1.0 - k) : 0.0;
  vUv = uv;
  vSeed = aSeed;
}`;

const SPRAY_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
${NATURE_NOISE}
void main() {
  if (vAlpha <= 0.001) discard;
  vec2 p = vUv - 0.5;
  float n = fbm2(vUv * 4.0 + vSeed * 7.0 + uTime * 0.3);
  float a = smoothstep(0.5, 0.05, length(p) + (n - 0.5) * 0.4) * vAlpha * 0.7;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** Spray puffs at the given points; `burst(i, time)` throws up the puffs of point i. */
export function createSpray(points, { puffs = 5 } = {}) {
  const count = points.length * puffs;
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = count;
  const origins = new Float32Array(count * 3);
  const starts = new Float32Array(count).fill(-100);
  const seeds = new Float32Array(count);
  points.forEach((p, i) => {
    for (let k = 0; k < puffs; k++) {
      const n = i * puffs + k;
      origins.set([p.x + (Math.random() - 0.5) * 0.8, p.y, p.z + (Math.random() - 0.5) * 0.8], n * 3);
      seeds[n] = Math.random();
    }
  });
  geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  const startAttr = new THREE.InstancedBufferAttribute(starts, 1);
  geo.setAttribute('aStart', startAttr);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#d6dde2') } };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: SPRAY_VERTEX, fragmentShader: SPRAY_FRAGMENT, transparent: true, depthWrite: false }),
  );
  mesh.frustumCulled = false;
  const burst = (i, time) => {
    for (let k = 0; k < puffs; k++) starts[i * puffs + k] = time + k * 0.08;
    startAttr.needsUpdate = true;
  };
  return { mesh, uniforms, burst };
}
