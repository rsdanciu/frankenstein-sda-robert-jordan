import { el, reveal, conceal, fmt2 } from './dom.js';
import { nihilism, COMPONENTS } from '../nihilism/nihilism.js';

// Heads-up display: where you are (top-left), the live Nihilism Coefficient
// (top-right), hints and the Proceed button (bottom), and short toasts.

export const COMPONENT_NAMES = { truth: 'Truth', unity: 'Unity', purpose: 'Purpose' };

export class HUD {
  constructor(root, { locations, onProceed }) {
    this.locations = locations;
    this.info = el('section', { className: 'hud-info glass', attrs: { hidden: '', 'aria-live': 'polite' } });
    this.meter = buildMeter();
    this.hint = el('p', { className: 'hud-hint glass-chip', attrs: { hidden: '' } });
    this.proceed = el('button', {
      className: 'btn btn-primary btn-lg hud-proceed',
      text: 'Proceed',
      attrs: { type: 'button', hidden: '' },
      on: { click: () => onProceed() },
    });
    this.toastEl = el('div', { className: 'toast glass-chip', attrs: { hidden: '', role: 'status' } });
    root.append(this.info, this.meter.node, this.hint, this.proceed, this.toastEl);
    this.lastKey = '';
  }

  setMeterVisible(visible) {
    visible ? reveal(this.meter.node) : conceal(this.meter.node);
  }

  /** Per frame: follows the smoothed coefficient, touching the DOM only when it moves. */
  update() {
    const d = nihilism.displayed;
    const key = `${d.truth.toFixed(3)}${d.unity.toFixed(3)}${d.purpose.toFixed(3)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.meter.value.textContent = fmt2(nihilism.displayedValue);
    for (const k of COMPONENTS) {
      this.meter.rows[k].fill.style.transform = `scaleX(${d[k]})`;
      this.meter.rows[k].num.textContent = fmt2(d[k]);
    }
  }

  showGlobe(progress) {
    const next = progress.nextLocation;
    this.#setInfo(
      el('p', { className: 'hud-kicker', text: `Journey · ${progress.completedCount} of ${this.locations.length} complete` }),
      el('h2', { className: 'hud-title', text: next ? `Next: ${next.name}` : 'Journey complete' }),
      el(
        'ol',
        { className: 'hud-pips', attrs: { 'aria-label': 'Journey progress' } },
        this.locations.map((l) =>
          el('li', {
            className: `pip${progress.isCompleted(l.id) ? ' is-done' : next?.id === l.id ? ' is-next' : ''}`,
            attrs: { title: `${l.order}. ${l.name}` },
          }),
        ),
      ),
    );
    reveal(this.info);
    this.setHint(next ? `Select the glowing marker to travel to ${next.name}` : null);
  }

  showScene(scene) {
    this.updateScene(scene);
    reveal(this.info);
    this.setHint(null);
  }

  updateScene(scene) {
    const t = scene.tracker;
    const loc = scene.location;
    const steps = t.steps;
    const stepNo = t.currentStep === Infinity ? steps.length : steps.indexOf(t.currentStep) + 1;
    this.#setInfo(
      el('p', { className: 'hud-kicker', text: `Scene ${loc.order} of ${this.locations.length}` }),
      el('h2', { className: 'hud-title', text: loc.name }),
      el('p', {
        className: 'hud-progress',
        text: `Required ${t.requiredViewedCount} / ${t.required.length}${steps.length > 1 ? ` · Step ${stepNo} / ${steps.length}` : ''}`,
      }),
      scene.completed && el('p', { className: 'hud-done', text: 'Scene complete' }),
      scene.data.loadError && el('p', { className: 'hud-error', text: `Could not load scenes/${loc.id}.json` }),
      scene.constructor.isPlaceholder && el('span', { className: 'tag', text: 'Placeholder scene' }),
    );
  }

  #setInfo(...children) {
    this.info.replaceChildren(...children.filter(Boolean));
  }

  hideInfo() {
    conceal(this.info);
  }

  setProceedVisible(visible) {
    visible ? reveal(this.proceed) : conceal(this.proceed);
  }

  setHint(text) {
    if (!text) return conceal(this.hint);
    this.hint.textContent = text;
    reveal(this.hint);
  }

  toast(text) {
    this.toastEl.textContent = text;
    reveal(this.toastEl);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => conceal(this.toastEl), 2400);
  }
}

function buildMeter() {
  const value = el('span', { className: 'meter-value', text: '0.50' });
  const rows = {};
  const list = COMPONENTS.map((k) => {
    const fill = el('span', { className: `meter-fill series-${k}` });
    const num = el('span', { className: 'meter-num', text: '0.50' });
    rows[k] = { fill, num };
    return el('div', { className: 'meter-row' }, [
      el('span', { className: 'meter-name', text: COMPONENT_NAMES[k] }),
      el('span', { className: 'meter-track' }, fill),
      num,
    ]);
  });
  const node = el('aside', { className: 'hud-meter glass', attrs: { hidden: '', 'aria-label': 'Nihilism Coefficient' } }, [
    el('div', { className: 'meter-head' }, [el('span', { className: 'meter-label', text: 'Nihilism Coefficient' }), value]),
    el('div', { className: 'meter-rows' }, list),
  ]);
  return { node, value, rows };
}
