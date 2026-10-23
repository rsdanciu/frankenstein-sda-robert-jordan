import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { tween, wait, Ease } from '../../core/tween.js';
import { nihilism, visualParams } from '../../nihilism/nihilism.js';
import { Person, FRANKENSTEIN_STYLE, WALTON_STYLE } from '../../people/Person.js';
import { DaySky } from '../nature/sky.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { snowTextures } from '../nature/textures.js';
import { createGround, rockGeometry, scatter } from '../nature/ground.js';
import { wallGeometry, box, placed, merge } from '../buildings/parts.js';
import { metric, boardTextures, floorTexture, pageTexture, blanketTexture, glowTexture } from '../buildings/textures.js';
import { createFlames } from '../buildings/fire.js';
import { INTERIOR, HAZE, applyInteriorLight, applyHaze } from '../grading.js';

/**
 * The Arctic and Walton's boat — scene 6, the last (data: public/json/scenes/arcticWaltonsBoat.json).
 *
 * Built to the students' brief: Walton's ship frozen into the Arctic ice, with leads of
 * dark water between the floes and snow-covered land and icebergs in the distance. The
 * scene begins on the deck in front of the cabin; inside the wooden cabin (a deckhouse
 * aft, with a large opening in its aft wall overlooking the ice) Frankenstein's body lies
 * on a low cot under a blanket, the Monster stands looking down at him, and Walton watches.
 *
 * As Purpose collapses (its value rises) the cabin loses its warmth and colour: the
 * lantern cools and the room's held saturation falls to the world's grey, while a steady
 * daylight from the opening keeps everyone visible. The Monster's movements slow with it
 * (Monster.timeScale).
 *
 * SEQUENCE ─ all four components are required, in order; each action plays before its menu.
 *   1 cabin entrance  the door swings open and the camera goes in from the deck: the Monster,
 *                     Frankenstein and Walton are revealed
 *   2 Frankenstien’s Body  the camera closes in on the Monster and Frankenstein
 *   3 The Monster’s face   the camera turns to his face, Walton behind him. Afterwards he
 *                     slowly turns from the body toward the opening
 *   4 the opening     he walks (slowly) to it and stands looking out over the ice
 */

const IDS = {
  door: 'arcticWaltonsBoat-door',
  body: 'arcticWaltonsBoat-body',
  face: 'arcticWaltonsBoat-face',
  opening: 'arcticWaltonsBoat-opening',
};
const ORDER = [IDS.door, IDS.body, IDS.face, IDS.opening];

const SKY = { latitude: 76, declination: 12, sunElevation: 20, sunToward: [0.5, 0.87] }; // the polar summer sun, ahead of the bow and to starboard (lower, the bow's high bulwarks shade the whole deck)

/** The ship, bow toward +Z, in metres; the sea is at y = 0. */
const SHIP = {
  stern: -9,
  bow: 21,
  beam: 3.7, // half-beam amidships
  deck: 2.4,
  rail: 1.0,
  masts: [
    { z: 5.5, height: 24, yards: [[8.5, 13], [13.5, 10], [18, 7]] },
    { z: 14.5, height: 21, yards: [[8, 11.5], [12.5, 8.5], [16.2, 6]] },
  ],
};
const ICE = 0.32; // the floes' surface above the water

/** The cabin: inner size, and its centre on the deck. Its own frame: x across (starboard +), z along (forward +), y above the deck. */
const CABIN = { z: -4.6, w: 4.4, l: 5.4, h: 2.75, wall: 0.12 };
const DOOR = { x: 1.05, w: 0.9, h: 2.05, open: -1.75 }; // in the forward wall; opens outward, clear of the view in
const OPENING = { x0: -1.4, x1: 1.4, y0: 0.95, y1: 2.45 }; // in the aft wall, over the stern and the ice
const COT = { x: 1.45, z: -0.4, w: 0.8, l: 2.0, h: 0.32 };
const LANTERN = { x: -0.2, y: 2.15, z: 0.6 };
const SPOTS = {
  monster: { x: 0.45, z: -0.6 }, // beside the cot, over Frankenstein's head and shoulders
  walton: { x: -0.55, z: 1.8 }, // forward of the Monster: seen past his shoulder from in front of his face
  window: { x: 0.15, z: -2.0 }, // at the opening
};

/** A point in the cabin's frame, in world space. */
const C = (x, y, z) => new THREE.Vector3(x, SHIP.deck + y, CABIN.z + z);
const A = (x, y, z) => C(x, y, z).toArray();
const FEET_Z = COT.z + COT.l / 2 - 0.12; // Frankenstein's feet; his head lies toward the opening
const FACE = C(COT.x, COT.h + 0.2, FEET_Z - 1.62);
const OUTSIDE = C(0.3, 1.0, -45); // where the Monster looks when he looks out over the ice

const VIEWS = {
  home: { position: [2.7, SHIP.deck + 2.4, 11.5], target: A(DOOR.x - 0.6, 1.4, CABIN.l / 2), fov: 52, needs: 28 }, // forward on the deck, the mainmast to one side
  threshold: { position: A(DOOR.x, 1.65, CABIN.l / 2 + 1.2), target: A(DOOR.x - 0.15, 1.45, 0), fov: 58, needs: 26 },
  cabin: { position: A(1.2, 1.72, 2.55), target: A(-0.3, 1.0, -0.8), fov: 66, needs: 30 }, // from the doorway: Walton, the Monster over the cot, the opening
  body: { position: A(1.85, 1.75, 0.95), target: A(0.9, 1.15, -0.95), fov: 50, needs: 22 }, // from the cot's foot: along the body to the Monster bent over his face
  face: { position: A(1.95, 1.95, -1.45), target: A(0.78, 1.97, -0.62), fov: 50, needs: 22 }, // level with his face; Walton beyond his shoulder
  opening: { position: A(-0.6, 1.6, 0.3), target: A(0.3, 1.5, -6), fov: 55, needs: 26 }, // behind him, the lantern overhead and out of shot
};
const VIEW_FOR = { [IDS.body]: 'body', [IDS.face]: 'face', [IDS.opening]: 'opening' };
const INSIDE_VIEWS = new Set(['cabin', 'body', 'face', 'opening']);

/** The Monster's poses (conventions in Monster.js POSES). */
const POSE = {
  bow: {
    hipsY: 1.15,
    joints: { spine: [0.3, 0, 0], chest: [0.22, 0, 0], shoulderL: [-0.12, 0, 0.1], elbowL: [-0.3, 0, 0], shoulderR: [-0.12, 0, -0.1], elbowR: [-0.3, 0, 0] },
  },
  still: {
    hipsY: 1.16,
    joints: { spine: [0.12, 0, 0], chest: [0.06, 0, 0], shoulderL: [0.02, 0, 0.1], elbowL: [-0.2, 0, 0], shoulderR: [0.02, 0, -0.1], elbowR: [-0.2, 0, 0] },
  },
};

/** Walton's and Frankenstein's poses (Person.setPose). */
const PEOPLE = {
  walton: { joints: { spine: [-0.05, 0, 0], chest: [0, 0, 0], shoulderL: [-0.18, 0, 0.12], elbowL: [-0.65, 0, 0], shoulderR: [0.04, 0, -0.1], elbowR: [-0.25, 0, 0] } },
  lying: {
    joints: {
      legL: [0, 0, 0.03], kneeL: [0.02, 0, 0], legR: [0, 0, -0.03], kneeR: [0.02, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0],
      shoulderL: [0.05, 0, 0.1], elbowL: [-0.12, 0, 0], shoulderR: [0.05, 0, -0.1], elbowR: [-0.12, 0, 0],
    },
  },
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const LIGHT = { key: 3.0, hemi: 2.6 }; // the sky outside, tied to the coefficient
const ROOM = { lantern: 9, day: 2.0, dayCold: 4.6 }; // the cabin's own light, not tied to it, so the room stays readable
const ROOM_WARM = { lantern: new THREE.Color('#ffc58c'), ambient: new THREE.Color('#3e2f22'), saturation: 0.5 };
const ROOM_COLD = { lantern: new THREE.Color('#cfd6de'), ambient: new THREE.Color('#363d48') };
const HAZE_PER_FOG = 0.006; // the distance haze per unit of the coefficient's fog density
const SLOWEST = 0.42; // the Monster's time scale once Purpose has fully collapsed
const lerp = THREE.MathUtils.lerp;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

// ─── The ship's lines ─────────────────────────────────────────────────────────

const shipU = (z) => (z - SHIP.stern) / (SHIP.bow - SHIP.stern);

/** Half the ship's breadth at the deck, from the square stern to the stem. */
function halfBeam(z) {
  const u = THREE.MathUtils.clamp(shipU(z), 0, 1);
  if (u < 0.6) return SHIP.beam * (0.66 + 0.34 * smoothstep(0, 0.3, u));
  const t = (u - 0.6) / 0.4;
  return SHIP.beam * Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.62);
}

/** The top of the bulwarks, rising toward bow and stern (the sheer). */
function railTop(z) {
  const u = shipU(z);
  return SHIP.deck + SHIP.rail + (u > 0.5 ? 1.1 * ((u - 0.5) / 0.5) ** 2 : 0.5 * ((0.5 - u) / 0.5) ** 2);
}

// ─── The ice ──────────────────────────────────────────────────────────────────

const CELL = 48; // the size of a floe

function hash2(ix, iz) {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  const t = Math.sin(ix * 269.5 + iz * 183.3) * 43758.5453;
  return [s - Math.floor(s), t - Math.floor(t)];
}

/** Floes as cells: how far a point is from the nearest crack between two floes, and which floe it is on. */
function floes(x, z) {
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  let d1 = Infinity;
  let d2 = Infinity;
  let id = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const [hx, hz] = hash2(gx + i, gz + j);
      const d = Math.hypot(x - (gx + i + 0.15 + 0.7 * hx) * CELL, z - (gz + j + 0.15 + 0.7 * hz) * CELL);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(gx + i + 31, gz + j - 17)[0];
      } else if (d < d2) d2 = d;
    }
  }
  return { edge: (d2 - d1) / 2, id };
}

/** Everything about the ice at a point: its height, open water, the frozen-in ice round the ship, the far land. */
function iceAt(x, z) {
  const r = Math.hypot(x, (z - 6) / 2.2); // round the hull
  const fast = 1 - smoothstep(26, 40, r); // the ship is frozen in: unbroken ice close by
  const d = Math.hypot(x, z);
  const land = smoothstep(2500, 3400, d) * smoothstep(0.36, 0.48, fbm2(x * 0.0005 + 1, z * 0.0005, 2, 31));
  const { edge, id } = floes(x, z);
  let h = ICE + (fbm2(x * 0.04, z * 0.04, 3, 3) - 0.5) * 0.3 * smoothstep(3, 8, r); // drifted snow
  const width = 1.6 + 7 * smoothstep(0.5, 0.85, fbm2(x * 0.003 + 3, z * 0.003, 2, 9)); // cracks, wider in places
  let water = 1 - smoothstep(width * 0.5, width * 0.5 + 1.2, edge);
  if (id < 0.07) water = 1; // a few floes gone altogether: open water
  water *= (1 - fast) * (1 - land);
  // A pressure ridge where the frozen-in ice meets the pack.
  h += smoothstep(20, 28, r) * (1 - smoothstep(30, 42, r)) * (0.3 + 1.3 * fbm2(x * 0.18, z * 0.18, 2, 21));
  h += (-1.4 - h) * water;
  h += land * (30 + 650 * Math.pow(fbm2(x * 0.001 + 5, z * 0.001, 5, 41), 1.7));
  return { h, water, edge, width, fast, land };
}

const heightAt = (x, z) => iceAt(x, z).h;

function iceTint(x, z, c) {
  const I = iceAt(x, z);
  const n = fbm2(x * 0.06, z * 0.06, 2, 17);
  c.setRGB(0.9 + 0.06 * n, 0.94 + 0.05 * n, 1.0);
  // Bare, blue ice at the floes' broken edges.
  const bare = (1 - smoothstep(I.width * 0.5 + 0.6, I.width * 0.5 + 4, I.edge)) * (1 - I.fast) * (1 - I.land);
  c.lerp(_c.setRGB(0.6, 0.74, 0.84), bare * 0.6);
  // Rock showing through the snow on the far land.
  const rock = smoothstep(0.55, 0.62, fbm2(x * 0.004, z * 0.004, 3, 51)) * smoothstep(0.3, 0.7, I.land);
  c.lerp(_c.setRGB(0.3, 0.31, 0.33), rock * 0.8);
}

export default class ArcticWaltonsBoatScene extends BaseScene {
  static cameraHome = { position: VIEWS.home.position, target: VIEWS.home.target };

  constructor(args) {
    super(args);
    this.useViews(VIEWS);
    this.camera.near = 0.05; // close quarters in the cabin
    this.camera.far = 20000; // the land is kilometres away
    this.camera.updateProjectionMatrix();
    this.step = 0;
    this.inside = false;
    this.baseView = 'home'; // where the camera returns between components
    this.sequence = Promise.resolve();
    this.disposables = [];
    this.interiorMats = new Set();
    this.rng = new Rng(4646);
    this.cloudOffset = new THREE.Vector2(0.8, 1.6);
    this.frame = 0;
    this.monsterLook = FACE.clone(); // he looks down at Frankenstein until he turns away
  }

  /** Inside the cabin the orbit is kept tight (walls are close); everywhere the views may look up or level. */
  limitOrbit(view) {
    super.limitOrbit(view);
    const s = new THREE.Spherical().setFromVector3(_v.subVectors(view.position, view.target));
    const inside = INSIDE_VIEWS.has(this.viewName);
    Object.assign(this.controls, { minPolarAngle: s.phi - (inside ? 0.08 : 0.2), maxPolarAngle: s.phi + 0.06 });
    if (inside) {
      Object.assign(this.controls, { minDistance: s.radius * 0.95, maxDistance: s.radius * 1.04, minAzimuthAngle: s.theta - 0.16, maxAzimuthAngle: s.theta + 0.16 });
    }
  }

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination, cloudCover: 0.5 });
    this.dayTime = this.#dayTimeAt(SKY.sunElevation);
    const [sx, sz] = SKY.sunToward;
    this.sky.aimMoon(this.dayTime, new THREE.Vector3(-sx, 0, -sz)); // the moon is opposite the sun
    this.sunDir = this.sky.bodiesAt(this.dayTime).sun.clone();
    this.scene.add(this.sky.mesh);
    this.scene.fog = null; // distance is a haze, so the far land stays visible

    const key = new THREE.DirectionalLight('#ffe2c4', LIGHT.key);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 260 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.target.position.set(0, SHIP.deck, 4);
    key.position.copy(key.target.position).addScaledVector(this.sunDir, 120);
    const hemi = new THREE.HemisphereLight('#a9b8cc', '#d8e0e8', LIGHT.hemi); // the ice lights things from below
    this.scene.add(key, key.target, hemi);
    this.lights = { key, hemi };
    this.bindNihilism({ lights: [{ target: key, base: LIGHT.key }, { target: hemi, base: LIGHT.hemi }] });

    // The cabin's light: the lantern, and daylight from the opening that grows as the warmth goes.
    const lantern = new THREE.PointLight(ROOM_WARM.lantern, ROOM.lantern, 9, 2);
    lantern.position.copy(C(LANTERN.x, LANTERN.y - 0.05, LANTERN.z));
    lantern.castShadow = true;
    lantern.shadow.mapSize.set(LOW ? 256 : 512, LOW ? 256 : 512);
    Object.assign(lantern.shadow.camera, { near: 0.1, far: 9 });
    lantern.shadow.bias = -0.004;
    lantern.shadow.autoUpdate = false;
    const day = new THREE.PointLight('#b9c6d6', ROOM.day, 7, 2);
    day.position.copy(C(1.1, 1.9, -1.9)); // beside the opening: light off the ice on both their faces
    this.scene.add(lantern, day);
    this.roomLights = { lantern, day };
  }

  #dayTimeAt(elevation) {
    const sun = new THREE.Vector3();
    for (let t = 0.55; t < 1; t += 0.0002) {
      this.sky.bodiesAt(t, sun);
      if (Math.asin(sun.y) / DEG < elevation) return t;
    }
    return 0.8;
  }

  buildBackground() {
    const tex = snowTextures({ size: LOW ? 512 : 1024, seed: 41 });
    const textures = { grassMap: tex.snowMap, litterMap: tex.trodMap, normalMap: tex.normalMap };
    this.disposables.push(tex.snowMap, tex.trodMap, tex.normalMap);
    // Detailed ice round the ship, and a large mesh out to the land; the far one dips under the near.
    this.near = createGround({ size: 800, segments: LOW ? 260 : 340, power: 1.8, heightAt, tintAt: iceTint, textures, tile: 5 });
    const farHeight = (x, z) => heightAt(x, z) - 3 * (1 - smoothstep(380, 396, Math.max(Math.abs(x), Math.abs(z))));
    this.far = createGround({ size: 24000, segments: LOW ? 240 : 320, power: 2.4, heightAt: farHeight, tintAt: iceTint, textures, tile: 5 });
    this.far.receiveShadow = false;
    for (const g of [this.near, this.far]) g.material.normalScale.set(0.5, 0.5);
    // The sea in the leads between the floes: dark, with the low sun's glint.
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0a1317', roughness: 0.14, metalness: 0.1 }));
    this.scene.add(this.near, this.far, this.water);
    this.#buildIcebergs();
    this.#buildRubble();
  }

  #buildIcebergs() {
    const rng = new Rng(77);
    const bergs = [];
    const add = (geo) => {
      const col = new Float32Array(geo.attributes.position.count * 3);
      const nor = geo.attributes.normal;
      for (let i = 0; i < nor.count; i++) {
        const up = smoothstep(-0.2, 0.8, nor.getY(i));
        col.set([lerp(0.62, 0.96, up), lerp(0.76, 0.98, up), lerp(0.86, 1.0, up)], i * 3); // blue in the shaded faces
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    };
    const kinds = [add(rockGeometry(rng, { moss: 0 })), add(rockGeometry(rng, { moss: 0 }))];
    for (let i = 0; i < 400 && bergs.length < 16; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(220, 2200);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(Math.atan2(x, -z)) < 0.25 && r < 900) continue; // keep the view astern over the ice open close by
      const s = rng.float(12, 45) * (r / 1200 + 0.4);
      bergs.push({ position: new THREE.Vector3(x, heightAt(x, z) - s * 0.1, z), rotationY: rng.float(0, 6.3), scale: new THREE.Vector3(s * rng.float(1, 1.8), s * rng.float(0.6, 1.3), s * rng.float(1, 1.6)) });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true });
    bergs.forEach((b, i) => this.scene.add(scatter(kinds[i % 2], mat, [b], { receiveShadow: false })));
  }

  /** Blocks of broken ice heaped along the pressure ridge. */
  #buildRubble() {
    const rng = new Rng(13);
    const items = [];
    for (let i = 0; i < 6000 && items.length < (LOW ? 160 : 320); i++) {
      const x = rng.float(-45, 45);
      const z = rng.float(-90, 100);
      const r = Math.hypot(x, (z - 6) / 2.2);
      if (r < 21 || r > 34) continue;
      const s = rng.float(0.25, 0.9);
      items.push({
        position: new THREE.Vector3(x, heightAt(x, z) + s * 0.1, z),
        rotationY: rng.float(0, 6.3),
        tiltX: rng.float(-0.7, 0.7),
        tiltZ: rng.float(-0.7, 0.7),
        scale: new THREE.Vector3(s * rng.float(0.8, 1.6), s * rng.float(0.3, 0.6), s * rng.float(0.8, 1.4)),
        color: new THREE.Color().setRGB(rng.float(0.78, 0.9), rng.float(0.88, 0.96), 1),
      });
    }
    this.scene.add(scatter(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), items, { castShadow: true }));
  }

  buildForeground() {
    this.#buildMaterials();
    this.#buildShip();
    this.#buildCabin();
    this.#buildInterior();
    this.#buildPeople();
  }

  placeMonster(monster) {
    const S = SPOTS.monster;
    monster.object.position.copy(C(S.x, 0, S.z));
    monster.object.rotation.y = Math.PI / 2; // facing the cot
    monster.facing = Math.PI / 2;
    monster.setPose(POSE.bow, { immediate: true });
    monster.lookAt(this.monsterLook);
  }

  buildInteractables() {
    this.#buildTargets();
    this.addComponentLabel(IDS.door, (t) => t.copy(C(DOOR.x, DOOR.h + 0.3, CABIN.l / 2 + CABIN.wall + 0.1)));
    this.addComponentLabel(IDS.body, (t) => t.copy(C(COT.x, COT.h + 0.55, COT.z + 0.2)));
    this.addComponentLabel(IDS.face, (t) => this.monster.joints.head.getWorldPosition(t).add(_w.set(0, 0.42, 0)));
    this.addComponentLabel(IDS.opening, (t) => t.copy(C(-0.9, OPENING.y1 - 0.25, -CABIN.l / 2 + 0.1)));
    this.#grade();
  }

  // ─── Materials ──────────────────────────────────────────────────────────────

  #buildMaterials() {
    const size = LOW ? 256 : 512;
    const boards = boardTextures({ size, seed: 64 });
    metric(boards.map, 1.6);
    metric(boards.normalMap, 1.6);
    const floor = metric(floorTexture({ size, seed: 84 }), 2);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.88, ...o });
    const inside = (m) => {
      this.interiorMats.add(m);
      return m;
    };
    this.mats = {
      hull: std({ map: boards.map, normalMap: boards.normalMap, vertexColors: true, side: THREE.DoubleSide }),
      deck: std({ map: floor, color: new THREE.Color(1.45, 1.4, 1.33) }), // weathered to silver-grey (the floor texture is dark)
      bulwark: std({ map: boards.map, normalMap: boards.normalMap, color: '#8c8072', side: THREE.DoubleSide }),
      snowWood: std({ color: '#e6ebf0', roughness: 0.8, side: THREE.DoubleSide }), // rails and roof under a crust of snow
      mast: std({ color: '#5e4630', roughness: 0.8 }),
      sail: std({ color: '#d6d2c6', roughness: 1 }),
      iron: std({ color: '#2a2724', roughness: 0.55, metalness: 0.5 }),
      cabinOut: std({ map: boards.map, normalMap: boards.normalMap, color: '#7b6a58' }),
      door: std({ map: boards.map, normalMap: boards.normalMap, color: '#6a5442', emissive: new THREE.Color('#6a5530'), emissiveIntensity: 0 }),
      cabinIn: inside(std({ map: boards.map, normalMap: boards.normalMap, color: '#a07c58' })),
      floorIn: inside(std({ map: floor, color: '#a7865f' })),
      wood: inside(std({ color: '#6e4d32', roughness: 0.75 })),
      darkWood: inside(std({ color: '#3f2c1f', roughness: 0.7 })),
      ironIn: inside(std({ color: '#2a2724', roughness: 0.5, metalness: 0.5 })),
      straw: inside(std({ color: '#b39a68', roughness: 1 })),
      linen: inside(std({ color: '#d9d1c0', roughness: 0.95 })),
      blanket: inside(std({ map: blanketTexture(), side: THREE.DoubleSide, roughness: 1, emissive: new THREE.Color('#5a4a30'), emissiveIntensity: 0 })),
      page: inside(std({ map: pageTexture({ seed: 107 }), roughness: 0.9 })),
      book: inside(std({ color: '#5a2e22', roughness: 0.7 })),
      glass: inside(std({ color: '#ffd9a0', emissive: new THREE.Color('#ffb066'), emissiveIntensity: 1.2, roughness: 0.2, transparent: true, opacity: 0.85 })),
    };
  }

  // ─── The ship ───────────────────────────────────────────────────────────────

  #buildShip() {
    const M = this.mats;
    // Hull: both sides lofted from stations, closed by a flat transom at the stern.
    const stations = [];
    for (let i = 0; i <= 72; i++) {
      const u = i / 72;
      stations.push(SHIP.stern + (SHIP.bow - SHIP.stern) * (u < 0.6 ? u : 0.6 + (1 - (1 - (u - 0.6) / 0.4) ** 1.6) * 0.4)); // denser toward the bow
    }
    const rows = 9;
    const bottom = -1.6; // under the ice: only the upper hull is ever seen
    const hullTint = new THREE.Color('#5e4a3a');
    const wale = new THREE.Color('#a3843f'); // a painted band below the rail
    const side = (sign) => {
      const pos = [];
      const uv = [];
      const col = [];
      const idx = [];
      for (const z of stations) {
        const b = halfBeam(z);
        const top = railTop(z);
        for (let j = 0; j <= rows; j++) {
          const s = j / rows;
          const y = lerp(top, bottom, s);
          pos.push(sign * b * (1 - 0.3 * s ** 2.2), y, z);
          uv.push(y, z); // planks run fore and aft
          const band = smoothstep(top - 0.78, top - 0.72, y) * (1 - smoothstep(top - 0.56, top - 0.5, y));
          _c.copy(hullTint).lerp(wale, band);
          col.push(_c.r, _c.g, _c.b);
        }
      }
      for (let i = 0; i < stations.length - 1; i++) {
        for (let j = 0; j < rows; j++) {
          const a = i * (rows + 1) + j;
          const b2 = a + rows + 1;
          if (sign > 0) idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
          else idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    // The transom: the stern's flat face, a fan from its centre.
    const transom = () => {
      const z = SHIP.stern;
      const b = halfBeam(z);
      const top = railTop(z);
      const outline = [];
      for (let j = 0; j <= rows; j++) outline.push([b * (1 - 0.3 * (j / rows) ** 2.2), lerp(top, bottom, j / rows)]);
      for (let j = rows; j >= 0; j--) outline.push([-b * (1 - 0.3 * (j / rows) ** 2.2), lerp(top, bottom, j / rows)]);
      const pos = [0, (top + bottom) / 2, z];
      const uv = [(top + bottom) / 2, 0];
      const col = [hullTint.r, hullTint.g, hullTint.b];
      for (const [x, y] of outline) {
        pos.push(x, y, z);
        uv.push(y, x);
        col.push(hullTint.r, hullTint.g, hullTint.b);
      }
      const idx = [];
      for (let k = 1; k < outline.length; k++) idx.push(0, k + 1, k);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const hull = new THREE.Mesh(merge([side(1), side(-1), transom()]), M.hull);
    hull.castShadow = hull.receiveShadow = true;
    this.scene.add(hull);

    // The deck, inside the bulwarks.
    const outline = new THREE.Shape();
    const deckZ = stations.filter((z) => halfBeam(z) > 0.15);
    deckZ.forEach((z, i) => (i ? outline.lineTo((halfBeam(z) - 0.1), -z) : outline.moveTo(halfBeam(z) - 0.1, -z)));
    [...deckZ].reverse().forEach((z) => outline.lineTo(-(halfBeam(z) - 0.1), -z));
    const deck = new THREE.Mesh(new THREE.ShapeGeometry(outline).rotateX(-Math.PI / 2).translate(0, SHIP.deck, 0), M.deck);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Bulwarks (their inner face) and the snowy rail along their top.
    const ribbon = (pointsAt) => {
      const pos = [];
      const uv = [];
      const idx = [];
      deckZ.forEach((z, i) => {
        const [p, q] = pointsAt(z);
        pos.push(...p, ...q);
        uv.push(z, 0, z, p[1] - q[1]);
        if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const parts = [];
    const rails = [];
    for (const sign of [1, -1]) {
      parts.push(ribbon((z) => [[sign * (halfBeam(z) - 0.1), SHIP.deck, z], [sign * (halfBeam(z) - 0.1), railTop(z), z]]));
      rails.push(ribbon((z) => [[sign * (halfBeam(z) - 0.14), railTop(z) + 0.05, z], [sign * (halfBeam(z) + 0.04), railTop(z) + 0.05, z]]));
    }
    const sb = halfBeam(SHIP.stern);
    parts.push(placed(box(sb * 2 - 0.2, railTop(SHIP.stern) - SHIP.deck, 0.1), [0, (railTop(SHIP.stern) + SHIP.deck) / 2, SHIP.stern + 0.15]));
    rails.push(placed(box(sb * 2, 0.08, 0.26), [0, railTop(SHIP.stern) + 0.05, SHIP.stern + 0.1]));
    const bulwarks = new THREE.Mesh(merge(parts), M.bulwark);
    bulwarks.castShadow = bulwarks.receiveShadow = true;
    const railMesh = new THREE.Mesh(merge(rails), M.snowWood);
    railMesh.castShadow = true;
    this.scene.add(bulwarks, railMesh);

    this.#buildRig();
    this.#buildDeckGear();
  }

  /** Masts, yards with their sails furled, the bowsprit, and the standing rigging. */
  #buildRig() {
    const M = this.mats;
    const spars = [];
    const sails = [];
    const lines = [];
    const line = (a, b) => lines.push(...a, ...b);
    const cyl = (r0, r1, len) => new THREE.CylinderGeometry(r1, r0, len, 10);
    for (const mast of SHIP.masts) {
      const lower = mast.height * 0.62;
      spars.push(placed(cyl(0.3, 0.22, lower), [0, SHIP.deck + lower / 2, mast.z]));
      spars.push(placed(cyl(0.18, 0.1, mast.height - lower + 1.2), [0, SHIP.deck + lower - 1.2 + (mast.height - lower + 1.2) / 2, mast.z + 0.25]));
      spars.push(placed(box(1.8, 0.14, 1.4), [0, SHIP.deck + lower - 0.5, mast.z + 0.1])); // the top
      for (const [h, len] of mast.yards) {
        spars.push(placed(cyl(0.12, 0.07, len), [0, SHIP.deck + h, mast.z - 0.35], [0, 0, Math.PI / 2]));
        // The sail furled along the yard: a thick roll of canvas, tapering to the ends.
        sails.push(placed(new THREE.CapsuleGeometry(0.2, len * 0.78, 3, 8), [0, SHIP.deck + h + 0.12, mast.z - 0.35], [0, 0, Math.PI / 2]));
      }
      // Shrouds to the rails each side, and stays forward and aft.
      const top = [0, SHIP.deck + lower - 0.4, mast.z];
      for (const sign of [1, -1]) {
        for (let k = -2; k <= 2; k++) {
          const z = mast.z + k * 0.55 - 0.4;
          line(top, [sign * (halfBeam(z) - 0.05), railTop(z), z]);
        }
        line([0, SHIP.deck + mast.height - 0.5, mast.z + 0.25], [sign * (halfBeam(mast.z - 3) - 0.05), railTop(mast.z - 3), mast.z - 3]);
      }
    }
    // Bowsprit, and the stays running to it and between the masts.
    const bowBase = [0, railTop(SHIP.bow - 1.5) - 0.3, SHIP.bow - 1.5];
    const bowTip = [0, bowBase[1] + 2.6, SHIP.bow + 7.5];
    const len = Math.hypot(bowTip[1] - bowBase[1], bowTip[2] - bowBase[2]);
    spars.push(placed(cyl(0.22, 0.1, len), [0, (bowBase[1] + bowTip[1]) / 2, (bowBase[2] + bowTip[2]) / 2], [Math.atan2(bowTip[2] - bowBase[2], bowTip[1] - bowBase[1]), 0, 0]));
    const [main, fore] = SHIP.masts;
    line([0, SHIP.deck + fore.height - 0.6, fore.z + 0.25], bowTip);
    line([0, SHIP.deck + fore.height * 0.62 - 0.4, fore.z], [0, bowBase[1] + 0.3, SHIP.bow - 0.5]);
    line([0, SHIP.deck + main.height - 0.6, main.z + 0.25], [0, SHIP.deck + fore.height * 0.62, fore.z]);
    line([0, SHIP.deck + main.height * 0.62 - 0.4, main.z], [0, SHIP.deck + 1.2, fore.z - 0.4]);

    const sparMesh = new THREE.Mesh(merge(spars), M.mast);
    sparMesh.castShadow = true;
    const sailMesh = new THREE.Mesh(merge(sails), M.sail);
    sailMesh.castShadow = true;
    const rig = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: '#211d19' }));
    this.scene.add(sparMesh, sailMesh, rig);
  }

  /** Hatches, a capstan, barrels and coiled rope on the deck. */
  #buildDeckGear() {
    const M = this.mats;
    const wood = [];
    const dark = [];
    wood.push(placed(box(2.2, 0.45, 1.8), [0, SHIP.deck + 0.22, 9.2]), placed(box(1.6, 0.4, 1.4), [0, SHIP.deck + 0.2, 17.5]));
    dark.push(placed(box(1.9, 0.06, 1.5), [0, SHIP.deck + 0.47, 9.2]));
    wood.push(placed(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 12), [0, SHIP.deck + 0.45, 1.2]));
    dark.push(placed(new THREE.CylinderGeometry(0.47, 0.47, 0.08, 12), [0, SHIP.deck + 0.92, 1.2]));
    for (const [x, z] of [[2.5, 7.3], [2.6, 8.1], [-2.6, 11.6], [-2.4, 3.2]]) {
      wood.push(placed(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 12), [x, SHIP.deck + 0.42, z]));
      dark.push(placed(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 12), [x, SHIP.deck + 0.2, z]), placed(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 12), [x, SHIP.deck + 0.64, z]));
    }
    for (const [x, z] of [[-2.3, 6.6], [2.4, 12.8]]) dark.push(placed(new THREE.TorusGeometry(0.34, 0.07, 6, 18).rotateX(Math.PI / 2), [x, SHIP.deck + 0.07, z]));
    const a = new THREE.Mesh(merge(wood), M.bulwark);
    const b = new THREE.Mesh(merge(dark), M.iron);
    a.castShadow = a.receiveShadow = b.castShadow = true;
    this.scene.add(a, b);
  }

  // ─── The cabin ──────────────────────────────────────────────────────────────

  #buildCabin() {
    const M = this.mats;
    const { w: W, l: L, h: H, wall: T } = CABIN;
    const group = new THREE.Group();
    group.position.set(0, SHIP.deck, CABIN.z);
    this.cabin = group;
    this.scene.add(group);
    const wallMats = [M.cabinOut, M.cabinIn, M.cabinIn];
    const addWall = (geo, position, rotationY) => {
      const m = new THREE.Mesh(geo, wallMats);
      m.position.set(...position);
      m.rotation.y = rotationY;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      this.pickBlockers.push(m);
      return m;
    };
    const outer = W / 2 + T;
    // Forward wall (the door), aft wall (the opening), and the two sides. See parts.js for each wall's frame.
    addWall(wallGeometry({ length: W + 2 * T, height: H, thickness: T, holes: [{ x0: outer + DOOR.x - DOOR.w / 2, x1: outer + DOOR.x + DOOR.w / 2, y0: 0, y1: DOOR.h }] }), [-outer, 0, L / 2 + T], 0);
    addWall(wallGeometry({ length: W + 2 * T, height: H, thickness: T, holes: [{ x0: outer - OPENING.x1, x1: outer - OPENING.x0, y0: OPENING.y0, y1: OPENING.y1 }] }), [outer, 0, -L / 2 - T], Math.PI);
    addWall(wallGeometry({ length: L, height: H, thickness: T }), [outer, 0, L / 2], Math.PI / 2);
    addWall(wallGeometry({ length: L, height: H, thickness: T }), [-outer, 0, -L / 2], -Math.PI / 2);

    // Roof, snow lying on it; its underside is the cabin's ceiling, crossed by beams.
    const roof = new THREE.Mesh(box(W + 2 * T + 0.3, 0.14, L + 2 * T + 0.3), [M.cabinOut, M.cabinOut, M.snowWood, M.cabinIn, M.cabinOut, M.cabinOut]);
    roof.position.set(0, H + 0.07, 0);
    roof.castShadow = roof.receiveShadow = true;
    group.add(roof);
    this.pickBlockers.push(roof);
    const beams = [];
    for (const z of [-1.8, 0, 1.8]) beams.push(placed(box(W, 0.14, 0.16), [0, H - 0.07, z]));
    // Trim round the door and the opening, inside and out.
    const trim = (x0, x1, y0, y1, z, out) => {
      const d = out ? 0.05 : -0.05;
      const list = [placed(box(x1 - x0 + 0.24, 0.12, 0.06), [(x0 + x1) / 2, y1 + 0.06, z + d]), placed(box(0.12, y1 - y0, 0.06), [x0 - 0.06, (y0 + y1) / 2, z + d]), placed(box(0.12, y1 - y0, 0.06), [x1 + 0.06, (y0 + y1) / 2, z + d])];
      if (y0 > 0) list.push(placed(box(x1 - x0 + 0.24, 0.08, 0.16), [(x0 + x1) / 2, y0 - 0.04, z + d]));
      return list;
    };
    const outTrim = [...trim(DOOR.x - DOOR.w / 2, DOOR.x + DOOR.w / 2, 0, DOOR.h, L / 2 + T, true), ...trim(OPENING.x0, OPENING.x1, OPENING.y0, OPENING.y1, -L / 2 - T, false)];
    const inTrim = [...beams, ...trim(DOOR.x - DOOR.w / 2, DOOR.x + DOOR.w / 2, 0, DOOR.h, L / 2, false), ...trim(OPENING.x0, OPENING.x1, OPENING.y0, OPENING.y1, -L / 2, true)];
    const outMesh = new THREE.Mesh(merge(outTrim), M.cabinOut);
    const inMesh = new THREE.Mesh(merge(inTrim), M.darkWood);
    outMesh.castShadow = inMesh.castShadow = inMesh.receiveShadow = true;
    group.add(outMesh, inMesh);
    // The cabin's own floor, laid over the deck.
    const floor = new THREE.Mesh(box(W, 0.02, L), M.floorIn);
    floor.position.set(0, -0.004, 0);
    floor.receiveShadow = true;
    group.add(floor);

    // The door, hinged on its port edge; it swings out onto the deck when the first component opens.
    this.door = new THREE.Group();
    this.door.position.set(DOOR.x - DOOR.w / 2, 0, L / 2 + T / 2);
    const leaf = new THREE.Mesh(box(DOOR.w - 0.02, DOOR.h - 0.02, 0.06), M.door);
    leaf.position.set(DOOR.w / 2, DOOR.h / 2, 0);
    leaf.castShadow = true;
    const hardware = [placed(box(0.5, 0.05, 0.02), [0.26, 0.4, 0.04]), placed(box(0.5, 0.05, 0.02), [0.26, DOOR.h - 0.4, 0.04]), placed(new THREE.TorusGeometry(0.05, 0.012, 6, 14), [DOOR.w - 0.14, 1.0, 0.05])];
    const iron = new THREE.Mesh(merge(hardware), M.iron);
    this.door.add(leaf, iron);
    group.add(this.door);
  }

  #buildInterior() {
    const M = this.mats;
    const g = this.cabin;
    const add = (mesh, cast = true) => {
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // The low cot: a frame, a straw mattress, a pillow.
    add(new THREE.Mesh(merge([
      placed(box(COT.w, 0.1, COT.l), [COT.x, COT.h - 0.13, COT.z]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => placed(box(0.07, COT.h - 0.12, 0.07), [COT.x + sx * (COT.w / 2 - 0.04), (COT.h - 0.12) / 2, COT.z + sz * (COT.l / 2 - 0.04)])),
    ]), M.wood));
    add(new THREE.Mesh(box(COT.w - 0.06, 0.09, COT.l - 0.06), M.straw)).position.set(COT.x, COT.h - 0.04, COT.z);
    const pillow = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 3, 10).rotateZ(Math.PI / 2), M.linen));
    pillow.scale.set(1, 0.55, 1.3);
    pillow.position.set(COT.x, COT.h, FEET_Z - 1.66);
    // The blanket over him.
    this.blanket = add(new THREE.Mesh(this.#blanketGeometry(), M.blanket));

    // A sea chest at the cot's foot; a table with a chart, a book and a candle-less inkstand; a chair; a shelf.
    add(new THREE.Mesh(box(0.78, 0.44, 0.48), M.wood)).position.set(COT.x, 0.22, COT.z + COT.l / 2 + 0.42);
    add(new THREE.Mesh(merge([placed(box(0.8, 0.04, 0.03), [0, 0.3, 0.25]), placed(box(0.8, 0.04, 0.03), [0, 0.3, -0.25])]), M.ironIn)).position.set(COT.x, 0, COT.z + COT.l / 2 + 0.42);
    const tx = -1.48;
    const tz = -1.75;
    add(new THREE.Mesh(merge([
      placed(box(0.9, 0.05, 0.7), [tx, 0.76, tz]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => placed(box(0.06, 0.74, 0.06), [tx + sx * 0.39, 0.37, tz + sz * 0.29])),
      placed(box(0.42, 0.04, 0.42), [tx + 0.1, 0.46, tz + 0.75]),
      placed(box(0.42, 0.5, 0.04), [tx + 0.1, 0.7, tz + 0.96]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => placed(box(0.04, 0.45, 0.04), [tx + 0.1 + sx * 0.18, 0.22, tz + 0.75 + sz * 0.18])),
    ]), M.wood));
    const chart = add(new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42).rotateX(-Math.PI / 2), M.page), false);
    chart.position.set(tx + 0.02, 0.787, tz);
    chart.rotation.y = 0.12;
    add(new THREE.Mesh(box(0.2, 0.05, 0.27), M.book)).position.set(tx + 0.3, 0.81, tz - 0.18);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.06, 10), M.ironIn)).position.set(tx - 0.3, 0.815, tz + 0.22);
    add(new THREE.Mesh(box(0.22, 0.03, 1.4), M.wood)).position.set(-CABIN.w / 2 + 0.11, 1.5, 1.5);
    const books = [];
    for (let i = 0, z = 0.95; i < 9; i++) {
      const t = this.rng.float(0.05, 0.09);
      const h = this.rng.float(0.2, 0.28);
      books.push(placed(box(0.17, h, t), [-CABIN.w / 2 + 0.12, 1.515 + h / 2, z + t / 2], [this.rng.float(-0.06, 0.06), 0, 0]));
      z += t + 0.01;
    }
    add(new THREE.Mesh(merge(books), M.book));

    // The lantern, hanging from the beam by a chain: brass cage, glass, a small flame.
    const L = LANTERN;
    add(new THREE.Mesh(merge([
      placed(new THREE.CylinderGeometry(0.008, 0.008, CABIN.h - (L.y + 0.2), 6), [L.x, (CABIN.h + L.y + 0.2) / 2, L.z]),
      placed(new THREE.ConeGeometry(0.11, 0.1, 8), [L.x, L.y + 0.16, L.z]),
      placed(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8), [L.x, L.y - 0.13, L.z]),
      ...[0, 1, 2, 3].map((k) => placed(new THREE.CylinderGeometry(0.007, 0.007, 0.26, 4), [L.x + Math.cos(k * Math.PI / 2 + 0.78) * 0.085, L.y, L.z + Math.sin(k * Math.PI / 2 + 0.78) * 0.085])),
    ]), M.ironIn), false);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), M.glass), false).position.set(L.x, L.y, L.z);
    this.flame = createFlames({ width: 0.035, height: 0.07, count: 2, intensity: 3.2 });
    this.flame.mesh.position.copy(C(L.x, L.y - 0.07, L.z));
    this.scene.add(this.flame.mesh);
    const glowTex = glowTexture({ inner: 'rgba(255,200,130,0.9)' });
    this.disposables.push(glowTex);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    this.glow.scale.setScalar(0.45);
    this.glow.position.copy(C(L.x, L.y, L.z));
    this.scene.add(this.glow);
  }

  /** A wool blanket laid over the body: raised over him, flat on the mattress, hanging over the cot's sides. */
  #blanketGeometry() {
    const W = COT.w + 0.34;
    const top = FEET_Z + 0.14; // over his feet ...
    const end = FEET_Z - 1.4; // ... to his shoulders
    const len = top - end;
    const geo = new THREE.PlaneGeometry(W, len, 28, 44);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const s = (pos.getY(i) + len / 2) / len; // 0 at the feet, 1 at the shoulders
      const half = lerp(0.22, 0.3, smoothstep(0.08, 0.75, s)); // ankles → chest, arms included
      const rise = s < 0.12 ? lerp(0.3, 0.2, smoothstep(0.04, 0.12, s)) : lerp(0.2, 0.27, smoothstep(0.35, 0.85, s)); // toes, legs, chest
      const over = Math.max(0, 1 - (u / (half * 1.25)) ** 2);
      let y = COT.h + 0.012 + rise * Math.sqrt(over) * (1 - 0.3 * smoothstep(0.92, 1, s));
      const edge = Math.abs(u) - (COT.w / 2 - 0.02);
      if (edge > 0) y -= edge * 1.9; // hanging over the side of the cot
      pos.setXYZ(i, COT.x + u, y, top - s * len);
      uv.setXY(i, u / W + 0.5, s);
    }
    geo.computeVertexNormals();
    return geo;
  }

  #buildPeople() {
    // Frankenstein, laid on his back on the cot, his head toward the opening, quite still.
    const F = new Person(FRANKENSTEIN_STYLE);
    F.materials[0].color.lerp(new THREE.Color('#c8bcb2'), 0.4); // the pallor of death
    F.setPose(PEOPLE.lying, { rate: 20 });
    F.update(10);
    F.joints.head.rotation.set(0, 0, 0);
    F.object.rotation.set(-Math.PI / 2, 0, 0);
    F.object.position.copy(C(COT.x, COT.h + 0.09, FEET_Z)); // settled a little into the straw
    this.scene.add(F.object);
    this.frankenstein = F;
    for (const m of F.materials) this.interiorMats.add(m);

    // Walton, against the port wall, watching the Monster.
    const W = new Person(WALTON_STYLE);
    W.object.position.copy(C(SPOTS.walton.x, 0, SPOTS.walton.z));
    const toward = C(SPOTS.monster.x, 0, SPOTS.monster.z).sub(W.object.position);
    W.object.rotation.y = Math.atan2(toward.x, toward.z);
    W.facing = W.object.rotation.y;
    W.setPose(PEOPLE.walton);
    W.update(0);
    this.scene.add(W.object);
    this.walton = W;
    for (const m of W.materials) this.interiorMats.add(m);
  }

  #buildTargets() {
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    const group = (id, children, lookPoint) => {
      const gr = new THREE.Group();
      children.forEach((c) => gr.add(c));
      gr.userData.lookPoint = lookPoint;
      this.scene.add(gr);
      this.registerInteractable(id, gr);
      return gr;
    };
    // The door itself is the first component (it is in the cabin group; a box covers it for clicks).
    const doorHit = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.1, DOOR.h + 0.1, 0.3), invisible);
    doorHit.position.copy(C(DOOR.x, DOOR.h / 2, CABIN.l / 2 + CABIN.wall + 0.1));
    this.doorHit = group(IDS.door, [doorHit], null);
    const body = new THREE.Mesh(new THREE.BoxGeometry(COT.w + 0.2, 0.5, COT.l), invisible);
    body.position.copy(C(COT.x, COT.h + 0.15, COT.z));
    group(IDS.body, [body], null);
    this.faceHit = group(IDS.face, [new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), invisible)], null);
    // The opening: a click plane across it, and a faint sheen shown while it waits to be viewed.
    const w = OPENING.x1 - OPENING.x0;
    const h = OPENING.y1 - OPENING.y0;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), invisible);
    plane.position.copy(C((OPENING.x0 + OPENING.x1) / 2, (OPENING.y0 + OPENING.y1) / 2, -CABIN.l / 2));
    this.sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: '#cfe2ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.sheen.position.copy(plane.position).add(_w.set(0, 0, 0.02));
    this.sheen.userData.noGrade = true;
    group(IDS.opening, [plane], null);
    this.scene.add(this.sheen);
  }

  /** The cabin's materials take its own light and held colour; everything outside takes the distance haze. */
  #grade() {
    this.monster.object.traverse((o) => o.isMesh && this.interiorMats.add(o.material));
    this.scene.traverse((o) => {
      if (!o.isMesh || o === this.sky.mesh || o.userData.noGrade) return;
      for (const m of [].concat(o.material ?? [])) {
        if (this.interiorMats.has(m)) applyInteriorLight(m);
        else if ((m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial) && m.visible !== false) applyHaze(m);
      }
    });
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  styleInteractable(object, state, t) {
    const id = object.userData.pickId;
    const hovered = state.hovered && state.active;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const glow = hovered ? 1 : state.pending ? 0.3 * pulse : 0;
    if (id === IDS.door) this.mats.door.emissiveIntensity = 0.5 * glow;
    else if (id === IDS.body) this.mats.blanket.emissiveIntensity = 0.45 * glow;
    else if (id === IDS.face) {
      const skin = this.monster.materials.skin;
      skin.emissive.set('#5a4a2a');
      skin.emissiveIntensity = 0.35 * glow;
    } else if (id === IDS.opening) this.sheen.material.opacity = 0.12 * glow;
  }

  async prepareQuote(quote) {
    const id = quote.objectId;
    const first = ORDER[this.step] === id && !this.tracker.isViewed(quote);
    if (id === IDS.door) {
      if (first && !this.inside) await (this.sequence = this.#enter());
      else await this.flyTo(this.inside ? this.baseView : 'home', 1.4);
    } else {
      const moves = [this.flyTo(VIEW_FOR[id], id === IDS.opening ? 2.6 : 1.8)];
      if (first && id === IDS.opening) moves.push((this.sequence = this.#toOpening()));
      await Promise.all(moves);
    }
    if (first && !REDUCED_MOTION) await wait(0.4);
  }

  onQuoteClosed(quote, { viewed }) {
    const id = quote.objectId;
    if (ORDER[this.step] === id && viewed) {
      this.step++;
      if (id === IDS.body) this.baseView = 'body'; // the camera stays close to them
      if (id === IDS.opening) this.baseView = 'opening';
      if (id === IDS.face) this.sequence = this.#turnAway();
      return;
    }
    if (this.viewName !== this.baseView) this.sequence = this.#returnToView(); // closed early, or a component viewed again
  }

  onComplete() {
    Promise.resolve().then(() => {
      if (this.step >= ORDER.length) return;
      this.step = ORDER.length;
      this.sequence.then(() => !this.disposed && this.#placeAtEnd());
    });
  }

  onDispose() {
    for (const d of this.disposables) d.dispose();
  }

  // ─── Sequence ───────────────────────────────────────────────────────────────

  #pause(s) {
    return wait(REDUCED_MOTION ? Math.min(s, 0.2) : s);
  }

  #ended() {
    return this.disposed || this.leaving;
  }

  #swingDoor(angle, seconds) {
    const from = this.door.rotation.y;
    return tween({ duration: REDUCED_MOTION ? 0.01 : seconds, ease: Ease.inOutCubic, onUpdate: (e) => (this.door.rotation.y = from + (angle - from) * e) });
  }

  /** The door swings open and the camera goes in from the deck: the three of them are revealed. */
  async #enter() {
    this.#swingDoor(DOOR.open, 1.5);
    await this.#pause(0.4);
    await this.flyTo('threshold', 1.8);
    await this.flyTo('cabin', 1.9);
    this.inside = true;
    this.baseView = 'cabin';
  }

  async #returnToView() {
    this.setInteractive(false);
    await this.flyTo(this.baseView, 1.5);
    if (!this.#ended()) this.setInteractive(true);
  }

  /** After his face: slowly he turns from the body toward the opening and the ice beyond it. */
  async #turnAway() {
    this.setInteractive(false);
    this.baseView = 'cabin';
    const flight = this.flyTo('cabin', 2.4);
    const M = this.monster;
    await this.#pause(0.6);
    this.monsterLook = OUTSIDE.clone();
    M.setPose(POSE.still, { rate: 0.9 });
    M.turnRate = 1.4;
    M.facing = Math.PI;
    await Promise.all([flight, this.#pause(2.6)]);
    if (!this.#ended()) this.setInteractive(true);
  }

  /** He walks to the opening (as slowly as he now moves) and stands looking out. */
  async #toOpening() {
    const M = this.monster;
    M.setPose(POSE.still, { rate: 1.2, weight: 0.5 });
    this.monsterLook = OUTSIDE.clone();
    await M.walkTo(C(SPOTS.window.x, 0, SPOTS.window.z), 0.75);
    if (this.#ended()) return;
    M.facing = Math.PI;
    M.setPose(POSE.still, { rate: 1 });
    await this.#pause(1.2);
  }

  /** Dev "Complete scene": in the cabin, the Monster at the opening. */
  #placeAtEnd() {
    const M = this.monster;
    this.door.rotation.y = DOOR.open;
    M.move?.resolve();
    M.move = null;
    M.setAnimation('idle');
    M.object.position.copy(C(SPOTS.window.x, 0, SPOTS.window.z));
    M.object.rotation.y = Math.PI;
    M.facing = Math.PI;
    M.setPose(POSE.still, { immediate: true });
    this.monsterLook = OUTSIDE.clone();
    this.baseView = 'opening';
    const wasInside = this.inside;
    this.inside = true;
    this.setInteractive(false); // the orbit must not pull the camera back toward the deck mid-flight
    (async () => {
      if (!wasInside) await this.flyTo('threshold', 1.2);
      if (!this.#ended()) await this.flyTo('opening', 1.8);
      if (!this.#ended()) this.setInteractive(true);
    })();
  }

  // ─── Per frame ──────────────────────────────────────────────────────────────

  onUpdate(dt, t) {
    this.cloudOffset.x += dt * 0.005;
    this.cloudOffset.y += dt * 0.0015;
    const S = this.sky.update(this.dayTime, { dayTop: visualParams.skyTop, dayHorizon: visualParams.skyHorizon, time: t, cloudOffset: this.cloudOffset, center: this.camera.position });
    HAZE.uHazeColor.value.copy(S.horizon).lerp(_c.set('#d4dbe3'), 0.3).multiplyScalar(0.7 + 0.3 * visualParams.lightIntensity);
    HAZE.uHazeDensity.value = visualParams.fogDensity * HAZE_PER_FOG;

    // As Purpose collapses: the cabin's warmth and colour drain away, and the Monster slows.
    const k = THREE.MathUtils.clamp((nihilism.displayed.purpose - this.start.purpose) / Math.max(0.05, 1 - this.start.purpose), 0, 1);
    const flicker = 0.9 + 0.06 * Math.sin(t * 9.1) + 0.04 * Math.sin(t * 21.7);
    const { lantern, day } = this.roomLights;
    lantern.color.lerpColors(ROOM_WARM.lantern, ROOM_COLD.lantern, k);
    lantern.intensity = ROOM.lantern * (1 - 0.3 * k) * lerp(flicker, 1, k * 0.7);
    day.intensity = lerp(ROOM.day, ROOM.dayCold, k);
    lantern.shadow.needsUpdate = ++this.frame % 3 === 0;
    this.flame.uniforms.uTime.value = t;
    this.flame.uniforms.uIntensity.value = 3.2 * (1 - 0.55 * k);
    this.glow.material.opacity = 0.35 * (1 - 0.7 * k);
    this.mats.glass.emissive.lerpColors(ROOM_WARM.lantern, ROOM_COLD.lantern, k);
    this.mats.glass.emissiveIntensity = 1.2 * (1 - 0.5 * k);
    INTERIOR.uInteriorAmbient.value.lerpColors(ROOM_WARM.ambient, ROOM_COLD.ambient, k);
    INTERIOR.uKeepSaturation.value = lerp(ROOM_WARM.saturation, visualParams.saturation, k) / Math.max(0.05, visualParams.saturation);

    const M = this.monster;
    M.timeScale = lerp(1, SLOWEST, k);
    M.lookAt(this.monsterLook); // held each frame: hovering a component does not turn his head
    const W = this.walton;
    W.lookAt(M.eyePosition(_w));
    W.update(dt);
    this.faceHit.position.copy(M.joints.head.getWorldPosition(_v)).add(_w.set(0, 0.15, 0));
  }
}
