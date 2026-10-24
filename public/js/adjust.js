// Adjustments, like Procreate's: Hue / Saturation / Brightness, Curves, Gaussian Blur, Motion Blur,
// Sharpen, Noise, Bloom and Liquify. Pick one from the list, drag its sliders to see it on the
// active layer (inside the selection, if there is one), then Apply. Cancel puts everything back.
// While you drag, a smaller copy is processed so it stays smooth; on release the full picture is.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- pixel helpers
function premultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] *= a;
    d[i + 1] *= a;
    d[i + 2] *= a;
  }
}
function unpremultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 0 && a < 255) {
      const k = 255 / a;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
}
// Separable box blur on premultiplied RGBA, run three times to look like a Gaussian.
function blurPremult(d, W, H, r, passes = 3) {
  r = Math.max(0, Math.round(r));
  if (!r) return;
  const tmp = new Uint8ClampedArray(d.length);
  const win = r * 2 + 1;
  const run = (src, dst, horizontal) => {
    const len = horizontal ? W : H, lines = horizontal ? H : W;
    const step = horizontal ? 4 : W * 4, lineStep = horizontal ? W * 4 : 4;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, len - 1) * step + c];
        for (let k = 0; k < len; k++) {
          dst[base + k * step + c] = sum / win;
          sum += src[base + clamp(k + r + 1, 0, len - 1) * step + c] - src[base + clamp(k - r, 0, len - 1) * step + c];
        }
      }
    }
  };
  for (let n = 0; n < passes; n++) {
    run(d, tmp, true);
    run(tmp, d, false);
  }
}
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// A monotone curve through points (0-255) as a 256-entry table.
function curveLut(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0] || 1e-6);
    dy.push(p[i + 1][1] - p[i][1]);
    m.push(dy[i] / dx[i]);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (!m[i]) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const lut = new Uint8ClampedArray(256);
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    while (seg < n - 2 && x > p[seg + 1][0]) seg++;
    if (x <= p[0][0]) { lut[x] = p[0][1]; continue; }
    if (x >= p[n - 1][0]) { lut[x] = p[n - 1][1]; continue; }
    const h = dx[seg], u = (x - p[seg][0]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    lut[x] = h00 * p[seg][1] + h10 * h * t[seg] + h01 * p[seg + 1][1] + h11 * h * t[seg + 1];
  }
  return lut;
}

// ---------------------------------------------------------------- the effects
// Each takes ImageData and its parameters and changes it in place. `s` is the size of this copy
// compared with the real layer (1 for full size), so a blur of 20 pixels looks the same at either.
const EFFECTS = {
  hsb: {
    name: 'Hue, Saturation, Brightness', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/>',
    sliders: [['hue', 'Hue', -180, 180, 0, (v) => `${v}°`], ['sat', 'Saturation', -100, 100, 0, (v) => `${v}%`], ['bri', 'Brightness', -100, 100, 0, (v) => `${v}%`]],
    run(im, p) {
      const d = im.data;
      const hs = p.hue, ss = 1 + p.sat / 100, bs = p.bri / 100;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
        h = (h + hs + 360) % 360;
        s = clamp(s * ss, 0, 1);
        v = clamp(bs >= 0 ? v + (1 - v) * bs : v * (1 + bs), 0, 1);
        const [r, g, b] = hsvToRgb(h, s, v);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    },
  },
  gaussian: {
    name: 'Gaussian Blur', icon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="9.5" stroke-dasharray="1 4"/>',
    sliders: [['amount', 'Amount', 0, 100, 12, (v) => `${v}%`]],
    run(im, p, s, W, H) {
      const d = im.data;
      premultiply(d);
      blurPremult(d, W, H, (p.amount / 100) * 0.05 * Math.max(W, H));
      unpremultiply(d);
    },
  },
  motion: {
    name: 'Motion Blur', icon: '<path d="M4 8h10M2 12h14M5 16h10"/><circle cx="19" cy="12" r="2.4"/>',
    sliders: [['angle', 'Angle', -90, 90, 0, (v) => `${v}°`], ['amount', 'Amount', 0, 100, 20, (v) => `${v}%`]],
    run(im, p, s, W, H) {
      const d = im.data;
      premultiply(d);
      const n = Math.max(1, Math.round((p.amount / 100) * 0.08 * Math.max(W, H)));
      const a = (p.angle * Math.PI) / 180, vx = Math.cos(a), vy = Math.sin(a);
      const src = new Uint8ClampedArray(d);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let r = 0, g = 0, b = 0, al = 0;
          for (let k = -n; k <= n; k += Math.max(1, n >> 3)) {
            const sx = clamp(Math.round(x + vx * k), 0, W - 1), sy = clamp(Math.round(y + vy * k), 0, H - 1);
            const j = (sy * W + sx) * 4;
            r += src[j]; g += src[j + 1]; b += src[j + 2]; al += src[j + 3];
          }
          const cnt = Math.floor((2 * n) / Math.max(1, n >> 3)) + 1;
          const i = (y * W + x) * 4;
          d[i] = r / cnt; d[i + 1] = g / cnt; d[i + 2] = b / cnt; d[i + 3] = al / cnt;
        }
      }
      unpremultiply(d);
    },
  },
  sharpen: {
    name: 'Sharpen', icon: '<path d="M12 4l8 14H4z"/>',
    sliders: [['amount', 'Amount', 0, 100, 40, (v) => `${v}%`]],
    run(im, p, s, W, H) {
      const d = im.data;
      const blur = new Uint8ClampedArray(d);
      premultiply(blur);
      blurPremult(blur, W, H, Math.max(1, 0.004 * Math.max(W, H)), 2);
      unpremultiply(blur);
      const k = (p.amount / 100) * 2.2;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        d[i] = clamp(d[i] + (d[i] - blur[i]) * k, 0, 255);
        d[i + 1] = clamp(d[i + 1] + (d[i + 1] - blur[i + 1]) * k, 0, 255);
        d[i + 2] = clamp(d[i + 2] + (d[i + 2] - blur[i + 2]) * k, 0, 255);
      }
    },
  },
  noise: {
    name: 'Noise', icon: '<path d="M5 6h.01M9 9h.01M14 5h.01M18 8h.01M6 13h.01M11 12h.01M16 14h.01M8 18h.01M13 17h.01M19 18h.01"/>',
    sliders: [['amount', 'Amount', 0, 100, 25, (v) => `${v}%`], ['mono', 'Colour', 0, 100, 0, (v) => (v ? `${v}%` : 'Grey')]],
    run(im, p) {
      const d = im.data;
      const k = (p.amount / 100) * 90;
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const n = rnd() * 2 * k;
        const c = p.mono / 100;
        d[i] = clamp(d[i] + n + rnd() * k * c, 0, 255);
        d[i + 1] = clamp(d[i + 1] + n + rnd() * k * c, 0, 255);
        d[i + 2] = clamp(d[i + 2] + n + rnd() * k * c, 0, 255);
      }
    },
  },
  bloom: {
    name: 'Bloom', icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    sliders: [['transparency', 'Transparency', 0, 100, 60, (v) => `${v}%`], ['size', 'Size', 0, 100, 40, (v) => `${v}%`], ['opacity', 'Opacity', 0, 100, 60, (v) => `${v}%`]],
    run(im, p, s, W, H) {
      const d = im.data;
      const glow = new Uint8ClampedArray(d.length);
      const thr = 255 * (1 - p.transparency / 100 * 0.85);
      for (let i = 0; i < d.length; i += 4) {
        const l = lum(d[i], d[i + 1], d[i + 2]);
        const k = d[i + 3] ? clamp((l - thr + 40) / 80, 0, 1) : 0;
        glow[i] = d[i] * k; glow[i + 1] = d[i + 1] * k; glow[i + 2] = d[i + 2] * k; glow[i + 3] = d[i + 3] * k;
      }
      blurPremult(glow, W, H, (p.size / 100) * 0.06 * Math.max(W, H) + 1);
      const o = p.opacity / 100 * 1.6;
      for (let i = 0; i < d.length; i += 4) {
        // Screen the glow over the picture.
        const a = glow[i + 3] / 255 * o;
        if (!a) continue;
        d[i] = clamp(255 - ((255 - d[i]) * (255 - glow[i] * o)) / 255, 0, 255);
        d[i + 1] = clamp(255 - ((255 - d[i + 1]) * (255 - glow[i + 1] * o)) / 255, 0, 255);
        d[i + 2] = clamp(255 - ((255 - d[i + 2]) * (255 - glow[i + 2] * o)) / 255, 0, 255);
        d[i + 3] = clamp(d[i + 3] + glow[i + 3] * o * 0.8, 0, 255);
      }
    },
  },
  curves: {
    name: 'Curves', icon: '<path d="M4 20C9 19 9 5 20 4"/>', custom: true,
    run(im, p) {
      const d = im.data;
      const all = curveLut(p.pts.rgb), r = curveLut(p.pts.r), g = curveLut(p.pts.g), b = curveLut(p.pts.b);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = r[all[d[i]]];
        d[i + 1] = g[all[d[i + 1]]];
        d[i + 2] = b[all[d[i + 2]]];
      }
    },
  },
  liquify: { name: 'Liquify', icon: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/><path d="M3 17c3-6 6 6 9 0s6 6 9 0"/>', liquify: true },
};

export function createAdjust({ studio, toast, getSelection, onMode }) {
  const bar = $('adjBar');
  const menu = $('adjMenu');
  let current = null; // { key, params, layer, orig, origCanvas, small }
  let liq = null;
  const defaultCurves = () => ({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] });

  // ------------------------------------------------------------ list
  menu.innerHTML = `<h2 class="pop-title">Adjustments</h2>${Object.entries(EFFECTS).map(([k, e]) => `<button class="row link adj-item" data-adj="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${e.icon}</svg>${e.name}</button>`).join('')}`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-adj]');
    if (!b) return;
    menu.classList.add('hidden');
    $('btnAdjust').classList.remove('active');
    start(b.dataset.adj);
  });

  // ------------------------------------------------------------ run an adjustment on a layer
  function start(key) {
    cancel();
    const layer = studio.active;
    if (!layer || layer.type !== 'paint') return toast('Select a drawing layer to adjust.');
    if (layer.locked) return toast('This layer is locked.');
    const fx = EFFECTS[key];
    if (fx.liquify) return startLiquify(layer);
    const W = layer.canvas.width, H = layer.canvas.height;
    const params = {};
    for (const [id, , , , def] of fx.sliders || []) params[id] = def;
    if (key === 'curves') Object.assign(params, { pts: defaultCurves(), ch: 'rgb' });
    // A smaller working copy keeps dragging smooth.
    const k = Math.min(1, 900 / Math.max(W, H));
    const small = document.createElement('canvas');
    small.width = Math.max(2, Math.round(W * k));
    small.height = Math.max(2, Math.round(H * k));
    small.getContext('2d', { willReadFrequently: true }).drawImage(layer.canvas, 0, 0, small.width, small.height);
    current = { key, params, layer, orig: studio.grab(layer.canvas), small, k, full: false, timer: 0 };
    onMode?.(true);
    drawBar();
    show();
  }
  function effectOn(im, p, W, H, scale) {
    EFFECTS[current.key].run(im, p, scale, W, H);
  }
  // A quick look: the effect on the small copy, drawn over the layer (through the selection, if any).
  function show() {
    const c = current;
    const { layer, small } = c;
    // Always start from the small copy of the untouched layer.
    if (!c.smallData) c.smallData = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, small.width, small.height);
    const work = new ImageData(new Uint8ClampedArray(c.smallData.data), small.width, small.height);
    effectOn(work, c.params, small.width, small.height, c.k);
    const res = document.createElement('canvas');
    res.width = small.width;
    res.height = small.height;
    res.getContext('2d').putImageData(work, 0, 0);
    const g = layer.ctx;
    const W = layer.canvas.width, H = layer.canvas.height;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(c.orig, 0, 0);
    g.imageSmoothingQuality = 'high';
    const sel = getSelection();
    if (sel) {
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const og = out.getContext('2d');
      og.imageSmoothingQuality = 'high';
      og.drawImage(res, 0, 0, W, H);
      og.globalCompositeOperation = 'destination-in';
      og.drawImage(sel, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(sel, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(out, 0, 0);
    } else {
      g.clearRect(0, 0, W, H);
      g.drawImage(res, 0, 0, W, H);
    }
    g.restore();
    c.full = false;
  }
  // The real thing, at full size.
  function renderFull() {
    const c = current;
    if (!c) return;
    const { layer } = c;
    const W = layer.canvas.width, H = layer.canvas.height;
    const work = new ImageData(new Uint8ClampedArray(c.orig.data), W, H);
    effectOn(work, c.params, W, H, 1);
    const sel = getSelection();
    if (sel) {
      const m = sel.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      const o = c.orig.data, w = work.data;
      for (let i = 0; i < w.length; i += 4) {
        const a = m[i + 3] / 255;
        if (a < 1) for (let k = 0; k < 4; k++) w[i + k] = o[i + k] + (w[i + k] - o[i + k]) * a;
      }
    }
    if (layer.alphaLock) {
      const o = c.orig.data, w = work.data;
      for (let i = 3; i < w.length; i += 4) w[i] = o[i];
    }
    layer.ctx.putImageData(work, 0, 0);
    c.full = true;
  }
  function apply() {
    if (!current) return;
    if (!current.full) renderFull();
    studio.commitWhole(EFFECTS[current.key].name, current.layer, current.orig);
    end();
  }
  function cancel() {
    if (liq) return endLiquify(false);
    if (!current) return;
    current.layer.ctx.putImageData(current.orig, 0, 0);
    end();
  }
  function end() {
    clearTimeout(current?.timer);
    current = null;
    bar.classList.add('hidden');
    document.body.classList.remove('adjusting');
    onMode?.(false);
  }

  // ------------------------------------------------------------ the bar
  function drawBar() {
    const c = current;
    const fx = EFFECTS[c.key];
    const sliders = (fx.sliders || []).map(([id, label, min, max, , fmt]) => `<label class="bar-slide"><span>${label}</span><input type="range" data-p="${id}" min="${min}" max="${max}" value="${c.params[id]}"><output>${fmt(c.params[id])}</output></label>`).join('');
    bar.innerHTML = `<b class="bar-title">${fx.name}</b>
      ${fx.custom ? '<div class="curve-box"><div class="bar-seg" id="curveCh">' + ['rgb', 'r', 'g', 'b'].map((ch) => `<button data-ch="${ch}" class="${c.params.ch === ch ? 'on' : ''}">${ch.toUpperCase()}</button>`).join('') + '</div><canvas id="curveCv" width="180" height="180"></canvas></div>' : `<div class="bar-sliders wide">${sliders}</div>`}
      <button class="bar-cancel" data-do="cancel">Cancel</button><button class="bar-done" data-do="apply">Apply</button>`;
    bar.classList.remove('hidden');
    document.body.classList.add('adjusting');
    if (fx.custom) drawCurve();
  }
  bar.addEventListener('input', (e) => {
    const id = e.target.dataset.p;
    if (!id || !current) return;
    current.params[id] = Number(e.target.value);
    const fx = EFFECTS[current.key];
    e.target.nextElementSibling.textContent = fx.sliders.find((s) => s[0] === id)[5](current.params[id]);
    // Redraw on the next frame, so a fast drag does not queue up work.
    if (!current.pending) {
      current.pending = true;
      requestAnimationFrame(() => {
        if (current) {
          current.pending = false;
          show();
        }
      });
    }
  });
  bar.addEventListener('change', (e) => {
    if (!e.target.dataset.p || !current) return;
    clearTimeout(current.timer);
    current.timer = setTimeout(renderFull, 30);
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    const ch = e.target.closest('[data-ch]');
    if (ch && current) {
      current.params.ch = ch.dataset.ch;
      drawBar();
    } else if (b) {
      if (b.dataset.do === 'apply') (liq ? endLiquify(true) : apply());
      else cancel();
    }
  });

  // ------------------------------------------------------------ curves editor
  function drawCurve() {
    const cv = $('curveCv');
    if (!cv) return;
    const g = cv.getContext('2d');
    const S = cv.width;
    const pts = current.params.pts[current.params.ch];
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(120,120,128,.18)';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.12)';
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((S * i) / 4, 0);
      g.lineTo((S * i) / 4, S);
      g.moveTo(0, (S * i) / 4);
      g.lineTo(S, (S * i) / 4);
      g.stroke();
    }
    const lut = curveLut(pts);
    g.strokeStyle = { rgb: '#fff', r: '#ff6961', g: '#59d68c', b: '#5aa9ff' }[current.params.ch];
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) {
      const px = (x / 255) * S, py = S - (lut[x] / 255) * S;
      x ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc((x / 255) * S, S - (y / 255) * S, 6, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = '#1e8bff';
      g.stroke();
    }
  }
  let curveDrag = null;
  bar.addEventListener('pointerdown', (e) => {
    const cv = e.target.closest('#curveCv');
    if (!cv || !current) return;
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 255, py = 255 - ((e.clientY - r.top) / r.height) * 255;
    const pts = current.params.pts[current.params.ch];
    let idx = pts.findIndex(([x, y]) => Math.hypot(x - px, y - py) < 16);
    if (idx < 0) {
      pts.push([clamp(px, 0, 255), clamp(py, 0, 255)]);
      pts.sort((a, b) => a[0] - b[0]);
      idx = pts.findIndex(([x]) => x === clamp(px, 0, 255));
    }
    curveDrag = { cv, idx, pts };
    cv.setPointerCapture(e.pointerId);
    drawCurve();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!curveDrag) return;
    const { cv, idx, pts } = curveDrag;
    const r = cv.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 255, 0, 255), y = clamp(255 - ((e.clientY - r.top) / r.height) * 255, 0, 255);
    const lo = idx > 0 ? pts[idx - 1][0] + 2 : 0, hi = idx < pts.length - 1 ? pts[idx + 1][0] - 2 : 255;
    pts[idx] = [idx === 0 || idx === pts.length - 1 ? pts[idx][0] : clamp(x, lo, hi), y];
    drawCurve();
    if (!current.pending) {
      current.pending = true;
      requestAnimationFrame(() => {
        if (current) {
          current.pending = false;
          show();
        }
      });
    }
  });
  const curveUp = () => {
    if (!curveDrag) return;
    curveDrag = null;
    clearTimeout(current?.timer);
    if (current) current.timer = setTimeout(renderFull, 30);
  };
  bar.addEventListener('pointerup', curveUp);
  bar.addEventListener('dblclick', (e) => {
    // Double-tap a point to remove it.
    const cv = e.target.closest('#curveCv');
    if (!cv || !current) return;
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 255, py = 255 - ((e.clientY - r.top) / r.height) * 255;
    const pts = current.params.pts[current.params.ch];
    const i = pts.findIndex(([x, y]) => Math.hypot(x - px, y - py) < 16);
    if (i > 0 && i < pts.length - 1) {
      pts.splice(i, 1);
      drawCurve();
      show();
      renderFull();
    }
  });

  // ------------------------------------------------------------ Liquify
  const LIQ = [['push', 'Push', '<path d="M5 12h12m-4-4 4 4-4 4"/>'], ['twirl', 'Twirl', '<path d="M12 4a8 8 0 1 1-7 4M5 4v4h4"/>'], ['twirlL', 'Twirl back', '<path d="M12 4a8 8 0 1 0 7 4M19 4v4h-4"/>'], ['pinch', 'Pinch', '<path d="M5 12h5M19 12h-5M8 9l2 3-2 3M16 9l-2 3 2 3"/>'], ['expand', 'Expand', '<path d="M3 12h6M21 12h-6M7 9l-3 3 3 3M17 9l3 3-3 3"/>'], ['reconstruct', 'Reconstruct', '<path d="M5 12a7 7 0 1 1 2 5M5 18v-5h5"/>']];
  function startLiquify(layer) {
    const W = layer.canvas.width, H = layer.canvas.height;
    liq = { layer, tool: 'push', size: 30, strength: 60, orig: studio.grab(layer.canvas), rect: null, down: null, timer: 0, last: null };
    document.body.classList.add('liquifying');
    onMode?.(true, 'liquify');
    drawLiquifyBar();
    void W;
    void H;
  }
  function drawLiquifyBar() {
    bar.innerHTML = `<b class="bar-title">Liquify</b>
      <div class="bar-seg liq-tools">${LIQ.map(([id, l, p]) => `<button data-liq="${id}" class="${liq.tool === id ? 'on' : ''}" data-tip="${l}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${p}</svg></button>`).join('')}</div>
      <div class="bar-sliders wide"><label class="bar-slide"><span>Size</span><input type="range" data-l="size" min="5" max="120" value="${liq.size}"><output>${liq.size}</output></label>
      <label class="bar-slide"><span>Distortion</span><input type="range" data-l="strength" min="10" max="100" value="${liq.strength}"><output>${liq.strength}%</output></label></div>
      <button class="bar-cancel" data-do="cancel">Cancel</button><button class="bar-done" data-do="apply">Done</button>`;
    bar.classList.remove('hidden');
  }
  bar.addEventListener('click', (e) => {
    const t = e.target.closest('[data-liq]');
    if (t && liq) {
      liq.tool = t.dataset.liq;
      drawLiquifyBar();
    }
  });
  bar.addEventListener('input', (e) => {
    if (!liq || !e.target.dataset.l) return;
    liq[e.target.dataset.l] = Number(e.target.value);
    e.target.nextElementSibling.textContent = e.target.dataset.l === 'size' ? liq.size : `${liq.strength}%`;
  });
  function liquifyDown(e, pt) {
    if (!liq) return;
    liq.down = pt;
    liq.last = pt;
    liq.press = 1;
    liq.snap = liq.layer.ctx.getImageData(0, 0, liq.layer.canvas.width, liq.layer.canvas.height);
    if (!liq.before) liq.before = liq.snap;
    if (liq.tool !== 'push' && liq.tool !== 'reconstruct') liq.timer = setInterval(() => liq.last && liquifyBrush(liq.last, 0, 0), 40);
    else if (liq.tool === 'reconstruct') liq.timer = setInterval(() => liq.last && liquifyBrush(liq.last, 0, 0), 40);
  }
  function liquifyMove(e, pt) {
    if (!liq?.down) return;
    const dx = pt.x - liq.last.x, dy = pt.y - liq.last.y;
    liq.last = pt;
    if (liq.tool === 'push') liquifyBrush(pt, dx, dy);
  }
  function liquifyUp() {
    if (!liq?.down) return;
    clearInterval(liq.timer);
    liq.down = null;
    // One undo step for everything done in this stroke.
    const r = liq.rect;
    if (r) {
      const rect = { x: Math.max(0, Math.floor(r.x0)), y: Math.max(0, Math.floor(r.y0)), w: 0, h: 0 };
      rect.w = Math.min(liq.layer.canvas.width, Math.ceil(r.x1)) - rect.x;
      rect.h = Math.min(liq.layer.canvas.height, Math.ceil(r.y1)) - rect.y;
      if (rect.w > 0 && rect.h > 0) {
        const tmp = document.createElement('canvas');
        tmp.width = liq.snap.width;
        tmp.height = liq.snap.height;
        tmp.getContext('2d').putImageData(liq.snap, 0, 0);
        const before = tmp.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
        studio.pushHistory(studio.rectEntry('Liquify', liq.layer.canvas, rect, before));
        studio.emit('pixels', liq.layer);
      }
    }
    liq.rect = null;
  }
  function liquifyBrush(pt, dx, dy) {
    const { layer, tool, size, strength } = liq;
    const W = layer.canvas.width, H = layer.canvas.height;
    const R = Math.max(4, size * (W / studio.paper.w) * 0.9);
    const x0 = clamp(Math.floor(pt.x - R), 0, W - 1), y0 = clamp(Math.floor(pt.y - R), 0, H - 1);
    const x1 = clamp(Math.ceil(pt.x + R), 1, W), y1 = clamp(Math.ceil(pt.y + R), 1, H);
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return;
    const g = layer.ctx;
    const src = g.getImageData(x0, y0, w, h);
    const out = g.createImageData(w, h);
    const orig = tool === 'reconstruct' ? liq.orig : null;
    const S = strength / 100;
    const sample = (img, fx, fy, c) => {
      fx = clamp(fx, 0, img.width - 1.001);
      fy = clamp(fy, 0, img.height - 1.001);
      const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
      const i = (iy * img.width + ix) * 4 + c;
      const t = img.data[i] * (1 - ax) + img.data[i + 4] * ax;
      const b = img.data[i + img.width * 4] * (1 - ax) + img.data[i + img.width * 4 + 4] * ax;
      return t * (1 - ay) + b * ay;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + x0, py = y + y0;
        const ddx = px - pt.x, ddy = py - pt.y;
        const d = Math.hypot(ddx, ddy);
        const o = (y * w + x) * 4;
        if (d >= R) {
          for (let c = 0; c < 4; c++) out.data[o + c] = src.data[o + c];
          continue;
        }
        const f = (1 - d / R) ** 2;
        let sx = x, sy = y;
        if (tool === 'push') {
          sx = x - dx * f * S * 1.6;
          sy = y - dy * f * S * 1.6;
        } else if (tool === 'twirl' || tool === 'twirlL') {
          const a = (tool === 'twirl' ? -1 : 1) * f * S * 0.22;
          const cs = Math.cos(a), sn = Math.sin(a);
          sx = pt.x - x0 + ddx * cs - ddy * sn;
          sy = pt.y - y0 + ddx * sn + ddy * cs;
        } else if (tool === 'pinch' || tool === 'expand') {
          const s = 1 + (tool === 'pinch' ? 1 : -1) * f * S * 0.12;
          sx = pt.x - x0 + ddx * s;
          sy = pt.y - y0 + ddy * s;
        }
        if (tool === 'reconstruct') {
          const k = f * S * 0.25;
          const oi = (py * W + px) * 4;
          for (let c = 0; c < 4; c++) out.data[o + c] = src.data[o + c] + (orig.data[oi + c] - src.data[o + c]) * k;
        } else {
          for (let c = 0; c < 4; c++) out.data[o + c] = sample(src, sx, sy, c);
        }
      }
    }
    g.putImageData(out, x0, y0);
    liq.rect = liq.rect
      ? { x0: Math.min(liq.rect.x0, x0), y0: Math.min(liq.rect.y0, y0), x1: Math.max(liq.rect.x1, x1), y1: Math.max(liq.rect.y1, y1) }
      : { x0, y0, x1, y1 };
  }
  function endLiquify(keep) {
    if (!liq) return;
    clearInterval(liq.timer);
    if (!keep && liq.before) {
      // Cancel: everything done since Liquify opened goes.
      liq.layer.ctx.putImageData(liq.orig, 0, 0);
      studio.emit('pixels', liq.layer);
    }
    liq = null;
    bar.classList.add('hidden');
    document.body.classList.remove('liquifying');
    onMode?.(false);
  }

  return {
    get active() { return !!current || !!liq; },
    get liquifying() { return !!liq; },
    menu, start, apply, cancel, liquifyDown, liquifyMove, liquifyUp,
  };
}
