import { el, reveal, conceal, fmt2, signed, shownChange } from './dom.js';
import { COMPONENTS, averageOf } from '../nihilism/nihilism.js';
import { COMPONENT_NAMES } from './HUD.js';

// The menu that opens when a scene component is clicked. Three pages, advanced with
// Enter or the Next button:
//   1. Quote                 (Nietzsche quotes get their own styling: .is-nietzsche;
//                            the students' quotes carry their own citations)
//   2. Analysis
//   3. Impact on the Nihilism Coefficient — the quote's delta is applied when this
//      page is first reached, so the world shifts while the numbers are on screen.
// Escape (or ×) closes early; a quote closed before page 3 does not count as viewed.
//
// Entries with "menu": "single" are one-page notes instead: the entry's `label` is the
// title and its `text` the only page. A note counts as viewed (and applies its delta,
// if any) as soon as it opens.

const PAGES = ['Quote', 'Analysis', 'Impact'];

const direction = (d) => (d > 1e-9 ? 'is-up' : d < -1e-9 ? 'is-down' : 'is-zero');

export class QuoteModal {
  constructor(root) {
    this.kicker = el('p', { className: 'modal-kicker' });
    this.title = el('h2', { className: 'modal-title', attrs: { id: 'modal-title' } });
    this.closeBtn = el('button', {
      className: 'icon-btn',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Close' },
      on: { click: () => this.close() },
    });
    this.dots = PAGES.map((name, i) =>
      el('li', { className: 'modal-dot' }, [el('span', { className: 'modal-dot-num', text: i + 1 }), el('span', { className: 'modal-dot-label', text: name })]),
    );
    this.steps = el('ol', { className: 'modal-steps' }, this.dots);
    this.body = el('div', { className: 'modal-body', attrs: { 'aria-live': 'polite' } });
    this.hint = el('span', { className: 'modal-hint' });
    this.nextBtn = el('button', { className: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => this.next() } });
    this.panel = el('section', { className: 'modal glass', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' } }, [
      el('header', { className: 'modal-header' }, [el('div', {}, [this.kicker, this.title]), this.closeBtn]),
      this.steps,
      this.body,
      el('footer', { className: 'modal-footer' }, [this.hint, this.nextBtn]),
    ]);
    this.node = el('div', { className: 'modal-backdrop', attrs: { hidden: '' } }, this.panel);
    root.append(this.node);

    this.session = null;
    window.addEventListener('keydown', (e) => this.#onKey(e));
  }

  get isOpen() {
    return this.session !== null;
  }

  /** Resolves when the menu closes: { viewed } tells whether the impact page was reached. */
  open({ quote, location, index, total, resolveImpact }) {
    return new Promise((resolve) => {
      const single = quote.menu === 'single';
      this.session = { quote, resolveImpact, resolve, page: 0, impact: null, single, pages: single ? [quote.label ?? 'Note'] : PAGES };
      if (single) this.session.impact = resolveImpact();
      this.kicker.textContent = `${location.name} · ${index + 1} / ${total}`;
      this.panel.classList.toggle('is-nietzsche', quote.isNietzsche);
      this.steps.hidden = single;
      this.#render();
      document.body.classList.add('modal-open');
      reveal(this.node).then(() => this.nextBtn.focus({ preventScroll: true }));
    });
  }

  next() {
    const s = this.session;
    if (!s) return;
    if (s.page < s.pages.length - 1) {
      s.page++;
      if (s.page === s.pages.length - 1 && !s.impact) s.impact = s.resolveImpact();
      this.#render();
    } else {
      this.close();
    }
  }

  close() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    document.body.classList.remove('modal-open');
    conceal(this.node, 300).then(() => s.resolve({ viewed: s.impact !== null }));
  }

  #onKey(e) {
    if (!this.session) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) this.next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  #render() {
    const s = this.session;
    this.title.textContent = s.pages[s.page];
    this.dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === s.page);
      d.classList.toggle('is-done', i < s.page);
    });
    this.nextBtn.textContent = s.single ? 'Close' : s.page < PAGES.length - 1 ? 'Next' : 'Continue';
    this.hint.textContent = s.single ? 'Press Enter ↵ to close' : 'Press Enter ↵ to continue';
    const page = s.single ? notePage(s.quote) : [() => quotePage(s.quote), () => analysisPage(s.quote), () => impactPage(s.impact)][s.page]();
    page.classList.add('modal-page');
    this.body.replaceChildren(page);
  }
}

function quotePage(q) {
  return el('figure', { className: `quote-card${q.isNietzsche ? ' is-nietzsche' : ''}` }, [
    q.isNietzsche && el('span', { className: 'nietzsche-mark', text: 'Nietzsche' }),
    el('blockquote', { className: 'quote-text', text: q.quote }),
  ]);
}

function notePage(q) {
  return el('div', { className: 'note' }, el('p', { className: 'note-text', text: q.text }));
}

function analysisPage(q) {
  return el('div', { className: 'analysis' }, el('p', { className: 'analysis-text', text: q.analysis }));
}

function impactPage(impact) {
  const { before, after } = impact;
  const total = shownChange(averageOf(before), averageOf(after));

  const rows = COMPONENTS.map((k) => {
    const d = shownChange(before[k], after[k]);
    return el('div', { className: 'impact-row' }, [
      el('span', { className: 'impact-name' }, [el('span', { className: `key-line series-${k}` }), COMPONENT_NAMES[k]]),
      el('span', { className: 'impact-track' }, [
        el('span', { className: `impact-base series-${k}`, attrs: { style: `width:${Math.min(before[k], after[k]) * 100}%` } }),
        el('span', {
          className: `impact-change ${direction(d)}`,
          attrs: { style: `left:${Math.min(before[k], after[k]) * 100}%;width:${Math.abs(d) * 100}%` },
        }),
      ]),
      el('span', { className: 'impact-values', text: `${fmt2(before[k])} → ${fmt2(after[k])}` }),
      el('span', { className: `impact-delta ${direction(d)}`, text: signed(d) }),
    ]);
  });

  const notes = [];
  if (impact.clamped?.length) notes.push(`${impact.clamped.map((k) => COMPONENT_NAMES[k]).join(', ')} reached the 0–1 limit.`);
  if (impact.alreadyApplied) notes.push('Already counted: viewing a quote again does not change the coefficient.');
  if (impact.pinned) notes.push('This scene is complete, so the coefficient stays at its end value.');

  return el('div', { className: 'impact' }, [
    el('div', { className: 'impact-total' }, [
      el('span', { className: 'impact-total-label', text: 'Nihilism Coefficient' }),
      el('span', { className: 'impact-total-value', text: `${fmt2(averageOf(before))} → ${fmt2(averageOf(after))}` }),
      el('span', { className: `impact-delta ${direction(total)}`, text: signed(total) }),
    ]),
    el('div', { className: 'impact-rows' }, rows),
    ...notes.map((n) => el('p', { className: 'impact-note', text: n })),
  ]);
}
