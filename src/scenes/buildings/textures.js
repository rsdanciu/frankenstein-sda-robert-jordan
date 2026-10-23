import * as THREE from 'three';
import { Rng } from '../nature/random.js';
import { makeCanvas, toTexture, wrapped, normalFromHeight } from '../nature/textures.js';

/**
 * Canvas-drawn textures for buildings and their contents (no image files). Each tiles,
 * and the ones with relief return { map, normalMap }. Geometry from buildings/parts.js
 * has UVs in metres, so `metres` below is the real-world size one tile covers.
 *
 *   plasterTextures()  lime plaster for timber-framed walls (metres: 2)
 *   timberTextures()   dark oak beams, grain along u (metres: 1.5)
 *   thatchTextures()   weathered straw thatch in courses, straws along v (metres: 2)
 *   boardTextures()    weathered vertical planks with dark joints (metres: 1.6)
 *   stoneTextures()    fieldstone in mortar (metres: 1.5)
 *   floorTexture()     worn floorboards (metres: 2)
 *   strawTexture()     loose straw over earth (metres: 1.5)
 *   pageTexture()      an open book's two pages; ruled grey strokes stand in for lines of
 *                      print (there is no text in it)
 */

/** Sets the repeat so a texture drawn for `metres` tiles correctly on metric UVs. */
export function metric(texture, metres) {
  texture.repeat.set(1 / metres, 1 / metres);
  return texture;
}

function noiseSpeckle(g, rng, size, count, colors, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const r = rng.float(rMin, rMax);
    g.fillStyle = rng.pick(colors);
    wrapped(size, x, y, r, (px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    });
  }
}

export function plasterTextures({ seed = 31, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  g.fillStyle = '#d9d0bd';
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, size, size);
  // Broad mottling and damp patches
  noiseSpeckle(g, rng, size, 60, ['rgba(160,145,120,0.08)', 'rgba(255,250,235,0.1)', 'rgba(120,110,90,0.06)'], 30, 110);
  // Trowel marks and grit
  noiseSpeckle(hg, rng, size, 900, ['rgba(255,255,255,0.18)', 'rgba(0,0,0,0.16)'], 1, 4);
  noiseSpeckle(g, rng, size, 700, ['rgba(90,80,64,0.12)', 'rgba(255,255,250,0.1)'], 0.6, 2);
  // Hairline cracks
  for (let i = 0; i < 9; i++) {
    let x = rng.float(0, size);
    let y = rng.float(0, size);
    g.strokeStyle = 'rgba(70,60,48,0.35)';
    hg.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = hg.lineWidth = 1;
    g.beginPath();
    hg.beginPath();
    g.moveTo(x, y);
    hg.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += rng.float(-14, 14);
      y += rng.float(4, 16);
      g.lineTo(x, y);
      hg.lineTo(x, y);
    }
    g.stroke();
    hg.stroke();
  }
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 2.5) };
}

export function timberTextures({ seed = 41, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  g.fillStyle = '#4b3627';
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#909090';
  hg.fillRect(0, 0, size, size);
  // Grain: long wavy streaks along x that wrap.
  for (let i = 0; i < 160; i++) {
    const y0 = rng.float(0, size);
    const amp = rng.float(1, 6);
    const ph = rng.float(0, Math.PI * 2);
    const light = rng.chance(0.45);
    g.strokeStyle = light ? `rgba(120,92,66,${rng.float(0.1, 0.3)})` : `rgba(28,18,12,${rng.float(0.15, 0.35)})`;
    hg.strokeStyle = light ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)';
    g.lineWidth = hg.lineWidth = rng.float(0.8, 2.6);
    for (const oy of [0, -size, size]) {
      g.beginPath();
      hg.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + oy + Math.sin((x / size) * Math.PI * 2 * 2 + ph) * amp;
        if (x === 0) {
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
  // Drying checks (short dark splits) and adze marks
  for (let i = 0; i < 26; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const len = rng.float(20, 90);
    const width = rng.float(1, 2.5);
    g.fillStyle = 'rgba(15,10,6,0.6)';
    hg.fillStyle = 'rgba(0,0,0,0.9)';
    wrapped(size, x, y, len, (px, py) => {
      g.fillRect(px, py, len, width);
      hg.fillRect(px, py, len, 2);
    });
  }
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 4) };
}

export function thatchTextures({ seed = 51, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  g.fillStyle = '#5e5440';
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#505050';
  hg.fillRect(0, 0, size, size);
  const courses = 6;
  const courseH = size / courses;
  const straws = ['#8f805e', '#a18e64', '#7d6f52', '#6b604a', '#b09a6c', '#857860'];
  for (let k = 0; k < courses; k++) {
    const top = k * courseH;
    // Each course: dense straws hanging down slope, their butt ends forming a ragged edge.
    for (let i = 0; i < 1400; i++) {
      const x = rng.float(0, size);
      const len = rng.float(0.7, 1.25) * courseH;
      const y = top + rng.float(-0.1, 0.35) * courseH;
      const tilt = rng.float(-0.12, 0.12);
      const col = rng.pick(straws);
      const w = rng.float(1, 2.4);
      const alpha = rng.float(0.55, 0.95);
      const relief = rng.float(0.05, 0.2);
      wrapped(size, x, y, len, (px, py) => {
        g.strokeStyle = col;
        g.globalAlpha = alpha;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + tilt * len, py + len);
        g.stroke();
        hg.strokeStyle = `rgba(255,255,255,${relief})`;
        hg.lineWidth = w;
        hg.beginPath();
        hg.moveTo(px, py);
        hg.lineTo(px + tilt * len, py + len);
        hg.stroke();
      });
    }
    g.globalAlpha = 1;
    // Shadow under the butt ends of the course above.
    const grad = g.createLinearGradient(0, top, 0, top + courseH * 0.25);
    grad.addColorStop(0, 'rgba(20,16,10,0.45)');
    grad.addColorStop(1, 'rgba(20,16,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, top, size, courseH * 0.25);
    const hgrad = hg.createLinearGradient(0, top, 0, top + courseH * 0.3);
    hgrad.addColorStop(0, 'rgba(0,0,0,0.6)');
    hgrad.addColorStop(1, 'rgba(0,0,0,0)');
    hg.fillStyle = hgrad;
    hg.fillRect(0, top, size, courseH * 0.3);
  }
  // Weathering: grey-green moss and darker damp patches.
  noiseSpeckle(g, rng, size, 40, ['rgba(70,80,52,0.18)', 'rgba(40,36,28,0.2)', 'rgba(90,96,70,0.14)'], 18, 60);
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 5) };
}

export function boardTextures({ seed = 61, size = 512, boards = 8 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  hg.fillStyle = '#909090';
  hg.fillRect(0, 0, size, size);
  const bw = size / boards;
  for (let b = 0; b < boards; b++) {
    const x0 = b * bw;
    const tone = rng.float(0.8, 1.15);
    const base = [0x6d, 0x64, 0x58].map((v) => Math.round(v * tone));
    g.fillStyle = `rgb(${base.join(',')})`;
    g.fillRect(x0, 0, bw, size);
    // Grain along the board
    for (let i = 0; i < 26; i++) {
      const x = x0 + rng.float(2, bw - 2);
      g.strokeStyle = rng.chance(0.5) ? 'rgba(40,34,28,0.25)' : 'rgba(170,160,140,0.15)';
      g.lineWidth = rng.float(0.6, 1.8);
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= size; y += 16) g.lineTo(x + Math.sin(y * 0.02 + i) * 1.5, y);
      g.stroke();
    }
    // A knot or two
    const knots = rng.int(0, 2);
    for (let k = 0; k < knots; k++) {
      const kx = x0 + rng.float(bw * 0.25, bw * 0.75);
      const ky = rng.float(0, size);
      g.fillStyle = 'rgba(30,24,18,0.7)';
      g.beginPath();
      g.ellipse(kx, ky, rng.float(2, 5), rng.float(4, 8), 0, 0, Math.PI * 2);
      g.fill();
    }
    // Dark joint between boards
    g.fillStyle = 'rgba(12,10,8,0.9)';
    g.fillRect(x0, 0, rng.float(2, 4), size);
    hg.fillStyle = '#000';
    hg.fillRect(x0, 0, 4, size);
  }
  noiseSpeckle(g, rng, size, 30, ['rgba(80,90,60,0.12)', 'rgba(30,28,22,0.15)'], 10, 40);
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 4) };
}

export function stoneTextures({ seed = 71, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const [hc, hg] = makeCanvas(size);
  g.fillStyle = '#5b554b'; // mortar
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#202020';
  hg.fillRect(0, 0, size, size);
  const rows = 7;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = rng.float(0, rh);
    while (x < size + rh) {
      const w = rng.float(0.9, 1.9) * rh;
      const cx = x + w / 2;
      const cy = r * rh + rh / 2 + rng.float(-3, 3);
      const tone = rng.float(0.75, 1.2);
      const col = [0x8a, 0x84, 0x78].map((v) => Math.round(v * tone * rng.float(0.95, 1.05)));
      wrapped(size, cx, cy, w, (px, py) => {
        g.fillStyle = `rgb(${col.join(',')})`;
        g.beginPath();
        g.roundRect(px - w / 2 + 2, py - rh / 2 + 2, w - 4, rh - 4, rh * 0.3);
        g.fill();
        const hgr = hg.createRadialGradient(px, py, 1, px, py, Math.max(w, rh) * 0.6);
        hgr.addColorStop(0, '#e0e0e0');
        hgr.addColorStop(1, '#707070');
        hg.fillStyle = hgr;
        hg.beginPath();
        hg.roundRect(px - w / 2 + 2, py - rh / 2 + 2, w - 4, rh - 4, rh * 0.3);
        hg.fill();
      });
      x += w;
    }
  }
  noiseSpeckle(g, rng, size, 500, ['rgba(40,36,30,0.25)', 'rgba(200,195,180,0.12)'], 0.8, 2.5);
  noiseSpeckle(g, rng, size, 25, ['rgba(90,100,60,0.18)'], 8, 26);
  return { map: toTexture(c, { repeat: true }), normalMap: normalFromHeight(hc, 3) };
}

export function floorTexture({ seed = 81, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  const planks = 6;
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const tone = rng.float(0.8, 1.1);
    g.fillStyle = `rgb(${[0x6a, 0x4c, 0x33].map((v) => Math.round(v * tone)).join(',')})`;
    g.fillRect(0, p * ph, size, ph);
    for (let i = 0; i < 30; i++) {
      const y = p * ph + rng.float(2, ph - 2);
      g.strokeStyle = rng.chance(0.5) ? 'rgba(30,20,12,0.25)' : 'rgba(150,110,80,0.15)';
      g.lineWidth = rng.float(0.6, 1.6);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) g.lineTo(x, y + Math.sin(x * 0.015 + i) * 1.2);
      g.stroke();
    }
    g.fillStyle = 'rgba(18,12,8,0.85)';
    g.fillRect(0, p * ph, size, 2.5);
    const joint = rng.float(0, size);
    g.fillRect(joint, p * ph, 2.5, ph);
  }
  noiseSpeckle(g, rng, size, 40, ['rgba(20,14,10,0.12)', 'rgba(180,150,110,0.08)'], 8, 36);
  return toTexture(c, { repeat: true });
}

export function strawTexture({ seed = 91, size = 512 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(size);
  g.fillStyle = '#3b3226';
  g.fillRect(0, 0, size, size);
  noiseSpeckle(g, rng, size, 40, ['rgba(20,16,12,0.3)', 'rgba(70,60,44,0.25)'], 20, 70);
  const cols = ['#a4915f', '#8c7b50', '#b8a571', '#7a6c48', '#c4b07a'];
  for (let i = 0; i < 2600; i++) {
    const x = rng.float(0, size);
    const y = rng.float(0, size);
    const len = rng.float(10, 46);
    const a = rng.float(0, Math.PI * 2);
    const col = rng.pick(cols);
    const alpha = rng.float(0.35, 0.9);
    const w = rng.float(0.8, 2);
    wrapped(size, x, y, len, (px, py) => {
      g.strokeStyle = col;
      g.globalAlpha = alpha;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
  return toTexture(c, { repeat: true });
}

export function pageTexture({ seed = 101, width = 512, height = 256 } = {}) {
  const rng = new Rng(seed);
  const [c, g] = makeCanvas(width, height);
  g.fillStyle = '#e8dcc0';
  g.fillRect(0, 0, width, height);
  // Aged paper: darker toward the edges and the gutter.
  const edge = g.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, width * 0.62);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(120,90,50,0.35)');
  g.fillStyle = edge;
  g.fillRect(0, 0, width, height);
  const gutter = g.createLinearGradient(width / 2 - 30, 0, width / 2 + 30, 0);
  gutter.addColorStop(0, 'rgba(90,64,36,0)');
  gutter.addColorStop(0.5, 'rgba(90,64,36,0.4)');
  gutter.addColorStop(1, 'rgba(90,64,36,0)');
  g.fillStyle = gutter;
  g.fillRect(width / 2 - 30, 0, 60, height);
  // Ruled grey strokes suggesting lines of print (deliberately no letters or words).
  g.fillStyle = 'rgba(60,50,40,0.38)';
  for (const x0 of [width * 0.07, width * 0.55]) {
    for (let y = height * 0.12; y < height * 0.88; y += height * 0.045) {
      let x = x0;
      const end = x0 + width * 0.38 * (rng.chance(0.12) ? rng.float(0.3, 0.7) : 1);
      while (x < end) {
        const w = Math.min(end - x, rng.float(6, 22));
        g.fillRect(x, y, w, height * 0.012);
        x += w + rng.float(3, 6);
      }
    }
  }
  return toTexture(c);
}

/** A soft radial glow (for warm light spilling from a window, a candle's halo, a beam's dust). */
export function glowTexture({ size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)' } = {}) {
  const [c, g] = makeCanvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = toTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
