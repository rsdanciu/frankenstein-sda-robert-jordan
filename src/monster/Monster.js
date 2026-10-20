import * as THREE from 'three';

/**
 * The Monster — one procedural figure used in EVERY scene, so he is always the same,
 * recognisable silhouette: very tall, broad-shouldered, long-armed, in a long dark coat,
 * with long dark hair, a stitched seam across the forehead and pale glinting eyes.
 *
 * Built from Three.js primitives in a joint hierarchy (no external model), animated
 * procedurally:
 *   setAnimation('idle' | 'walk')  – blends smoothly between the two
 *   setPose('stand' | 'sit')       – sits on the ground (back leaning, one knee up)
 *   lookAt(point | null)           – head tracks a world point (null = idle glances)
 *   reachTowards(point | null, side) – lifts the 'L' or 'R' arm towards a world point
 *   turnTowards(point)             – body turns to face a point
 *   walkTo(point, speed)           – walks there, resolves on arrival
 *   joints                         – every joint Group, for custom scene poses
 *
 * The figure is built facing +Z with its feet at y = 0. Scenes move or scale
 * `monster.object`; MONSTER_STYLE changes the look everywhere at once.
 */
export const MONSTER_STYLE = {
  height: 2.45, // metres in scene units
  colors: {
    skin: '#b7b182',
    skinShadow: '#8f8a63',
    hair: '#141215',
    coat: '#2b2930',
    coatLining: '#4a3f37',
    shirt: '#6b6255',
    trousers: '#302c29',
    boots: '#161413',
    eyes: '#eef3d6',
    stitches: '#3a2626',
  },
  eyeGlow: 0.6,
};

const BUILT_HEIGHT = 2.45; // the proportions below are authored for this height
const HIP_Y = 1.17;

// Sitting on the ground: pelvis down, back leaning, left knee raised with the forearm
// resting on it, right leg stretched out and the right hand on the ground.
const SIT_POSE = {
  hipsY: 0.22,
  joints: {
    legL: [-2.2, 0, 0.16],
    kneeL: [1.78, 0, 0],
    legR: [-1.5, 0, -0.14],
    kneeR: [0.05, 0, 0],
    spine: [-0.16, 0, 0],
    chest: [0.1, 0, 0],
    shoulderL: [-0.9, 0, -0.18],
    elbowL: [-0.95, 0, 0],
    shoulderR: [-0.22, 0, -0.22],
    elbowR: [-0.15, 0, 0],
  },
  skirt: { rotationX: -0.2, scaleY: 0.45, scaleXZ: 1.22 },
};

export class Monster {
  constructor(style = MONSTER_STYLE) {
    this.style = style;
    this.object = new THREE.Group();
    this.object.name = 'Monster';
    this.joints = {};
    this.parts = {};
    this.#build();
    this.object.scale.setScalar(style.height / BUILT_HEIGHT);

    this.time = Math.random() * 10;
    this.phase = 0;
    this.walkWeight = 0;
    this.walkTarget = 0;
    this.lookTarget = null;
    this.headYaw = 0;
    this.headPitch = 0;
    this.facing = null; // target yaw for the whole body
    this.move = null; // { target, speed, resolve }
    this.sitWeight = 0;
    this.sitTarget = 0;
    this.reach = { point: null, side: 'L', weight: 0 };
  }

  setAnimation(name) {
    this.walkTarget = name === 'walk' ? 1 : 0;
  }

  /** 'sit' | 'stand'. `immediate` skips the blend (e.g. when a scene starts with him seated). */
  setPose(name, { immediate = false } = {}) {
    this.sitTarget = name === 'sit' ? 1 : 0;
    if (immediate) this.sitWeight = this.sitTarget;
  }

  reachTowards(point, side = 'L') {
    if (point) this.reach.point = point.clone();
    this.reach.side = point ? side : this.reach.side;
    this.reach.active = Boolean(point);
  }

  lookAt(point) {
    this.lookTarget = point ? point.clone() : null;
  }

  turnTowards(point) {
    const p = this.object.position;
    this.facing = Math.atan2(point.x - p.x, point.z - p.z);
  }

  walkTo(point, speed = 1.1) {
    this.move?.resolve();
    return new Promise((resolve) => {
      this.move = { target: new THREE.Vector3(point.x, this.object.position.y, point.z), speed, resolve };
      this.setAnimation('walk');
    });
  }

  update(dt) {
    this.time += dt;
    this.#updateMovement(dt);
    this.walkWeight = damp(this.walkWeight, this.walkTarget, 4, dt);
    const w = this.walkWeight;
    this.phase += dt * Math.PI * 2 * 0.8 * w;

    const J = this.joints;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const breath = Math.sin(this.time * 1.5);
    const idle = 1 - w;

    // Legs: alternate swing; the knee bends while the leg travels forward.
    J.legL.rotation.x = 0.5 * w * s;
    J.legR.rotation.x = -0.5 * w * s;
    J.kneeL.rotation.x = 0.85 * w * Math.max(0, -c);
    J.kneeR.rotation.x = 0.85 * w * Math.max(0, c);

    // Heavy, lumbering hips: bob, side sway and twist.
    J.hips.position.y = HIP_Y + w * (Math.abs(c) * 0.045 - 0.03) + breath * 0.004;
    J.hips.rotation.z = 0.05 * w * s;
    J.hips.rotation.y = 0.08 * w * s;

    // Slight hunch; the chest counter-twists the hips.
    J.spine.rotation.x = 0.07 + 0.06 * w;
    J.spine.rotation.y = -0.12 * w * s;
    this.parts.chest.scale.set(1 + breath * 0.012, 1 + breath * 0.006, 1 + breath * 0.02);
    J.chest.rotation.x = 0.04 + breath * 0.01;

    // Arms swing against the legs; at rest they hang slightly away from the body.
    const sway = Math.sin(this.time * 0.9) * 0.03 * idle;
    J.shoulderL.rotation.set(-0.42 * w * s + sway, 0, 0.12 + breath * 0.01);
    J.shoulderR.rotation.set(0.42 * w * s - sway, 0, -0.12 - breath * 0.01);
    J.elbowL.rotation.x = -(0.22 + 0.25 * w * (1 + s) * 0.5);
    J.elbowR.rotation.x = -(0.22 + 0.25 * w * (1 - s) * 0.5);

    // Coat tails trail and swing.
    this.parts.skirt.rotation.x = -0.06 * w - 0.03 * w * Math.abs(s);
    this.parts.skirt.rotation.z = -0.04 * w * s;
    this.parts.skirt.scale.set(1, 1, 1);

    this.sitWeight = damp(this.sitWeight, this.sitTarget, 2.2, dt);
    if (this.sitWeight > 1e-3) this.#applySit(this.sitWeight, breath);

    this.object.updateMatrixWorld(true);
    this.#updateReach(dt);
    this.#updateHead(dt);
  }

  #applySit(k, breath) {
    const J = this.joints;
    J.hips.position.y += (SIT_POSE.hipsY + breath * 0.004 - J.hips.position.y) * k;
    J.hips.rotation.y *= 1 - k;
    J.hips.rotation.z *= 1 - k;
    for (const [name, [x, y, z]] of Object.entries(SIT_POSE.joints)) {
      const r = J[name].rotation;
      r.set(r.x + (x - r.x) * k, r.y + (y - r.y) * k, r.z + (z - r.z) * k);
    }
    const { skirt } = this.parts;
    const S = SIT_POSE.skirt;
    skirt.rotation.x += (S.rotationX - skirt.rotation.x) * k;
    const xz = 1 + (S.scaleXZ - 1) * k;
    skirt.scale.set(xz, 1 + (S.scaleY - 1) * k, xz);
  }

  /** Points the chosen arm at reach.point (shoulder aimed, elbow nearly straight), blended by its weight. */
  #updateReach(dt) {
    const R = this.reach;
    R.weight = damp(R.weight, R.active ? 1 : 0, 2.6, dt);
    if (R.weight < 1e-3 || !R.point) return;
    const shoulder = this.joints[`shoulder${R.side}`];
    const elbow = this.joints[`elbow${R.side}`];
    const dir = _v.copy(R.point).sub(shoulder.getWorldPosition(_w)).normalize();
    dir.applyQuaternion(shoulder.parent.getWorldQuaternion(_q).invert());
    _q.setFromUnitVectors(DOWN, dir);
    shoulder.quaternion.slerp(_q, R.weight);
    elbow.rotation.x += (-0.18 - elbow.rotation.x) * R.weight;
  }

  #updateMovement(dt) {
    if (this.move) {
      const p = this.object.position;
      const to = _v.copy(this.move.target).sub(p);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.05) {
        const { resolve } = this.move;
        this.move = null;
        this.setAnimation('idle');
        resolve();
      } else {
        this.facing = Math.atan2(to.x, to.z);
        const step = Math.min(dist, this.move.speed * this.walkWeight * dt);
        p.addScaledVector(to.normalize(), step);
      }
    }
    if (this.facing !== null) {
      const r = this.object.rotation;
      r.y += shortestAngle(r.y, this.facing) * (1 - Math.exp(-dt * 3.5));
    }
  }

  #updateHead(dt) {
    let yaw = Math.sin(this.time * 0.31) * 0.18;
    let pitch = Math.sin(this.time * 0.23) * 0.05 - 0.04;
    if (this.lookTarget) {
      const local = this.joints.neck.worldToLocal(_v.copy(this.lookTarget));
      local.y -= 0.28; // eye height above the neck joint
      yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.0, 1.0);
      pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.45, 0.5);
    }
    this.headYaw = damp(this.headYaw, yaw, 3, dt);
    this.headPitch = damp(this.headPitch, pitch, 3, dt);
    this.joints.head.rotation.set(this.headPitch, this.headYaw, 0, 'YXZ');
  }

  // ─── Construction ──────────────────────────────────────────────────────────

  #build() {
    const C = this.style.colors;
    const mat = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, flatShading: true, ...extra });
    const M = {
      skin: mat(C.skin),
      skinShadow: mat(C.skinShadow),
      hair: mat(C.hair, { roughness: 0.7 }),
      coat: mat(C.coat),
      lining: mat(C.coatLining, { side: THREE.DoubleSide }),
      coatSkirt: mat(C.coat, { side: THREE.DoubleSide }),
      shirt: mat(C.shirt),
      trousers: mat(C.trousers),
      boots: mat(C.boots, { roughness: 0.6 }),
      eyes: mat(C.eyes, { emissive: C.eyes, emissiveIntensity: this.style.eyeGlow, roughness: 0.2, flatShading: false }),
      stitches: mat(C.stitches),
    };
    this.materials = M;

    const mesh = (geo, material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    const joint = (name, parent, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      this.joints[name] = g;
      return g;
    };
    const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);

    // Hips & legs
    const hips = joint('hips', this.object, 0, HIP_Y, 0);
    hips.add(scaled(mesh(capsule(0.2, 0.14), M.trousers, 0, 0.02, 0), 1.15, 1, 0.75));

    for (const [side, x] of [['L', 0.15], ['R', -0.15]]) {
      const leg = joint(`leg${side}`, hips, x, -0.04, 0);
      leg.add(mesh(capsule(0.095, 0.4), M.trousers, 0, -0.28, 0));
      const knee = joint(`knee${side}`, leg, 0, -0.56, 0);
      knee.add(mesh(capsule(0.08, 0.36), M.trousers, 0, -0.26, 0));
      knee.add(mesh(new THREE.BoxGeometry(0.17, 0.13, 0.32), M.boots, 0, -0.495, 0.05));
    }

    // Coat tails: an open-fronted, ragged cone hanging from the waist to the knees.
    const skirtGeo = new THREE.CylinderGeometry(0.25, 0.37, 0.66, 14, 3, true, 0.32, Math.PI * 2 - 0.64);
    raggedHem(skirtGeo, 0.66);
    const skirt = mesh(skirtGeo, M.coatSkirt, 0, -0.27, 0);
    hips.add(skirt);
    this.parts.skirt = skirt;

    // Spine, chest, coat
    const spine = joint('spine', hips, 0, 0.1, 0);
    spine.add(scaled(mesh(capsule(0.2, 0.16), M.coat, 0, 0.13, 0), 1.05, 1, 0.75));
    const chest = joint('chest', spine, 0, 0.3, 0);
    const chestMesh = mesh(capsule(0.24, 0.34, 10), M.coat, 0, 0.2, 0);
    chestMesh.rotation.z = Math.PI / 2;
    chestMesh.scale.set(1, 1, 0.64);
    chest.add(chestMesh);
    this.parts.chest = chestMesh;
    chest.add(mesh(new THREE.BoxGeometry(0.16, 0.42, 0.06), M.shirt, 0, 0.17, 0.13)); // shirt front
    chest.add(mesh(new THREE.BoxGeometry(0.05, 0.44, 0.08), M.lining, 0.11, 0.16, 0.135)); // lapels
    chest.add(mesh(new THREE.BoxGeometry(0.05, 0.44, 0.08), M.lining, -0.11, 0.16, 0.135));
    const collar = mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.13, 10, 1, true), M.lining, 0, 0.42, -0.01);
    chest.add(collar);

    // Arms (long: the hands hang to mid-thigh)
    for (const [side, x] of [['L', 0.37], ['R', -0.37]]) {
      const shoulder = joint(`shoulder${side}`, chest, x, 0.3, 0);
      shoulder.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), M.coat, 0, 0, 0));
      shoulder.add(mesh(capsule(0.078, 0.32), M.coat, 0, -0.24, 0));
      const elbow = joint(`elbow${side}`, shoulder, 0, -0.46, 0);
      elbow.add(mesh(capsule(0.066, 0.29), M.coat, 0, -0.2, 0));
      elbow.add(mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.06, 8), M.lining, 0, -0.38, 0)); // cuff
      const hand = mesh(new THREE.BoxGeometry(0.1, 0.19, 0.075), M.skin, 0, -0.5, 0.01);
      hand.rotation.x = -0.08;
      elbow.add(hand);
    }

    // Neck & head
    const neck = joint('neck', chest, 0, 0.42, 0.01);
    neck.add(mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.16, 8), M.skin, 0, 0.05, 0));
    const head = joint('head', neck, 0, 0.13, 0);
    head.add(scaled(mesh(new THREE.SphereGeometry(0.165, 14, 12), M.skin, 0, 0.15, 0), 0.92, 1.12, 1));
    head.add(mesh(new THREE.BoxGeometry(0.21, 0.11, 0.19), M.skin, 0, 0.04, 0.035)); // heavy jaw
    head.add(mesh(new THREE.BoxGeometry(0.25, 0.045, 0.07), M.skinShadow, 0, 0.2, 0.125)); // brow ridge
    head.add(mesh(new THREE.BoxGeometry(0.045, 0.07, 0.05), M.skinShadow, 0, 0.13, 0.16)); // nose

    for (const x of [0.058, -0.058]) {
      head.add(mesh(new THREE.SphereGeometry(0.021, 10, 8), M.eyes, x, 0.157, 0.142));
    }

    // Stitched seam across the forehead
    head.add(mesh(new THREE.BoxGeometry(0.2, 0.008, 0.012), M.stitches, 0, 0.255, 0.14));
    for (let i = -2; i <= 2; i++) {
      head.add(mesh(new THREE.BoxGeometry(0.008, 0.034, 0.012), M.stitches, i * 0.042, 0.255, 0.142));
    }

    // Long dark hair: a cap over the crown plus a curtain down the back
    const cap = mesh(new THREE.SphereGeometry(0.178, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair, 0, 0.18, -0.02);
    cap.rotation.x = -0.42;
    head.add(cap);
    const curtain = mesh(
      new THREE.CylinderGeometry(0.165, 0.15, 0.36, 12, 2, true, Math.PI / 2 + 0.2, Math.PI - 0.4),
      M.hair,
      0,
      0.06,
      -0.01,
    );
    curtain.material = M.hair.clone();
    curtain.material.side = THREE.DoubleSide;
    head.add(curtain);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function scaled(object, x, y, z) {
  object.scale.set(x, y, z);
  return object;
}

/** Jitters the bottom ring of an open cylinder so the coat hem looks torn. */
function raggedHem(geometry, height) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < -height / 2 + 1e-3) pos.setY(i, pos.getY(i) + (Math.random() - 0.3) * 0.09);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}
