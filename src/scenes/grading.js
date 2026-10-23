import * as THREE from 'three';

/**
 * Local colour grading that the full-frame grade pass cannot do: patches for built-in
 * materials (MeshStandard / Lambert / Basic), applied once after a scene is built.
 *
 *   applyDrain(material)          colour and light drain out within a radius of a moving
 *                                 centre (around the Monster as a component collapses:
 *                                 Truth in Rural Germany, Unity in Geneva). DRAIN holds the
 *                                 shared uniforms.
 *   applyInteriorLight(material)  for a room seen from outside: a warm ambient replaces the
 *                                 outdoor sky light, and the colour saturation is held
 *                                 against the grade pass (`uKeepSaturation` = wanted ÷ current),
 *                                 so the room keeps its look while the world outside greys.
 *   applyKeepBelow(material)      the same hold on saturation (and light) for everything below
 *                                 a world height, e.g. a distant valley that must stay warm and
 *                                 visible while the mountain around the Monster greys. KEEP.
 *   applyHaze(material)           aerial perspective by distance from the camera, for views
 *                                 kilometres deep where scene fog would hide what must be seen. HAZE.
 *
 * All chain any onBeforeCompile a material already has (wind, ground blending, each other).
 */

export const DRAIN = {
  uDrain: { value: 0 }, // 0 = no effect, 1 = full
  uDrainCenter: { value: new THREE.Vector3() },
  uDrainRadius: { value: new THREE.Vector2(1, 4) }, // full strength inside x, none beyond y (metres)
  uDrainDesaturate: { value: 0.85 },
  uDrainDarken: { value: 0.25 },
};

export const INTERIOR = {
  uInteriorAmbient: { value: new THREE.Color('#3a2414') },
  uKeepSaturation: { value: 1 },
};

export const KEEP = {
  uKeepBelowSaturation: { value: 1 }, // wanted ÷ current saturation
  uKeepBelowLight: { value: 1 }, // wanted ÷ current light
  uKeepBelowY: { value: -400 }, // full hold below this height, none 120 m above it
};

export const HAZE = {
  uHazeColor: { value: new THREE.Color('#c9d3dd') },
  uHazeDensity: { value: 0.0002 }, // per metre
};

// The world position, declared and computed once however many patches need it.
const WORLD_DECLARE = /* glsl */ `
#ifndef GRADE_WORLD
#define GRADE_WORLD
varying vec3 vGradeWorld;
#endif`;

const WORLD_POSITION = /* glsl */ `
#ifndef GRADE_WORLD_SET
#define GRADE_WORLD_SET
vec4 gradeWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  gradeWorld = instanceMatrix * gradeWorld;
#endif
vGradeWorld = ( modelMatrix * gradeWorld ).xyz;
#endif
#include <worldpos_vertex>`;

function withWorld(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${WORLD_DECLARE}`)
    .replace('#include <worldpos_vertex>', WORLD_POSITION); // (wind patches replace project_vertex)
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${WORLD_DECLARE}`);
}

/** Adds GLSL declarations after <common> and a block just before tone mapping. */
function inject(shader, declarations, block) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${declarations}`)
    .replace('#include <tonemapping_fragment>', `{\n${block}\n}\n#include <tonemapping_fragment>`);
}

function chain(material, key, patch) {
  if (material.userData[key]) return material;
  material.userData[key] = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${key}`;
  material.needsUpdate = true;
  return material;
}

export function applyDrain(material) {
  return chain(material, 'drain', (shader) => {
    Object.assign(shader.uniforms, DRAIN);
    withWorld(shader);
    inject(
      shader,
      'uniform float uDrain;\nuniform vec3 uDrainCenter;\nuniform vec2 uDrainRadius;\nuniform float uDrainDesaturate;\nuniform float uDrainDarken;',
      /* glsl */ `
  float drainK = uDrain * ( 1.0 - smoothstep( uDrainRadius.x, uDrainRadius.y, distance( vGradeWorld.xz, uDrainCenter.xz ) ) );
  float drainLuma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( drainLuma ), drainK * uDrainDesaturate ) * ( 1.0 - drainK * uDrainDarken );`,
    );
  });
}

export function applyInteriorLight(material) {
  return chain(material, 'interior', (shader) => {
    Object.assign(shader.uniforms, INTERIOR);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )', 'uInteriorAmbient'),
    );
    inject(
      shader,
      'uniform vec3 uInteriorAmbient;\nuniform float uKeepSaturation;',
      /* glsl */ `
  float keepLuma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor.rgb = max( mix( vec3( keepLuma ), gl_FragColor.rgb, uKeepSaturation ), 0.0 );`,
    );
  });
}

export function applyKeepBelow(material) {
  return chain(material, 'keepBelow', (shader) => {
    Object.assign(shader.uniforms, KEEP);
    withWorld(shader);
    inject(
      shader,
      'uniform float uKeepBelowSaturation;\nuniform float uKeepBelowLight;\nuniform float uKeepBelowY;',
      /* glsl */ `
  float keepK = 1.0 - smoothstep( uKeepBelowY, uKeepBelowY + 120.0, vGradeWorld.y );
  float keepLuma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 kept = max( mix( vec3( keepLuma ), gl_FragColor.rgb, uKeepBelowSaturation ), 0.0 ) * uKeepBelowLight;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, kept, keepK );`,
    );
  });
}

export function applyHaze(material) {
  material.fog = false; // the haze replaces scene fog on this material
  return chain(material, 'haze', (shader) => {
    Object.assign(shader.uniforms, HAZE);
    withWorld(shader);
    inject(
      shader,
      'uniform vec3 uHazeColor;\nuniform float uHazeDensity;',
      /* glsl */ `
  float hazeK = 1.0 - exp( -distance( vGradeWorld, cameraPosition ) * uHazeDensity );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, hazeK );`,
    );
  });
}
