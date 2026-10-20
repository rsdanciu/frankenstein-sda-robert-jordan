import * as THREE from 'three';

// Pointer → 3D object picking shared by the globe and every scene.
// A "click" is a press + release that moved less than CLICK_TOLERANCE pixels, so
// dragging the camera never triggers a selection.
//
// Objects opt in with `userData.pickId`. Objects with `userData.blocksPick`
// (e.g. the globe) hide anything behind them.

const CLICK_TOLERANCE = 6;

export class Picker {
  constructor(canvas) {
    this.canvas = canvas;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(-10, -10);
    this.enabled = false;
    this.target = null; // { camera, objects(): Object3D[], onHover(id) → cursor, onClick(hit) }
    this.hovered = null;
    this.dirty = false;
    this.down = null;

    canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      this.#setNdc(e);
      this.dirty = e.pointerType === 'mouse';
    });
    canvas.addEventListener('pointerup', (e) => {
      const down = this.down;
      this.down = null;
      if (!down || !this.enabled || !this.target) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE) return;
      this.#setNdc(e);
      const hit = this.pick();
      if (hit) this.target.onClick?.(hit);
    });
    canvas.addEventListener('pointerleave', () => this.#setHovered(null));
  }

  setTarget(target) {
    this.#setHovered(null);
    this.target = target;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.#setHovered(null);
    else this.dirty = true;
  }

  pick() {
    if (!this.target) return null;
    this.raycaster.setFromCamera(this.ndc, this.target.camera);
    const hits = this.raycaster.intersectObjects(this.target.objects(), true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.pickId === undefined && !o.userData.blocksPick) o = o.parent;
      if (!o) continue;
      if (o.userData.blocksPick) return null;
      return { id: o.userData.pickId, object: o, point: h.point };
    }
    return null;
  }

  /** Hover is resolved once per frame at most. */
  update() {
    if (!this.dirty || !this.enabled) return;
    this.dirty = false;
    this.#setHovered(this.pick()?.id ?? null);
  }

  #setNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  #setHovered(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    const cursor = this.target?.onHover?.(id);
    this.canvas.style.cursor = id ? cursor ?? 'pointer' : '';
  }
}
