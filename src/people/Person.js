import * as THREE from 'three';

/**
 * A plain procedural person (the cottagers, and any other people a scene needs): ordinary
 * human proportions and simple period clothes, built from primitives in a small joint
 * hierarchy like the Monster, so the Monster's size and shape stand out beside them.
 *
 *   const p = new Person(style)   style: see PERSON_DEFAULTS
 *   p.sit(seatHeight)              seated pose with the forearms resting forward (on a table);
 *                                  without it the person stands, forearms forward at a bench
 *   p.setPose(pose | null, { rate }) blends joint rotations { joints: { spine: [x, y, z], … } }
 *                                  over the base pose (raised arms, leaning back…); null releases
 *   p.lookAt(point | null)         the head (and a little of the chest) turns to a world point
 *   p.setTalking(on)               hand gestures and small head movements while speaking
 *   p.nod()                        a small nod, e.g. while listening
 *   p.walkTo(point, speed)         walks there (stride and arm swing over any held pose),
 *                                  resolves on arrival; p.facing turns the body in place
 *   p.update(dt)
 *
 * Built facing +Z with the feet at y = 0. `p.object` is placed by the scene.
 */
export const PERSON_DEFAULTS = {
  height: 1.7,
  skin: '#d9a98a',
  hair: '#4a3324',
  hairStyle: 'short', // 'short' | 'bun' | 'scarf'
  scarf: '#7a5a3a',
  beard: null, // colour, or null
  top: '#7a5338', // shirt / blouse
  vest: null, // colour of a bodice or waistcoat over the top, or null
  bottom: '#4a3a2c', // trousers, or the skirt when `skirt` is true
  skirt: false,
  apron: null, // colour, or null
  shoes: '#2a1f18',
};

/** Victor Frankenstein, the same in every scene he appears in. */
export const FRANKENSTEIN_STYLE = { height: 1.78, hair: '#2a1d14', top: '#d6d0c2', vest: '#35302c', bottom: '#2c2826', skin: '#d6a88a' };

/** Robert Walton, the ship's captain: a dark blue sea coat, brown hair and beard. */
export const WALTON_STYLE = { height: 1.75, hair: '#5e4128', beard: '#5e4128', top: '#2c3650', vest: '#232b40', bottom: '#2a2a2e', skin: '#dcae8e' };

const BUILT_HEIGHT = 1.7;

export class Person {
  constructor(style = {}) {
    this.style = { ...PERSON_DEFAULTS, ...style };
    this.object = new THREE.Group();
    this.object.name = 'Person';
    this.joints = {};
    this.materials = [];
    this.#build();
    this.object.scale.setScalar(this.style.height / BUILT_HEIGHT);

    this.time = Math.random() * 10;
    this.seated = null;
    this.lookTarget = null;
    this.yaw = 0;
    this.pitch = 0;
    this.talking = false;
    this.talkWeight = 0;
    this.gesture = { side: Math.random() < 0.5 ? 'L' : 'R', amount: 0, target: 0, timer: 0 };
    this.nodTime = -10;
    this.pose = { goal: null, values: null, weight: 0, target: 0, rate: 3 };
    this.facing = null; // target yaw for the whole body
    this.turnRate = 3;
    this.move = null; // { target, speed, resolve }
    this.walkWeight = 0;
    this.walkPhase = 0;
  }

  walkTo(point, speed = 1) {
    this.move?.resolve();
    return new Promise((resolve) => {
      this.move = { target: new THREE.Vector3(point.x, this.object.position.y, point.z), speed, resolve };
    });
  }

  setPose(pose, { rate = 3 } = {}) {
    const P = this.pose;
    P.rate = rate;
    if (!pose) {
      P.target = 0;
      return;
    }
    if (!P.values || P.weight < 1e-3) P.values = Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, [...v]]));
    P.goal = pose;
    P.target = 1;
  }

  sit(seatHeight = 0.45) {
    this.seated = { hipsY: seatHeight + 0.07 };
  }

  lookAt(point) {
    this.lookTarget = point ? point.clone() : null;
  }

  setTalking(on) {
    this.talking = on;
  }

  nod() {
    this.nodTime = this.time;
  }

  update(dt) {
    this.time += dt;
    this.#updateMovement(dt);
    const J = this.joints;
    const t = this.time;
    const breath = Math.sin(t * 1.7);
    this.talkWeight = damp(this.talkWeight, this.talking ? 1 : 0, 3, dt);

    for (const j of Object.values(J)) j.rotation.set(0, 0, 0); // rest pose, so a released pose leaves nothing behind
    // Seated base: thighs forward, shins down, forearms resting forward on the table.
    const seat = this.seated;
    J.hips.position.y = seat ? seat.hipsY : HIP_Y;
    for (const side of ['L', 'R']) {
      J[`leg${side}`].rotation.set(seat ? -1.5 : 0, 0, side === 'L' ? 0.06 : -0.06);
      J[`knee${side}`].rotation.x = seat ? 1.48 : 0;
    }
    J.spine.rotation.x = 0.08 + breath * 0.006;
    J.chest.rotation.x = 0.06;
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1;
      J[`shoulder${side}`].rotation.set(-0.5, 0, sign * 0.12);
      J[`elbow${side}`].rotation.set(-1.05, 0, 0);
    }

    // A held pose from the scene, eased in over the base.
    const P = this.pose;
    P.weight = damp(P.weight, P.target, P.rate, dt);
    if (P.values && P.weight > 1e-3) {
      const k = 1 - Math.exp(-P.rate * 1.3 * dt);
      for (const [name, g] of Object.entries(P.goal.joints)) {
        const v = (P.values[name] ??= [...g]);
        for (let i = 0; i < 3; i++) v[i] += (g[i] - v[i]) * k;
        const r = J[name].rotation;
        r.set(r.x + (v[0] - r.x) * P.weight, r.y + (v[1] - r.y) * P.weight, r.z + (v[2] - r.z) * P.weight);
      }
    }

    // Walking, over any held pose: the legs stride, the arms swing against them, the hips bob.
    const w = this.walkWeight;
    if (w > 1e-3) {
      const s = Math.sin(this.walkPhase);
      const c = Math.cos(this.walkPhase);
      for (const [side, sign] of [['L', 1], ['R', -1]]) {
        const leg = J[`leg${side}`].rotation;
        leg.x += (0.45 * sign * s - leg.x) * w;
        const knee = J[`knee${side}`].rotation;
        knee.x += (0.75 * Math.max(0, -sign * c) - knee.x) * w;
        J[`shoulder${side}`].rotation.x += -0.32 * sign * s * w;
      }
      J.hips.position.y += (Math.abs(c) * 0.025 - 0.015) * w;
      J.hips.rotation.y += 0.06 * s * w;
    }

    // Gestures, added over any pose: while talking, one hand lifts in short bursts.
    const G = this.gesture;
    G.timer -= dt;
    if (G.timer <= 0) {
      const busy = this.talkWeight > 0.5;
      G.target = busy ? (Math.random() < 0.75 ? Math.random() * 0.6 + 0.4 : 0) : 0;
      if (busy && Math.random() < 0.3) G.side = G.side === 'L' ? 'R' : 'L';
      G.timer = busy ? 0.7 + Math.random() * 1.3 : 1;
    }
    G.amount = damp(G.amount, G.target * this.talkWeight, 4, dt);
    if (G.amount > 1e-3) {
      const sign = G.side === 'L' ? 1 : -1;
      const wave = Math.sin(t * 5.2) * 0.12 + Math.sin(t * 3.1 + 1) * 0.08;
      const sh = J[`shoulder${G.side}`].rotation;
      sh.x += (-0.35 + wave * 0.5) * G.amount;
      sh.z += sign * 0.18 * G.amount;
      const el = J[`elbow${G.side}`].rotation;
      el.x += (-0.55 + wave) * G.amount;
      el.y += sign * (0.4 + wave) * G.amount;
    }

    // Head: turn to the look target; the chest follows a little.
    let yaw = Math.sin(t * 0.37) * 0.12;
    let pitch = 0.05;
    if (this.lookTarget) {
      const local = J.neck.worldToLocal(_v.copy(this.lookTarget));
      local.y -= 0.12;
      yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.4, 0.5);
    }
    this.yaw = damp(this.yaw, yaw, 4, dt);
    this.pitch = damp(this.pitch, pitch, 4, dt);
    const nodAge = t - this.nodTime;
    const nod = nodAge < 0.9 ? Math.sin((nodAge / 0.9) * Math.PI * 2) * 0.12 * (1 - nodAge / 0.9) : 0;
    const speak = this.talkWeight * (Math.sin(t * 6.3) * 0.025 + Math.sin(t * 2.3) * 0.03);
    J.chest.rotation.y += this.yaw * 0.25;
    J.head.rotation.set(this.pitch + nod + speak, this.yaw * 0.75, Math.sin(t * 0.5) * 0.03 * this.talkWeight, 'YXZ');
  }

  #updateMovement(dt) {
    const M = this.move;
    this.walkWeight = damp(this.walkWeight, M ? 1 : 0, 4, dt);
    if (M) {
      const p = this.object.position;
      const to = _v.copy(M.target).sub(p);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.05) {
        this.move = null;
        M.resolve();
      } else {
        this.facing = Math.atan2(to.x, to.z);
        p.addScaledVector(to.normalize(), Math.min(dist, M.speed * this.walkWeight * dt));
      }
    }
    this.walkPhase += dt * Math.PI * 2 * (M ? M.speed / 1.35 : 0.8) * this.walkWeight; // about 1.35 m per stride pair
    if (this.facing !== null) {
      const r = this.object.rotation;
      r.y += Math.atan2(Math.sin(this.facing - r.y), Math.cos(this.facing - r.y)) * (1 - Math.exp(-dt * this.turnRate));
    }
  }

  // ─── Construction ──────────────────────────────────────────────────────────

  #build() {
    const S = this.style;
    const mat = (color, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
      this.materials.push(m);
      return m;
    };
    const M = {
      skin: mat(S.skin, { roughness: 0.6 }),
      hair: mat(S.hair, { roughness: 0.7 }),
      top: mat(S.top),
      vest: S.vest ? mat(S.vest) : null,
      bottom: mat(S.bottom, { side: THREE.DoubleSide }),
      apron: S.apron ? mat(S.apron, { side: THREE.DoubleSide }) : null,
      shoes: mat(S.shoes, { roughness: 0.6 }),
      features: mat('#2a1c16', { roughness: 0.5 }),
      lips: mat(new THREE.Color(S.skin).multiplyScalar(0.72)),
      scarf: mat(S.scarf),
      beard: S.beard ? mat(S.beard, { roughness: 0.8 }) : null,
    };
    // Small parts do not cast shadows; the hearth's cube shadow renders only the big shapes.
    const mesh = (geo, material, x = 0, y = 0, z = 0, cast = true) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
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
    const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 3, seg);

    const hips = joint('hips', this.object, 0, HIP_Y, 0);
    hips.add(scaled(mesh(capsule(0.15, 0.06), M.bottom, 0, 0.02, 0), 1.05, 1, 0.8));
    for (const [side, x] of [['L', 0.09], ['R', -0.09]]) {
      const leg = joint(`leg${side}`, hips, x, -0.03, 0);
      leg.add(mesh(capsule(0.07, 0.3), M.bottom, 0, -0.21, 0));
      const knee = joint(`knee${side}`, leg, 0, -0.43, 0);
      knee.add(mesh(capsule(0.055, 0.32), M.bottom, 0, -0.2, 0));
      knee.add(mesh(new THREE.BoxGeometry(0.09, 0.07, 0.22), M.shoes, 0, -0.42, 0.04, false));
    }
    if (S.skirt) {
      // A long skirt: a cone from the waist that the seated legs push forward.
      const skirt = mesh(new THREE.CylinderGeometry(0.17, 0.3, 0.5, 16, 1, true), M.bottom, 0, -0.2, 0.08);
      skirt.rotation.x = 0.5;
      hips.add(skirt);
      if (M.apron) {
        const apron = mesh(new THREE.CylinderGeometry(0.175, 0.29, 0.42, 12, 1, true, -0.7, 1.4), M.apron, 0, -0.17, 0.1, false);
        apron.rotation.x = 0.5;
        hips.add(apron);
      }
    }

    const spine = joint('spine', hips, 0, 0.08, 0);
    spine.add(scaled(mesh(capsule(0.14, 0.1), M.top, 0, 0.1, 0), 1, 1, 0.78));
    const chest = joint('chest', spine, 0, 0.22, 0);
    const torso = mesh(capsule(0.16, 0.18, 12), M.top, 0, 0.1, 0);
    torso.scale.set(1.05, 1, 0.72);
    chest.add(torso);
    if (M.vest) {
      const vest = mesh(capsule(0.165, 0.14, 12), M.vest, 0, 0.06, 0, false);
      vest.scale.set(1.06, 1, 0.75);
      chest.add(vest);
    }
    if (M.apron && !S.skirt) chest.add(mesh(new THREE.BoxGeometry(0.22, 0.3, 0.02), M.apron, 0, 0.02, 0.12, false));

    for (const [side, x] of [['L', 0.2], ['R', -0.2]]) {
      const shoulder = joint(`shoulder${side}`, chest, x, 0.2, 0);
      shoulder.add(mesh(new THREE.SphereGeometry(0.065, 10, 8), M.top, 0, 0, 0, false));
      shoulder.add(mesh(capsule(0.052, 0.2), M.top, 0, -0.14, 0));
      const elbow = joint(`elbow${side}`, shoulder, 0, -0.28, 0);
      elbow.add(mesh(capsule(0.045, 0.18), M.top, 0, -0.12, 0));
      const hand = mesh(new THREE.SphereGeometry(0.042, 10, 8), M.skin, 0, -0.27, 0.005, false);
      hand.scale.set(0.8, 1.15, 0.55);
      elbow.add(hand);
    }

    const neck = joint('neck', chest, 0, 0.29, 0);
    neck.add(mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10), M.skin, 0, 0.02, 0, false));
    const head = joint('head', neck, 0, 0.06, 0);
    const skull = mesh(new THREE.SphereGeometry(0.1, 18, 14), M.skin, 0, 0.1, 0);
    skull.scale.set(0.9, 1.1, 1);
    head.add(skull);
    head.add(mesh(new THREE.BoxGeometry(0.115, 0.06, 0.1), M.skin, 0, 0.035, 0.03, false)); // jaw
    head.add(mesh(new THREE.BoxGeometry(0.024, 0.04, 0.03), M.skin, 0, 0.09, 0.1, false)); // nose
    for (const x of [0.032, -0.032]) {
      head.add(mesh(new THREE.SphereGeometry(0.011, 8, 6), M.features, x, 0.112, 0.088, false)); // eyes
      head.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.01), M.features, x, 0.135, 0.093, false)); // brows
      head.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), M.skin, x * 2.9, 0.1, 0.0, false)); // ears
    }
    head.add(mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), M.lips, 0, 0.052, 0.082, false)); // mouth

    // Hair
    if (S.hairStyle === 'scarf') {
      const scarf = mesh(new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), M.scarf, 0, 0.11, -0.01);
      scarf.rotation.x = -0.35;
      head.add(scarf);
      head.add(mesh(new THREE.ConeGeometry(0.05, 0.1, 8), M.scarf, 0, 0.06, -0.1, false).rotateX(-2.4));
    } else {
      const cap = mesh(new THREE.SphereGeometry(0.106, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hair, 0, 0.115, -0.012);
      cap.rotation.x = -0.3;
      cap.scale.set(0.95, 1.05, 1.02);
      head.add(cap);
      if (S.hairStyle === 'bun') head.add(mesh(new THREE.SphereGeometry(0.045, 12, 8), M.hair, 0, 0.13, -0.1, false));
      else head.add(mesh(new THREE.SphereGeometry(0.095, 14, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.3), M.hair, 0, 0.1, -0.015, false));
    }
    if (M.beard) {
      const beard = mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), M.beard, 0, 0.07, 0.04, false);
      beard.scale.set(1, 1.2, 0.85);
      head.add(beard);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const HIP_Y = 0.92;
const _v = new THREE.Vector3();

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function scaled(object, x, y, z) {
  object.scale.set(x, y, z);
  return object;
}
