// DOM helpers. All JSON content is inserted with textContent (never innerHTML) so
// quotes and analysis render exactly as written.

export const PLACEHOLDER = '[PLACEHOLDER]';

export function isPlaceholder(value) {
  return value == null || String(value).trim() === '' || String(value).includes(PLACEHOLDER);
}

/** el('div', { className, text, attrs, on }, children) */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [k, fn] of Object.entries(opts.on)) node.addEventListener(k, fn);
  for (const child of [].concat(children)) if (child != null && child !== false) node.append(child);
  return node;
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Adds `is-visible` on the next frame so CSS transitions run. The latest reveal/conceal call wins. */
export async function reveal(node) {
  node.dataset.visibility = 'shown';
  node.hidden = false;
  await nextFrame();
  if (node.dataset.visibility === 'shown') node.classList.add('is-visible');
}

/** Removes `is-visible`, waits for the CSS transition, then hides the node. */
export function conceal(node, ms = 380) {
  node.dataset.visibility = 'hidden';
  node.classList.remove('is-visible');
  return new Promise((resolve) =>
    setTimeout(() => {
      if (node.dataset.visibility === 'hidden') node.hidden = true;
      resolve();
    }, ms),
  );
}

export function fmt2(v) {
  return v.toFixed(2);
}

/**
 * The change between two values as it is shown: the difference of the two values rounded
 * to two places, so "0.22 → 0.33" reads "+0.11" (the unrounded change, 0.1167, would show +0.12).
 */
export function shownChange(from, to) {
  return Math.round(to * 100) / 100 - Math.round(from * 100) / 100;
}

export function signed(v) {
  const s = v.toFixed(2);
  return v > 0 ? `+${s}` : v < 0 ? s : '±0.00';
}
