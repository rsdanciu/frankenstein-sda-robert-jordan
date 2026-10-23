import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry for simple buildings. UVs are in metres, so the textures in
 * buildings/textures.js (set up with `metric`) keep the same scale on every piece.
 *
 *   wallGeometry({ length, height, thickness, holes, gable })
 *       A wall along +X from 0 to `length`, standing on y = 0, with its outside face at
 *       z = 0 and inside face at z = −thickness. `holes` [{ x0, x1, y0, y1 }] are cut
 *       right through (with reveals). `gable` { shoulder, rise } adds a pitched top.
 *       Material groups: 0 outside, 1 inside, 2 reveals and edges.
 *   box(w, h, d)                      a centred box with metric UVs on every face
 *   placed(geometry, position, euler) bakes a transform into a geometry (for merging)
 *   timberFrame({ length, height, … }) beam rectangles for a timber-framed wall face
 *   merge(list)                        mergeGeometries, disposing the parts
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

class Faces {
  constructor() {
    this.groups = [[], [], []]; // per group: flat arrays of { p, n, uv }
  }

  /** A planar polygon (convex, ≥ 3 points) facing `normal`; uv(p) maps a point to UVs. */
  add(group, points, normal, uv) {
    // Wind the polygon so it faces along `normal`.
    _a.subVectors(points[1], points[0]);
    _b.subVectors(points[2], points[0]);
    _n.crossVectors(_a, _b);
    const pts = _n.dot(normal) < 0 ? [...points].reverse() : points;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) this.groups[group].push({ p, n: normal, uv: uv(p) });
    }
  }

  build() {
    const positions = [];
    const normals = [];
    const uvs = [];
    const geo = new THREE.BufferGeometry();
    let start = 0;
    this.groups.forEach((list, g) => {
      for (const v of list) {
        positions.push(v.p.x, v.p.y, v.p.z);
        normals.push(v.n.x, v.n.y, v.n.z);
        uvs.push(v.uv[0], v.uv[1]);
      }
      if (list.length) geo.addGroup(start, list.length, g);
      start += list.length;
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geo;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PX = V(1, 0, 0);
const NX = V(-1, 0, 0);
const PY = V(0, 1, 0);
const NY = V(0, -1, 0);
const PZ = V(0, 0, 1);
const NZ = V(0, 0, -1);
const uvXY = (p) => [p.x, p.y];
const uvXZ = (p) => [p.x, p.z];
const uvZY = (p) => [p.z, p.y];

export function wallGeometry({ length, height, thickness = 0.24, holes = [], gable = null }) {
  const F = new Faces();
  const t = -thickness;
  const xs = [...new Set([0, length, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([0, height, ...holes.flatMap((h) => [h.y0, h.y1])])].sort((a, b) => a - b);
  const inHole = (x, y) => holes.some((h) => x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1);

  // Faces, cell by cell around the openings.
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (inHole((x0 + x1) / 2, (y0 + y1) / 2)) continue;
      F.add(0, [V(x0, y0, 0), V(x1, y0, 0), V(x1, y1, 0), V(x0, y1, 0)], PZ, uvXY);
      F.add(1, [V(x0, y0, t), V(x1, y0, t), V(x1, y1, t), V(x0, y1, t)], NZ, (p) => [-p.x, p.y]);
    }
  }

  // Reveals around each opening.
  for (const h of holes) {
    if (h.y0 > 0) F.add(2, [V(h.x0, h.y0, 0), V(h.x1, h.y0, 0), V(h.x1, h.y0, t), V(h.x0, h.y0, t)], PY, uvXZ);
    F.add(2, [V(h.x0, h.y1, 0), V(h.x1, h.y1, 0), V(h.x1, h.y1, t), V(h.x0, h.y1, t)], NY, uvXZ);
    F.add(2, [V(h.x0, h.y0, 0), V(h.x0, h.y1, 0), V(h.x0, h.y1, t), V(h.x0, h.y0, t)], PX, uvZY);
    F.add(2, [V(h.x1, h.y0, 0), V(h.x1, h.y1, 0), V(h.x1, h.y1, t), V(h.x1, h.y0, t)], NX, uvZY);
  }

  // Top: flat, or a gable (shoulders + a pitched triangle).
  let top = height;
  if (gable) {
    const s = height + gable.shoulder;
    const apex = V(length / 2, s + gable.rise, 0);
    const outline = [V(0, height, 0), V(length, height, 0), V(length, s, 0), apex, V(0, s, 0)];
    F.add(0, outline, PZ, uvXY);
    F.add(1, outline.map((p) => V(p.x, p.y, t)), NZ, (p) => [-p.x, p.y]);
    const slope = (a, b) => {
      const n = V(0, 0, 1).cross(_a.subVectors(b, a)).normalize().clone();
      F.add(2, [a, b, V(b.x, b.y, t), V(a.x, a.y, t)], n, (p) => [p.x + p.y, p.z]);
    };
    slope(V(0, s, 0), apex);
    slope(apex, V(length, s, 0));
    top = s;
  } else {
    F.add(2, [V(0, height, 0), V(length, height, 0), V(length, height, t), V(0, height, t)], PY, uvXZ);
  }

  // Ends
  F.add(2, [V(0, 0, 0), V(0, top, 0), V(0, top, t), V(0, 0, t)], NX, uvZY);
  F.add(2, [V(length, 0, 0), V(length, top, 0), V(length, top, t), V(length, 0, t)], PX, uvZY);
  return F.build();
}

/** A box centred on the origin with UVs in metres on every face. */
export function box(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    if (ax > 0.5) uv.setXY(i, z, y);
    else if (ay > 0.5) uv.setXY(i, x, z);
    else uv.setXY(i, x, y);
  }
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);

export function placed(geometry, position, rotation = [0, 0, 0]) {
  _e.set(rotation[0], rotation[1], rotation[2], rotation[3] ?? 'XYZ');
  _m.compose(_a.set(position[0], position[1], position[2]), _q.setFromEuler(_e), _s);
  return geometry.applyMatrix4(_m);
}

export function merge(list) {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
  list.forEach((x) => x.dispose());
  return g;
}

/**
 * Beams for a timber-framed (Fachwerk) wall face, as rectangles in the wall's plane:
 * [{ x, y, w, h, angle }] (centre, size, rotation). Posts stand at the corners, beside
 * every opening and at most `spacing` apart; a sill beam runs over the stone plinth, a
 * top plate under the eaves, rails at `rails` heights, a lintel over each opening and a
 * sill under each window; long braces fill the end panels. Gable posts and a collar beam
 * are added when `gable` is given.
 */
export function timberFrame({ length, height, openings = [], plinth = 0.32, beam = 0.15, spacing = 1.25, rails = [], gable = null, braces = true }) {
  const out = [];
  const rect = (x0, y0, x1, y1) => out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, angle: 0 });
  const yBottom = plinth + beam;
  const yTop = height - beam;
  const crosses = (x0, x1, y) => openings.some((o) => x1 > o.x0 + 1e-3 && x0 < o.x1 - 1e-3 && y > o.y0 - 1e-3 && y < o.y1 + 1e-3);

  // Sill beam and top plate (the sill stops at doors)
  const doorEdges = openings.filter((o) => o.y0 < yBottom).flatMap((o) => [o.x0, o.x1]);
  const sillStops = [0, ...doorEdges, length].sort((a, b) => a - b);
  for (let i = 0; i < sillStops.length - 1; i += 2) rect(sillStops[i], plinth, sillStops[i + 1], yBottom);
  rect(0, yTop, length, height);

  // Posts
  let posts = [beam / 2, length - beam / 2];
  for (const o of openings) posts.push(o.x0 - beam / 2, o.x1 + beam / 2);
  posts = [...new Set(posts.map((p) => +p.toFixed(3)))].sort((a, b) => a - b);
  const filled = [];
  for (let i = 0; i < posts.length; i++) {
    filled.push(posts[i]);
    const next = posts[i + 1];
    if (next === undefined) break;
    const gap = next - posts[i];
    const mid = (posts[i] + next) / 2;
    if (gap > spacing && !openings.some((o) => mid > o.x0 && mid < o.x1)) {
      const n = Math.ceil(gap / spacing);
      for (let k = 1; k < n; k++) filled.push(posts[i] + (gap * k) / n);
    }
  }
  const postX = filled.filter((x) => !openings.some((o) => x > o.x0 && x < o.x1));
  for (const x of postX) rect(x - beam / 2, yBottom, x + beam / 2, yTop);

  // Rails between posts, plus a lintel over and a sill under each opening.
  for (const y of rails) {
    for (let i = 0; i < postX.length - 1; i++) {
      const x0 = postX[i] + beam / 2;
      const x1 = postX[i + 1] - beam / 2;
      if (!crosses(x0, x1, y)) rect(x0, y - beam / 2, x1, y + beam / 2);
    }
  }
  for (const o of openings) {
    rect(o.x0 - beam, o.y1, o.x1 + beam, o.y1 + beam);
    if (o.y0 > yBottom + beam) rect(o.x0 - beam, o.y0 - beam, o.x1 + beam, o.y0);
  }

  // Braces in the end panels that have no opening
  if (braces && postX.length > 2) {
    for (const [a, b] of [[postX[0], postX[1]], [postX[postX.length - 1], postX[postX.length - 2]]]) {
      const x0 = a + Math.sign(b - a) * beam / 2;
      const x1 = b - Math.sign(b - a) * beam / 2;
      if (openings.some((o) => Math.min(x0, x1) < o.x1 && Math.max(x0, x1) > o.x0)) continue;
      const dx = x1 - x0;
      const dy = yTop - yBottom;
      out.push({ x: (x0 + x1) / 2, y: (yBottom + yTop) / 2, w: Math.hypot(dx, dy), h: beam * 0.9, angle: Math.atan2(dy, dx) });
    }
  }

  // Gable: posts up to the roof line and a collar beam
  if (gable) {
    const s = height + gable.shoulder;
    const roofAt = (x) => s + gable.rise * (1 - Math.abs(x - length / 2) / (length / 2));
    const collar = height + gable.shoulder + gable.rise * 0.42;
    const half = (length / 2) * (1 - (collar - s) / gable.rise);
    rect(length / 2 - half + beam, collar - beam / 2, length / 2 + half - beam, collar + beam / 2);
    for (const f of [0.3, 0.5, 0.7]) {
      const x = length * f;
      rect(x - beam / 2, height, x + beam / 2, roofAt(x) - beam * 1.2);
    }
  }
  return out;
}
