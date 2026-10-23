import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { IS_COARSE_POINTER } from '../../core/renderer.js';
import { wait } from '../../core/tween.js';
import { visualParams } from '../../nihilism/nihilism.js';
import { Person, FRANKENSTEIN_STYLE } from '../../people/Person.js';
import { DaySky } from '../nature/sky.js';
import { Rng, fbm2, smoothstep } from '../nature/random.js';
import { snowTextures, barkTextures, needleSprayTexture } from '../nature/textures.js';
import { createGround, groundSurfaceAt, groundNormalAt, groundMaterial, rockGeometry, scatter } from '../nature/ground.js';
import { broadleafTree, coniferTree, silhouetteGeometries, cardsToInstances, cardGeometry, mergeGeometries } from '../nature/trees.js';
import { WIND, applyWind, windDepthMaterial } from '../nature/wind.js';
import { createSnowfall } from '../nature/snowfall.js';
import { noteTexture } from '../buildings/textures.js';
import { HAZE, applyHaze } from '../grading.js';

/**
 * The path to Rural Russia — scene 5 (data: public/json/scenes/pathToRuralRussia.json).
 *
 * Built to the students' brief: a long path through a remote, snowy country, with trees
 * and rocks in the background and hills far away. Frankenstein follows the Monster along
 * it; the Monster, further ahead, stops twice to leave a message, and after each one he
 * looks back toward Frankenstein. The two messages are the scene's components.
 *
 * The path is a ribbon laid on the snow (it shares the ground's material, so its edges
 * blend in) that winds about a kilometre toward the hills. Distance is a haze rather than
 * fog, so the far hills stay visible at this scene's coefficient; a light snow falls.
 *
 * SEQUENCE ─ both components are required, in order; each message is placed before it can
 * be clicked, and the camera moves to it before its menu opens.
 *   arrival   the Monster walks on ahead, pins note 1 to a tree beside the path, steps back
 *             onto the path and looks back toward Frankenstein, who has followed
 *   1 note 1  the camera goes close to the note on the tree. Afterwards the Monster walks on,
 *             kneels and leaves note 2 against a small rock at the side of the path, and again
 *             looks back; Frankenstein follows
 *   2 note 2  the camera looks down at the note by the rock. Afterwards the Monster walks on
 *             along the path, still ahead of Frankenstein
 */

const IDS = { note1: 'pathToRuralRussia-note1', note2: 'pathToRuralRussia-note2' };
const ORDER = [IDS.note1, IDS.note2];

const SKY = { latitude: 57, declination: -20, sunElevation: 13, sunToward: [-0.75, 0.66] }; // a low winter sun behind the camera, to the left

// ─── The path ───────────────────────────────────────────────────────────────
// Its centre line, (x, z) in metres, from behind the camera away toward the far hills (−Z).
const PATH_POINTS = [
  [1.0, 40], [0.5, 12], [0, -8], [-0.4, -28], [0.4, -48], [2.2, -70], [4.2, -96], [4.4, -126], [1, -160], [-5, -205],
  [-10, -260], [-9, -320], [-2, -390], [8, -470], [13, -560], [9, -660], [0, -760], [-8, -870], [-12, -1000],
];
const PATH = (() => {
  const curve = new THREE.CatmullRomCurve3(PATH_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pts = curve.getSpacedPoints(6000);
  return { curve, zs: pts.map((p) => p.z), xs: pts.map((p) => p.x) };
})();

/** x of the path's centre line at z (the line only ever heads one way in z). */
function pathX(z) {
  const { zs, xs } = PATH;
  if (z >= zs[0]) return xs[0];
  if (z <= zs[zs.length - 1]) return xs[xs.length - 1];
  let lo = 0;
  let hi = zs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (zs[mid] > z) lo = mid;
    else hi = mid;
  }
  return xs[lo] + ((xs[hi] - xs[lo]) * (z - zs[lo])) / (zs[hi] - zs[lo]);
}

/** The snowfields: gentle near the figures, broad swells further out, hills far away. */
function heightAt(x, z) {
  const px = pathX(z);
  const dp = Math.abs(x - px);
  const near = smoothstep(25, 140, Math.hypot(x, z + 15));
  const swell = (u) => (fbm2(u * 0.03, z * 0.03, 2, 3) - 0.5) * 1.4 + (fbm2(u * 0.008 + 4, z * 0.008, 3, 5) - 0.5) * 16 * near;
  // Along the path the ground is smoother: it keeps to the easy line.
  let h = THREE.MathUtils.lerp(swell(px), swell(x), smoothstep(1.5, 9, dp));
  const d = Math.hypot(x * 0.75, z + 300);
  h += smoothstep(300, 900, d) * (fbm2(x * 0.002, z * 0.002, 3, 11) - 0.5) * 20; // long low rises on the plain
  h += smoothstep(900, 2400, d) * (150 + 300 * fbm2(x * 0.0007 + 9, z * 0.0007, 4, 7)); // the far hills
  return h;
}

/** Where woods stand: on parts of the plain and the far hills, never close to the path. */
function woodAt(x, z) {
  return smoothstep(0.6, 0.66, fbm2(x * 0.004 + 2, z * 0.004, 3, 13)) * smoothstep(140, 260, Math.hypot(x, z + 15));
}

const onPath = (z, offset = 0) => new THREE.Vector3(pathX(z) + offset, 0, z);
const ground = (v, y = 0) => v.setY(heightAt(v.x, v.z) + y);

// ─── Where things are ───────────────────────────────────────────────────────

/** The note tree, right of the path, and the note on the side of its trunk facing back down the path. */
const TREE = { z: -21.5, offset: 1.75, height: 10, radius: 0.3, noteHeight: 1.62 };
TREE.x = pathX(TREE.z) + TREE.offset;
TREE.facing = new THREE.Vector3(pathX(TREE.z + 1.4) - TREE.x, 0, 1.4).normalize();

/** The small rock, left of the path; the note leans against its side facing back down the path (and the low sun). */
const ROCK = { z: -29, offset: -1.3, radius: 0.26 };
ROCK.x = pathX(ROCK.z) + ROCK.offset;
ROCK.facing = new THREE.Vector3(0.45, 0, 1).normalize();

const SPOTS = {
  monsterStart: onPath(-16),
  atTree: new THREE.Vector3(TREE.x, 0, TREE.z).addScaledVector(TREE.facing, 0.95),
  afterTree: onPath(TREE.z - 1.0),
  atRock: new THREE.Vector3(ROCK.x, 0, ROCK.z).addScaledVector(ROCK.facing, 1.0),
  afterRock: onPath(ROCK.z - 1.4),
  onward: onPath(-50),
  frankenstein: [onPath(-5.5), onPath(-11), onPath(-13.5), onPath(-14)], // where he starts and where he stops each time
};

// Where the notes will be, for framing the views (note 1 is fitted to the real bark when it is built).
const NOTE1_AT = ground(new THREE.Vector3(TREE.x, 0, TREE.z).addScaledVector(TREE.facing, TREE.radius * 0.86), TREE.noteHeight);
const NOTE2_AT = ground(new THREE.Vector3(ROCK.x, 0, ROCK.z).addScaledVector(ROCK.facing, ROCK.radius + 0.06), 0.12);

const view = (x, y, z, target, fov, needs) => ({ position: ground(new THREE.Vector3(x, 0, z), y).toArray(), target: target.toArray(), fov, needs });
const VIEWS = {
  home: view(2.2, 2.0, 2.5, ground(onPath(-24, -0.2), 1.0), 36, 13),
  note1: {
    position: NOTE1_AT.clone().addScaledVector(TREE.facing, 1.25).add(new THREE.Vector3(0, 0.08, 0)).toArray(),
    target: NOTE1_AT.clone().add(new THREE.Vector3(0, -0.03, 0)).toArray(),
    fov: 38,
    needs: 9,
  },
  follow: view(3.4, 2.2, -2.5, ground(onPath(-28, -0.6), 0.9), 34, 13), // Frankenstein, the Monster at the rock, the note tree: left to right
  // From the path side, a little above: the note against its rock (the Monster just out of shot).
  note2: {
    position: NOTE2_AT.clone().add(new THREE.Vector3(0.9, 0.85, 1.0)).toArray(),
    target: NOTE2_AT.clone().add(new THREE.Vector3(0, -0.02, 0)).toArray(),
    fov: 40,
    needs: 10,
  },
  end: view(-2.8, 2.6, -6.0, ground(onPath(-75), 2.0), 42, 20), // left of the path, so the note tree stands aside
};

/** Lines of sight (on the ground plan) that trees must keep clear of. */
const SIGHT_LINES = [
  [VIEWS.home.position, SPOTS.atTree], [VIEWS.home.position, SPOTS.frankenstein[1]], [VIEWS.home.position, NOTE1_AT],
  [VIEWS.follow.position, SPOTS.atRock], [VIEWS.follow.position, SPOTS.frankenstein[2]], [VIEWS.follow.position, NOTE2_AT],
  [VIEWS.note1.position, NOTE1_AT], [VIEWS.note2.position, NOTE2_AT], [VIEWS.end.position, SPOTS.onward],
].map(([a, b]) => [new THREE.Vector2(a[0] ?? a.x, a[2] ?? a.z), new THREE.Vector2(b.x, b.z)]);

/** The Monster's poses (conventions in Monster.js POSES). */
const POSE = {
  pin: { hipsY: 1.15, joints: { spine: [0.1, 0, 0], chest: [0.06, 0, 0] } },
  kneel: {
    hipsY: 0.62,
    hipsX: 0.3,
    joints: {
      legL: [-0.6, 0, 0.12], kneeL: [1.9, 0, 0], legR: [-0.6, 0, -0.12], kneeR: [1.9, 0, 0],
      spine: [0.48, 0, 0], chest: [0.3, 0, 0],
      shoulderL: [-0.75, 0, 0.18], elbowL: [-0.3, 0, 0], shoulderR: [-0.55, 0, -0.18], elbowR: [-0.45, 0, 0],
    },
    skirt: { rotationX: -0.5, scaleY: 0.7, scaleXZ: 1.15 },
  },
};

/** Frankenstein's pose while he follows: leaning a little into the cold, arms down. */
const VICTOR = {
  follow: { joints: { spine: [0.12, 0, 0], chest: [0.05, 0, 0], shoulderL: [0.06, 0, 0.1], elbowL: [-0.3, 0, 0], shoulderR: [0.06, 0, -0.1], elbowR: [-0.3, 0, 0] } },
};

const LOW = IS_COARSE_POINTER;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;
const LIGHT = { key: 2.6, hemi: 2.1 };
const HAZE_PER_FOG = 0.012; // haze density per unit of the coefficient's fog density
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Vector3();

export default class PathToRuralRussiaScene extends BaseScene {
  static cameraHome = { position: VIEWS.home.position, target: VIEWS.home.target };

  constructor(args) {
    super(args);
    this.useViews(VIEWS);
    this.camera.near = 0.15;
    this.camera.far = 12000; // the hills are kilometres away
    this.camera.updateProjectionMatrix();
    this.step = 0;
    this.phase = 'arriving'; // arriving → note1 → note2 → onward
    this.baseView = 'home'; // where the camera returns between components
    this.sequence = Promise.resolve();
    this.disposables = [];
    this.cloudOffset = new THREE.Vector2(1.3, 0.4);
    this.monsterWatches = false; // his eyes on Frankenstein (updated every frame while Frankenstein moves)
  }

  entryPosition(home) {
    return home.clone().add(new THREE.Vector3(0, 30, 8));
  }

  exitPosition(from) {
    return from.clone().add(new THREE.Vector3(0, 34, 6));
  }

  /** The views down the path look almost level, lower than the usual orbit limit allows. */
  limitOrbit(view) {
    super.limitOrbit(view);
    const s = new THREE.Spherical().setFromVector3(_v.subVectors(view.position, view.target));
    this.controls.maxPolarAngle = Math.min(1.565, s.phi + 0.06);
  }

  /** The height of the drawn snow under a point near the figures. */
  groundY(x, z) {
    return groundSurfaceAt(this.near, x, z);
  }

  // ─── Build ──────────────────────────────────────────────────────────────────

  buildEnvironment() {
    this.sky = new DaySky({ latitude: SKY.latitude, declination: SKY.declination, cloudCover: 0.72 });
    this.dayTime = this.#afternoonAt(SKY.sunElevation);
    const [sx, sz] = SKY.sunToward;
    this.sky.aimMoon(this.dayTime, new THREE.Vector3(-sx, 0, -sz)); // the moon is opposite the sun
    this.sunDir = this.sky.bodiesAt(this.dayTime).sun.clone();
    this.scene.add(this.sky.mesh);
    this.scene.fog = null; // distance is handled by the haze, so the far hills stay visible

    const key = new THREE.DirectionalLight('#ffe9d2', LIGHT.key);
    key.castShadow = true;
    const size = LOW ? 1024 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 220 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.04;
    const hemi = new THREE.HemisphereLight('#b4c3d6', '#dfe4ea', LIGHT.hemi); // the snow lights things from below
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
    const tex = snowTextures({ size: LOW ? 512 : 1024 });
    this.textures = { grassMap: tex.snowMap, litterMap: tex.trodMap, normalMap: tex.normalMap }; // the path blends to trodden snow
    this.disposables.push(tex.snowMap, tex.trodMap, tex.normalMap);
    const tint = (x, z, c) => {
      const n = fbm2(x * 0.05, z * 0.05, 2, 21);
      c.setRGB(0.92 + 0.05 * n, 0.94 + 0.05 * n, 1.0); // snow, faintly blue
      c.lerp(_c.setRGB(0.25, 0.29, 0.25), woodAt(x, z) * 0.8); // woods seen from afar
    };
    // A detailed mesh around the figures and the near path, and one out to the far hills;
    // the far one dips just under the near one where they overlap.
    this.near = createGround({ size: 300, segments: LOW ? 260 : 340, power: 1.6, heightAt, tintAt: tint, textures: this.textures, tile: 4 });
    const farHeight = (x, z) => heightAt(x, z) - 3 * (1 - smoothstep(142, 148, Math.max(Math.abs(x), Math.abs(z))));
    this.far = createGround({ size: 10000, segments: LOW ? 240 : 320, power: 2.6, heightAt: farHeight, tintAt: tint, textures: this.textures, tile: 4 });
    this.far.receiveShadow = false;
    for (const g of [this.near, this.far]) g.material.normalScale.set(0.5, 0.5); // shallow: a low sun exaggerates relief
    this.scene.add(this.near, this.far);
    this.#buildPath(tint);
    this.#buildTrees();
    this.#buildRocks();
    this.snow = createSnowfall({ count: LOW ? 1400 : 2600 });
    this.scene.add(this.snow.points);
  }

  /** The drawn surface (and its normal): the near mesh where it is, the far one beyond. */
  #surfaceAt(x, z) {
    return groundSurfaceAt(this.#meshAt(x, z), x, z);
  }

  #normalAt(x, z, target) {
    return groundNormalAt(this.#meshAt(x, z), x, z, target);
  }

  #meshAt(x, z) {
    return Math.max(Math.abs(x), Math.abs(z)) < 149 ? this.near : this.far;
  }

  /**
   * The path: a ribbon on the snow, two trodden ruts with a ridge between, its edges
   * the same colour and texture as the snow beside it so it has no visible border.
   */
  #buildPath(tint) {
    const profile = [
      [-1.5, 1, 1], [-1.0, 0.86, 0.96], [-0.62, 0.52, 0.88], [-0.36, 0.66, 0.92], [-0.12, 0.74, 0.94],
      [0.12, 0.74, 0.94], [0.36, 0.66, 0.92], [0.62, 0.52, 0.88], [1.0, 0.86, 0.96], [1.5, 1, 1],
    ];
    const curve = PATH.curve;
    const length = curve.getLength();
    const ts = [];
    for (let s = 0; s <= length; ) {
      ts.push(s / length);
      const z = curve.getPointAt(s / length).z;
      s += Math.abs(z) < 90 ? 0.5 : Math.abs(z) < 260 ? 1.5 : 4;
    }
    const cols = profile.length;
    const positions = new Float32Array(ts.length * cols * 3);
    const normals = new Float32Array(ts.length * cols * 3);
    const uvs = new Float32Array(ts.length * cols * 2);
    const grass = new Float32Array(ts.length * cols);
    const colors = new Float32Array(ts.length * cols * 3);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    const c = new THREE.Color();
    let k = 0;
    for (const u of ts) {
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      side.set(-t.z, 0, t.x).normalize();
      const lift = 0.025 + 0.0006 * Math.hypot(p.x, p.z); // beats depth precision far away
      for (const [o, g, shade] of profile) {
        const x = p.x + side.x * o;
        const z = p.z + side.z * o;
        positions.set([x, this.#surfaceAt(x, z) + lift, z], k * 3);
        this.#normalAt(x, z, _v);
        normals.set([_v.x, _v.y, _v.z], k * 3); // the snow's own normal, so the two light alike at a low sun
        uvs.set([x / 4, -z / 4], k * 2); // the ground's own tiling, so the snow texture runs on across the edge
        grass[k] = g;
        tint(x, z, c.set(1, 1, 1));
        colors.set([c.r * shade, c.g * shade * 0.99, c.b * shade * 0.97], k * 3);
        k++;
      }
    }
    const indices = [];
    for (let i = 0; i < ts.length - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = a + cols;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    const material = groundMaterial(this.textures);
    Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    material.normalScale.set(0.5, 0.5);
    this.path = new THREE.Mesh(geo, material);
    this.path.receiveShadow = true;
    this.scene.add(this.path);
  }

  #clearOfSight(x, z, r) {
    const q = _v.set(x, 0, z);
    for (const [a, b] of SIGHT_LINES) {
      const ab = _w.set(b.x - a.x, 0, b.y - a.y);
      const len2 = ab.lengthSq();
      const s = THREE.MathUtils.clamp(((q.x - a.x) * ab.x + (q.z - a.y) * ab.z) / len2, 0, 1);
      if (Math.hypot(q.x - (a.x + ab.x * s), q.z - (a.y + ab.z * s)) < r) return false;
    }
    return true;
  }

  #buildTrees() {
    const rng = new Rng(5757);
    const bark = barkTextures();
    this.barkMaterial = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, vertexColors: true, roughness: 0.95 });
    const wood = [];
    const needles = [];
    const placed = [{ x: TREE.x, z: TREE.z, spacing: 5 }, { x: ROCK.x, z: ROCK.z, spacing: 3 }];
    const turn = new THREE.Quaternion();
    const add = (tree) => {
      wood.push(...tree.wood);
      for (const card of tree.cards) {
        if (card.kind !== 'needle') continue; // broadleaf trees stand bare in winter
        needles.push(card);
        // A second spray beside each one, turned about the trunk, so the crowns read as full.
        turn.setFromAxisAngle(UP, rng.float(0.35, 0.6) * (rng.chance(0.5) ? 1 : -1));
        needles.push({ ...card, quaternion: turn.clone().multiply(card.quaternion), normal: card.normal.clone().applyQuaternion(turn), scale: card.scale * 0.92 });
      }
    };
    const barkTint = () => {
      const v = rng.float(0.78, 1.0);
      return new THREE.Color(v, v * 0.95, v * 0.9);
    };

    // The note tree: a bare tree right beside the path.
    const noteTree = broadleafTree(new Rng(61), { x: TREE.x, z: TREE.z, height: TREE.height, radius: TREE.radius, detail: 1, groundY: heightAt(TREE.x, TREE.z), tint: new THREE.Color(0.9, 0.88, 0.85), wobble: 0.02 });
    add(noteTree);
    this.noteTrunk = new THREE.Mesh(noteTree.wood[0].clone(), new THREE.MeshBasicMaterial()); // for fitting the note to its bark; not drawn

    const ok = (x, z, spacing) => placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= Math.min(spacing, p.spacing) ** 2);
    const scatterTrees = ({ count, r0, r1, spacing, detail, clumped }) => {
      for (let i = 0, n = 0; i < count * 30 && n < count; i++) {
        const x = rng.float(-r1, r1);
        const z = -15 + rng.float(-r1, r1 * 0.35); // mostly ahead, where the camera looks
        const r = Math.hypot(x, z + 15);
        if (r < r0 || r > r1) continue;
        const dp = Math.abs(x - pathX(z));
        if (dp < (detail ? 4.5 : 8) || !this.#clearOfSight(x, z, 1.3) || !ok(x, z, spacing)) continue;
        if (clumped && fbm2(x * 0.02, z * 0.02, 2, 31) < 0.58) continue; // in small stands, open snow between
        if (!detail && Math.abs(Math.atan2(x - VIEWS.home.position[0], -(z - VIEWS.home.position[2]))) < 7 * DEG) continue; // the hills stay in view down the path
        const conifer = rng.chance(0.72);
        const groundY = heightAt(x, z);
        if (conifer) add(coniferTree(rng, { x, z, groundY, height: rng.float(9, 17), radius: rng.float(0.2, 0.32), detail, tint: barkTint() }));
        else add(broadleafTree(rng, { x, z, groundY, height: rng.float(8, 13), radius: rng.float(0.2, 0.3), detail, tint: barkTint() }));
        placed.push({ x, z, spacing });
        n++;
      }
    };
    scatterTrees({ count: LOW ? 5 : 8, r0: 0, r1: 60, spacing: 9, detail: 1 }); // a few near the path
    scatterTrees({ count: LOW ? 30 : 50, r0: 60, r1: 220, spacing: 5, detail: 0, clumped: true }); // stands in the background

    const woodMesh = new THREE.Mesh(mergeGeometries(wood), this.barkMaterial);
    woodMesh.castShadow = woodMesh.receiveShadow = true;
    wood.forEach((g) => g.dispose());
    this.scene.add(woodMesh);

    const needleTex = needleSprayTexture();
    const needleMat = applyWind(
      new THREE.MeshStandardMaterial({ map: needleTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 }),
      { sway: 0.04, flutter: 0.008, leafNormals: true },
    );
    const needleDepth = windDepthMaterial(needleTex, 0.5, { sway: 0.04, flutter: 0.008 });
    this.disposables.push(needleDepth);
    const greens = (card, i, c) => c.setRGB(rng.float(0.7, 0.95), rng.float(0.8, 1.0), rng.float(0.8, 1.0));
    this.scene.add(cardsToInstances(needles, cardGeometry({ anchored: true, aspect: 0.5 }), needleMat, { colorFor: greens, depthMaterial: needleDepth }));

    // Woods further off: dark spruce silhouettes, in the same patches the ground is tinted for.
    const sil = silhouetteGeometries(rng);
    const far = [];
    for (let i = 0; i < 90000 && far.length < (LOW ? 700 : 1300); i++) {
      const x = rng.float(-1400, 1400);
      const z = rng.float(-1500, 200);
      const r = Math.hypot(x, z + 15);
      if (r < 160 || Math.abs(x - pathX(z)) < 12) continue;
      if (rng.next() > woodAt(x, z) * 0.9 + (r < 700 ? 0.012 : 0)) continue;
      const h = rng.float(11, 19);
      far.push({ position: new THREE.Vector3(x, heightAt(x, z) - 0.3, z), rotationY: rng.float(0, 6.3), scale: new THREE.Vector3(h * rng.float(0.8, 1.2), h, h * rng.float(0.8, 1.2)), color: new THREE.Color().setRGB(0.1, 0.13, 0.11).multiplyScalar(rng.float(0.8, 1.25)) });
    }
    this.scene.add(scatter(sil.conifer, new THREE.MeshLambertMaterial({ color: 0xffffff }), far, { receiveShadow: false }));
  }

  /** How far in front of `point` (along `normal`) the note tree's bark is, or null if the ray misses it. */
  #barkDepth(point, normal) {
    const ray = (this._barkRay ??= new THREE.Raycaster());
    ray.set(_v.copy(point).addScaledVector(normal, 0.6), _w.copy(normal).negate());
    const hit = ray.intersectObject(this.noteTrunk)[0];
    return hit ? 0.6 - hit.distance : null;
  }

  #buildRocks() {
    const rng = new Rng(29);
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    // Grey stone with snow lying on its upper faces.
    const snowy = () => {
      const g = rockGeometry(rng, { moss: 0 });
      const col = g.attributes.color;
      const nor = g.attributes.normal;
      for (let i = 0; i < col.count; i++) {
        const snow = smoothstep(0.42, 0.75, nor.getY(i));
        const v = rng.float(0.3, 0.42);
        col.setXYZ(i, THREE.MathUtils.lerp(v, 0.93, snow), THREE.MathUtils.lerp(v * 0.98, 0.95, snow), THREE.MathUtils.lerp(v * 0.95, 1.0, snow));
      }
      return g;
    };
    const geos = [snowy(), snowy(), snowy()];
    const groups = [[], [], []];
    const add = (x, z, s) => groups[rng.int(0, 2)].push({
      position: new THREE.Vector3(x, heightAt(x, z) - s * 0.3, z),
      rotationY: rng.float(0, 6.3),
      tiltX: rng.float(-0.2, 0.2),
      scale: new THREE.Vector3(s * rng.float(0.9, 1.5), s * rng.float(0.6, 1.0), s * rng.float(0.9, 1.4)),
    });
    for (let i = 0, n = 0; i < 4000 && n < (LOW ? 60 : 110); i++) {
      const x = rng.float(-160, 160);
      const z = rng.float(-200, 30);
      const dp = Math.abs(x - pathX(z));
      if (dp < 2.2 || Math.hypot(x - ROCK.x, z - ROCK.z) < 2.5 || !this.#clearOfSight(x, z, 0.9)) continue;
      add(x, z, dp < 12 ? rng.float(0.18, 0.5) : rng.float(0.4, 1.6));
      n++;
    }
    groups.forEach((items, i) => this.scene.add(scatter(geos[i], this.rockMat, items, { castShadow: true })));

    // The small rock at the side of the path, by which the second note is left.
    this.noteRock = new THREE.Mesh(snowy(), this.rockMat);
    this.noteRock.scale.set(ROCK.radius * 1.25, ROCK.radius * 0.95, ROCK.radius * 1.05);
    this.noteRock.position.set(ROCK.x, heightAt(ROCK.x, ROCK.z) + ROCK.radius * 0.1, ROCK.z);
    this.noteRock.rotation.y = 0.6;
    this.noteRock.castShadow = this.noteRock.receiveShadow = true;
    this.scene.add(this.noteRock);
  }

  buildForeground() {
    this.frankenstein = new Person(FRANKENSTEIN_STYLE);
    const F = this.frankenstein;
    const start = SPOTS.frankenstein[0];
    F.object.position.set(start.x, this.groundY(start.x, start.z), start.z);
    F.object.rotation.y = Math.PI; // facing along the path, away from the camera
    F.facing = Math.PI;
    F.setPose(VICTOR.follow);
    F.update(0);
    this.scene.add(F.object);
  }

  placeMonster(monster) {
    const S = SPOTS.monsterStart;
    monster.object.position.set(S.x, this.groundY(S.x, S.z), S.z);
    monster.object.rotation.y = Math.PI;
    monster.facing = Math.PI;
  }

  buildInteractables() {
    const tex = noteTexture();
    const note = () => new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, emissive: new THREE.Color('#6a5530'), emissiveIntensity: 0 });
    this.noteMats = { [IDS.note1]: note(), [IDS.note2]: note() };
    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    const W = 0.2;
    const H = 0.25;

    // Note 1, pinned to the bark: every vertex of the sheet laid onto the real trunk (which is
    // not quite round), just proud of it, with a nail at the top.
    const n1 = TREE.facing;
    const side1 = new THREE.Vector3().crossVectors(UP, n1);
    const centre = new THREE.Vector3(TREE.x, heightAt(TREE.x, TREE.z) + TREE.noteHeight, TREE.z);
    centre.addScaledVector(n1, this.#barkDepth(centre, n1) ?? TREE.radius * 0.86);
    const sheet = new THREE.PlaneGeometry(W, H, 8, 6).rotateZ(0.04);
    const pos = sheet.attributes.position;
    const onBark = (x, y) => this.#barkDepth(_c2.copy(centre).addScaledVector(side1, x).addScaledVector(UP, y), n1) ?? -0.03;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, onBark(pos.getX(i), pos.getY(i)) + 0.007);
    sheet.computeVertexNormals();
    const paper1 = new THREE.Mesh(sheet, this.noteMats[IDS.note1]);
    paper1.castShadow = true;
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.5, metalness: 0.4 }));
    nail.position.set(-H * 0.38 * Math.sin(0.04), H * 0.38 * Math.cos(0.04), 0);
    nail.position.z = onBark(nail.position.x, nail.position.y) + 0.011;
    this.note1At = centre;
    const group1 = this.#noteGroup(IDS.note1, centre, [paper1, nail], invisible);
    group1.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side1, UP, n1));
    this.noteTrunk.geometry.dispose();

    // Note 2, leaning against the small rock on the path side, its foot in the snow.
    const h = ROCK.facing;
    const normal = h.clone().multiplyScalar(Math.cos(30 * DEG)).addScaledVector(UP, Math.sin(30 * DEG));
    const along = h.clone().multiplyScalar(-Math.sin(30 * DEG)).addScaledVector(UP, Math.cos(30 * DEG));
    const right = new THREE.Vector3().crossVectors(along, normal);
    const foot = new THREE.Vector3(ROCK.x, 0, ROCK.z).addScaledVector(h, ROCK.radius * 1.12 + 0.1);
    foot.y = this.groundY(foot.x, foot.z) + 0.01;
    this.note2At = foot.clone().addScaledVector(along, H / 2);
    this.note2Normal = normal;
    const paper2 = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.noteMats[IDS.note2]);
    paper2.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, along, normal)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.12));
    paper2.castShadow = true;
    const group2 = this.#noteGroup(IDS.note2, this.note2At, [paper2], invisible);

    this.noteGroups = { [IDS.note1]: group1, [IDS.note2]: group2 };
    this.addComponentLabel(IDS.note1, (t) => t.copy(this.note1At).add(_w.set(0, 0.3, 0)));
    this.addComponentLabel(IDS.note2, (t) => t.copy(this.note2At).add(_w.set(0, 0.42, 0)));
    this.#grade();
  }

  /** A note and its (larger, invisible) click target, hidden until the Monster leaves it. */
  #noteGroup(id, at, parts, invisible) {
    const group = new THREE.Group();
    group.position.copy(at);
    for (const p of parts) group.add(p);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), invisible);
    group.add(hit);
    group.userData.lookPoint = at.clone();
    group.visible = false;
    this.scene.add(group);
    this.registerInteractable(id, group);
    return group;
  }

  /** Distance haze on everything, in place of fog. */
  #grade() {
    this.scene.traverse((o) => {
      if (!o.isMesh || o === this.sky.mesh) return;
      for (const m of [].concat(o.material ?? [])) {
        if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial) || m.visible === false) continue;
        applyHaze(m);
      }
    });
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  styleInteractable(object, state, t) {
    const mat = this.noteMats[object.userData.pickId];
    if (!mat) return;
    const hovered = state.hovered && state.active;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    mat.emissiveIntensity = hovered ? 0.55 : state.pending ? 0.18 * pulse : 0;
  }

  async prepareQuote(quote) {
    await this.flyTo(quote.objectId === IDS.note1 ? 'note1' : 'note2', 1.8);
    if (!REDUCED_MOTION) await wait(0.3);
  }

  onQuoteClosed(quote, { viewed }) {
    const id = quote.objectId;
    if (ORDER[this.step] === id && viewed) {
      this.step++;
      this.sequence = id === IDS.note1 ? this.#secondNote() : this.#onward();
      return;
    }
    this.sequence = this.#returnToView(); // closed early, or a note read again
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

  #frankensteinHead(target = new THREE.Vector3()) {
    return this.frankenstein.joints.head.getWorldPosition(target).add(_v.set(0, 0.1, 0));
  }

  async #returnToView() {
    this.setInteractive(false);
    await this.flyTo(this.baseView, 1.6);
    if (!this.#ended()) this.setInteractive(true);
  }

  /** He steps back onto the path, turns and looks back toward Frankenstein. */
  async #lookBack(spot) {
    const M = this.monster;
    await M.walkTo(spot, 0.7);
    if (this.#ended()) return;
    M.turnRate = 2.2;
    M.turnTowards(this.frankenstein.object.position);
    this.monsterWatches = true;
    await this.#pause(1.4);
  }

  /** On arrival: Frankenstein follows; the Monster walks on ahead and pins the first note to the tree. */
  async #arrive() {
    this.setInteractive(false);
    const M = this.monster;
    const F = this.frankenstein;
    F.walkTo(SPOTS.frankenstein[1], 0.85);
    await M.walkTo(SPOTS.atTree, 1.05);
    if (this.#ended()) return;
    M.turnTowards(this.note1At);
    M.setPose(POSE.pin, { rate: 2 });
    await this.#pause(0.5);
    M.reachTowards(this.note1At.clone().addScaledVector(TREE.facing, 0.05), 'R');
    await this.#pause(0.9);
    this.noteGroups[IDS.note1].visible = true; // pinned to the bark
    await this.#pause(0.7);
    M.reachTowards(null);
    M.setPose('stand', { rate: 2 });
    await this.#pause(0.4);
    await this.#lookBack(SPOTS.afterTree);
    if (this.#ended()) return;
    this.phase = 'note1';
    this.setInteractive(true);
  }

  /** After the first note: on along the path to the small rock, where he leaves the second. */
  async #secondNote() {
    this.setInteractive(false);
    const M = this.monster;
    const F = this.frankenstein;
    this.baseView = 'follow';
    const flight = this.flyTo('follow', 3.2);
    this.monsterWatches = false;
    M.lookAt(null);
    M.turnRate = 3.5;
    await this.#pause(0.4);
    F.walkTo(SPOTS.frankenstein[2], 0.85);
    await M.walkTo(SPOTS.atRock, 1.2);
    if (this.#ended()) return;
    M.turnTowards(this.note2At);
    M.lookAt(this.note2At);
    M.setPose(POSE.kneel, { rate: 1.8 });
    await this.#pause(1.0);
    M.reachTowards(this.note2At.clone().addScaledVector(this.note2Normal, 0.05), 'R');
    await this.#pause(0.9);
    this.noteGroups[IDS.note2].visible = true; // left against the rock
    await this.#pause(0.6);
    M.reachTowards(null);
    M.setPose('stand', { rate: 1.8 });
    await this.#pause(1.0);
    await this.#lookBack(SPOTS.afterRock);
    await flight;
    if (this.#ended()) return;
    this.phase = 'note2';
    this.setInteractive(true);
  }

  /** After the second note: he holds the look a moment, then walks on along the path, still ahead. */
  async #onward() {
    this.setInteractive(false);
    const M = this.monster;
    this.phase = 'onward';
    this.baseView = 'end';
    const flight = this.flyTo('end', 3);
    await this.#pause(1.2);
    this.monsterWatches = false;
    M.lookAt(null);
    M.turnRate = 3.5;
    this.frankenstein.walkTo(SPOTS.frankenstein[3], 0.8);
    M.walkTo(SPOTS.onward, 1.0);
    await flight;
    if (!this.#ended()) this.setInteractive(true);
  }

  /** Dev "Complete scene": both notes in place, the two on the path, the end view. */
  #placeAtEnd() {
    const M = this.monster;
    const F = this.frankenstein;
    this.phase = 'onward';
    this.baseView = 'end';
    for (const g of Object.values(this.noteGroups)) g.visible = true;
    M.move?.resolve();
    M.move = null;
    M.setAnimation('idle');
    M.reachTowards(null);
    M.setPose('stand', { immediate: true });
    M.lookAt(null);
    this.monsterWatches = false;
    M.walkTo(SPOTS.onward, 1.0);
    F.walkTo(SPOTS.frankenstein[3], 0.8);
    this.flyTo('end', 2);
  }

  // ─── Per frame ──────────────────────────────────────────────────────────────

  onUpdate(dt, t) {
    if (this.phase === 'arriving' && this.interactive && !this.started) {
      this.started = true;
      this.sequence = this.#arrive();
    }
    WIND.uTime.value = t;
    this.cloudOffset.x += dt * 0.004;
    this.cloudOffset.y += dt * 0.0012;
    const S = this.sky.update(this.dayTime, { dayTop: visualParams.skyTop, dayHorizon: visualParams.skyHorizon, time: t, cloudOffset: this.cloudOffset, center: this.camera.position });
    const L = visualParams.lightIntensity;
    const M = this.monster;
    const F = this.frankenstein;

    // Both keep to the snow's surface as they walk.
    for (const o of [M.object, F.object]) o.position.y = this.groundY(o.position.x, o.position.z);
    // The sun's shadows are drawn around the two of them.
    const key = this.lights.key;
    key.target.position.lerpVectors(M.object.position, F.object.position, 0.5);
    key.position.copy(key.target.position).addScaledVector(this.sunDir, 100);

    // Haze in place of fog: the coefficient's fog density, thinned so the far hills still show.
    HAZE.uHazeColor.value.copy(S.horizon).lerp(_c.set('#c9cfd6'), 0.35).multiplyScalar(0.7 + 0.3 * L);
    HAZE.uHazeDensity.value = visualParams.fogDensity * HAZE_PER_FOG;

    if (this.monsterWatches) M.lookAt(this.#frankensteinHead());
    F.lookAt(M.eyePosition(_w)); // he keeps his eyes on the Monster ahead
    F.update(dt);
    this.snow.update(t, this.camera, this.renderer);
    this.snow.uniforms.uColor.value.setScalar(0.72 + 0.28 * L);
  }
}
