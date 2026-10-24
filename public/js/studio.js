// The document behind the canvas: an artwork with layers, like Procreate's.
//
// A document is a list of layers from bottom to top. Most are paint layers (a canvas each). One
// is the Motion Rig layer: the live character, drawn by the rig on the stage canvas, which sits
// in the stack where its row sits. Groups are a header entry followed by its children.
//
// This module owns: the layers and their screen layout (position, order, opacity, blend, mask),
// undo and redo for everything that changes the picture, flattening for sharing and thumbnails,
// and saving to the browser. It knows nothing about brushes, tools or panels.
import { store, uid, canvasToBlob, blobToCanvas } from './store.js';

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal', css: 'normal', op: 'source-over' },
  { id: 'multiply', label: 'Multiply', css: 'multiply', op: 'multiply' },
  { id: 'screen', label: 'Screen', css: 'screen', op: 'screen' },
  { id: 'overlay', label: 'Overlay', css: 'overlay', op: 'overlay' },
  { id: 'darken', label: 'Darken', css: 'darken', op: 'darken' },
  { id: 'lighten', label: 'Lighten', css: 'lighten', op: 'lighten' },
  { id: 'color-dodge', label: 'Colour Dodge', css: 'color-dodge', op: 'color-dodge' },
  { id: 'color-burn', label: 'Colour Burn', css: 'color-burn', op: 'color-burn' },
  { id: 'soft-light', label: 'Soft Light', css: 'soft-light', op: 'soft-light' },
  { id: 'hard-light', label: 'Hard Light', css: 'hard-light', op: 'hard-light' },
  { id: 'difference', label: 'Difference', css: 'difference', op: 'difference' },
  { id: 'exclusion', label: 'Exclusion', css: 'exclusion', op: 'exclusion' },
  { id: 'hue', label: 'Hue', css: 'hue', op: 'hue' },
  { id: 'saturation', label: 'Saturation', css: 'saturation', op: 'saturation' },
  { id: 'color', label: 'Colour', css: 'color', op: 'color' },
  { id: 'luminosity', label: 'Luminosity', css: 'luminosity', op: 'luminosity' },
  { id: 'add', label: 'Add', css: 'plus-lighter', op: 'lighter' },
];
const BLEND = Object.fromEntries(BLEND_MODES.map((b) => [b.id, b]));

export const PRESETS = [
  { id: 'screen', name: 'Screen size', w: 0, h: 0, dpi: 132, note: 'Fits this screen' },
  { id: 'square', name: 'Square', w: 2048, h: 2048, dpi: 132 },
  { id: 'a4', name: 'A4', w: 2480, h: 3508, dpi: 300 },
  { id: 'a5', name: 'A5', w: 1748, h: 2480, dpi: 300 },
  { id: 'hd', name: '4K', w: 3840, h: 2160, dpi: 132 },
  { id: 'fhd', name: 'Full HD', w: 1920, h: 1080, dpi: 132 },
  { id: 'story', name: 'Story', w: 1080, h: 1920, dpi: 132 },
  { id: 'comic', name: 'Comic page', w: 1988, h: 3056, dpi: 300 },
];

const MAX_HISTORY = 40;
const MAX_HISTORY_BYTES = 260 * 1024 * 1024;

export function createStudio({ workspace, stroke, stage, bgLayer, toast, bgImage = () => null, isRigVisible = () => true }) {
  const listeners = {};
  const on = (evt, fn) => ((listeners[evt] ||= []).push(fn), fn);
  const emit = (evt, ...a) => (listeners[evt] || []).forEach((fn) => fn(...a));

  let doc = null;
  const sel = { canvas: null }; // the selection mask (select.js), same size as the document
  const overlays = []; // tool pictures drawn over the artwork (selection, transform): { el, z }
  const view = { s: 1, x: 0, y: 0 }; // zoom and pan of the whole canvas, in iPad points
  let animView = null; // while animating drawn frames: { show: Map(layerId → {alpha, tint}) }
  const history = { undo: [], redo: [], bytes: 0 };

  // Paper behind the layers: the artwork's background colour.
  const paperBg = document.createElement('div');
  paperBg.className = 'paper-bg';
  workspace.prepend(paperBg);

  // ---------------------------------------------------------------- layers
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.className = 'layer-canvas';
    return c;
  }
  function makeLayer(props = {}) {
    const type = props.type || 'paint';
    const layer = {
      id: props.id || uid(), name: props.name || 'Layer', type,
      visible: props.visible !== false, opacity: props.opacity ?? 1, blend: props.blend || 'normal',
      alphaLock: !!props.alphaLock, locked: !!props.locked, parent: props.parent || null, expanded: props.expanded !== false,
      hold: props.hold || 0, mask: null, editMask: false, maskUrl: null,
    };
    if (type === 'paint') {
      layer.canvas = props.canvas || makeCanvas(doc.width, doc.height);
      layer.canvas.classList.add('layer-canvas');
      layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
      workspace.append(layer.canvas);
    }
    return layer;
  }
  const byId = (id) => doc?.layers.find((l) => l.id === id) || null;
  const paintLayers = () => doc.layers.filter((l) => l.type === 'paint');
  const groupOf = (l) => (l.parent ? byId(l.parent) : null);
  const effVisible = (l) => l.visible && (!groupOf(l) || groupOf(l).visible);
  const effOpacity = (l) => l.opacity * (groupOf(l)?.opacity ?? 1);
  const unique = (base) => {
    if (base === 'Layer') {
      const n = Math.max(0, ...doc.layers.map((l) => Number(/^Layer (\d+)$/.exec(l.name)?.[1] || 0)));
      return `Layer ${n + 1}`;
    }
    const names = new Set(doc.layers.map((l) => l.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };

  // ---------------------------------------------------------------- layout on screen
  // Where the artwork sits in the workspace, in workspace points. A screen-sized artwork fills it.
  function paper() {
    const W = workspace.offsetWidth, H = workspace.offsetHeight;
    if (!doc || doc.screen) return { x: 0, y: 0, w: W, h: H, k: 1 };
    const m = 30;
    const k = Math.min((W - m * 2) / doc.width, (H - m * 2) / doc.height);
    const w = doc.width * k, h = doc.height * k;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, k };
  }
  const place = (el, p) => {
    Object.assign(el.style, { inset: 'auto', left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
    zoomed(el, p.x, p.y);
  };
  // Zoom and pan: every picture of the canvas gets the same transform, about the workspace's corner.
  function zoomed(el, left, top) {
    if (view.s === 1 && !view.x && !view.y) {
      el.style.transform = '';
      el.style.transformOrigin = '';
    } else {
      el.style.transformOrigin = `${-left}px ${-top}px`;
      el.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    }
  }

  function layout() {
    if (!doc) return;
    const p = paper();
    place(paperBg, p);
    paperBg.style.background = doc.bg.transparent ? 'repeating-conic-gradient(#d8d8dc 0 25%, #fff 0 50%) 0 0 / 16px 16px' : doc.bg.color;
    paperBg.style.boxShadow = doc.screen ? 'none' : '0 6px 30px rgba(0,0,0,.35)';
    workspace.style.background = doc.screen && view.s === 1 && !view.x && !view.y ? '' : '#2b2b2e';
    place(bgLayer, p);
    bgLayer.style.visibility = doc.bg.image && doc.bg.imageVisible ? '' : 'hidden';
    let z = 10, activeZ = 10;
    for (const l of doc.layers) {
      z += 10;
      if (l.id === doc.activeId) activeZ = z;
      if (l.type === 'rig') {
        stage.style.zIndex = String(z);
        zoomed(stage, 0, 0);
        stage.style.clipPath = doc.screen ? '' : `inset(${p.y}px ${workspace.offsetWidth - p.x - p.w}px ${workspace.offsetHeight - p.y - p.h}px ${p.x}px)`;
        continue;
      }
      if (l.type !== 'paint') continue;
      place(l.canvas, p);
      Object.assign(l.canvas.style, {
        zIndex: String(z), visibility: effVisible(l) ? '' : 'hidden', opacity: String(effOpacity(l)),
        mixBlendMode: BLEND[l.blend]?.css || 'normal', pointerEvents: 'none', filter: '',
      });
      if (animView) {
        // Animating: only the frame being shown (and its onion skins) are visible.
        const a = animView.show.get(l.id);
        l.canvas.style.visibility = a ? '' : 'hidden';
        l.canvas.style.opacity = a ? String(a.alpha * effOpacity(l)) : '0';
        l.canvas.style.filter = a?.tint || '';
      }
      const m = l.mask && l.maskUrl ? `url(${l.maskUrl})` : '';
      l.canvas.style.webkitMaskImage = l.canvas.style.maskImage = m;
      l.canvas.style.webkitMaskSize = l.canvas.style.maskSize = '100% 100%';
    }
    place(stroke, p);
    stroke.style.zIndex = String(activeZ + 5);
    for (const o of overlays) {
      place(o.el, p);
      o.el.style.zIndex = String(o.z);
    }
    emit('layout', p);
  }
  // The mask picture the screen shows is refreshed when a mask changes.
  let maskTimer = 0;
  function maskChanged(layer) {
    clearTimeout(maskTimer);
    maskTimer = setTimeout(() => {
      layer.maskUrl = layer.mask ? layer.mask.toDataURL('image/png') : null;
      layout();
    }, 120);
  }

  // ---------------------------------------------------------------- history
  function pushHistory(entry) {
    history.undo.push(entry);
    history.bytes += entry.cost || 0;
    for (const e of history.redo) history.bytes -= e.cost || 0;
    history.redo = [];
    while (history.undo.length > MAX_HISTORY || (history.bytes > MAX_HISTORY_BYTES && history.undo.length > 1)) {
      history.bytes -= history.undo.shift().cost || 0;
    }
    touch();
    emit('history');
  }
  // An edit to part of one canvas: remembers the pixels as they were, and as they became when undone.
  function rectEntry(label, canvas, rect, before) {
    const ctx = canvas.getContext('2d');
    let after = null;
    return {
      label, cost: rect.w * rect.h * 8,
      undo() {
        after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
        ctx.putImageData(before, rect.x, rect.y);
        afterPixels(canvas);
      },
      redo() {
        ctx.putImageData(after, rect.x, rect.y);
        afterPixels(canvas);
      },
    };
  }
  const forget = (l) => {
    if (l) l._blob = l._maskBlob = null;
    else for (const x of doc?.layers || []) x._blob = x._maskBlob = null;
  };
  on('pixels', forget);
  const afterPixels = (canvas) => {
    const l = doc.layers.find((x) => x.canvas === canvas || x.mask === canvas);
    if (l?.mask === canvas) maskChanged(l);
    emit('pixels', l);
  };
  function undo() {
    const e = history.undo.pop();
    if (!e) return false;
    history.bytes -= e.cost || 0;
    e.undo();
    history.redo.push(e);
    touch(false);
    emit('history');
    return true;
  }
  function redo() {
    const e = history.redo.pop();
    if (!e) return false;
    e.redo();
    history.undo.push(e);
    history.bytes += e.cost || 0;
    touch(false);
    emit('history');
    return true;
  }
  // A whole-layer edit (adjustments, transform, fill, clear): pass the canvas pixels from before.
  function commitWhole(label, layerOrCanvas, beforeData) {
    const canvas = layerOrCanvas.canvas || layerOrCanvas;
    pushHistory(rectEntry(label, canvas, { x: 0, y: 0, w: canvas.width, h: canvas.height }, beforeData));
    afterPixels(canvas);
  }
  const grab = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

  // A change to the layer list (add, delete, move, group, merge): the order before and after.
  function structureEntry(label, fn) {
    const before = { layers: [...doc.layers], active: doc.activeId };
    const props = new Map(before.layers.map((l) => [l, { name: l.name, parent: l.parent, expanded: l.expanded }]));
    const result = fn();
    const after = { layers: [...doc.layers], active: doc.activeId };
    const afterProps = new Map(after.layers.map((l) => [l, { name: l.name, parent: l.parent, expanded: l.expanded }]));
    const apply = (state, pm) => {
      doc.layers = [...state.layers];
      doc.activeId = state.active;
      for (const l of doc.layers) if (pm.has(l)) Object.assign(l, pm.get(l));
      for (const l of [...before.layers, ...after.layers]) {
        if (l.canvas) l.canvas.style.display = doc.layers.includes(l) ? '' : 'none';
      }
      layout();
      emit('layers');
    };
    pushHistory({
      label, cost: 64,
      undo: () => apply(before, props),
      redo: () => apply(after, afterProps),
    });
    layout();
    emit('layers');
    return result;
  }
  // A change to a layer's settings (opacity, blend, visibility, lock...).
  function propEntry(label, layer, patch) {
    const old = {};
    for (const k of Object.keys(patch)) old[k] = layer[k];
    pushHistory({
      label, cost: 16,
      undo: () => { Object.assign(layer, old); layout(); emit('layers'); },
      redo: () => { Object.assign(layer, patch); layout(); emit('layers'); },
    });
  }

  // ---------------------------------------------------------------- layer actions
  function setActive(id) {
    if (!byId(id) || doc.activeId === id) return;
    doc.activeId = id;
    layout();
    emit('active');
    emit('layers');
  }
  function insertIndexAboveActive() {
    const a = byId(doc.activeId);
    if (!a) return { index: doc.layers.length, parent: null };
    let i = doc.layers.indexOf(a);
    if (a.type === 'group') {
      // New layers go on top of a group's children.
      while (doc.layers[i + 1]?.parent === a.id) i++;
      return { index: i + 1, parent: a.id };
    }
    return { index: i + 1, parent: a.parent };
  }
  function addLayer(name) {
    return structureEntry('Add layer', () => {
      const { index, parent } = insertIndexAboveActive();
      const l = makeLayer({ name: name || unique('Layer'), parent });
      doc.layers.splice(index, 0, l);
      doc.activeId = l.id;
      return l;
    });
  }
  function addLayerWith(canvas, name) {
    const l = addLayer(name);
    l.ctx.drawImage(canvas, 0, 0);
    emit('pixels', l);
    return l;
  }
  function deleteLayer(id) {
    const l = byId(id);
    if (!l || l.type === 'rig') return toast('The Motion Rig layer can not be deleted. Hide it instead.');
    if (paintLayers().length <= 1 && l.type === 'paint') return toast('An artwork needs at least one layer.');
    structureEntry('Delete layer', () => {
      const i = doc.layers.indexOf(l);
      const gone = l.type === 'group' ? doc.layers.filter((x) => x === l || x.parent === l.id) : [l];
      doc.layers = doc.layers.filter((x) => !gone.includes(x));
      for (const g of gone) if (g.canvas) g.canvas.style.display = 'none';
      const next = doc.layers[Math.min(i, doc.layers.length - 1)] || doc.layers[0];
      doc.activeId = (doc.layers[i - 1] || next).id;
    });
  }
  function duplicateLayer(id) {
    const l = byId(id);
    if (!l || l.type === 'rig') return;
    return structureEntry('Duplicate layer', () => {
      const copies = [];
      const src = l.type === 'group' ? doc.layers.filter((x) => x === l || x.parent === l.id) : [l];
      const idMap = new Map();
      for (const s of src) {
        const c = makeLayer({ ...s, id: undefined, name: s.type === 'group' ? `${s.name} copy` : `${s.name} copy`, canvas: s.canvas ? makeCanvas(s.canvas.width, s.canvas.height) : null, parent: s.parent });
        if (s.canvas) c.ctx.drawImage(s.canvas, 0, 0);
        if (s.mask) {
          c.mask = makeCanvas(s.mask.width, s.mask.height);
          c.mask.getContext('2d').drawImage(s.mask, 0, 0);
          c.maskUrl = s.maskUrl;
        }
        idMap.set(s.id, c);
        copies.push(c);
      }
      for (const c of copies) if (c.parent && idMap.has(c.parent)) c.parent = idMap.get(c.parent).id;
      const last = src[src.length - 1];
      doc.layers.splice(doc.layers.indexOf(last) + 1, 0, ...copies);
      doc.activeId = copies[0].id;
      return copies[0];
    });
  }
  function renameLayer(id, name) {
    const l = byId(id);
    if (!l || !name.trim()) return;
    propEntry('Rename layer', l, { name: name.trim() });
    l.name = name.trim();
    emit('layers');
  }
  // Move a layer (or group) so it sits at `toIndex` in the list, inside `parent` (or at top level).
  function moveLayer(id, toIndex, parent = null) {
    const l = byId(id);
    if (!l) return;
    structureEntry('Move layer', () => {
      const moving = l.type === 'group' ? doc.layers.filter((x) => x === l || x.parent === l.id) : [l];
      const rest = doc.layers.filter((x) => !moving.includes(x));
      const at = Math.max(0, Math.min(rest.length, toIndex));
      rest.splice(at, 0, ...moving);
      doc.layers = rest;
      if (l.type !== 'group') l.parent = parent;
    });
  }
  const move = (id, dir) => {
    const l = byId(id);
    if (!l) return;
    const list = doc.layers.filter((x) => x.parent === l.parent && x.type !== undefined);
    const top = list.indexOf(l) + dir;
    if (top < 0 || top >= list.length) return;
    const target = list[top];
    const targetBlock = target.type === 'group' ? doc.layers.filter((x) => x === target || x.parent === target.id) : [target];
    const dest = dir > 0 ? doc.layers.indexOf(targetBlock[targetBlock.length - 1]) + 1 : doc.layers.indexOf(target);
    const moving = l.type === 'group' ? doc.layers.filter((x) => x === l || x.parent === l.id) : [l];
    const before = doc.layers.slice(0, dest).filter((x) => !moving.includes(x)).length;
    moveLayer(id, before, l.parent);
  };
  function groupLayer(id) {
    const l = byId(id);
    if (!l || l.type === 'group') return;
    structureEntry('Group', () => {
      const g = makeLayer({ type: 'group', name: unique('Group'), parent: l.parent });
      const i = doc.layers.indexOf(l);
      doc.layers.splice(i, 0, g);
      l.parent = g.id;
      doc.activeId = g.id;
    });
  }
  function ungroup(id) {
    const g = byId(id);
    if (!g || g.type !== 'group') return;
    structureEntry('Ungroup', () => {
      for (const c of doc.layers) if (c.parent === g.id) c.parent = g.parent;
      doc.layers = doc.layers.filter((x) => x !== g);
      doc.activeId = (doc.layers.find((x) => x.type === 'paint') || doc.layers[0]).id;
    });
  }
  function toggleGroup(id) {
    const g = byId(id);
    if (g?.type === 'group') {
      g.expanded = !g.expanded;
      emit('layers');
    }
  }
  // Draw one layer into a context with its own opacity, blend and mask (used for merging and export).
  function drawLayer(ctx, l, scale = 1, { ignoreVisible = false } = {}) {
    if (!l.canvas || (!ignoreVisible && !effVisible(l))) return;
    ctx.save();
    ctx.globalAlpha = effOpacity(l);
    ctx.globalCompositeOperation = BLEND[l.blend]?.op || 'source-over';
    let src = l.canvas;
    if (l.mask) {
      const t = makeCanvas(l.canvas.width, l.canvas.height);
      const g = t.getContext('2d');
      g.drawImage(l.canvas, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(l.mask, 0, 0);
      src = t;
    }
    ctx.drawImage(src, 0, 0, src.width * scale, src.height * scale);
    ctx.restore();
  }
  function mergeDown(id) {
    const top = byId(id);
    if (!top || top.type !== 'paint') return;
    const i = doc.layers.indexOf(top);
    const below = [...doc.layers.slice(0, i)].reverse().find((l) => l.type === 'paint' && l.parent === top.parent);
    if (!below) return toast('There is no layer below to merge into.');
    const beforeBelow = grab(below.canvas);
    structureEntry('Merge down', () => {
      drawLayer(below.ctx, top, 1, { ignoreVisible: true });
      doc.layers = doc.layers.filter((x) => x !== top);
      top.canvas.style.display = 'none';
      doc.activeId = below.id;
    });
    // The merge also changed the layer below: undo must put its pixels back.
    const merged = history.undo.pop();
    const pix = rectEntry('Merge down pixels', below.canvas, { x: 0, y: 0, w: below.canvas.width, h: below.canvas.height }, beforeBelow);
    history.undo.push({
      label: 'Merge down', cost: merged.cost + pix.cost,
      undo: () => { merged.undo(); pix.undo(); },
      redo: () => { pix.redo(); merged.redo(); },
    });
    emit('pixels', below);
  }
  function flattenVisible() {
    const paints = paintLayers();
    if (paints.length < 2) return;
    const first = paints[0];
    const before = grab(first.canvas);
    const out = makeCanvas(first.canvas.width, first.canvas.height);
    const g = out.getContext('2d');
    for (const l of paints) drawLayer(g, l);
    structureEntry('Flatten', () => {
      first.ctx.clearRect(0, 0, out.width, out.height);
      first.ctx.drawImage(out, 0, 0);
      first.opacity = 1;
      first.blend = 'normal';
      first.visible = true;
      first.mask = null;
      first.maskUrl = null;
      for (const l of paints.slice(1)) l.canvas.style.display = 'none';
      doc.layers = doc.layers.filter((x) => x === first || x.type === 'rig');
      first.parent = null;
      doc.activeId = first.id;
    });
    const flat = history.undo.pop();
    const pix = rectEntry('Flatten pixels', first.canvas, { x: 0, y: 0, w: out.width, h: out.height }, before);
    history.undo.push({ label: 'Flatten', cost: flat.cost + pix.cost, undo: () => { flat.undo(); pix.undo(); }, redo: () => { pix.redo(); flat.redo(); } });
    emit('pixels', first);
  }
  function setLayerProp(id, patch, { record = true } = {}) {
    const l = byId(id);
    if (!l) return;
    if (record) propEntry('Layer setting', l, patch);
    Object.assign(l, patch);
    layout();
    emit('layers');
    touch(false);
  }
  function clearLayer(id) {
    const l = byId(id);
    if (!l?.canvas) return;
    commitWhole('Clear layer', l, grab(l.canvas));
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    emit('pixels', l);
  }
  function addMask(id) {
    const l = byId(id);
    if (!l?.canvas || l.mask) return;
    const m = makeCanvas(l.canvas.width, l.canvas.height);
    m.classList.remove('layer-canvas');
    const g = m.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, m.width, m.height);
    propEntry('Add mask', l, { mask: m, maskUrl: m.toDataURL(), editMask: true });
    Object.assign(l, { mask: m, maskUrl: m.toDataURL(), editMask: true });
    layout();
    emit('layers');
  }
  function removeMask(id, { apply = false } = {}) {
    const l = byId(id);
    if (!l?.mask) return;
    if (apply) {
      commitWhole('Apply mask', l, grab(l.canvas));
      l.ctx.save();
      l.ctx.globalCompositeOperation = 'destination-in';
      l.ctx.drawImage(l.mask, 0, 0);
      l.ctx.restore();
    }
    propEntry('Remove mask', l, { mask: null, maskUrl: null, editMask: false });
    Object.assign(l, { mask: null, maskUrl: null, editMask: false });
    layout();
    emit('layers');
  }

  // Change the canvas size: cut or grow it around an anchor (0..1), or stretch the picture to fit.
  function cropResize({ w, h, ax = 0.5, ay = 0.5, resample = false }) {
    const canvases = doc.layers.flatMap((l) => [l.canvas, l.mask]).filter(Boolean);
    const old = { w: doc.width, h: doc.height, screen: doc.screen };
    const copies = canvases.map((c) => {
      const t = makeCanvas(c.width, c.height);
      t.classList.remove('layer-canvas');
      t.getContext('2d').drawImage(c, 0, 0);
      return t;
    });
    const set = (width, height, draw) => {
      canvases.forEach((c, i) => {
        c.width = width;
        c.height = height;
        draw(c.getContext('2d'), copies[i]);
      });
      doc.width = width;
      doc.height = height;
      syncStroke();
      for (const l of doc.layers) if (l.mask) maskChanged(l);
      layout();
      emit('pixels');
      emit('doc-size');
    };
    const dx = Math.round((w - old.w) * ax), dy = Math.round((h - old.h) * ay);
    const forward = () => {
      doc.screen = false;
      set(w, h, (g, src) => (resample ? g.drawImage(src, 0, 0, w, h) : g.drawImage(src, dx, dy)));
    };
    forward();
    pushHistory({
      label: 'Crop & resize', cost: copies.reduce((a, c) => a + c.width * c.height * 4, 0),
      undo: () => {
        doc.screen = old.screen;
        set(old.w, old.h, (g, src) => g.drawImage(src, 0, 0));
      },
      redo: forward,
    });
  }
  // Flip every layer (and mask) together, as Procreate's canvas flip does.
  function flipCanvas(horizontal) {
    const canvases = doc.layers.flatMap((l) => [l.canvas, l.mask]).filter(Boolean);
    const befores = canvases.map((c) => grab(c));
    const apply = () => {
      for (const c of canvases) {
        const tmp = makeCanvas(c.width, c.height);
        tmp.getContext('2d').drawImage(c, 0, 0);
        const g = c.getContext('2d');
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        if (horizontal) g.setTransform(-1, 0, 0, 1, c.width, 0);
        else g.setTransform(1, 0, 0, -1, 0, c.height);
        g.drawImage(tmp, 0, 0);
        g.restore();
      }
      for (const l of doc.layers) if (l.mask) maskChanged(l);
      emit('pixels');
    };
    apply();
    pushHistory({
      label: 'Flip canvas', cost: canvases.length * canvases[0].width * canvases[0].height * 4,
      undo: () => { canvases.forEach((c, i) => c.getContext('2d').putImageData(befores[i], 0, 0)); for (const l of doc.layers) if (l.mask) maskChanged(l); emit('pixels'); },
      redo: apply,
    });
  }

  // ---------------------------------------------------------------- painting target
  // Where a brush stroke lands: the active layer's pixels, or its mask while the mask is being edited.
  function paintTarget() {
    const l = byId(doc?.activeId);
    if (!l) return null;
    if (l.type !== 'paint') return { error: l.type === 'rig' ? 'Select a drawing layer to paint. The Motion Rig layer holds the character.' : 'Select a layer inside the group to paint.' };
    if (l.locked) return { error: 'This layer is locked. Unlock it to paint.' };
    if (!effVisible(l)) return { error: 'This layer is hidden. Show it to paint.' };
    const canvas = l.editMask && l.mask ? l.mask : l.canvas;
    return { layer: l, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), isMask: canvas === l.mask };
  }

  // ---------------------------------------------------------------- the document
  function create({ name = 'Untitled artwork', width, height, dpi = 132, profile = 'Display P3', screen = false, bgColor = '#ffffff', transparent = false, withRig = true, id, bgImageOn = false }) {
    destroyLayers();
    doc = {
      id: id || uid(), name, width, height, dpi, profile, screen,
      bg: { color: bgColor, transparent, image: true, imageVisible: !!bgImageOn },
      layers: [], activeId: null, created: Date.now(), modified: Date.now(), stack: null,
      anim: { fps: 12, loop: 'loop', onion: 2, onionOpacity: 0.35, enabled: false, hold: 1 },
    };
    const first = makeLayer({ name: 'Layer 1' });
    doc.layers.push(first);
    if (withRig) doc.layers.push(makeLayer({ type: 'rig', id: 'rig', name: 'Motion Rig' }));
    doc.activeId = first.id;
    resetHistory();
    syncStroke();
    layout();
    emit('doc');
    emit('layers');
    return doc;
  }
  function destroyLayers() {
    if (!doc) return;
    for (const l of doc.layers) l.canvas?.remove();
    for (const c of workspace.querySelectorAll('canvas.layer-canvas')) c.remove();
    clearTimeout(saveTimer);
  }
  function resetHistory() {
    history.undo = [];
    history.redo = [];
    history.bytes = 0;
    emit('history');
  }
  function syncStroke() {
    if (stroke.width !== doc.width || stroke.height !== doc.height) {
      stroke.width = doc.width;
      stroke.height = doc.height;
    }
  }
  // A screen-sized artwork follows the window: every layer is resized, keeping its pixels in place.
  function resizeScreen(w, h) {
    if (!doc || !doc.screen || (doc.width === w && doc.height === h)) {
      if (doc) layout();
      return;
    }
    const resize = (c) => {
      const g = c.getContext('2d');
      const keep = c.width && c.height ? g.getImageData(0, 0, c.width, c.height) : null;
      c.width = w;
      c.height = h;
      if (keep) g.putImageData(keep, 0, 0);
    };
    for (const l of doc.layers) {
      if (l.canvas) resize(l.canvas);
      if (l.mask) resize(l.mask);
    }
    doc.width = w;
    doc.height = h;
    resize(stroke);
    layout();
  }

  // ---------------------------------------------------------------- flatten, thumbnails
  // The visible artwork as one canvas. rig: include the live character; bg: the playground picture.
  function flatten({ scale = 1, width, rig = true, bg = true, transparent = false, into = null } = {}) {
    const k = width ? width / doc.width : scale;
    const w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k));
    const out = into || document.createElement('canvas');
    if (out.width !== w || out.height !== h) {
      out.width = w;
      out.height = h;
    }
    const c = out.getContext('2d');
    c.clearRect(0, 0, w, h);
    compose(c, k, { rig, bg, transparent });
    return out;
  }
  // Draw the whole artwork onto a context, scaled by k: the paper, the picture behind, every layer
  // in order, and the live character in its place in the stack.
  function compose(c, k, { rig = true, bg = true, transparent = false } = {}) {
    const w = Math.max(1, Math.round(doc.width * k)), h = Math.max(1, Math.round(doc.height * k));
    if (!transparent && !doc.bg.transparent) {
      c.fillStyle = doc.bg.color;
      c.fillRect(0, 0, w, h);
    }
    const img = bgImage();
    if (bg && doc.bg.image && doc.bg.imageVisible && img?.complete && img.naturalWidth) {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      c.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
    for (const l of doc.layers) {
      if (l.type === 'rig') {
        if (rig && isRigVisible()) {
          const p = paper();
          const sx = stage.width / workspace.offsetWidth, sy = stage.height / workspace.offsetHeight;
          c.drawImage(stage, p.x * sx, p.y * sy, p.w * sx, p.h * sy, 0, 0, w, h);
        }
      } else if (l.type === 'paint') drawLayer(c, l, k);
    }
  }
  // The colour you see at one point of the artwork (for the eyedropper), as hex.
  function sampleAt(x, y) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 1, 1);
    g.translate(-Math.round(x), -Math.round(y));
    compose(g, 1, {});
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return '#' + [r, gg, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function thumbnail(width = 360) {
    const c = flatten({ width });
    return c.toDataURL('image/jpeg', 0.72);
  }
  function layerThumb(layer, w = 76, h = 56) {
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    const g = t.getContext('2d');
    if (layer.canvas) {
      const k = Math.min(w / layer.canvas.width, h / layer.canvas.height);
      g.drawImage(layer.canvas, (w - layer.canvas.width * k) / 2, (h - layer.canvas.height * k) / 2, layer.canvas.width * k, layer.canvas.height * k);
    }
    return t;
  }

  // ---------------------------------------------------------------- saving and loading
  let saveTimer = 0;
  let dirty = false;
  function touch(record = true) {
    if (!doc) return;
    doc.modified = Date.now();
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1600);
    if (record) emit('change');
  }
  async function serialize() {
    const layers = [];
    for (const l of doc.layers) {
      const rec = { id: l.id, name: l.name, type: l.type, visible: l.visible, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock, locked: l.locked, parent: l.parent, expanded: l.expanded, hold: l.hold };
      // Unchanged layers reuse their last picture, so saving only re-encodes what was edited.
      if (l.canvas) rec.blob = l._blob || (l._blob = await canvasToBlob(l.canvas));
      if (l.mask) rec.maskBlob = l._maskBlob || (l._maskBlob = await canvasToBlob(l.mask));
      layers.push(rec);
    }
    return {
      id: doc.id, name: doc.name, width: doc.width, height: doc.height, dpi: doc.dpi, profile: doc.profile, screen: doc.screen,
      bg: doc.bg, activeId: doc.activeId, created: doc.created, modified: doc.modified, stack: doc.stack, anim: doc.anim,
      thumb: thumbnail(), layers,
    };
  }
  async function save() {
    if (!doc || !dirty || !store.available) return;
    dirty = false;
    try {
      await store.put(await serialize());
      try { localStorage.setItem('promove.current', doc.id); } catch {}
      emit('saved');
    } catch (err) {
      console.error(err);
      dirty = true;
      toast('Could not save this artwork in the browser.', 4000);
    }
  }
  async function load(rec) {
    destroyLayers();
    doc = {
      id: rec.id, name: rec.name, width: rec.width, height: rec.height, dpi: rec.dpi, profile: rec.profile, screen: rec.screen,
      bg: rec.bg, layers: [], activeId: rec.activeId, created: rec.created, modified: rec.modified, stack: rec.stack || null, anim: rec.anim || { fps: 12, loop: 'loop', onion: 2, onionOpacity: 0.35, enabled: false, hold: 1 },
    };
    for (const r of rec.layers) {
      const canvas = r.blob ? await blobToCanvas(r.blob, rec.width, rec.height) : null;
      const l = makeLayer({ ...r, canvas });
      if (r.maskBlob) {
        l.mask = await blobToCanvas(r.maskBlob, rec.width, rec.height);
        l.maskUrl = l.mask.toDataURL();
      }
      doc.layers.push(l);
    }
    if (!doc.layers.some((l) => l.type === 'rig')) doc.layers.push(makeLayer({ type: 'rig', id: 'rig', name: 'Motion Rig' }));
    if (!byId(doc.activeId)) doc.activeId = doc.layers.find((l) => l.type === 'paint').id;
    resetHistory();
    syncStroke();
    layout();
    dirty = false;
    try { localStorage.setItem('promove.current', doc.id); } catch {}
    emit('doc');
    emit('layers');
    return doc;
  }
  // Save the open artwork now (the Gallery does this so its card is up to date).
  async function saveNow() {
    dirty = true;
    await save();
  }
  async function open(id) {
    await save();
    const rec = await store.get(id);
    if (!rec) throw new Error('That artwork could not be found.');
    return load(rec);
  }
  async function newArtwork(opts) {
    await save();
    create(opts);
    dirty = true;
    await save();
    return doc;
  }

  return {
    on, emit,
    get doc() { return doc; },
    get layers() { return doc.layers; },
    get active() { return byId(doc?.activeId); },
    get history() { return history; },
    get selection() { return sel.canvas; },
    set selection(c) { sel.canvas = c; emit('selection'); },
    get paper() { return paper(); },
    byId, paintLayers, groupOf, effVisible, effOpacity, unique, makeCanvas, grab,
    setActive, addLayer, addLayerWith, deleteLayer, duplicateLayer, renameLayer, moveLayer, move, groupLayer, ungroup, toggleGroup,
    mergeDown, flattenVisible, flipCanvas, cropResize, serialize, setLayerProp, clearLayer, addMask, removeMask, maskChanged, drawLayer,
    get view() { return view; },
    setView(v) {
      Object.assign(view, v);
      layout();
      emit('view');
    },
    setAnimView(v) {
      animView = v;
      layout();
    },
    get animating() { return !!animView; },
    addOverlay: (el, z = 800) => { overlays.push({ el, z }); workspace.append(el); layout(); },
    paintTarget, pushHistory, rectEntry, commitWhole, propEntry, structureEntry, undo, redo,
    create, load, open, newArtwork, save, saveNow, touch, resizeScreen, layout, flatten, sampleAt, thumbnail, layerThumb,
    BLEND,
  };
}
