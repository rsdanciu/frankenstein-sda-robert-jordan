import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { wait } from '../../core/tween.js';
import { nihilism, visualParams, visualScalarsAt } from '../../nihilism/nihilism.js';
import { Person, FRANKENSTEIN_STYLE } from '../../people/Person.js';
import { DaySky } from '../nature/sky.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { mountainTextures } from '../nature/textures.js';
import { createGround, rockGeometry, scatter } from '../nature/ground.js';
import { createMist } from '../nature/mist.js';
import { DRAIN, KEEP, HAZE, applyDrain, applyKeepBelow, applyHaze } from '../grading.js';

/**
 * Geneva (Mountains) — scene 3 (data: public/json/scenes/genevaMountains.json).
 *
 * Built to the students' brief: a snowy ledge high on a steep mountain of exposed rock,
 * and far below, a warm, sunlit valley (fields, woods, a lake and a village). The valley
 * is held at its unfaded colour and light (grading.js applyKeepBelow) and seen through a
 * distance haze rather than fog, so it stays visible and inviting while, around the
 * Monster, colour and light drain away as Unity rises (applyDrain).
 *
 * On the ledge the Monster and Frankenstein face each other; a band of shadow from the
 * rock above (out of view, behind the camera) lies on the snow between them.
 *
 * SEQUENCE ─ all five components are required, in order; each action plays before its menu.
 *   arrival      the Monster walks calmly up to Frankenstein
 *   1 overlook   the camera goes to the edge and looks out over the drop and the valley
 *   2 Frankenstein  the Monster takes a step toward him, an open hand held out
 *   3 shadow     the camera rises to look down on the band of shadow between them
 *   4 valley     attention shifts to the valley: the camera looks down at it and the Monster
 *                turns to it. Afterwards they begin to argue: Frankenstein refuses, the Monster
 *                leans in and his hands clench
 *   5 hand       his clenched fist; afterwards he turns away from Frankenstein
 */

const IDS = {
  overlook: 'genevaMountains-overlook',
  frankenstein: 'genevaMountains-frankenstein',
  shadow: 'genevaMountains-shadow',
  valley: 'genevaMountains-valley',
  hand: 'genevaMountains-hand',
};
const ORDER = [IDS.overlook, IDS.frankenstein, IDS.shadow, IDS.valley, IDS.hand];

const SKY = { latitude: 45.9, declination: 15, sunElevation: 24, sunToward: [0.28, 0.96] }; // the sun behind the camera, a little right

/** Metres. The ledge is at y = 0 and its outer edge near z = EDGE; the valley lies far below toward −Z. */
const EDGE = -1.9;
const VALLEY = { y: -900, start: 4300, lake: { x: 420, z: -6300, rx: 720, rz: 360 }, village: { x: -380, z: -5650 } };

const SPOTS = {
  start: { x: -5.0, z: -0.95 },
  calm: { x: -2.4, z: -1.0 },
  step: { x: -1.9, z: -1.0 },
  away: { x: -2.9, z: -0.85 },
  frankenstein: { x: 1.9, z: -1.05 },
  between: new THREE.Vector3(0, 0, -1.05),
  overlookRock: { x: 4.15, z: -2.05 },
};

const VIEWS = {
  home: { position: [0.5, 1.75, 5.6], target: [-0.3, 0.55, -8], fov: 52, needs: 30 },
  overlook: { position: [3.0, 1.95, -1.0], target: [-3.0, -16, -100], fov: 55, needs: 30 },
  pair: { position: [0.0, 1.65, 3.4], target: [-0.2, 1.2, -1.0], fov: 46, needs: 22 },
  shadow: { position: [0.9, 4.6, 3.8], target: [0.1, 0, -1.2], fov: 48, needs: 22 },
  valley: { position: [0.3, 1.9, 3.0], target: [VALLEY.village.x, VALLEY.y + 40, VALLEY.village.z], fov: 13, needs: 6 },
  hand: { position: [-0.85, 1.6, 1.5], target: [-1.9, 1.2, -1.0], fov: 42, needs: 18 },
  end: { position: [0.9, 2.0, 6.2], target: [-0.5, 0.7, -8], fov: 52, needs: 30 },
};
const VIEW_FOR = { [IDS.overlook]: 'overlook', [IDS.frankenstein]: 'pair', [IDS.shadow]: 'shadow', [IDS.valley]: 'valley', [IDS.hand]: 'hand' };

/** The Monster's poses (conventions in Monster.js POSES). */
const POSE = {
  calm: {
    hipsY: 1.15,
    joints: { spine: [0.12, 0, 0], chest: [0.06, 0, 0], shoulderL: [-0.35, 0, 0.18], elbowL: [-0.55, 0, 0], shoulderR: [-0.35, 0, -0.18], elbowR: [-0.55, 0, 0] },
  },
  look: {
    hipsY: 1.16,
    joints: { spine: [0.06, 0, 0], chest: [0.02, 0, 0], shoulderL: [0.02, 0, 0.12], elbowL: [-0.25, 0, 0], shoulderR: [0.02, 0, -0.12], elbowR: [-0.25, 0, 0] },
  },
  confront: {
    hipsY: 1.1,
    joints: {
      legL: [-0.32, 0, 0.1], kneeL: [0.36, 0, 0], legR: [0.22, 0, -0.1], kneeR: [0.1, 0, 0],
      spine: [0.32, 0, 0], chest: [0.18, 0, 0],
      shoulderL: [0.3, 0, 0.3], elbowL: [-0.35, 0, 0], shoulderR: [0.3, 0, -0.3], elbowR: [-0.35, 0, 0],
    },
  },
  fist: {
    hipsY: 1.12,
    joints: {
      legL: [-0.25, 0, 0.1], kneeL: [0.3, 0, 0], legR: [0.18, 0, -0.1], kneeR: [0.1, 0, 0],
      spine: [0.2, 0, 0], chest: [0.1, 0, 0],
      shoulderL: [0.25, 0, 0.3], elbowL: [-0.3, 0, 0], shoulderR: [-0.8, 0.25, -0.32], elbowR: [-1.85, 0, 0],
    },
  },
  rigid: {
    hipsY: 1.17,
    joints: {
      legL: [0, 0, 0.09], legR: [0, 0, -0.09],
      spine: [-0.05, 0, 0], chest: [-0.08, 0, 0],
      shoulderL: [0.05, 0, 0.26], elbowL: [-0.1, 0, 0], shoulderR: [0.05, 0, -0.26], elbowR: [-0.1, 0, 0],
    },
  },
};

/** Frankenstein's poses (Person.setPose). He faces −X, so his left arm is on the camera's side. */
const VICTOR = {
  stand: { joints: { spine: [0.02, 0, 0], chest: [0.02, 0, 0], shoulderL: [0.05, 0, 0.1], elbowL: [-0.22, 0, 0], shoulderR: [0.05, 0, -0.1], elbowR: [-0.22, 0, 0] } },
  wary: { joints: { spine: [-0.12, 0, 0], chest: [-0.08, 0, 0], shoulderL: [-0.15, 0, 0.14], elbowL: [-0.7, 0, 0], shoulderR: [-0.15, 0, -0.14], elbowR: [-0.7, 0, 0] } },
  refuse: { joints: { spine: [-0.06, 0.15, 0], chest: [-0.04, 0.1, 0], shoulderL: [-1.4, 0, 0.18], elbowL: [-0.15, 0, 0], shoulderR: [0.05, 0, -0.12], elbowR: [-0.3, 0, 0] } },
  turned: { joints: { spine: [0.06, 0.35, 0], chest: [0.04, 0.2, 0], shoulderL: [0.05, 0, 0.1], elbowL: [-0.25, 0, 0], shoulderR: [0.05, 0, -0.1], elbowR: [-0.25, 0, 0] } },
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const LIGHT = { key: 2.8, hemi: 1.6 };
const VALLEY_SATURATION = 0.95; // fuller than the graded mountain, so the valley reads warmer and more inviting
const lerp = THREE.MathUtils.lerp;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export default class GenevaMountainsScene extends BaseScene {
  static cameraHome = { position: VIEWS.home.position, target: VIEWS.home.target };

  constructor(args) {
    super(args);
    this.useViews(VIEWS);
    this.camera.near = 0.2;
    this.camera.far = 22000; // the valley is kilometres away
    this.camera.updateProjectionMatrix();
    this.step = 0;
    this.phase = 'arriving'; // arriving → talking → arguing → apart
    this.sequence = Promise.resolve();
    this.disposables = [];
    this.rng = new Rng(3131);
    this.cloudOffset = new THREE.Vector2(0.4, 2.2);
    this.base = visualScalarsAt(0); // the valley keeps the look of a world before any collapse
  }

  entryPosition(home) {
    return home.clone().add(new THREE.Vector3(0, 30, 0.5));
  }

  exitPosition(from) {
    return from.clone().add(new THREE.Vector3(0, 32, 0));
  }

  // ─── Terrain ────────────────────────────────────────────────────────────────

  #edgeAt(x) {
    return EDGE - 0.5 * fbm2(x * 0.35, 3.1, 2, 7) - 1.6 * smoothstep(4.5, 9, Math.abs(x));
  }

  /** Height of the mountain, the drop, the valley and the ranges around it. */
  heightAt = (x, z) => {
    const ax = Math.abs(x);
    const d = this.#edgeAt(x) - z; // metres beyond the ledge's edge
    const beyond = Math.max(d, 0);
    let h;
    if (d <= 0) {
      // The ledge: wind-packed snow, uneven; rock walls rising beside and behind it.
      h = (fbm2(x * 0.4, z * 0.4, 2, 3) - 0.5) * 0.24 * smoothstep(-0.2, -1.2, d);
      h += smoothstep(-0.6, 0, d) * -0.25; // the snow rounds over at the lip
    } else {
      // The fall: a cliff, the long slopes down to the valley floor, the far range beyond.
      h = -235 * (1 - Math.exp(-d / 38)) - 665 * smoothstep(120, VALLEY.start, d) + 2100 * smoothstep(8800, 13500, d);
    }
    // Our mountain's flanks, either side of the ledge and the drop, and the wall behind:
    // broken rock, buttresses and snow-holding shelves rather than a smooth face.
    const flank = smoothstep(9, 18, ax) * (ax - 9) * 0.85;
    const buttress = (fbm2(x * 0.09, z * 0.06 + 3, 3, 17) - 0.5) * 14 + (fbm2(x * 0.35, z * 0.35, 2, 19) - 0.5) * 3;
    h += Math.min(520, flank * 1.9 + buttress * smoothstep(9.5, 20, ax)) * (1 - smoothstep(0, 900, beyond));
    h += smoothstep(6, 13, z) * (z - 6) * 2.6;
    // The valley's walls: high ridges either side, the valley widening with distance.
    const w = lerp(380, 2600, smoothstep(200, VALLEY.start, beyond));
    const wall = smoothstep(w, w * 2.3, ax) * smoothstep(300, 1200, beyond);
    h += Math.min(2300, (ax - w) * 0.95) * wall;
    // Relief: big ridges on the mountains, gentle swells on the valley floor.
    const relief = 0.08 + 0.92 * Math.max(wall, smoothstep(30, 400, Math.abs(h - VALLEY.y)) * smoothstep(60, 600, beyond));
    h += (fbm2(x * 0.0035 + 11, z * 0.0035, 4, 11) - 0.5) * 420 * relief * smoothstep(80, 900, beyond);
    h += (fbm2(x * 0.03, z * 0.03, 3, 13) - 0.5) * 30 * smoothstep(20, 300, beyond);
    // The lake's hollow on the valley floor.
    const L = VALLEY.lake;
    h -= 22 * (1 - smoothstep(0.75, 1.15, Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz)));
    return h;
  };

  /** Snow on gentle slopes, bare rock on steep ones; below the snowline the valley. */
  #surface(x, z) {
    if (this._surfKey === x * 1e6 + z) return this._surf;
    const e = Math.max(0.3, Math.hypot(x, z) * 0.004);
    const h = this.heightAt(x, z);
    const slope = Math.hypot(this.heightAt(x + e, z) - this.heightAt(x - e, z), this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    this._surfKey = x * 1e6 + z;
    this._surf = { h, slope };
    return this._surf;
  }

  #snowAt = (x, z) => {
    const { h, slope } = this.#surface(x, z);
    const snowline = VALLEY.y + 520 + (fbm2(x * 0.004, z * 0.004, 2, 5) - 0.5) * 220;
    const valley = 1 - smoothstep(snowline - 80, snowline, h); // the valley uses the soft (snow) texture under its tint
    const snow = 1 - smoothstep(0.6, 1.6, slope); // wide, so snow fades into rock across coarse triangles
    return Math.max(valley, snow);
  };

  #tintAt = (x, z, c) => {
    const { h, slope } = this.#surface(x, z);
    const n = fbm2(x * 0.02, z * 0.02, 3, 31);
    const snowline = VALLEY.y + 520 + (fbm2(x * 0.004, z * 0.004, 2, 5) - 0.5) * 220;
    if (h > snowline) {
      const rocky = smoothstep(0.6, 1.6, slope);
      c.setRGB(0.95, 0.97, 1.0).lerp(_c.setRGB(0.78 + 0.1 * n, 0.75 + 0.1 * n, 0.72 + 0.08 * n), rocky);
      return;
    }
    // Below the snowline: alpine scree and meadow, then the valley's fields and woods.
    const meadow = smoothstep(snowline, snowline - 180, h);
    const fieldNoise = fbm2(x * 0.006, z * 0.006, 3, 41);
    const patch = Math.floor(fbm2(x * 0.0045 + 5, z * 0.0045, 2, 43) * 6);
    const fields = ['#7fa83c', '#9db84a', '#cdb04f', '#6f9a35', '#b89a45', '#8fb043'];
    c.set(fields[Math.max(0, Math.min(5, patch))]);
    const forest = smoothstep(0.55, 0.62, fieldNoise) * smoothstep(0.08, 0.3, slope) + smoothstep(0.35, 0.6, slope) * 0.8;
    c.lerp(_c.set('#2f5a2a'), Math.min(1, forest));
    c.lerp(_c.setRGB(0.62, 0.6, 0.55), (1 - meadow) * 0.75); // scree and rock above the meadows
    c.multiplyScalar(0.9 + 0.2 * n);
  };

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination, cloudCover: 0.32 });
    this.dayTime = this.#afternoonAt(SKY.sunElevation);
    const [sx, sz] = SKY.sunToward;
    this.sky.aimMoon(this.dayTime, new THREE.Vector3(-sx, 0, -sz)); // the full moon is opposite the sun
    this.sunDir = this.sky.bodiesAt(this.dayTime).sun.clone();
    this.scene.add(this.sky.mesh);
    this.scene.fog = null; // distance is handled by the haze, so the valley stays visible

    const key = new THREE.DirectionalLight('#ffe7c8', LIGHT.key);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    key.target.position.set(0, 0, 0);
    key.position.copy(this.sunDir).multiplyScalar(50);
    const hemi = new THREE.HemisphereLight('#a9bfdc', '#dfe5ec', LIGHT.hemi);
    this.scene.add(key, key.target, hemi);
    this.lights = { key, hemi };
    this.bindNihilism({ lights: [{ target: key, base: LIGHT.key }, { target: hemi, base: LIGHT.hemi }] });
  }

  #afternoonAt(elevation) {
    const sun = new THREE.Vector3();
    for (let t = 0.5; t < 1; t += 0.0002) {
      this.sky.bodiesAt(t, sun);
      if (Math.asin(sun.y) / DEG < elevation) return t;
    }
    return 0.7;
  }

  buildBackground() {
    const tex = mountainTextures({ size: LOW ? 512 : 1024 });
    const textures = { grassMap: tex.snowMap, litterMap: tex.rockMap, normalMap: tex.normalMap };
    this.disposables.push(tex.snowMap, tex.rockMap, tex.normalMap);
    // A detailed mesh for the ledge and the lip of the cliff, and one for everything beyond.
    // The far mesh dips just under the near one where they overlap, so it never shows through.
    this.near = createGround({ size: 90, segments: LOW ? 180 : 260, power: 1.6, heightAt: this.heightAt, grassAt: this.#snowAt, tintAt: this.#tintAt, textures, tile: 4 });
    const far = (x, z) => this.heightAt(x, z) - 4 * (1 - smoothstep(38, 44, Math.max(Math.abs(x), Math.abs(z))));
    this.far = createGround({ size: 26000, segments: LOW ? 260 : 360, power: 2.5, heightAt: far, grassAt: this.#snowAt, tintAt: this.#tintAt, textures, tile: 4 });
    this.far.receiveShadow = false;
    this.scene.add(this.near, this.far);
    // An invisible floor over the ledge stops clicks going "through" the snow to the valley.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 11).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    floor.position.set(0, 0.02, 3.4);
    floor.userData.blocksPick = true;
    this.scene.add(floor);
    this.pickBlockers.push(floor);
    this.#buildValley();
    this.#buildMist();
  }

  buildForeground() {
    this.#buildRocks();
    this.#buildShadowCaster();
    this.frankenstein = new Person(FRANKENSTEIN_STYLE);
    const F = SPOTS.frankenstein;
    this.frankenstein.object.position.set(F.x, this.heightAt(F.x, F.z), F.z);
    this.frankenstein.object.rotation.y = -Math.PI / 2;
    this.frankenstein.setPose(VICTOR.stand);
    this.frankenstein.update(0);
    this.scene.add(this.frankenstein.object);
  }

  placeMonster(monster) {
    const S = SPOTS.start;
    monster.object.position.set(S.x, 0, S.z);
    monster.object.rotation.y = Math.PI / 2;
    monster.facing = Math.PI / 2;
    monster.setPose(POSE.look, { immediate: true });
  }

  buildInteractables() {
    this.#buildTargets();
    const R = SPOTS.overlookRock;
    const F = SPOTS.frankenstein;
    const V = VALLEY.village;
    this.addComponentLabel(IDS.overlook, (t) => t.set(R.x, 1.25, R.z));
    this.addComponentLabel(IDS.frankenstein, (t) => t.set(F.x, 2.15, F.z));
    this.addComponentLabel(IDS.shadow, (t) => t.copy(this.bandAt(1.0)).setY(0.15));
    this.addComponentLabel(IDS.valley, (t) => t.set(V.x + 200, VALLEY.y + 160, V.z));
    this.addComponentLabel(IDS.hand, (t) => this.monster.parts.handR.getWorldPosition(t).add(_w.set(0, 0.22, 0.2)));
    this.#grade();
  }

  /** The haze on everything at a distance, the valley's held colour, the drain near the Monster. */
  #grade() {
    const nearStuff = new Set([this.near.material, this.rockMat, this.snowRockMat, ...Object.values(this.monster.materials), ...this.frankenstein.materials]);
    this.monster.object.traverse((o) => o.isMesh && nearStuff.add(o.material));
    this.scene.traverse((o) => {
      if (!o.isMesh || o === this.sky.mesh) return;
      for (const m of [].concat(o.material ?? [])) {
        if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial) || m.visible === false || m.colorWrite === false) continue;
        applyHaze(m);
        if (o.userData.valley || m === this.far.material) applyKeepBelow(m);
        if (nearStuff.has(m)) applyDrain(m);
      }
    });
  }

  // ─── Valley, rocks, shadow, mist ────────────────────────────────────────────

  #buildValley() {
    const rng = new Rng(77);
    const L = VALLEY.lake;
    // The lake, a little below the valley floor around it.
    const lakeY = this.heightAt(L.x, L.z) + 18;
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#7fa9cc', roughness: 0.25, emissive: new THREE.Color('#5a7fa6'), emissiveIntensity: 0.35 }), // a sky-lit surface
    );
    lake.scale.set(L.rx * 1.02, 1, L.rz * 1.02);
    lake.position.set(L.x, lakeY, L.z);
    lake.userData.valley = true;
    this.scene.add(lake);

    // The village: white walls, red-brown roofs, a church tower.
    const V = VALLEY.village;
    const walls = [];
    const roofs = [];
    for (let i = 0; i < 46; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 260;
      const x = V.x + Math.cos(a) * r;
      const z = V.z + Math.sin(a) * r * 0.7;
      const y = this.heightAt(x, z);
      const w = rng.float(10, 18);
      const d = rng.float(8, 13);
      const rot = rng.float(0, Math.PI);
      walls.push({ position: new THREE.Vector3(x, y + 4, z), rotationY: rot, scale: new THREE.Vector3(w, 8, d), color: new THREE.Color().setScalar(rng.float(0.85, 1)) });
      roofs.push({ position: new THREE.Vector3(x, y + 8, z), rotationY: rot, scale: new THREE.Vector3(w * 1.08, 5, d * 1.1), color: new THREE.Color().setHSL(0.03, 0.45, rng.float(0.3, 0.42)) });
    }
    const roof = new THREE.CylinderGeometry(0.7071, 0.7071, 1, 4, 1).rotateY(Math.PI / 4).rotateZ(Math.PI / 2).scale(1, 1, 1).translate(0, 0.35, 0);
    const houseMat = new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const wallMesh = scatter(new THREE.BoxGeometry(1, 1, 1), houseMat, walls, { receiveShadow: false });
    const roofMesh = scatter(roof, roofMat, roofs, { receiveShadow: false });
    const towerY = this.heightAt(V.x, V.z);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 34, 9), houseMat);
    tower.position.set(V.x, towerY + 17, V.z);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(7, 22, 4), roofMat);
    spire.position.set(V.x, towerY + 45, V.z);
    for (const m of [wallMesh, roofMesh, tower, spire]) {
      m.userData.valley = true;
      this.scene.add(m);
    }

    // Woods on the valley's lower slopes and in patches on the floor.
    const trees = [];
    for (let i = 0; i < 40000 && trees.length < (LOW ? 1800 : 3600); i++) {
      const x = rng.float(-3200, 3200);
      const z = -rng.float(VALLEY.start - 1600, 9500);
      const { h, slope } = this.#surface(x, z);
      if (h > VALLEY.y + 420 || slope > 0.9) continue;
      const wood = fbm2(x * 0.006, z * 0.006, 3, 41) > 0.55 || (slope > 0.2 && rng.chance(0.6));
      if (!wood || Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz) < 1.15 || Math.hypot(x - V.x, (z - V.z) / 0.7) < 300) continue;
      const s = rng.float(14, 26);
      trees.push({ position: new THREE.Vector3(x, h + s * 0.45, z), rotationY: rng.float(0, 6.3), scale: new THREE.Vector3(s * 0.32, s, s * 0.32), color: new THREE.Color().setHSL(0.3, 0.32, rng.float(0.13, 0.2)) });
    }
    const treeMesh = scatter(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), trees, { receiveShadow: false });
    treeMesh.userData.valley = true;
    this.scene.add(treeMesh);
  }

  #buildRocks() {
    const rng = new Rng(19);
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const geos = [0, 1, 2].map(() => rockGeometry(rng, { moss: 0 }));
    const groups = [[], [], []];
    const add = (x, z, s, sink = 0.35) => groups[rng.int(0, 2)].push({
      position: new THREE.Vector3(x, this.heightAt(x, z) - s * sink, z),
      rotationY: rng.float(0, 6.3),
      tiltX: rng.float(-0.3, 0.3),
      scale: new THREE.Vector3(s * rng.float(0.9, 1.5), s * rng.float(0.7, 1.2), s * rng.float(0.9, 1.4)),
      color: new THREE.Color().setScalar(rng.float(0.45, 0.7)),
    });
    // Outcrops at the sides and back of the ledge, and along the lip.
    for (let i = 0; i < 26; i++) {
      const side = rng.chance(0.5) ? 1 : -1;
      const x = side * rng.float(5.5, 11);
      const z = rng.float(-1.5, 6);
      add(x, z, rng.float(0.4, 1.4));
    }
    for (let x = -9; x < 9; x += rng.float(1.2, 3)) {
      if (Math.abs(x) < 3.2) continue; // keep the view between the two clear
      add(x, this.#edgeAt(x) + 0.2, rng.float(0.2, 0.55), 0.5);
    }
    groups.forEach((items, i) => this.scene.add(scatter(geos[i], this.rockMat, items, { castShadow: true })));
    // The overlook: a flat-topped rock at the edge, snow on its top.
    this.snowRockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const g = rockGeometry(rng, { moss: 0 });
    const col = g.attributes.color;
    const nor = g.attributes.normal;
    for (let i = 0; i < col.count; i++) {
      const snow = smoothstep(0.5, 0.8, nor.getY(i));
      col.setXYZ(i, lerp(0.5, 0.95, snow), lerp(0.49, 0.97, snow), lerp(0.47, 1.0, snow));
    }
    const R = SPOTS.overlookRock;
    this.overlookRock = new THREE.Mesh(g, this.snowRockMat);
    this.overlookRock.scale.set(0.95, 0.7, 0.8);
    this.overlookRock.position.set(R.x, this.heightAt(R.x, R.z) + 0.15, R.z);
    this.overlookRock.castShadow = this.overlookRock.receiveShadow = true;
    this.scene.add(this.overlookRock);
  }

  /** Where the band of shadow crosses the ledge, `along` metres from the gap between them toward the sun. */
  bandAt(along, target = new THREE.Vector3()) {
    return target.copy(SPOTS.between).addScaledVector(this.sunFlat, along);
  }

  /**
   * The band of shadow between them comes from a rib of rock up the mountain behind the
   * camera; only its shadow is needed, so the caster is drawn into the shadow map alone.
   */
  #buildShadowCaster() {
    this.sunFlat = new THREE.Vector3(this.sunDir.x, 0, this.sunDir.z).normalize();
    const elevation = Math.asin(this.sunDir.y);
    const back = 9.5;
    const height = back * Math.tan(elevation) + 6;
    const caster = new THREE.Mesh(new THREE.BoxGeometry(0.95, height, 0.3), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    caster.position.copy(this.bandAt(back)).setY(height / 2);
    caster.rotation.y = Math.atan2(this.sunFlat.x, this.sunFlat.z);
    caster.castShadow = true;
    this.scene.add(caster);
    // A faint cool sheen over the band, shown while it is hovered or waiting to be viewed.
    const len = 7;
    this.bandSheen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, len).rotateX(-Math.PI / 2).translate(0, 0.03, -len / 2 + 0.6),
      new THREE.MeshBasicMaterial({ color: '#9cc0ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.bandSheen.position.copy(this.bandAt(len - 1.6));
    this.bandSheen.rotation.y = caster.rotation.y;
    this.scene.add(this.bandSheen);
  }

  #buildMist() {
    // Drifting cloud in the drop below the ledge and blowing snow along the flanks.
    const rng = new Rng(5);
    const sheets = [];
    for (let i = 0; i < (LOW ? 10 : 18); i++) {
      const x = (rng.chance(0.5) ? -1 : 1) * rng.float(900, 2200); // along the valley's walls, not across the view of it
      const z = -rng.float(300, 2600);
      sheets.push({ x, y: this.heightAt(x, z) + rng.float(-40, 120), z, width: rng.float(300, 800), height: rng.float(60, 160) });
    }
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      sheets.push({ x: side * rng.float(9, 20), y: rng.float(-1, 4), z: rng.float(-6, 4), width: rng.float(8, 16), height: rng.float(3, 6) });
    }
    this.mist = createMist(sheets);
    this.scene.add(this.mist.mesh);
  }

  #buildTargets() {
    const invisible = () => new THREE.MeshBasicMaterial({ visible: false });
    const group = (id, children, lookPoint) => {
      const g = new THREE.Group();
      children.forEach((c) => g.add(c));
      g.userData.lookPoint = lookPoint;
      this.scene.add(g);
      this.registerInteractable(id, g);
      return g;
    };
    const R = SPOTS.overlookRock;
    const rockHit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), invisible());
    rockHit.position.set(R.x, 0.4, R.z);
    group(IDS.overlook, [rockHit], new THREE.Vector3(R.x - 2, -60, R.z - 300));
    const F = SPOTS.frankenstein;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.2, 4, 8), invisible());
    body.position.set(F.x, 0.95, F.z);
    group(IDS.frankenstein, [body], new THREE.Vector3(F.x, 1.6, F.z));
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 4.2), invisible());
    band.position.copy(this.bandAt(1.1)).setY(0.12);
    band.rotation.y = Math.atan2(this.sunFlat.x, this.sunFlat.z);
    group(IDS.shadow, [band], this.bandAt(0.3).setY(0));
    const V = VALLEY.village;
    const valley = new THREE.Mesh(new THREE.BoxGeometry(5200, 360, 4600), invisible());
    valley.position.set(0, VALLEY.y + 60, -6600);
    group(IDS.valley, [valley], new THREE.Vector3(V.x, VALLEY.y, V.z));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), invisible());
    this.handHit = group(IDS.hand, [hand], null);
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  styleInteractable(object, state, t) {
    const id = object.userData.pickId;
    const hovered = state.hovered && state.active;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    if (id === IDS.overlook) {
      this.snowRockMat.emissive.set('#b8c8e0');
      this.snowRockMat.emissiveIntensity = hovered ? 0.18 : state.pending ? 0.05 * pulse : 0;
    } else if (id === IDS.frankenstein) {
      for (const m of this.frankenstein.materials) {
        m.emissive.set('#5a4a30');
        m.emissiveIntensity = hovered ? 0.3 : state.pending ? 0.06 * pulse : 0;
      }
    } else if (id === IDS.shadow) {
      this.bandSheen.material.opacity = hovered ? 0.14 : state.pending ? 0.05 * pulse : 0;
    } else if (id === IDS.valley) {
      this.valleyGlow = hovered ? 1.12 : state.pending ? 1 + 0.04 * pulse : 1; // applied in onUpdate
    } else if (id === IDS.hand) {
      const skin = this.monster.materials.skin;
      skin.emissive.set('#5a4a2a');
      skin.emissiveIntensity = hovered ? 0.35 : state.pending ? 0.08 * pulse : 0;
    }
  }

  async prepareQuote(quote) {
    const id = quote.objectId;
    const first = ORDER[this.step] === id && !this.tracker.isViewed(quote);
    const moves = [this.flyTo(VIEW_FOR[id], id === IDS.valley ? 2.6 : first ? 1.8 : 1.4)];
    if (first) moves.push((this.sequence = this.#before(id)));
    await Promise.all(moves);
    if (first && !REDUCED_MOTION) await wait(0.5);
  }

  onQuoteClosed(quote, { viewed }) {
    const id = quote.objectId;
    if (ORDER[this.step] !== id) return;
    if (!viewed) {
      this.#undo(id);
      return;
    }
    this.step++;
    this.sequence = this.#runAfter(id);
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

  #frankensteinHead(target = new THREE.Vector3()) {
    return this.frankenstein.joints.head.getWorldPosition(target).add(_v.set(0, 0.1, 0));
  }

  /** On arrival: the Monster walks calmly up to Frankenstein. */
  async #approach() {
    this.setInteractive(false);
    const M = this.monster;
    const F = this.frankenstein;
    F.lookAt(M.eyePosition(new THREE.Vector3()));
    M.lookAt(this.#frankensteinHead());
    M.setPose(POSE.calm, { weight: 0.5, rate: 1.5 });
    await M.walkTo(SPOTS.calm, 0.55);
    M.facing = Math.PI / 2;
    M.setPose(POSE.calm, { rate: 1.6 });
    F.setPose(VICTOR.wary, { rate: 1.5 });
    await this.#pause(0.8);
    if (this.disposed || this.leaving) return;
    this.phase = 'talking';
    this.setInteractive(true);
  }

  #before(id) {
    const M = this.monster;
    const F = this.frankenstein;
    if (id === IDS.frankenstein) {
      return (async () => {
        M.setPose(POSE.calm, { weight: 0.6, rate: 2 });
        await M.walkTo(SPOTS.step, 0.5);
        M.facing = Math.PI / 2;
        M.setPose(POSE.calm, { rate: 2 });
        M.reachTowards(this.#frankensteinHead().add(_v.set(-0.4, -0.45, 0)), 'R'); // an open hand held out to him
        F.setPose(VICTOR.wary, { rate: 2.5 });
        await this.#pause(1.0);
      })();
    }
    if (id === IDS.valley) {
      return (async () => {
        M.reachTowards(null);
        M.turnRate = 1.6;
        M.facing = Math.PI * 0.88; // turned toward the valley, below and away
        M.setPose(POSE.look, { rate: 1.5 });
        M.lookAt(new THREE.Vector3(VALLEY.village.x, VALLEY.y, VALLEY.village.z));
        F.lookAt(M.eyePosition(new THREE.Vector3()));
        await this.#pause(1.6);
      })();
    }
    if (id === IDS.hand) {
      return (async () => {
        M.setPose(POSE.fist, { rate: 2.6 });
        M.lookAt(this.#frankensteinHead());
        await this.#pause(1.2);
      })();
    }
    return Promise.resolve();
  }

  async #runAfter(id) {
    const M = this.monster;
    const F = this.frankenstein;
    this.setInteractive(false);
    if (id === IDS.overlook || id === IDS.shadow) await this.flyTo('home', 1.8);
    else if (id === IDS.frankenstein) {
      M.reachTowards(null);
      await this.#pause(0.6);
    } else if (id === IDS.valley) {
      // They begin to argue: he turns back; Frankenstein refuses him; the Monster leans in, fists clenching.
      this.phase = 'arguing';
      this.flyTo('home', 2.4);
      M.facing = Math.PI / 2;
      M.lookAt(this.#frankensteinHead());
      await this.#pause(1.0);
      F.setTalking(true);
      F.setPose(VICTOR.refuse, { rate: 2.4 });
      await this.#pause(1.4);
      M.setPose(POSE.confront, { rate: 2.2 });
      M.clench(true);
      M.setMouthing(true);
      await this.#pause(1.8);
      M.setMouthing(false);
    } else if (id === IDS.hand) {
      // He turns away from Frankenstein.
      this.phase = 'apart';
      M.setMouthing(false);
      F.setTalking(false);
      M.setPose(POSE.rigid, { weight: 0.7, rate: 2 });
      M.lookAt(null);
      M.turnRate = 2;
      await M.walkTo(SPOTS.away, 0.6);
      M.facing = -Math.PI * 0.62; // his back to Frankenstein, toward the valley
      M.setPose(POSE.rigid, { rate: 2 });
      F.setPose(VICTOR.turned, { rate: 1.5 });
      F.lookAt(M.eyePosition(new THREE.Vector3()));
      await this.flyTo('end', 2.6);
    }
    if (this.disposed || this.leaving) return;
    this.setInteractive(true);
  }

  #undo(id) {
    const M = this.monster;
    if (id === IDS.frankenstein) M.reachTowards(null);
    if (id === IDS.valley) {
      M.facing = Math.PI / 2;
      M.lookAt(this.#frankensteinHead());
    }
    if (id === IDS.hand) M.setPose(POSE.confront, { rate: 2 });
  }

  #placeAtEnd() {
    const M = this.monster;
    const F = this.frankenstein;
    this.phase = 'apart';
    M.move?.resolve();
    M.move = null;
    M.setAnimation('idle');
    M.reachTowards(null);
    M.setMouthing(false);
    M.object.position.set(SPOTS.away.x, 0, SPOTS.away.z);
    M.object.rotation.y = -Math.PI * 0.62;
    M.facing = -Math.PI * 0.62;
    M.setPose(POSE.rigid, { immediate: true });
    M.clench(true);
    F.setTalking(false);
    F.setPose(VICTOR.turned);
    this.flyTo('end', 2);
  }

  // ─── Per frame ──────────────────────────────────────────────────────────────

  onUpdate(dt, t) {
    if (this.phase === 'arriving' && this.interactive && !this.approaching) {
      this.approaching = true;
      this.sequence = this.#approach();
    }
    this.cloudOffset.x += dt * 0.006;
    this.cloudOffset.y += dt * 0.002;
    const S = this.sky.update(this.dayTime, { dayTop: visualParams.skyTop, dayHorizon: visualParams.skyHorizon, time: t, cloudOffset: this.cloudOffset, center: this.camera.position });
    const L = visualParams.lightIntensity;
    this.lights.key.position.copy(this.sunDir).multiplyScalar(50);

    // Distance haze: warm in the afternoon light, so the valley reads golden rather than grey.
    HAZE.uHazeColor.value.copy(S.horizon).lerp(_c.set('#f0d6a4'), 0.55).multiplyScalar(0.75 + 0.25 * L);
    HAZE.uHazeDensity.value = 0.00004;
    // The valley keeps its unfaded colour and light; around the Monster they drain with Unity.
    KEEP.uKeepBelowY.value = VALLEY.y + 480;
    KEEP.uKeepBelowSaturation.value = VALLEY_SATURATION / Math.max(0.05, visualParams.saturation);
    KEEP.uKeepBelowLight.value = (this.base.lightIntensity / Math.max(0.05, L)) * (this.valleyGlow ?? 1);
    DRAIN.uDrain.value = nihilism.displayed.unity;
    DRAIN.uDrainCenter.value.copy(this.monster.object.position);
    DRAIN.uDrainRadius.value.set(1, 3.4);

    this.mist.uniforms.uColor.value.copy(S.mistColor).lerp(_c.set('#ffffff'), 0.4).multiplyScalar(0.6 + 0.4 * L);
    this.mist.uniforms.uOpacity.value = 0.3;
    this.mist.uniforms.uTime.value = t * 2;

    this.frankenstein.update(dt);
    this.monster.parts.handR.getWorldPosition(this.handHit.position);
  }
}

const _c = new THREE.Color();
