import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// One WebGL renderer for the whole app. Frames go:
//   RenderPass (active view) → GradePass (saturation, vignette, transition haze) → OutputPass (tone map + sRGB)
// The grade pass is where the Nihilism Coefficient's saturation/vignette land.

export const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

export function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, IS_COARSE_POINTER ? 1.5 : 2);
}

export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1 },
    uVignette: { value: 0.25 },
    uHaze: { value: 0 }, // 0 = clear, 1 = fully hazed (scene transitions)
    uHazeColor: { value: new THREE.Color(0.85, 0.9, 0.95) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uHaze;
    uniform vec3 uHazeColor;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(luma), c.rgb, uSaturation), 0.0);

      vec2 d = vUv - 0.5;
      float r = length(d * vec2(1.15, 1.0));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, r), uVignette);

      // Haze is brightest in the middle, like flying into cloud.
      float haze = clamp(uHaze * (1.25 - r * 0.7), 0.0, 1.0);
      c.rgb = mix(c.rgb, uHazeColor, haze);

      gl_FragColor = c;
    }`,
};

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.id = 'stage';
  container.prepend(renderer.domElement);

  // Multisampled HDR target gives antialiasing without an extra FXAA pass.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: IS_COARSE_POINTER ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());

  function resize() {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(pixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  return { renderer, composer, renderPass, gradePass, resize };
}
