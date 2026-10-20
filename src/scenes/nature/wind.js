import * as THREE from 'three';

// Gentle wind for leaves, needles and grass. applyWind() patches a built-in material so
// each vertex is displaced in world space after instancing, weighted by the geometry's
// `aWind` attribute (0 = anchored, 1 = moves fully). The scene advances WIND.uTime.
//
// leafNormals: lights foliage cards with a per-instance `aLeafNormal` (pointing out of
// the crown) instead of the flat card normal, so a crown shades like a soft volume and
// the back of a card is not black.

export const WIND = {
  uTime: { value: 0 },
  uStrength: { value: 1 },
};

const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform float uWindStrength;
attribute float aWind;
vec3 windOffset(vec3 p, float weight, float sway, float flutter) {
  float t = uWindTime;
  float gust = 0.55 + 0.45 * sin(t * 0.37 + p.x * 0.05) * sin(t * 0.23 + p.z * 0.04 + 1.3);
  vec3 o = vec3(sin(t * 1.1 + p.x * 0.35 + p.z * 0.2), 0.0, cos(t * 0.9 + p.z * 0.33 + p.x * 0.15) * 0.6) * sway * gust;
  o += vec3(
    sin(t * 5.3 + dot(p, vec3(3.1, 2.3, 1.7))),
    cos(t * 4.7 + dot(p, vec3(1.3, 3.7, 2.9))) * 0.6,
    sin(t * 6.1 + dot(p, vec3(2.2, 1.1, 3.3)))
  ) * flutter * (0.5 + gust);
  return o * weight * uWindStrength;
}
`;

const f = (v) => v.toFixed(4);

export function applyWind(material, { sway = 0.08, flutter = 0.015, leafNormals = false } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = WIND.uTime;
    shader.uniforms.uWindStrength = WIND.uStrength;
    let vs = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n${WIND_GLSL}${leafNormals ? 'attribute vec3 aLeafNormal;\n' : ''}`,
    );
    vs = vs.replace(
      '#include <project_vertex>',
      /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
mvPosition.xyz += windOffset( mvPosition.xyz, aWind, ${f(sway)}, ${f(flutter)} );
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
    );
    if (leafNormals) {
      vs = vs.replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\ntransformedNormal = normalize( mat3( viewMatrix ) * aLeafNormal );',
      );
      // Keep the crown normal on both faces of the card.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      );
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => `wind:${sway}:${flutter}:${leafNormals}`;
  return material;
}

/** Shadow-casting copy for alpha-cut foliage, swaying with the same wind. */
export function windDepthMaterial(map, alphaTest, options) {
  return applyWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest }), {
    ...options,
    leafNormals: false,
  });
}
