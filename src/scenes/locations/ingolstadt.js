import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { el } from '../../ui/dom.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { tween, wait, Ease } from '../../core/tween.js';
import { visualParams } from '../../nihilism/nihilism.js';
import { DaySky } from '../nature/sky.js';
import { Stream } from '../nature/water.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { WIND, applyWind, windDepthMaterial } from '../nature/wind.js';
import { leafClusterTexture, singleLeafTexture, needleSprayTexture, grassTexture, fernTexture, barkTextures, groundTextures } from '../nature/textures.js';
import { broadleafTree, coniferTree, silhouetteGeometries, cardsToInstances, cardGeometry, taperedTube, mergeGeometries } from '../nature/trees.js';
import { createGround, grassTuftGeometry, fernGeometry, flatLeafGeometry, twigGeometry, rockGeometry, scatter } from '../nature/ground.js';
import { createMist } from '../nature/mist.js';
import { Bird } from '../nature/birds.js';
import { composePhrase, playPhrase, voiceFor } from '../nature/birdsong.js';

/**
 * Ingolstadt — scene 1 (data: public/json/scenes/ingolstadt.json).
 *
 * Built to the students' brief: a small forest clearing outside Ingolstadt with only the
 * Monster in it, seated beneath a tree. Several layers of trees surround the clearing
 * (detailed trunks near, darker simplified silhouettes far, with gaps between them), thin
 * mist lies between the distant trees, and a narrow stream leads from the foreground into
 * the distance. The canopy opens above and slightly right of the Monster and frames the moon.
 *
 * TIME OF DAY runs in phases (see TIME):
 *   night    the clock holds at night, the moon in the opening; clouds, leaves and water move
 *   passing  when the moon's menu closes, nights and days pass quickly
 *   morning  the clock settles on soft morning light and birds fly to the branch
 *   free     once the scene is complete the day/night cycle runs on continuously
 *
 * COMPONENTS (objectIds in the JSON):
 *   ingolstadt-moon     the moon, clickable while it is up
 *   ingolstadt-branch   the low branch; enabled once the birds have landed on it
 *   ingolstadt-stream   the stream
 *   ingolstadt-berries  the berry bush
 * Labels come from each entry's "label". Optional components get quieter labels and
 * highlights than required ones.
 */

const IDS = {
  moon: 'ingolstadt-moon',
  branch: 'ingolstadt-branch',
  stream: 'ingolstadt-stream',
  berries: 'ingolstadt-berries',
};

/** Time of day in days (0.5 = noon, 0.875 = 21:00). */
const TIME = {
  night: 21.2 / 24, // the moon sits in the canopy opening
  morning: 7.25 / 24, // soft, low morning sun for the birds
  passingDays: 2, // whole days that pass after the moon
  passingSeconds: 10,
  freeDaySeconds: 160, // once complete, one full day/night cycle takes this long
};

const SKY = {
  latitude: 48.77, // Ingolstadt
  declination: 8, // sun's declination (spring); the full moon takes the opposite
  moonOffsetDeg: 5, // the moon sits this far right of the camera's view direction
  openingDeg: 10, // half-angle of the clear canopy opening around the moon
  sunGapDeg: 7, // half-angle of the gap that lets the morning sun reach the clearing
};

const LAYOUT = {
  camera: { position: [-0.2, 1.3, 6.0], target: [-0.55, 3.0, -3.0], fov: 56 },
  clearing: { x: 0.9, z: -1.4, rx: 9.5, rz: 8.6 },
  monster: { x: -1.4, z: -0.25, rotationY: 0.4 },
  tree: { x: -1.72, z: -0.98, height: 19, radius: 0.52 },
  branch: [
    [-1.8, 2.02, -1.12], // starts inside the trunk
    [-1.05, 1.93, -0.52],
    [-0.45, 1.8, -0.22],
    [0.15, 1.84, -0.02],
    [0.7, 1.97, 0.1],
    [1.15, 2.16, 0.14],
  ],
  perches: [0.55, 0.68, 0.82],
  bush: { x: -3.05, z: 0.85 },
  stream: [
    [3.6, 15], [2.7, 8.5], [2.3, 5.0], [2.5, 1.8], [3.3, -1.5], [3.8, -5], [3.2, -9], [2.9, -13.5], [3.6, -19],
    [4.6, -26], [5.0, -34], [5.8, -44], [6.9, -56], [8.2, -70], [9.5, -86], [11, -105], [13, -130], [15, -160],
  ],
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const COOL_FILL = new THREE.Color('#8ea6d4');
const WARM_FILL = new THREE.Color('#f3dcc0');
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();

export default class IngolstadtScene extends BaseScene {
  static cameraHome = { position: LAYOUT.camera.position, target: LAYOUT.camera.target };

  constructor(args) {
    super(args);
    this.camera.fov = LAYOUT.camera.fov;
    this.camera.updateProjectionMatrix();
    this.fitHome(this.camera.aspect);
    this.#configureControls();

    this.phase = 'night';
    this.dayTime = TIME.night;
    this.prevDayTime = this.dayTime;
    this.cloudOffset = new THREE.Vector2(3.1, 7.4);
    this.rippleIndex = 0;
    this.nextRipple = 0;
    this.songTimer = 2;
    this.birdsHome = false;
    this.birdsMoving = false;
    this.labelHovered = null;
    this.pois = new Map();
    this.disposables = [];
    this.songRng = new Rng(808);
    this.glance = { timer: 4, away: 0 };
    this.tracker.setEnabled(IDS.branch, false); // until the birds have landed
  }

  // ─── Framing ────────────────────────────────────────────────────────────────

  /** Narrow screens: widen the view so the Monster and the moon both stay in frame. */
  fitHome(aspect) {
    if (this.fitted) return;
    this.fitted = true;
    if (aspect >= 1.2) return;
    // Enough width for the Monster and the moon; the optional objects may need a small orbit to find.
    const half = (aspect < 0.8 ? 19 : 25) * DEG;
    this.camera.fov = Math.min(80, Math.max(LAYOUT.camera.fov, (2 * Math.atan(Math.tan(half) / aspect)) / DEG));
    this.camera.updateProjectionMatrix();
    const k = Math.min(1.12, 1 + (1.2 - aspect) * 0.15);
    this.home.position.sub(this.home.target).multiplyScalar(k).add(this.home.target);
  }

  #configureControls() {
    const s = new THREE.Spherical().setFromVector3(_v.copy(this.home.position).sub(this.home.target));
    Object.assign(this.controls, {
      minDistance: s.radius * 0.72,
      maxDistance: s.radius * 1.15,
      minAzimuthAngle: s.theta - 0.42,
      maxAzimuthAngle: s.theta + 0.42,
      minPolarAngle: s.phi - 0.24,
      maxPolarAngle: s.phi + 0.03,
    });
    // Camera positions the user can orbit to; trees and foliage keep clear of them.
    this.orbitSamples = [];
    for (let i = 0; i <= 6; i++) {
      for (const r of [s.radius * 0.72, s.radius * 1.15]) {
        const p = new THREE.Vector3().setFromSphericalCoords(r, s.phi, s.theta - 0.42 + (0.84 * i) / 6).add(this.home.target);
        this.orbitSamples.push(p);
      }
    }
    this.orbitSamples.push(this.home.position.clone());
  }

  entryPosition(home) {
    return home.clone().add(new THREE.Vector3(0, 30, 0.5));
  }

  exitPosition(from) {
    return from.clone().add(new THREE.Vector3(0, 32, 0));
  }

  // ─── Layout helpers ─────────────────────────────────────────────────────────

  #layout() {
    const cam = this.home.position;
    const tgt = this.home.target;
    this.clearing = LAYOUT.clearing;
    this.stream = new Stream(LAYOUT.stream, {
      widthAt: (s) => THREE.MathUtils.lerp(1.5, 0.7, smoothstep(0, 90, s)),
      level: -0.17,
    });
    this.seat = new THREE.Vector3(LAYOUT.monster.x, 0, LAYOUT.monster.z);
    const fwd = new THREE.Vector3(tgt.x - cam.x, 0, tgt.z - cam.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const a = SKY.moonOffsetDeg * DEG;
    this.forward = fwd;
    this.moonAim = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
    this.branchCurve = new THREE.CatmullRomCurve3(LAYOUT.branch.map((p) => new THREE.Vector3(...p)));
    this.perchCenter = this.branchCurve.getPointAt(0.68);
  }

  /** Elliptical distance from the clearing centre with a ragged edge (1 = the edge). */
  #clearingDist(x, z) {
    const C = this.clearing;
    return Math.hypot((x - C.x) / C.rx, (z - C.z) / C.rz) * (0.88 + 0.28 * fbm2(x * 0.15, z * 0.15, 2, 77));
  }

  /** Ground height without the stream channel (the water surface follows this). */
  baseAt = (x, z) => {
    const C = this.clearing;
    const r = Math.hypot(x - C.x, z - C.z);
    const q = this.stream.nearest(x, z);
    const fromWater = q ? Math.max(0, q.d - q.w / 2) : 99;
    let h = (fbm2(x * 0.09, z * 0.09, 3, 5) - 0.5) * 0.5 * (0.3 + 0.7 * smoothstep(0, 4, fromWater));
    h += smoothstep(16, 70, r) * smoothstep(3, 22, fromWater) * (fbm2(x * 0.018 + 3, z * 0.018 - 2, 4, 9) - 0.3) * 10;
    h *= smoothstep(0.5, 2.4, Math.hypot(x - this.seat.x, z - this.seat.z));
    h *= smoothstep(0.5, 3, Math.hypot(x - this.home.position.x, z - this.home.position.z));
    return h;
  };

  heightAt = (x, z) => {
    const base = this.baseAt(x, z);
    const q = this.stream.nearest(x, z);
    if (!q) return base;
    return base - 0.4 * (1 - smoothstep(q.w / 2 - 0.15, q.w / 2 + 0.75, q.d));
  };

  #grassAt = (x, z) => {
    let g = 1 - smoothstep(0.72, 1.12, this.#clearingDist(x, z));
    const q = this.stream.nearest(x, z);
    if (q) g *= smoothstep(q.w / 2 + 0.25, q.w / 2 + 1.0, q.d);
    return g;
  };

  #tintAt = (x, z, c) => {
    const q = this.stream.nearest(x, z);
    const wet = q ? 1 - smoothstep(q.w / 2, q.w / 2 + 1.1, q.d) : 0;
    const forest = smoothstep(0.9, 1.5, this.#clearingDist(x, z));
    const v = 0.86 + 0.3 * fbm2(x * 0.3 + 11, z * 0.3, 3, 13);
    c.setScalar(v * (1 - 0.18 * forest - 0.4 * wet));
  };

  #inCone(apex, axis, halfAngle, point, radius) {
    const d = _w.copy(point).sub(apex);
    const len = d.length();
    if (len < radius) return true;
    const angle = Math.acos(THREE.MathUtils.clamp(d.dot(axis) / len, -1, 1));
    return angle - Math.asin(Math.min(1, radius / len)) < halfAngle;
  }

  /** Space foliage and limbs must leave clear: the moon opening, the morning-sun gap, the camera's path and the perch. */
  #avoid = (p, radius = 0.5) => {
    if (this.#inCone(this.home.position, this.moonNight, SKY.openingDeg * DEG, p, radius)) return true;
    if (Math.hypot(p.x - this.clearing.x, p.z - this.clearing.z) < 46 && this.#inCone(this.perchCenter, this.sunMorning, SKY.sunGapDeg * DEG, p, radius)) return true;
    if (p.distanceTo(this.perchCenter) < 1.3 + radius) return true;
    if (p.y > 1.6) for (const s of this.orbitSamples) if (Math.hypot(p.x - s.x, p.z - s.z) < 2.6 + radius) return true;
    return false;
  };

  /** Within `gap` m of the ground line from the camera to the Monster. */
  #nearSightline(x, z, gap) {
    const a = this.home.position;
    const b = this.seat;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
    return t < 0.92 && Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < gap * (0.4 + t);
  }

  /** True if a trunk at (x, z) of height h would stand in the moon opening or the sun gap. */
  #trunkBlocks(x, z, h) {
    for (const f of [0.15, 0.4, 0.65, 0.85]) {
      if (this.#avoid(_v.set(x, h * f, z), 0.6)) return true;
    }
    return false;
  }

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.#layout();
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination });
    this.sky.aimMoon(TIME.night, this.moonAim);
    this.moonNight = this.sky.bodiesAt(TIME.night).moon.clone();
    this.sunMorning = this.sky.bodiesAt(TIME.morning).sun.clone();
    this.scene.add(this.sky.mesh);

    this.scene.fog = new THREE.FogExp2(0x223044, 0.02);
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 190 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.04;
    key.target.position.set(this.clearing.x, 0, this.clearing.z);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    const fill = new THREE.DirectionalLight(COOL_FILL, 0.4);
    fill.position.copy(this.home.position).add(new THREE.Vector3(1, 3, 3));
    fill.target.position.copy(this.seat).setY(1);
    this.scene.add(key, key.target, hemi, fill, fill.target);
    this.lights = { key, hemi, fill };
    this.lightBindings = {
      key: { target: key, base: 1 },
      hemi: { target: hemi, base: 1 },
      fill: { target: fill, base: 0.4 },
    };
    this.bindNihilism({
      lights: Object.values(this.lightBindings),
      fogs: [{ fog: this.scene.fog, scale: 0.5, colorFrom: null }],
    });
  }

  buildBackground() {
    const textures = groundTextures({ size: LOW ? 512 : 1024 });
    this.disposables.push(textures.litterMap);
    this.ground = createGround({
      size: 360,
      segments: LOW ? 220 : 320,
      heightAt: this.heightAt,
      grassAt: this.#grassAt,
      tintAt: this.#tintAt,
      textures,
      tile: 3.2,
    });
    this.scene.add(this.ground);

    this.water = this.stream.createWater({ heightAt: this.baseAt, overlap: 0.55 });
    this.scene.add(this.water);

    this.#buildForest();
    this.#buildMist();
  }

  buildForeground() {
    this.#buildGroundCover();
    this.#buildRocks();
  }

  placeMonster(monster) {
    monster.object.position.copy(this.seat);
    monster.object.rotation.y = LAYOUT.monster.rotationY;
    monster.setPose('sit', { immediate: true });
  }

  buildInteractables() {
    this.#buildMoonTarget();
    this.#buildBranchAndBirds();
    this.#buildStreamTarget();
    this.#buildBerryBush();
    for (const id of Object.values(IDS)) if (this.interactables.has(id)) this.#addPoi(id);
  }

  // ─── Forest ─────────────────────────────────────────────────────────────────

  #buildForest() {
    const rng = new Rng(4242);
    const bark = barkTextures();
    this.barkMaterial = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, vertexColors: true, roughness: 0.95 });
    const wood = [];
    const leafCards = [];
    const needleCards = [];
    const placed = [];
    const C = this.clearing;
    const cam = this.home.position;

    const barkTint = () => {
      const grey = rng.chance(0.45); // beech-grey or oak-brown
      const v = rng.float(0.82, 1.05);
      return grey ? new THREE.Color(v, v * 0.98, v * 0.95) : new THREE.Color(v, v * 0.86, v * 0.72);
    };
    const add = (tree) => {
      wood.push(...tree.wood);
      for (const c of tree.cards) (c.kind === 'needle' ? needleCards : leafCards).push(c);
    };

    // The Monster's tree, with low limbs reaching over the clearing into the top of the frame.
    const T = LAYOUT.tree;
    const monsterTree = broadleafTree(new Rng(19), { x: T.x, z: T.z, height: T.height, radius: T.radius, detail: 1, tint: new THREE.Color(0.95, 0.9, 0.84), avoid: this.#avoid, wobble: 0.04 });
    add(monsterTree);
    placed.push({ x: T.x, z: T.z, spacing: 4 });
    for (const [h, a, len] of [[7.2, 0.45, 6.5], [9.5, -0.3, 6]]) {
      add(this.#limb(rng, new THREE.Vector3(T.x, h, T.z), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), len, T.radius * 0.38));
    }

    // A tree on the right of the opening whose long limb arches over the top of it.
    const frameDir = this.moonAim.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, -24 * DEG);
    const fx = cam.x + frameDir.x * 17;
    const fz = cam.z + frameDir.z * 17;
    add(broadleafTree(new Rng(31), { x: fx, z: fz, height: 21, radius: 0.48, detail: 1, tint: barkTint(), avoid: this.#avoid }));
    placed.push({ x: fx, z: fz, spacing: 4.5 });
    const archTarget = this.#aboveOpening(5, 19);
    const archStart = new THREE.Vector3(fx, archTarget.y - 0.6, fz);
    add(this.#limb(rng, archStart, archTarget.clone().sub(archStart).setY(0).normalize(), archStart.distanceTo(archTarget) * 1.15, 0.2, { rise: 1.2 }));

    const ok = (x, z, spacing) => {
      for (const p of placed) if ((p.x - x) ** 2 + (p.z - z) ** 2 < Math.min(spacing, p.spacing) ** 2) return false;
      return true;
    };
    const ring = ({ r0, r1, count, spacing, margin, make, tries = count * 25 }) => {
      let n = 0;
      for (let i = 0; i < tries && n < count; i++) {
        const r = Math.sqrt(rng.float(r0 * r0, r1 * r1));
        const a = rng.float(0, Math.PI * 2);
        const x = C.x + Math.cos(a) * r;
        const z = C.z + Math.sin(a) * r;
        if (this.#clearingDist(x, z) < 1.08) continue;
        const q = this.stream.nearest(x, z);
        if (q && q.d < q.w / 2 + margin) continue;
        if (Math.hypot(x - cam.x, z - cam.z) < 7) continue;
        if (this.orbitSamples.some((s) => Math.hypot(x - s.x, z - s.z) < 4.2)) continue;
        if (!ok(x, z, spacing)) continue;
        if (make(x, z, r) === false) continue;
        placed.push({ x, z, spacing });
        n++;
      }
    };

    // Near and middle layers: individually generated trees.
    const nearOrMid = (detail) => (x, z) => {
      const conifer = rng.chance(detail ? 0.32 : 0.45);
      const height = conifer ? rng.float(19, 29) : rng.float(15, 23);
      if (this.#trunkBlocks(x, z, height * 0.75)) return false;
      const groundY = this.heightAt(x, z);
      const opts = { x, z, height, detail, groundY, tint: barkTint(), avoid: this.#avoid };
      if (conifer) add(coniferTree(rng, { ...opts, radius: rng.float(0.26, 0.42) }));
      else add(broadleafTree(rng, { ...opts, radius: rng.float(0.3, 0.5), cardSize: detail ? [1.5, 2.3] : [2.4, 3.4] }));
    };
    ring({ r0: 9, r1: 24, count: LOW ? 30 : 46, spacing: 4.4, margin: 1.8, make: nearOrMid(1) });
    ring({ r0: 24, r1: 50, count: LOW ? 60 : 110, spacing: 5.6, margin: 2.6, make: nearOrMid(0) });

    // Far layer: dark, simple silhouettes, instanced.
    const far = { conifer: [], broadleaf: [] };
    const openingDeg = SKY.openingDeg * 0.7 * DEG;
    ring({
      r0: 50,
      r1: 180,
      count: LOW ? 480 : 900,
      spacing: 6.5,
      margin: 2,
      make: (x, z) => {
        // Mostly spruce under the moon, so the skyline there is a row of points.
        const towardMoon = Math.atan2(x - cam.x, z - cam.z) - Math.atan2(this.moonAim.x, this.moonAim.z);
        const conifer = rng.chance(Math.abs(Math.atan2(Math.sin(towardMoon), Math.cos(towardMoon))) < 30 * DEG ? 0.9 : 0.5);
        const h = rng.float(15, 27);
        const y = this.heightAt(x, z);
        if (this.#inCone(cam, this.moonNight, openingDeg, _v.set(x, y + h * 0.65, z), h * 0.28)) return false;
        if (this.#inCone(cam, this.moonNight, openingDeg, _v.set(x, y + h * 0.35, z), h * 0.2)) return false;
        (conifer ? far.conifer : far.broadleaf).push({ x, y, z, h, w: rng.float(0.8, 1.25), rot: rng.float(0, Math.PI * 2) });
      },
    });

    // Wood: one merged mesh.
    const woodMesh = new THREE.Mesh(mergeGeometries(wood), this.barkMaterial);
    woodMesh.castShadow = woodMesh.receiveShadow = true;
    wood.forEach((g) => g.dispose());
    this.scene.add(woodMesh);

    // Foliage cards
    const leafTex = leafClusterTexture({ seed: 3 });
    const leafMat = applyWind(
      new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.82 }),
      { sway: 0.07, flutter: 0.025, leafNormals: true },
    );
    const leafDepth = windDepthMaterial(leafTex, 0.5, { sway: 0.07, flutter: 0.025 });
    this.disposables.push(leafDepth);
    const greens = (card, i, c) => c.setRGB(rng.float(0.74, 1.02), rng.float(0.82, 1.05), rng.float(0.62, 0.86));
    this.scene.add(cardsToInstances(leafCards, cardGeometry(), leafMat, { colorFor: greens, depthMaterial: leafDepth }));

    const needleTex = needleSprayTexture();
    const needleMat = applyWind(
      new THREE.MeshStandardMaterial({ map: needleTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 }),
      { sway: 0.05, flutter: 0.01, leafNormals: true },
    );
    const needleDepth = windDepthMaterial(needleTex, 0.5, { sway: 0.05, flutter: 0.01 });
    this.disposables.push(needleDepth);
    const needleGreens = (card, i, c) => c.setRGB(rng.float(0.8, 1.05), rng.float(0.88, 1.08), rng.float(0.85, 1.05));
    this.scene.add(cardsToInstances(needleCards, cardGeometry({ anchored: true, aspect: 0.5 }), needleMat, { colorFor: needleGreens, depthMaterial: needleDepth }));

    // Silhouettes
    const sil = silhouetteGeometries(rng);
    const silMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const [kind, list] of Object.entries(far)) {
      const items = list.map((t) => ({
        position: new THREE.Vector3(t.x, t.y - 0.3, t.z),
        rotationY: t.rot,
        scale: new THREE.Vector3(t.h * t.w, t.h, t.h * t.w),
        color: new THREE.Color().setRGB(0.09, 0.12, 0.09).multiplyScalar(rng.float(0.75, 1.25)),
      }));
      this.scene.add(scatter(sil[kind], silMat, items, { receiveShadow: false }));
    }
    this.treesPlaced = placed;
  }

  /** A limb from `start` along `dir` (horizontal), rising gently, with foliage on its outer half. */
  #limb(rng, start, dir, length, radius, { rise = 1.8 } = {}) {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const s = i / 4;
      pts.push(start.clone().addScaledVector(dir, length * s).add(new THREE.Vector3(rng.float(-0.2, 0.2) * s, Math.sin(s * Math.PI * 0.6) * rise, rng.float(-0.2, 0.2) * s)));
    }
    const { geometry, curve } = taperedTube(pts, (t) => radius * (1 - 0.8 * t), { radial: 7, segments: 10, tint: new THREE.Color(0.95, 0.9, 0.84) });
    const cards = [];
    for (let k = 0; k < 16; k++) {
      const p = curve.getPointAt(rng.float(0.4, 1)).add(new THREE.Vector3(rng.gauss() * 0.6, rng.float(-0.2, 0.9), rng.gauss() * 0.6));
      const scale = rng.float(1.3, 2.0);
      if (this.#avoid(p, scale * 0.5)) continue;
      const normal = p.clone().sub(curve.getPointAt(0.7)).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().lerp(new THREE.Vector3(rng.gauss(), rng.gauss(), rng.gauss()).normalize(), 0.5).normalize());
      cards.push({ position: p, scale, normal, quaternion: q, kind: 'leaf' });
    }
    return { wood: [geometry], cards };
  }

  /** A point `distance` m from the camera, just above the top of the moon opening, `extraDeg` above its edge. */
  #aboveOpening(extraDeg, distance) {
    const d = this.moonNight;
    _up.set(0, 1, 0).addScaledVector(d, -d.y).normalize();
    const a = (SKY.openingDeg + extraDeg) * DEG;
    const dir = d.clone().multiplyScalar(Math.cos(a)).addScaledVector(_up, Math.sin(a)).normalize();
    return this.home.position.clone().addScaledVector(dir, distance);
  }

  #buildMist() {
    const rng = new Rng(55);
    const cam = this.home.position;
    const sheets = [];
    for (let i = 0; i < (LOW ? 22 : 38); i++) {
      const band = rng.pick([[18, 32], [30, 60], [30, 60], [55, 110]]);
      const ang = rng.chance(0.75) ? rng.float(-1.3, 1.3) : rng.float(-Math.PI, Math.PI);
      const dir = this.forward.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
      const r = rng.float(band[0], band[1]);
      const x = cam.x + dir.x * r;
      const z = cam.z + dir.z * r;
      if (Math.hypot(x - this.seat.x, z - this.seat.z) < 15) continue;
      sheets.push({ x, y: this.baseAt(x, z) + rng.float(-0.2, 0.9), z, width: r * rng.float(0.45, 0.8), height: rng.float(2.4, 5) * (0.7 + r / 120) });
    }
    this.mist = createMist(sheets);
    this.scene.add(this.mist.mesh);
  }

  // ─── Ground cover ───────────────────────────────────────────────────────────

  #buildGroundCover() {
    const rng = new Rng(99);
    const cam = this.home.position;
    const C = this.clearing;
    const waterGap = (x, z, gap) => {
      const q = this.stream.nearest(x, z);
      return !q || q.d > q.w / 2 + gap;
    };

    // Grass tufts across the clearing
    const grassTex = grassTexture();
    const grassMat = applyWind(
      new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1 }),
      { sway: 0.06, flutter: 0.012 },
    );
    const tufts = [];
    for (let i = 0; tufts.length < (LOW ? 1500 : 3400) && i < 20000; i++) {
      const x = C.x + rng.float(-C.rx * 1.25, C.rx * 1.25);
      const z = C.z + rng.float(-C.rz * 1.25, C.rz * 1.25 + 4);
      const g = this.#grassAt(x, z);
      if (rng.next() > g * 0.95) continue;
      if (!waterGap(x, z, 0.3)) continue;
      if (Math.hypot(x - cam.x, z - cam.z) < 1.8) continue;
      if (this.#nearSightline(x, z, 0.9)) continue; // keep the view of the Monster open
      const fromSeat = Math.hypot(x - this.seat.x, z - this.seat.z);
      if (fromSeat < 1.1) continue;
      const s = rng.float(0.2, 0.46) * (0.75 + g * 0.35) * (0.55 + 0.45 * smoothstep(1.1, 3, fromSeat));
      tufts.push({
        position: new THREE.Vector3(x, this.heightAt(x, z) - 0.02, z),
        rotationY: rng.float(0, Math.PI * 2),
        scale: new THREE.Vector3(s * rng.float(0.9, 1.4), s, s * rng.float(0.9, 1.4)),
        color: new THREE.Color(rng.float(0.78, 1.05), rng.float(0.85, 1.05), rng.float(0.7, 0.9)),
      });
    }
    this.scene.add(scatter(grassTuftGeometry(), grassMat, tufts));

    // Ferns at the forest edge and around tree bases
    const fernMat = applyWind(
      new THREE.MeshStandardMaterial({ map: fernTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9 }),
      { sway: 0.05, flutter: 0.015 },
    );
    const ferns = [];
    for (let i = 0; ferns.length < (LOW ? 140 : 260) && i < 6000; i++) {
      const near = rng.chance(0.4) && this.treesPlaced.length ? rng.pick(this.treesPlaced) : null;
      const x = near ? near.x + rng.gauss() * 1.6 : C.x + rng.float(-24, 24);
      const z = near ? near.z + rng.gauss() * 1.6 : C.z + rng.float(-24, 24);
      const e = this.#clearingDist(x, z);
      if (!near && (e < 0.9 || e > 2.2)) continue;
      if (!waterGap(x, z, 0.5) || Math.hypot(x - cam.x, z - cam.z) < 3) continue;
      if (Math.hypot(x - this.seat.x, z - this.seat.z) < 1.6 || Math.hypot(x - LAYOUT.bush.x, z - LAYOUT.bush.z) < 1.2) continue;
      ferns.push({
        position: new THREE.Vector3(x, this.heightAt(x, z) - 0.03, z),
        rotationY: rng.float(0, Math.PI * 2),
        scale: rng.float(0.55, 1.05),
        color: new THREE.Color(rng.float(0.75, 1), rng.float(0.82, 1), rng.float(0.65, 0.85)),
      });
    }
    this.scene.add(scatter(fernGeometry(), fernMat, ferns));

    // Fallen leaves, thicker under the trees
    const leafMat = new THREE.MeshStandardMaterial({ map: singleLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const browns = ['#7a5a36', '#8c6a3c', '#6b5132', '#9a7a46', '#6f6a3a', '#5e4630'].map((h) => new THREE.Color(h));
    const fallen = [];
    for (let i = 0; fallen.length < (LOW ? 500 : 1100) && i < 12000; i++) {
      const x = C.x + rng.float(-16, 16);
      const z = C.z + rng.float(-15, 15);
      const e = this.#clearingDist(x, z);
      if (rng.next() > 0.25 + smoothstep(0.6, 1.3, e) * 0.75) continue;
      if (!waterGap(x, z, 0.15)) continue;
      fallen.push({
        position: new THREE.Vector3(x, this.heightAt(x, z) + 0.012, z),
        rotationY: rng.float(0, Math.PI * 2),
        tiltX: rng.float(-0.25, 0.25),
        tiltZ: rng.float(-0.25, 0.25),
        scale: rng.float(0.08, 0.13),
        color: rng.pick(browns).clone().multiplyScalar(rng.float(0.8, 1.15)),
      });
    }
    this.scene.add(scatter(flatLeafGeometry(), leafMat, fallen));

    // Fallen twigs and sticks
    const twigMat = new THREE.MeshStandardMaterial({ color: '#4b3b2b', roughness: 0.95 });
    const twigs = [];
    for (let i = 0; twigs.length < (LOW ? 60 : 130) && i < 4000; i++) {
      const x = C.x + rng.float(-15, 15);
      const z = C.z + rng.float(-14, 14);
      if (!waterGap(x, z, 0.2) || Math.hypot(x - cam.x, z - cam.z) < 1.5) continue;
      const len = rng.chance(0.15) ? rng.float(1, 2.2) : rng.float(0.25, 0.9);
      const r = len * rng.float(0.012, 0.022);
      twigs.push({
        position: new THREE.Vector3(x, this.heightAt(x, z) + r * 0.8, z),
        rotationY: rng.float(0, Math.PI * 2),
        tiltZ: rng.float(-0.06, 0.06),
        scale: new THREE.Vector3(len, r, r),
        color: new THREE.Color().setScalar(rng.float(0.75, 1.2)),
      });
    }
    this.scene.add(scatter(twigGeometry(), twigMat, twigs, { castShadow: true }));
  }

  #buildRocks() {
    const rng = new Rng(123);
    const cam = this.home.position;
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const geos = [0, 1, 2].map(() => rockGeometry(rng, { moss: rng.float(0.35, 0.7) }));
    const groups = [[], [], []];
    const greys = () => new THREE.Color().setScalar(rng.float(0.62, 1.0)).multiply(new THREE.Color(1, rng.float(0.96, 1), rng.float(0.9, 0.98)));
    const add = (x, z, s, { wet = false, sink = 0.35 } = {}) => {
      const color = greys();
      if (wet) color.multiplyScalar(0.62);
      groups[rng.int(0, 2)].push({
        position: new THREE.Vector3(x, this.heightAt(x, z) - s * sink, z),
        rotationY: rng.float(0, Math.PI * 2),
        tiltX: rng.float(-0.2, 0.2),
        scale: new THREE.Vector3(s * rng.float(0.9, 1.4), s, s * rng.float(0.9, 1.3)),
        color,
      });
    };
    // Along both banks, densest near the camera.
    this.waterStones = [];
    for (let s = 0; s < 70; s += rng.float(0.25, 0.7) * (1 + s / 25)) {
      const q = this.stream.at(s);
      const nx = -q.tz;
      const nz = q.tx;
      for (const side of [-1, 1]) {
        if (rng.chance(0.35)) continue;
        const off = q.w / 2 + rng.float(-0.05, 0.55);
        const x = q.x + nx * off * side;
        const z = q.z + nz * off * side;
        if (Math.hypot(x - cam.x, z - cam.z) < 1.2) continue;
        add(x, z, rng.float(0.09, 0.32) * (s < 25 ? 1 : 1.3), { wet: off < q.w / 2 + 0.15 });
      }
      if (s < 32 && rng.chance(0.12)) {
        const off = rng.float(-0.3, 0.3) * q.w;
        const x = q.x + nx * off;
        const z = q.z + nz * off;
        add(x, z, rng.float(0.12, 0.22), { wet: true, sink: 0.1 });
        this.waterStones.push(new THREE.Vector2(x, z));
      }
    }
    // Scattered stones in the clearing and a few mossy boulders at its edge.
    for (let i = 0; i < (LOW ? 40 : 80); i++) {
      const x = this.clearing.x + rng.float(-11, 11);
      const z = this.clearing.z + rng.float(-10, 10);
      const q = this.stream.nearest(x, z);
      if ((q && q.d < q.w / 2 + 0.3) || Math.hypot(x - this.seat.x, z - this.seat.z) < 1) continue;
      add(x, z, rng.float(0.04, 0.12));
    }
    // A few larger stones in the foreground grass, clear of the view of the Monster.
    for (let i = 0, n = 0; i < 200 && n < 14; i++) {
      const x = cam.x + rng.float(-6, 6);
      const z = cam.z - rng.float(1.5, 8);
      const q = this.stream.nearest(x, z);
      if ((q && q.d < q.w / 2 + 0.4) || this.#nearSightline(x, z, 1.1) || Math.hypot(x - this.seat.x, z - this.seat.z) < 1.4) continue;
      add(x, z, rng.float(0.12, 0.26), { sink: 0.4 });
      n++;
    }
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, Math.PI * 2);
      const x = this.clearing.x + Math.cos(a) * this.clearing.rx * rng.float(1.0, 1.35);
      const z = this.clearing.z + Math.sin(a) * this.clearing.rz * rng.float(1.0, 1.35);
      const q = this.stream.nearest(x, z);
      if ((q && q.d < q.w / 2 + 1) || Math.hypot(x - cam.x, z - cam.z) < 3) continue;
      add(x, z, rng.float(0.4, 0.9), { sink: 0.4 });
    }
    groups.forEach((items, i) => this.scene.add(scatter(geos[i], rockMat, items, { castShadow: true })));
  }

  // ─── Interactables ──────────────────────────────────────────────────────────

  #buildMoonTarget() {
    const group = new THREE.Group();
    const hit = new THREE.Mesh(new THREE.SphereGeometry(150 * Math.tan(4.2 * DEG), 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(hit);
    group.userData.lookPoint = group.position;
    this.moonTarget = group;
    this.scene.add(group);
    this.registerInteractable(IDS.moon, group);
  }

  #buildBranchAndBirds() {
    const rng = new Rng(7);
    const group = new THREE.Group();
    this.branchMaterial = new THREE.MeshStandardMaterial({
      map: this.barkMaterial.map,
      normalMap: this.barkMaterial.normalMap,
      vertexColors: true,
      roughness: 0.92,
      emissive: new THREE.Color('#b8925e'),
      emissiveIntensity: 0,
    });
    const curve = this.branchCurve;
    const tint = new THREE.Color(0.95, 0.9, 0.84);
    const parts = [taperedTube(curve.points, (t) => 0.13 * (1 - 0.8 * Math.sqrt(t)), { radial: 9, segments: 26, tint }).geometry];

    // Twigs off the outer half (each with a side shoot), leaves held close along them.
    const leaves = [];
    const shoots = [];
    const addTwig = (base, dir, len, r) => {
      const mid = base.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, len * 0.06, 0));
      const end = base.clone().addScaledVector(dir, len);
      const tube = taperedTube([base, mid, end], (t) => r * (1 - 0.65 * t), { radial: 5, segments: 6, tint });
      parts.push(tube.geometry);
      shoots.push(tube.curve);
      return tube.curve;
    };
    for (const u of [0.4, 0.52, 0.63, 0.76, 0.88, 0.97]) {
      const base = curve.getPointAt(u);
      const dir = new THREE.Vector3(rng.float(-0.1, 0.7), rng.float(0.35, 0.8), rng.float(-0.7, 0.2)).normalize();
      const twig = addTwig(base, dir, rng.float(0.3, 0.5), 0.03);
      const side = twig.getPointAt(0.55);
      addTwig(side, dir.clone().add(new THREE.Vector3(rng.float(-0.6, 0.6), 0.2, rng.float(-0.6, 0.6))).normalize(), rng.float(0.15, 0.25), 0.015);
    }
    for (const shoot of shoots) {
      for (let k = 0; k < 15; k++) {
        const p = shoot.getPointAt(rng.float(0.3, 1)).add(new THREE.Vector3(rng.gauss() * 0.035, rng.gauss() * 0.03, rng.gauss() * 0.035));
        if (LAYOUT.perches.some((u) => curve.getPointAt(u).distanceTo(p) < 0.22)) continue;
        leaves.push(p);
      }
    }
    const branchMesh = new THREE.Mesh(mergeGeometries(parts), this.branchMaterial);
    branchMesh.castShadow = branchMesh.receiveShadow = true;
    group.add(branchMesh);

    const leafGeo = new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0);
    leafGeo.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(leafGeo.attributes.position.count).fill(1), 1));
    const leafTex = singleLeafTexture();
    const leafMat = applyWind(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.75 }), {
      sway: 0.02,
      flutter: 0.012,
      leafNormals: true,
    });
    const leafDepth = windDepthMaterial(leafTex, 0.5, { sway: 0.02, flutter: 0.012 });
    this.disposables.push(leafDepth);
    const cards = leaves.map((p) => {
      const normal = new THREE.Vector3(rng.gauss() * 0.5, 1, rng.gauss() * 0.5 + 0.3).normalize();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.float(-1.2, 1.2), rng.float(0, Math.PI * 2), rng.float(-1.2, 1.2)));
      return { position: p, quaternion: q, scale: rng.float(0.1, 0.14), normal };
    });
    const greens = (card, i, c) => c.setRGB(rng.float(0.2, 0.28), rng.float(0.3, 0.38), rng.float(0.12, 0.17));
    group.add(cardsToInstances(cards, leafGeo, leafMat, { colorFor: greens, depthMaterial: leafDepth }));

    // Generous click target along the perch section.
    const a = curve.getPointAt(0.42);
    const b = curve.getPointAt(0.98);
    const hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, a.distanceTo(b), 4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(a).add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.18, 0));
    hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    group.add(hit);
    group.userData.lookPoint = this.perchCenter.clone().add(new THREE.Vector3(0, 0.1, 0));
    this.scene.add(group);
    this.registerInteractable(IDS.branch, group);
    this.reachPoint = curve.getPointAt(0.3).add(new THREE.Vector3(0, -0.05, 0));

    // Birds: perches along the branch, each facing roughly toward the camera.
    const cam = this.home.position;
    this.birds = LAYOUT.perches.map((u, i) => {
      const bird = new Bird({ rng: new Rng(500 + i), size: 1.45 });
      bird.voice = voiceFor(new Rng(900 + i));
      const p = curve.getPointAt(u);
      const radius = 0.13 * (1 - 0.8 * Math.sqrt(u));
      bird.perch = { position: p.clone().add(new THREE.Vector3(0, radius * 0.9, 0)), yaw: Math.atan2(cam.x - p.x, cam.z - p.z) + rng.float(-0.9, 0.9) };
      bird.origin = bird.perch.position.clone().addScaledVector(this.sunMorning, 24 + i * 3).add(new THREE.Vector3(rng.float(-3, 3), 4 + i, rng.float(-3, 3)));
      this.scene.add(bird.object);
      return bird;
    });
  }

  #buildStreamTarget() {
    const group = new THREE.Group();
    group.add(this.water);
    // A wider invisible ribbon over the near stretch, so the stream is easy to click.
    const positions = [];
    const indices = [];
    let n = 0;
    for (let s = 2; s <= 36; s += 0.75, n++) {
      const q = this.stream.at(s);
      const y = this.baseAt(q.x, q.z) - 0.05;
      const half = q.w / 2 + 0.6;
      positions.push(q.x - q.tz * half, y, q.z + q.tx * half, q.x + q.tz * half, y, q.z - q.tx * half);
      if (n > 0) indices.push((n - 1) * 2, (n - 1) * 2 + 1, n * 2, (n - 1) * 2 + 1, n * 2 + 1, n * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const hit = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    group.add(hit);
    // Label and look point: the first stretch of stream that is comfortably inside the view.
    const cam = this.home.position;
    const halfWidth = Math.atan(Math.tan((this.camera.fov * DEG) / 2) * this.camera.aspect);
    const within = Math.min(24 * DEG, halfWidth - 5 * DEG);
    let best = 10;
    for (let s = 0; s < 30; s += 0.5) {
      const p = this.stream.at(s);
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const depth = dx * this.forward.x + dz * this.forward.z;
      const side = dx * -this.forward.z + dz * this.forward.x;
      if (depth > 3.5 && Math.abs(Math.atan2(side, depth)) < within) {
        best = s;
        break;
      }
    }
    const q = this.stream.at(best);
    this.streamLabelPoint = new THREE.Vector3(q.x, this.baseAt(q.x, q.z) + 0.25, q.z);
    group.userData.lookPoint = this.streamLabelPoint;
    this.scene.add(group);
    this.registerInteractable(IDS.stream, group);
  }

  #buildBerryBush() {
    const rng = new Rng(61);
    const B = LAYOUT.bush;
    const y0 = this.heightAt(B.x, B.z);
    const group = new THREE.Group();
    group.position.set(B.x, y0, B.z);

    const tint = new THREE.Color(0.75, 0.68, 0.6);
    const twigs = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng.float(-0.3, 0.3);
      const out = rng.float(0.25, 0.45);
      const h = rng.float(0.5, 0.8);
      twigs.push(taperedTube([new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(Math.cos(a) * out * 0.4, h * 0.5, Math.sin(a) * out * 0.4), new THREE.Vector3(Math.cos(a) * out, h, Math.sin(a) * out)], (t) => 0.025 * (1 - 0.7 * t), { radial: 5, segments: 5, tint }).geometry);
    }
    const twigMesh = new THREE.Mesh(mergeGeometries(twigs), this.barkMaterial);
    twigMesh.castShadow = true;
    group.add(twigMesh);

    const tex = leafClusterTexture({ seed: 12, count: 80, palette: ['#4e6b3a', '#435f33', '#577540', '#3d5530'] });
    const mat = applyWind(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8 }), {
      sway: 0.02,
      flutter: 0.01,
      leafNormals: true,
    });
    const depth = windDepthMaterial(tex, 0.5, { sway: 0.02, flutter: 0.01 });
    this.disposables.push(depth);
    const center = new THREE.Vector3(B.x, y0 + 0.42, B.z);
    const cards = [];
    for (let i = 0; i < 30; i++) {
      const dir = new THREE.Vector3(rng.gauss(), Math.abs(rng.gauss()) * 0.8 + 0.1, rng.gauss()).normalize();
      const p = center.clone().add(new THREE.Vector3(dir.x * 0.5, dir.y * 0.38 - 0.05, dir.z * 0.5).multiplyScalar(rng.float(0.5, 1)));
      const normal = dir.clone().add(new THREE.Vector3(0, 0.4, 0)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().lerp(new THREE.Vector3(rng.gauss(), rng.gauss(), rng.gauss()).normalize(), 0.5).normalize());
      cards.push({ position: p.sub(group.position), quaternion: q, scale: rng.float(0.42, 0.62), normal });
    }
    const leafMesh = cardsToInstances(cards, cardGeometry(), mat, {
      colorFor: (card, i, c) => c.setRGB(rng.float(0.7, 0.9), rng.float(0.78, 0.95), rng.float(0.6, 0.78)),
      depthMaterial: depth,
    });
    group.add(leafMesh);

    // Berries in small clusters on the outside of the bush.
    this.berryMaterial = new THREE.MeshStandardMaterial({ color: '#33141f', roughness: 0.32, emissive: new THREE.Color('#d0607e'), emissiveIntensity: 0 });
    const berries = [];
    for (let c = 0; c < 11; c++) {
      const dir = new THREE.Vector3(rng.gauss(), Math.abs(rng.gauss()) * 0.6 + 0.2, rng.gauss()).normalize();
      const anchor = new THREE.Vector3(dir.x * 0.5, 0.36 + dir.y * 0.36, dir.z * 0.5);
      for (let k = 0; k < 7; k++) {
        berries.push({ position: anchor.clone().add(new THREE.Vector3(rng.gauss() * 0.035, rng.gauss() * 0.035, rng.gauss() * 0.035)), scale: rng.float(0.018, 0.026) });
      }
    }
    const berryMesh = scatter(new THREE.SphereGeometry(1, 10, 8), this.berryMaterial, berries, { castShadow: true });
    group.add(berryMesh);

    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.42;
    group.add(hit);
    group.userData.lookPoint = center;
    this.scene.add(group);
    this.registerInteractable(IDS.berries, group);
  }

  // ─── Labels ─────────────────────────────────────────────────────────────────

  #addPoi(id) {
    const quote = this.tracker.quotesFor(id)[0];
    const required = this.tracker.objectState(id).required;
    const name = quote?.label ?? id;
    const node = el(
      'button',
      {
        className: `poi ${required ? 'is-required' : 'is-optional'} is-hidden`,
        attrs: { type: 'button', 'aria-label': required ? name : `${name} (optional)` },
        on: {
          click: () => this.openComponent(id),
          pointerenter: () => this.#setLabelHover(id),
          pointerleave: () => this.#setLabelHover(null),
          focus: () => this.#setLabelHover(id),
          blur: () => this.#setLabelHover(null),
        },
      },
      [el('span', { className: 'poi-dot' }), el('span', { className: 'poi-name', text: name })],
    );
    node.disabled = true;
    this.pois.set(id, node);
    const object = this.interactables.get(id);
    const points = {
      [IDS.moon]: (t) => this.#moonLabelPoint(t),
      [IDS.branch]: (t) => t.copy(this.perchCenter).add(_w.set(0, 0.78, 0)),
      [IDS.stream]: (t) => t.copy(this.streamLabelPoint),
      [IDS.berries]: (t) => t.copy(object.userData.lookPoint).add(_w.set(0, 0.62, 0)),
    };
    this.labels.add(id, node, points[id] ?? ((t) => object.getWorldPosition(t)), () => object.visible);
  }

  #moonLabelPoint(t) {
    const d = this.sky.moonDir;
    _up.set(0, 1, 0).addScaledVector(d, -d.y).normalize();
    const a = 4.8 * DEG;
    _w.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(_up, -Math.sin(a));
    return t.copy(this.camera.position).addScaledVector(_w, 150);
  }

  #setLabelHover(id) {
    this.labelHovered = id;
    const object = id ? this.interactables.get(id) : null;
    if (object) this.monster.lookAt(object.userData.lookPoint ?? object.getWorldPosition(new THREE.Vector3()));
  }

  #updatePoi(id, state, hovered, object) {
    const node = this.pois.get(id);
    if (!node) return;
    const visible = this.interactive && state.active && object.visible;
    const key = `${visible}${state.pending}${state.viewed}${hovered}`;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.classList.toggle('is-hidden', !visible);
    node.classList.toggle('is-pending', state.pending);
    node.classList.toggle('is-viewed', state.viewed);
    node.classList.toggle('is-hovered', hovered);
    node.disabled = !visible;
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  styleInteractable(object, state, t) {
    const id = object.userData.pickId;
    const hovered = (state.hovered || this.labelHovered === id) && state.active;
    const pulse = (speed) => 0.5 + 0.5 * Math.sin(t * speed);
    if (id === IDS.moon) {
      const target = hovered ? 1 : state.pending ? 0.25 + 0.3 * pulse(2.2) : 0;
      const u = this.sky.uniforms.uMoonHalo;
      u.value += (target - u.value) * 0.12;
    } else if (id === IDS.branch) {
      this.branchMaterial.emissiveIntensity = hovered ? 0.12 : 0;
    } else if (id === IDS.stream) {
      this.stream.uniforms.uHighlight.value = hovered ? 0.45 : state.pending ? 0.04 * pulse(1.4) : 0;
    } else if (id === IDS.berries) {
      this.berryMaterial.emissiveIntensity = hovered ? 0.22 : state.pending ? 0.015 * pulse(1.8) : 0;
    }
    this.#updatePoi(id, state, hovered, object);
  }

  onQuoteOpened(quote) {
    if (quote.objectId === IDS.branch) {
      const perched = this.birds.filter((b) => b.perched);
      if (perched.length) this.#sing(perched[Math.floor(perched.length / 2)]);
      this.songTimer = Math.max(this.songTimer, 2.5);
      this.monster.reachTowards(this.reachPoint, 'L');
    }
  }

  onQuoteClosed(quote) {
    if (quote.objectId === IDS.branch) this.monster.reachTowards(null);
    if (quote.objectId === IDS.moon && this.phase === 'night' && this.tracker.isViewed(quote)) this.#passDays();
  }

  onComplete() {
    if (this.phase === 'night') Promise.resolve().then(() => this.#passDays()); // dev "Complete scene" before the moon was opened
    else if (this.phase === 'morning') this.phase = 'free';
    // 'passing' switches to 'free' itself once the birds have landed.
  }

  onDispose() {
    for (const d of this.disposables) d.dispose();
    this.labelHovered = null;
  }

  // ─── Time of day ────────────────────────────────────────────────────────────

  /** After the moon: a few nights and days pass quickly, then soft morning and the birds. */
  async #passDays() {
    if (this.phase !== 'night') return;
    this.phase = 'passing';
    this.setInteractive(false);
    const from = this.dayTime;
    const days = REDUCED_MOTION ? 1 : TIME.passingDays;
    const to = Math.floor(from) + 1 + days + TIME.morning;
    await tween({
      duration: REDUCED_MOTION ? 6 : TIME.passingSeconds,
      ease: Ease.inOutSine,
      onUpdate: (e) => {
        this.dayTime = from + (to - from) * e;
      },
    });
    if (this.disposed) return;
    this.phase = 'morning';
    await this.#birdsArrive();
    if (this.disposed) return;
    this.tracker.setEnabled(IDS.branch, null);
    if (this.completed) this.phase = 'free';
    this.setInteractive(true);
  }

  async #birdsArrive() {
    this.birdsMoving = true;
    await Promise.all(
      this.birds.map((b, i) =>
        wait(0.5 + i * 0.55).then(() => b.flyTo(b.perch.position, b.perch.yaw, { from: b.origin, duration: 3.1 + i * 0.35 })),
      ),
    );
    this.birdsMoving = false;
    this.birdsHome = true;
    this.songTimer = 0.6;
  }

  #birdsLeave() {
    this.birdsHome = false;
    this.birdsMoving = true;
    Promise.all(this.birds.map((b, i) => wait(i * 0.3).then(() => b.flyAway(b.origin)))).then(() => {
      this.birdsMoving = false;
    });
  }

  #sing(bird) {
    const phrase = composePhrase(this.songRng, bird.voice);
    bird.sing(phrase.notes);
    const p = bird.object.getWorldPosition(_v).project(this.camera);
    playPhrase(phrase, { pan: THREE.MathUtils.clamp(p.x, -1, 1) * 0.7 });
  }

  #setLight(name, base, multiplier) {
    const b = this.lightBindings[name];
    b.base = base;
    b.target.intensity = base * multiplier;
  }

  onUpdate(dt, t) {
    if (this.phase === 'free') this.dayTime += dt / TIME.freeDaySeconds;
    const rate = dt > 0 ? (this.dayTime - this.prevDayTime) / dt : 0; // days per second
    this.prevDayTime = this.dayTime;

    WIND.uTime.value = t;
    this.cloudOffset.x += dt * (0.006 + rate * 1.4);
    this.cloudOffset.y += dt * (0.0025 + rate * 0.5);

    const S = this.sky.update(this.dayTime, {
      dayTop: visualParams.skyTop,
      dayHorizon: visualParams.skyHorizon,
      time: t,
      cloudOffset: this.cloudOffset,
      center: this.camera.position,
    });
    const L = visualParams.lightIntensity;
    const { key, hemi, fill } = this.lights;
    key.position.copy(key.target.position).addScaledVector(S.keyDir, 90);
    key.color.copy(S.keyColor);
    this.#setLight('key', S.keyIntensity, L);
    hemi.color.copy(S.hemiSky);
    hemi.groundColor.copy(S.hemiGround);
    this.#setLight('hemi', S.hemiIntensity, L);
    fill.color.copy(COOL_FILL).lerp(WARM_FILL, S.day);
    this.#setLight('fill', S.fillIntensity, L);
    this.scene.fog.color.copy(S.fogColor);

    const lum = (0.3 + 0.7 * S.day) * L;
    this.mist.uniforms.uColor.value.copy(S.mistColor).multiplyScalar(lum);
    this.mist.uniforms.uOpacity.value = S.mistOpacity;
    this.mist.uniforms.uTime.value = t;

    const W = this.stream.uniforms;
    W.uTime.value = t;
    W.uTop.value.copy(S.top).multiplyScalar(L);
    W.uHorizon.value.copy(S.horizon).multiplyScalar(L);
    W.uForest.value.copy(S.fogColor).multiplyScalar(0.3 * L);
    W.uSunDir.value.copy(this.sky.sunDir);
    W.uMoonDir.value.copy(this.sky.moonDir);
    W.uSunColor.value.copy(S.sunColor);
    W.uSunVis.value = S.sunVisible * L;
    W.uMoonVis.value = S.moonVisible * L;
    W.uLight.value = (0.22 + 0.78 * S.day) * L;
    this.#updateRipples(t);

    // The moon can be clicked while it is clearly up.
    this.moonTarget.position.copy(this.home.position).addScaledVector(this.sky.moonDir, 150);
    this.moonTarget.visible = S.moonElevation > 4 && S.moonVisible > 0.35;

    // Birds: in the free cycle they leave at dusk and return at dawn.
    for (const b of this.birds) b.update(dt);
    if (this.phase === 'free' && !this.birdsMoving) {
      if (this.birdsHome && S.sunElevation < -1.5) this.#birdsLeave();
      else if (!this.birdsHome && S.sunElevation > 3) this.#birdsArrive();
    }
    if (this.birdsHome && S.day > 0.25) {
      this.songTimer -= dt;
      if (this.songTimer <= 0) {
        const perched = this.birds.filter((b) => b.perched);
        if (perched.length) this.#sing(this.songRng.pick(perched));
        this.songTimer = this.songRng.float(2.2, 5.5);
      }
    }

    this.#updateAttention(dt, S);
  }

  /** Where the Monster looks when nothing is hovered: the moon at night, the birds when they are near. */
  #updateAttention(dt, S) {
    if (this.hovered || this.labelHovered) return;
    const G = this.glance;
    G.timer -= dt;
    if (G.timer <= 0) {
      G.away = G.away > 0 ? 0 : this.songRng.float(1.5, 3);
      G.timer = G.away || this.songRng.float(5, 9);
    }
    if (G.away > 0 && this.phase !== 'night') {
      this.monster.lookAt(null);
      return;
    }
    const head = _v.copy(this.seat).setY(1.45);
    if (this.birdsHome) this.monster.lookAt(_w.copy(this.perchCenter).add(_up.set(0, 0.1, 0)));
    else if (S.moonVisible > 0.4) this.monster.lookAt(_w.copy(head).addScaledVector(this.sky.moonDir, 40));
    else if (S.sunVisible > 0.4) this.monster.lookAt(_w.copy(head).addScaledVector(this.sky.sunDir, 40));
    else this.monster.lookAt(null);
  }

  #updateRipples(t) {
    if (t < this.nextRipple) return;
    const rng = this.songRng;
    let x;
    let z;
    if (this.waterStones.length && rng.chance(0.45)) {
      const s = rng.pick(this.waterStones);
      x = s.x + rng.float(-0.15, 0.15);
      z = s.y + rng.float(-0.15, 0.15);
    } else {
      const q = this.stream.at(rng.float(4, 30));
      const off = rng.float(-0.3, 0.3) * q.w;
      x = q.x - q.tz * off;
      z = q.z + q.tx * off;
    }
    this.stream.uniforms.uRipples.value[this.rippleIndex].set(x, z, t, rng.float(0.5, 1));
    this.rippleIndex = (this.rippleIndex + 1) % 6;
    this.nextRipple = t + rng.float(0.5, 1.4);
  }
}
