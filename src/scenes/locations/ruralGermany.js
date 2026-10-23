import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BaseScene } from '../BaseScene.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { tween, wait, Ease } from '../../core/tween.js';
import { nihilism, visualParams, visualScalarsAt, averageOf } from '../../nihilism/nihilism.js';
import { Person } from '../../people/Person.js';
import { DaySky } from '../nature/sky.js';
import { Stream } from '../nature/water.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { WIND, applyWind, windDepthMaterial } from '../nature/wind.js';
import { NATURE_NOISE } from '../nature/glsl.js';
import { leafClusterTexture, needleSprayTexture, grassTexture, fernTexture, barkTextures, groundTextures, singleLeafTexture, lichenRockTexture } from '../nature/textures.js';
import { broadleafTree, coniferTree, silhouetteGeometries, cardsToInstances, cardGeometry, taperedTube, mergeGeometries } from '../nature/trees.js';
import { createGround, grassTuftGeometry, fernGeometry, flatLeafGeometry, rockGeometry, scatter } from '../nature/ground.js';
import { createMist } from '../nature/mist.js';
import { PlanarReflection } from '../nature/mirror.js';
import { wallGeometry, box, placed, merge, timberFrame } from '../buildings/parts.js';
import { metric, plasterTextures, timberTextures, thatchTextures, boardTextures, stoneTextures, floorTexture, strawTexture, pageTexture, glowTexture } from '../buildings/textures.js';
import { createFlames, createSmoke } from '../buildings/fire.js';
import { DRAIN, INTERIOR, applyDrain, applyInteriorLight } from '../grading.js';

/**
 * Rural Germany (The Cottagers) — scene 2 (data: public/json/scenes/ruralGermany.json).
 *
 * Built to the students' brief: a small timber-framed cottage beside a clearing in the
 * woods, with a garden, scattered trees and a path leading away. Through its window a
 * family talks around a table. The Monster hides in a cramped lean-to hovel built against
 * the cottage's side wall and watches them through a chink in that wall. The home view
 * shows both: the cold, dark hovel and the warm room beside it.
 *
 * LIGHT ─ blue hour outside (cool sky light); the room is lit by its hearth and a candle.
 * The room's lights are not tied to the Nihilism Coefficient and its materials hold their
 * colour against the grade pass (grading.js applyInteriorLight), so the interior stays warm.
 * Around the Monster colour and light drain away as Truth rises (applyDrain, following the
 * smoothed Truth value and the Monster's position).
 *
 * SEQUENCE ─ all five components are required, steps 1–5 in order. Each click first plays
 * the action (prepareQuote) so it is seen before the menu opens; the next label appears
 * when the action after the menu has finished.
 *   1 window  the camera moves closer to the family; the Monster edges up to the chink
 *   2 table   he tries to speak to them through it, silently
 *             then he draws back, leaves the hovel and kneels at the puddle
 *   3 puddle  the camera looks down at his reflection; he examines his face
 *             then he sits back on his heels
 *   4 book    he turns to the open book lying by the puddle and touches it
 *             then he moves to sit against the lichen-covered rock
 *   5 rock    he lays a hand on the lichen
 *             then his head sinks; the camera settles on him beside the lit window
 */

const IDS = {
  window: 'ruralGermany-window',
  table: 'ruralGermany-table',
  puddle: 'ruralGermany-puddle',
  book: 'ruralGermany-book',
  rock: 'ruralGermany-rock',
};
const ORDER = [IDS.window, IDS.table, IDS.puddle, IDS.book, IDS.rock];

const SKY = {
  latitude: 51.16,
  declination: 14,
  sunElevation: -5.5, // degrees: blue hour, soon after sunset
  sunToward: [0.62, -0.78], // horizontal direction of the afterglow: behind the cottage, to the right
};

/** World units are metres; the cottage front faces +Z (toward the camera). */
const COTTAGE = {
  x0: -0.6,
  x1: 5.4,
  z0: -7.6,
  z1: -3.0,
  wall: 0.24,
  eaves: 2.55,
  rise: 2.3, // ridge height above the eaves (45° pitch)
  plinth: 0.32,
  floor: 0.06,
  overhang: 0.45,
  verge: 0.35,
  thatch: 0.34,
  window: { x0: 0.05, x1: 1.55, y0: 0.9, y1: 2.0 }, // the family's window, front wall
  window2: { x0: 2.6, x1: 3.3, y0: 1.0, y1: 1.75 },
  door: { x0: 3.9, x1: 4.85, y1: 2.05 },
  chink: { z0: -4.31, z1: -4.21, y0: 1.52, y1: 1.7 }, // in the west wall, which the hovel leans on
};

const HOVEL = { x0: -2.75, z0: -5.95, z1: -3.15, high: 2.1, low: 1.42 };

const LAYOUT = {
  table: { x: 1.05, z: -5.0, w: 1.3, d: 0.8, h: 0.76 },
  hearth: { x: 1.05, w: 1.5, h: 1.2, d: 0.55 },
  family: [
    // { position, yaw, seat, style }
    { x: 0.75, z: -5.72, yaw: 0, style: { hair: '#d8d3c8', beard: '#e2ddd2', top: '#6b5a48', vest: '#3e3a33', bottom: '#3b342c', height: 1.66 } },
    { x: 1.37, z: -5.72, yaw: 0, style: { hairStyle: 'bun', hair: '#5a3a22', top: '#dccbaa', vest: '#7a3426', bottom: '#5c3a2e', skirt: true, apron: '#cdbf9e', height: 1.6 } },
    { x: 1.97, z: -4.98, yaw: -Math.PI / 2, style: { hair: '#3a281a', top: '#8a6a48', bottom: '#4a3c30', height: 1.74 } },
  ],
  puddle: { x: -1.6, z: -1.72, rx: 0.8, rz: 0.58, level: -0.012 },
  rock: { x: -3.42, z: -2.3 },
  book: { x: -2.22, z: -2.3, rotationY: 0.9 }, // within his reach as he kneels at the puddle
  garden: { x0: 1.75, x1: 3.95, z0: -2.6, z1: -0.65 },
  path: [[4.37, -3.0], [4.5, -2.1], [5.3, -1.45], [6.5, -1.55], [7.6, -2.7], [8.5, -5.1], [9.3, -8.5], [10.2, -12.5], [11.2, -17.5], [12.4, -24], [13.8, -32], [15, -42], [16, -55]],
  trees: [
    // Scattered trees placed by hand around the cottage; the rings below fill the woods.
    { kind: 'broad', x: -5.4, z: -9.4, h: 17, r: 0.48, seed: 3 },
    { kind: 'broad', x: 7.9, z: -10.6, h: 18, r: 0.5, seed: 5 },
    { kind: 'broad', x: 6.9, z: -3.9, h: 9.5, r: 0.24, seed: 8 },
    { kind: 'conifer', x: -5.9, z: -4.6, h: 15, r: 0.3, seed: 13 },
    { kind: 'conifer', x: -7.6, z: -8.1, h: 21, r: 0.36, seed: 17 },
    { kind: 'broad', x: -6.8, z: 0.9, h: 13, r: 0.34, seed: 21 },
    { kind: 'conifer', x: 3.0, z: -12.5, h: 22, r: 0.36, seed: 23 },
  ],
};

/** Where the Monster is at each point of the sequence (x, z, facing). */
const SPOTS = {
  hide: { x: -1.95, z: -4.3, yaw: Math.PI / 2 },
  peer: { x: -1.32, z: -4.28, yaw: Math.PI / 2 }, // eyes a hand's breadth from the chink
  back: { x: -1.45, z: -4.26 },
  out: { x: -1.6, z: -2.9 },
  puddle: { x: -1.6, z: -2.74, yaw: 0 }, // his face over the far half of the puddle
  standRock: { x: -2.6, z: -1.85 },
  rock: { x: -2.86, z: -2.02, yaw: 0.95 },
};

/** Camera framings. `needs`: horizontal half-angle (degrees) that must stay in view on narrow screens. */
const VIEWS = {
  home: { position: [-0.7, 1.75, 4.5], target: [0.2, 1.0, -3.2], fov: 52, needs: 31 },
  window: { position: [-0.85, 1.6, 2.0], target: [0.05, 1.3, -4.6], fov: 40, needs: 24 },
  puddle: { position: [-1.5, 1.7, -0.5], target: [-1.6, 0.36, -1.85], fov: 50, needs: 15 },
  cluster: { position: [-1.25, 1.9, 1.7], target: [-2.45, 0.45, -2.2], fov: 46, needs: 24 },
  // Last view: the Monster by the rock and the lit window side by side.
  end: { position: [-1.9, 1.75, 3.1], target: [-1.0, 0.85, -2.6], fov: 50, needs: 27 },
};
const VIEW_FOR = { [IDS.window]: 'window', [IDS.table]: 'window', [IDS.puddle]: 'puddle', [IDS.book]: 'cluster', [IDS.rock]: 'cluster' };

/**
 * The Monster's held poses here (see POSES in Monster.js for the conventions). Knees and
 * hips are tuned to his built height, so his knees and seat rest on the ground.
 */
const POSE = {
  huddle: {
    hipsY: 0.2,
    joints: {
      legL: [-2.45, 0, 0.16], kneeL: [2.4, 0, 0], legR: [-2.45, 0, -0.16], kneeR: [2.4, 0, 0],
      spine: [0.42, 0, 0], chest: [0.3, 0, 0],
      shoulderL: [-1.05, 0, -0.32], elbowL: [-1.15, 0, 0], shoulderR: [-1.05, 0, 0.32], elbowR: [-1.15, 0, 0],
    },
    skirt: { rotationX: -0.15, scaleY: 0.5, scaleXZ: 1.2 },
  },
  kneel: {
    hipsY: 0.68,
    joints: {
      legL: [-0.28, 0, 0.1], kneeL: [1.86, 0, 0], legR: [-0.28, 0, -0.1], kneeR: [1.86, 0, 0],
      spine: [0.26, 0, 0], chest: [0.16, 0, 0],
      shoulderL: [-0.2, 0, 0.14], elbowL: [-0.45, 0, 0], shoulderR: [-0.2, 0, -0.14], elbowR: [-0.45, 0, 0],
    },
    skirt: { rotationX: -0.4, scaleY: 0.72, scaleXZ: 1.12 },
  },
  peer: {
    hipsY: 0.68,
    joints: {
      legL: [-0.32, 0, 0.1], kneeL: [1.9, 0, 0], legR: [-0.32, 0, -0.1], kneeR: [1.9, 0, 0],
      spine: [0.36, 0, 0], chest: [0.22, 0, 0],
      shoulderL: [-0.55, 0, 0.1], elbowL: [-0.9, 0, 0], shoulderR: [-0.3, 0, -0.12], elbowR: [-0.55, 0, 0],
    },
    skirt: { rotationX: -0.4, scaleY: 0.72, scaleXZ: 1.12 },
  },
  speak: {
    hipsY: 0.68,
    joints: {
      legL: [-0.32, 0, 0.1], kneeL: [1.9, 0, 0], legR: [-0.32, 0, -0.1], kneeR: [1.9, 0, 0],
      spine: [0.4, 0, 0], chest: [0.24, 0, 0],
      shoulderL: [-0.55, 0, 0.1], elbowL: [-0.9, 0, 0], shoulderR: [-1.45, 0.1, -0.05], elbowR: [-1.35, 0, 0],
    },
    skirt: { rotationX: -0.4, scaleY: 0.72, scaleXZ: 1.12 },
  },
  recoil: {
    hipsY: 0.64,
    joints: {
      legL: [-0.4, 0, 0.1], kneeL: [1.95, 0, 0], legR: [-0.4, 0, -0.1], kneeR: [1.95, 0, 0],
      spine: [-0.08, 0, 0], chest: [0.08, 0, 0],
      shoulderL: [-0.15, 0, 0.2], elbowL: [-0.3, 0, 0], shoulderR: [-0.45, 0, -0.2], elbowR: [-0.9, 0, 0],
    },
    skirt: { rotationX: -0.4, scaleY: 0.72, scaleXZ: 1.12 },
  },
  // A deep crouch for shuffling out under the low roof.
  stoop: {
    hipsY: 0.62,
    joints: {
      legL: [-1.25, 0, 0.16], kneeL: [2.1, 0, 0], legR: [-1.25, 0, -0.16], kneeR: [2.1, 0, 0],
      spine: [0.7, 0, 0], chest: [0.35, 0, 0],
      shoulderL: [-0.65, 0, 0.12], elbowL: [-0.35, 0, 0], shoulderR: [-0.65, 0, -0.12], elbowR: [-0.35, 0, 0],
    },
    skirt: { rotationX: -0.6, scaleY: 0.6, scaleXZ: 1.2 },
  },
  look: {
    hipsY: 0.62,
    hipsX: 0.3,
    joints: {
      legL: [-0.6, 0, 0.12], kneeL: [1.9, 0, 0], legR: [-0.6, 0, -0.12], kneeR: [1.9, 0, 0],
      spine: [0.42, 0, 0], chest: [0.3, 0, 0],
      shoulderL: [-0.75, 0, 0.18], elbowL: [-0.3, 0, 0], shoulderR: [-0.75, 0, -0.18], elbowR: [-0.3, 0, 0],
    },
    skirt: { rotationX: -0.5, scaleY: 0.7, scaleXZ: 1.15 },
  },
  examine: {
    hipsY: 0.6,
    hipsX: 0.38,
    joints: {
      legL: [-0.7, 0, 0.12], kneeL: [1.92, 0, 0], legR: [-0.7, 0, -0.12], kneeR: [1.92, 0, 0],
      spine: [0.5, 0, 0], chest: [0.36, 0, 0],
      shoulderL: [-0.85, 0, 0.18], elbowL: [-0.25, 0, 0], shoulderR: [-1.55, 0.2, 0.45], elbowR: [-2.15, 0, 0],
    },
    skirt: { rotationX: -0.55, scaleY: 0.7, scaleXZ: 1.15 },
  },
  reachDown: {
    hipsY: 0.6,
    hipsX: 0.35,
    joints: {
      legL: [-0.7, 0, 0.12], kneeL: [1.92, 0, 0], legR: [-0.7, 0, -0.12], kneeR: [1.92, 0, 0],
      spine: [0.62, 0, 0], chest: [0.38, 0, 0],
      shoulderL: [-0.6, 0, 0.2], elbowL: [-0.4, 0, 0], shoulderR: [-0.9, 0, -0.15], elbowR: [-0.3, 0, 0],
    },
    skirt: { rotationX: -0.55, scaleY: 0.7, scaleXZ: 1.15 },
  },
  sitBack: {
    hipsY: 0.4,
    joints: {
      legL: [-1.25, 0, 0.14], kneeL: [2.75, 0, 0], legR: [-1.25, 0, -0.14], kneeR: [2.75, 0, 0],
      spine: [0.32, 0, 0], chest: [0.42, 0, 0],
      shoulderL: [-0.12, 0, 0.12], elbowL: [-0.35, 0, 0], shoulderR: [-0.12, 0, -0.12], elbowR: [-0.35, 0, 0],
    },
    skirt: { rotationX: -0.6, scaleY: 0.55, scaleXZ: 1.2 },
  },
  slump: {
    hipsY: 0.22,
    joints: {
      legL: [-1.85, 0, 0.22], kneeL: [1.55, 0, 0], legR: [-1.45, 0, -0.1], kneeR: [0.3, 0, 0],
      spine: [-0.06, 0, 0], chest: [0.36, 0, 0],
      shoulderL: [-0.35, 0, 0.1], elbowL: [-0.9, 0, 0], shoulderR: [-0.12, 0, -0.08], elbowR: [-0.25, 0, 0],
    },
    skirt: { rotationX: -0.2, scaleY: 0.45, scaleXZ: 1.22 },
  },
  slumpLow: {
    hipsY: 0.21,
    joints: {
      legL: [-1.8, 0, 0.24], kneeL: [1.6, 0, 0], legR: [-1.42, 0, -0.1], kneeR: [0.28, 0, 0],
      spine: [0.02, 0, 0], chest: [0.55, 0, 0],
      shoulderL: [-0.25, 0, 0.08], elbowL: [-0.75, 0, 0], shoulderR: [-0.06, 0, -0.05], elbowR: [-0.18, 0, 0],
    },
    skirt: { rotationX: -0.2, scaleY: 0.45, scaleXZ: 1.22 },
  },
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const REFLECT = 1; // layer drawn into the puddle's reflection
const LIGHT = { key: 1.8, hemi: 1.5, fill: 1.0, near: 5 };
const HEARTH_COLOR = new THREE.Color('#ff8a3c');
const NEAR_LIGHT = { high: new THREE.Vector3(-2.2, 1.75, -0.85), water: new THREE.Vector3(-1.6, 0.3, -1.45) };
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export default class RuralGermanyScene extends BaseScene {
  static cameraHome = { position: VIEWS.home.position, target: VIEWS.home.target };

  constructor(args) {
    super(args);
    this.useViews(VIEWS);

    this.step = 0; // index in ORDER of the next action to play
    this.disposables = [];
    this.rng = new Rng(2024);
    this.talk = { speaker: -1, audience: 0, timer: 1.2 };
    this.cloudOffset = new THREE.Vector2(1.3, 4.1);
    // The room keeps the saturation it had when the scene began (see grading.js).
    this.keepSaturation = visualScalarsAt(averageOf(this.start)).saturation;
    this.sequence = Promise.resolve(); // the Monster's current action
    this.frame = 0;
  }

  // ─── Framing ────────────────────────────────────────────────────────────────

  entryPosition(home) {
    return home.clone().add(new THREE.Vector3(0, 30, 0.5));
  }

  exitPosition(from) {
    return from.clone().add(new THREE.Vector3(0, 32, 0));
  }

  // ─── Layout helpers ─────────────────────────────────────────────────────────

  #layout() {
    this.path = new Stream(LAYOUT.path, { widthAt: (s) => THREE.MathUtils.lerp(1.15, 0.75, smoothstep(0, 40, s)) });
    const W = COTTAGE.window;
    this.windowCenter = new THREE.Vector3((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, COTTAGE.z1);
    const C = COTTAGE.chink;
    this.chinkPoint = new THREE.Vector3(COTTAGE.x0, (C.y0 + C.y1) / 2, (C.z0 + C.z1) / 2);
    const T = LAYOUT.table;
    this.tableCenter = new THREE.Vector3(T.x, T.h, T.z);
    const P = LAYOUT.puddle;
    this.puddleCenter = new THREE.Vector3(P.x, P.level, P.z);
  }

  /** Distance from the footprint of the cottage and hovel (0 inside). */
  #fromBuildings(x, z) {
    const dx = Math.max(HOVEL.x0 - x, 0, x - COTTAGE.x1);
    const dz = Math.max(COTTAGE.z0 - z, 0, z - COTTAGE.z1);
    return Math.hypot(dx, dz);
  }

  #puddleDist(x, z) {
    const P = LAYOUT.puddle;
    return Math.hypot((x - P.x) / P.rx, (z - P.z) / P.rz) * (0.9 + 0.2 * fbm2(x * 2.1, z * 2.1, 2, 31));
  }

  #inGarden(x, z, margin = 0) {
    const G = LAYOUT.garden;
    return x > G.x0 - margin && x < G.x1 + margin && z > G.z0 - margin && z < G.z1 + margin;
  }

  heightAt = (x, z) => {
    let h = (fbm2(x * 0.08, z * 0.08, 3, 7) - 0.5) * 0.35;
    h *= smoothstep(0.6, 6, this.#fromBuildings(x, z)); // a level yard around the buildings
    const r = Math.hypot(x - 2, z + 5);
    h += smoothstep(18, 70, r) * (fbm2(x * 0.02 + 3, z * 0.02 - 2, 4, 9) - 0.3) * 8;
    for (const v of Object.values(this.views)) h *= smoothstep(0.5, 3, Math.hypot(x - v.position.x, z - v.position.z));
    h -= 0.09 * (1 - smoothstep(0.55, 1.15, this.#puddleDist(x, z))); // the puddle's hollow
    const q = this.path.nearest(x, z);
    if (q) h -= 0.025 * (1 - smoothstep(q.w * 0.25, q.w * 0.6, q.d));
    return h;
  };

  #grassAt = (x, z) => {
    let g = smoothstep(0.15, 1.1, this.#fromBuildings(x, z));
    const q = this.path.nearest(x, z);
    if (q) g *= smoothstep(q.w * 0.3, q.w * 0.75, q.d);
    g *= smoothstep(1.0, 1.6, this.#puddleDist(x, z));
    if (this.#inGarden(x, z, 0.1)) g *= 0.25;
    // Trampled ground in front of the hovel and the door.
    g *= 1 - 0.75 * (1 - smoothstep(0.4, 1.6, Math.hypot(x + 1.6, z + 2.6)));
    return g;
  };

  #tintAt = (x, z, c) => {
    const wet = 1 - smoothstep(0.8, 1.7, this.#puddleDist(x, z));
    const v = 0.86 + 0.28 * fbm2(x * 0.3 + 11, z * 0.3, 3, 13);
    const q = this.path.nearest(x, z);
    const worn = q ? 1 - smoothstep(q.w * 0.3, q.w * 0.7, q.d) : 0;
    c.setRGB(v * (1 + 0.95 * worn), v * (1 + 0.75 * worn), v * (1 + 0.5 * worn)).multiplyScalar(1 - 0.5 * wet); // packed earth on the path is paler
  };

  /** Space trees must leave clear: the buildings, the garden, the path, the clearing and the camera views. */
  #treeBlocked(x, z, spacing = 0) {
    if (this.#fromBuildings(x, z) < 4.5 + spacing) return true;
    if (this.#inGarden(x, z, 2.5)) return true;
    const q = this.path.nearest(x, z);
    if (q && q.d < q.w / 2 + 1.8) return true;
    if (z > -2.5 && x > -5 && x < 10) return true; // the clearing in front of the cottage
    for (const v of Object.values(this.views)) if (Math.hypot(x - v.position.x, z - v.position.z) < 4) return true;
    return false;
  }

  /** Limbs and foliage keep off the roof and out of the camera's way. */
  #avoid = (p, radius = 0.5) => {
    if (p.x > HOVEL.x0 - 1.2 - radius && p.x < COTTAGE.x1 + 1.2 + radius && p.z > COTTAGE.z0 - 1.2 - radius && p.z < COTTAGE.z1 + 1.5 + radius && p.y < COTTAGE.eaves + COTTAGE.rise + 2.5) return true;
    for (const v of Object.values(this.views)) if (p.distanceTo(v.position) < 3 + radius) return true;
    return false;
  };

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.#layout();
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination, cloudCover: 0.32 });
    this.dayTime = this.#dayTimeAt(SKY.sunElevation);
    // Turn the sky so the afterglow is behind the trees right of the cottage (the full moon,
    // opposite it, is then behind the camera).
    const [sx, sz] = SKY.sunToward;
    this.sky.aimMoon(this.dayTime, new THREE.Vector3(-sx, 0, -sz));
    this.sky.mesh.layers.enable(REFLECT);
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(0x1c2638, 0.02);

    // Outside: cool light from the sky, a key from the front left and a soft fill from the camera side.
    const key = new THREE.DirectionalLight('#9db2da', LIGHT.key);
    key.position.set(8, 13, 11).add(new THREE.Vector3(1, 0, -3));
    key.target.position.set(1, 0, -3);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 70 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    const hemi = new THREE.HemisphereLight('#53709f', '#1b2117', LIGHT.hemi);
    const fill = new THREE.DirectionalLight('#7f95c4', LIGHT.fill);
    fill.position.copy(this.home.position).add(new THREE.Vector3(-2, 2, 2));
    fill.target.position.set(-1.6, 0.8, -3.2);
    // Soft sky light over the puddle and the rock, so the Monster stays readable there in
    // his dark coat; it fades (with the fill) as Truth collapses. While he kneels at the
    // puddle it sinks to just above the water, as light off the water onto his face.
    const near = new THREE.PointLight('#8fa4cf', LIGHT.near, 6, 2);
    near.position.copy(NEAR_LIGHT.high);
    this.scene.add(key, key.target, hemi, fill, fill.target, near);
    for (const l of [key, hemi, fill, near]) l.layers.enable(REFLECT);
    this.lights = { key, hemi, fill, near };
    this.lightBindings = {
      key: { target: key, base: LIGHT.key },
      hemi: { target: hemi, base: LIGHT.hemi },
      fill: { target: fill, base: LIGHT.fill },
      near: { target: near, base: LIGHT.near },
    };
    this.bindNihilism({ lights: Object.values(this.lightBindings), fogs: [{ fog: this.scene.fog, scale: 0.55, colorFrom: null }] });

    // Inside: hearth and candle. Not bound to the coefficient, so the room stays warm.
    const H = LAYOUT.hearth;
    const hearth = new THREE.PointLight(HEARTH_COLOR, 12, 10, 2);
    hearth.position.set(H.x, 0.5, COTTAGE.z0 + COTTAGE.wall + 0.45);
    hearth.castShadow = true;
    hearth.shadow.mapSize.set(LOW ? 256 : 512, LOW ? 256 : 512);
    Object.assign(hearth.shadow.camera, { near: 0.1, far: 10 });
    hearth.shadow.bias = -0.004;
    hearth.shadow.autoUpdate = false; // refreshed every third frame in onUpdate
    const T = LAYOUT.table;
    const candle = new THREE.PointLight('#ffb866', 2, 2.3, 2);
    candle.position.set(T.x, T.h + 0.24, T.z);
    // Light through the chink: a narrow beam from inside onto the Monster's face.
    const beam = new THREE.SpotLight('#ffb46e', 7, 3.2, 0.28, 0.75, 2);
    beam.position.copy(this.chinkPoint).add(new THREE.Vector3(0.14, 0, 0));
    beam.target.position.set(SPOTS.peer.x, 1.52, SPOTS.peer.z - 0.02); // his face when he is at the chink
    beam.castShadow = true;
    beam.shadow.mapSize.set(512, 512);
    beam.shadow.bias = -0.002;
    Object.assign(beam.shadow.camera, { near: 0.05, far: 3.5 });
    this.nearLight = { level: 1, target: 1, at: 0 }; // at: 0 = above the rock, 1 = over the water
    this.scene.add(hearth, candle, beam, beam.target);
    // Every light is on the reflection layer too: the same lights in both renders keep one
    // shader program per material instead of switching every frame.
    for (const l of [hearth, candle, beam]) l.layers.enable(REFLECT);
    this.interiorLights = { hearth, candle, beam };
  }

  /** The time of day (in days) when the evening sun has sunk to `elevation` degrees. */
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
    this.ground = createGround({ size: 360, segments: LOW ? 220 : 320, heightAt: this.heightAt, grassAt: this.#grassAt, tintAt: this.#tintAt, textures, tile: 3.2 });
    this.scene.add(this.ground);
    this.#buildTrees();
    this.#buildMist();
  }

  buildForeground() {
    this.#buildMaterials();
    this.#buildCottage();
    this.#buildInterior();
    this.#buildHovel();
    this.#buildGarden();
    this.#buildGroundCover();
  }

  placeMonster(monster) {
    const S = SPOTS.hide;
    monster.object.position.set(S.x, 0, S.z);
    monster.object.rotation.y = S.yaw;
    monster.facing = S.yaw;
    monster.setPose(POSE.huddle, { immediate: true });
    monster.lookAt(this.tableCenter);
    monster.object.traverse((o) => o.isMesh && o.layers.enable(REFLECT));
  }

  buildInteractables() {
    this.#buildWindowTarget();
    this.#buildTableTarget();
    this.#buildPuddle();
    this.#buildBook();
    this.#buildRock();
    const W = COTTAGE.window;
    this.addComponentLabel(IDS.window, (t) => t.set(W.x0 + 0.05, W.y1 + 0.32, COTTAGE.z1 + 0.1));
    this.addComponentLabel(IDS.table, (t) => t.copy(this.tableCenter).add(_w.set(0, 0.42, 0.3)));
    this.addComponentLabel(IDS.puddle, (t) => t.set(LAYOUT.puddle.x + 0.1, 0.22, LAYOUT.puddle.z + LAYOUT.puddle.rz + 0.25));
    this.addComponentLabel(IDS.book, (t) => t.set(LAYOUT.book.x, 0.34, LAYOUT.book.z));
    this.addComponentLabel(IDS.rock, (t) => t.set(LAYOUT.rock.x - 0.1, 0.98, LAYOUT.rock.z));
    this.#gradeMaterials();
  }

  // ─── Materials ──────────────────────────────────────────────────────────────

  #buildMaterials() {
    const size = LOW ? 256 : 512;
    const plaster = plasterTextures({ size });
    const timber = timberTextures({ size });
    const thatch = thatchTextures({ size });
    const boards = boardTextures({ size });
    const stone = stoneTextures({ size });
    for (const [t, m] of [[plaster, 2], [timber, 1.5], [thatch, 2], [boards, 1.6], [stone, 1.5]]) {
      metric(t.map, m);
      metric(t.normalMap, m);
    }
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
    const floor = metric(floorTexture({ size }), 2);
    const straw = metric(strawTexture({ size }), 1.5);
    this.mats = {
      plaster: std({ map: plaster.map, normalMap: plaster.normalMap, color: '#d8d2c4' }),
      timber: std({ map: timber.map, normalMap: timber.normalMap, color: '#8a7766' }),
      thatch: std({ map: thatch.map, normalMap: thatch.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), color: '#a49a86', roughness: 1 }),
      boards: std({ map: boards.map, normalMap: boards.normalMap, color: '#9b9488' }),
      stone: std({ map: stone.map, normalMap: stone.normalMap, color: '#a39e94' }),
      door: std({ map: boards.map, normalMap: boards.normalMap, color: '#8c6a4a' }),
      iron: std({ color: '#1d1c1b', roughness: 0.6, metalness: 0.5 }),
      straw: std({ map: straw, color: '#b8ad94', roughness: 1 }),
      soil: std({ map: metric(strawTexture({ seed: 7, size: 256 }), 2), color: '#463a2c', roughness: 1 }),
      // The room: separate copies so only they get the interior lighting.
      plasterIn: std({ map: plaster.map, normalMap: plaster.normalMap, color: '#e8dcc8' }),
      timberIn: std({ map: timber.map, normalMap: timber.normalMap, color: '#9a8270' }),
      stoneIn: std({ map: stone.map, normalMap: stone.normalMap, color: '#9a9084' }),
      floor: std({ map: floor, color: '#c7b39a' }),
      wood: std({ map: timber.map, color: '#b08a66', roughness: 0.8 }),
      dark: std({ color: '#181210', roughness: 1 }),
      clay: std({ color: '#9a5a36', roughness: 0.7, side: THREE.DoubleSide }),
      pewter: std({ color: '#8d8a84', roughness: 0.45, metalness: 0.6 }),
      bread: std({ color: '#a8743e', roughness: 0.9 }),
      wax: std({ color: '#efe3c4', roughness: 0.6, emissive: new THREE.Color('#ffc27a'), emissiveIntensity: 0.25 }),
      cloth: std({ color: '#c8b48e', roughness: 1, side: THREE.DoubleSide }),
    };
    this.interiorMats = ['plasterIn', 'timberIn', 'stoneIn', 'floor', 'wood', 'dark', 'clay', 'pewter', 'bread', 'wax', 'cloth'].map((k) => this.mats[k]);
  }

  /** Interior lighting for the room's materials, the drain for everything outside. */
  #gradeMaterials() {
    const interior = new Set(this.interiorMats);
    for (const p of this.family) p.materials.forEach((m) => interior.add(m));
    this.scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) {
        if (interior.has(m) || o.userData.interior) applyInteriorLight(m);
        else if (m.isMeshStandardMaterial || m.isMeshLambertMaterial) applyDrain(m);
      }
    });
  }

  // ─── Cottage ────────────────────────────────────────────────────────────────

  /** A wall group placed so its local outside face (z = 0) lies on the given world plane. */
  #wall(name, { length, holes = [], gable = null, position, rotationY, timber = {} }) {
    const C = COTTAGE;
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = rotationY;
    const geo = wallGeometry({ length, height: C.eaves, thickness: C.wall, holes, gable });
    const wall = new THREE.Mesh(geo, [this.mats.plaster, this.mats.plasterIn, this.mats.plaster]);
    wall.castShadow = wall.receiveShadow = true;
    wall.userData.blocksPick = true;
    group.add(wall);
    this.pickBlockers.push(wall);

    // Timber frame on the outside face, and the stone plinth below it.
    const beams = timberFrame({ length, height: C.eaves, openings: holes, plinth: C.plinth, rails: [0.86, 2.0], gable, ...timber });
    const parts = beams.map((b) => placed(box(b.w, b.h, 0.06), [b.x, b.y, 0.025], [0, 0, b.angle]));
    const frame = new THREE.Mesh(merge(parts), this.mats.timber);
    frame.castShadow = frame.receiveShadow = true;
    group.add(frame);
    const door = holes.find((h) => h.y0 <= 0);
    const plinthParts = [];
    for (const [a, b] of door ? [[0, door.x0], [door.x1, length]] : [[0, length]]) {
      if (b - a > 0.01) plinthParts.push(placed(box(b - a, C.plinth, 0.08), [(a + b) / 2, C.plinth / 2, 0.03]));
    }
    const plinth = new THREE.Mesh(merge(plinthParts), this.mats.stone);
    plinth.castShadow = plinth.receiveShadow = true;
    group.add(plinth);
    group.traverse((o) => o.isMesh && o.layers.enable(REFLECT));
    this.scene.add(group);
    this[`${name}Wall`] = group;
    return group;
  }

  #buildCottage() {
    const C = COTTAGE;
    const width = C.x1 - C.x0;
    const depth = C.z1 - C.z0;
    const side = depth - 2 * C.wall;
    const gable = { shoulder: C.wall, rise: C.rise - C.wall };
    const local = (h) => ({ x0: h.x0 - C.x0, x1: h.x1 - C.x0, y0: h.y0 ?? 0, y1: h.y1 });

    // Front wall: the family's window, a small window and the door.
    this.#wall('front', {
      length: width,
      holes: [local(C.window), local(C.window2), local({ ...C.door, y0: 0 })],
      position: [C.x0, 0, C.z1],
      rotationY: 0,
    });
    this.#wall('back', { length: width, position: [C.x1, 0, C.z0], rotationY: Math.PI });
    // West wall, shared with the hovel; the chink is cut through it.
    const K = C.chink;
    this.#wall('west', {
      length: side,
      holes: [{ x0: K.z0 - (C.z0 + C.wall), x1: K.z1 - (C.z0 + C.wall), y0: K.y0, y1: K.y1 }],
      gable,
      position: [C.x0, 0, C.z0 + C.wall],
      rotationY: -Math.PI / 2,
      timber: { braces: false },
    });
    this.#wall('east', { length: side, gable, position: [C.x1, 0, C.z1 - C.wall], rotationY: Math.PI / 2 });

    // Thatched roof: two thick slopes meeting under a rounded ridge.
    const slope = C.rise / (depth / 2);
    const pitch = Math.atan(slope);
    const run = depth / 2 + C.overhang;
    const len = run / Math.cos(pitch) + 0.25;
    const roofLength = width + 2 * C.verge;
    const roof = [];
    for (const dir of [1, -1]) {
      const g = box(roofLength, len, C.thatch);
      // Underside passes through the top outer edge of the wall, rising toward the ridge.
      const edgeZ = dir > 0 ? C.z1 + C.overhang : C.z0 - C.overhang;
      const edgeY = C.eaves - C.overhang * slope;
      const up = new THREE.Vector3(0, Math.sin(pitch), -dir * Math.cos(pitch));
      const normal = new THREE.Vector3(0, Math.cos(pitch), dir * Math.sin(pitch));
      const center = new THREE.Vector3((C.x0 + C.x1) / 2, edgeY, edgeZ).addScaledVector(up, len / 2).addScaledVector(normal, C.thatch / 2);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), up, normal).setPosition(center));
      roof.push(g);
    }
    const ridgeY = C.eaves + C.rise + C.thatch / Math.cos(pitch) - 0.05;
    const ridge = new THREE.CylinderGeometry(0.26, 0.26, roofLength - 0.1, 12, 1).rotateZ(Math.PI / 2).translate((C.x0 + C.x1) / 2, ridgeY, (C.z0 + C.z1) / 2);
    roof.push(ridge);
    const roofMesh = new THREE.Mesh(merge(roof), this.mats.thatch);
    roofMesh.castShadow = roofMesh.receiveShadow = true;
    roofMesh.userData.blocksPick = true;
    roofMesh.layers.enable(REFLECT);
    this.pickBlockers.push(roofMesh);
    this.scene.add(roofMesh);

    // Chimney above the hearth, breaking through near the ridge.
    const H = LAYOUT.hearth;
    const chimney = new THREE.Mesh(box(0.62, 2.7, 0.62), this.mats.stone);
    chimney.position.set(H.x, 4.75, -5.85);
    chimney.castShadow = true;
    chimney.layers.enable(REFLECT);
    this.scene.add(chimney);
    this.smoke = createSmoke({ origin: new THREE.Vector3(H.x, 6.15, -5.85), height: 7 });
    this.scene.add(this.smoke.mesh);

    this.#buildWindowsAndDoor();
  }

  #buildWindowsAndDoor() {
    const C = COTTAGE;
    const z = C.z1;
    const parts = [];
    const frameAround = (w, depth = 0.1) => {
      const t = 0.07;
      const cx = (w.x0 + w.x1) / 2;
      parts.push(placed(box(w.x1 - w.x0 + 2 * t, t, depth), [cx, w.y1 + t / 2, z + 0.01]));
      parts.push(placed(box(w.x1 - w.x0 + 2 * t + 0.08, t * 1.2, depth + 0.06), [cx, w.y0 - t * 0.6, z + 0.03])); // sill
      parts.push(placed(box(t, w.y1 - w.y0, depth), [w.x0 - t / 2, (w.y0 + w.y1) / 2, z + 0.01]));
      parts.push(placed(box(t, w.y1 - w.y0, depth), [w.x1 + t / 2, (w.y0 + w.y1) / 2, z + 0.01]));
    };

    // The family's window: frame and a mullion cross (open, no glass).
    const W = C.window;
    this.windowFrameMat = this.mats.timber.clone();
    this.windowFrameMat.emissive = new THREE.Color('#ffb060');
    this.windowFrameMat.emissiveIntensity = 0;
    frameAround(W);
    const mullions = [
      placed(box(0.05, W.y1 - W.y0, 0.06), [(W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, z - 0.05]),
      placed(box(W.x1 - W.x0, 0.05, 0.06), [(W.x0 + W.x1) / 2, W.y0 + (W.y1 - W.y0) * 0.58, z - 0.05]),
    ];
    this.windowFrame = new THREE.Mesh(merge([...parts.splice(0), ...mullions]), this.windowFrameMat);
    this.windowFrame.castShadow = true;
    this.windowFrame.layers.enable(REFLECT);

    // Small window: frame and two shutters, closed, with a crack of light between them.
    const W2 = C.window2;
    frameAround(W2);
    const shutterW = (W2.x1 - W2.x0) / 2 - 0.012;
    for (const x of [W2.x0 + shutterW / 2, W2.x1 - shutterW / 2]) {
      parts.push(placed(box(shutterW, W2.y1 - W2.y0, 0.04), [x, (W2.y0 + W2.y1) / 2, z - 0.04]));
    }
    const frames = new THREE.Mesh(merge(parts.splice(0)), this.mats.timber);
    frames.castShadow = true;
    frames.layers.enable(REFLECT);
    this.scene.add(frames);

    // Plank door with iron bands and a ring.
    const D = C.door;
    const door = new THREE.Mesh(box(D.x1 - D.x0 - 0.012, D.y1 - 0.008, C.wall - 0.03), this.mats.door); // a hair inside the opening (no coplanar faces)
    door.position.set((D.x0 + D.x1) / 2, D.y1 / 2, z - C.wall / 2 - 0.015);
    door.castShadow = door.receiveShadow = true;
    const irons = [0.35, 1.65].map((y) => placed(box(D.x1 - D.x0 - 0.1, 0.05, 0.015), [(D.x0 + D.x1) / 2, y, z - 0.022]));
    irons.push(placed(new THREE.TorusGeometry(0.05, 0.008, 6, 12), [D.x1 - 0.18, 1.05, z - 0.02]));
    const iron = new THREE.Mesh(merge(irons), this.mats.iron);
    this.scene.add(door, iron);

    // A soft glow spilling from the lit windows.
    const glowTex = glowTexture({ inner: 'rgba(255,170,90,0.9)', outer: 'rgba(255,140,60,0)' });
    this.disposables.push(glowTex);
    for (const [w, s, o] of [[W, 1.6, 0.05]]) {
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      glow.scale.set((w.x1 - w.x0) * s, (w.y1 - w.y0) * s, 1);
      glow.position.set((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, z + 0.12);
      glow.userData.interior = true;
      glow.renderOrder = 2;
      this.scene.add(glow);
    }
  }

  // ─── Interior ───────────────────────────────────────────────────────────────

  #buildInterior() {
    const C = COTTAGE;
    const M = this.mats;
    const ix0 = C.x0 + C.wall;
    const ix1 = C.x1 - C.wall;
    const iz0 = C.z0 + C.wall;
    const iz1 = C.z1 - C.wall;
    const add = (geo, mat, { cast = true } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };

    // Floor, ceiling joists and boards.
    add(placed(box(ix1 - ix0, 0.06, iz1 - iz0), [(ix0 + ix1) / 2, C.floor - 0.03, (iz0 + iz1) / 2]), M.floor, { cast: false });
    const joists = [];
    for (let x = ix0 + 0.35; x < ix1; x += 0.62) joists.push(placed(box(0.12, 0.16, iz1 - iz0), [x, C.eaves - 0.08, (iz0 + iz1) / 2]));
    joists.push(placed(box(ix1 - ix0, 0.2, 0.2), [(ix0 + ix1) / 2, C.eaves - 0.3, (iz0 + iz1) / 2])); // a beam across the room
    add(merge(joists), M.timberIn);
    add(placed(box(ix1 - ix0, 0.04, iz1 - iz0), [(ix0 + ix1) / 2, C.eaves + 0.02, (iz0 + iz1) / 2]), M.wood);

    // Hearth on the back wall: stone jambs and lintel beam, a dark firebox, a hood above.
    const H = LAYOUT.hearth;
    const back = iz0;
    const stone = [
      placed(box(0.28, H.h, H.d), [H.x - H.w / 2 + 0.14, H.h / 2, back + H.d / 2]),
      placed(box(0.28, H.h, H.d), [H.x + H.w / 2 - 0.14, H.h / 2, back + H.d / 2]),
      placed(box(H.w + 0.3, 0.08, H.d + 0.25), [H.x, C.floor + 0.04, back + H.d / 2 + 0.1]), // hearthstone
    ];
    add(merge(stone), M.stoneIn);
    add(placed(box(H.w + 0.1, 0.22, H.d + 0.08), [H.x, H.h + 0.11, back + H.d / 2]), M.timberIn); // mantel beam
    add(placed(box(H.w, C.eaves - H.h - 0.22, H.d * 0.8), [H.x, (C.eaves + H.h + 0.22) / 2, back + H.d * 0.4]), M.plasterIn); // hood
    add(placed(box(H.w - 0.5, H.h - 0.05, 0.04), [H.x, H.h / 2, back + 0.03]), M.dark, { cast: false }); // sooty back
    const logs = [];
    for (const [a, y] of [[0.5, 0.12], [-0.45, 0.12], [0.05, 0.22]]) logs.push(placed(new THREE.CylinderGeometry(0.06, 0.07, 0.62, 7).rotateZ(Math.PI / 2), [H.x, y, back + 0.3], [0, a, 0]));
    add(merge(logs), M.timberIn);
    this.flames = createFlames({ width: 0.7, height: 0.6, intensity: 2.6 });
    this.flames.mesh.position.set(H.x, 0.15, back + 0.3);
    this.scene.add(this.flames.mesh);
    // A pot hanging over the fire and jugs on the mantel.
    const pot = add(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0.35, Math.PI - 0.35), M.iron);
    pot.position.set(H.x + 0.12, 0.62, back + 0.3);
    const crocks = [];
    for (const [dx, s] of [[-0.55, 1], [-0.32, 0.8], [0.45, 1.1]]) crocks.push(placed(jugGeometry(s), [H.x + dx, H.h + 0.22, back + 0.22]));
    add(merge(crocks), M.clay);

    // Shelf with bowls on the back wall, right of the hearth.
    add(placed(box(1.2, 0.04, 0.26), [3.0, 1.55, back + 0.13]), M.wood);
    const bowls = [];
    for (let i = 0; i < 4; i++) bowls.push(placed(bowlGeometry(0.09 + (i % 2) * 0.02), [2.55 + i * 0.3, 1.57, back + 0.13]));
    add(merge(bowls), M.clay);

    // Table, bench and stool.
    const T = LAYOUT.table;
    const furniture = [placed(box(T.w, 0.06, T.d), [T.x, T.h - 0.03, T.z])];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) furniture.push(placed(box(0.07, T.h - 0.06, 0.07), [T.x + sx * (T.w / 2 - 0.1), (T.h - 0.06) / 2, T.z + sz * (T.d / 2 - 0.1)]));
    }
    furniture.push(placed(box(1.45, 0.05, 0.3), [T.x, 0.43, -5.72]));
    for (const sx of [-0.6, 0.6]) furniture.push(placed(box(0.06, 0.4, 0.26), [T.x + sx, 0.2, -5.72]));
    const stool = LAYOUT.family[2];
    furniture.push(placed(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14), [stool.x + 0.02, 0.43, stool.z]));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      furniture.push(placed(new THREE.CylinderGeometry(0.022, 0.026, 0.42, 6), [stool.x + 0.02 + Math.cos(a) * 0.1, 0.2, stool.z + Math.sin(a) * 0.1], [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]));
    }
    this.tableMat = M.wood.clone();
    this.tableMat.emissive = new THREE.Color('#ffb060');
    this.tableMat.emissiveIntensity = 0;
    this.interiorMats.push(this.tableMat);
    this.tableMesh = add(merge(furniture), this.tableMat);

    // On the table: cloth runner, bread, bowls, a jug, cups and a candle.
    const items = { clay: [], bread: [], pewter: [] };
    items.bread.push(placed(new THREE.SphereGeometry(0.11, 12, 8).scale(1.3, 0.55, 0.85), [T.x - 0.32, T.h + 0.04, T.z + 0.05]));
    for (const [dx, dz] of [[-0.35, -0.22], [0.32, -0.22], [0.55, 0.1]]) items.clay.push(placed(bowlGeometry(0.085), [T.x + dx, T.h + 0.005, T.z + dz]));
    items.clay.push(placed(jugGeometry(1.15), [T.x - 0.5, T.h, T.z - 0.12]));
    for (const [dx, dz] of [[-0.05, -0.25], [0.6, -0.12]]) items.pewter.push(placed(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10), [T.x + dx, T.h + 0.045, T.z + dz]));
    add(merge(items.clay), M.clay);
    add(merge(items.bread), M.bread);
    add(merge(items.pewter), M.pewter);
    add(placed(box(0.42, 0.005, T.d - 0.1), [T.x, T.h + 0.003, T.z]), M.cloth, { cast: false });
    add(placed(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 10), [T.x, T.h + 0.075, T.z]), M.wax, { cast: false });
    this.candleFlame = createFlames({ width: 0.035, height: 0.07, count: 2, intensity: 3.2 });
    this.candleFlame.mesh.position.set(T.x, T.h + 0.15, T.z);
    this.scene.add(this.candleFlame.mesh);

    // The family
    this.family = LAYOUT.family.map((f) => {
      const p = new Person(f.style);
      p.sit(0.45);
      p.object.position.set(f.x, 0, f.z);
      p.object.rotation.y = f.yaw;
      this.scene.add(p.object);
      p.update(0);
      return p;
    });
  }

  // ─── Hovel ──────────────────────────────────────────────────────────────────

  /** Height of the hovel's roof underside at x (high against the cottage wall). */
  #hovelRoofAt(x) {
    const k = (x - HOVEL.x0) / (COTTAGE.x0 - HOVEL.x0);
    return THREE.MathUtils.lerp(HOVEL.low, HOVEL.high, THREE.MathUtils.clamp(k, 0, 1));
  }

  #buildHovel() {
    const rng = new Rng(77);
    const H = HOVEL;
    const xR = COTTAGE.x0;
    const boards = [];
    // Back wall (along x) and outer wall (along z): uneven vertical boards with gaps.
    for (let x = H.x0; x < xR - 0.05; ) {
      const w = rng.float(0.15, 0.23);
      const h = this.#hovelRoofAt(x + w / 2) + 0.05;
      boards.push(placed(box(w - 0.015, h, 0.035), [x + w / 2, h / 2, H.z0], [0, 0, rng.float(-0.015, 0.015)]));
      x += w + rng.float(0.005, 0.03);
    }
    for (let z = H.z0; z < H.z1 - 0.05; ) {
      const w = rng.float(0.15, 0.23);
      const missing = rng.chance(0.08);
      if (!missing) boards.push(placed(box(0.035, H.low + 0.04, w - 0.015), [H.x0, (H.low + 0.04) / 2, z + w / 2], [rng.float(-0.015, 0.015), 0, 0]));
      z += w + rng.float(0.005, 0.035);
    }
    // Front: a few boards on the outer side only, so the inside can be seen.
    for (let x = H.x0, n = 0; n < 3; n++) {
      const w = rng.float(0.16, 0.22);
      const h = this.#hovelRoofAt(x + w / 2) + 0.04;
      boards.push(placed(box(w - 0.015, h * (n === 2 ? 0.55 : 1), 0.035), [x + w / 2, (h * (n === 2 ? 0.55 : 1)) / 2, H.z1], [0, 0, rng.float(-0.03, 0.03)]));
      x += w + 0.02;
    }
    // Roof: boards sloping from the cottage wall down to the outer wall.
    const roofW = xR - H.x0 + 0.28;
    const fall = H.high - H.low;
    const angle = Math.atan2(fall, xR - H.x0);
    for (let z = H.z0 - 0.2; z < H.z1 + 0.22; ) {
      const w = rng.float(0.2, 0.3);
      const cx = (H.x0 - 0.28 + xR) / 2;
      boards.push(placed(box(roofW / Math.cos(angle), 0.035, w - 0.01), [cx, this.#hovelRoofAt(cx) + 0.035, z + w / 2], [0, 0, angle + rng.float(-0.02, 0.02)]));
      z += w;
    }
    const wood = new THREE.Mesh(merge(boards), this.mats.boards);
    wood.castShadow = wood.receiveShadow = true;
    wood.layers.enable(REFLECT);
    this.scene.add(wood);

    // Rough corner posts and the beam that carries the roof.
    const posts = [];
    for (const [x, z, h] of [[H.x0, H.z1, H.low], [H.x0, H.z0, H.low], [xR - 0.06, H.z1, H.high]]) posts.push(placed(new THREE.CylinderGeometry(0.06, 0.07, h, 7), [x, h / 2, z]));
    posts.push(placed(new THREE.CylinderGeometry(0.05, 0.05, xR - H.x0, 6).rotateZ(angle - Math.PI / 2), [(H.x0 + xR) / 2, this.#hovelRoofAt((H.x0 + xR) / 2) - 0.04, H.z1]));
    const postMesh = new THREE.Mesh(merge(posts), this.mats.timber);
    postMesh.castShadow = true;
    postMesh.layers.enable(REFLECT);
    this.scene.add(postMesh);

    // Straw on the floor, spilling out of the front.
    const straw = new THREE.Mesh(new THREE.PlaneGeometry(xR - H.x0 + 0.3, H.z1 - H.z0 + 0.6).rotateX(-Math.PI / 2), this.mats.straw);
    straw.position.set((H.x0 + xR) / 2, 0.012, (H.z0 + H.z1) / 2 + 0.25);
    straw.receiveShadow = true;
    this.scene.add(straw);
    const strawMat = new THREE.MeshStandardMaterial({ map: this.mats.straw.map, alphaTest: 0.5, color: '#c9bb98', side: THREE.DoubleSide, roughness: 1 });
    const tufts = [];
    for (let i = 0; i < 60; i++) {
      const x = rng.float(H.x0 + 0.1, xR - 0.1);
      const z = rng.float(H.z0 + 0.1, H.z1 + 0.4);
      tufts.push({ position: new THREE.Vector3(x, 0, z), rotationY: rng.float(0, 6.3), scale: new THREE.Vector3(rng.float(0.25, 0.5), rng.float(0.06, 0.14), rng.float(0.25, 0.5)) });
    }
    this.scene.add(scatter(grassTuftGeometry(), strawMat, tufts));

  }

  // ─── Garden, trees, ground cover ────────────────────────────────────────────

  #buildGarden() {
    const rng = new Rng(55);
    const G = LAYOUT.garden;
    // Raised beds of dark soil.
    const beds = [];
    const bedRows = [];
    for (let i = 0; i < 3; i++) {
      const z = G.z0 + 0.35 + i * 0.62;
      beds.push(placed(box(G.x1 - G.x0 - 0.4, 0.12, 0.42), [(G.x0 + G.x1) / 2, 0.03, z]));
      bedRows.push(z);
    }
    const soil = new THREE.Mesh(merge(beds), this.mats.soil);
    soil.receiveShadow = true;
    this.scene.add(soil);

    // Cabbages, leeks and low herbs in rows.
    const cabbage = new THREE.IcosahedronGeometry(1, 1);
    const leaf = new THREE.SphereGeometry(1, 8, 6).scale(0.55, 0.08, 1).translate(0, 0, 0.9);
    const heads = [];
    const outer = [];
    const leeks = [];
    bedRows.forEach((z, i) => {
      for (let x = G.x0 + 0.4; x < G.x1 - 0.35; x += i === 1 ? 0.18 : 0.36) {
        const px = x + rng.float(-0.03, 0.03);
        if (i === 1) {
          leeks.push({ position: new THREE.Vector3(px, 0.09, z + rng.float(-0.08, 0.08)), rotationY: rng.float(0, 6), scale: new THREE.Vector3(0.018, rng.float(0.22, 0.32), 0.018), color: new THREE.Color().setHSL(0.3, 0.45, rng.float(0.16, 0.24)) });
          continue;
        }
        const s = rng.float(0.08, 0.11);
        heads.push({ position: new THREE.Vector3(px, 0.09 + s * 0.7, z), rotationY: rng.float(0, 6), scale: new THREE.Vector3(s, s * 0.85, s), color: new THREE.Color().setHSL(0.24, 0.45, rng.float(0.18, 0.24)) });
        const turn = rng.float(0, 6);
        for (let k = 0; k < 6; k++) {
          outer.push({ position: new THREE.Vector3(px, 0.1, z), rotationY: turn + (k / 6) * Math.PI * 2, tiltX: -rng.float(0.25, 0.6), scale: s * rng.float(1.3, 1.7), color: new THREE.Color().setHSL(0.28, 0.5, rng.float(0.1, 0.15)) });
        }
      }
    });
    const veg = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    this.scene.add(scatter(cabbage, veg, heads, { castShadow: true }));
    this.scene.add(scatter(leaf, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), outer, { castShadow: true }));
    this.scene.add(scatter(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), veg, leeks));

    // Wattle fence around the garden, open toward the door.
    const posts = [];
    const weave = [];
    const corners = [[G.x0, G.z1], [G.x0, G.z0 - 0.05], [G.x1, G.z0 - 0.05], [G.x1, G.z1]];
    for (let i = 0; i < corners.length - 1; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 0.55));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        posts.push(withColor(placed(new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6), [ax + (bx - ax) * t, 0.36, az + (bz - az) * t], [rng.float(-0.04, 0.04), 0, rng.float(-0.04, 0.04)]), 0.85));
      }
      for (const y of [0.22, 0.34, 0.46, 0.58]) {
        const pts = [];
        for (let k = 0; k <= n * 2; k++) {
          const t = k / (n * 2);
          const off = Math.sin(k * Math.PI + y * 20) * 0.025;
          pts.push(new THREE.Vector3(ax + (bx - ax) * t + (bz - az) / len * off, y + rng.float(-0.01, 0.01), az + (bz - az) * t - (bx - ax) / len * off));
        }
        weave.push(taperedTube(pts, () => 0.014, { radial: 4, segments: n * 4 }).geometry);
      }
    }
    const fence = new THREE.Mesh(merge([...posts, ...weave]), this.barkMaterial);
    fence.castShadow = fence.receiveShadow = true;
    this.scene.add(fence);
  }

  #buildTrees() {
    const rng = new Rng(4343);
    const bark = barkTextures();
    this.barkMaterial = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, vertexColors: true, roughness: 0.95 });
    const wood = [];
    const leafCards = [];
    const needleCards = [];
    const placedTrees = [];
    const tint = () => (rng.chance(0.45) ? new THREE.Color(0.9, 0.88, 0.84) : new THREE.Color(0.9, 0.78, 0.66));
    const add = (tree) => {
      wood.push(...tree.wood);
      for (const c of tree.cards) (c.kind === 'needle' ? needleCards : leafCards).push(c);
    };
    for (const t of LAYOUT.trees) {
      const opts = { x: t.x, z: t.z, height: t.h, radius: t.r, detail: 1, groundY: this.heightAt(t.x, t.z), tint: tint(), avoid: this.#avoid };
      add(t.kind === 'conifer' ? coniferTree(new Rng(t.seed), opts) : broadleafTree(new Rng(t.seed), opts));
      placedTrees.push({ x: t.x, z: t.z, spacing: 4 });
    }
    const ok = (x, z, spacing) => placedTrees.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= Math.min(spacing, p.spacing) ** 2);
    const center = { x: 2, z: -5 };
    const ring = ({ r0, r1, count, spacing, make, tries = count * 30 }) => {
      let n = 0;
      for (let i = 0; i < tries && n < count; i++) {
        const r = Math.sqrt(rng.float(r0 * r0, r1 * r1));
        const a = rng.float(0, Math.PI * 2);
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        if (this.#treeBlocked(x, z) || !ok(x, z, spacing)) continue;
        // Woods behind and to the left; the clearing opens in front and to the right.
        const behind = smoothstep(2, -12, z);
        const left = smoothstep(2, -8, x);
        if (rng.next() > 0.25 + 0.75 * Math.max(behind, left)) continue;
        if (make(x, z, r) === false) continue;
        placedTrees.push({ x, z, spacing });
        n++;
      }
    };
    const nearOrMid = (detail) => (x, z) => {
      const conifer = rng.chance(detail ? 0.4 : 0.55);
      const height = conifer ? rng.float(17, 27) : rng.float(13, 21);
      const opts = { x, z, height, detail, groundY: this.heightAt(x, z), tint: tint(), avoid: this.#avoid };
      if (conifer) add(coniferTree(rng, { ...opts, radius: rng.float(0.24, 0.4) }));
      else add(broadleafTree(rng, { ...opts, radius: rng.float(0.28, 0.46), cardSize: detail ? [1.5, 2.3] : [2.4, 3.4] }));
    };
    ring({ r0: 9, r1: 24, count: LOW ? 26 : 40, spacing: 4.6, make: nearOrMid(1) });
    ring({ r0: 24, r1: 52, count: LOW ? 55 : 100, spacing: 5.6, make: nearOrMid(0) });
    const far = { conifer: [], broadleaf: [] };
    ring({
      r0: 52,
      r1: 170,
      count: LOW ? 450 : 850,
      spacing: 6.5,
      make: (x, z) => {
        const h = rng.float(15, 27);
        (rng.chance(0.6) ? far.conifer : far.broadleaf).push({ x, y: this.heightAt(x, z), z, h, w: rng.float(0.8, 1.25), rot: rng.float(0, Math.PI * 2) });
      },
    });
    this.treesPlaced = placedTrees;

    const woodMesh = new THREE.Mesh(mergeGeometries(wood), this.barkMaterial);
    woodMesh.castShadow = woodMesh.receiveShadow = true;
    woodMesh.layers.enable(REFLECT);
    wood.forEach((g) => g.dispose());
    this.scene.add(woodMesh);

    const leafTex = leafClusterTexture({ seed: 4 });
    const leafMat = applyWind(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.82 }), { sway: 0.06, flutter: 0.02, leafNormals: true });
    const leafDepth = windDepthMaterial(leafTex, 0.5, { sway: 0.06, flutter: 0.02 });
    this.disposables.push(leafDepth);
    const leaves = cardsToInstances(leafCards, cardGeometry(), leafMat, { colorFor: (c, i, col) => col.setRGB(rng.float(0.72, 1.0), rng.float(0.8, 1.04), rng.float(0.62, 0.86)), depthMaterial: leafDepth });
    leaves.layers.enable(REFLECT);
    this.scene.add(leaves);

    const needleTex = needleSprayTexture();
    const needleMat = applyWind(new THREE.MeshStandardMaterial({ map: needleTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 }), { sway: 0.04, flutter: 0.01, leafNormals: true });
    const needleDepth = windDepthMaterial(needleTex, 0.5, { sway: 0.04, flutter: 0.01 });
    this.disposables.push(needleDepth);
    const needles = cardsToInstances(needleCards, cardGeometry({ anchored: true, aspect: 0.5 }), needleMat, { colorFor: (c, i, col) => col.setRGB(rng.float(0.8, 1.05), rng.float(0.88, 1.08), rng.float(0.85, 1.05)), depthMaterial: needleDepth });
    needles.layers.enable(REFLECT);
    this.scene.add(needles);

    const sil = silhouetteGeometries(rng);
    const silMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const [kind, list] of Object.entries(far)) {
      const items = list.map((t) => ({
        position: new THREE.Vector3(t.x, t.y - 0.3, t.z),
        rotationY: t.rot,
        scale: new THREE.Vector3(t.h * t.w, t.h, t.h * t.w),
        color: new THREE.Color().setRGB(0.08, 0.1, 0.09).multiplyScalar(rng.float(0.75, 1.25)),
      }));
      const mesh = scatter(sil[kind], silMat, items, { receiveShadow: false });
      mesh.layers.enable(REFLECT);
      this.scene.add(mesh);
    }
  }

  #buildMist() {
    const rng = new Rng(56);
    const sheets = [];
    for (let i = 0; i < (LOW ? 14 : 24); i++) {
      const a = rng.float(-2.6, -0.5);
      const r = rng.float(20, 70);
      const x = 2 + Math.cos(a) * r;
      const z = -5 + Math.sin(a) * r;
      sheets.push({ x, y: this.heightAt(x, z) + rng.float(-0.2, 0.6), z, width: r * rng.float(0.45, 0.8), height: rng.float(2.2, 4.5) * (0.7 + r / 120) });
    }
    this.mist = createMist(sheets);
    this.scene.add(this.mist.mesh);
  }

  #buildGroundCover() {
    const rng = new Rng(98);
    const homeCam = this.views.home.position;
    const grassMat = applyWind(new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1 }), { sway: 0.05, flutter: 0.012 });
    const tufts = [];
    for (let i = 0; tufts.length < (LOW ? 1600 : 3600) && i < 26000; i++) {
      const x = rng.float(-12, 15);
      const z = rng.float(-16, 7);
      const g = this.#grassAt(x, z);
      if (rng.next() > g * 0.92) continue;
      if (Math.hypot(x - homeCam.x, z - homeCam.z) < 1.6) continue;
      if (this.#puddleDist(x, z) < 1.4 || this.#inGarden(x, z, 0.15)) continue;
      // Short around the puddle, the book and the rock so nothing hides them.
      const near = Math.min(Math.hypot(x - LAYOUT.rock.x, z - LAYOUT.rock.z), Math.hypot(x - LAYOUT.book.x, z - LAYOUT.book.z), this.#puddleDist(x, z) * 0.7);
      const s = rng.float(0.2, 0.44) * (0.75 + g * 0.35) * (0.45 + 0.55 * smoothstep(0.6, 2.4, near));
      tufts.push({ position: new THREE.Vector3(x, this.heightAt(x, z) - 0.02, z), rotationY: rng.float(0, Math.PI * 2), scale: new THREE.Vector3(s * rng.float(0.9, 1.4), s, s * rng.float(0.9, 1.4)), color: new THREE.Color(rng.float(0.74, 1.0), rng.float(0.82, 1.02), rng.float(0.66, 0.86)) });
    }
    this.scene.add(scatter(grassTuftGeometry(), grassMat, tufts));

    const fernMat = applyWind(new THREE.MeshStandardMaterial({ map: fernTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9 }), { sway: 0.05, flutter: 0.015 });
    const ferns = [];
    for (let i = 0; ferns.length < (LOW ? 120 : 220) && i < 5000; i++) {
      const t = rng.pick(this.treesPlaced);
      const x = t.x + rng.gauss() * 1.8;
      const z = t.z + rng.gauss() * 1.8;
      if (this.#fromBuildings(x, z) < 2 || z > -2 || this.#inGarden(x, z, 1)) continue;
      ferns.push({ position: new THREE.Vector3(x, this.heightAt(x, z) - 0.03, z), rotationY: rng.float(0, 6.3), scale: rng.float(0.55, 1.05), color: new THREE.Color(rng.float(0.75, 1), rng.float(0.82, 1), rng.float(0.65, 0.85)) });
    }
    this.scene.add(scatter(fernGeometry(), fernMat, ferns));

    const leafMat = new THREE.MeshStandardMaterial({ map: singleLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const browns = ['#7a5a36', '#8c6a3c', '#6b5132', '#9a7a46', '#5e4630'].map((h) => new THREE.Color(h));
    const fallen = [];
    for (let i = 0; fallen.length < (LOW ? 300 : 700) && i < 9000; i++) {
      const t = rng.pick(this.treesPlaced);
      const x = t.x + rng.gauss() * 3;
      const z = t.z + rng.gauss() * 3;
      if (this.#fromBuildings(x, z) < 0.3) continue;
      fallen.push({ position: new THREE.Vector3(x, this.heightAt(x, z) + 0.012, z), rotationY: rng.float(0, 6.3), tiltX: rng.float(-0.25, 0.25), scale: rng.float(0.08, 0.13), color: rng.pick(browns).clone().multiplyScalar(rng.float(0.8, 1.15)) });
    }
    this.scene.add(scatter(flatLeafGeometry(), leafMat, fallen));

    // Stones: along the path, around the puddle and scattered in the grass.
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const geos = [0, 1, 2].map(() => rockGeometry(rng, { moss: rng.float(0.3, 0.6) }));
    const groups = [[], [], []];
    const stone = (x, z, s, sink = 0.35) => groups[rng.int(0, 2)].push({ position: new THREE.Vector3(x, this.heightAt(x, z) - s * sink, z), rotationY: rng.float(0, 6.3), tiltX: rng.float(-0.2, 0.2), scale: new THREE.Vector3(s * rng.float(0.9, 1.4), s, s * rng.float(0.9, 1.3)), color: new THREE.Color().setScalar(rng.float(0.6, 0.95)) });
    for (let s = 1; s < 40; s += rng.float(0.6, 1.6)) {
      const q = this.path.at(s);
      const side = rng.chance(0.5) ? 1 : -1;
      const off = q.w / 2 + rng.float(0, 0.35);
      stone(q.x - q.tz * off * side, q.z + q.tx * off * side, rng.float(0.06, 0.16));
    }
    const P = LAYOUT.puddle;
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(1.05, 1.35);
      stone(P.x + Math.cos(a) * P.rx * r, P.z + Math.sin(a) * P.rz * r, rng.float(0.04, 0.09), 0.45);
    }
    for (let i = 0; i < (LOW ? 30 : 60); i++) {
      const x = rng.float(-10, 12);
      const z = rng.float(-14, 6);
      if (this.#fromBuildings(x, z) < 0.6 || this.#inGarden(x, z, 0.3) || this.#puddleDist(x, z) < 1.5) continue;
      stone(x, z, rng.float(0.05, 0.14));
    }
    groups.forEach((items, i) => this.scene.add(scatter(geos[i], rockMat, items, { castShadow: true })));
  }

  // ─── Interactables ──────────────────────────────────────────────────────────

  #buildWindowTarget() {
    const W = COTTAGE.window;
    const group = new THREE.Group();
    group.add(this.windowFrame);
    // Over the whole opening until the window has been viewed; afterwards only the frame
    // area, so clicks reach the table behind it.
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(W.x1 - W.x0 + 0.1, W.y1 - W.y0 + 0.1), new THREE.MeshBasicMaterial({ visible: false }));
    opening.position.copy(this.windowCenter).setZ(COTTAGE.z1 + 0.06);
    group.add(opening);
    const rim = [];
    const t = 0.22;
    const cx = (W.x0 + W.x1) / 2;
    const cy = (W.y0 + W.y1) / 2;
    rim.push(placed(new THREE.PlaneGeometry(W.x1 - W.x0 + 2 * t, t), [cx, W.y1 + t / 2, 0]), placed(new THREE.PlaneGeometry(W.x1 - W.x0 + 2 * t, t), [cx, W.y0 - t / 2, 0]));
    rim.push(placed(new THREE.PlaneGeometry(t, W.y1 - W.y0), [W.x0 - t / 2, cy, 0]), placed(new THREE.PlaneGeometry(t, W.y1 - W.y0), [W.x1 + t / 2, cy, 0]));
    const frameHit = new THREE.Mesh(merge(rim), new THREE.MeshBasicMaterial({ visible: false }));
    frameHit.position.z = COTTAGE.z1 + 0.08;
    group.add(frameHit);
    this.openingHit = opening;
    group.userData.lookPoint = this.tableCenter.clone().add(new THREE.Vector3(0, 0.3, 0));
    this.scene.add(group);
    this.registerInteractable(IDS.window, group);
  }

  #buildTableTarget() {
    const T = LAYOUT.table;
    const group = new THREE.Group();
    const hit = new THREE.Mesh(new THREE.BoxGeometry(T.w + 0.2, 0.5, T.d + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(T.x, T.h + 0.15, T.z);
    group.add(hit);
    group.userData.lookPoint = this.tableCenter;
    this.scene.add(group);
    this.registerInteractable(IDS.table, group);
  }

  #buildPuddle() {
    const P = LAYOUT.puddle;
    // An irregular outline: a disc whose radius wanders.
    const shape = new THREE.Shape();
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.85 + 0.3 * fbm2(Math.cos(a) * 1.3 + 4, Math.sin(a) * 1.3, 2, 19);
      const x = Math.cos(a) * P.rx * k;
      const y = Math.sin(a) * P.rz * k;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
    geo.translate(P.x, P.level, P.z);
    this.mirror = new PlanarReflection({ level: P.level, layer: REFLECT, scale: LOW ? 0.35 : 0.5 });
    this.puddleUniforms = {
      tReflection: { value: this.mirror.texture },
      uTextureMatrix: { value: this.mirror.textureMatrix },
      uTime: { value: 0 },
      uMud: { value: new THREE.Color('#1d1710') },
      uLight: { value: 1 },
      uHighlight: { value: 0 },
      uCenter: { value: new THREE.Vector2(P.x, P.z) },
      uRadius: { value: new THREE.Vector2(P.rx, P.rz) },
      uRipple: { value: new THREE.Vector4(0, 0, -100, 0) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: PUDDLE_VERTEX,
      fragmentShader: PUDDLE_FRAGMENT,
      fog: true,
      transparent: true,
      depthWrite: false,
    });
    Object.assign(material.uniforms, this.puddleUniforms, DRAIN);
    const water = new THREE.Mesh(geo, material);
    water.renderOrder = 1;
    const group = new THREE.Group();
    group.add(water);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 24).scale(P.rx + 0.25, 1, P.rz + 0.25), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(P.x, 0.03, P.z);
    group.add(hit);
    group.userData.lookPoint = this.puddleCenter;
    this.puddleMesh = water;
    this.scene.add(group);
    this.registerInteractable(IDS.puddle, group);
  }

  #buildBook() {
    const B = LAYOUT.book;
    const group = new THREE.Group();
    group.position.set(B.x, this.heightAt(B.x, B.z) + 0.012, B.z);
    group.rotation.set(0.05, B.rotationY, -0.04);
    const cover = new THREE.MeshStandardMaterial({ color: '#5a2e1e', roughness: 0.7 });
    const pages = pageTexture();
    this.disposables.push(pages);
    this.bookPageMat = new THREE.MeshStandardMaterial({ map: pages, roughness: 0.85, emissive: new THREE.Color('#ffe2b0'), emissiveIntensity: 0 });
    const w = 0.17;
    const d = 0.24;
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(box(w + 0.01, 0.012, d + 0.015), cover);
      c.position.set(side * (w / 2 + 0.004), 0.006, 0);
      c.rotation.z = side * 0.08;
      c.castShadow = true;
      group.add(c);
      const block = new THREE.Mesh(box(w - 0.01, 0.022, d - 0.01), new THREE.MeshStandardMaterial({ color: '#d9ccae', roughness: 0.9 }));
      block.position.set(side * (w / 2), 0.022, 0);
      block.rotation.z = side * 0.08;
      group.add(block);
    }
    // The open pages, curving up from the spine.
    const pg = new THREE.PlaneGeometry(2 * w, d, 16, 1).rotateX(-Math.PI / 2);
    const pos = pg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const u = Math.abs(x) / w;
      pos.setY(i, 0.036 + Math.sin(u * Math.PI * 0.85) * 0.022 - (1 - u) * 0.01);
    }
    pg.computeVertexNormals();
    const page = new THREE.Mesh(pg, this.bookPageMat);
    page.receiveShadow = true;
    group.add(page);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.25, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.08;
    group.add(hit);
    group.userData.lookPoint = group.position.clone().add(new THREE.Vector3(0, 0.05, 0));
    group.traverse((o) => o.isMesh && o.layers.enable(REFLECT));
    this.scene.add(group);
    this.registerInteractable(IDS.book, group);
  }

  #buildRock() {
    const R = LAYOUT.rock;
    const rng = new Rng(14);
    let g = new THREE.IcosahedronGeometry(1, LOW ? 4 : 5);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = fbm2(v.x * 1.1 + 3, v.z * 1.1 + v.y * 0.8, 4, 41);
      const fine = fbm2(v.x * 5 + v.y * 3, v.z * 5 - v.y * 2, 3, 43);
      const grain = fbm2(v.x * 16 - v.y * 5, v.z * 16 + v.y * 7, 2, 47);
      v.multiplyScalar(0.72 + n * 0.58 + fine * 0.12 + grain * 0.035);
      v.y = v.y < -0.1 ? -0.1 + (v.y + 0.1) * 0.25 : v.y * 0.68;
      pos.setXYZ(i, v.x * 0.66, v.y * 0.66, v.z * 0.52);
    }
    g.computeVertexNormals();
    // Tone and moss in vertex colours; the lichen itself comes from a texture mapped
    // triplanar (the stone has no UVs), so the rosettes stay crisp on every face.
    const normal = g.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const moss = new THREE.Color('#56653a');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      c.setScalar(0.85 + 0.3 * fbm2(v.x * 3, v.z * 3 + v.y * 2, 2, 51));
      c.lerp(moss, smoothstep(0.0, -0.1, v.y) * 0.75 + smoothstep(0.75, 0.95, normal.getY(i)) * 0.15);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const lichen = lichenRockTexture({ size: LOW ? 512 : 1024 });
    this.disposables.push(lichen);
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: new THREE.Color('#c9d6b0'), emissiveIntensity: 0 });
    this.rockMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLichen = { value: lichen };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position;\nvTriNormal = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uLichen;\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
        .replace(
          '#include <map_fragment>',
          `vec3 triW = pow(abs(normalize(vTriNormal)), vec3(4.0));
triW /= triW.x + triW.y + triW.z;
vec3 tp = vTriPos * 1.15;
vec4 lichenTex = texture2D(uLichen, tp.zy) * triW.x + texture2D(uLichen, tp.xz + 0.37) * triW.y + texture2D(uLichen, tp.xy + 0.71) * triW.z;
diffuseColor.rgb *= lichenTex.rgb;`,
        );
    };
    this.rockMat.customProgramCacheKey = () => 'lichen-rock';
    const rock = new THREE.Mesh(g, this.rockMat);
    rock.scale.set(1, 1, 1);
    rock.position.set(R.x, this.heightAt(R.x, R.z) + 0.02, R.z);
    rock.rotation.y = rng.float(0, Math.PI * 2);
    rock.castShadow = rock.receiveShadow = true;
    rock.layers.enable(REFLECT);
    const group = new THREE.Group();
    group.add(rock);
    group.userData.lookPoint = rock.position.clone().add(new THREE.Vector3(0, 0.35, 0));
    this.rockMesh = rock;
    this.scene.add(group);
    this.registerInteractable(IDS.rock, group);
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  styleInteractable(object, state, t) {
    const id = object.userData.pickId;
    const hovered = state.hovered && state.active;
    const pulse = (speed) => 0.5 + 0.5 * Math.sin(t * speed);
    if (id === IDS.window) {
      this.windowFrameMat.emissiveIntensity = hovered ? 0.5 : state.pending ? 0.08 + 0.1 * pulse(2.2) : 0;
      this.openingHit.layers.set(state.viewed ? 31 : 0);
    } else if (id === IDS.table) {
      this.tableMat.emissiveIntensity = hovered ? 0.22 : state.pending ? 0.05 * pulse(2) : 0;
    } else if (id === IDS.puddle) {
      this.puddleUniforms.uHighlight.value = hovered ? 0.5 : state.pending ? 0.12 * pulse(1.6) : 0;
    } else if (id === IDS.book) {
      this.bookPageMat.emissiveIntensity = hovered ? 0.35 : state.pending ? 0.08 * pulse(2) : 0;
    } else if (id === IDS.rock) {
      this.rockMat.emissiveIntensity = hovered ? 0.16 : state.pending ? 0.04 * pulse(1.8) : 0;
    }
  }

  async prepareQuote(quote) {
    const id = quote.objectId;
    const first = ORDER[this.step] === id && !this.tracker.isViewed(quote);
    const moves = [this.flyTo(VIEW_FOR[id], first ? 1.8 : 1.4)];
    if (first) moves.push((this.sequence = this.#before(id)));
    await Promise.all(moves);
    if (first && !REDUCED_MOTION) await wait(0.6); // a moment to see it before the menu opens
  }

  onQuoteClosed(quote, { viewed }) {
    const id = quote.objectId;
    if (ORDER[this.step] !== id) return;
    if (!viewed) {
      this.#undo(id);
      return;
    }
    this.step++;
    if (id !== IDS.window) this.sequence = this.#runAfter(id); // after the window he stays at the chink
  }

  onComplete() {
    // Dev "Complete scene" (no menu closes after it): once any action has finished, jump
    // to the end. In the normal flow onQuoteClosed has advanced the step by then.
    Promise.resolve().then(() => {
      if (this.step >= ORDER.length) return;
      this.step = ORDER.length;
      this.sequence.then(() => !this.disposed && this.#placeAtEnd());
    });
  }

  onDispose() {
    for (const d of this.disposables) d.dispose();
    this.mirror?.dispose();
  }

  // ─── The Monster's sequence ─────────────────────────────────────────────────

  #before(id) {
    if (id === IDS.window) return this.#edgeCloser();
    if (id === IDS.table) return this.#trySpeaking();
    if (id === IDS.puddle) return this.#examineFace();
    if (id === IDS.book) return this.#turnToBook();
    if (id === IDS.rock) return this.#touchLichen();
    return Promise.resolve();
  }

  async #runAfter(id) {
    this.setInteractive(false);
    if (id === IDS.table) await this.#drawBack();
    else if (id === IDS.puddle) await this.#sitBack();
    else if (id === IDS.book) await this.#moveToRock();
    else if (id === IDS.rock) await this.#sinkDown();
    if (this.disposed || this.leaving) return;
    this.setInteractive(true);
  }

  /** A menu closed before its impact page: settle back to where the action began. */
  #undo(id) {
    if (id === IDS.table) {
      this.monster.setMouthing(false);
      this.monster.reachTowards(null);
      this.monster.setPose(POSE.peer, { rate: 2 });
    } else if (id === IDS.book || id === IDS.rock) {
      this.monster.reachTowards(null);
    }
  }

  /** Slides the Monster along the ground (shuffling on his knees, or settling). */
  #slide(spot, duration) {
    const p = this.monster.object.position;
    const from = p.clone();
    return tween({
      duration: REDUCED_MOTION ? 0.01 : duration,
      ease: Ease.inOutSine,
      onUpdate: (e, raw) => {
        p.x = from.x + (spot.x - from.x) * e;
        p.z = from.z + (spot.z - from.z) * e;
        p.y = Math.abs(Math.sin(raw * Math.PI * 3)) * 0.02;
      },
    });
  }

  #face(yaw, rate = 2.5) {
    this.monster.facing = yaw;
    this.monster.turnRate = rate;
  }

  #pause(s) {
    return wait(REDUCED_MOTION ? Math.min(s, 0.2) : s);
  }

  async #edgeCloser() {
    const M = this.monster;
    M.lookAt(this.chinkPoint.clone().add(new THREE.Vector3(1.5, -0.3, -0.5)));
    M.setPose(POSE.kneel, { rate: 2.4 });
    await this.#pause(0.7);
    await this.#slide(SPOTS.peer, 1.5);
    M.setPose(POSE.peer, { rate: 2.2 });
    M.lookAt(this.tableCenter.clone().add(new THREE.Vector3(0, 0.45, -0.4)));
    await this.#pause(0.6);
  }

  async #trySpeaking() {
    const M = this.monster;
    M.setPose(POSE.speak, { rate: 2.6 });
    M.reachTowards(this.chinkPoint.clone().add(new THREE.Vector3(-0.03, -0.08, 0.24)), 'R'); // palm on the wall beside the chink
    await this.#pause(0.6);
    M.setMouthing(true);
    await this.#pause(1.8);
  }

  async #drawBack() {
    const M = this.monster;
    M.setMouthing(false);
    M.reachTowards(null);
    M.setPose(POSE.recoil, { rate: 3 });
    M.lookAt(null);
    await this.#pause(1.1);
    this.flyTo('home', 2.8);
    M.setPose(POSE.kneel, { rate: 2.5 });
    await this.#slide(SPOTS.back, 0.9);
    this.#face(0, 2);
    await this.#pause(0.9);
    M.setPose(POSE.stoop, { weight: 0.92, rate: 2.2 });
    await this.#pause(0.8);
    await M.walkTo(SPOTS.out, 0.42);
    M.setPose('stand', { rate: 1.6 });
    await M.walkTo(SPOTS.puddle, 0.6);
    this.#face(SPOTS.puddle.yaw);
    M.lookAt(this.puddleCenter);
    M.setPose(POSE.look, { rate: 1.5 });
    this.nearLight.target = 1;
    await this.#pause(1.8);
  }

  async #examineFace() {
    const M = this.monster;
    M.setPose(POSE.examine, { rate: 1.6 });
    M.lookAt(this.puddleCenter.clone().add(new THREE.Vector3(0, 0, -0.25)));
    await this.#pause(2.0);
  }

  async #sitBack() {
    const M = this.monster;
    this.flyTo('cluster', 2.4);
    M.setPose(POSE.sitBack, { rate: 1.3 });
    M.lookAt(this.puddleCenter.clone().add(new THREE.Vector3(0, 0, 0.5)));
    await this.#pause(2.2);
  }

  async #turnToBook() {
    const M = this.monster;
    const book = this.interactables.get(IDS.book).userData.lookPoint;
    this.#face(Math.atan2(book.x - M.object.position.x, book.z - M.object.position.z), 1.6);
    M.lookAt(book);
    M.setPose(POSE.reachDown, { rate: 1.6 });
    await this.#pause(1.0);
    M.reachTowards(book.clone().add(new THREE.Vector3(0, 0.02, 0)), 'R');
    await this.#pause(1.2);
  }

  async #moveToRock() {
    const M = this.monster;
    M.reachTowards(null);
    this.nearLight.target = 0;
    M.setPose('stand', { rate: 1.6 });
    await this.#pause(1.0);
    await M.walkTo(SPOTS.standRock, 0.55);
    this.#face(SPOTS.rock.yaw, 2);
    await this.#pause(0.6);
    M.setPose(POSE.slump, { rate: 1.2 });
    this.#slide(SPOTS.rock, 1.6);
    M.lookAt(this.interactables.get(IDS.book).userData.lookPoint);
    await this.#pause(2.2);
  }

  async #touchLichen() {
    const M = this.monster;
    const rock = this.rockMesh.position;
    const p = M.object.position;
    // The point on the rock's side nearest his right hand.
    const touch = new THREE.Vector3(rock.x + (p.x - rock.x) * 0.45, 0.42, rock.z + (p.z - rock.z) * 0.45 + 0.25);
    M.lookAt(touch);
    M.reachTowards(touch, 'R');
    await this.#pause(1.8);
  }

  async #sinkDown() {
    const M = this.monster;
    M.reachTowards(null);
    M.setPose(POSE.slumpLow, { rate: 0.8 });
    M.lookAt(_v.copy(M.object.position).add(new THREE.Vector3(0.6, 0, 0.6)));
    await this.flyTo('end', 3);
  }

  /** Dev shortcut and safety net: the Monster as he ends the scene. */
  #placeAtEnd() {
    const M = this.monster;
    M.setMouthing(false);
    M.reachTowards(null);
    M.move?.resolve();
    M.move = null;
    M.setAnimation('idle');
    M.object.position.set(SPOTS.rock.x, 0, SPOTS.rock.z);
    M.object.rotation.y = SPOTS.rock.yaw;
    this.#face(SPOTS.rock.yaw);
    M.setPose(POSE.slumpLow, { immediate: true });
    M.lookAt(_v.copy(M.object.position).add(new THREE.Vector3(0.6, 0, 0.6)));
    this.nearLight.target = 0;
    this.flyTo('end', 2);
  }

  // ─── Per frame ──────────────────────────────────────────────────────────────

  onUpdate(dt, t) {
    WIND.uTime.value = t;
    this.cloudOffset.x += dt * 0.004;
    this.cloudOffset.y += dt * 0.0015;
    const S = this.sky.update(this.dayTime, { dayTop: visualParams.skyTop, dayHorizon: visualParams.skyHorizon, time: t, cloudOffset: this.cloudOffset, center: this.camera.position });
    this.scene.fog.color.copy(S.fogColor);
    const L = visualParams.lightIntensity;
    const truth = nihilism.displayed.truth;

    // Light around the Monster fades with Truth (the drain below does the rest).
    for (const name of ['fill', 'near']) {
      const b = this.lightBindings[name];
      b.base = LIGHT[name] * (1 - 0.35 * truth) * (name === 'near' ? 1 - 0.7 * NL.at : 1);
      b.target.intensity = b.base * L;
    }
    const NL = this.nearLight;
    NL.at += (NL.target - NL.at) * (1 - Math.exp(-dt * 1.5));
    this.lights.near.position.lerpVectors(NEAR_LIGHT.high, NEAR_LIGHT.water, NL.at);
    DRAIN.uDrain.value = truth;
    DRAIN.uDrainCenter.value.copy(this.monster.object.position);
    INTERIOR.uKeepSaturation.value = this.keepSaturation / Math.max(0.05, visualParams.saturation);

    // Fire and candle flicker; the beam through the chink flickers with the hearth.
    const f = 0.84 + 0.08 * Math.sin(t * 8.3) + 0.05 * Math.sin(t * 21.1 + 1.3) + 0.04 * Math.sin(t * 13.7 + 0.4);
    const { hearth, candle, beam } = this.interiorLights;
    hearth.intensity = 12 * f;
    candle.intensity = 2 * (0.92 + 0.05 * Math.sin(t * 11.3) + 0.03 * Math.sin(t * 27.1));
    beam.intensity = 7 * (0.85 + 0.15 * f);
    hearth.shadow.needsUpdate = ++this.frame % 3 === 0; // the room barely moves: a third of the frames is enough
    this.flames.uniforms.uTime.value = t;
    this.candleFlame.uniforms.uTime.value = t;
    this.smoke.uniforms.uTime.value = t;
    this.smoke.uniforms.uColor.value.copy(S.fogColor).multiplyScalar(1.6 * L + 0.2);
    this.mist.uniforms.uColor.value.copy(S.mistColor).multiplyScalar(0.35 * L);
    this.mist.uniforms.uOpacity.value = 0.22;
    this.mist.uniforms.uTime.value = t;

    this.#updateFamily(dt);

    // The puddle: reflection (only when it is on screen) and its surface.
    const U = this.puddleUniforms;
    U.uTime.value = t;
    U.uLight.value = L;
    if (this.#puddleOnScreen()) this.mirror.update(this.renderer, this.scene, this.camera);
  }

  #puddleOnScreen() {
    const P = LAYOUT.puddle;
    this.camera.updateMatrixWorld();
    _v.set(P.x, P.level, P.z).project(this.camera);
    return _v.z < 1 && Math.abs(_v.x) < 1.4 && Math.abs(_v.y) < 1.4;
  }

  /** The family talks: one speaks to another, the others listen and now and then nod. */
  #updateFamily(dt) {
    const F = this.family;
    const T = this.talk;
    T.timer -= dt;
    if (T.timer <= 0) {
      const next = (T.speaker + 1 + this.rng.int(0, F.length - 2)) % F.length;
      T.speaker = next;
      T.audience = (next + 1 + this.rng.int(0, F.length - 2)) % F.length;
      F.forEach((p, i) => p.setTalking(i === next));
      T.timer = this.rng.float(2.6, 5.4);
    }
    F.forEach((p, i) => {
      const other = i === T.speaker ? T.audience : T.speaker;
      p.lookAt(F[other].joints.head.getWorldPosition(_w).add(_v.set(0, 0.1, 0)));
      if (i !== T.speaker && this.rng.chance(dt * 0.22)) p.nod();
      p.update(dt);
    });
  }
}

// ─── Small props ─────────────────────────────────────────────────────────────

/** Adds a flat vertex colour so a plain geometry can merge with tinted ones (bark tubes). */
function withColor(geometry, v = 1) {
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(v), 3));
  return geometry;
}

function bowlGeometry(r) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * r), (1 - Math.cos(a)) * r * 0.6));
  }
  return new THREE.LatheGeometry(pts, 14);
}

function jugGeometry(s = 1) {
  const profile = [[0.001, 0], [0.05, 0], [0.065, 0.04], [0.07, 0.09], [0.055, 0.15], [0.035, 0.18], [0.04, 0.21]];
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x * s, y * s)), 14);
}

// ─── Puddle shader ───────────────────────────────────────────────────────────

const PUDDLE_VERTEX = /* glsl */ `
uniform mat4 uTextureMatrix;
varying vec4 vReflect;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vReflect = uTextureMatrix * world;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PUDDLE_FRAGMENT = /* glsl */ `
uniform sampler2D tReflection;
uniform float uTime;
uniform vec3 uMud;
uniform float uLight;
uniform float uHighlight;
uniform vec2 uCenter;
uniform vec2 uRadius;
uniform float uDrain;
uniform vec3 uDrainCenter;
uniform vec2 uDrainRadius;
uniform float uDrainDesaturate;
uniform float uDrainDarken;
varying vec4 vReflect;
varying vec3 vWorld;
#include <fog_pars_fragment>
${NATURE_NOISE}
void main() {
  vec2 p = vWorld.xz;
  // A breath of wind across the surface.
  vec2 wobble = vec2(vnoise(p * 7.0 + uTime * 0.35) - 0.5, vnoise(p * 7.0 + 5.3 - uTime * 0.3) - 0.5) * 0.006;
  vec4 uv = vReflect;
  uv.xy += wobble * uv.w;
  vec3 refl = texture2DProj(tReflection, uv).rgb;

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.04 + 0.96 * pow(1.0 - max(V.y, 0.0), 5.0);
  // Muddy water is dark, so the reflection reads strongly even when looking down into it.
  float k = mix(0.62, 1.0, fres);
  vec3 col = mix(uMud * uLight, refl, k);
  col *= 1.0 + uHighlight * 0.6;

  // Soft, muddy edge.
  float e = length((p - uCenter) / uRadius);
  float edge = 1.0 - smoothstep(0.7, 1.05, e);

  float drainK = uDrain * (1.0 - smoothstep(uDrainRadius.x, uDrainRadius.y, distance(p, uDrainCenter.xz)));
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(luma), drainK * uDrainDesaturate) * (1.0 - drainK * uDrainDarken);

  gl_FragColor = vec4(col, edge);
  #include <fog_fragment>
}`;
