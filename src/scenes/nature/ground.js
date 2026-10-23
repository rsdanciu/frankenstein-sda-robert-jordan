import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2 } from './random.js';

/**
 * Terrain and small ground detail for outdoor scenes.
 *
 *   createGround({ heightAt, grassAt, tintAt, textures })  one large mesh, denser near the
 *       centre; blends a grass texture and a leaf-litter texture by grassAt(x, z) ∈ [0, 1]
 *   groundSurfaceAt(ground, x, z)  the height of that mesh's own triangles (not heightAt) at a point
 *   groundNormalAt(ground, x, z, target)  and its interpolated normal there
 *   groundMaterial(textures)  the same blended material, for other geometry laid on the ground
 *       (it needs uv, color and aGrass attributes)
 *   grassTuftGeometry / fernGeometry / flatLeafGeometry / twigGeometry / rockGeometry
 *   scatter(geometry, material, items)  → one InstancedMesh from [{ position, rotationY, scale, color, tilt }]
 */

export function createGround({ size = 320, segments = 320, power = 1.75, heightAt, grassAt = () => 1, tintAt = null, textures, tile = 3 }) {
  const n = segments;
  const verts = (n + 1) * (n + 1);
  const positions = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const grass = new Float32Array(verts);
  const colors = new Float32Array(verts * 3);
  const coord = (i) => {
    const u = (i / n) * 2 - 1;
    return Math.sign(u) * Math.pow(Math.abs(u), power) * (size / 2);
  };
  const c = new THREE.Color();
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const z = coord(j);
    for (let i = 0; i <= n; i++, k++) {
      const x = coord(i);
      positions[k * 3] = x;
      positions[k * 3 + 1] = heightAt(x, z);
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x / tile;
      uvs[k * 2 + 1] = -z / tile;
      grass[k] = grassAt(x, z);
      c.set(1, 1, 1);
      if (tintAt) tintAt(x, z, c);
      colors.set([c.r, c.g, c.b], k * 3);
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + n + 1;
      indices.set([a, b, a + 1, b, b + 1, a + 1], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, groundMaterial(textures));
  mesh.receiveShadow = true;
  mesh.userData.grid = { size, segments, power };
  return mesh;
}

/**
 * The height of a createGround mesh's triangles at (x, z): what is actually drawn, which
 * between vertices can sit above or below heightAt. Things laid on the ground (a path)
 * follow this so they neither float nor sink under coarse far triangles.
 */
export function groundSurfaceAt(ground, x, z) {
  const pos = ground.geometry.attributes.position;
  const [a, b, c, wa, wb, wc] = triangleAt(ground, x, z);
  return pos.getY(a) * wa + pos.getY(b) * wb + pos.getY(c) * wc;
}

/** The mesh's shading normal at (x, z), so something laid on it can light exactly like it. */
export function groundNormalAt(ground, x, z, target = new THREE.Vector3()) {
  const nor = ground.geometry.attributes.normal;
  const [a, b, c, wa, wb, wc] = triangleAt(ground, x, z);
  return target
    .set(nor.getX(a) * wa + nor.getX(b) * wb + nor.getX(c) * wc, nor.getY(a) * wa + nor.getY(b) * wb + nor.getY(c) * wc, nor.getZ(a) * wa + nor.getZ(b) * wb + nor.getZ(c) * wc)
    .normalize();
}

/** The triangle of a createGround mesh under (x, z): three vertex indices and their weights. */
function triangleAt(ground, x, z) {
  const { size, segments: n, power } = ground.userData.grid;
  const half = size / 2;
  const coord = (i) => {
    const u = (i / n) * 2 - 1;
    return Math.sign(u) * Math.pow(Math.abs(u), power) * half;
  };
  const index = (v) => {
    const u = Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) / half), 1 / power);
    return Math.min(n - 1, Math.max(0, Math.floor(((u + 1) / 2) * n)));
  };
  const i = index(x);
  const j = index(z);
  const x0 = coord(i);
  const z0 = coord(j);
  const fx = THREE.MathUtils.clamp((x - x0) / (coord(i + 1) - x0), 0, 1);
  const fz = THREE.MathUtils.clamp((z - z0) / (coord(j + 1) - z0), 0, 1);
  const v = (ii, jj) => jj * (n + 1) + ii;
  // Each quad is split along the (i + 1, j) – (i, j + 1) diagonal (see the index order above).
  if (fx + fz <= 1) return [v(i, j), v(i + 1, j), v(i, j + 1), 1 - fx - fz, fx, fz];
  return [v(i + 1, j + 1), v(i, j + 1), v(i + 1, j), fx + fz - 1, 1 - fx, 1 - fz];
}

export function groundMaterial(textures) {
  const material = new THREE.MeshStandardMaterial({
    map: textures.grassMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.96,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLitter = { value: textures.litterMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrass;\nvarying float vGrass;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrass = aGrass;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLitter;\nvarying float vGrass;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
  vec4 grassSample = texture2D( map, vMapUv );
  vec4 litterSample = texture2D( uLitter, vMapUv * 0.83 + 0.37 );
  diffuseColor *= mix( litterSample, grassSample, smoothstep( 0.15, 0.85, vGrass ) );
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'ground-blend';
  return material;
}

/** Three crossed blades-cards, 1 × 1, rooted at y = 0. Normals point up so tufts light like the ground. */
export function grassTuftGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, 0.5, 0).rotateY((k * Math.PI) / 3);
    parts.push(g);
  }
  return finishCards(parts, (y) => y * y);
}

/** A rosette of fern fronds arching out from the centre, ~1 m across at scale 1. */
export function fernGeometry(count = 6) {
  const parts = [];
  for (let k = 0; k < count; k++) {
    const g = new THREE.PlaneGeometry(0.24, 1, 1, 3).translate(0, 0.5, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, -y * y * 0.35); // arch the frond
    }
    g.rotateX(-0.95).rotateY((k / count) * Math.PI * 2 + 0.3);
    parts.push(g);
  }
  return finishCards(parts, (y, r) => Math.min(1, r * 1.4));
}

function finishCards(parts, windAt) {
  const geo = parts.length > 1 ? mergeAll(parts) : parts[0];
  const pos = geo.attributes.position;
  const wind = new Float32Array(pos.count);
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    wind[i] = windAt(y, Math.hypot(pos.getX(i), pos.getZ(i)));
    normals.set([0, 1, 0], i * 3);
  }
  geo.setAttribute('aWind', new THREE.BufferAttribute(wind, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

function mergeAll(parts) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let offset = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    for (const i of g.index.array) indices.push(i + offset);
    offset += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** A leaf lying flat on the ground (0.5 × 1 at scale 1). */
export function flatLeafGeometry() {
  const g = new THREE.PlaneGeometry(0.5, 1).rotateX(-Math.PI / 2);
  g.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

/** A thin tapering stick along +X, length 1 and radius 1 (scale per instance). */
export function twigGeometry() {
  return new THREE.CylinderGeometry(0.5, 1, 1, 5, 1).rotateZ(Math.PI / 2);
}

/** An irregular, slightly flattened stone with moss on its upper faces (vertex colours). */
export function rockGeometry(rng, { moss = 0.5 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const seed = rng.int(0, 1000);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2(v.x * 1.3 + seed, v.z * 1.3 + v.y * 0.7, 3, seed);
    v.multiplyScalar(0.75 + n * 0.5);
    v.y *= 0.62;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const normal = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const stone = new THREE.Color('#8a8a84');
  const mossCol = new THREE.Color('#5b6a3c');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const up = normal.getY(i);
    c.copy(stone).lerp(mossCol, moss * THREE.MathUtils.smoothstep(up, 0.55, 0.9));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** One InstancedMesh for a list of placements. */
export function scatter(geometry, material, items, { castShadow = false, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  items.forEach((it, i) => {
    e.set(it.tiltX ?? 0, it.rotationY ?? 0, it.tiltZ ?? 0, 'YXZ');
    q.setFromEuler(e);
    if (typeof it.scale === 'number') s.setScalar(it.scale);
    else s.copy(it.scale);
    m.compose(it.position, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  return mesh;
}
