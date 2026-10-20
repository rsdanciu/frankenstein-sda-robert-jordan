import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural trees. Each generator returns plain data so a scene can merge many trees
 * into a handful of draw calls:
 *   { wood: BufferGeometry[]  trunk + limbs (one bark material),
 *     cards: [{ position, quaternion, scale, normal, kind }]  foliage cards for instancing,
 *     crown: { center, radius } }
 *
 *   broadleafTree()  beech/oak-like: flared, slightly bent trunk with spreading limbs
 *   coniferTree()    spruce-like: straight trunk with tiers of drooping needle sprays
 *   silhouetteGeometries()  very simple shapes for the far forest (instanced)
 *
 * `avoid(point, radius) → boolean` drops any limb or foliage card that would intrude on
 * a space the scene needs clear (a view of the moon, the camera's path, a perch).
 */

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * A tube along `points` whose radius follows radiusAt(t, angle). UVs: u wraps the
 * circumference, v runs along the length in metres / vScale, so bark tiles evenly.
 * Vertex colours carry a tint (and moss near the ground when `moss` is set).
 */
export function taperedTube(points, radiusAt, { radial = 10, segments = 16, vScale = 1.4, tint = new THREE.Color(1, 1, 1), moss = 0, mossSide = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const length = curve.getLength();
  const r0 = radiusAt(0, 0);
  const uRepeat = Math.max(1, Math.round((Math.PI * 2 * r0) / 0.9));
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mossCol = new THREE.Color('#5d6e3c');
  const c = new THREE.Color();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = radiusAt(t, a);
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      normals.push(n.x, n.y, n.z);
      uvs.push((j / radial) * uRepeat, (t * length) / vScale);
      const heightMoss = moss * THREE.MathUtils.smoothstep(1.4, 0.1, p.y) * (0.55 + 0.45 * Math.cos(a - mossSide));
      c.copy(tint).lerp(mossCol, Math.max(0, heightMoss));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1); // counter-clockwise seen from outside
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return { geometry: geo, curve };
}

/** A random unit vector, biased upward by `up` (0 = any direction). */
function randomDir(rng, up = 0) {
  const v = new THREE.Vector3(rng.gauss(), rng.gauss() * 0.6 + up, rng.gauss());
  return v.normalize();
}

/** Card orientation: faces roughly along `normal`, randomly rolled. */
function cardQuaternion(rng, normal) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  return q.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng.float(0, Math.PI * 2)));
}

export function broadleafTree(rng, { x, z, height = 16, radius = 0.35, detail = 1, groundY = 0, tint, cardSize = [1.5, 2.3], avoid = null, wobble = 0.25 } = {}) {
  const wood = [];
  const cards = [];
  const leanDir = rng.float(0, Math.PI * 2);
  const lean = rng.float(0.01, 0.04) * height;
  const trunkTop = height * rng.float(0.62, 0.72);
  const pts = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const wob = i > 0 && i < N ? rng.float(-wobble, wobble) * Math.min(1, t * 2) : 0;
    pts.push(
      new THREE.Vector3(
        x + Math.cos(leanDir) * lean * t * t + wob,
        groundY - 0.4 + t * (trunkTop + 0.4),
        z + Math.sin(leanDir) * lean * t * t + wob * 0.7,
      ),
    );
  }
  const lobes = rng.int(4, 6);
  const lobePhase = rng.float(0, Math.PI * 2);
  const trunk = taperedTube(
    pts,
    (t, a) => {
      const h = t * (trunkTop + 0.4);
      const flare = 1 + 0.7 * Math.exp(-h / 0.55) * (0.75 + 0.25 * Math.cos(a * lobes + lobePhase));
      return radius * (1 - 0.62 * t) * flare;
    },
    { radial: detail ? 14 : 7, segments: detail ? 18 : 8, tint, moss: detail ? 1 : 0.6, mossSide: rng.float(0, Math.PI * 2) },
  );
  wood.push(trunk.geometry);

  const crownCenter = new THREE.Vector3();
  const limbCount = detail ? rng.int(5, 7) : rng.int(3, 4);
  const ends = [];
  for (let i = 0; i < limbCount; i++) {
    const t0 = rng.float(0.5, 0.95);
    const start = trunk.curve.getPointAt(t0);
    const az = (i / limbCount) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const elev = rng.float(0.45, 1.05);
    const len = height * rng.float(0.24, 0.36) * (1.1 - t0 * 0.4);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const lp = [start.clone()];
    for (let k = 1; k <= 3; k++) {
      const s = k / 3;
      lp.push(
        start
          .clone()
          .addScaledVector(dir, len * s)
          .add(new THREE.Vector3(rng.float(-0.3, 0.3), s * s * len * 0.25, rng.float(-0.3, 0.3))),
      );
    }
    const r0 = radius * (1 - 0.62 * t0) * rng.float(0.45, 0.6);
    if (avoid && (avoid(lp[3], 1.2) || avoid(lp[2], 0.9))) continue;
    const limb = taperedTube(lp, (t) => r0 * (1 - 0.82 * t), { radial: detail ? 7 : 5, segments: detail ? 8 : 4, tint });
    wood.push(limb.geometry);
    ends.push({ curve: limb.curve, dir });

    if (detail) {
      for (let k = 0; k < 2; k++) {
        const s0 = rng.float(0.35, 0.7);
        const bStart = limb.curve.getPointAt(s0);
        const bDir = dir.clone().add(randomDir(rng, 0.6).multiplyScalar(0.8)).normalize();
        const bLen = len * rng.float(0.3, 0.45);
        const bp = [bStart, bStart.clone().addScaledVector(bDir, bLen * 0.5), bStart.clone().addScaledVector(bDir, bLen).add(new THREE.Vector3(0, bLen * 0.15, 0))];
        if (avoid && avoid(bp[2], 0.9)) continue;
        const br = r0 * (1 - 0.82 * s0) * 0.6;
        const branch = taperedTube(bp, (t) => br * (1 - 0.8 * t), { radial: 5, segments: 4, tint });
        wood.push(branch.geometry);
        ends.push({ curve: branch.curve, dir: bDir });
      }
    }
  }

  // Foliage cards gather around the outer part of every limb and over the crown top.
  const perEnd = detail ? 9 : 6;
  const top = trunk.curve.getPointAt(1);
  const addCard = (p) => {
    const scale = rng.float(cardSize[0], cardSize[1]);
    if (avoid && avoid(p, scale * 0.55)) return;
    cards.push({ position: p, scale });
    crownCenter.add(p);
  };
  for (const { curve } of ends) {
    for (let k = 0; k < perEnd; k++) addCard(curve.getPointAt(rng.float(0.45, 1)).add(randomDir(rng, 0.3).multiplyScalar(rng.float(0.2, 1.3))));
  }
  for (let k = 0; k < (detail ? 10 : 5); k++) addCard(top.clone().add(new THREE.Vector3(rng.gauss() * 1.4, rng.float(0.5, 2.6), rng.gauss() * 1.4)));
  if (cards.length) crownCenter.divideScalar(cards.length);
  else crownCenter.copy(top);
  let crownRadius = 0;
  for (const c of cards) crownRadius = Math.max(crownRadius, c.position.distanceTo(crownCenter) + c.scale * 0.5);
  for (const c of cards) {
    c.normal = _v.copy(c.position).sub(crownCenter).normalize().add(new THREE.Vector3(0, 0.45, 0)).normalize().clone();
    c.quaternion = cardQuaternion(rng, randomDir(rng, 0.2).lerp(c.normal, 0.5).normalize());
    c.kind = 'leaf';
  }
  return { wood, cards, crown: { center: crownCenter, radius: crownRadius }, height: Math.max(height, crownCenter.y + crownRadius) };
}

export function coniferTree(rng, { x, z, height = 20, radius = 0.3, detail = 1, groundY = 0, tint, avoid = null } = {}) {
  const wood = [];
  const cards = [];
  const pts = [];
  const lean = rng.float(0, 0.2);
  const leanDir = rng.float(0, Math.PI * 2);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(x + Math.cos(leanDir) * lean * t, groundY - 0.3 + t * (height + 0.3), z + Math.sin(leanDir) * lean * t));
  }
  const trunk = taperedTube(
    pts,
    (t) => radius * (1 - 0.94 * t) * (1 + 0.45 * Math.exp(-(t * height) / 0.5)),
    { radial: detail ? 10 : 6, segments: detail ? 12 : 6, tint, moss: detail ? 0.8 : 0.4, mossSide: rng.float(0, Math.PI * 2) },
  );
  wood.push(trunk.geometry);

  // Tiers of sprays from a third of the way up; the lowest are long and droop the most.
  const step = detail ? 0.42 : 0.75;
  const start = height * rng.float(0.22, 0.34);
  for (let y = start; y < height - 0.3; y += step * rng.float(0.8, 1.2)) {
    const t = y / height;
    const p = trunk.curve.getPointAt(Math.min(1, (y + 0.3) / (height + 0.3)));
    const len = (1 - t) * height * 0.24 + 0.5;
    const n = detail ? rng.int(5, 7) : rng.int(3, 5);
    const phase = rng.float(0, Math.PI * 2);
    for (let k = 0; k < n; k++) {
      const az = phase + (k / n) * Math.PI * 2 + rng.float(-0.25, 0.25);
      const droop = THREE.MathUtils.lerp(0.55, 0.12, t) + rng.float(-0.08, 0.08);
      const out = new THREE.Vector3(Math.cos(az), -Math.sin(droop), Math.sin(az)).normalize();
      if (avoid && (avoid(_v.copy(p).addScaledVector(out, len), len * 0.3) || avoid(_v.copy(p).addScaledVector(out, len * 0.5), len * 0.3))) continue;
      // Card +X runs along the spray and its face looks up, rolled a little either way.
      const face = UP.clone().addScaledVector(out, -out.y).normalize().applyAxisAngle(out, rng.float(-0.5, 0.5));
      const side = new THREE.Vector3().crossVectors(face, out);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(out, side, face));
      const normal = out.clone().setY(0).normalize().add(new THREE.Vector3(0, 0.75, 0)).normalize();
      cards.push({ position: p.clone(), quaternion: q, scale: len * rng.float(0.9, 1.15), normal, kind: 'needle' });
    }
  }
  const crownCenter = new THREE.Vector3(x, start + (height - start) * 0.4, z);
  return { wood, cards, crown: { center: crownCenter, radius: (height - start) * 0.55 }, height };
}

/** Far-forest silhouettes, unit height (scale per instance): { conifer, broadleaf }. */
export function silhouetteGeometries(rng) {
  // Jitter by a hash of the position, so vertices shared along seams move together.
  const hash = (x, y, z) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const jitter = (geo, amount) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 1 + hash(x.toFixed(4), y.toFixed(4), z.toFixed(4)) * amount;
      pos.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const flat = (g) => (g.index ? g.toNonIndexed() : g);
  const trunk = (r, h) => new THREE.CylinderGeometry(r * 0.6, r, h, 5).translate(0, h / 2, 0);

  const coniferParts = [trunk(0.012, 0.35)];
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = (1 - t) * 0.17 + 0.03;
    const h = 0.3 - t * 0.08;
    coniferParts.push(jitter(new THREE.ConeGeometry(r, h, 7, 1).translate(0, 0.22 + t * 0.62 + h / 2, 0), 0.3));
  }
  const conifer = mergeGeometries(coniferParts.map(flat));

  // An irregular crown of many small lumps on a tall trunk, so the outline is ragged, not a blob.
  const broadParts = [trunk(0.014, 0.62)];
  for (let i = 0; i < 9; i++) {
    const s = rng.float(0.07, 0.12);
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(0, 0.14);
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(s, s * 0.85, s).translate(Math.cos(a) * r, 0.5 + rng.float(0, 0.42) * (1 - r * 2), Math.sin(a) * r);
    broadParts.push(jitter(g, 0.3));
  }
  const broadleaf = mergeGeometries(broadParts.map(flat));
  return { conifer, broadleaf };
}

/**
 * Sets up per-instance matrices, colours and crown normals for foliage cards.
 * `geometry` should already carry an aWind attribute.
 */
export function cardsToInstances(cards, geometry, material, { colorFor, castShadow = true, depthMaterial = null } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3();
  const normals = new Float32Array(cards.length * 3);
  const c = new THREE.Color();
  cards.forEach((card, i) => {
    s.setScalar(card.scale);
    m.compose(card.position, card.quaternion, s);
    mesh.setMatrixAt(i, m);
    normals.set([card.normal.x, card.normal.y, card.normal.z], i * 3);
    mesh.setColorAt(i, colorFor ? colorFor(card, i, c) : c.set(1, 1, 1));
  });
  geometry.setAttribute('aLeafNormal', new THREE.InstancedBufferAttribute(normals, 3));
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
  mesh.computeBoundingSphere();
  return mesh;
}

/** A unit quad for foliage, optionally anchored at its left edge (conifer sprays). */
export function cardGeometry({ anchored = false, aspect = 1, wind = 1 } = {}) {
  const geo = new THREE.PlaneGeometry(1, aspect);
  if (anchored) geo.translate(0.5, 0, 0);
  const pos = geo.attributes.position;
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) w[i] = anchored ? wind * (0.25 + 0.75 * pos.getX(i)) : wind;
  geo.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
  return geo;
}

export { mergeGeometries };
