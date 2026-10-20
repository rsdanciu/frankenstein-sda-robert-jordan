import { el } from '../ui/dom.js';
import { nihilism } from '../nihilism/nihilism.js';

// Developer mode: add ?dev=1 to the URL.
//   • every location is unlocked (enter in any order, re-enter completed ones)
//   • a panel with a slider for the coefficient (sets all three components) and one
//     per component, plus shortcuts: complete scene, exit scene, show ending, restart
//   • an FPS readout

export const DEV = new URLSearchParams(window.location.search).get('dev') === '1';

export class DevPanel {
  constructor(root, actions) {
    this.inputs = {};
    this.frames = 0;
    this.acc = 0;

    const slider = (key, label) => {
      const input = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': label } });
      const out = el('output', { className: 'dev-out' });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        nihilism.set(key === 'coefficient' ? { truth: v, unity: v, purpose: v } : { [key]: v });
      });
      this.inputs[key] = { input, out };
      return el('label', { className: `dev-row${key === 'coefficient' ? ' is-master' : ''}` }, [el('span', { className: 'dev-name', text: label }), input, out]);
    };
    const button = (text, fn) => el('button', { className: 'btn btn-sm', text, attrs: { type: 'button' }, on: { click: fn } });

    this.fps = el('span', { className: 'dev-fps', text: '– fps' });
    this.body = el('div', { className: 'dev-body' }, [
      slider('coefficient', 'Coefficient'),
      slider('truth', 'Truth'),
      slider('unity', 'Unity'),
      slider('purpose', 'Purpose'),
      el('div', { className: 'dev-actions' }, [
        button('Complete scene', actions.completeScene),
        button('Exit scene', actions.exitScene),
        button('Show ending', actions.showEnding),
        button('Restart', actions.restart),
      ]),
    ]);
    const toggle = el('button', {
      className: 'dev-toggle',
      text: 'DEV',
      attrs: { type: 'button', 'aria-expanded': 'true', title: 'Collapse developer panel' },
      on: {
        click: () => {
          const open = this.body.hidden;
          this.body.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
        },
      },
    });
    this.node = el('aside', { className: 'dev-panel glass', attrs: { 'aria-label': 'Developer mode' } }, [
      el('header', { className: 'dev-header' }, [toggle, this.fps]),
      this.body,
    ]);
    root.append(this.node);

    nihilism.onChange(() => this.sync());
    this.sync();
  }

  sync() {
    for (const [key, { input, out }] of Object.entries(this.inputs)) {
      const v = key === 'coefficient' ? nihilism.value : nihilism[key];
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = v.toFixed(2);
    }
  }

  tick(dt) {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps.textContent = `${Math.round(this.frames / this.acc)} fps`;
      this.frames = 0;
      this.acc = 0;
    }
  }
}
