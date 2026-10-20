import { el, reveal, conceal } from './dom.js';

// The glass start menu shown over the slowly turning globe.
// Title and subtitle come from world.json `meta`; the second button opens the
// Nihilism Coefficient explanation (world.json `nihilismExplanation`).

export class StartMenu {
  constructor(root, { meta, dev, onStart, onAbout }) {
    this.button = el('button', {
      className: 'btn btn-primary btn-lg',
      text: 'Begin',
      attrs: { type: 'button' },
      on: { click: () => onStart() },
    });
    this.aboutButton = el('button', {
      className: 'btn btn-lg',
      text: 'About the Nihilism Coefficient',
      attrs: { type: 'button', 'aria-haspopup': 'dialog' },
      on: { click: () => onAbout(this.aboutButton) },
    });
    this.node = el('section', { className: 'start-menu glass', attrs: { hidden: '', 'aria-labelledby': 'start-title' } }, [
      el('h1', { className: 'start-title', text: meta.title ?? '[PLACEHOLDER]', attrs: { id: 'start-title' } }),
      el('p', { className: 'start-subtitle', text: meta.subtitle ?? '[PLACEHOLDER]' }),
      el('div', { className: 'start-actions' }, [this.button, this.aboutButton]),
      el('p', { className: 'start-help', text: 'Drag to turn the globe · scroll or pinch to zoom · select the glowing marker to travel' }),
      dev && el('p', { className: 'dev-badge', text: 'Developer mode: every scene is unlocked' }),
    ]);
    root.append(this.node);
  }

  async show() {
    await reveal(this.node);
    this.button.focus({ preventScroll: true });
  }

  hide() {
    this.button.disabled = true;
    this.aboutButton.disabled = true;
    return conceal(this.node, 520);
  }
}
