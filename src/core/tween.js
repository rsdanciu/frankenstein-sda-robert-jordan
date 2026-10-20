// Minimal promise-based tweening driven by the main loop's delta time, so animations
// pause with the tab and stay in step with rendering. No external animation library.

export const Ease = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
};

const active = new Set();

/**
 * Runs onUpdate(easedProgress, rawProgress) every frame for `duration` seconds.
 * Resolves when finished.
 */
export function tween({ duration = 1, delay = 0, ease = Ease.inOutCubic, onUpdate } = {}) {
  return new Promise((resolve) => {
    active.add({ elapsed: -delay, duration: Math.max(duration, 1e-4), ease, onUpdate, resolve });
  });
}

export function wait(seconds) {
  return tween({ duration: seconds });
}

export function updateTweens(dt) {
  for (const tw of active) {
    tw.elapsed += dt;
    if (tw.elapsed < 0) continue;
    const p = Math.min(tw.elapsed / tw.duration, 1);
    tw.onUpdate?.(tw.ease(p), p);
    if (p >= 1) {
      active.delete(tw);
      tw.resolve();
    }
  }
}
