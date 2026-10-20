import * as THREE from 'three';

/**
 * A small songbird (robin-like by default) built from primitives, with procedural
 * flight, landing, perched idling (head turns, hops, tail flicks) and a singing beak.
 *
 *   const bird = new Bird({ rng });
 *   await bird.flyTo(perchPoint, yaw, { from, duration })
 *   bird.sing(notes)            // [{ t, dur }] from birdsong.js: the beak opens per note
 *   await bird.flyAway(to)
 *   bird.update(dt)             // every frame
 *
 * Built facing +Z with the feet at y = 0.
 */

export const ROBIN = {
  back: '#7a6a50',
  breast: '#c7673a',
  belly: '#dcd0ba',
  dark: '#181512',
  beak: '#2c251f',
  legs: '#5b4b3c',
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

function bezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

export class Bird {
  constructor({ rng, palette = ROBIN, size = 1.4 } = {}) {
    this.rng = rng;
    this.object = new THREE.Group();
    this.object.visible = false;
    this.#build(palette);
    this.object.scale.setScalar(size);
    this.state = 'away';
    this.flight = null;
    this.yaw = 0;
    this.spread = 0;
    this.flapPhase = rng.float(0, 6);
    this.flapAmp = 0;
    this.headYaw = 0;
    this.headYawTarget = 0;
    this.headPitch = 0;
    this.beak = 0;
    this.song = null;
    this.hop = null;
    this.nextIdle = rng.float(0.8, 2.5);
    this.tailFlick = 0;
    this.clock = rng.float(0, 10);
  }

  get perched() {
    return this.state === 'perched';
  }

  #build(P) {
    const mat = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    const M = { back: mat(P.back), breast: mat(P.breast), belly: mat(P.belly), dark: mat(P.dark, 0.35), beak: mat(P.beak, 0.5), legs: mat(P.legs) };
    this.materials = M;
    const sphere = new THREE.SphereGeometry(1, 12, 9);
    const blob = (m, sx, sy, sz, x, y, z) => {
      const mesh = new THREE.Mesh(sphere, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };

    this.body = new THREE.Group();
    this.object.add(this.body);
    const torso = blob(M.back, 0.05, 0.047, 0.075, 0, 0.064, -0.006);
    torso.rotation.x = -0.45;
    this.breast = blob(M.breast, 0.043, 0.046, 0.04, 0, 0.072, 0.034);
    this.body.add(torso, this.breast, blob(M.belly, 0.038, 0.032, 0.05, 0, 0.044, 0.008));

    this.head = new THREE.Group();
    this.head.position.set(0, 0.108, 0.04);
    this.head.add(blob(M.back, 0.035, 0.034, 0.037, 0, 0, 0), blob(M.breast, 0.028, 0.026, 0.02, 0, -0.007, 0.022));
    for (const x of [0.022, -0.022]) this.head.add(blob(M.dark, 0.0065, 0.0065, 0.0065, x, 0.006, 0.021));
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.022, 8).rotateX(Math.PI / 2), M.beak);
    upper.position.set(0, -0.002, 0.044);
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.007, 0.033);
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.0058, 0.017, 8).rotateX(Math.PI / 2), M.beak);
    lower.position.set(0, 0, 0.009);
    this.jaw.add(lower);
    this.head.add(upper, this.jaw);
    this.body.add(this.head);

    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.05, -0.062);
    const tailMesh = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.006, 0.066).translate(0, 0, -0.03), M.back);
    tailMesh.castShadow = true;
    this.tail.add(tailMesh);
    this.body.add(this.tail);

    this.wings = [1, -1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.04, 0.078, 0.012);
      pivot.rotation.order = 'ZYX';
      pivot.add(blob(M.back, 0.011, 0.03, 0.062, 0, -0.004, -0.032));
      pivot.userData.side = side;
      this.body.add(pivot);
      return pivot;
    });

    for (const x of [0.012, -0.012]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.032, 5), M.legs);
      leg.position.set(x, 0.016, 0.004);
      this.body.add(leg);
    }
  }

  /** Flies along a swooping curve and lands on `to`, ending up facing `yaw`. */
  flyTo(to, yaw, { from, duration = 3 } = {}) {
    this.object.visible = true;
    this.state = 'flying';
    const p0 = from.clone();
    const p3 = to.clone();
    const dir = _a.copy(p3).sub(p0);
    const p1 = p0.clone().addScaledVector(dir, 0.35).add(new THREE.Vector3(0, Math.max(1.2, dir.length() * 0.12), 0));
    const p2 = p3.clone().add(new THREE.Vector3(0, 0.9, 0)).addScaledVector(dir.normalize(), -0.8);
    return new Promise((resolve) => {
      this.flight = { p0, p1, p2, p3, t: 0, duration, endYaw: yaw, landing: true, resolve };
    });
  }

  flyAway(to, { duration = 2.6 } = {}) {
    if (this.state === 'away') return Promise.resolve();
    this.state = 'flying';
    const p0 = this.object.position.clone();
    const p3 = to.clone();
    const p1 = p0.clone().add(new THREE.Vector3(0, 0.8, 0));
    const p2 = p3.clone().lerp(p0, 0.4).add(new THREE.Vector3(0, 2, 0));
    return new Promise((resolve) => {
      this.flight = { p0, p1, p2, p3, t: 0, duration, endYaw: null, landing: false, resolve };
    });
  }

  /** Places the bird on its perch at once (no flight). */
  perchAt(position, yaw) {
    this.object.position.copy(position);
    this.object.visible = true;
    this.state = 'perched';
    this.yaw = yaw;
    this.object.quaternion.setFromAxisAngle(UP, yaw);
    this.body.rotation.set(0, 0, 0);
    this.spread = 0;
    this.flapAmp = 0;
    this.flight = null;
  }

  hide() {
    this.state = 'away';
    this.object.visible = false;
    this.flight = null;
  }

  sing(notes) {
    this.song = { time: 0, notes, end: notes.length ? notes[notes.length - 1].t + notes[notes.length - 1].dur : 0 };
  }

  update(dt) {
    this.clock += dt;
    if (this.state === 'flying') this.#updateFlight(dt);
    else if (this.state === 'perched') this.#updatePerched(dt);

    // Wings: spread out to the sides and flap about the body's long axis.
    for (const w of this.wings) {
      const side = w.userData.side;
      w.rotation.y = -side * 1.45 * this.spread;
      w.rotation.z = side * this.flapAmp * Math.sin(this.flapPhase) + side * 0.35 * this.spread;
    }

    // Song: the beak opens for every note; the head lifts for the whole phrase.
    let open = 0;
    let singing = false;
    if (this.song) {
      const s = this.song;
      s.time += dt;
      singing = s.time < s.end + 0.15;
      for (const n of s.notes) if (s.time >= n.t && s.time <= n.t + n.dur) open = 1;
      if (!singing) this.song = null;
    }
    this.beak = damp(this.beak, open, 40, dt);
    this.jaw.rotation.x = this.beak * 0.42;
    this.breast.scale.y = 0.046 * (1 + this.beak * 0.08 + Math.sin(this.clock * 6) * 0.015);
    this.headPitch = damp(this.headPitch, singing ? -0.35 : 0, 8, dt);
    this.headYaw = damp(this.headYaw, singing ? this.headYawTarget * 0.3 : this.headYawTarget, 18, dt);
    this.head.rotation.set(this.headPitch, this.headYaw, 0, 'YXZ');
    this.tailFlick = damp(this.tailFlick, 0, 6, dt);
    this.tail.rotation.x = -0.3 + this.tailFlick;
  }

  #updateFlight(dt) {
    const f = this.flight;
    f.t = Math.min(1, f.t + dt / f.duration);
    const e = f.landing ? 1 - Math.pow(1 - f.t, 2.2) : f.t * f.t;
    bezier(f.p0, f.p1, f.p2, f.p3, e, this.object.position);
    bezier(f.p0, f.p1, f.p2, f.p3, Math.min(1, e + 0.02), _b);
    const vel = _b.sub(this.object.position);
    const travelYaw = Math.atan2(vel.x, vel.z);
    const near = f.landing ? THREE.MathUtils.smoothstep(f.t, 0.78, 1) : 0;
    const yaw = near > 0 && f.endYaw !== null ? lerpAngle(travelYaw, f.endYaw, near) : travelYaw;
    this.yaw = yaw;
    this.object.quaternion.setFromAxisAngle(UP, yaw);
    const pitch = Math.atan2(-vel.y, Math.hypot(vel.x, vel.z) + 1e-5);
    this.body.rotation.x = THREE.MathUtils.lerp(pitch * 0.6, -0.5, near); // flare upright to land
    this.spread = damp(this.spread, 1, 10, dt);
    this.flapAmp = THREE.MathUtils.lerp(0.75, 0.25, near);
    this.flapPhase += dt * Math.PI * 2 * THREE.MathUtils.lerp(9, 5, near);
    if (f.t >= 1) {
      this.flight = null;
      if (f.landing) {
        this.state = 'perched';
        this.nextIdle = this.rng.float(0.6, 1.6);
      } else {
        this.hide();
      }
      f.resolve();
    }
  }

  #updatePerched(dt) {
    this.spread = damp(this.spread, 0, 7, dt);
    this.flapAmp = damp(this.flapAmp, 0, 7, dt);
    this.flapPhase += dt * 20;
    this.body.rotation.x = damp(this.body.rotation.x, 0, 6, dt);

    if (this.hop) {
      const h = this.hop;
      h.t = Math.min(1, h.t + dt / 0.28);
      this.object.position.y = h.y + Math.sin(h.t * Math.PI) * 0.05;
      this.yaw = THREE.MathUtils.lerp(h.yaw0, h.yaw1, h.t);
      this.object.quaternion.setFromAxisAngle(UP, this.yaw);
      if (h.t >= 1) this.hop = null;
    }

    this.nextIdle -= dt;
    if (this.nextIdle <= 0 && !this.song) {
      const r = this.rng.next();
      if (r < 0.55) this.headYawTarget = this.rng.float(-1.1, 1.1);
      else if (r < 0.8) this.tailFlick = 0.5;
      else if (!this.hop) this.hop = { t: 0, y: this.object.position.y, yaw0: this.yaw, yaw1: this.yaw + this.rng.float(-0.9, 0.9) };
      this.nextIdle = this.rng.float(0.5, 2.2);
    }
  }
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
