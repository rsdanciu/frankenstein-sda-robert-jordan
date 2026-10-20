/**
 * =============================================================================
 *  NIHILISM COEFFICIENT
 * =============================================================================
 *  Every piece of Nihilism Coefficient handling lives in this one file.
 *
 *  1. STATE ─ `nihilism` (also exposed as the global `window.NIHILISM`) holds the
 *     live value for the entire timeline. It tracks three components, each kept
 *     inside [0, 1]:
 *          truth · unity · purpose
 *     The Nihilism Coefficient itself is their average.
 *
 *  2. CHANGES ─ quotes carry signed deltas `{ "truth": x, "unity": x, "purpose": x }`.
 *     A quote may change only one component (missing keys count as 0). After a
 *     delta is added every component is clamped back into [0, 1], so no quote can
 *     push a value past either boundary.
 *
 *  3. TIMELINE ─ world.json `start` is the value at the very beginning. A scene
 *     starts at the previous scene's end value (scene 1 starts at `start`). When a
 *     scene is complete the global value is set to that scene's world.json end
 *     value. If the quotes the user viewed did not land on that end value, a
 *     warning is logged (see checkSceneEnd and validateTimeline).
 *
 *  4. VISUALS ─ applyNihilismVisuals(coefficient) is the single function that
 *     turns the coefficient into on-screen parameters. It runs every frame with a
 *     smoothed copy of the value so the world drifts instead of snapping.
 *
 *     Parameter        What it drives                            Where
 *     ──────────────   ───────────────────────────────────────   ───────────────────────────
 *     saturation       colour saturation of the whole frame      post-processing grade pass
 *     vignette         darkening at the screen edges             post-processing grade pass
 *     lightIntensity   multiplier on every bound light           globe sun + scene lights
 *     fogDensity       FogExp2 density (scene units)             scene fog; globe × globeFogScale
 *     skyTop           colour at the top of the sky dome         scene sky shader
 *     skyHorizon       colour at the horizon; also fog colour    scene sky + fog, globe atmosphere,
 *                      and the transition haze                   transition haze
 *     space            background behind the globe               globe background + globe fog
 *
 *  TUNING ─ edit NIHILISM_VISUALS below. Each parameter has two endpoints:
 *          atZero → value used when the coefficient is 0
 *          atOne  → value used when the coefficient is 1
 *  Values in between are interpolated linearly (after the optional `curve`).
 *  Swap atZero / atOne on any line to invert that parameter.
 *
 *  OPEN DESIGN DECISION ─ the default endpoints read a HIGH coefficient (high
 *  truth / unity / purpose) as a vivid, bright, clear world and a LOW coefficient
 *  as a grey, dim, foggy one. Swap the endpoints if the project wants the
 *  opposite reading.
 * =============================================================================
 */

import * as THREE from 'three';

export const COMPONENTS = ['truth', 'unity', 'purpose'];

// ─── Tuning ──────────────────────────────────────────────────────────────────

export const NIHILISM_VISUALS = {
  // Shapes how the coefficient is read before mapping. Linear by default.
  // Example: (c) => c * c makes the world stay bleak until the value is high.
  curve: (c) => c,

  // How fast the visuals chase the real value, per second. Higher = snappier.
  smoothing: 1.8,

  saturation:     { atZero: 0.15, atOne: 1.1 },   // 0 = greyscale, 1 = unchanged
  vignette:       { atZero: 0.6, atOne: 0.18 },   // 0 = none, 1 = heavy
  lightIntensity: { atZero: 0.35, atOne: 1.0 },   // × each light's base intensity
  fogDensity:     { atZero: 0.05, atOne: 0.006 }, // FogExp2 density in scene units (metres)
  skyTop:         { atZero: '#202329', atOne: '#3f7fd0' },
  skyHorizon:     { atZero: '#5d6168', atOne: '#bcd6ee' },
  space:          { atZero: '#020203', atOne: '#060b1c' },

  // The globe is 1 unit in radius, so its fog needs a much larger density to read.
  globeFogScale: 12,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function averageOf(c) {
  return (c.truth + c.unity + c.purpose) / 3;
}

/** "T 0.50 · U 0.50 · P 0.50 → 0.50" — used in console logs. */
export function formatComponents(c) {
  const f = (v) => v.toFixed(2);
  return `T ${f(c.truth)} · U ${f(c.unity)} · P ${f(c.purpose)} → ${f(averageOf(c))}`;
}

export function componentsMatch(a, b, epsilon = 1e-4) {
  return COMPONENTS.every((k) => Math.abs(a[k] - b[k]) <= epsilon);
}

/**
 * Reads an absolute { truth, unity, purpose } block from JSON (world.json start and
 * scene end values). Out-of-range numbers are clamped and reported; missing or
 * non-numeric values fall back to `fallback` and are reported.
 */
export function readComponents(raw, fallback, context) {
  const out = {};
  for (const k of COMPONENTS) {
    const v = raw?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      console.warn(`[Nihilism] ${context}: "${k}" is missing or not a number; using ${fallback[k]}.`);
      out[k] = fallback[k];
    } else {
      if (v < 0 || v > 1) console.warn(`[Nihilism] ${context}: "${k}" = ${v} is outside 0–1; clamped.`);
      out[k] = clamp01(v);
    }
  }
  return out;
}

/** Reads a quote's signed delta. Missing keys are 0 (a quote may touch one component). */
export function readDelta(raw, context) {
  const out = {};
  for (const k of COMPONENTS) {
    const v = raw?.[k];
    if (v === undefined || v === null) out[k] = 0;
    else if (typeof v !== 'number' || !Number.isFinite(v)) {
      console.warn(`[Nihilism] ${context}: delta "${k}" is not a number; treated as 0.`);
      out[k] = 0;
    } else out[k] = v;
  }
  return out;
}

// ─── Global state ────────────────────────────────────────────────────────────

class NihilismCoefficient {
  truth = 0.5;
  unity = 0.5;
  purpose = 0.5;

  /** Smoothed copy that the visuals and HUD follow. */
  displayed = { truth: 0.5, unity: 0.5, purpose: 0.5 };

  /** Every recorded change across the journey; read by the ending overview. */
  history = [];

  #listeners = new Set();

  /** The Nihilism Coefficient: the average of the three components. */
  get value() {
    return averageOf(this);
  }

  get displayedValue() {
    return averageOf(this.displayed);
  }

  get components() {
    return { truth: this.truth, unity: this.unity, purpose: this.purpose };
  }

  /** Called once with world.json `start`. Clears the history. */
  reset(start) {
    this.history = [];
    this.set(start, { immediate: true, record: { kind: 'start', label: 'Start' } });
  }

  /**
   * Hard-sets the components (scene end values, scene entry, dev sliders).
   * `immediate` also jumps the smoothed visuals; `record` adds a history entry.
   */
  set(values, { immediate = false, record = null } = {}) {
    for (const k of COMPONENTS) {
      if (typeof values?.[k] === 'number' && Number.isFinite(values[k])) this[k] = clamp01(values[k]);
    }
    if (immediate) Object.assign(this.displayed, this.components);
    if (record) this.#record(record);
    this.#notify();
  }

  /**
   * Adds a quote's signed delta, clamping each component into [0, 1].
   * Returns the before/after values so the quote menu can show the impact.
   */
  applyDelta(delta, record = null) {
    const before = this.components;
    const clamped = [];
    for (const k of COMPONENTS) {
      const raw = this[k] + (delta?.[k] ?? 0);
      this[k] = clamp01(raw);
      if (Math.abs(raw - this[k]) > 1e-9) clamped.push(k);
    }
    const after = this.components;
    if (clamped.length) {
      console.info(`[Nihilism] ${record?.label ?? 'Change'}: ${clamped.join(', ')} hit the 0–1 boundary and was clamped.`);
    }
    if (record) this.#record(record);
    this.#notify();
    return { before, after, delta: { ...delta }, clamped };
  }

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Per-frame: ease the displayed values toward the real ones, then drive the visuals. */
  update(dt) {
    const t = 1 - Math.exp(-dt * NIHILISM_VISUALS.smoothing);
    for (const k of COMPONENTS) {
      this.displayed[k] += (this[k] - this.displayed[k]) * t;
    }
    applyNihilismVisuals(this.displayedValue);
  }

  #record({ kind, label, sceneId = null }) {
    this.history.push({ kind, label, sceneId, ...this.components, value: this.value });
  }

  #notify() {
    for (const fn of this.#listeners) fn(this);
  }
}

/** THE global Nihilism Coefficient for the whole timeline. */
export const nihilism = new NihilismCoefficient();
if (typeof window !== 'undefined') window.NIHILISM = nihilism;

// ─── Visual mapping ──────────────────────────────────────────────────────────

/**
 * Three.js objects the coefficient drives. Views register them with
 * bindNihilismTargets() and the returned function removes them again.
 *
 *   lights: [{ target, key = 'intensity', base }]
 *           target[key] = base × lightIntensity. `target` can be a THREE.Light or a
 *           shader uniform ({ value }), with key 'value'.
 *   fogs:   [{ fog: THREE.FogExp2, scale = 1, colorFrom = 'skyHorizon' }]
 *           fog.density = fogDensity × scale; fog.color follows `colorFrom`
 *           (colorFrom: null leaves the colour to the scene, e.g. a day/night sky).
 *   colors: [{ color: THREE.Color, from: 'skyTop' | 'skyHorizon' | 'space' }]
 *           Copies the mapped colour every frame (sky uniforms, backgrounds, …).
 */
const bindings = new Set();
let gradeUniforms = null;

export function bindNihilismTargets(binding) {
  bindings.add(binding);
  return () => bindings.delete(binding);
}

/** The post-processing pass that owns saturation, vignette and the transition haze. */
export function bindGradePass(uniforms) {
  gradeUniforms = uniforms;
}

const WHITE = new THREE.Color(1, 1, 1);
const COLOR_KEYS = ['skyTop', 'skyHorizon', 'space'];
const colorEndpoints = Object.fromEntries(
  COLOR_KEYS.map((k) => [k, { atZero: new THREE.Color(NIHILISM_VISUALS[k].atZero), atOne: new THREE.Color(NIHILISM_VISUALS[k].atOne) }]),
);

/** The values computed on the last call, for anything that wants to read them. */
export const visualParams = {
  coefficient: 0.5,
  saturation: 1,
  vignette: 0,
  lightIntensity: 1,
  fogDensity: 0,
  skyTop: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  space: new THREE.Color(),
};

/**
 * THE mapping function: coefficient (0–1) → every visual parameter.
 * Called every frame by nihilism.update() with the smoothed coefficient.
 */
export function applyNihilismVisuals(coefficient) {
  const V = NIHILISM_VISUALS;
  const c = clamp01(V.curve(clamp01(coefficient)));
  const p = visualParams;
  p.coefficient = c;

  // Scalars: straight interpolation between the two endpoints.
  p.saturation = lerp(V.saturation.atZero, V.saturation.atOne, c);
  p.vignette = lerp(V.vignette.atZero, V.vignette.atOne, c);
  p.lightIntensity = lerp(V.lightIntensity.atZero, V.lightIntensity.atOne, c);
  p.fogDensity = lerp(V.fogDensity.atZero, V.fogDensity.atOne, c);

  // Colours: interpolated in linear colour space.
  for (const k of COLOR_KEYS) p[k].lerpColors(colorEndpoints[k].atZero, colorEndpoints[k].atOne, c);

  // 1. Colour saturation + vignette → post-processing grade pass (whole frame).
  //    The transition haze takes the horizon colour so dives match the mood.
  if (gradeUniforms) {
    gradeUniforms.uSaturation.value = p.saturation;
    gradeUniforms.uVignette.value = p.vignette;
    gradeUniforms.uHazeColor.value.copy(p.skyHorizon).lerp(WHITE, 0.35);
  }

  for (const b of bindings) {
    // 2. Light intensity → every bound light / light uniform.
    if (b.lights) for (const l of b.lights) l.target[l.key ?? 'intensity'] = l.base * p.lightIntensity;
    // 3. Fog density (and fog colour).
    if (b.fogs) {
      for (const f of b.fogs) {
        f.fog.density = p.fogDensity * (f.scale ?? 1);
        if (f.colorFrom !== null) f.fog.color.copy(p[f.colorFrom ?? 'skyHorizon']);
      }
    }
    // 4. Sky colour (sky domes, backgrounds, atmosphere tint).
    if (b.colors) for (const col of b.colors) col.color.copy(p[col.from]);
  }
  return p;
}


// ─── Validation / logging ────────────────────────────────────────────────────

/** Applies quote deltas in order with the same clamping the live state uses. */
export function simulateQuotes(start, quotes) {
  const s = { ...start };
  for (const q of quotes) for (const k of COMPONENTS) s[k] = clamp01(s[k] + (q.nihilism?.[k] ?? 0));
  return s;
}

/** Where a scene's coefficient should begin: the previous scene's end value. */
export function expectedStartFor(world, index) {
  return index <= 0 ? world.start : world.locations[index - 1].nihilism;
}

const byStepThenOrder = (a, b) => a.step - b.step || a.order - b.order;

/**
 * Startup check across the whole journey: does each scene's set of REQUIRED quotes
 * (applied in step → order sequence) carry the value from the scene's start to its
 * world.json end value? Mismatches are logged as warnings; nothing is changed.
 */
export function validateTimeline(world, scenesById) {
  const rows = [];
  world.locations.forEach((loc, i) => {
    const data = scenesById.get(loc.id);
    if (!data) {
      rows.push({ order: loc.order, scene: loc.name, status: 'scene file missing' });
      return;
    }
    const start = expectedStartFor(world, i);
    const quotes = [...data.quotes].sort(byStepThenOrder);
    const afterRequired = simulateQuotes(start, quotes.filter((q) => q.required));
    const afterAll = simulateQuotes(start, quotes);
    const ok = componentsMatch(afterRequired, loc.nihilism);
    if (!ok) {
      console.warn(
        `[Nihilism] "${loc.name}": its required quotes move the coefficient from ${formatComponents(start)} ` +
          `to ${formatComponents(afterRequired)}, but world.json ends this scene at ${formatComponents(loc.nihilism)}.`,
      );
    }
    rows.push({
      order: loc.order,
      scene: loc.name,
      start: formatComponents(start),
      'after required quotes': formatComponents(afterRequired),
      'after all quotes': formatComponents(afterAll),
      'world.json end': formatComponents(loc.nihilism),
      status: ok ? 'OK' : 'MISMATCH',
    });
  });
  console.groupCollapsed('[Nihilism] Timeline check');
  console.table(rows);
  console.groupEnd();
  return rows;
}

/**
 * Runtime check when a scene completes: compares the value the user's viewed quotes
 * produced with the scene's world.json end value and logs any mismatch.
 */
export function checkSceneEnd(location, actual, viewedQuotes) {
  const ok = componentsMatch(actual, location.nihilism);
  if (!ok) {
    console.warn(
      `[Nihilism] Scene "${location.name}" finished at ${formatComponents(actual)} from its quotation changes, ` +
        `but world.json expects ${formatComponents(location.nihilism)}. Setting the global value to the world.json end value.`,
      { viewedQuotes: viewedQuotes.map((q) => ({ objectId: q.objectId, step: q.step, required: q.required, delta: q.nihilism })) },
    );
  }
  return ok;
}
