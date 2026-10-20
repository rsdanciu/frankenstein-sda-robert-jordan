// Loads and normalises the JSON content in public/json.
// Every URL is built from import.meta.env.BASE_URL so the same code works on
// localhost (/frankenstein-sda-robert-jordan/) and on GitHub Pages.

import { readComponents, readDelta } from '../nihilism/nihilism.js';

export function publicUrl(path) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

export async function loadJSON(path) {
  const url = publicUrl(path);
  // no-cache = always revalidate, so edited JSON shows up on refresh.
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  return res.json();
}

const NEUTRAL = { truth: 0.5, unity: 0.5, purpose: 0.5 };

export async function loadWorld() {
  const raw = await loadJSON('json/world.json');
  const start = readComponents(raw.start, NEUTRAL, 'world.json start');

  const locations = [...(raw.locations ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((loc, index) => ({
      id: String(loc.id),
      name: String(loc.name ?? loc.id),
      order: loc.order,
      index,
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      nihilism: readComponents(loc.nihilism, NEUTRAL, `world.json "${loc.id}"`),
    }));

  // Structural checks (logged, never fatal).
  const ids = new Set();
  locations.forEach((loc, i) => {
    if (ids.has(loc.id)) console.warn(`[world.json] Duplicate id "${loc.id}".`);
    ids.add(loc.id);
    if (/[\s/\\]/.test(loc.id)) console.warn(`[world.json] id "${loc.id}" should not contain spaces or slashes (it is a file name).`);
    if (loc.order !== i + 1) console.warn(`[world.json] "${loc.id}" has order ${loc.order}; orders should run 1, 2, 3… without gaps.`);
    if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      console.warn(`[world.json] "${loc.id}" needs numeric latitude and longitude.`);
      loc.latitude = Number.isFinite(loc.latitude) ? loc.latitude : 0;
      loc.longitude = Number.isFinite(loc.longitude) ? loc.longitude : 0;
    }
  });

  return {
    meta: raw.meta ?? {},
    nihilismExplanation: raw.nihilismExplanation ?? {},
    ending: raw.ending ?? {},
    start,
    locations,
  };
}

const sceneCache = new Map();

/** Loads public/json/scenes/<id>.json once and caches the promise. */
export function loadSceneData(id) {
  if (!sceneCache.has(id)) {
    sceneCache.set(id, loadJSON(`json/scenes/${id}.json`).then((raw) => normalizeScene(id, raw)));
  }
  return sceneCache.get(id);
}

function normalizeScene(id, raw) {
  if (raw.id && raw.id !== id) console.warn(`[scenes/${id}.json] "id" is "${raw.id}" but the file is named "${id}".`);

  const quotes = (raw.quotes ?? []).map((q, index) => {
    const ctx = `scenes/${id}.json quote ${index + 1}`;
    if (!q.objectId) console.warn(`[${ctx}] has no objectId; it can never be revealed.`);
    const menu = q.menu ?? 'full';
    if (menu !== 'full' && menu !== 'single') console.warn(`[${ctx}] "menu" is "${q.menu}"; use "full" or "single". Using "full".`);
    return {
      key: `${id}#${index}`,
      label: q.label == null ? null : String(q.label),
      menu: menu === 'single' ? 'single' : 'full',
      text: q.text ?? '',
      quote: q.quote ?? '',
      analysis: q.analysis ?? '',
      page: q.page ?? '',
      isNietzsche: q.isNietzsche === true,
      objectId: String(q.objectId ?? `${id}-missing-${index + 1}`),
      order: Number.isFinite(q.order) ? q.order : index + 1,
      step: Number.isFinite(q.step) ? q.step : 1,
      required: q.required !== false,
      nihilism: readDelta(q.nihilism, ctx),
    };
  });

  const orders = new Set();
  for (const q of quotes) {
    if (orders.has(q.order)) console.warn(`[scenes/${id}.json] Two quotes share order ${q.order}.`);
    orders.add(q.order);
  }

  quotes.sort((a, b) => a.step - b.step || a.order - b.order);
  return { ...raw, id, quotes };
}

/** → { title, entries } from public/json/bibliography.json */
export async function loadBibliography() {
  try {
    const raw = await loadJSON('json/bibliography.json');
    return { title: raw.title ?? 'Bibliography', entries: Array.isArray(raw.entries) ? raw.entries.map(String) : [] };
  } catch (err) {
    console.warn('[bibliography.json]', err);
    return { title: 'Bibliography', entries: [] };
  }
}
