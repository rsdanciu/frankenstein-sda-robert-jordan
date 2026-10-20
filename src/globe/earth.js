import * as THREE from 'three';
import { feature } from 'topojson-client';
import { geoEquirectangular, geoPath } from 'd3-geo';
// Natural Earth 1:50m land outlines (public domain) shipped by the world-atlas package.
// `?url` makes Vite emit it as a separate file instead of inlining it in the JS bundle.
import landUrl from 'world-atlas/land-50m.json?url';
import {
  surfaceVertex,
  earthFragment,
  cloudFragment,
  atmosphereVertex,
  atmosphereFragment,
  starVertex,
  starFragment,
} from './shaders.js';
import { IS_COARSE_POINTER, pixelRatio } from '../core/renderer.js';

// The procedural Earth: a shaded globe, an animated cloud shell, an atmosphere glow
// and a twinkling starfield. Colours come from shaders.js; coastlines come from a land
// mask rasterised at startup.

export const GLOBE_RADIUS = 1;
const CLOUD_RADIUS = 1.012;
const ATMOSPHERE_RADIUS = 1.13;

export class Earth {
  constructor() {
    this.group = new THREE.Group();

    // Shared by the globe and the cloud shell; the Nihilism Coefficient scales the two
    // light uniforms through bindNihilismTargets (see GlobeView).
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0.5, 1).normalize() },
      uSunIntensity: { value: 1.6 },
      uAmbient: { value: 0.1 },
      uAtmoColor: { value: new THREE.Color(0.5, 0.7, 1.0) },
      uTime: { value: 0 },
    };
  }

  async build(renderer) {
    const width = IS_COARSE_POINTER ? 2048 : 4096;
    const masks = await buildLandMasks(width);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const tex = (canvas, mipmaps) => {
      const t = new THREE.CanvasTexture(canvas);
      t.generateMipmaps = mipmaps;
      t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.anisotropy = mipmaps ? maxAniso : 1;
      t.wrapS = THREE.RepeatWrapping;
      return t;
    };

    const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    const u = this.uniforms;

    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 192, 128),
      new THREE.ShaderMaterial({
        defines: { OCTAVES: 4 },
        uniforms: {
          ...fog,
          uLand: { value: tex(masks.sharp, true) },
          uLandSoft: { value: tex(masks.soft, false) },
          uLandBroad: { value: tex(masks.broad, false) },
          uSunDir: u.uSunDir,
          uSunIntensity: u.uSunIntensity,
          uAmbient: u.uAmbient,
          uAtmoColor: u.uAtmoColor,
        },
        vertexShader: surfaceVertex,
        fragmentShader: earthFragment,
        fog: true,
      }),
    );
    this.globe.userData.blocksPick = true;

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(CLOUD_RADIUS, 128, 96),
      new THREE.ShaderMaterial({
        defines: { OCTAVES: IS_COARSE_POINTER ? 3 : 4 },
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uTime: u.uTime,
          uSunDir: u.uSunDir,
          uSunIntensity: u.uSunIntensity,
          uAmbient: u.uAmbient,
          uOpacity: { value: 0.58 },
        },
        vertexShader: surfaceVertex,
        fragmentShader: cloudFragment,
        transparent: true,
        depthWrite: false,
        fog: true,
      }),
    );

    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { uAtmoColor: u.uAtmoColor, uStrength: { value: 1.1 } },
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    this.group.add(this.globe, this.clouds, this.atmosphere);
  }

  update(dt, elapsed, camera) {
    this.uniforms.uTime.value = elapsed;
    if (this.clouds) this.clouds.rotation.y += dt * 0.006;
    if (this.atmosphere) {
      // Fade the glow out as the camera dives inside it.
      const d = camera.position.length();
      this.atmosphere.material.uniforms.uStrength.value = 1.1 * THREE.MathUtils.smoothstep(d, 1.16, 1.6);
    }
  }
}

/** Rasterises the land polygons into equirectangular masks (sharp, soft, broad). */
async function buildLandMasks(width) {
  const topo = await (await fetch(landUrl)).json();
  const land = feature(topo, topo.objects.land);

  const sharp = document.createElement('canvas');
  sharp.width = width;
  sharp.height = width / 2;
  const ctx = sharp.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, sharp.width, sharp.height);

  // Equirectangular: x = (lon + 180) / 360 · W, y = (90 − lat) / 180 · H.
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, width / 4])
    .precision(0.1);
  ctx.beginPath();
  geoPath(projection, ctx)(land);
  ctx.fillStyle = '#fff';
  ctx.fill('evenodd');

  return { sharp, soft: downsample(sharp, 512), broad: downsample(sharp, 128) };
}

/** Repeated halving gives a cheap, even blur once the GPU upsamples it again. */
function downsample(src, targetWidth) {
  let cur = src;
  while (cur.width > targetWidth) {
    const next = document.createElement('canvas');
    next.width = cur.width / 2;
    next.height = cur.height / 2;
    const c = next.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

export function createStarfield(count = IS_COARSE_POINTER ? 1800 : 3500) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(90 + Math.random() * 40);
    positions.set([v.x, v.y, v.z], i * 3);
    sizes[i] = 0.6 + Math.pow(Math.random(), 4) * 2.6;
    phases[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio() } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return points;
}
