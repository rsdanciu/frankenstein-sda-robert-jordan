import { Emitter } from '../core/events.js';

/**
 * Tracks a scene's interactive components (one per quote): which are active,
 * which have been viewed, and when the scene is complete.
 *
 * STEPS ─ every quote has a `step`. The CURRENT step is the lowest step that still has
 * an unviewed REQUIRED quote. By default a component is active when its step is ≤ the
 * current step, so step 2 opens only after every required step-1 quote is viewed.
 * Optional quotes never hold a step back. Once everything required is viewed the
 * current step becomes Infinity and every component is active.
 *
 * MANUAL CONTROL ─ a dedicated scene can force any object on or off regardless of
 * step with setEnabled(objectId, true | false), and hand it back to the step rule
 * with setEnabled(objectId, null).
 *
 * COMPLETE ─ when every required quote has been viewed.
 *
 * Events: 'viewed' (quote) · 'step' (newStep) · 'change'
 */
export class ComponentTracker extends Emitter {
  constructor(quotes) {
    super();
    this.quotes = [...quotes]; // sorted by step → order by data.js
    this.viewed = new Set(); // quote keys
    this.overrides = new Map(); // objectId → boolean
    this.currentStep = this.#computeStep();
  }

  get required() {
    return this.quotes.filter((q) => q.required);
  }

  get requiredViewedCount() {
    return this.required.filter((q) => this.viewed.has(q.key)).length;
  }

  get isComplete() {
    return this.required.every((q) => this.viewed.has(q.key));
  }

  get steps() {
    return [...new Set(this.quotes.map((q) => q.step))].sort((a, b) => a - b);
  }

  get objectIds() {
    return [...new Set(this.quotes.map((q) => q.objectId))];
  }

  quotesFor(objectId) {
    return this.quotes.filter((q) => q.objectId === objectId);
  }

  isViewed(quote) {
    return this.viewed.has(quote.key);
  }

  isQuoteActive(quote) {
    const forced = this.overrides.get(quote.objectId);
    if (forced !== undefined) return forced;
    return quote.step <= this.currentStep;
  }

  /** Summary used to style an object and decide what a click does. */
  objectState(objectId) {
    const qs = this.quotesFor(objectId);
    const active = qs.some((q) => this.isQuoteActive(q));
    return {
      active,
      viewed: qs.length > 0 && qs.every((q) => this.isViewed(q)),
      pending: qs.some((q) => this.isQuoteActive(q) && !this.isViewed(q)),
      required: qs.some((q) => q.required),
      step: qs.length ? Math.min(...qs.map((q) => q.step)) : null,
    };
  }

  /** The quote a click should open: the first active unviewed one, else the last active one (to re-read). */
  quoteToOpen(objectId) {
    const qs = this.quotesFor(objectId).filter((q) => this.isQuoteActive(q));
    return qs.find((q) => !this.isViewed(q)) ?? qs[qs.length - 1] ?? null;
  }

  markViewed(quote) {
    if (this.viewed.has(quote.key)) return false;
    this.viewed.add(quote.key);
    this.emit('viewed', quote);
    const step = this.#computeStep();
    if (step !== this.currentStep) {
      this.currentStep = step;
      this.emit('step', step);
    }
    this.emit('change');
    return true;
  }

  setEnabled(objectId, enabled) {
    if (enabled === null) this.overrides.delete(objectId);
    else this.overrides.set(objectId, Boolean(enabled));
    this.emit('change');
  }

  #computeStep() {
    const pending = this.quotes.filter((q) => q.required && !this.viewed.has(q.key));
    return pending.length ? Math.min(...pending.map((q) => q.step)) : Infinity;
  }
}
