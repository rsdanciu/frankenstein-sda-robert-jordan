import { el, reveal, conceal, fmt2, signed } from './dom.js';
import { COMPONENTS } from '../nihilism/nihilism.js';
import { COMPONENT_NAMES } from './HUD.js';

// Final menu after the Arctic scene: an overview of how the Nihilism Coefficient
// changed across the journey (line chart + per-scene table), then the bibliography.
// Title/text come from world.json `ending`; the bibliography heading and entries come
// from json/bibliography.json (text wrapped in *asterisks* is shown in italics).

const SVG_NS = 'http://www.w3.org/2000/svg';

// Identity colours match the HUD meter and the impact page (see --series-* in main.css).
const SERIES = [
  { key: 'truth', name: COMPONENT_NAMES.truth },
  { key: 'unity', name: COMPONENT_NAMES.unity },
  { key: 'purpose', name: COMPONENT_NAMES.purpose },
  { key: 'value', name: 'Coefficient' },
];

const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export class EndingMenu {
  constructor(root, { world, loadBibliography, onRestart }) {
    this.world = world;
    this.loadBibliography = loadBibliography;
    this.overview = el('div', { className: 'ending-view' });
    this.bibliography = el('div', { className: 'ending-view', attrs: { hidden: '' } });
    this.node = el('section', { className: 'ending glass', attrs: { hidden: '', 'aria-labelledby': 'ending-title' } }, [
      this.overview,
      this.bibliography,
    ]);
    this.onRestart = onRestart;
    root.append(this.node);
    this.chart = null;
    window.addEventListener('resize', () => this.chart && !this.node.hidden && this.#drawChart());
  }

  async show(history) {
    this.history = history;
    this.#renderOverview();
    this.bibliography.hidden = true;
    this.overview.hidden = false;
    await reveal(this.node);
    this.#drawChart();
    this.node.querySelector('button')?.focus({ preventScroll: true });
  }

  hide() {
    return conceal(this.node);
  }

  #renderOverview() {
    const { ending } = this.world;
    this.chart = el('div', { className: 'chart', attrs: { tabindex: '0', 'aria-label': 'Nihilism Coefficient over the journey. Use the arrow keys to step through changes.' } });
    this.overview.replaceChildren(
      el('h2', { className: 'ending-title', text: ending.title ?? '[PLACEHOLDER]', attrs: { id: 'ending-title' } }),
      el('p', { className: 'ending-text', text: ending.text ?? '[PLACEHOLDER]' }),
      el('h3', { className: 'ending-subtitle', text: 'The Nihilism Coefficient across the journey' }),
      el(
        'ul',
        { className: 'legend' },
        SERIES.map((s) => el('li', {}, [el('span', { className: `key-line series-${s.key}` }), s.name])),
      ),
      this.chart,
      this.#table(),
      el('div', { className: 'ending-actions' }, [
        el('button', { className: 'btn btn-primary', text: 'Bibliography', attrs: { type: 'button' }, on: { click: () => this.#showBibliography() } }),
        el('button', { className: 'btn', text: 'Restart journey', attrs: { type: 'button' }, on: { click: () => this.onRestart() } }),
      ]),
    );
  }

  /** Table view: each scene's end values and its change in the coefficient. */
  #table() {
    const ends = new Map();
    for (const h of this.history) if (h.kind === 'scene-end') ends.set(h.sceneId, h);
    const start = this.history.find((h) => h.kind === 'start');
    let prev = start?.value ?? null;

    const head = el('tr', {}, ['Scene', ...COMPONENTS.map((k) => COMPONENT_NAMES[k]), 'Coefficient', 'Change'].map((t) => el('th', { text: t, attrs: { scope: 'col' } })));
    const rows = this.world.locations.map((loc) => {
      const end = ends.get(loc.id);
      if (!end) return el('tr', { className: 'is-missing' }, [el('th', { text: `${loc.order}. ${loc.name}`, attrs: { scope: 'row' } }), el('td', { text: 'not visited', attrs: { colspan: '5' } })]);
      const change = prev === null ? 0 : end.value - prev;
      prev = end.value;
      return el('tr', {}, [
        el('th', { text: `${loc.order}. ${loc.name}`, attrs: { scope: 'row' } }),
        ...COMPONENTS.map((k) => el('td', { text: fmt2(end[k]) })),
        el('td', { text: fmt2(end.value) }),
        el('td', { text: signed(change) }),
      ]);
    });
    return el('div', { className: 'table-wrap' }, el('table', { className: 'ending-table' }, [
      el('caption', { text: `Start: ${start ? fmt2(start.value) : '–'}` }),
      el('thead', {}, head),
      el('tbody', {}, rows),
    ]));
  }

  #drawChart() {
    const data = this.history;
    const host = this.chart;
    const W = Math.max(280, host.clientWidth);
    const H = W < 480 ? 200 : 240;
    const m = { top: 12, right: 14, bottom: 30, left: 38 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const n = data.length;
    const x = (i) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.top + (1 - v) * ih;

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-hidden': 'true' });

    // Recessive grid + y ticks
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      root.append(svg('line', { class: 'grid', x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
      const t = svg('text', { class: 'tick', x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = v.toFixed(2);
      root.append(t);
    }

    // Scene boundaries: a hairline at each scene's end, labelled with its order number.
    data.forEach((h, i) => {
      if (h.kind !== 'scene-end') return;
      root.append(svg('line', { class: 'boundary', x1: x(i), x2: x(i), y1: m.top, y2: m.top + ih }));
      const loc = this.world.locations.find((l) => l.id === h.sceneId);
      const t = svg('text', { class: 'tick', x: x(i), y: H - 10, 'text-anchor': 'middle' });
      t.textContent = loc ? String(loc.order) : '';
      root.append(t);
    });

    // Lines (coefficient last so it sits on top), each with an end dot.
    for (const s of SERIES) {
      const d = data.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h[s.key]).toFixed(1)}`).join('');
      root.append(svg('path', { class: `line series-${s.key}`, d }));
      if (n) root.append(svg('circle', { class: `dot series-${s.key}`, cx: x(n - 1), cy: y(data[n - 1][s.key]), r: 4 }));
    }

    // Hover layer: crosshair snaps to the nearest change; tooltip lists every series.
    const cross = svg('line', { class: 'crosshair', y1: m.top, y2: m.top + ih, visibility: 'hidden' });
    root.append(cross);
    const tip = el('div', { className: 'chart-tip', attrs: { hidden: '' } });
    const showAt = (i) => {
      if (i < 0 || i >= n) return;
      this.focusIndex = i;
      const h = data[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        el('p', { className: 'chart-tip-label', text: h.label }),
        ...[...SERIES].reverse().map((s) =>
          el('p', { className: 'chart-tip-row' }, [el('span', { className: `key-line series-${s.key}` }), el('strong', { text: fmt2(h[s.key]) }), ` ${s.name}`]),
        ),
      );
      tip.hidden = false;
      const left = x(i) + 12 + 170 > W ? x(i) - 12 - 170 : x(i) + 12;
      tip.style.transform = `translate(${Math.max(0, left)}px, ${m.top}px)`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    const hit = svg('rect', { class: 'hit', x: m.left - 10, y: 0, width: iw + 20, height: H });
    hit.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect();
      const px = e.clientX - r.left;
      showAt(n <= 1 ? 0 : Math.round(((px - m.left) / iw) * (n - 1)));
    });
    hit.addEventListener('pointerleave', hide);
    root.append(hit);

    host.onkeydown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = (this.focusIndex ?? (e.key === 'ArrowRight' ? -1 : n)) + (e.key === 'ArrowRight' ? 1 : -1);
      showAt(Math.max(0, Math.min(n - 1, i)));
    };
    host.onblur = hide;
    this.focusIndex = null;
    host.replaceChildren(root, tip);
  }

  async #showBibliography() {
    const { title, entries } = await this.loadBibliography();
    const back = el('button', { className: 'btn', text: 'Back to overview', attrs: { type: 'button' }, on: { click: () => this.#showOverview() } });
    this.bibliography.replaceChildren(
      el('h2', { className: 'ending-title', text: title }),
      entries.length
        ? el('ol', { className: 'bibliography' }, entries.map((e) => el('li', {}, withItalics(e))))
        : el('p', { className: 'ending-text', text: 'No entries yet.' }),
      el('div', { className: 'ending-actions' }, back),
    );
    this.overview.hidden = true;
    this.bibliography.hidden = false;
    back.focus({ preventScroll: true });
  }

  #showOverview() {
    this.bibliography.hidden = true;
    this.overview.hidden = false;
    this.#drawChart();
  }
}

/** "Title *in italics* here" → text and <em> nodes (still inserted as plain text, never HTML). */
function withItalics(text) {
  return text.split(/\*([^*]+)\*/).map((part, i) => (i % 2 ? el('em', { text: part }) : part));
}
