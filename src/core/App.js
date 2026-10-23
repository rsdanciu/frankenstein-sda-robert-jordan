import { createRenderer } from './renderer.js';
import { Picker } from './Picker.js';
import { tween, updateTweens } from './tween.js';
import { loadWorld, loadSceneData, loadBibliography } from './data.js';
import { JourneyProgress } from './progress.js';
import { DEV, DevPanel, DEV_SCENE } from './dev.js';
import { nihilism, bindGradePass, validateTimeline, expectedStartFor } from '../nihilism/nihilism.js';
import { GlobeView } from '../globe/GlobeView.js';
import { sceneClassFor } from '../scenes/registry.js';
import { StartMenu } from '../ui/StartMenu.js';
import { HUD } from '../ui/HUD.js';
import { QuoteModal } from '../ui/QuoteModal.js';
import { EndingMenu } from '../ui/EndingMenu.js';
import { InfoModal } from '../ui/InfoModal.js';
import { el, isPlaceholder } from '../ui/dom.js';

/**
 * The app's state machine and the transitions between views.
 *
 *   loading → start → (Begin) → globe ⇄ transition ⇄ scene → … → ending
 *
 * Entering a scene:  pan along the globe to the marker → dive (haze rises)
 *                    → build the scene behind the haze → descend into it (haze clears)
 * Leaving a scene:   rise out of it (haze rises) → emerge above the marker on the globe
 *                    → draw the journey arc → pan to the next marker
 */
export class App {
  constructor(root) {
    this.root = root;
    this.state = 'loading';
    this.view = null;
    this.scene = null;
    this.elapsed = 0;
  }

  async init() {
    this.ui = this.root.querySelector('#ui');
    const gfx = createRenderer(this.root);
    Object.assign(this, gfx);
    bindGradePass(this.gradePass.uniforms);
    this.picker = new Picker(this.renderer.domElement);

    this.world = await loadWorld();
    if (!isPlaceholder(this.world.meta.title)) document.title = this.world.meta.title;
    nihilism.reset(this.world.start);
    this.progress = new JourneyProgress(this.world.locations, { unlockAll: DEV });

    // Fetch every scene file up front (they are tiny) and check the whole timeline.
    Promise.allSettled(this.world.locations.map((l) => loadSceneData(l.id))).then((results) => {
      const byId = new Map();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') byId.set(this.world.locations[i].id, r.value);
        else console.error(`[scenes] ${r.reason}`);
      });
      validateTimeline(this.world, byId);
    });

    const markerLabels = el('div', { className: 'world-labels is-hidden' });
    const sceneLabels = el('div', { className: 'world-labels scene-labels' });
    this.ui.append(markerLabels, sceneLabels);

    this.globe = new GlobeView({ renderer: this.renderer, world: this.world, labelRoot: markerLabels });
    await this.globe.build();
    this.globe.onSelect = (id) => this.#onMarkerSelected(id);
    this.globe.refresh(this.progress);

    this.hud = new HUD(this.ui, { locations: this.world.locations, onProceed: () => this.#proceed() });
    this.quoteModal = new QuoteModal(this.ui);
    this.ending = new EndingMenu(this.ui, { world: this.world, loadBibliography, onRestart: () => this.#restart() });
    this.infoModal = new InfoModal(this.ui);
    this.startMenu = new StartMenu(this.ui, {
      meta: this.world.meta,
      dev: DEV,
      onStart: () => this.#begin(),
      onAbout: (opener) => this.infoModal.open(this.world.nihilismExplanation, opener),
    });
    this.services = {
      hud: this.hud,
      quoteModal: this.quoteModal,
      picker: this.picker,
      sceneLabelRoot: sceneLabels,
      onSceneComplete: (scene) => this.#onSceneComplete(scene),
    };
    if (DEV) {
      this.dev = new DevPanel(this.ui, {
        completeScene: () => (this.state === 'scene' && !this.scene.completed ? this.scene.devComplete() : this.hud.toast('No unfinished scene is open.')),
        exitScene: () => (this.state === 'scene' ? this.#proceed({ force: true }) : this.hud.toast('No scene is open.')),
        showEnding: () => (this.state === 'globe' || this.state === 'start' ? this.#showEnding() : this.hud.toast('Return to the globe first.')),
        restart: () => this.#restart(),
      });
      window.__app = this;
    }

    this.#setView(this.globe);
    window.addEventListener('resize', () => this.#resize());
    await this.renderer.compileAsync(this.globe.scene, this.globe.camera);

    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.#tick());
    document.getElementById('loader')?.remove();
    this.state = 'start';
    this.startMenu.show();
    if (DEV_SCENE) this.#devEnter(DEV_SCENE);
  }

  /** Dev mode: ?dev=1&scene=<id> skips the start menu and enters that location. */
  #devEnter(id) {
    const loc = this.world.locations.find((l) => l.id === id);
    if (!loc) {
      console.warn(`[dev] No location "${id}" in world.json.`);
      return;
    }
    this.startMenu.hide();
    this.hud.setMeterVisible(true);
    this.globe.idleSpin = false;
    this.#enterLocation(loc).catch((err) => this.#recover(err));
  }

  showFatal(err) {
    document.getElementById('loader')?.remove();
    const box = el('div', { className: 'fatal glass' }, [
      el('h2', { text: 'Something went wrong' }),
      el('p', { text: String(err?.message ?? err) }),
      el('p', { className: 'fatal-help', text: 'This experience needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari.' }),
    ]);
    (this.ui ?? document.body).append(box);
  }

  // ─── Frame loop ─────────────────────────────────────────────────────────────

  #tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1); // clamp after tab switches
    this.last = now;
    this.elapsed += dt;

    updateTweens(dt);
    nihilism.update(dt); // smooth value → applyNihilismVisuals()
    this.view.update(dt, this.elapsed);
    this.picker.update();
    this.hud.update();
    this.dev?.tick(dt);
    this.composer.render(dt);
  }

  #setView(view) {
    this.view = view;
    this.renderPass.scene = view.scene;
    this.renderPass.camera = view.camera;
    this.picker.setTarget(view.pickTarget);
  }

  #resize() {
    this.resize();
    const aspect = window.innerWidth / window.innerHeight;
    this.globe.resize(aspect);
    this.scene?.resize(aspect);
  }

  #haze(to, duration, delay = 0) {
    const u = this.gradePass.uniforms.uHaze;
    let from = null;
    return tween({
      duration,
      delay,
      onUpdate: (e) => {
        from ??= u.value;
        u.value = from + (to - from) * e;
      },
    });
  }

  // ─── Globe ──────────────────────────────────────────────────────────────────

  async #begin() {
    if (this.state !== 'start') return;
    this.state = 'transition';
    this.startMenu.hide();
    this.hud.setMeterVisible(true);
    this.globe.idleSpin = false;
    this.globe.labels.setVisible(true);
    this.hud.showGlobe(this.progress);
    await this.globe.flyTo(this.progress.nextLocation, { duration: 2.6 });
    this.#enterGlobeIdle();
  }

  #enterGlobeIdle() {
    this.state = 'globe';
    this.globe.refresh(this.progress);
    this.globe.setInteractive(true);
    this.picker.setEnabled(true);
    this.hud.showGlobe(this.progress);
  }

  #onMarkerSelected(id) {
    if (this.state !== 'globe') return;
    const loc = this.world.locations.find((l) => l.id === id);
    if (!this.progress.canEnter(id)) {
      const next = this.progress.nextLocation;
      this.hud.toast(this.progress.isCompleted(id) ? `${loc.name} is already complete.` : `Visit ${next.name} first.`);
      return;
    }
    this.#enterLocation(loc).catch((err) => this.#recover(err));
  }

  // ─── Transitions ────────────────────────────────────────────────────────────

  async #enterLocation(loc) {
    this.state = 'transition';
    this.globe.setInteractive(false);
    this.picker.setEnabled(false);
    this.hud.setHint(null);
    this.hud.hideInfo();

    const dataPromise = loadSceneData(loc.id).catch((err) => {
      console.error(err);
      return { id: loc.id, quotes: [], loadError: String(err) };
    });

    // Zoom out / pan to the location, then zoom in.
    await this.globe.flyTo(loc);
    await Promise.all([this.globe.dive(loc, 1.5), this.#haze(1, 0.75, 0.75)]);

    // Build the scene while the haze hides the switch.
    const data = await dataPromise;
    const SceneClass = sceneClassFor(loc.id);
    const start = expectedStartFor(this.world, loc.index);
    const scene = new SceneClass({ location: loc, data, start, renderer: this.renderer, services: this.services });
    await scene.build();
    nihilism.set(start); // no-op in normal order; matters in dev mode
    this.globe.labels.setVisible(false);
    scene.placeCameraForEntry();
    this.scene = scene;
    this.#setView(scene);
    await this.renderer.compileAsync(scene.scene, scene.camera);

    this.hud.showScene(scene);
    await Promise.all([scene.playEntry(2.2), this.#haze(0, 1.1)]);
    this.state = 'scene';
    scene.setInteractive(true);
    if (scene.tracker.isComplete) scene.complete(); // a scene with no required components
  }

  #onSceneComplete(scene) {
    this.progress.complete(scene.location.id);
    this.hud.updateScene(scene);
    this.hud.setProceedVisible(true);
  }

  async #proceed({ force = false } = {}) {
    if (this.state !== 'scene' || this.quoteModal.isOpen) return;
    if (!force && !this.scene?.completed) return;
    this.state = 'transition';
    this.hud.setProceedVisible(false);
    const scene = this.scene;
    const loc = scene.location;
    if (scene.completed) nihilism.set(loc.nihilism); // the global value always leaves a scene at its end value

    try {
      await Promise.all([scene.playExit(1.5), this.#haze(1, 0.8, 0.6)]);
      this.hud.hideInfo();
      this.globe.placeForEmerge(loc);
      this.globe.labels.setVisible(true);
      this.#setView(this.globe);
      scene.dispose();
      this.scene = null;
      this.globe.refresh(this.progress);
      // Arc `loc.index` joins this location to the next one; it is drawn once we are back out.
      if (scene.completed) this.globe.arcs.hide(loc.index);
      await Promise.all([this.globe.emerge(loc, 1.8), this.#haze(0, 1.0)]);
      if (scene.completed) await this.globe.arcs.draw(loc.index);

      if (this.progress.isFinished) return this.#showEnding();
      await this.globe.flyTo(this.progress.nextLocation);
      this.#enterGlobeIdle();
    } catch (err) {
      this.#recover(err);
    }
  }

  async #showEnding() {
    if (this.state === 'start') this.startMenu.hide(); // dev shortcut from the start screen
    this.state = 'ending';
    this.globe.setInteractive(false);
    this.picker.setEnabled(false);
    this.hud.setHint(null);
    this.hud.hideInfo();
    this.globe.labels.setVisible(false);
    await this.globe.flyToOverview();
    this.globe.idleSpin = true;
    this.ending.show(nihilism.history);
  }

  /** Back to the start page for a fresh journey: a reload (keeping ?dev=1, but not a dev ?scene= jump). */
  #restart() {
    const url = new URL(window.location.href);
    url.searchParams.delete('scene');
    if (url.href === window.location.href) window.location.reload();
    else window.location.assign(url.href);
  }

  /** If a transition throws, fall back to a usable globe rather than a frozen screen. */
  #recover(err) {
    console.error('[App] Transition failed:', err);
    this.gradePass.uniforms.uHaze.value = 0;
    this.scene?.dispose();
    this.scene = null;
    this.#setView(this.globe);
    this.globe.labels.setVisible(true);
    this.globe.camera.fov = 38;
    this.globe.camera.updateProjectionMatrix();
    this.hud.toast('Something went wrong. Check the console.');
    this.#enterGlobeIdle();
  }
}
