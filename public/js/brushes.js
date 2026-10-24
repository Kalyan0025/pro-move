// Brushes: the sets and brushes in the library, and the tip pictures the painter stamps.
//
// A brush is a handful of numbers:
//   size, opacity   what the sidebar sliders start at for this brush
//   hardness        0 soft edge .. 1 hard edge
//   spacing         gap between stamps, as a fraction of the brush size
//   flow            how much paint each stamp lays down (soft build-up when low)
//   grain           0 smooth .. 1 rough, dry-media texture
//   scatter         how far stamps are thrown off the line, as a fraction of the size
//   aspect, angle   flat brushes: height / width of the tip, and its tilt in degrees
//   pressureSize    0..1 how much a lighter press shrinks the line
//   pressureOpacity 0..1 how much a lighter press fades it
//   smoothing       0..1 stabilisation of the line
import { uid } from './store.js';

export const DEFAULT_SETS = [
  { id: 'sketching', name: 'Sketching', brushes: [
    { id: 'hb', name: 'HB Pencil', size: 6, opacity: 0.85, hardness: 0.85, spacing: 0.08, flow: 0.85, grain: 0.55, scatter: 0.02, pressureSize: 0.4, pressureOpacity: 0.7, smoothing: 0.1 },
    { id: '6b', name: '6B Pencil', size: 14, opacity: 0.9, hardness: 0.55, spacing: 0.07, flow: 0.8, grain: 0.7, scatter: 0.03, pressureSize: 0.6, pressureOpacity: 0.8, smoothing: 0.1 },
    { id: 'charcoal', name: 'Charcoal Stick', size: 26, opacity: 0.9, hardness: 0.35, spacing: 0.1, flow: 0.7, grain: 0.95, scatter: 0.12, pressureSize: 0.5, pressureOpacity: 0.9, smoothing: 0.05 },
  ] },
  { id: 'inking', name: 'Inking', brushes: [
    { id: 'tech', name: 'Technical Pen', size: 4, opacity: 1, hardness: 1, spacing: 0.04, flow: 1, grain: 0, scatter: 0, pressureSize: 0, pressureOpacity: 0, smoothing: 0.35 },
    { id: 'studio', name: 'Studio Pen', size: 10, opacity: 1, hardness: 0.95, spacing: 0.04, flow: 1, grain: 0, scatter: 0, pressureSize: 0.85, pressureOpacity: 0, smoothing: 0.4 },
    { id: 'dryink', name: 'Dry Ink', size: 12, opacity: 1, hardness: 0.9, spacing: 0.06, flow: 0.95, grain: 0.5, scatter: 0.04, pressureSize: 0.7, pressureOpacity: 0.3, smoothing: 0.3 },
  ] },
  { id: 'painting', name: 'Painting', brushes: [
    { id: 'round', name: 'Round Brush', size: 30, opacity: 1, hardness: 0.7, spacing: 0.06, flow: 1, grain: 0, scatter: 0, pressureSize: 0.5, pressureOpacity: 0.2, smoothing: 0.25 },
    { id: 'flat', name: 'Flat Brush', size: 40, opacity: 1, hardness: 0.9, spacing: 0.05, flow: 1, grain: 0.15, scatter: 0, aspect: 0.35, angle: -35, pressureSize: 0.35, pressureOpacity: 0.1, smoothing: 0.2 },
    { id: 'oil', name: 'Oil Paint', size: 48, opacity: 1, hardness: 0.8, spacing: 0.05, flow: 0.95, grain: 0.35, scatter: 0.02, aspect: 0.6, angle: 20, pressureSize: 0.4, pressureOpacity: 0.2, smoothing: 0.3 },
    { id: 'gouache', name: 'Gouache', size: 36, opacity: 1, hardness: 0.95, spacing: 0.04, flow: 1, grain: 0.1, scatter: 0, pressureSize: 0.3, pressureOpacity: 0, smoothing: 0.3 },
  ] },
  { id: 'airbrush', name: 'Airbrushing', brushes: [
    { id: 'soft', name: 'Soft Brush', size: 60, opacity: 0.6, hardness: 0, spacing: 0.08, flow: 0.45, grain: 0, scatter: 0, pressureSize: 0.2, pressureOpacity: 0.6, smoothing: 0.2 },
    { id: 'hardair', name: 'Hard Airbrush', size: 50, opacity: 0.7, hardness: 0.5, spacing: 0.07, flow: 0.5, grain: 0, scatter: 0, pressureSize: 0.2, pressureOpacity: 0.5, smoothing: 0.2 },
    { id: 'spray', name: 'Spray', size: 70, opacity: 1, hardness: 0.1, spacing: 0.12, flow: 0.35, grain: 0.9, scatter: 0.45, pressureSize: 0.1, pressureOpacity: 0.4, smoothing: 0.1 },
  ] },
  { id: 'drawing', name: 'Drawing', brushes: [
    { id: 'marker', name: 'Marker', size: 22, opacity: 0.9, hardness: 0.95, spacing: 0.04, flow: 1, grain: 0.05, scatter: 0, aspect: 0.6, angle: -25, pressureSize: 0.1, pressureOpacity: 0, smoothing: 0.3 },
    { id: 'felt', name: 'Felt Tip', size: 14, opacity: 1, hardness: 0.85, spacing: 0.05, flow: 0.95, grain: 0.12, scatter: 0, pressureSize: 0.25, pressureOpacity: 0, smoothing: 0.25 },
    { id: 'highlighter', name: 'Highlighter', size: 34, opacity: 0.5, hardness: 0.95, spacing: 0.04, flow: 1, grain: 0, scatter: 0, aspect: 0.4, angle: -20, pressureSize: 0, pressureOpacity: 0, smoothing: 0.3 },
  ] },
  { id: 'calligraphy', name: 'Calligraphy', brushes: [
    { id: 'mono', name: 'Monoline', size: 8, opacity: 1, hardness: 1, spacing: 0.03, flow: 1, grain: 0, scatter: 0, pressureSize: 0, pressureOpacity: 0, smoothing: 0.55 },
    { id: 'brushpen', name: 'Brush Pen', size: 20, opacity: 1, hardness: 0.9, spacing: 0.035, flow: 1, grain: 0, scatter: 0, pressureSize: 1, pressureOpacity: 0, smoothing: 0.5 },
    { id: 'nib', name: 'Pointed Nib', size: 12, opacity: 1, hardness: 1, spacing: 0.03, flow: 1, grain: 0, scatter: 0, aspect: 0.3, angle: -40, pressureSize: 0.5, pressureOpacity: 0, smoothing: 0.5 },
  ] },
  { id: 'artistic', name: 'Artistic', brushes: [
    { id: 'watercolour', name: 'Watercolour', size: 54, opacity: 0.55, hardness: 0.2, spacing: 0.1, flow: 0.28, grain: 0.35, scatter: 0.05, pressureSize: 0.3, pressureOpacity: 0.7, smoothing: 0.3 },
    { id: 'chalk', name: 'Chalk', size: 34, opacity: 0.95, hardness: 0.6, spacing: 0.1, flow: 0.75, grain: 1, scatter: 0.08, pressureSize: 0.4, pressureOpacity: 0.5, smoothing: 0.05 },
    { id: 'stipple', name: 'Stipple', size: 40, opacity: 1, hardness: 1, spacing: 0.9, flow: 1, grain: 0, scatter: 0.5, pressureSize: 0.3, pressureOpacity: 0, smoothing: 0 },
  ] },
];

const KEY = 'promove.brushes';

// Library state: the sets (including the person's own), the brush each tool uses, and what
// size and opacity each brush was last used at. All of it is kept in this browser.
export function createLibrary() {
  let custom = { sets: [], overrides: {}, used: {}, tools: { brush: 'round', smudge: 'soft', eraser: 'hardair' } };
  try {
    custom = { ...custom, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {}
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch {}
  };
  const sets = () => [...DEFAULT_SETS.map((s) => ({ ...s, brushes: s.brushes.map((b) => ({ ...b, ...(custom.overrides[b.id] || {}) })) })), ...custom.sets];
  const find = (id) => {
    for (const s of sets()) for (const b of s.brushes) if (b.id === id) return { ...b, set: s.id };
    return null;
  };
  return {
    sets,
    find,
    toolBrush: (tool) => find(custom.tools[tool]) || find('round'),
    selectFor(tool, id) {
      custom.tools[tool] = id;
      save();
    },
    used: (id) => custom.used[id] || null,
    remember(id, size, opacity) {
      custom.used[id] = { size, opacity };
      save();
    },
    // Brush Studio edits: a built-in brush keeps its own tweaks; a custom brush is changed in place.
    update(id, patch) {
      const own = custom.sets.flatMap((s) => s.brushes).find((b) => b.id === id);
      if (own) Object.assign(own, patch);
      else custom.overrides[id] = { ...(custom.overrides[id] || {}), ...patch };
      save();
    },
    reset(id) {
      delete custom.overrides[id];
      save();
    },
    isCustom: (id) => custom.sets.some((s) => s.brushes.some((b) => b.id === id)),
    isEdited: (id) => !!custom.overrides[id],
    duplicate(id) {
      const b = find(id);
      if (!b) return null;
      let set = custom.sets.find((s) => s.id === 'mine');
      if (!set) custom.sets.unshift((set = { id: 'mine', name: 'My brushes', brushes: [] }));
      const { set: _s, ...rest } = b;
      const copy = { ...rest, id: uid(), name: `${b.name} copy` };
      set.brushes.push(copy);
      save();
      return copy;
    },
    remove(id) {
      for (const s of custom.sets) s.brushes = s.brushes.filter((b) => b.id !== id);
      custom.sets = custom.sets.filter((s) => s.brushes.length);
      for (const t of Object.keys(custom.tools)) if (custom.tools[t] === id) custom.tools[t] = 'round';
      save();
    },
    rename(id, name) {
      const own = custom.sets.flatMap((s) => s.brushes).find((b) => b.id === id);
      if (own) own.name = name;
      else custom.overrides[id] = { ...(custom.overrides[id] || {}), name };
      save();
    },
  };
}

// ---------------------------------------------------------------- tips
// A soft round (or flat) dab, in one colour, drawn once and stamped many times.
const cache = new Map();
const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

export function tip(brush, diameter, color) {
  const d = Math.max(2, Math.round(diameter));
  const key = `${d}|${brush.hardness}|${brush.grain}|${brush.aspect || 1}|${color}`;
  let c = cache.get(key);
  if (c) return c;
  const h = brush.aspect && brush.aspect < 1 ? Math.max(2, Math.round(d * brush.aspect)) : d;
  c = document.createElement('canvas');
  c.width = d;
  c.height = h;
  const g = c.getContext('2d');
  const [r, gr, b] = hex(color);
  const hard = Math.max(0, Math.min(1, brush.hardness));
  if (brush.aspect && brush.aspect < 1) {
    // Flat tip: a rounded bar.
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.beginPath();
    g.ellipse(d / 2, h / 2, d / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    const grad = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
    grad.addColorStop(0, `rgba(${r},${gr},${b},1)`);
    grad.addColorStop(Math.max(0.001, hard * 0.98), `rgba(${r},${gr},${b},1)`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, d, d);
  }
  if (brush.grain > 0) {
    // Dry-media texture: knock random specks out of the dab.
    const im = g.getImageData(0, 0, d, h);
    for (let i = 3; i < im.data.length; i += 4) {
      if (!im.data[i]) continue;
      im.data[i] *= 1 - brush.grain * 0.85 * Math.pow(rnd(), 0.7);
    }
    g.putImageData(im, 0, 0);
  }
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}

// Stamp one dab: centre (x, y), diameter in pixels, alpha 0..1.
export function stamp(ctx, brush, x, y, diameter, alpha, color, angleRad = 0) {
  const t = tip(brush, diameter, color);
  ctx.globalAlpha = alpha;
  const rot = angleRad + ((brush.angle || 0) * Math.PI) / 180 + (brush.grain > 0.2 && !brush.aspect ? rnd() * 6.283 : 0);
  if (!rot) {
    ctx.drawImage(t, x - t.width / 2, y - t.height / 2);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(t, -t.width / 2, -t.height / 2);
    ctx.restore();
  }
}

// A sample stroke (a gentle S) drawn with a brush, for the library list and Brush Studio.
export function previewStroke(canvas, brush, color = '#000000', sizeHint = null) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const lg = layer.getContext('2d');
  // The preview scales the brush to fit the picture, so thin and fat brushes both read.
  const base = sizeHint ?? Math.min(H * 0.55, Math.max(3, brush.size * (H / 60) * 0.7));
  const steps = 260;
  let carry = 0;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = W * 0.08 + u * W * 0.84;
    const y = H / 2 + Math.sin(u * Math.PI * 2) * H * 0.22;
    const press = 0.25 + 0.75 * Math.sin(u * Math.PI);
    const sizeK = 1 - (brush.pressureSize || 0) * (1 - press);
    const alphaK = 1 - (brush.pressureOpacity || 0) * (1 - press);
    const dia = Math.max(1.2, base * sizeK);
    if (prev) {
      const dist = Math.hypot(x - prev.x, y - prev.y);
      carry += dist;
      const spacing = Math.max(0.8, dia * (brush.spacing || 0.06));
      while (carry >= spacing) {
        carry -= spacing;
        const jx = brush.scatter ? (Math.random() - 0.5) * 2 * brush.scatter * dia : 0;
        const jy = brush.scatter ? (Math.random() - 0.5) * 2 * brush.scatter * dia : 0;
        stamp(lg, brush, x + jx, y + jy, dia, (brush.flow ?? 1) * alphaK, color);
      }
    }
    prev = { x, y };
  }
  lg.globalAlpha = 1;
  g.globalAlpha = Math.max(0.35, brush.opacity ?? 1);
  g.drawImage(layer, 0, 0);
  g.globalAlpha = 1;
}
