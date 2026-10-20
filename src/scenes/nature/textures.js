import * as THREE from 'three';
import { Rng } from './random.js';

// Procedural textures drawn on canvases at build time (no image files): leaf clusters,
// single leaves, conifer sprays, grass, fern fronds, bark and forest-floor ground.
// Height canvases drawn alongside some of them become tangent-space normal maps.

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** '#rrggbb' scaled by k → css rgb() */
function shade(hex, k, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgba(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)},${alpha})`;
}

/** A leaf with its stem at (x, y), pointing along `angle`. */
function drawLeaf(g, x, y, len, width, angle, fill, { vein = 'rgba(255,250,220,0.22)', shadow = 0.14 } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.22, -width, len * 0.72, -width * 0.85, len, 0);
  g.bezierCurveTo(len * 0.72, width * 0.85, len * 0.22, width, 0, 0);
  g.fillStyle = fill;
  g.fill();
  // One half slightly darker, as if folded along the midrib.
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.22, -width, len * 0.72, -width * 0.85, len, 0);
  g.closePath();
  g.fillStyle = `rgba(0,0,0,${shadow})`;
  g.fill();
  g.strokeStyle = vein;
  g.lineWidth = Math.max(1, width * 0.09);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(len * 0.9, 0);
  g.stroke();
  g.lineWidth = Math.max(0.6, width * 0.04);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    g.beginPath();
    g.moveTo(len * t * 0.85, 0);
    g.lineTo(len * (t * 0.85 + 0.1), -width * 0.55 * (1 - t * 0.5));
    g.moveTo(len * t * 0.85, 0);
    g.lineTo(len * (t * 0.85 + 0.1), width * 0.55 * (1 - t * 0.5));
    g.stroke();
  }
  g.restore();
}

/** Repeats a draw call across the edges so a tiling texture has no seams. */
function wrapped(size, x, y, reach, draw) {
  for (const ox of [0, -size, size]) {
    for (const oy of [0, -size, size]) {
      if ((ox && Math.abs(x + ox - size / 2) > size / 2 + reach) || (oy && Math.abs(y + oy - size / 2) > size / 2 + reach)) continue;
      draw(x + ox, y + oy);
    }
  }
}

function normalFromHeight(heightCanvas, strength) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = makeCanvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x, y) => src[((((y + h) % h) * w + ((x + w) % w)) << 2)] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) << 2;
      out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return toTexture(c, { srgb: false, repeat: true });
}

export const LEAF_GREENS = ['#5d7642', '#516b3b', '#687f47', '#486236', '#73884e', '#5b6d3b'];

/** A dense clump of leaves on twigs, for crown cards. Light enough to be tinted per instance. */
export function leafClusterTexture({ seed = 1, size = 512, count = 64, palette = LEAF_GREENS } = {}) {
  const [c, g] = makeCanvas(size);
  const rng = new Rng(seed);
  const cx = size / 2;
  const cy = size / 2;
  g.lineCap = 'round';
  g.strokeStyle = '#3a2e22';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.float(-0.3, 0.3);
    g.lineWidth = rng.float(2, 4) * (size / 512);
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(a + 0.3) * size * 0.16, cy + Math.sin(a + 0.3) * size * 0.16, cx + Math.cos(a) * size * 0.3, cy + Math.sin(a) * size * 0.3);
    g.stroke();
  }
  for (let i = 0; i < count; i++) {
    const k = i / count;
    const r = Math.sqrt(rng.next()) * size * 0.27;
    const a = rng.float(0, Math.PI * 2);
    const len = rng.float(0.12, 0.18) * size;
    const ang = a + rng.float(-0.8, 0.8);
    const x = cx + Math.cos(a) * r - Math.cos(ang) * len * 0.25;
    const y = cy + Math.sin(a) * r - Math.sin(ang) * len * 0.25;
    drawLeaf(g, x, y, len, len * rng.float(0.3, 0.4), ang, shade(rng.pick(palette), (0.72 + 0.5 * k) * rng.float(0.92, 1.08)));
  }
  return toTexture(c);
}

/** One neutral, light leaf (tip up) to be coloured per instance: branch leaves, fallen leaves. */
export function singleLeafTexture() {
  const [c, g] = makeCanvas(128, 256);
  drawLeaf(g, 64, 250, 236, 52, -Math.PI / 2, '#e4e0cc', { vein: 'rgba(90,80,60,0.35)', shadow: 0.1 });
  g.strokeStyle = '#8a7d66';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(64, 256);
  g.lineTo(64, 246);
  g.stroke();
  return toTexture(c);
}

/** A spruce spray: a twig from the left edge with needles along it, drooping at the tip. */
export function needleSprayTexture({ seed = 7 } = {}) {
  const [c, g] = makeCanvas(512, 256);
  const rng = new Rng(seed);
  const twig = (t) => [8 + t * 490, 118 + t * t * 40];
  g.lineCap = 'round';
  const needles = (x0, y0, dirx, diry, len, density, scale) => {
    for (let i = 0; i < density; i++) {
      const t = i / density;
      const px = x0 + dirx * len * t;
      const py = y0 + diry * len * t;
      const nl = (14 + rng.float(0, 12)) * scale * (1 - t * 0.45);
      for (const side of [-1, 1]) {
        const a = Math.atan2(diry, dirx) + side * rng.float(0.7, 1.1);
        g.strokeStyle = shade(rng.pick(['#3a5542', '#304a3b', '#45604a', '#2c4436']), rng.float(0.85, 1.15));
        g.lineWidth = rng.float(1.6, 2.6) * scale;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl);
        g.stroke();
      }
    }
  };
  // Side twigs first so the main twig sits on top.
  for (let i = 0; i < 9; i++) {
    const t = 0.12 + (i / 9) * 0.8;
    const [x, y] = twig(t);
    const side = i % 2 ? 1 : -1;
    const a = 0.35 + t * 0.3;
    const len = (1 - t) * 150 + 40;
    needles(x, y, Math.cos(a), side * Math.sin(a) * 1.1, len, Math.round(len / 5), 0.8);
  }
  g.strokeStyle = '#3d3024';
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i <= 20; i++) {
    const [x, y] = twig(i / 20);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  for (let i = 0; i < 20; i++) {
    const [x0, y0] = twig(i / 20);
    const [x1, y1] = twig((i + 1) / 20);
    needles(x0, y0, x1 - x0, y1 - y0, 1, 7, 1);
  }
  return toTexture(c);
}

/** A tuft of grass blades rooted along the bottom edge. */
export function grassTexture({ seed = 3 } = {}) {
  const [c, g] = makeCanvas(256);
  const rng = new Rng(seed);
  for (let i = 0; i < 34; i++) {
    const x = rng.float(50, 206);
    const h = rng.float(110, 248);
    const bend = rng.float(-50, 50);
    const w = rng.float(4, 8);
    const dry = rng.chance(0.15);
    const col = dry ? rng.pick(['#9a9460', '#8c8655']) : rng.pick(['#6a7d45', '#5c7040', '#768a4c', '#52663a', '#82945a']);
    const grad = g.createLinearGradient(0, 256, 0, 256 - h);
    grad.addColorStop(0, shade(col, 0.55));
    grad.addColorStop(1, shade(col, 1.12));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, 256);
    g.quadraticCurveTo(x - w * 0.5 + bend * 0.3, 256 - h * 0.6, x + bend, 256 - h);
    g.quadraticCurveTo(x + w * 0.5 + bend * 0.3, 256 - h * 0.6, x + w, 256);
    g.closePath();
    g.fill();
  }
  return toTexture(c);
}

/** One fern frond, base at the bottom: a curved rachis with tapering leaflets. */
export function fernTexture({ seed = 5 } = {}) {
  const [c, g] = makeCanvas(128, 512);
  const rng = new Rng(seed);
  const at = (t) => [64 + Math.sin(t * 2.2) * 10, 508 - t * 490];
  g.strokeStyle = '#4a5a30';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 30; i++) {
    const [x, y] = at(i / 30);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  for (let i = 2; i < 34; i++) {
    const t = i / 34;
    const [x, y] = at(t);
    const len = 54 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.8) + 4;
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (1.05 - t * 0.35);
      drawLeaf(g, x, y, len, len * 0.22, a, shade(rng.pick(['#5f7a3e', '#56713a', '#6a8446']), rng.float(0.85, 1.1)), { shadow: 0.1 });
    }
  }
  return toTexture(c);
}

/** Tiling bark with vertical furrows and lichen; returns { map, normalMap }. */
export function barkTextures({ seed = 11, size = 512 } = {}) {
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  const rng = new Rng(seed);
  g.fillStyle = '#5a4d3f';
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#9a9a9a';
  hg.fillRect(0, 0, size, size);
  // Plates: soft vertical streaks of lighter and darker bark.
  for (let i = 0; i < 140; i++) {
    const x = rng.float(0, size);
    const w = rng.float(6, 26);
    const light = rng.chance(0.5);
    g.fillStyle = light ? 'rgba(170,150,125,0.10)' : 'rgba(30,22,16,0.12)';
    hg.fillStyle = light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
    const y = rng.float(0, size);
    const h = rng.float(40, 200);
    wrapped(size, x, y, 200, (px, py) => {
      g.fillRect(px - w / 2, py - h / 2, w, h);
      hg.fillRect(px - w / 2, py - h / 2, w, h);
    });
  }
  // Furrows: wandering dark lines that tile vertically (periodic in y).
  for (let i = 0; i < 46; i++) {
    const x0 = rng.float(0, size);
    const amp = rng.float(4, 14);
    const ph = rng.float(0, Math.PI * 2);
    const width = rng.float(2.5, 7);
    const freq = rng.int(1, 2);
    const xAt = (y) => x0 + Math.sin((y / size) * Math.PI * 2 * freq + ph) * amp;
    for (const ox of [0, -size, size]) {
      g.strokeStyle = 'rgba(24,18,13,0.85)';
      hg.strokeStyle = 'rgba(0,0,0,0.9)';
      g.lineWidth = hg.lineWidth = width;
      g.beginPath();
      hg.beginPath();
      for (let y = -8; y <= size + 8; y += 8) {
        const x = xAt(y) + ox;
        if (y < 0) {
          g.moveTo(x, y);
          hg.moveTo(x, y);
        } else {
          g.lineTo(x, y);
          hg.lineTo(x, y);
        }
      }
      g.stroke();
      hg.stroke();
    }
  }
  // Lichen and moss flecks.
  for (let i = 0; i < 90; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(2, 9);
    g.fillStyle = rng.chance(0.6) ? 'rgba(140,152,118,0.35)' : 'rgba(92,110,64,0.4)';
    wrapped(size, x, y, r, (px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    });
  }
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 5) };
}

/**
 * Forest-floor textures that tile every few metres:
 *   grassMap   – short grass and moss for the clearing
 *   litterMap  – fallen leaves, twigs, soil and pebbles under the trees
 *   normalMap  – shared relief (pebbles, leaf edges, clumps)
 */
export function groundTextures({ seed = 21, size = 1024 } = {}) {
  const k = size / 1024;
  const rng = new Rng(seed);
  const [gc, gg] = makeCanvas(size);
  const [lc, lg] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, size, size);

  // Grass and moss
  gg.fillStyle = '#4c5733';
  gg.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(40, 140) * k;
    const col = rng.pick(['rgba(92,108,60,0.35)', 'rgba(60,70,40,0.35)', 'rgba(104,112,66,0.3)', 'rgba(74,62,40,0.25)']);
    wrapped(size, x, y, r, (px, py) => {
      const grad = gg.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      gg.fillStyle = grad;
      gg.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  gg.lineCap = 'round';
  for (let i = 0; i < 26000 * k * k; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const len = rng.float(5, 15) * k;
    const a = rng.float(-Math.PI, Math.PI);
    gg.strokeStyle = shade(rng.pick(['#6a7b44', '#5e6e3e', '#7a8a4e', '#54633a', '#8a9758', '#4a5833']), rng.float(0.8, 1.2), 0.85);
    gg.lineWidth = rng.float(1, 2.2) * k;
    wrapped(size, x, y, len, (px, py) => {
      gg.beginPath();
      gg.moveTo(px, py);
      gg.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      gg.stroke();
    });
  }

  // Leaf litter, soil and twigs
  lg.fillStyle = '#4a3d2d';
  lg.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(40, 150) * k;
    const col = rng.pick(['rgba(40,30,22,0.4)', 'rgba(90,74,50,0.3)', 'rgba(70,80,48,0.25)']);
    wrapped(size, x, y, r, (px, py) => {
      const grad = lg.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = grad;
      lg.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 2600 * k * k; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const len = rng.float(14, 30) * k;
    const a = rng.float(0, Math.PI * 2);
    const col = shade(rng.pick(['#6e5536', '#7d6440', '#5a4630', '#8a7048', '#6b6a3e', '#5f4a32', '#97804f']), rng.float(0.8, 1.15));
    wrapped(size, x, y, len, (px, py) => {
      drawLeaf(lg, px, py, len, len * 0.38, a, col, { vein: 'rgba(40,30,20,0.4)', shadow: 0.18 });
      drawLeaf(hg, px, py, len, len * 0.38, a, 'rgba(200,200,200,0.55)', { vein: 'rgba(90,90,90,0.4)', shadow: 0.1 });
    });
  }
  lg.lineCap = 'round';
  for (let i = 0; i < 160 * k * k; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const len = rng.float(20, 70) * k;
    const a = rng.float(0, Math.PI * 2);
    lg.strokeStyle = shade('#3b2f22', rng.float(0.8, 1.3));
    lg.lineWidth = rng.float(1.5, 3.5) * k;
    wrapped(size, x, y, len, (px, py) => {
      lg.beginPath();
      lg.moveTo(px, py);
      lg.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      lg.stroke();
    });
  }

  // Pebbles in both, plus relief
  for (let i = 0; i < 700 * k * k; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(2, 7) * k;
    const grey = rng.int(105, 160);
    const targets = rng.chance(0.4) ? [gg, lg] : [lg];
    wrapped(size, x, y, r, (px, py) => {
      for (const g of targets) {
        g.fillStyle = `rgb(${grey},${grey - 4},${grey - 12})`;
        g.beginPath();
        g.ellipse(px, py, r, r * 0.75, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,240,0.18)';
        g.beginPath();
        g.ellipse(px - r * 0.25, py - r * 0.25, r * 0.45, r * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      }
      const grad = hg.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      hg.fillStyle = grad;
      hg.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // Soft clumps in the relief so grass areas are not flat
  for (let i = 0; i < 900 * k * k; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(6, 18) * k;
    const v = rng.chance(0.5) ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    wrapped(size, x, y, r, (px, py) => {
      hg.fillStyle = v;
      hg.beginPath();
      hg.arc(px, py, r, 0, Math.PI * 2);
      hg.fill();
    });
  }

  return {
    grassMap: toTexture(gc, { repeat: true }),
    litterMap: toTexture(lc, { repeat: true }),
    normalMap: normalFromHeight(hc, 3.2),
  };
}
