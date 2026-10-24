// The Colours panel: Disc, Classic, Harmony, Value and Palettes, plus a history of colours used.
// Everything works in HSB (hue 0-360, saturation and brightness 0-1) and speaks hex to the app.
import { uid } from './store.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function hsbToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
export function rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: mx ? d / mx : 0, b: mx };
}
export const toHex = (h, s, v) => '#' + hsbToRgb(h, s, v).map((n) => n.toString(16).padStart(2, '0')).join('');
export function hexToHsb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsb((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const DEFAULT_PALETTES = [
  { id: 'default', name: 'Default', colours: ['#000000', '#3a3a3c', '#8e8e93', '#d1d1d6', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55', '#a2845e', '#7a1f1f', '#8a4b08', '#1d6b34', '#0b3d91'] },
  { id: 'skin', name: 'Skin tones', colours: ['#fde7d6', '#f8d5b8', '#f1c27d', '#e0ac69', '#c68642', '#a5692f', '#8d5524', '#6b3e1f', '#4a2c17', '#2d1a0e'] },
  { id: 'pastel', name: 'Pastels', colours: ['#ffd1dc', '#ffe0ac', '#fff5ba', '#c9f2c7', '#bdeeff', '#c7ceff', '#e8c7ff', '#ffc4e1', '#ffd9c0', '#d9f7be'] },
  { id: 'earth', name: 'Earth', colours: ['#3b2f2f', '#5c4033', '#8b5a2b', '#b08968', '#d4b996', '#7f8f6a', '#4f6f52', '#2f4a3a', '#a63d2f', '#d9a441'] },
];
const KEY = 'promove.colours';

export function createColourUI({ getColour, setColour, toast }) {
  const panel = $('colorPanel');
  let tab = 'disc';
  let hsb = hexToHsb(getColour());
  let secondary = '#ffffff';
  let history = [];
  let palettes = DEFAULT_PALETTES.map((p) => ({ ...p, colours: [...p.colours] }));
  let activePalette = 'default';
  let harmonyMode = 'complementary';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.palettes) palettes = saved.palettes;
    if (saved.history) history = saved.history;
    if (saved.activePalette) activePalette = saved.activePalette;
    if (saved.secondary) secondary = saved.secondary;
    if (saved.harmony) harmonyMode = saved.harmony;
  } catch {}
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ palettes, history, activePalette, secondary, harmony: harmonyMode })); } catch {}
  };

  const commit = (remember = false) => {
    const hex = toHex(hsb.h, hsb.s, hsb.b);
    setColour(hex);
    if (remember) {
      history = [hex, ...history.filter((c) => c !== hex)].slice(0, 12);
      persist();
    }
    paintSwatches();
  };

  // ------------------------------------------------------------ canvases
  const SIZE = 264;
  const disc = $('cpDisc');
  const dctx = disc.getContext('2d');
  const sbSq = $('cpSquare');
  const sctx = sbSq.getContext('2d');

  function drawDisc(harmonyPoints = false) {
    const c = SIZE / 2, ro = c - 4, ri = ro - 34;
    dctx.clearRect(0, 0, SIZE, SIZE);
    // hue ring
    for (let a = 0; a < 360; a += 1.5) {
      dctx.beginPath();
      dctx.arc(c, c, (ro + ri) / 2, ((a - 1) * Math.PI) / 180, ((a + 0.8) * Math.PI) / 180);
      dctx.lineWidth = ro - ri;
      dctx.strokeStyle = `hsl(${a}, 100%, 50%)`;
      dctx.stroke();
    }
    // inner disc: saturation across, brightness down
    const r = ri - 10;
    dctx.save();
    dctx.beginPath();
    dctx.arc(c, c, r, 0, Math.PI * 2);
    dctx.clip();
    const gx = dctx.createLinearGradient(c - r, 0, c + r, 0);
    gx.addColorStop(0, '#fff');
    gx.addColorStop(1, toHex(hsb.h, 1, 1));
    dctx.fillStyle = gx;
    dctx.fillRect(c - r, c - r, r * 2, r * 2);
    const gy = dctx.createLinearGradient(0, c - r, 0, c + r);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, '#000');
    dctx.fillStyle = gy;
    dctx.fillRect(c - r, c - r, r * 2, r * 2);
    dctx.restore();
    // markers
    const ha = (hsb.h * Math.PI) / 180 - Math.PI / 2;
    const rm = (ro + ri) / 2;
    marker(c + Math.cos(ha) * rm, c + Math.sin(ha) * rm, toHex(hsb.h, 1, 1));
    marker(c - r + hsb.s * r * 2, c - r + (1 - hsb.b) * r * 2, toHex(hsb.h, hsb.s, hsb.b));
    if (harmonyPoints) {
      for (const hue of harmonyHues().slice(1)) {
        const a = (hue * Math.PI) / 180 - Math.PI / 2;
        marker(c + Math.cos(a) * rm, c + Math.sin(a) * rm, toHex(hue, hsb.s, hsb.b), 7);
      }
    }
  }
  function marker(x, y, fill, r = 10) {
    dctx.beginPath();
    dctx.arc(x, y, r, 0, Math.PI * 2);
    dctx.fillStyle = fill;
    dctx.fill();
    dctx.lineWidth = 3;
    dctx.strokeStyle = '#fff';
    dctx.stroke();
    dctx.lineWidth = 1;
    dctx.strokeStyle = 'rgba(0,0,0,.35)';
    dctx.beginPath();
    dctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    dctx.stroke();
  }
  function drawSquare() {
    const W = sbSq.width, H = sbSq.height;
    const gx = sctx.createLinearGradient(0, 0, W, 0);
    gx.addColorStop(0, '#fff');
    gx.addColorStop(1, toHex(hsb.h, 1, 1));
    sctx.fillStyle = gx;
    sctx.fillRect(0, 0, W, H);
    const gy = sctx.createLinearGradient(0, 0, 0, H);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, '#000');
    sctx.fillStyle = gy;
    sctx.fillRect(0, 0, W, H);
    const x = hsb.s * W, y = (1 - hsb.b) * H;
    sctx.beginPath();
    sctx.arc(x, y, 10, 0, Math.PI * 2);
    sctx.fillStyle = toHex(hsb.h, hsb.s, hsb.b);
    sctx.fill();
    sctx.lineWidth = 3;
    sctx.strokeStyle = '#fff';
    sctx.stroke();
  }

  // pointer handling on the disc (hue ring or inner SB disc), the classic square, and the sliders
  function localPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
  }
  let dragging = null;
  const onDisc = (e) => {
    const p = localPoint(disc, e);
    const c = SIZE / 2, ro = c - 4, ri = ro - 34, r = ri - 10;
    const dx = p.x - c, dy = p.y - c, d = Math.hypot(dx, dy);
    if (!dragging) dragging = d > ri - 4 ? 'hue' : 'sb';
    if (dragging === 'hue') hsb.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    else {
      hsb.s = clamp((p.x - (c - r)) / (r * 2), 0, 1);
      hsb.b = clamp(1 - (p.y - (c - r)) / (r * 2), 0, 1);
    }
    redraw();
    commit();
  };
  const onSquare = (e) => {
    const p = localPoint(sbSq, e);
    hsb.s = clamp(p.x / sbSq.width, 0, 1);
    hsb.b = clamp(1 - p.y / sbSq.height, 0, 1);
    redraw();
    commit();
  };
  for (const [el, fn] of [[disc, onDisc], [sbSq, onSquare]]) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      dragging = null;
      fn(e);
      el._down = true;
    });
    el.addEventListener('pointermove', (e) => el._down && fn(e));
    const up = () => {
      if (!el._down) return;
      el._down = false;
      dragging = null;
      commit(true);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  $('cpHue').addEventListener('input', (e) => {
    hsb.h = Number(e.target.value);
    redraw();
    commit();
  });
  $('cpHue').addEventListener('change', () => commit(true));

  // ------------------------------------------------------------ harmony
  const HARMONIES = {
    complementary: [0, 180], split: [0, 150, 210], analogous: [0, -30, 30], triadic: [0, 120, 240], tetradic: [0, 90, 180, 270],
  };
  const LABEL = { complementary: 'Complementary', split: 'Split', analogous: 'Analogous', triadic: 'Triadic', tetradic: 'Tetradic' };
  const harmonyHues = () => HARMONIES[harmonyMode].map((o) => (hsb.h + o + 360) % 360);
  function drawHarmony() {
    $('cpHarmonyModes').innerHTML = Object.entries(LABEL).map(([k, v]) => `<button data-hm="${k}" class="${k === harmonyMode ? 'on' : ''}">${v}</button>`).join('');
    $('cpHarmonySwatches').innerHTML = harmonyHues().map((h, i) => `<button class="cp-sw ${i === 0 ? 'cur' : ''}" style="background:${toHex(h, hsb.s, hsb.b)}" data-hex="${toHex(h, hsb.s, hsb.b)}" aria-label="Colour ${i + 1}"></button>`).join('');
  }
  $('cpHarmonyModes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hm]');
    if (!b) return;
    harmonyMode = b.dataset.hm;
    persist();
    redraw();
  });
  $('cpHarmonySwatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (!b) return;
    hsb = hexToHsb(b.dataset.hex);
    commit(true);
    redraw();
  });

  // ------------------------------------------------------------ value sliders
  const VALUE_ROWS = [
    ['h', 'Hue', 0, 360, () => hsb.h, (v) => (hsb.h = v), (v) => `${Math.round(v)}°`, () => 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'],
    ['s', 'Saturation', 0, 100, () => hsb.s * 100, (v) => (hsb.s = v / 100), (v) => `${Math.round(v)}%`, () => `linear-gradient(90deg,${toHex(hsb.h, 0, hsb.b)},${toHex(hsb.h, 1, hsb.b)})`],
    ['b', 'Brightness', 0, 100, () => hsb.b * 100, (v) => (hsb.b = v / 100), (v) => `${Math.round(v)}%`, () => `linear-gradient(90deg,#000,${toHex(hsb.h, hsb.s, 1)})`],
    ['r', 'Red', 0, 255, () => hsbToRgb(hsb.h, hsb.s, hsb.b)[0], (v) => setRgb(0, v), (v) => `${Math.round(v)}`, () => { const [, g, b] = hsbToRgb(hsb.h, hsb.s, hsb.b); return `linear-gradient(90deg,rgb(0,${g},${b}),rgb(255,${g},${b}))`; }],
    ['g', 'Green', 0, 255, () => hsbToRgb(hsb.h, hsb.s, hsb.b)[1], (v) => setRgb(1, v), (v) => `${Math.round(v)}`, () => { const [r, , b] = hsbToRgb(hsb.h, hsb.s, hsb.b); return `linear-gradient(90deg,rgb(${r},0,${b}),rgb(${r},255,${b}))`; }],
    ['bl', 'Blue', 0, 255, () => hsbToRgb(hsb.h, hsb.s, hsb.b)[2], (v) => setRgb(2, v), (v) => `${Math.round(v)}`, () => { const [r, g] = hsbToRgb(hsb.h, hsb.s, hsb.b); return `linear-gradient(90deg,rgb(${r},${g},0),rgb(${r},${g},255))`; }],
  ];
  function setRgb(i, v) {
    const rgb = hsbToRgb(hsb.h, hsb.s, hsb.b);
    rgb[i] = v;
    const keepHue = hsb.h;
    hsb = rgbToHsb(...rgb);
    if (hsb.s === 0) hsb.h = keepHue;
  }
  function drawValues() {
    $('cpValues').innerHTML = VALUE_ROWS.map(([k, label, min, max, get, , fmt, track]) => `
      <label class="cp-val"><span>${label}</span><output data-vo="${k}">${fmt(get())}</output>
        <input type="range" data-v="${k}" min="${min}" max="${max}" step="1" value="${Math.round(get())}" style="--track:${track()}"></label>`).join('');
    $('cpHex').value = toHex(hsb.h, hsb.s, hsb.b).toUpperCase();
  }
  $('cpValues').addEventListener('input', (e) => {
    const row = VALUE_ROWS.find((r) => r[0] === e.target.dataset.v);
    if (!row) return;
    row[5](Number(e.target.value));
    commit();
    // Update the other sliders without rebuilding the one being dragged.
    for (const r of VALUE_ROWS) {
      const inp = $('cpValues').querySelector(`[data-v="${r[0]}"]`);
      if (r[0] !== row[0]) inp.value = Math.round(r[4]());
      inp.style.setProperty('--track', r[7]());
      $('cpValues').querySelector(`[data-vo="${r[0]}"]`).textContent = r[6](r[4]());
    }
    $('cpHex').value = toHex(hsb.h, hsb.s, hsb.b).toUpperCase();
  });
  $('cpValues').addEventListener('change', () => commit(true));
  $('cpHex').addEventListener('change', (e) => {
    let v = e.target.value.trim().replace(/^#/, '');
    if (v.length === 3) v = v.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(v)) return toast('Use a six-digit hex colour, like 1E8BFF.');
    hsb = hexToHsb('#' + v.toLowerCase());
    commit(true);
    redraw();
  });

  // ------------------------------------------------------------ palettes
  function drawPalettes() {
    $('cpPalList').innerHTML = palettes.map((p) => `<button class="cp-pal ${p.id === activePalette ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('') + '<button class="cp-pal add" data-p="+" aria-label="New palette">+</button>';
    const p = palettes.find((x) => x.id === activePalette) || palettes[0];
    $('cpPalSwatches').innerHTML = p.colours.map((c, i) => `<button class="cp-sw" style="background:${c}" data-c="${c}" data-i="${i}" aria-label="${c}"></button>`).join('') + '<button class="cp-sw empty" data-add="1" aria-label="Add the current colour">+</button>';
    $('cpPalDelete').classList.toggle('hidden', DEFAULT_PALETTES.some((d) => d.id === p.id));
    paintSwatches();
  }
  $('cpPalList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === '+') {
      const name = prompt('Palette name', 'My palette');
      if (!name) return;
      const p = { id: uid(), name, colours: [] };
      palettes.push(p);
      activePalette = p.id;
    } else activePalette = b.dataset.p;
    persist();
    drawPalettes();
  });
  $('cpPalSwatches').addEventListener('click', (e) => {
    const p = palettes.find((x) => x.id === activePalette);
    if (e.target.closest('[data-add]')) {
      const hex = toHex(hsb.h, hsb.s, hsb.b);
      if (!p.colours.includes(hex)) p.colours.push(hex);
      persist();
      return drawPalettes();
    }
    const sw = e.target.closest('[data-c]');
    if (!sw) return;
    if (palEdit) {
      p.colours.splice(Number(sw.dataset.i), 1);
      persist();
      return drawPalettes();
    }
    hsb = hexToHsb(sw.dataset.c);
    commit(true);
    redraw();
  });
  let palEdit = false;
  $('cpPalEdit').addEventListener('click', () => {
    palEdit = !palEdit;
    $('cpPalEdit').classList.toggle('on', palEdit);
    $('cpPalSwatches').classList.toggle('editing', palEdit);
    $('cpPalEdit').textContent = palEdit ? 'Done' : 'Remove colours';
  });
  $('cpPalDelete').addEventListener('click', () => {
    palettes = palettes.filter((p) => p.id !== activePalette);
    activePalette = palettes[0].id;
    persist();
    drawPalettes();
  });

  // ------------------------------------------------------------ swatches, tabs
  function paintSwatches() {
    const hex = toHex(hsb.h, hsb.s, hsb.b);
    $('cpPrimary').style.background = hex;
    $('cpSecondary').style.background = secondary;
    const pal = palettes.find((x) => x.id === activePalette) || palettes[0];
    $('cpPalName').textContent = pal.name;
    $('cpQuick').innerHTML = pal.colours.map((c) => `<button class="cp-sw small" style="background:${c}" data-hex="${c}" aria-label="${c}"></button>`).join('');
    $('cpHistory').innerHTML = history.map((c) => `<button class="cp-sw small" style="background:${c}" data-hex="${c}" aria-label="${c}"></button>`).join('');
  }
  for (const id of ['cpHistory', 'cpQuick']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('[data-hex]');
      if (!b) return;
      hsb = hexToHsb(b.dataset.hex);
      commit(true);
      redraw();
    });
  }
  $('cpHistClear').addEventListener('click', () => {
    history = [];
    persist();
    paintSwatches();
  });
  $('cpSecondary').addEventListener('click', () => {
    const cur = toHex(hsb.h, hsb.s, hsb.b);
    hsb = hexToHsb(secondary);
    secondary = cur;
    persist();
    commit(true);
    redraw();
  });
  $('cpTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    try { localStorage.setItem('promove.colourTab', tab); } catch {}
    redraw();
  });

  function redraw() {
    for (const b of $('cpTabs').querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const v of panel.querySelectorAll('[data-view]')) v.classList.toggle('hidden', v.dataset.view !== tab && !(tab === 'harmony' && v.dataset.view === 'disc'));
    $('cpHueRow').classList.toggle('hidden', tab !== 'classic');
    $('cpHarmony').classList.toggle('hidden', tab !== 'harmony');
    $('cpUnder').classList.toggle('hidden', tab === 'palettes');
    if (tab === 'disc' || tab === 'harmony') drawDisc(tab === 'harmony');
    if (tab === 'classic') drawSquare();
    if (tab === 'harmony') drawHarmony();
    if (tab === 'value') drawValues();
    if (tab === 'palettes') drawPalettes();
    $('cpHue').value = hsb.h;
    paintSwatches();
  }

  try { tab = localStorage.getItem('promove.colourTab') || 'disc'; } catch {}
  return {
    // Called whenever the panel opens, and when the colour was changed from outside (eyedropper).
    sync() {
      hsb = hexToHsb(getColour());
      redraw();
    },
    // The person put the colour down on the canvas: remember it.
    used() {
      const hex = getColour();
      history = [hex, ...history.filter((c) => c !== hex)].slice(0, 12);
      persist();
    },
    pickedExternally(hex) {
      hsb = hexToHsb(hex);
      history = [hex, ...history.filter((c) => c !== hex)].slice(0, 12);
      persist();
    },
  };
}
