import * as THREE from 'three';
import { latLonToVector3 } from './geo.js';
import { el } from '../ui/dom.js';

// Location markers on the globe: a glowing pin, a ring on the surface and a DOM label.
//
// States
//   next       the one location the user may enter now (gold, pulsing, name always shown)
//   completed  already visited (pale blue, number only; name on hover)
//   locked     later in the journey (grey, number only; name on hover)
//   available  dev mode: any location can be entered

export const MARKER_STYLE = {
  next: { color: '#ffc861', scale: 1.25 },
  completed: { color: '#8fd0ff', scale: 0.95 },
  locked: { color: '#7f8796', scale: 0.85 },
  available: { color: '#e9edf5', scale: 1.05 },
};

const SURFACE = 1.0015;
const STEM_HEIGHT = 0.034;
const UP = new THREE.Vector3(0, 1, 0);

const RING_GEO = new THREE.RingGeometry(0.0095, 0.0125, 48);
const DISC_GEO = new THREE.CircleGeometry(0.0095, 48);
const STEM_GEO = new THREE.CylinderGeometry(0.0011, 0.0011, STEM_HEIGHT, 6);
const HEAD_GEO = new THREE.SphereGeometry(0.0052, 16, 12);
const HIT_GEO = new THREE.SphereGeometry(0.03, 8, 6);

const _cam = new THREE.Vector3();
const _p = new THREE.Vector3();

export class MarkerLayer {
  constructor(locations, labels) {
    this.group = new THREE.Group();
    this.items = new Map();
    this.hovered = null;
    this.onSelect = null;
    this.labels = labels;
    const glow = makeGlowTexture();

    for (const loc of locations) {
      const normal = latLonToVector3(loc.display.lat, loc.display.lon, 1).normalize();
      const root = new THREE.Group();
      root.position.copy(normal).multiplyScalar(SURFACE);
      root.quaternion.setFromUnitVectors(UP, normal);
      root.renderOrder = 10;

      const color = new THREE.Color();
      const basic = (opacity) =>
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });

      const disc = new THREE.Mesh(DISC_GEO, basic(0.25));
      const ring = new THREE.Mesh(RING_GEO, basic(0.9));
      const ripple = new THREE.Mesh(RING_GEO, basic(0));
      for (const m of [disc, ring, ripple]) m.rotation.x = -Math.PI / 2;
      const stem = new THREE.Mesh(STEM_GEO, basic(0.85));
      stem.position.y = STEM_HEIGHT / 2;
      const head = new THREE.Mesh(HEAD_GEO, basic(1));
      head.position.y = STEM_HEIGHT;
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      halo.position.y = STEM_HEIGHT;
      const hit = new THREE.Mesh(HIT_GEO, new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = STEM_HEIGHT * 0.6;
      hit.userData.pickId = loc.id;

      for (const m of [disc, ring, ripple, stem, head, halo]) m.renderOrder = 10;
      root.add(disc, ring, ripple, stem, head, halo, hit);
      this.group.add(root);

      const label = el('button', { className: `marker-label side-${loc.display.labelSide}`, attrs: { type: 'button', 'aria-label': `${loc.order}. ${loc.name}` } }, [
        el('span', { className: 'marker-num', text: loc.order }),
        el('span', { className: 'marker-name', text: loc.name }),
      ]);
      // Locked labels still report the click so the app can explain why it is locked.
      label.addEventListener('click', () => this.onSelect?.(loc.id));
      label.addEventListener('pointerenter', () => this.setHovered(loc.id));
      label.addEventListener('pointerleave', () => this.setHovered(null));
      labels.add(
        loc.id,
        label,
        (t) => head.getWorldPosition(t),
        (camera) => normal.dot(_cam.copy(camera.position).sub(head.getWorldPosition(_p)).normalize()) > 0.08,
      );

      this.items.set(loc.id, { loc, normal, root, color, ring, disc, ripple, halo, hit, label, state: 'locked', clickable: false });
    }
  }

  get hitAreas() {
    return [...this.items.values()].map((i) => i.hit);
  }

  /** stateOf(location) → { state, clickable } */
  setStates(stateOf) {
    for (const item of this.items.values()) {
      const { state, clickable } = stateOf(item.loc);
      item.state = state;
      item.clickable = clickable;
      item.color.set(MARKER_STYLE[state].color);
      for (const s of Object.keys(MARKER_STYLE)) item.label.classList.toggle(`state-${s}`, s === state);
      item.label.classList.toggle('is-clickable', clickable);
      item.label.setAttribute('aria-disabled', String(!clickable));
    }
    this.#refreshHover();
  }

  isClickable(id) {
    return this.items.get(id)?.clickable ?? false;
  }

  setHovered(id) {
    this.hovered = id;
    this.#refreshHover();
  }

  #refreshHover() {
    for (const [id, item] of this.items) item.label.classList.toggle('is-hovered', id === this.hovered);
  }

  update(camera, elapsed) {
    // Keep markers a similar size on screen at every zoom level.
    const k = THREE.MathUtils.clamp((camera.position.length() - 1) / 1.05, 0.3, 1.4);
    for (const [id, item] of this.items) {
      const style = MARKER_STYLE[item.state];
      const hover = id === this.hovered ? 1.2 : 1;
      item.root.scale.setScalar(k * style.scale * hover);

      const pulse = item.state === 'next' ? (elapsed * 0.7) % 1 : 0;
      item.ripple.visible = item.state === 'next';
      item.ripple.scale.setScalar(1 + pulse * 1.8);
      item.ripple.material.opacity = (1 - pulse) * 0.8;
      const breathe = item.state === 'next' ? 0.065 + Math.sin(elapsed * 3) * 0.012 : 0.04;
      item.halo.scale.setScalar(breathe);
      item.halo.material.opacity = item.state === 'locked' ? 0.35 : 0.9;
    }
  }
}

function makeGlowTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
