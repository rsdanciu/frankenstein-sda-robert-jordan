import * as THREE from 'three';

/**
 * A true reflection in a horizontal water surface (a puddle, a still pool). Each frame the
 * scene is drawn from the camera mirrored in the plane y = level into a render target;
 * the water shader samples it with projective coordinates (`textureMatrix`).
 * (The same method as three's Reflector, with an oblique clip plane so nothing below the
 * water shows, but drawing only objects on `layer`, which keeps the extra pass cheap.)
 *
 *   const mirror = new PlanarReflection({ level, layer })
 *   object.layers.enable(layer)                 for everything the water should show
 *   mirror.update(renderer, scene, camera)      per frame, before the main render
 *   mirror.texture, mirror.textureMatrix        uniforms for the water shader
 */
export class PlanarReflection {
  constructor({ level = 0, layer = 1, scale = 0.5, clipBias = 0.002 } = {}) {
    this.level = level;
    this.layer = layer;
    this.scale = scale;
    this.clipBias = clipBias;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(layer);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.textureMatrix = new THREE.Matrix4();
    this._size = new THREE.Vector2();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  get texture() {
    return this.target.texture;
  }

  update(renderer, scene, camera) {
    camera.updateMatrixWorld();
    const level = this.level;
    const pos = this._pos.setFromMatrixPosition(camera.matrixWorld);
    if (pos.y <= level) return;

    // Mirror the camera: position, a point it looks at, and its up vector.
    const look = this._look.set(0, 0, -1).transformDirection(camera.matrixWorld).add(pos);
    const up = this._up.set(0, 1, 0).transformDirection(camera.matrixWorld);
    const C = this.camera;
    C.position.set(pos.x, 2 * level - pos.y, pos.z);
    C.up.set(up.x, -up.y, up.z);
    C.lookAt(look.x, 2 * level - look.y, look.z);
    C.far = camera.far;
    C.updateMatrixWorld();
    C.projectionMatrix.copy(camera.projectionMatrix);

    // Texture matrix: world → the reflection texture's UVs.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(C.projectionMatrix).multiply(C.matrixWorldInverse);

    // Oblique near plane at the water surface (Lengyel), so only what is above it is drawn.
    const plane = this._plane.setFromNormalAndCoplanarPoint(this._up.set(0, 1, 0), this._look.set(0, level, 0));
    plane.applyMatrix4(C.matrixWorldInverse);
    const clip = this._clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = C.projectionMatrix.elements;
    const q = this._q.set((Math.sign(clip.x) + P[8]) / P[0], (Math.sign(clip.y) + P[9]) / P[5], -1, (1 + P[10]) / P[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    P[2] = clip.x;
    P[6] = clip.y;
    P[10] = clip.z + 1 - this.clipBias;
    P[14] = clip.w;

    renderer.getDrawingBufferSize(this._size);
    const w = Math.max(64, Math.round(this._size.x * this.scale));
    const h = Math.max(64, Math.round(this._size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    const previousTarget = renderer.getRenderTarget();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, C);
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.autoUpdate = shadowAuto;
  }

  dispose() {
    this.target.dispose();
  }
}
