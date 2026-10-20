import { el, reveal, conceal } from './dom.js';

// A large glass popup for longer explanatory text, e.g. the Nihilism Coefficient
// explanation opened from the start menu. Content comes from JSON as { title, text },
// where `text` is a string or an array of paragraphs. Esc, ×, Close or a click on the
// dimmed backdrop closes it, and focus returns to the button that opened it.

export class InfoModal {
  constructor(root) {
    this.title = el('h2', { className: 'modal-title', attrs: { id: 'info-title' } });
    this.body = el('div', { className: 'info-body' });
    this.closeBtn = el('button', {
      className: 'icon-btn',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Close' },
      on: { click: () => this.close() },
    });
    this.panel = el('section', { className: 'modal info-modal glass', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'info-title' } }, [
      el('header', { className: 'modal-header' }, [this.title, this.closeBtn]),
      this.body,
      el('footer', { className: 'modal-footer info-footer' }, el('button', { className: 'btn btn-primary', text: 'Close', attrs: { type: 'button' }, on: { click: () => this.close() } })),
    ]);
    this.node = el('div', { className: 'modal-backdrop', attrs: { hidden: '' } }, this.panel);
    this.node.addEventListener('click', (e) => e.target === this.node && this.close());
    root.append(this.node);

    this.isOpen = false;
    this.opener = null;
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open({ title, text } = {}, opener = document.activeElement) {
    this.opener = opener;
    this.title.textContent = title ?? '[PLACEHOLDER]';
    const paragraphs = [].concat(text ?? '[PLACEHOLDER]');
    this.body.replaceChildren(...paragraphs.map((p) => el('p', { className: 'info-text', text: p })));
    this.body.scrollTop = 0;
    this.isOpen = true;
    reveal(this.node).then(() => this.closeBtn.focus({ preventScroll: true }));
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    conceal(this.node, 300);
    this.opener?.focus?.({ preventScroll: true });
  }
}
