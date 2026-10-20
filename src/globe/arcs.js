import * as THREE from 'three';
import { latLonToVector3 } from './geo.js';
import { tween, Ease } from '../core/tween.js';

// Great-circle arcs that trace the journey: arc i joins location i to location i + 1
// and is drawn once location i is completed.

const IDENTITY = new THREE.Quaternion();

class ArcCurve extends THREE.Curve {
  constructor(a, b) {
    super();
    this.a = a.clone().normalize();
    this.q = new THREE.Quaternion().setFromUnitVectors(this.a, b.clone().normalize());
    // Longer hops arc higher above the surface.
    this.height = Math.max(0.008, this.a.angleTo(b) * 0.32);
    this._q = new THREE.Quaternion();
  }

  getPoint(t, target = new THREE.Vector3()) {
    this._q.slerpQuaternions(IDENTITY, this.q, t);
    return target.copy(this.a).applyQuaternion(this._q).multiplyScalar(1.002 + this.height * Math.sin(Math.PI * t));
  }
}

const arcVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const arcFragment = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  if (vUv.x > uProgress) discard;
  float dash = 0.55 + 0.45 * sin(vUv.x * 70.0 - uTime * 3.0);
  float head = smoothstep(uProgress - 0.12, uProgress, vUv.x) * step(uProgress, 0.999);
  gl_FragColor = vec4(uColor * (1.0 + head * 1.5), 0.75 * dash);
}`;

export class JourneyArcs {
  constructor(locations) {
    this.group = new THREE.Group();
    this.time = { value: 0 };
    this.arcs = [];
    for (let i = 0; i < locations.length - 1; i++) {
      const a = latLonToVector3(locations[i].display.lat, locations[i].display.lon);
      const b = latLonToVector3(locations[i + 1].display.lat, locations[i + 1].display.lon);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(new ArcCurve(a, b), 96, 0.0018, 6, false),
        new THREE.ShaderMaterial({
          uniforms: { uProgress: { value: 0 }, uTime: this.time, uColor: { value: new THREE.Color('#ffe2a8') } },
          vertexShader: arcVertex,
          fragmentShader: arcFragment,
          transparent: true,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 9;
      mesh.visible = false;
      this.group.add(mesh);
      this.arcs.push(mesh);
    }
  }

  /** Shows arcs 0 … count-1 fully drawn. */
  showUpTo(count) {
    this.arcs.forEach((arc, i) => {
      arc.visible = i < count;
      arc.material.uniforms.uProgress.value = i < count ? 1 : 0;
    });
  }

  hide(index) {
    const arc = this.arcs[index];
    if (!arc) return;
    arc.visible = false;
    arc.material.uniforms.uProgress.value = 0;
  }

  /** Draws arc `index` from start to end. The last location has no outgoing arc. */
  async draw(index, duration = 1.6) {
    const arc = this.arcs[index];
    if (!arc) return;
    arc.material.uniforms.uProgress.value = 0;
    arc.visible = true;
    await tween({
      duration,
      ease: Ease.inOutSine,
      onUpdate: (e) => (arc.material.uniforms.uProgress.value = e),
    });
  }

  update(elapsed) {
    this.time.value = elapsed;
  }
}
