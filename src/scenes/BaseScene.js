import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ComponentTracker } from './ComponentTracker.js';
import { createSkyDome } from './environment.js';
import { Monster } from '../monster/Monster.js';
import { WorldLabels } from '../ui/WorldLabels.js';
import { el } from '../ui/dom.js';
import { tween, Ease } from '../core/tween.js';
import { IS_COARSE_POINTER } from '../core/renderer.js';
import { nihilism, bindNihilismTargets, checkSceneEnd } from '../nihilism/nihilism.js';

const DEG = Math.PI / 180;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
 *     prepareQuote(quote)         async; runs after a click, before the menu opens (move the
 *                                 camera, play an action); the menu waits for it
 *     onQuoteOpened(quote)        a quote menu opened
 *     onQuoteViewed(quote, impact) first time a quote reaches its impact page
 *     onQuoteClosed(quote, { viewed }) the menu closed again
 *     onStepChange(step)          the current step advanced
 *     onComplete()                every required component viewed
 *     styleInteractable(object, state, t)  per-frame look of each component
 *
 *   CAMERA
 *     fitHome(aspect)       adjusts the landing framing for narrow (portrait) screens
 *     entryPosition(home)   where the zoom-in starts (default: high above and behind)
 *     exitPosition(from)    where the zoom-out ends
 *     useViews(views)       named framings { name: { position, target, fov, needs } }; `home`
 *                           is where the zoom-in lands. Each is widened (and pulled back) so a
 *                           horizontal half-angle of `needs` degrees fits narrow screens.
 *     flyTo(name, seconds)  glides the camera to a view and limits the orbit around it
 *
 *   LABELS
 *     addComponentLabel(objectId, getPoint)  a clickable label pinned to a component
 *                                 (quieter for optional ones), hidden while it is locked
 *
 * Step gating and manual enabling live in this.tracker (ComponentTracker). A registered
 * object whose `visible` is false cannot be clicked (e.g. a moon below the horizon).
 * Objects in this.pickBlockers (walls, roofs) stop clicks reaching components behind them.
 */
export class BaseScene {
  /** Camera framing when the zoom-in lands. Override per scene. */
  static cameraHome = { position: [0, 3.2, 10.5], target: [0, 1.3, 0] };

  /** Shown in the HUD so unfinished scenes are obvious. */
  static isPlaceholder = false;

  constructor({ location, data, start = null, renderer, services }) {
    this.location = location;
    this.data = data;
    this.start = start ?? nihilism.components; // the coefficient this scene begins at
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
    this.pickBlockers = []; // Object3Ds that hide components behind them from the pointer
    this.componentLabels = new Map(); // objectId → label button
    this.labelHovered = null;
    this.impacts = new Map(); // quote key → impact returned by nihilism.applyDelta
    this.hovered = null;
    this.interactive = false;
    this.completed = false;
    this.leaving = false;
    this.disposed = false;
    this.elapsed = 0;
    this.unbinders = [];

    const home = this.constructor.cameraHome;
    this.home = { position: new THREE.Vector3(...home.position), target: new THREE.Vector3(...home.target) };
    this.views = {}; // fitted named views (useViews)
    this.viewName = 'home';
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
  async prepareQuote(quote) {}
  onQuoteOpened(quote) {}
  onQuoteViewed(quote, impact) {}
  onQuoteClosed(quote, result) {}
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

  /** Named camera framings for a scene (see the header). Call from the constructor. */
  useViews(defs) {
    this.viewDefs = defs;
    this.fitHome(this.camera.aspect);
    this.limitOrbit(this.views.home);
  }

  #fitView(def, aspect) {
    const position = new THREE.Vector3(...def.position);
    const target = new THREE.Vector3(...def.target);
    const need = (def.needs ?? 30) * DEG;
    let fov = def.fov ?? 48;
    if (aspect < 1.2) fov = Math.min(80, Math.max(fov, (2 * Math.atan(Math.tan(need) / aspect)) / DEG));
    const have = Math.atan(Math.tan((fov * DEG) / 2) * aspect);
    const k = Math.min(1.7, Math.max(1, Math.tan(need) / Math.tan(have)));
    position.sub(target).multiplyScalar(k).add(target);
    return { position, target, fov };
  }

  /** Keeps the user's orbit close to a view: a little turn either way, a little up, in and out. */
  limitOrbit(view) {
    const s = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(view.position, view.target));
    Object.assign(this.controls, {
      minDistance: s.radius * 0.75,
      maxDistance: s.radius * 1.15,
      minAzimuthAngle: s.theta - 0.34,
      maxAzimuthAngle: s.theta + 0.34,
      minPolarAngle: Math.max(0.2, s.phi - 0.2),
      maxPolarAngle: Math.min(1.52, s.phi + 0.06),
    });
  }

  /** Glides the camera to a named view (does nothing if it is already there). */
  async flyTo(name, duration = 1.6) {
    const view = this.views[name];
    if (this.viewName === name && this.camera.position.distanceTo(view.position) < 0.05) return;
    this.viewName = name;
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const fromFov = this.camera.fov;
    const look = new THREE.Vector3();
    await tween({
      duration: REDUCED_MOTION ? 0.01 : duration,
      ease: Ease.inOutCubic,
      onUpdate: (e) => {
        if (this.leaving) return;
        this.camera.position.lerpVectors(fromPos, view.position, e);
        this.camera.fov = fromFov + (view.fov - fromFov) * e;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(look.lerpVectors(fromTarget, view.target, e));
      },
    });
    if (this.disposed || this.leaving) return;
    this.controls.target.copy(view.target);
    this.limitOrbit(view);
  }

  /** Widens the view and pulls the home framing back on narrow (portrait) screens so components stay in view. */
  fitHome(aspect) {
    if (this.viewDefs) {
      if (!this.viewsFitted) {
        this.viewsFitted = true;
        for (const [name, def] of Object.entries(this.viewDefs)) this.views[name] = this.#fitView(def, aspect);
      }
      const home = this.views.home;
      this.home.position.copy(home.position);
      this.home.target.copy(home.target);
      this.camera.fov = home.fov;
      this.camera.updateProjectionMatrix();
      return;
    }
    if (aspect >= 1.2) return;
    this.camera.fov = aspect < 0.8 ? 60 : 54;
    this.camera.updateProjectionMatrix();
    const k = Math.min(2.2, 1.25 / aspect);
    this.home.position.sub(this.home.target).multiplyScalar(k).add(this.home.target);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, this.home.position.distanceTo(this.home.target) * 1.3);
  }

  entryPosition(home) {
    return new THREE.Vector3(home.x * 0.4, home.y + 38, home.z + 26);
  }

  exitPosition(from) {
    return new THREE.Vector3(from.x * 0.4, from.y + 40, from.z + 22);
  }

  placeCameraForEntry() {
    this.fitHome(this.camera.aspect);
    this.camera.position.copy(this.entryPosition(this.home.position));
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
    this.leaving = true; // scene animations still running must not hand control back
    this.setInteractive(false);
    const from = this.camera.position.clone();
    const target = this.controls.target.clone();
    const to = this.exitPosition(from);
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
      objects: () => [...[...this.interactables.values()].filter((o) => o.visible), ...this.pickBlockers],
      onHover: (id) => {
        this.hovered = id;
        this.onHover(id);
        const object = id ? this.interactables.get(id) : null;
        // userData.lookPoint lets a large or far object (a stream, the moon) say where the Monster should look.
        this.monster?.lookAt(object ? object.userData.lookPoint ?? object.getWorldPosition(new THREE.Vector3()) : null);
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
    await this.prepareQuote(quote);
    if (this.disposed) return;
    this.onQuoteOpened(quote);
    const result = await this.services.quoteModal.open({
      quote,
      location: this.location,
      index: this.data.quotes.indexOf(quote),
      total: this.data.quotes.length,
      resolveImpact: () => this.#applyQuote(quote),
    });
    if (this.disposed) return;
    if (!this.completed && this.tracker.isComplete) this.complete();
    else this.setInteractive(true);
    this.onQuoteClosed(quote, result);
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
      label: `${this.location.name} · ${quote.label ?? quote.objectId}`,
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

  // ─── Component labels ───────────────────────────────────────────────────────

  /**
   * A label button pinned to a component and named by its quote's `label`. Clicking it
   * opens the component like clicking the object. Required components get a glass chip
   * with a pulsing dot; optional ones a smaller, dimmer label (.poi in main.css).
   */
  addComponentLabel(id, getPoint = null) {
    const object = this.interactables.get(id);
    const quote = this.tracker.quotesFor(id)[0];
    const required = this.tracker.objectState(id).required;
    const name = quote?.label ?? id;
    const node = el(
      'button',
      {
        className: `poi ${required ? 'is-required' : 'is-optional'} is-hidden`,
        attrs: { type: 'button', 'aria-label': required ? name : `${name} (optional)` },
        on: {
          click: () => this.openComponent(id),
          pointerenter: () => this.#setLabelHover(id),
          pointerleave: () => this.#setLabelHover(null),
          focus: () => this.#setLabelHover(id),
          blur: () => this.#setLabelHover(null),
        },
      },
      [el('span', { className: 'poi-dot' }), el('span', { className: 'poi-name', text: name })],
    );
    node.disabled = true;
    this.componentLabels.set(id, node);
    this.labels.add(id, node, getPoint ?? ((t) => object.getWorldPosition(t)), () => object.visible);
  }

  #setLabelHover(id) {
    this.labelHovered = id;
    const object = id ? this.interactables.get(id) : null;
    if (object) this.monster?.lookAt(object.userData.lookPoint ?? object.getWorldPosition(new THREE.Vector3()));
  }

  #updateComponentLabel(id, state, object) {
    const node = this.componentLabels.get(id);
    if (!node) return;
    const visible = this.interactive && state.active && object.visible;
    const hovered = state.hovered && state.active;
    const key = `${visible}${state.pending}${state.viewed}${hovered}`;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.classList.toggle('is-hidden', !visible);
    node.classList.toggle('is-pending', state.pending);
    node.classList.toggle('is-viewed', state.viewed);
    node.classList.toggle('is-hovered', hovered);
    node.disabled = !visible;
  }

  // ─── Frame / lifecycle ──────────────────────────────────────────────────────

  update(dt) {
    this.elapsed += dt;
    if (this.interactive) this.controls.update();
    this.monster?.update(dt);
    for (const [id, object] of this.interactables) {
      // A hovered label counts as hovering its object.
      const state = { ...this.tracker.objectState(id), hovered: id === this.hovered || id === this.labelHovered };
      this.styleInteractable(object, state, this.elapsed);
      this.#updateComponentLabel(id, state, object);
    }
    this.onUpdate(dt, this.elapsed);
    this.camera.updateMatrixWorld(); // labels follow this frame's camera, even mid-flight
    this.labels.update(this.camera);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.labelHovered = null;
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
