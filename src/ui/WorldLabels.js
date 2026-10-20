import * as THREE from 'three';

// DOM labels pinned to points in a 3D scene (marker names, placeholder object ids).
// DOM text stays crisp at any zoom and inherits the glass styling from CSS.

const _p = new THREE.Vector3();

export class WorldLabels {
  constructor(root) {
    this.root = root;
    this.items = new Map();
  }

  /**
   * @param id        unique key
   * @param node      the element to position (its top-left is placed on the point)
   * @param getPoint  (target: Vector3) => Vector3 world position
   * @param isVisible optional (camera) => boolean, e.g. "is this side of the globe facing me?"
   */
  add(id, node, getPoint, isVisible = null) {
    node.classList.add('world-label');
    this.root.append(node);
    this.items.set(id, { node, getPoint, isVisible, shown: null });
  }

  get(id) {
    return this.items.get(id)?.node;
  }

  update(camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const item of this.items.values()) {
      item.getPoint(_p);
      _p.project(camera);
      const show = _p.z < 1 && Math.abs(_p.x) < 1.2 && Math.abs(_p.y) < 1.2 && (!item.isVisible || item.isVisible(camera));
      if (show !== item.shown) {
        item.node.classList.toggle('is-offscreen', !show);
        item.shown = show;
      }
      if (show) {
        const x = (_p.x * 0.5 + 0.5) * w;
        const y = (-_p.y * 0.5 + 0.5) * h;
        item.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  }

  setVisible(visible) {
    this.root.classList.toggle('is-hidden', !visible);
  }

  clear() {
    for (const { node } of this.items.values()) node.remove();
    this.items.clear();
  }
}
