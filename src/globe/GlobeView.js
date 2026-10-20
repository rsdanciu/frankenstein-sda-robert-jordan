import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Earth, createStarfield } from './earth.js';
import { MarkerLayer } from './markers.js';
import { JourneyArcs } from './arcs.js';
import { latLonToVector3, spreadDuplicates } from './geo.js';
import { WorldLabels } from '../ui/WorldLabels.js';
import { tween, Ease } from '../core/tween.js';
import { bindNihilismTargets, NIHILISM_VISUALS } from '../nihilism/nihilism.js';

/** Camera choreography on the globe (units: globe radius = 1). */
export const GLOBE_CAMERA = {
  fov: 38,
  introDistance: 3.6, // start menu and ending
  focusDistance: 2.05, // resting over a location
  focusTiltDeg: 6, // the camera sits this far south of a marker so pins stand up on screen
  diveAltitude: 1.075, // where a dive into a scene ends
  diveFov: 28,
  idleSpinSpeed: 0.05, // rad/s while a menu covers the globe
};

const ORIGIN = new THREE.Vector3();
const IDENTITY = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

export class GlobeView {
  constructor({ renderer, world, labelRoot }) {
    this.renderer = renderer;
    this.world = world;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(GLOBE_CAMERA.fov, window.innerWidth / window.innerHeight, 0.01, 500);
    latLonToVector3(28, 12, GLOBE_CAMERA.introDistance, this.camera.position);
    this.camera.lookAt(ORIGIN);
    this.camera.position.multiplyScalar(this.#aspectScale);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, {
      enabled: false,
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      minDistance: 1.3,
      maxDistance: 4.2,
      rotateSpeed: 0.4,
      zoomSpeed: 0.6,
    });
    this.controls.maxDistance *= this.#aspectScale;

    this.earth = new Earth();
    this.stars = createStarfield();
    this.scene.add(this.earth.group, this.stars);

    spreadDuplicates(world.locations);
    this.labels = new WorldLabels(labelRoot);
    this.markers = new MarkerLayer(world.locations, this.labels);
    this.arcs = new JourneyArcs(world.locations);
    this.scene.add(this.markers.group, this.arcs.group);

    this.idleSpin = true;
    this.interactive = false;
    this.onSelect = null;
    this.markers.onSelect = (id) => this.interactive && this.onSelect?.(id);

    // Nihilism Coefficient → globe: sun/ambient strength, haze, space and atmosphere colour.
    bindNihilismTargets({
      lights: [
        { target: this.earth.uniforms.uSunIntensity, key: 'value', base: 1.6 },
        { target: this.earth.uniforms.uAmbient, key: 'value', base: 0.1 },
      ],
      fogs: [{ fog: this.scene.fog, scale: NIHILISM_VISUALS.globeFogScale, colorFrom: 'space' }],
      colors: [
        { color: this.scene.background, from: 'space' },
        { color: this.earth.uniforms.uAtmoColor.value, from: 'skyTop' },
      ],
    });
  }

  async build() {
    await this.earth.build(this.renderer);
    this.pickables = [this.earth.globe, ...this.markers.hitAreas];
  }

  get pickTarget() {
    return {
      camera: this.camera,
      objects: () => this.pickables,
      onHover: (id) => {
        this.markers.setHovered(id);
        return this.markers.isClickable(id) ? 'pointer' : 'default';
      },
      onClick: (hit) => this.onSelect?.(hit.id),
    };
  }

  setInteractive(on) {
    this.interactive = on;
    this.controls.enabled = on;
  }

  /** progress.markerState(location) → { state, clickable } */
  refresh(progress) {
    this.markers.setStates((loc) => progress.markerState(loc));
    this.arcs.showUpTo(0);
    this.world.locations.forEach((loc, i) => {
      if (progress.isCompleted(loc.id) && this.arcs.arcs[i]) {
        this.arcs.arcs[i].visible = true;
        this.arcs.arcs[i].material.uniforms.uProgress.value = 1;
      }
    });
  }

  update(dt, elapsed) {
    if (this.idleSpin) {
      this.camera.position.applyAxisAngle(Y_AXIS, dt * GLOBE_CAMERA.idleSpinSpeed);
      this.camera.lookAt(ORIGIN);
    } else if (this.interactive) {
      // Slower rotation when zoomed in so the globe never feels twitchy.
      this.controls.rotateSpeed = 0.15 + 0.3 * THREE.MathUtils.clamp((this.camera.position.length() - 1.3) / 2.9, 0, 1);
      this.controls.update();
    }

    // The sun follows the camera (upper-left, off to the side) so the side you look at is always lit.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorld.extractBasis(_x, _y, _z);
    this.earth.uniforms.uSunDir.value.copy(_z).multiplyScalar(0.55).addScaledVector(_x, -0.7).addScaledVector(_y, 0.5).normalize();

    this.earth.update(dt, elapsed, this.camera);
    this.stars.material.uniforms.uTime.value = elapsed;
    this.markers.update(this.camera, elapsed);
    this.arcs.update(elapsed);
    this.labels.update(this.camera);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = 4.2 * this.#aspectScale;
  }

  // ─── Camera moves ───────────────────────────────────────────────────────────

  /** Portrait screens see less of the globe horizontally, so the camera backs off. */
  get #aspectScale() {
    const aspect = this.camera.aspect;
    return aspect < 1 ? Math.min(1.9, Math.pow(1 / aspect, 0.65)) : 1;
  }

  focusPosition(loc, distance = GLOBE_CAMERA.focusDistance) {
    const lat = THREE.MathUtils.clamp(loc.display.lat - GLOBE_CAMERA.focusTiltDeg, -80, 80);
    return latLonToVector3(lat, loc.display.lon, distance * this.#aspectScale);
  }

  /** Pans along a great circle to look at a location, lifting away for long hops. */
  flyTo(loc, { distance = GLOBE_CAMERA.focusDistance, duration } = {}) {
    return this.#flyToPosition(this.focusPosition(loc, distance), duration);
  }

  /** Wide view over the journey's region (used behind the ending menu). */
  flyToOverview() {
    return this.#flyToPosition(latLonToVector3(40, 14, GLOBE_CAMERA.introDistance * 0.85 * this.#aspectScale), 2.4);
  }

  #flyToPosition(to, duration) {
    this.#settleControls();
    const from = this.camera.position.clone();
    const d0 = from.length();
    const d1 = to.length();
    const dir0 = from.normalize();
    const dir1 = to.clone().normalize();
    const angle = dir0.angleTo(dir1);
    if (angle < 1e-3 && Math.abs(d0 - d1) < 1e-3) return Promise.resolve();

    const q = new THREE.Quaternion().setFromUnitVectors(dir0, dir1);
    const qt = new THREE.Quaternion();
    const lift = Math.min(1.0, angle * 0.7);
    duration ??= THREE.MathUtils.clamp(1.0 + angle * 1.1, 1.1, 2.8);
    return tween({
      duration,
      ease: Ease.inOutCubic,
      onUpdate: (e) => {
        qt.slerpQuaternions(IDENTITY, q, e);
        const d = THREE.MathUtils.lerp(d0, d1, e) + lift * Math.sin(Math.PI * e);
        this.camera.position.copy(dir0).applyQuaternion(qt).multiplyScalar(d);
        this.camera.lookAt(ORIGIN);
      },
    });
  }

  #diveEnd(loc) {
    return latLonToVector3(loc.display.lat - 1.2, loc.display.lon, GLOBE_CAMERA.diveAltitude);
  }

  /** Zooms down onto a marker (the first half of entering a scene). */
  dive(loc, duration = 1.5) {
    const from = this.camera.position.clone();
    const to = this.#diveEnd(loc);
    const surface = latLonToVector3(loc.display.lat, loc.display.lon, 1);
    const look = new THREE.Vector3();
    const fov0 = this.camera.fov;
    return tween({
      duration,
      ease: Ease.inCubic,
      onUpdate: (e) => {
        this.camera.position.lerpVectors(from, to, e);
        this.camera.lookAt(look.lerpVectors(ORIGIN, surface, Ease.inOutSine(e)));
        this.camera.fov = THREE.MathUtils.lerp(fov0, GLOBE_CAMERA.diveFov, e);
        this.camera.updateProjectionMatrix();
      },
    });
  }

  /** Puts the camera where a dive ends, ready to emerge after leaving a scene. */
  placeForEmerge(loc) {
    this.camera.position.copy(this.#diveEnd(loc));
    this.camera.lookAt(latLonToVector3(loc.display.lat, loc.display.lon, 1));
    this.camera.fov = GLOBE_CAMERA.diveFov;
    this.camera.updateProjectionMatrix();
  }

  /** Pulls back out from a marker (the first half of leaving a scene). */
  emerge(loc, duration = 1.7) {
    const from = this.camera.position.clone();
    const to = this.focusPosition(loc, GLOBE_CAMERA.focusDistance * 1.08);
    const surface = latLonToVector3(loc.display.lat, loc.display.lon, 1);
    const look = new THREE.Vector3();
    const fov0 = this.camera.fov;
    return tween({
      duration,
      ease: Ease.outCubic,
      onUpdate: (e) => {
        this.camera.position.lerpVectors(from, to, e);
        this.camera.lookAt(look.lerpVectors(surface, ORIGIN, Ease.inOutSine(e)));
        this.camera.fov = THREE.MathUtils.lerp(fov0, GLOBE_CAMERA.fov, e);
        this.camera.updateProjectionMatrix();
      },
    });
  }

  /**
   * Clears any leftover drag momentum so it cannot fight a scripted move.
   * Only called when the camera is already looking at the globe's centre.
   */
  #settleControls() {
    const c = this.controls;
    c.enableDamping = false;
    c.update();
    c.enableDamping = true;
  }
}
