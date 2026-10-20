// GLSL for the procedural Earth. All colour on the globe is computed here from a
// land mask, latitude and noise; no image textures are used.

// 3D simplex noise — Ian McEwan & Stefan Gustavson (Ashima Arts / webgl-noise), MIT licence.
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    f += a * snoise(p);
    p = p * 2.03 + 0.17;
    a *= 0.5;
  }
  return f;
}
`;

export const surfaceVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosO;
#include <fog_pars_vertex>

void main() {
  vUv = uv;
  vPosO = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const earthFragment = /* glsl */ `
uniform sampler2D uLand;       // sharp land mask
uniform sampler2D uLandSoft;   // ~80 km blur: continental shelves
uniform sampler2D uLandBroad;  // ~300 km blur: inland vs coast
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uAmbient;
uniform vec3 uAtmoColor;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosO;
#include <fog_pars_fragment>

${NOISE_GLSL}

void main() {
  float land = texture2D(uLand, vUv).r;
  float soft = texture2D(uLandSoft, vUv).r;
  float broad = texture2D(uLandBroad, vUv).r;
  float latDeg = abs(vUv.y - 0.5) * 180.0;

  float n = fbm(vPosO * 2.6);
  float nd = snoise(vPosO * 22.0);

  // Ocean: deep basins → open water → shelves near coasts.
  vec3 ocean = mix(vec3(0.004, 0.016, 0.055), vec3(0.008, 0.045, 0.12), smoothstep(0.0, 0.45, broad));
  ocean = mix(ocean, vec3(0.025, 0.14, 0.22), smoothstep(0.25, 0.9, soft) * 0.75);

  // Land: temperate greens, arid belts inland at ~15–35°, tundra, then ice.
  float lat = latDeg + n * 9.0;
  vec3 col = mix(vec3(0.03, 0.075, 0.028), vec3(0.11, 0.15, 0.05), smoothstep(-0.3, 0.5, n + nd * 0.25));
  float arid = smoothstep(11.0, 19.0, lat) * (1.0 - smoothstep(31.0, 41.0, lat));
  arid *= smoothstep(0.55, 0.85, broad + n * 0.3);
  col = mix(col, vec3(0.42, 0.31, 0.16), arid);
  col = mix(col, vec3(0.19, 0.18, 0.14), smoothstep(55.0, 66.0, lat));
  col = mix(col, vec3(0.78, 0.82, 0.88), smoothstep(67.0, 75.0, lat + nd * 3.0));
  col *= 0.85 + nd * 0.15;

  float isLand = smoothstep(0.35, 0.65, land);
  float seaIce = smoothstep(77.0, 86.0, latDeg + n * 10.0) * (1.0 - isLand);
  ocean = mix(ocean, vec3(0.7, 0.75, 0.82), seaIce);
  vec3 albedo = mix(ocean, col, isLand);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, L);
  float diffuse = smoothstep(-0.1, 1.0, ndl);
  float water = (1.0 - isLand) * (1.0 - seaIce);
  float nh = max(dot(N, normalize(L + V)), 0.0);
  float spec = pow(nh, 900.0) * 0.35 * water; // small sun glint on open water

  vec3 color = albedo * (uAmbient + diffuse * uSunIntensity)
             + vec3(1.0, 0.94, 0.82) * spec * uSunIntensity;

  // Thin inner atmosphere at the limb.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color += uAtmoColor * fres * (0.25 + 0.6 * max(ndl, 0.0)) * 0.9;

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;

export const cloudFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uAmbient;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosO;
#include <fog_pars_fragment>

${NOISE_GLSL}

void main() {
  vec3 p = vPosO * 2.3;
  vec3 warp = vec3(fbm(p + vec3(0.0, uTime * 0.012, 0.0)), fbm(p + vec3(5.2, 1.3, uTime * 0.009)), 0.0);
  float n = fbm(p + warp * 0.9 + uTime * 0.003);
  float cover = smoothstep(0.1, 0.55, n);

  float ndl = dot(normalize(vNormalW), normalize(uSunDir));
  float light = uAmbient * 1.5 + smoothstep(-0.15, 1.0, ndl) * uSunIntensity * 0.9;
  gl_FragColor = vec4(vec3(0.92, 0.94, 0.97) * light, cover * uOpacity);
  #include <fog_fragment>
}
`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const atmosphereFragment = /* glsl */ `
uniform vec3 uAtmoColor;
uniform float uStrength;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  // Rendered from the inside (BackSide): strongest just outside the globe's edge,
  // fading to nothing at the atmosphere's rim.
  float rim = -dot(normalize(vNormalV), normalize(-vPosV));
  float glow = pow(clamp(rim, 0.0, 1.0), 1.6) * uStrength;
  gl_FragColor = vec4(uAtmoColor * glow, glow);
}
`;

export const starVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = 0.6 + 0.4 * sin(uTime * (0.5 + aPhase) + aPhase * 12.0);
  gl_PointSize = aSize * uPixelRatio;
}
`;

export const starFragment = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), smoothstep(0.5, 0.0, d) * vAlpha);
}
`;
