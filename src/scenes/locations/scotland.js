import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { tween, wait, Ease } from '../../core/tween.js';
import { visualParams, visualScalarsAt } from '../../nihilism/nihilism.js';
import { Person, FRANKENSTEIN_STYLE } from '../../people/Person.js';
import { DaySky } from '../nature/sky.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { WIND, applyWind } from '../nature/wind.js';
import { grassTexture, groundTextures } from '../nature/textures.js';
import { createGround, grassTuftGeometry, rockGeometry, scatter } from '../nature/ground.js';
import { createMist } from '../nature/mist.js';
import { createSea, createSpray } from '../nature/sea.js';
import { wallGeometry, box, placed, merge } from '../buildings/parts.js';
import { metric, plasterTextures, thatchTextures, boardTextures, stoneTextures, glowTexture } from '../buildings/textures.js';
import { createFlames, createSmoke } from '../buildings/fire.js';
import { INTERIOR, applyInteriorLight } from '../grading.js';

/**
 * Scotland — scene 4 (data: public/json/scenes/scotland.json).
 *
 * Built to the students' brief: a small, isolated stone cottage on a rocky island, sparse
 * vegetation, the sea all round, low cloud, and waves striking the shore behind the
 * cottage. Through the front window the user sees Victor at his workbench with the
 * unfinished female figure (pale and partly covered by a sheet). A little warm lamplight
 * lies around the bench. The Monster stands outside at the gable window and watches; the
 * camera sees both his face and the bench.
 *
 * SEQUENCE ─ both components are required, in order:
 *   on arrival  Victor works; after a few seconds he stops, then sweeps the figure from the
 *               bench (short and non-graphic: pale pieces tumble, the sheet falls). The
 *               warmth fades. The Monster recoils in distress, then stands rigid with
 *               clenched fists and leans in, confrontational. No coefficient change here:
 *               the destruction and the first component are one event (the brief).
 *   1 remains   the scattered pieces become clickable after the destruction
 *   2 hand      his clenched fist; he raises it before the menu opens. Afterwards (purpose
 *               partly restored) he straightens, turns from the window and strides to the
 *               shore, where he stands upright facing the sea.
 *
 * LIGHT ─ dusk under heavy low cloud, cold and grey. The lamp's warm light is held against
 * the grade pass while it lasts (grading.js applyInteriorLight); when the work is
 * destroyed the lamp fades and the room turns cold.
 */

const IDS = { remains: 'scotland-remains', hand: 'scotland-hand' };

const SKY = { latitude: 59, declination: 10, sunElevation: -4, glowToward: [-0.75, -0.66], cloudCover: 0.8 };

const SEA_LEVEL = -1.4;

/** The cottage stands on level ground at y = 0, its front facing +Z (the camera). */
const COTTAGE = {
  x0: -2.6,
  x1: 2.6,
  z0: -5.0,
  z1: -1.0,
  wall: 0.5,
  eaves: 2.2,
  rise: 1.8,
  thatch: 0.42,
  overhang: 0.35,
  verge: 0.25,
  floor: 0.04,
  window: { x0: 0.0, x1: 1.3, y0: 0.85, y1: 1.8 }, // front wall: the user's view of the bench
  side: { z0: -2.4, z1: -1.7, y0: 1.0, y1: 1.75 }, // west gable: the Monster's window
  door: { x0: -2.05, x1: -1.25, y1: 1.8 },
};

const LAYOUT = {
  island: { x: 0, z: -2, rx: 22, back: 10.5, front: 30 },
  bench: { x: 0.65, z: -2.6, w: 1.6, d: 0.72, h: 0.88 },
  victor: { x: 0.65, z: -3.42 },
  lamp: { x: 1.28, z: -2.82 },
};

const SPOTS = {
  watch: { x: -3.5, z: -2.05, yaw: Math.PI / 2 }, // at the gable window, looking in
  resolve: { x: -7.0, z: -9.2, yaw: Math.PI * 1.18 }, // on the rocks above the shore, facing the sea
};

const VIEWS = {
  home: { position: [-0.9, 2.3, 6.3], target: [-0.8, 1.1, -2.0], fov: 50, needs: 32 },
  bench: { position: [0.75, 1.6, 1.3], target: [0.6, 0.95, -2.9], fov: 44, needs: 20 },
  hand: { position: [-2.0, 1.75, 1.75], target: [-3.35, 1.5, -2.0], fov: 46, needs: 18 },
  end: { position: [-3.6, 2.4, 3.2], target: [-6.6, 0.9, -8.6], fov: 50, needs: 26 },
};
const VIEW_FOR = { [IDS.remains]: 'bench', [IDS.hand]: 'hand' };

/** The Monster's held poses (conventions in Monster.js POSES). */
const POSE = {
  watch: {
    hipsY: 1.0,
    joints: {
      legL: [-0.35, 0, 0.06], kneeL: [0.55, 0, 0], legR: [-0.2, 0, -0.06], kneeR: [0.4, 0, 0],
      spine: [0.34, 0, 0], chest: [0.2, 0, 0],
      shoulderL: [-0.3, 0, 0.15], elbowL: [-0.7, 0, 0], shoulderR: [-0.12, 0, -0.15], elbowR: [-0.4, 0, 0],
    },
  },
  distress: {
    hipsY: 1.06,
    joints: {
      legL: [0.18, 0, 0.08], kneeL: [0.3, 0, 0], legR: [-0.25, 0, -0.08], kneeR: [0.22, 0, 0],
      spine: [-0.16, 0, 0], chest: [-0.1, 0, 0],
      shoulderL: [-2.3, 0, 0.5], elbowL: [-2.0, 0, 0], shoulderR: [-2.3, 0, -0.5], elbowR: [-2.0, 0, 0],
    },
  },
  rigid: {
    hipsY: 1.17,
    joints: {
      legL: [0, 0, 0.09], legR: [0, 0, -0.09],
      spine: [-0.05, 0, 0], chest: [-0.08, 0, 0],
      shoulderL: [0.05, 0, 0.26], elbowL: [-0.08, 0, 0], shoulderR: [0.05, 0, -0.26], elbowR: [-0.08, 0, 0],
    },
  },
  confront: {
    hipsY: 1.1,
    joints: {
      legL: [-0.32, 0, 0.1], kneeL: [0.36, 0, 0], legR: [0.22, 0, -0.1], kneeR: [0.1, 0, 0],
      spine: [0.34, 0, 0], chest: [0.2, 0, 0],
      shoulderL: [0.32, 0, 0.3], elbowL: [-0.35, 0, 0], shoulderR: [0.32, 0, -0.3], elbowR: [-0.35, 0, 0],
    },
  },
  fist: {
    hipsY: 1.12,
    joints: {
      legL: [-0.25, 0, 0.1], kneeL: [0.3, 0, 0], legR: [0.18, 0, -0.1], kneeR: [0.1, 0, 0],
      spine: [0.18, 0, 0], chest: [0.08, 0, 0],
      shoulderL: [0.25, 0, 0.3], elbowL: [-0.3, 0, 0], shoulderR: [-0.8, 0.25, -0.32], elbowR: [-1.85, 0, 0],
    },
  },
  upright: {
    hipsY: 1.17,
    joints: { spine: [-0.06, 0, 0], chest: [-0.1, 0, 0], shoulderL: [0.02, 0, 0.16], elbowL: [-0.15, 0, 0], shoulderR: [0.02, 0, -0.16], elbowR: [-0.15, 0, 0] },
  },
};

/** Victor's poses (Person.setPose). */
const VICTOR = {
  work: { joints: { spine: [0.36, 0, 0], chest: [0.22, 0, 0], shoulderL: [-0.8, 0, 0.14], elbowL: [-0.85, 0, 0], shoulderR: [-0.8, 0, -0.14], elbowR: [-0.85, 0, 0] } },
  still: { joints: { spine: [0.05, 0, 0], chest: [0.02, 0, 0], shoulderL: [-0.3, 0, 0.12], elbowL: [-0.6, 0, 0], shoulderR: [-0.3, 0, -0.12], elbowR: [-0.6, 0, 0] } },
  raise: { joints: { spine: [-0.14, 0, 0], chest: [-0.1, 0, 0], shoulderL: [-2.6, 0, 0.35], elbowL: [-0.5, 0, 0], shoulderR: [-2.6, 0, -0.35], elbowR: [-0.5, 0, 0] } },
  sweep: { joints: { spine: [0.5, 0.25, 0], chest: [0.25, 0.2, 0], shoulderL: [-0.95, 0, 0.9], elbowL: [-0.25, 0, 0], shoulderR: [-0.7, 0, -0.1], elbowR: [-0.3, 0, 0] } },
  spent: { joints: { spine: [0.24, 0, 0], chest: [0.16, 0, 0], shoulderL: [0.05, 0, 0.12], elbowL: [-0.18, 0, 0], shoulderR: [0.05, 0, -0.12], elbowR: [-0.18, 0, 0] } },
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const LIGHT = { key: 1.4, hemi: 2.6, fill: 1.6 };
const WARM = { lamp: 4.2, cold: 2.4, spill: 3.5 };
const AMBIENT_WARM = new THREE.Color('#3a2414');
const AMBIENT_COLD = new THREE.Color('#1e2736');
const _w = new THREE.Vector3();

export default class ScotlandScene extends BaseScene {
  static cameraHome = { position: VIEWS.home.position, target: VIEWS.home.target };

  constructor(args) {
    super(args);
    this.useViews(VIEWS);
    this.phase = 'watching'; // watching → destroying → destroyed → resolved
    this.watchTime = 0;
    this.warmth = 1; // 1 = the lamp's warmth, 0 = cold
    this.pieces = [];
    this.disposables = [];
    this.rng = new Rng(4040);
    this.sequence = Promise.resolve();
    this.cloudOffset = new THREE.Vector2(2.2, 1.4);
    this.frame = 0;
    this.nextSpray = 2;
    // While it lasts, the lamplight keeps the colour it would have before any collapse.
    this.warmSaturation = visualScalarsAt(0).saturation;
    this.tracker.setEnabled(IDS.remains, false); // until the work is destroyed
  }

  entryPosition(home) {
    return home.clone().add(new THREE.Vector3(0, 30, 0.5));
  }

  exitPosition(from) {
    return from.clone().add(new THREE.Vector3(0, 32, 0));
  }

  // ─── Terrain ────────────────────────────────────────────────────────────────

  /** Elliptical distance from the island's middle (1 = the shore), ragged. */
  #islandDist(x, z) {
    const I = LAYOUT.island;
    const dz = (z - I.z) / (z < I.z ? I.back : I.front);
    return Math.hypot((x - I.x) / I.rx, dz) * (0.88 + 0.24 * fbm2(x * 0.07, z * 0.07, 3, 5));
  }

  #fromCottage(x, z) {
    const C = COTTAGE;
    return Math.hypot(Math.max(C.x0 - x, 0, x - C.x1), Math.max(C.z0 - z, 0, z - C.z1));
  }

  heightAt = (x, z) => {
    const near = this.#fromCottage(x, z);
    let h = (fbm2(x * 0.13 + 7, z * 0.13, 3, 9) - 0.5) * 0.7 * smoothstep(0.8, 4, near);
    h += (fbm2(x * 0.035, z * 0.035, 2, 3) - 0.45) * 2.2 * smoothstep(4, 16, near);
    for (const v of Object.values(this.views)) h *= smoothstep(0.4, 2.5, Math.hypot(x - v.position.x, z - v.position.z)) * 0.6 + 0.4;
    const e = this.#islandDist(x, z);
    const rough = (fbm2(x * 0.5, z * 0.5, 3, 21) - 0.5) * 0.9;
    // The seabed shelves away steeply beyond the shore, so surf only forms along the coast.
    const seabed = SEA_LEVEL - 1.6 - 6 * smoothstep(1.0, 1.45, e) + rough;
    h = THREE.MathUtils.lerp(h, seabed, smoothstep(0.86, 1.06, e)) + rough * smoothstep(0.7, 0.95, e) * 0.6;
    return h;
  };

  #grassAt = (x, z) => smoothstep(0.92, 0.78, this.#islandDist(x, z)) * smoothstep(0.3, 1.5, this.#fromCottage(x, z)) * 0.8;

  #tintAt = (x, z, c) => {
    const e = this.#islandDist(x, z);
    const v = 0.8 + 0.3 * fbm2(x * 0.25 + 4, z * 0.25, 3, 17);
    // Peaty brown-green moor, greyer rock toward the shore.
    c.setRGB(v * 0.95, v * 0.92, v * 0.78).lerp(new THREE.Color(0.62, 0.62, 0.6), smoothstep(0.8, 0.97, e));
  };

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination, cloudCover: SKY.cloudCover });
    this.dayTime = this.#dayTimeAt(SKY.sunElevation);
    const [gx, gz] = SKY.glowToward;
    this.sky.aimMoon(this.dayTime, new THREE.Vector3(-gx, 0, -gz)); // the afterglow over the sea, behind left
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(0x5c6470, 0.02);

    const key = new THREE.DirectionalLight('#aab6c8', LIGHT.key);
    key.position.set(-10, 12, -8);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    const hemi = new THREE.HemisphereLight('#8794a6', '#2c2a24', LIGHT.hemi);
    const fill = new THREE.DirectionalLight('#8e9cb4', LIGHT.fill);
    fill.position.set(2, 3, 9);
    this.scene.add(key, key.target, hemi, fill);
    this.lights = { key, hemi, fill };
    this.bindNihilism({
      lights: [
        { target: key, base: LIGHT.key },
        { target: hemi, base: LIGHT.hemi },
        { target: fill, base: LIGHT.fill },
      ],
      fogs: [{ fog: this.scene.fog, scale: 0.45, colorFrom: null }],
    });

    // The lamp on the bench (warm, fades when the work is destroyed) and a cold light that
    // keeps the room readable afterwards. Neither is tied to the coefficient.
    const L = LAYOUT.lamp;
    const lamp = new THREE.PointLight('#ffb066', WARM.lamp, 6.5, 2);
    lamp.position.set(L.x, LAYOUT.bench.h + 0.32, L.z);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(LOW ? 256 : 512, LOW ? 256 : 512);
    Object.assign(lamp.shadow.camera, { near: 0.1, far: 7 });
    lamp.shadow.bias = -0.004;
    lamp.shadow.autoUpdate = false;
    const cold = new THREE.PointLight('#8a9ab8', 0, 5, 2);
    cold.position.set(0.6, 1.95, -2.9); // over the bench
    // The lamplight falling through the gable window onto the Monster's face.
    const S = COTTAGE.side;
    const spill = new THREE.SpotLight('#ffb066', 0, 3.2, 0.55, 0.8, 2);
    spill.position.set(COTTAGE.x0 + COTTAGE.wall + 0.05, (S.y0 + S.y1) / 2 + 0.1, (S.z0 + S.z1) / 2);
    spill.target.position.set(SPOTS.watch.x + 0.4, 1.55, SPOTS.watch.z);
    this.scene.add(lamp, cold, spill, spill.target);
    this.roomLights = { lamp, cold, spill };
  }

  #dayTimeAt(elevation) {
    const sun = new THREE.Vector3();
    for (let t = 0.55; t < 1; t += 0.0002) {
      this.sky.bodiesAt(t, sun);
      if (Math.asin(sun.y) / DEG < elevation) return t;
    }
    return 0.88;
  }

  buildBackground() {
    const textures = groundTextures({ size: LOW ? 512 : 1024 });
    this.disposables.push(textures.litterMap);
    this.ground = createGround({ size: 300, segments: LOW ? 200 : 300, heightAt: this.heightAt, grassAt: this.#grassAt, tintAt: this.#tintAt, textures, tile: 3 });
    this.scene.add(this.ground);
    this.sea = createSea({ heightAt: this.heightAt, level: SEA_LEVEL, center: new THREE.Vector3(LAYOUT.island.x, 0, LAYOUT.island.z + 8), extent: 120, depthScale: 14 });
    this.disposables.push(this.sea.shore);
    this.scene.add(this.sea.mesh);
    this.#buildRocks();
    this.#buildClouds();
  }

  buildForeground() {
    this.#buildMaterials();
    this.#buildCottage();
    this.#buildInterior();
    this.#buildVegetation();
  }

  placeMonster(monster) {
    const S = SPOTS.watch;
    monster.object.position.set(S.x, 0, S.z);
    monster.object.rotation.y = S.yaw;
    monster.facing = S.yaw;
    monster.setPose(POSE.watch, { immediate: true });
    monster.lookAt(this.benchCenter);
  }

  buildInteractables() {
    this.#buildRemainsTarget();
    this.#buildHandTarget();
    this.addComponentLabel(IDS.remains, (t) => t.copy(this.benchCenter).add(_w.set(0, 0.62, 0.4)));
    this.addComponentLabel(IDS.hand, (t) => this.monster.parts.handR.getWorldPosition(t).add(_w.set(0, 0.22, 0.2)));
    // The room's materials take the lamplight's warmth (and later its cold).
    const room = new Set([...this.roomMats, ...this.victor.materials, ...this.figureMats]);
    this.scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) if (room.has(m) || o.userData.interior) applyInteriorLight(m);
    });
  }

  // ─── Materials ──────────────────────────────────────────────────────────────

  #buildMaterials() {
    const size = LOW ? 256 : 512;
    const stone = stoneTextures({ size, seed: 72 });
    const thatch = thatchTextures({ size, seed: 53 });
    const plaster = plasterTextures({ size, seed: 33 });
    const boards = boardTextures({ size, seed: 63 });
    for (const [t, m] of [[stone, 1.2], [thatch, 2], [plaster, 2], [boards, 1.6]]) {
      metric(t.map, m);
      metric(t.normalMap, m);
    }
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
    this.mats = {
      stone: std({ map: stone.map, normalMap: stone.normalMap, color: '#a6a39b' }),
      thatch: std({ map: thatch.map, normalMap: thatch.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), color: '#8f8775', roughness: 1 }),
      rope: std({ color: '#4a4235', roughness: 1 }),
      door: std({ map: boards.map, normalMap: boards.normalMap, color: '#6e5a44' }),
      // The room
      plasterIn: std({ map: plaster.map, normalMap: plaster.normalMap, color: '#d8d2c4' }),
      stoneIn: std({ map: stone.map, normalMap: stone.normalMap, color: '#8f8a80' }),
      wood: std({ map: boards.map, color: '#8c6c4e', roughness: 0.85 }),
      glass: std({ color: '#6f8a78', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 }),
      brass: std({ color: '#9a7a40', roughness: 0.35, metalness: 0.8 }),
      paper: std({ color: '#cdbf9e', roughness: 0.9 }),
      dark: std({ color: '#1e1a17', roughness: 1 }),
    };
    this.roomMats = ['plasterIn', 'stoneIn', 'wood', 'glass', 'brass', 'paper', 'dark'].map((k) => this.mats[k]);
  }

  // ─── Cottage ────────────────────────────────────────────────────────────────

  #wall({ length, holes = [], gable = null, position, rotationY }) {
    const C = COTTAGE;
    const geo = wallGeometry({ length, height: C.eaves, thickness: C.wall, holes, gable });
    const wall = new THREE.Mesh(geo, [this.mats.stone, this.mats.plasterIn, this.mats.stone]);
    wall.position.set(...position);
    wall.rotation.y = rotationY;
    wall.castShadow = wall.receiveShadow = true;
    wall.userData.blocksPick = true;
    this.pickBlockers.push(wall);
    this.scene.add(wall);
    return wall;
  }

  #buildCottage() {
    const C = COTTAGE;
    const width = C.x1 - C.x0;
    const depth = C.z1 - C.z0;
    const side = depth - 2 * C.wall;
    const gable = { shoulder: C.wall, rise: C.rise - C.wall };
    const local = (h) => ({ x0: h.x0 - C.x0, x1: h.x1 - C.x0, y0: h.y0 ?? 0, y1: h.y1 });
    this.#wall({ length: width, holes: [local(C.window), local({ ...C.door, y0: 0 })], position: [C.x0, 0, C.z1], rotationY: 0 });
    this.#wall({ length: width, position: [C.x1, 0, C.z0], rotationY: Math.PI });
    const S = C.side;
    this.#wall({
      length: side,
      holes: [{ x0: S.z0 - (C.z0 + C.wall), x1: S.z1 - (C.z0 + C.wall), y0: S.y0, y1: S.y1 }],
      gable,
      position: [C.x0, 0, C.z0 + C.wall],
      rotationY: -Math.PI / 2,
    });
    this.#wall({ length: side, gable, position: [C.x1, 0, C.z1 - C.wall], rotationY: Math.PI / 2 });

    // Thatch held down by ropes weighted with stones, as on island crofts.
    const slope = C.rise / (depth / 2);
    const pitch = Math.atan(slope);
    const run = depth / 2 + C.overhang;
    const len = run / Math.cos(pitch) + 0.2;
    const roofLength = width + 2 * C.verge;
    const roof = [];
    const ropes = [];
    const weights = [];
    for (const dir of [1, -1]) {
      const edgeZ = dir > 0 ? C.z1 + C.overhang : C.z0 - C.overhang;
      const edgeY = C.eaves - C.overhang * slope;
      const up = new THREE.Vector3(0, Math.sin(pitch), -dir * Math.cos(pitch));
      const normal = new THREE.Vector3(0, Math.cos(pitch), dir * Math.sin(pitch));
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), up, normal);
      const origin = new THREE.Vector3((C.x0 + C.x1) / 2, edgeY, edgeZ);
      const onRoof = (x, along, lift) => origin.clone().add(new THREE.Vector3(x, 0, 0)).addScaledVector(up, along).addScaledVector(normal, C.thatch + lift);
      const g = box(roofLength, len, C.thatch);
      g.applyMatrix4(basis.clone().setPosition(origin.clone().addScaledVector(up, len / 2).addScaledVector(normal, C.thatch / 2)));
      roof.push(g);
      for (let x = -roofLength / 2 + 0.3; x < roofLength / 2 - 0.2; x += 0.55) {
        const r = box(0.035, len, 0.035);
        r.applyMatrix4(basis.clone().setPosition(onRoof(x, len / 2, 0.01)));
        ropes.push(r);
        const end = onRoof(x, -0.05, -0.3);
        weights.push({ position: end, rotationY: x * 3.1, scale: new THREE.Vector3(0.1, 0.085, 0.09), color: new THREE.Color(0.45, 0.44, 0.42) });
      }
      for (const along of [len * 0.35, len * 0.7]) {
        const r = box(roofLength, 0.035, 0.035);
        r.applyMatrix4(basis.clone().setPosition(onRoof(0, along, 0.01)));
        ropes.push(r);
      }
    }
    const ridgeY = C.eaves + C.rise + C.thatch / Math.cos(pitch) - 0.06;
    roof.push(new THREE.CylinderGeometry(0.3, 0.3, roofLength - 0.1, 12, 1).rotateZ(Math.PI / 2).translate((C.x0 + C.x1) / 2, ridgeY, (C.z0 + C.z1) / 2));
    const roofMesh = new THREE.Mesh(merge(roof), this.mats.thatch);
    roofMesh.castShadow = roofMesh.receiveShadow = true;
    roofMesh.userData.blocksPick = true;
    this.pickBlockers.push(roofMesh);
    this.scene.add(roofMesh);
    const ropeMesh = new THREE.Mesh(merge(ropes), this.mats.rope);
    ropeMesh.castShadow = true;
    this.scene.add(ropeMesh);
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.scene.add(scatter(rockGeometry(this.rng, { moss: 0.2 }), rockMat, weights, { castShadow: true }));

    // Chimney on the east gable, with peat smoke.
    const chimney = new THREE.Mesh(box(0.7, 1.4, 0.7), this.mats.stone);
    chimney.position.set(C.x1 - 0.35, C.eaves + C.rise + 0.25, (C.z0 + C.z1) / 2);
    chimney.castShadow = true;
    this.scene.add(chimney);
    this.smoke = createSmoke({ origin: new THREE.Vector3(C.x1 - 0.35, C.eaves + C.rise + 1.0, (C.z0 + C.z1) / 2), height: 6 });
    this.smoke.uniforms.uWind.value.set(0.9, 0.35);
    this.scene.add(this.smoke.mesh);

    // Window frames, the door, and a warm glow at the front window while the lamp burns.
    const parts = [];
    const frame = (x0, x1, y0, y1, z, alongZ = false) => {
      const t = 0.07;
      const w = x1 - x0;
      const c = (x0 + x1) / 2;
      const put = (gw, gh, gx, gy) => parts.push(alongZ ? placed(box(0.09, gh, gw), [z, gy, gx]) : placed(box(gw, gh, 0.09), [gx, gy, z]));
      put(w + 2 * t, t, c, y1 + t / 2);
      put(w + 2 * t, t, c, y0 - t / 2);
      put(t, y1 - y0, x0 - t / 2, (y0 + y1) / 2);
      put(t, y1 - y0, x1 + t / 2, (y0 + y1) / 2);
      put(0.05, y1 - y0, c, (y0 + y1) / 2);
    };
    const W = C.window;
    frame(W.x0, W.x1, W.y0, W.y1, C.z1 - 0.06);
    frame(S.z0, S.z1, S.y0, S.y1, C.x0 + 0.06, true);
    const frames = new THREE.Mesh(merge(parts), this.mats.wood.clone());
    frames.material.color.set('#4a3a2c');
    this.scene.add(frames);
    const D = C.door;
    const door = new THREE.Mesh(box(D.x1 - D.x0 - 0.012, D.y1 - 0.008, C.wall - 0.04), this.mats.door);
    door.position.set((D.x0 + D.x1) / 2, D.y1 / 2, C.z1 - C.wall / 2 - 0.02);
    door.castShadow = door.receiveShadow = true;
    this.scene.add(door);
    const glowTex = glowTexture({ inner: 'rgba(255,170,90,0.9)', outer: 'rgba(255,140,60,0)' });
    this.disposables.push(glowTex);
    this.windowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry((W.x1 - W.x0) * 1.6, (W.y1 - W.y0) * 1.6),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.windowGlow.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, C.z1 + 0.05);
    this.windowGlow.userData.interior = true;
    this.scene.add(this.windowGlow);
  }

  // ─── Interior: the bench, Victor and his work ──────────────────────────────

  #buildInterior() {
    const C = COTTAGE;
    const M = this.mats;
    const ix0 = C.x0 + C.wall;
    const ix1 = C.x1 - C.wall;
    const iz0 = C.z0 + C.wall;
    const iz1 = C.z1 - C.wall;
    const add = (geo, mat, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    add(placed(box(ix1 - ix0, 0.06, iz1 - iz0), [(ix0 + ix1) / 2, C.floor - 0.03, (iz0 + iz1) / 2]), M.stoneIn, false);
    // Rafters under the thatch, and a beam across.
    const rafters = [];
    for (let x = ix0 + 0.3; x < ix1; x += 0.7) {
      for (const dir of [1, -1]) {
        const a = Math.atan(C.rise / ((C.z1 - C.z0) / 2));
        rafters.push(placed(box(0.09, 0.09, 2.6), [x, C.eaves + 0.75, (C.z0 + C.z1) / 2 + dir * 1.05], [dir * a, 0, 0]));
      }
    }
    rafters.push(placed(box(ix1 - ix0, 0.16, 0.16), [(ix0 + ix1) / 2, C.eaves - 0.05, (C.z0 + C.z1) / 2]));
    add(merge(rafters), M.wood);

    // The workbench and its clutter.
    const B = LAYOUT.bench;
    const bench = [placed(box(B.w, 0.07, B.d), [B.x, B.h - 0.035, B.z])];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bench.push(placed(box(0.08, B.h - 0.07, 0.08), [B.x + sx * (B.w / 2 - 0.08), (B.h - 0.07) / 2, B.z + sz * (B.d / 2 - 0.08)]));
    bench.push(placed(box(B.w - 0.2, 0.04, B.d - 0.15), [B.x, 0.18, B.z])); // shelf below
    add(merge(bench), M.wood);
    const jars = [];
    for (const [dx, dz, r, h] of [[0.62, 0.22, 0.05, 0.16], [0.7, 0.05, 0.04, 0.22], [-0.66, -0.2, 0.045, 0.14]]) jars.push(placed(new THREE.CylinderGeometry(r, r, h, 12), [B.x + dx, B.h + h / 2, B.z + dz]));
    add(merge(jars), M.glass);
    const tools = [placed(box(0.22, 0.012, 0.03), [B.x + 0.5, B.h + 0.006, B.z - 0.25], [0, 0.4, 0]), placed(box(0.16, 0.01, 0.02), [B.x + 0.38, B.h + 0.005, B.z + 0.27], [0, -0.7, 0])];
    tools.push(placed(new THREE.CylinderGeometry(0.07, 0.05, 0.08, 12), [B.x - 0.58, B.h + 0.04, B.z + 0.18])); // mortar
    add(merge(tools), M.brass);
    add(merge([placed(box(0.24, 0.05, 0.17), [B.x - 0.55, 0.24, B.z]), placed(box(0.22, 0.04, 0.16), [B.x - 0.52, 0.285, B.z], [0, 0.2, 0])]), M.paper);
    // Shelves on the back wall with bottles; a stool; a chest.
    add(merge([placed(box(1.6, 0.04, 0.24), [0.3, 1.45, iz0 + 0.12]), placed(box(1.6, 0.04, 0.24), [0.3, 1.05, iz0 + 0.12])]), M.wood);
    const bottles = [];
    for (let i = 0; i < 9; i++) bottles.push(placed(new THREE.CylinderGeometry(0.03 + (i % 3) * 0.008, 0.035, 0.18 + (i % 2) * 0.06, 10), [-0.35 + i * 0.16, i < 5 ? 1.56 : 1.16, iz0 + 0.12]));
    add(merge(bottles), M.glass);
    add(merge([placed(box(0.7, 0.45, 0.45), [-1.6, 0.225, iz0 + 0.3]), placed(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), [1.75, 0.5, -3.6]), placed(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 6), [1.75, 0.24, -3.6])]), M.wood);

    // The lamp: brass base, glass chimney, a small flame.
    const Lp = LAYOUT.lamp;
    add(merge([placed(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 14), [Lp.x, B.h + 0.03, Lp.z]), placed(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), [Lp.x, B.h + 0.11, Lp.z])]), M.brass);
    add(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 14, 1, true).translate(Lp.x, B.h + 0.24, Lp.z), M.glass, false);
    this.lampFlame = createFlames({ width: 0.04, height: 0.09, count: 2, intensity: 3.4 });
    this.lampFlame.mesh.position.set(Lp.x, B.h + 0.17, Lp.z);
    this.scene.add(this.lampFlame.mesh);
    const glowTex = glowTexture({ inner: 'rgba(255,180,100,0.8)', outer: 'rgba(255,150,70,0)' });
    this.disposables.push(glowTex);
    this.lampGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lampGlow.position.set(Lp.x, B.h + 0.22, Lp.z + 0.05);
    this.lampGlow.userData.interior = true;
    this.scene.add(this.lampGlow);

    this.benchCenter = new THREE.Vector3(B.x, B.h, B.z);
    this.#buildFigure();

    // Victor, standing behind the bench and facing the window.
    this.victor = new Person(FRANKENSTEIN_STYLE);
    this.victor.object.position.set(LAYOUT.victor.x, 0, LAYOUT.victor.z);
    this.victor.setPose(VICTOR.work);
    this.victor.lookAt(this.benchCenter.clone().add(new THREE.Vector3(-0.2, 0.1, 0)));
    this.victor.update(0);
    this.scene.add(this.victor.object);
  }

  /**
   * The unfinished figure: pale and smooth like a cast, lying on the bench under a sheet,
   * with the head, dark hair and one arm showing. Built as separate pieces so that the
   * destruction can scatter them (no gore: pieces of a pale cast, and the sheet).
   */
  #buildFigure() {
    const B = LAYOUT.bench;
    const pale = new THREE.MeshStandardMaterial({ color: '#d4cfc5', roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: '#1f1814', roughness: 0.75 });
    const sheetMat = new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.95, side: THREE.DoubleSide });
    this.figureMats = [pale, hair, sheetMat];
    const top = B.h;
    const piece = (mesh, r) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.pieces.push({ mesh, r, vel: new THREE.Vector3(), spin: new THREE.Vector3(), resting: true });
      return mesh;
    };
    const x0 = B.x - B.w / 2 + 0.22; // the head end, toward the Monster's window
    // Head with hair spread under it
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), pale);
    skull.scale.set(1, 0.9, 1.15);
    head.add(skull);
    const locks = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 8), hair);
    locks.scale.set(1.2, 0.25, 1.1);
    locks.position.set(-0.07, -0.07, 0);
    head.add(locks);
    head.traverse((o) => o.isMesh && (o.castShadow = true));
    head.position.set(x0, top + 0.1, B.z);
    piece(head, 0.12);
    // Torso, arms and legs: smooth capsules lying along the bench.
    const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 3, 10).rotateZ(Math.PI / 2);
    const torso = piece(new THREE.Mesh(capsule(0.12, 0.38), pale), 0.13);
    torso.position.set(x0 + 0.42, top + 0.11, B.z);
    torso.scale.set(1, 0.8, 1.15);
    const armOut = piece(new THREE.Mesh(capsule(0.04, 0.5), pale), 0.05);
    armOut.position.set(x0 + 0.48, top + 0.05, B.z + 0.21);
    const armIn = piece(new THREE.Mesh(capsule(0.04, 0.5), pale), 0.05);
    armIn.position.set(x0 + 0.48, top + 0.06, B.z - 0.19);
    const legs = piece(new THREE.Mesh(capsule(0.09, 0.62), pale), 0.1);
    legs.position.set(x0 + 1.02, top + 0.09, B.z);
    legs.scale.set(1, 0.75, 1.4);
    // The sheet: draped over the figure from the chest to the feet.
    const sheetGeo = new THREE.PlaneGeometry(1.25, 0.78, 24, 10).rotateX(-Math.PI / 2);
    const pos = sheetGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const body = Math.exp(-((z / 0.2) ** 2)) * (0.22 - 0.05 * (x / 0.62) ** 2);
      const hang = -Math.max(0, Math.abs(z) - 0.33) * 0.9; // over the bench edge
      pos.setY(i, Math.max(body, 0.012) + hang + 0.01 * Math.sin(x * 9 + z * 7));
    }
    sheetGeo.computeVertexNormals();
    const sheet = new THREE.Mesh(sheetGeo, sheetMat);
    sheet.position.set(x0 + 0.86, top, B.z);
    sheet.castShadow = sheet.receiveShadow = true;
    this.scene.add(sheet);
    this.sheet = sheet;
  }

  // ─── Island: rocks, vegetation, cloud ──────────────────────────────────────

  #buildRocks() {
    const rng = new Rng(121);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const geos = [0, 1, 2].map(() => rockGeometry(rng, { moss: rng.float(0.15, 0.4) }));
    const groups = [[], [], []];
    const add = (x, z, s, sink = 0.35) => groups[rng.int(0, 2)].push({
      position: new THREE.Vector3(x, this.heightAt(x, z) - s * sink, z),
      rotationY: rng.float(0, 6.3),
      tiltX: rng.float(-0.3, 0.3),
      scale: new THREE.Vector3(s * rng.float(0.9, 1.6), s * rng.float(0.7, 1.1), s * rng.float(0.9, 1.4)),
      color: new THREE.Color().setScalar(rng.float(0.5, 0.85)).multiply(new THREE.Color(1, 0.98, 0.94)),
    });
    const I = LAYOUT.island;
    this.shoreRocks = [];
    // Along the shore: big rocks the waves break on.
    for (let a = 0; a < Math.PI * 2; a += rng.float(0.05, 0.12)) {
      const back = Math.sin(a) < 0;
      const r = 0.97 + rng.float(-0.05, 0.04);
      const x = I.x + Math.cos(a) * I.rx * r;
      const z = I.z + Math.sin(a) * (back ? I.back : I.front) * r;
      if (Math.hypot(x - VIEWS.home.position[0], z - VIEWS.home.position[2]) < 6) continue;
      const s = rng.float(0.5, 1.6) * (back ? 1.3 : 1);
      add(x, z, s, 0.3);
      if (back && rng.chance(0.35)) this.shoreRocks.push(new THREE.Vector3(x, SEA_LEVEL + 0.3, z));
    }
    // A ledge of rock above the shore where the Monster ends the scene, and outcrops inland.
    add(SPOTS.resolve.x - 0.4, SPOTS.resolve.z - 1.4, 1.4, 0.55);
    add(SPOTS.resolve.x + 1.5, SPOTS.resolve.z - 0.6, 0.9, 0.5);
    for (let i = 0; i < (LOW ? 40 : 80); i++) {
      const x = rng.float(-20, 20);
      const z = rng.float(-11, 24);
      const e = this.#islandDist(x, z);
      if (e > 0.88 || this.#fromCottage(x, z) < 2.2) continue;
      if (Object.values(this.views).some((v) => Math.hypot(x - v.position.x, z - v.position.z) < 2.5)) continue;
      if (Math.hypot(x - SPOTS.watch.x, z - SPOTS.watch.z) < 1.5 || Math.hypot(x - SPOTS.resolve.x, z - SPOTS.resolve.z) < 1.2) continue;
      add(x, z, rng.chance(0.2) ? rng.float(0.5, 1.1) : rng.float(0.1, 0.35));
    }
    groups.forEach((items, i) => this.scene.add(scatter(geos[i], mat, items, { castShadow: true })));
    this.spray = createSpray(this.shoreRocks.length ? this.shoreRocks : [new THREE.Vector3(0, SEA_LEVEL, -12)]);
    this.scene.add(this.spray.mesh);
  }

  #buildVegetation() {
    const rng = new Rng(77);
    const grassMat = applyWind(new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1 }), { sway: 0.09, flutter: 0.02 });
    const tufts = [];
    const heather = [];
    for (let i = 0; i < 9000 && tufts.length < (LOW ? 900 : 1800); i++) {
      const x = rng.float(-20, 20);
      const z = rng.float(-11, 26);
      const g = this.#grassAt(x, z);
      if (rng.next() > g * 0.7) continue;
      if (Object.values(this.views).some((v) => Math.hypot(x - v.position.x, z - v.position.z) < 1.4)) continue;
      if (Math.hypot(x - SPOTS.watch.x, z - SPOTS.watch.z) < 0.9) continue;
      const s = rng.float(0.15, 0.36);
      tufts.push({ position: new THREE.Vector3(x, this.heightAt(x, z) - 0.02, z), rotationY: rng.float(0, 6.3), scale: new THREE.Vector3(s * 1.2, s, s * 1.2), color: new THREE.Color(rng.float(0.75, 0.95), rng.float(0.78, 0.92), rng.float(0.55, 0.7)) });
      // Heather grows in patches.
      if (fbm2(x * 0.2, z * 0.2, 2, 41) > 0.55 && rng.chance(0.6)) {
        const h = rng.float(0.12, 0.26);
        heather.push({ position: new THREE.Vector3(x + rng.gauss() * 0.3, this.heightAt(x, z) + h * 0.2, z + rng.gauss() * 0.3), rotationY: rng.float(0, 6.3), tiltX: rng.float(-0.3, 0.3), scale: new THREE.Vector3(h * 1.4, h * 0.7, h * 1.2), color: new THREE.Color().setHSL(rng.chance(0.4) ? 0.88 : 0.09, 0.14, rng.float(0.13, 0.2)) });
      }
    }
    this.scene.add(scatter(grassTuftGeometry(), grassMat, tufts));
    const shrub = new THREE.DodecahedronGeometry(1, 0);
    shrub.translate(0, 0.3, 0);
    this.scene.add(scatter(shrub, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), heather, { castShadow: true }));
  }

  #buildClouds() {
    // Low cloud banks over the sea, drifting.
    const rng = new Rng(88);
    const sheets = [];
    for (let i = 0; i < (LOW ? 16 : 28); i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(45, 160);
      const x = Math.cos(a) * r;
      const z = -2 + Math.sin(a) * r;
      sheets.push({ x, y: rng.float(4, 16), z, width: r * rng.float(0.5, 0.9), height: rng.float(5, 12) });
    }
    this.clouds = createMist(sheets);
    this.scene.add(this.clouds.mesh);
  }

  // ─── Interactables ──────────────────────────────────────────────────────────

  #buildRemainsTarget() {
    const B = LAYOUT.bench;
    const group = new THREE.Group();
    const hit = new THREE.Mesh(new THREE.BoxGeometry(B.w + 0.8, 1.0, 1.9), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(B.x + 0.2, 0.5, B.z - 0.55);
    group.add(hit);
    group.userData.lookPoint = this.benchCenter;
    this.scene.add(group);
    this.registerInteractable(IDS.remains, group);
  }

  #buildHandTarget() {
    const group = new THREE.Group();
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(hit);
    this.handHit = group;
    this.scene.add(group);
    this.registerInteractable(IDS.hand, group);
  }

  styleInteractable(object, state, t) {
    const id = object.userData.pickId;
    const hovered = state.hovered && state.active;
    if (id === IDS.remains) {
      for (const m of this.figureMats) m.emissive?.set(hovered ? '#3a3226' : state.pending ? '#140f0a' : '#000000');
    } else if (id === IDS.hand) {
      const skin = this.monster.materials.skin;
      skin.emissive.set('#5a4a2a');
      skin.emissiveIntensity = hovered ? 0.35 : state.pending ? 0.08 + 0.08 * Math.sin(t * 2.4) : 0;
    }
  }

  // ─── Sequence ───────────────────────────────────────────────────────────────

  async prepareQuote(quote) {
    const id = quote.objectId;
    const first = !this.tracker.isViewed(quote);
    const moves = [this.flyTo(VIEW_FOR[id], first ? 1.8 : 1.4)];
    if (first && id === IDS.hand) moves.push((this.sequence = this.#raiseFist()));
    await Promise.all(moves);
    if (first && !REDUCED_MOTION) await wait(0.5);
  }

  onQuoteClosed(quote, { viewed }) {
    if (quote.objectId === IDS.hand && viewed && this.phase !== 'resolved') this.sequence = this.#resolve();
    else if (quote.objectId === IDS.hand && !viewed && this.phase !== 'resolved') {
      this.monster.setPose(POSE.confront, { rate: 2 }); // closed early: back to the window
      this.monster.facing = SPOTS.watch.yaw;
    }
  }

  onComplete() {
    // Dev "Complete scene": jump to the end once any action has finished.
    Promise.resolve().then(() => {
      if (this.phase === 'resolved') return;
      this.sequence.then(() => !this.disposed && this.#placeAtEnd());
    });
  }

  onDispose() {
    for (const d of this.disposables) d.dispose();
  }

  #pause(s) {
    return wait(REDUCED_MOTION ? Math.min(s, 0.2) : s);
  }

  /** Victor stops, sweeps the figure from the bench; the warmth fades; the Monster reacts. */
  async #destroy() {
    this.phase = 'destroying';
    this.setInteractive(false);
    const V = this.victor;
    const M = this.monster;
    V.setPose(VICTOR.still, { rate: 2.5 });
    V.lookAt(M.eyePosition(new THREE.Vector3()));
    await this.#pause(1.6);
    V.lookAt(this.benchCenter);
    V.setPose(VICTOR.raise, { rate: 5 });
    await this.#pause(0.55);
    V.setPose(VICTOR.sweep, { rate: 9 });
    await this.#pause(0.12);
    this.#scatter();
    tween({ duration: REDUCED_MOTION ? 0.01 : 3.2, ease: Ease.inOutSine, onUpdate: (e) => (this.warmth = 1 - e) });
    await this.#pause(0.25);
    M.setPose(POSE.distress, { rate: 5 });
    M.lookAt(this.benchCenter);
    await this.#pause(1.6);
    V.setPose(VICTOR.spent, { rate: 2 });
    V.lookAt(this.benchCenter.clone().add(new THREE.Vector3(0.3, -0.6, -0.4)));
    M.setPose(POSE.rigid, { rate: 3 });
    M.clench(true);
    await this.#pause(1.0);
    M.setPose(POSE.confront, { rate: 2.2 });
    M.lookAt(V.joints.head.getWorldPosition(new THREE.Vector3()));
    V.lookAt(M.eyePosition(new THREE.Vector3()));
    await this.#pause(1.2);
    if (this.disposed || this.leaving) return;
    this.phase = 'destroyed';
    this.tracker.setEnabled(IDS.remains, null);
    this.setInteractive(true);
  }

  /** Throws the pieces off the bench (they then fall and settle in onUpdate). */
  #scatter() {
    const rng = this.rng;
    for (const p of this.pieces) {
      p.resting = false;
      p.vel.set(rng.float(-0.4, 1.6), rng.float(1.0, 2.0), rng.float(-1.6, -0.4));
      p.spin.set(rng.float(-6, 6), rng.float(-4, 4), rng.float(-6, 6));
    }
    // One arm and the torso stay on the bench, knocked askew.
    for (const k of [1, 3]) {
      const p = this.pieces[k];
      p.vel.set(rng.float(0.1, 0.5), rng.float(0.4, 0.8), rng.float(-0.3, 0.1));
      p.spin.multiplyScalar(0.4);
    }
    // The sheet slides off toward the floor beside the bench.
    const s = this.sheet;
    const from = s.position.clone();
    tween({
      duration: REDUCED_MOTION ? 0.01 : 0.9,
      ease: Ease.inCubic,
      onUpdate: (e) => {
        s.position.set(from.x + 0.55 * e, from.y - (from.y - COTTAGE.floor - 0.02) * e, from.z - 0.3 * e - Math.sin(e * Math.PI) * 0.15);
        s.rotation.set(-0.5 * Math.sin(e * Math.PI), 0.6 * e, 0.9 * Math.sin(e * Math.PI));
        s.scale.set(1 - 0.25 * e, 1 - 0.6 * e, 1 - 0.2 * e);
      },
    }).then(() => s.rotation.set(0, 0.6, 0));
  }

  #updatePieces(dt) {
    const C = COTTAGE;
    const B = LAYOUT.bench;
    const floor = C.floor;
    for (const p of this.pieces) {
      if (p.resting) continue;
      const m = p.mesh;
      const prevY = m.position.y;
      p.vel.y -= 9.8 * dt;
      m.position.addScaledVector(p.vel, dt);
      m.rotation.x += p.spin.x * dt;
      m.rotation.y += p.spin.y * dt;
      m.rotation.z += p.spin.z * dt;
      // Stay inside the room.
      m.position.x = THREE.MathUtils.clamp(m.position.x, C.x0 + C.wall + p.r, C.x1 - C.wall - p.r);
      m.position.z = THREE.MathUtils.clamp(m.position.z, C.z0 + C.wall + p.r, C.z1 - C.wall - p.r);
      const overBench = Math.abs(m.position.x - B.x) < B.w / 2 && Math.abs(m.position.z - B.z) < B.d / 2;
      const ground = overBench && prevY >= B.h + p.r - 0.02 ? B.h + p.r * 0.7 : floor + p.r * 0.7;
      if (m.position.y < ground) {
        m.position.y = ground;
        p.vel.y *= -0.25;
        p.vel.x *= 0.5;
        p.vel.z *= 0.5;
        p.spin.multiplyScalar(0.45);
        if (Math.abs(p.vel.y) < 0.4 && p.vel.length() < 0.5) {
          p.resting = true;
          // Settle flat-ish, the way a dropped piece lies.
          m.rotation.x = Math.round(m.rotation.x / (Math.PI / 2)) * (Math.PI / 2) * 0.15 + m.rotation.x * 0.85;
        }
      }
    }
  }

  async #raiseFist() {
    const M = this.monster;
    M.turnRate = 2;
    M.facing = SPOTS.watch.yaw - 0.6; // half turned from the wall, the fist held before him
    M.setPose(POSE.fist, { rate: 2.6 });
    M.clench(true);
    M.lookAt(M.parts.handR.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0)));
    await this.#pause(1.4);
  }

  /** Purpose partly restored: he straightens, turns from the window and strides to the shore. */
  async #resolve() {
    this.phase = 'resolved';
    this.setInteractive(false);
    const M = this.monster;
    M.setPose(POSE.upright, { rate: 2 });
    M.lookAt(null);
    await this.#pause(1.0);
    this.flyTo('end', 3.4);
    M.turnRate = 2.2;
    await M.walkTo(SPOTS.resolve, 1.25);
    M.facing = SPOTS.resolve.yaw;
    M.lookAt(new THREE.Vector3(SPOTS.resolve.x - 8, 1.6, SPOTS.resolve.z - 12));
    await this.#pause(1.2);
    if (this.disposed || this.leaving) return;
    this.setInteractive(true);
  }

  #placeAtEnd() {
    this.phase = 'resolved';
    this.warmth = 0;
    this.tracker.setEnabled(IDS.remains, null);
    if (this.pieces[0].resting && this.sheet.position.y > COTTAGE.floor + 0.2) this.#scatter();
    const M = this.monster;
    M.move?.resolve();
    M.move = null;
    M.setAnimation('idle');
    M.object.position.set(SPOTS.resolve.x, 0, SPOTS.resolve.z);
    M.object.rotation.y = SPOTS.resolve.yaw;
    M.facing = SPOTS.resolve.yaw;
    M.setPose(POSE.upright, { immediate: true });
    M.clench(true);
    this.victor.setPose(VICTOR.spent);
    this.flyTo('end', 2);
  }

  // ─── Per frame ──────────────────────────────────────────────────────────────

  onUpdate(dt, t) {
    WIND.uTime.value = t;
    WIND.uStrength.value = 2.2; // a stiff sea wind
    this.cloudOffset.x += dt * 0.012;
    this.cloudOffset.y += dt * 0.004;
    const S = this.sky.update(this.dayTime, { dayTop: visualParams.skyTop, dayHorizon: visualParams.skyHorizon, time: t, cloudOffset: this.cloudOffset, center: this.camera.position });
    const L = visualParams.lightIntensity;
    this.scene.fog.color.copy(S.fogColor).lerp(new THREE.Color('#6b7380'), 0.4);

    // Sea, spray and cloud.
    const U = this.sea.uniforms;
    U.uTime.value = t;
    U.uSky.value.copy(S.top);
    U.uHorizon.value.copy(S.horizon);
    U.uLight.value = 0.55 + 0.45 * L;
    this.spray.uniforms.uTime.value = t;
    if (t > this.nextSpray && this.shoreRocks.length) {
      this.spray.burst(this.rng.int(0, this.shoreRocks.length - 1), t);
      this.nextSpray = t + this.rng.float(1.2, 3.5);
    }
    this.clouds.uniforms.uColor.value.copy(S.fogColor).lerp(new THREE.Color('#9aa2ad'), 0.5).multiplyScalar(0.55 + 0.4 * L);
    this.clouds.uniforms.uOpacity.value = 0.55;
    this.clouds.uniforms.uTime.value = t * 3;
    this.smoke.uniforms.uTime.value = t;
    this.smoke.uniforms.uColor.value.copy(S.fogColor).multiplyScalar(1.3);

    // The lamp's warmth: light, flame, glow, the room's ambient and its held colour.
    const w = this.warmth;
    const f = 0.9 + 0.06 * Math.sin(t * 9.3) + 0.04 * Math.sin(t * 23.1);
    const { lamp, cold, spill } = this.roomLights;
    lamp.intensity = WARM.lamp * f * (0.06 + 0.94 * w);
    spill.intensity = WARM.spill * f * w;
    cold.intensity = WARM.cold * (1 - w);
    lamp.shadow.needsUpdate = ++this.frame % (this.phase === 'destroying' ? 1 : 3) === 0;
    this.lampFlame.uniforms.uTime.value = t;
    this.lampFlame.uniforms.uIntensity.value = 3.4 * (0.15 + 0.85 * w);
    this.lampGlow.material.opacity = 0.35 * w;
    this.windowGlow.material.opacity = 0.06 * w;
    INTERIOR.uInteriorAmbient.value.lerpColors(AMBIENT_COLD, AMBIENT_WARM, w);
    const target = THREE.MathUtils.lerp(visualParams.saturation, this.warmSaturation, w);
    INTERIOR.uKeepSaturation.value = target / Math.max(0.05, visualParams.saturation);

    // Victor at work: hands busy over the figure.
    const V = this.victor;
    V.update(dt);
    if (this.phase === 'watching') {
      const J = V.joints;
      J.elbowR.rotation.x += 0.22 * Math.sin(t * 3.1);
      J.shoulderR.rotation.z += 0.12 * Math.sin(t * 2.3);
      J.elbowL.rotation.x += 0.15 * Math.sin(t * 2.6 + 1);
      if (this.interactive) {
        this.watchTime += dt;
        if (this.watchTime > 5) this.sequence = this.#destroy();
      }
    }
    if (this.phase !== 'watching') this.#updatePieces(dt);

    // The hand's click target follows his right hand.
    this.monster.parts.handR.getWorldPosition(this.handHit.position);
  }
}
