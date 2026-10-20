import * as THREE from 'three';

// Shared environment pieces for location scenes.

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;

const skyFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.9, h), 0.7));
  col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.4, h));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * A gradient sky dome. uTop / uHorizon are bound to the Nihilism Coefficient's
 * skyTop / skyHorizon colours by BaseScene.buildEnvironment().
 */
export function createSkyDome(radius = 400) {
  const uniforms = {
    uTop: { value: new THREE.Color('#3f7fd0') },
    uHorizon: { value: new THREE.Color('#bcd6ee') },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}
