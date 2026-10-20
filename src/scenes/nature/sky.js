import * as THREE from 'three';
import { NATURE_NOISE } from './glsl.js';
import { smoothstep } from './random.js';

/**
 * A day/night sky for outdoor scenes: gradient, twilight glow, stars that wheel around
 * the pole, a full moon with a halo, the sun, and drifting clouds. Sun and moon follow
 * real hour-angle maths for a latitude and declination, so the scene passes through
 * every time of day in order.
 *
 *   const sky = new DaySky({ latitude: 48.8, declination: 8 });
 *   sky.aimMoon(time, direction)   // turn the sky so the moon sits where a composition needs it
 *   sky.update(dayTime, {...})     // per frame; returns the lighting state for the scene
 *
 * dayTime counts in days: 0.5 = noon, 0.875 = 21:00, 1.0 = the next midnight.
 * The full moon is opposite the sun. Daytime sky colours are passed in (the scene feeds
 * the Nihilism Coefficient's skyTop / skyHorizon); night and twilight colours are below.
 */

const DEG = Math.PI / 180;
const color = (hex) => new THREE.Color(hex);

export const SKY_PALETTE = {
  nightTop: color('#0a1830'),
  nightHorizon: color('#2a3e60'),
  twilightTop: color('#283a66'),
  twilightHorizon: color('#7f7a98'),
  glow: color('#ff8f52'),
  glowLate: color('#ffd2a0'),
  sunLow: color('#ff9a55'),
  sunHigh: color('#fff2dc'),
  moonlight: color('#b4c8ec'),
  sunlightLow: color('#ffb26a'),
  sunlightHigh: color('#fff3e2'),
  hemiNight: color('#7590c2'),
  hemiDay: color('#d5e3f2'),
  hemiTwilight: color('#b9a4b2'),
  groundNight: color('#1f2a1d'),
  groundDay: color('#5d5940'),
  cloudNightLit: color('#56668a'),
  cloudNightShade: color('#141c30'),
  cloudDayLit: color('#f5f3ee'),
  cloudDayShade: color('#9ba8ba'),
  cloudWarm: color('#ffb488'),
  mistNight: color('#7286a6'),
  mistDawn: color('#f2e4d0'),
  mistDay: color('#dfe6ea'),
};

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uStars;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uMoonHalo;
uniform mat3 uStarRot;
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
varying vec3 vDir;

${NATURE_NOISE}

const float MOON_R = 0.034; // angular radius (radians); larger than life so it reads clearly
const float SUN_R = 0.022;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.85, h), 0.6));

  // Warm glow along the horizon on the sun's side at dawn and dusk.
  vec2 dh = normalize(d.xz + 1e-5);
  vec2 sh = normalize(uSunDir.xz + 1e-5);
  float side = pow(max(dot(dh, sh), 0.0), 3.0);
  float low = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
  col += uGlowColor * uGlow * (side * 0.9 + 0.12) * low;

  // Stars (cell hash on the unit sphere, rotated about the celestial pole).
  if (uStars > 0.002) {
    vec3 p = (uStarRot * d) * 170.0;
    vec3 cell = floor(p);
    vec3 r = hash33(cell);
    float present = step(0.93, r.x);
    float dist = length(p - (cell + 0.2 + 0.6 * r.zxy));
    float star = present * smoothstep(mix(0.05, 0.13, r.y), 0.0, dist);
    float twinkle = 0.7 + 0.3 * sin(uTime * (1.3 + r.z * 3.0) + r.y * 40.0);
    col += vec3(0.86, 0.9, 1.0) * star * twinkle * uStars * smoothstep(0.02, 0.2, h) * (0.5 + r.z * 1.2);
  }

  // Moon: shaded disc with soft maria, plus a two-part halo.
  float mc = dot(d, uMoonDir);
  float mAng = acos(clamp(mc, -1.0, 1.0));
  vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 mu = cross(mr, uMoonDir);
  vec2 mp = vec2(dot(d, mr), dot(d, mu)) / MOON_R;
  float mrad = length(mp);
  float disc = smoothstep(1.0, 0.94, mrad) * step(0.0, mc);
  float maria = fbm2(mp * 1.7 + vec2(3.1, 1.7));
  vec3 moonCol = vec3(0.92, 0.94, 0.98) * (0.72 + 0.3 * smoothstep(0.62, 0.38, maria));
  moonCol *= 0.82 + 0.18 * sqrt(max(0.0, 1.0 - mrad * mrad));
  float halo = (exp(-mAng / 0.1) * 0.22 + exp(-mAng / 0.03) * 0.42) * (1.0 + uMoonHalo);
  vec3 haloCol = vec3(0.62, 0.72, 0.9);

  // Sun
  float sc = dot(d, uSunDir);
  float sAng = acos(clamp(sc, -1.0, 1.0));
  float sunDisc = smoothstep(SUN_R, SUN_R * 0.8, sAng);
  float sunGlow = exp(-sAng / 0.16) * 0.55 + exp(-sAng / 0.035) * 0.8;

  col = mix(col, moonCol * 1.4, disc * uMoonVis);
  col += haloCol * halo * uMoonVis * (1.0 - disc);
  col += uSunColor * (sunGlow + sunDisc * 6.0) * uSunVis;

  // Clouds on a plane above the scene, thinning near the horizon and over the moon.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.1) * 0.55 + uCloudOffset;
    float n = fbm2(uv);
    float dens = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.18, n);
    dens *= smoothstep(0.03, 0.3, h);
    dens *= 1.0 - 0.7 * smoothstep(0.16, 0.035, mAng); // clouds cross the moon without hiding it
    float detail = fbm2(uv * 3.1 + 4.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, 0.35 + 0.65 * detail);
    cloud += uSunColor * pow(max(sc, 0.0), 6.0) * 0.6 * uSunVis;
    cloud += haloCol * exp(-mAng / 0.2) * 0.5 * uMoonVis;
    col = mix(col, cloud, dens * 0.82);
    col += haloCol * halo * uMoonVis * dens * 0.35; // moonlight glowing through thin cloud
  }

  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(col, 1.0);
}`;

function bodyDirection(H, dec, lat, rotation, out) {
  // Local horizon frame: +X east, +Y up, +Z north (so south is -Z), then turned by `rotation`.
  const x = -Math.cos(dec) * Math.sin(H);
  const y = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const z = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return out.set(x * c + z * s, y, -x * s + z * c);
}

const elevationOf = (dir) => Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / DEG;

export class DaySky {
  constructor({ latitude = 48.8, declination = 8, rotation = 0, radius = 450, cloudCover = 0.42 } = {}) {
    this.lat = latitude * DEG;
    this.dec = declination * DEG;
    this.rotation = rotation * DEG;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color('#0d120c') },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: new THREE.Color() },
      uGlowColor: { value: new THREE.Color() },
      uGlow: { value: 0 },
      uStars: { value: 1 },
      uSunVis: { value: 0 },
      uMoonVis: { value: 1 },
      uMoonHalo: { value: 0 },
      uStarRot: { value: new THREE.Matrix3() },
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudCover: { value: cloudCover },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uTime: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;

    // Lighting state handed to the scene each frame.
    this.state = {
      sunElevation: 0,
      moonElevation: 0,
      day: 0, // 0 = night, 1 = full day
      keyDir: new THREE.Vector3(0, 1, 0),
      keyColor: new THREE.Color(),
      keyIntensity: 0,
      keyIsSun: false,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 1,
      fillIntensity: 0.4,
      fogColor: new THREE.Color(),
      mistColor: new THREE.Color(),
      mistOpacity: 0.25,
      top: this.uniforms.uTop.value,
      horizon: this.uniforms.uHorizon.value,
      sunColor: this.uniforms.uSunColor.value,
      sunVisible: 0,
      moonVisible: 1,
    };
    this._pole = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
  }

  /** Sun and moon directions at `dayTime` (unit vectors, world space). */
  bodiesAt(dayTime, sun = new THREE.Vector3(), moon = new THREE.Vector3()) {
    const H = ((dayTime % 1) + 1) % 1 * Math.PI * 2 - Math.PI; // hour angle: 0 at noon
    bodyDirection(H, this.dec, this.lat, this.rotation, sun);
    bodyDirection(H + Math.PI, -this.dec, this.lat, this.rotation, moon); // full moon, opposite the sun
    return { sun, moon };
  }

  /** Turns the whole sky about the vertical so the moon at `dayTime` lies in the horizontal direction `towards`. */
  aimMoon(dayTime, towards) {
    this.rotation = 0;
    const { moon } = this.bodiesAt(dayTime);
    this.rotation = Math.atan2(towards.x, towards.z) - Math.atan2(moon.x, moon.z);
  }

  update(dayTime, { dayTop, dayHorizon, time = 0, cloudOffset = null, center = null } = {}) {
    const U = this.uniforms;
    const S = this.state;
    const P = SKY_PALETTE;
    this.bodiesAt(dayTime, this.sunDir, this.moonDir);
    const e = elevationOf(this.sunDir);
    const me = elevationOf(this.moonDir);
    S.sunElevation = e;
    S.moonElevation = me;
    if (center) this.mesh.position.copy(center);

    const tw = smoothstep(-16, -4, e); // night → twilight
    const dy = smoothstep(-3, 14, e); // twilight → day
    S.day = dy;
    U.uTop.value.copy(P.nightTop).lerp(P.twilightTop, tw).lerp(dayTop, dy);
    U.uHorizon.value.copy(P.nightHorizon).lerp(P.twilightHorizon, tw).lerp(dayHorizon, dy);
    U.uGlow.value = smoothstep(-13, -2, e) * (1 - smoothstep(4, 20, e)) * 0.9;
    U.uGlowColor.value.copy(P.glow).lerp(P.glowLate, smoothstep(-2, 12, e));
    U.uStars.value = 1 - smoothstep(-15, -6, e);
    U.uSunVis.value = smoothstep(-2.5, 0.5, e);
    U.uMoonVis.value = smoothstep(-2, 1.5, me) * (1 - 0.9 * dy);
    U.uSunColor.value.copy(P.sunLow).lerp(P.sunHigh, smoothstep(0, 28, e));
    U.uCloudLit.value.copy(P.cloudNightLit).lerp(P.cloudWarm, U.uGlow.value * 0.8).lerp(P.cloudDayLit, dy);
    U.uCloudShade.value.copy(P.cloudNightShade).lerp(P.cloudDayShade, dy);
    U.uTime.value = time;
    if (cloudOffset) U.uCloudOffset.value.copy(cloudOffset);
    S.sunVisible = U.uSunVis.value;
    S.moonVisible = U.uMoonVis.value;

    // Stars turn about the celestial pole once per sidereal day.
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const pz = Math.cos(this.lat);
    this._pole.set(pz * s, Math.sin(this.lat), pz * c);
    this._m4.makeRotationAxis(this._pole, -dayTime * Math.PI * 2 * 1.0027379);
    U.uStarRot.value.setFromMatrix4(this._m4);

    // Key light: whichever of sun and moon is brighter. They cross over near dawn and
    // dusk, when both are close to the horizon and dim, so the switch is not visible.
    const sunI = 2.7 * smoothstep(-2, 6, e) * (0.5 + 0.5 * smoothstep(4, 30, e));
    const moonI = 1.6 * smoothstep(-2, 6, me) * (1 - dy);
    S.keyIsSun = sunI >= moonI;
    S.keyDir.copy(S.keyIsSun ? this.sunDir : this.moonDir);
    S.keyIntensity = Math.max(sunI, moonI);
    if (S.keyIsSun) S.keyColor.copy(P.sunlightLow).lerp(P.sunlightHigh, smoothstep(3, 32, e));
    else S.keyColor.copy(P.moonlight);

    const glow = U.uGlow.value;
    S.hemiSky.copy(P.hemiNight).lerp(P.hemiTwilight, glow).lerp(P.hemiDay, dy);
    S.hemiGround.copy(P.groundNight).lerp(P.groundDay, dy);
    S.hemiIntensity = THREE.MathUtils.lerp(1.25, 1.3, dy);
    S.fillIntensity = THREE.MathUtils.lerp(1.0, 0.25, dy);
    S.fogColor.copy(U.uHorizon.value).multiplyScalar(THREE.MathUtils.lerp(0.62, 0.9, dy));
    const dawn = smoothstep(-6, 4, e) * (1 - smoothstep(10, 30, e));
    S.mistColor.copy(P.mistNight).lerp(P.mistDawn, dawn).lerp(P.mistDay, smoothstep(14, 30, e));
    S.mistOpacity = THREE.MathUtils.lerp(0.3, 0.12, smoothstep(12, 35, e)) + dawn * 0.12;
    return S;
  }
}
