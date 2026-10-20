import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ComponentTracker } from './ComponentTracker.js';
import { createSkyDome } from './environment.js';
import { Monster } from '../monster/Monster.js';
import { WorldLabels } from '../ui/WorldLabels.js';
import { tween, Ease } from '../core/tween.js';
import { IS_COARSE_POINTER } from '../core/renderer.js';
import { nihilism, bindNihilismTargets, checkSceneEnd } from '../nihilism/nihilism.js';

/**
 * Base class for every location scene.
 *
 * A dedicated scene (src/scenes/locations/<id>.js) extends this class (or
 * PlaceholderScene) and overrides any of these hooks:
 *
 *   BUILD (called once, in this order)
 *     buildEnvironment()    sky, fog, lights — default is a neutral setup already bound
 *                           to the Nihilism Coefficient
 *     buildBackground()     far scenery
 *     buildForeground()     near scenery and props
 *     placeMonster(monster) where the Monster stands (he is created for you)
 *     buildInteractables()  one Object3D per quote objectId, each passed to
 *                           this.registerInteractable(objectId, object)
 *
 *   EVENTS
 *     onUpdate(dt, t)             every frame
 *     onHover(objectId | null)    pointer over a component
 *     onQuoteOpened(quote)        a quote menu opened
 *     onQuoteViewed(quote, impact) first time a quote reaches its impact page
 *     onStepChange(step)          the current step advanced
 *     onComplete()                every required component viewed
 *     styleInteractable(object, state, t)  per-frame look of each component
 *
 * Step gating and manual enabling live in this.tracker (ComponentTracker).
 */
export class BaseScene {
  /** Camera framing when the zoom-in lands. Override per scene. */
  static cameraHome = { position: [0, 3.2, 10.5], target: [0, 1.3, 0] };

  /** Shown in the HUD so unfinished scenes are obvious. */
  static isPlaceholder = false;

  constructor({ location, data, renderer, services }) {
    this.location = location;
    this.data = data;
    this.services = services; // { hud, quoteModal, picker, sceneLabelRoot, onSceneComplete }
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 600);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, {
      enabled: false,
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      minDistance: 4,
      maxDistance: 22,
      minPolarAngle: 0.35,
      maxPolarAngle: 1.45,
      rotateSpeed: 0.5,
    });

    this.tracker = new ComponentTracker(data.quotes);
    this.labels = new WorldLabels(services.sceneLabelRoot);
    this.interactables = new Map(); // objectId → Object3D
    this.impacts = new Map(); // quote key → impact returned by nihilism.applyDelta
    this.hovered = null;
    this.interactive = false;
    this.completed = false;
    this.disposed = false;
    this.elapsed = 0;
    this.unbinders = [];

    const home = this.constructor.cameraHome;
    this.home = { position: new THREE.Vector3(...home.position), target: new THREE.Vector3(...home.target) };
  }

  // ─── Build ──────────────────────────────────────────────────────────────────

  async build() {
    this.buildEnvironment();
    this.buildBackground();
    this.buildForeground();
    this.monster = new Monster();
    this.scene.add(this.monster.object);
    this.placeMonster(this.monster);
    this.buildInteractables();

    for (const id of this.tracker.objectIds) {
      if (!this.interactables.has(id)) {
        console.warn(`[Scene ${this.location.id}] No 3D object registered for objectId "${id}"; that quote can never be opened.`);
      }
    }
    this.tracker.on('step', (step) => this.onStepChange(step));
    this.tracker.on('change', () => this.services.hud.updateScene(this));
  }

  buildEnvironment() {
    this.sky = createSkyDome();
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.02);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 1.1);
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.position.set(7, 13, 9);
    sun.castShadow = true;
    const size = IS_COARSE_POINTER ? 1024 : 2048;
    sun.shadow.mapSize.set(size, size);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    this.bindNihilism({
      lights: [
        { target: hemi, base: 1.1 },
        { target: sun, base: 2.2 },
      ],
      fogs: [{ fog: this.scene.fog }],
      colors: [
        { color: this.sky.uniforms.uTop.value, from: 'skyTop' },
        { color: this.sky.uniforms.uHorizon.value, from: 'skyHorizon' },
      ],
    });
  }

  buildBackground() {}
  buildForeground() {}
  buildInteractables() {}

  placeMonster(monster) {
    monster.object.position.set(0, 0, 0);
  }

  /** Registers a clickable component for a quote objectId. */
  registerInteractable(objectId, object) {
    object.userData.pickId = objectId;
    this.interactables.set(objectId, object);
  }

  /** Hands extra objects (lights, fog, colours) to the Nihilism Coefficient; undone on dispose. */
  bindNihilism(binding) {
    this.unbinders.push(bindNihilismTargets(binding));
  }

  // ─── Hooks (override in dedicated scenes) ───────────────────────────────────

  onUpdate(dt, t) {}
  onHover(objectId) {}
  onQuoteOpened(quote) {}
  onQuoteViewed(quote, impact) {}
  onStepChange(step) {}
  onComplete() {}
  onDispose() {}

  /** Default component styling: pulse emissive materials while a component is waiting to be viewed. */
  styleInteractable(object, state, t) {
    const glow = state.pending ? 0.55 + 0.35 * Math.sin(t * 3) : state.viewed ? 0.2 : 0;
    object.traverse((o) => {
      if (o.material?.emissive) o.material.emissiveIntensity = glow * (state.hovered ? 1.6 : 1);
    });
  }

  // ─── Camera choreography (the zoom-in / zoom-out halves of a transition) ─────

  /** Widens the view and pulls the home framing back on narrow (portrait) screens so components stay in view. */
  #fitHome() {
    const aspect = this.camera.aspect;
    if (aspect >= 1.2) return;
    this.camera.fov = aspect < 0.8 ? 60 : 54;
    this.camera.updateProjectionMatrix();
    const k = Math.min(2.2, 1.25 / aspect);
    this.home.position.sub(this.home.target).multiplyScalar(k).add(this.home.target);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, this.home.position.distanceTo(this.home.target) * 1.3);
  }

  placeCameraForEntry() {
    this.#fitHome();
    const h = this.home.position;
    this.camera.position.set(h.x * 0.4, h.y + 38, h.z + 26);
    this.camera.lookAt(this.home.target);
  }

  async playEntry(duration = 2.2) {
    const from = this.camera.position.clone();
    await tween({
      duration,
      ease: Ease.outCubic,
      onUpdate: (e) => {
        this.camera.position.lerpVectors(from, this.home.position, e);
        this.camera.lookAt(this.home.target);
      },
    });
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }

  async playExit(duration = 1.5) {
    this.setInteractive(false);
    const from = this.camera.position.clone();
    const target = this.controls.target.clone();
    const to = new THREE.Vector3(from.x * 0.4, from.y + 40, from.z + 22);
    await tween({
      duration,
      ease: Ease.inCubic,
      onUpdate: (e) => {
        this.camera.position.lerpVectors(from, to, e);
        this.camera.lookAt(target);
      },
    });
  }

  // ─── Interaction ────────────────────────────────────────────────────────────

  setInteractive(on) {
    this.interactive = on;
    this.controls.enabled = on;
    this.services.picker.setEnabled(on);
  }

  get pickTarget() {
    return {
      camera: this.camera,
      objects: () => [...this.interactables.values()],
      onHover: (id) => {
        this.hovered = id;
        this.onHover(id);
        this.monster?.lookAt(id ? this.interactables.get(id).getWorldPosition(new THREE.Vector3()) : null);
        return id && this.tracker.objectState(id).active ? 'pointer' : 'not-allowed';
      },
      onClick: (hit) => this.openComponent(hit.id),
    };
  }

  /** Click on a component → quote menu (quote → analysis → impact). */
  async openComponent(objectId) {
    if (!this.interactive) return;
    const state = this.tracker.objectState(objectId);
    if (!state.active) {
      this.services.hud.toast(`This unlocks at step ${state.step}.`);
      return;
    }
    const quote = this.tracker.quoteToOpen(objectId);
    if (!quote) return;

    this.setInteractive(false);
    this.onQuoteOpened(quote);
    await this.services.quoteModal.open({
      quote,
      location: this.location,
      index: this.data.quotes.indexOf(quote),
      total: this.data.quotes.length,
      resolveImpact: () => this.#applyQuote(quote),
    });
    if (this.disposed) return;
    if (!this.completed && this.tracker.isComplete) this.complete();
    else this.setInteractive(true);
  }

  /** Runs when the impact page is reached. Applies the delta only the first time. */
  #applyQuote(quote) {
    if (this.impacts.has(quote.key)) return { ...this.impacts.get(quote.key), alreadyApplied: true };

    // After completion the global value is pinned to the scene's end value.
    if (this.completed) {
      const c = nihilism.components;
      const impact = { before: c, after: c, delta: quote.nihilism, clamped: [], pinned: true };
      this.impacts.set(quote.key, impact);
      this.tracker.markViewed(quote);
      return impact;
    }

    const impact = nihilism.applyDelta(quote.nihilism, {
      kind: 'quote',
      sceneId: this.location.id,
      label: `${this.location.name} · ${quote.objectId}`,
    });
    this.impacts.set(quote.key, impact);
    this.tracker.markViewed(quote);
    this.onQuoteViewed(quote, impact);
    return impact;
  }

  /** Every required component viewed → validate, pin to the end value, show Proceed. */
  complete() {
    if (this.completed) return;
    this.completed = true;
    const viewed = this.data.quotes.filter((q) => this.tracker.isViewed(q));
    checkSceneEnd(this.location, nihilism.components, viewed);
    nihilism.set(this.location.nihilism, {
      record: { kind: 'scene-end', sceneId: this.location.id, label: this.location.name },
    });
    this.onComplete();
    this.services.onSceneComplete(this);
    this.setInteractive(true);
  }

  /** Dev mode: view every remaining required quote (applying its delta) and complete. */
  devComplete() {
    for (const q of this.data.quotes) if (q.required && !this.tracker.isViewed(q)) this.#applyQuote(q);
    this.complete();
  }

  // ─── Frame / lifecycle ──────────────────────────────────────────────────────

  update(dt) {
    this.elapsed += dt;
    if (this.interactive) this.controls.update();
    this.monster?.update(dt);
    for (const [id, object] of this.interactables) {
      const state = { ...this.tracker.objectState(id), hovered: id === this.hovered };
      this.styleInteractable(object, state, this.elapsed);
    }
    this.onUpdate(dt, this.elapsed);
    this.labels.update(this.camera);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.onDispose();
    this.unbinders.forEach((unbind) => unbind());
    this.controls.dispose();
    this.labels.clear();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
  }
}
