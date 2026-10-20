import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';
import { el } from '../ui/dom.js';

/**
 * Generic stand-in used by every location until its dedicated scene is designed.
 * It reads the scene JSON and builds one pedestal + floating crystal per quote
 * objectId, arranged in an arc in front of the Monster, each labelled with its
 * objectId, step and required/optional flag so the JSON can be checked visually.
 * It deliberately depicts nothing about the location itself.
 */

const PEDESTAL_GEO = new THREE.CylinderGeometry(0.42, 0.52, 0.9, 8);
const CRYSTAL_GEO = new THREE.OctahedronGeometry(0.3, 0);
const RING_GEO = new THREE.TorusGeometry(0.5, 0.018, 8, 48);
const HIT_GEO = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 12);

const COLORS = {
  pending: new THREE.Color('#ffc861'),
  viewed: new THREE.Color('#8fd0ff'),
  locked: new THREE.Color('#2a2d33'),
};

export class PlaceholderScene extends BaseScene {
  static isPlaceholder = true;
  static cameraHome = { position: [0, 3.4, 10.5], target: [0, 1.3, -0.6] };

  buildBackground() {
    // Gently rolling ground; flat inside the play area.
    const geo = new THREE.RingGeometry(0.01, 90, 120, 48); // concentric rings so the hills can bend
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const lift = THREE.MathUtils.smoothstep(r, 12, 40);
      pos.setY(i, lift * (Math.sin(x * 0.11) * Math.cos(z * 0.09) * 2.2 + Math.sin((x + z) * 0.05) * 1.6));
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#6c7066', roughness: 1 }));
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildForeground() {
    // Slow-drifting dust motes give the air some depth.
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([(Math.random() - 0.5) * 36, Math.random() * 9, (Math.random() - 0.5) * 36], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: '#ffffff', map: dotTexture(), size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.scene.add(this.dust);
  }

  buildInteractables() {
    const ids = this.tracker.objectIds;
    const n = ids.length;
    ids.forEach((id, i) => {
      // An arc behind the Monster, widening with the number of components.
      const spread = Math.min(1.25, 0.45 + n * 0.18);
      const angle = n === 1 ? 0 : THREE.MathUtils.lerp(-spread, spread, i / (n - 1));
      const component = createComponent();
      component.position.set(Math.sin(angle) * 5.2, 0, -Math.cos(angle) * 2.4 + 0.3);
      this.scene.add(component);
      this.registerInteractable(id, component);

      const meta = el('span', { className: 'scene-label-meta' });
      const node = el('div', { className: 'scene-label' }, [el('span', { className: 'scene-label-id', text: id }), meta]);
      component.userData.labelMeta = meta;
      this.labels.add(id, node, (t) => component.getWorldPosition(t).setY(2.35));
    });
  }

  placeMonster(monster) {
    // Front-left, in the gap between components, so he never hides one from the camera.
    monster.object.position.set(-2.1, 0, 2.0);
    monster.object.rotation.y = 0.25;
  }

  styleInteractable(object, state, t) {
    const { crystal, ring, pedestalMat, labelMeta } = object.userData;
    const mat = crystal.material;
    const target = state.pending ? COLORS.pending : state.viewed ? COLORS.viewed : COLORS.locked;
    mat.emissive.lerp(target, 0.15);
    mat.emissiveIntensity = state.pending ? 0.9 + Math.sin(t * 3) * 0.35 : state.active ? 0.45 : 0.05;
    mat.color.set(state.active ? '#e6ebf5' : '#5b606a');
    pedestalMat.color.set(state.active ? '#8d929b' : '#5d6168');

    crystal.position.y = 1.6 + Math.sin(t * 1.4 + object.id) * 0.08;
    crystal.rotation.y += state.active ? 0.012 : 0.003;
    ring.visible = state.pending;
    ring.rotation.z = t * 0.6;
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
    object.scale.setScalar(THREE.MathUtils.lerp(object.scale.x, state.hovered && state.active ? 1.08 : 1, 0.2));

    const id = object.userData.pickId;
    const quote = this.tracker.quotesFor(id)[0];
    const text = `step ${quote.step} · ${quote.required ? 'required' : 'optional'} · ${
      state.viewed ? 'viewed' : state.active ? 'active' : 'locked'
    }`;
    if (labelMeta.textContent !== text) labelMeta.textContent = text;
  }

  onUpdate(dt, t) {
    if (this.dust) this.dust.rotation.y += dt * 0.01;
    if (!this.hovered) this.monster.lookAt(this.camera.position);
  }
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createComponent() {
  const group = new THREE.Group();
  const pedestalMat = new THREE.MeshStandardMaterial({ color: '#8d929b', roughness: 0.9, flatShading: true });
  const pedestal = new THREE.Mesh(PEDESTAL_GEO, pedestalMat);
  pedestal.position.y = 0.45;
  pedestal.castShadow = pedestal.receiveShadow = true;

  const crystal = new THREE.Mesh(
    CRYSTAL_GEO,
    new THREE.MeshStandardMaterial({ color: '#e6ebf5', emissive: '#ffc861', emissiveIntensity: 0.8, roughness: 0.25, flatShading: true }),
  );
  crystal.position.y = 1.6;
  crystal.castShadow = true;

  const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.85 }));
  ring.position.y = 1.6;
  ring.rotation.x = Math.PI / 2;

  const hit = new THREE.Mesh(HIT_GEO, new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 1.2;

  group.add(pedestal, crystal, ring, hit);
  Object.assign(group.userData, { crystal, ring, pedestalMat });
  return group;
}
