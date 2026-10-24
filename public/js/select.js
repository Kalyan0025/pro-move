// The Selection tool, like Procreate's: Automatic (tap to select an area of similar colour),
// Freehand, Rectangle and Ellipse, each able to Add to or Remove from what is selected, plus
// Invert, Feather, Copy & Paste, Colour Fill and Clear. The selection is a mask the size of the
// artwork; painting, adjustments and transforms stay inside it.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Blur only the alpha channel of a canvas (a soft edge for Feather), by three box blurs.
export function blurAlpha(canvas, radius) {
  const r = Math.round(radius);
  if (r < 1) return;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const im = g.getImageData(0, 0, W, H);
  const a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = im.data[i * 4 + 3];
  const tmp = new Float32Array(W * H);
  const pass = (src, dst, horizontal) => {
    const len = horizontal ? W : H, lines = horizontal ? H : W;
    const stride = horizontal ? 1 : W, lineStride = horizontal ? W : 1;
    const win = r * 2 + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, len - 1) * stride];
      for (let k = 0; k < len; k++) {
        dst[base + k * stride] = sum / win;
        sum += src[base + clamp(k + r + 1, 0, len - 1) * stride] - src[base + clamp(k - r, 0, len - 1) * stride];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, tmp, true);
    pass(tmp, a, false);
  }
  for (let i = 0; i < a.length; i++) {
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
    im.data[i * 4 + 3] = a[i];
  }
  g.putImageData(im, 0, 0);
}

export function createSelection({ studio, workspace, toast, getColour, onChange }) {
  const view = document.createElement('canvas');
  view.className = 'sel-view';
  studio.addOverlay(view, 700);
  const vg = view.getContext('2d');
  const bar = $('selBar');
  let active = false;
  let mode = 'auto'; // auto | free | rect | ellipse
  let op = 'replace'; // replace | add | remove (chosen by the Add / Remove buttons)
  let drag = null;
  let seed = null; // last tap of Automatic, kept so the threshold slider can redo it
  let threshold = 24;
  let feather = 0;
  let base = null; // the selection before Feather started
  let ants = 0;
  let antsTimer = 0;
  const hatch = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 14;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(30,139,255,.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-2, 16);
    g.lineTo(16, -2);
    g.stroke();
    return c;
  })();
  const doc = () => studio.doc;
  const newMask = () => {
    const c = studio.makeCanvas(doc().width, doc().height);
    c.classList.remove('layer-canvas');
    return c;
  };

  // ------------------------------------------------------------ the picture of the selection
  // The hatching over what is not selected, and the outline, are worked out once per selection;
  // only the moving dashes are redrawn on each tick.
  let cache = null; // { src, w, h, hatchCv, edgeCv, antsCv }
  const stripe = (() => {
    const c = document.createElement('canvas');
    c.width = 20;
    c.height = 20;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 20, 20);
    g.fillStyle = '#1e8bff';
    g.beginPath();
    g.moveTo(0, 20);
    g.lineTo(10, 20);
    g.lineTo(20, 10);
    g.lineTo(20, 0);
    g.lineTo(10, 0);
    g.lineTo(0, 10);
    g.closePath();
    g.fill();
    return c;
  })();
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  function build() {
    const s = studio.selection;
    const d = doc();
    const k = Math.min(1, 1100 / Math.max(d.width, d.height));
    const w = Math.max(1, Math.round(d.width * k)), h = Math.max(1, Math.round(d.height * k));
    const hatchCv = mk(w, h);
    const hg = hatchCv.getContext('2d');
    hg.fillStyle = hg.createPattern(hatch, 'repeat');
    hg.fillRect(0, 0, w, h);
    hg.globalCompositeOperation = 'destination-out';
    hg.drawImage(s, 0, 0, w, h);
    // The outline: the mask minus the mask shrunk a little.
    const edgeCv = mk(w, h);
    const eg = edgeCv.getContext('2d');
    eg.drawImage(s, 0, 0, w, h);
    const inner = mk(w, h);
    const ig = inner.getContext('2d');
    ig.drawImage(s, 0, 0, w, h);
    const t = mk(w, h);
    const tg = t.getContext('2d');
    for (const [dx, dy] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
      tg.clearRect(0, 0, w, h);
      tg.drawImage(inner, dx, dy);
      ig.globalCompositeOperation = 'destination-in';
      ig.drawImage(t, 0, 0);
    }
    eg.globalCompositeOperation = 'destination-out';
    eg.drawImage(inner, 0, 0);
    cache = { src: s, w, h, hatchCv, edgeCv, antsCv: mk(w, h) };
  }
  function drawView() {
    const s = studio.selection;
    if (!s || !doc()) {
      vg.clearRect(0, 0, view.width, view.height);
      cache = null;
      return;
    }
    if (!cache || cache.src !== s) build();
    const { w, h, hatchCv, edgeCv, antsCv } = cache;
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    vg.clearRect(0, 0, w, h);
    vg.drawImage(hatchCv, 0, 0);
    const ag = antsCv.getContext('2d');
    ag.globalCompositeOperation = 'source-over';
    ag.clearRect(0, 0, w, h);
    ag.fillStyle = ag.createPattern(stripe, 'repeat');
    ag.save();
    ag.translate(ants % 20, 0);
    ag.fillRect(-20, 0, w + 20, h);
    ag.restore();
    ag.globalCompositeOperation = 'destination-in';
    ag.drawImage(edgeCv, 0, 0);
    vg.drawImage(antsCv, 0, 0);
  }
  function startAnts() {
    clearInterval(antsTimer);
    antsTimer = setInterval(() => {
      if (!studio.selection || document.hidden || drag) return;
      ants += 2;
      drawView();
    }, 150);
  }
  function setSelection(c, { record = true } = {}) {
    const before = studio.selection;
    studio.selection = c;
    if (record && before !== c) {
      studio.pushHistory({ label: 'Selection', cost: 8, undo: () => { studio.selection = before; }, redo: () => { studio.selection = c; } });
    }
    drawView();
    clearInterval(antsTimer);
    if (c) startAnts();
    onChange?.(!!c);
    renderBar();
  }
  studio.on('selection', () => drawView());
  studio.on('doc', () => {
    studio.selection = null;
    clearInterval(antsTimer);
    drawView();
    renderBar();
  });

  // Combine a new shape (a canvas, white where selected) with the selection under the current op.
  function combine(shape) {
    const cur = studio.selection;
    if (op === 'replace' || !cur) {
      if (op === 'remove') return setSelection(cur);
      return setSelection(shape);
    }
    const out = newMask();
    const g = out.getContext('2d');
    g.drawImage(cur, 0, 0);
    if (op === 'add') g.drawImage(shape, 0, 0);
    else {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(shape, 0, 0);
    }
    setSelection(isEmpty(out) ? null : out);
  }
  function isEmpty(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
    // sample sparsely first, then everything
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }

  // ------------------------------------------------------------ shapes
  const toDoc = (e) => {
    const r = view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * doc().width) / r.width, y: ((e.clientY - r.top) * doc().height) / r.height };
  };
  function shapeCanvas(draw) {
    const c = newMask();
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    draw(g);
    return c;
  }
  // Automatic: every connected pixel of a similar colour, from where you tapped, on the active layer.
  function floodFrom(pt) {
    const layer = studio.active;
    if (!layer?.canvas) return toast('Select a drawing layer to use Automatic selection.');
    const { width: W, height: H } = layer.canvas;
    const x0 = clamp(Math.round(pt.x), 0, W - 1), y0 = clamp(Math.round(pt.y), 0, H - 1);
    const src = layer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const at = (i) => i * 4;
    const si = at(y0 * W + x0);
    const sr = src[si], sg = src[si + 1], sb = src[si + 2], sa = src[si + 3];
    const tol = threshold * 3;
    const near = (i) => {
      const p = at(i);
      return Math.abs(src[p] - sr) + Math.abs(src[p + 1] - sg) + Math.abs(src[p + 2] - sb) + Math.abs(src[p + 3] - sa) <= tol * 1.3;
    };
    const seen = new Uint8Array(W * H);
    const out = new Uint8ClampedArray(W * H * 4);
    const stack = [y0 * W + x0];
    while (stack.length) {
      let i = stack.pop();
      if (seen[i] || !near(i)) continue;
      const y = (i / W) | 0;
      let xl = i % W, xr = xl;
      // Grow the run left and right, then queue the rows above and below.
      while (xl > 0 && !seen[y * W + xl - 1] && near(y * W + xl - 1)) xl--;
      while (xr < W - 1 && !seen[y * W + xr + 1] && near(y * W + xr + 1)) xr++;
      for (let x = xl; x <= xr; x++) {
        const j = y * W + x;
        seen[j] = 1;
        out[j * 4] = out[j * 4 + 1] = out[j * 4 + 2] = 255;
        out[j * 4 + 3] = 255;
        if (y > 0 && !seen[j - W]) stack.push(j - W);
        if (y < H - 1 && !seen[j + W]) stack.push(j + W);
      }
    }
    const c = newMask();
    c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return c;
  }

  // ------------------------------------------------------------ pointer
  function down(e) {
    const pt = toDoc(e);
    drag = { pt, last: pt, path: [pt] };
    view.setPointerCapture?.(e.pointerId);
    if (mode === 'auto') {
      seed = pt;
      drag = null;
      combine(floodFrom(pt));
      renderBar();
    }
  }
  function move(e) {
    if (!drag) return;
    const pt = toDoc(e);
    drag.last = pt;
    if (mode === 'free') drag.path.push(pt);
    preview();
  }
  function preview() {
    // A live outline of the shape being drawn.
    const d = doc();
    const k = view.width / d.width;
    drawView();
    vg.save();
    vg.scale(k, k);
    vg.lineWidth = 2 / k;
    vg.strokeStyle = '#1e8bff';
    vg.fillStyle = 'rgba(30,139,255,.2)';
    vg.setLineDash([8 / k, 6 / k]);
    pathFor(vg);
    vg.fill();
    vg.stroke();
    vg.restore();
  }
  function pathFor(g) {
    const a = drag.pt, b = drag.last;
    g.beginPath();
    if (mode === 'rect') g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else if (mode === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    else {
      g.moveTo(drag.path[0].x, drag.path[0].y);
      for (const p of drag.path) g.lineTo(p.x, p.y);
      g.closePath();
    }
  }
  function up() {
    if (!drag) return;
    const d = drag;
    drag = null;
    const small = Math.hypot(d.last.x - d.pt.x, d.last.y - d.pt.y) < 4 && mode !== 'free';
    if (small || (mode === 'free' && d.path.length < 3)) return drawView();
    drag = d;
    const c = shapeCanvas((g) => {
      pathFor(g);
      g.fill();
    });
    drag = null;
    combine(c);
  }

  // ------------------------------------------------------------ actions on the selection
  const selectAll = () => setSelection(shapeCanvas((g) => g.fillRect(0, 0, doc().width, doc().height)));
  function invert() {
    const cur = studio.selection;
    if (!cur) return selectAll();
    const c = shapeCanvas((g) => g.fillRect(0, 0, doc().width, doc().height));
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(cur, 0, 0);
    setSelection(isEmpty(c) ? null : c);
  }
  function featherTo(px) {
    if (!studio.selection) return;
    if (!base) {
      base = newMask();
      base.getContext('2d').drawImage(studio.selection, 0, 0);
    }
    const c = newMask();
    c.getContext('2d').drawImage(base, 0, 0);
    blurAlpha(c, px);
    studio.selection = c;
    drawView();
  }
  function layerPixels(layer, { cut = false } = {}) {
    // The layer's pixels inside the selection (or all of it, with no selection).
    const out = studio.makeCanvas(layer.canvas.width, layer.canvas.height);
    out.classList.remove('layer-canvas');
    const g = out.getContext('2d');
    g.drawImage(layer.canvas, 0, 0);
    if (studio.selection) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(studio.selection, 0, 0);
    }
    if (cut) eraseSelection(layer);
    return out;
  }
  function eraseSelection(layer) {
    const before = studio.grab(layer.canvas);
    if (studio.selection) {
      layer.ctx.save();
      layer.ctx.globalCompositeOperation = 'destination-out';
      layer.ctx.drawImage(studio.selection, 0, 0);
      layer.ctx.restore();
    } else layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    studio.commitWhole('Clear', layer, before);
  }
  const clip = { canvas: null };
  async function toSystemClipboard(canvas) {
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      // The browser may not allow this; the in-app clipboard still works.
    }
  }
  function copy(layer = studio.active, { cut = false } = {}) {
    if (!layer?.canvas) return toast('Select a drawing layer first.');
    clip.canvas = layerPixels(layer, { cut });
    toSystemClipboard(clip.canvas);
    toast(cut ? 'Cut.' : 'Copied.', 900);
  }
  function copyCanvas() {
    clip.canvas = studio.flatten({ rig: true, bg: true });
    toSystemClipboard(clip.canvas);
    toast('Copied the whole canvas.', 1200);
  }
  function paste() {
    if (!clip.canvas) return toast('Nothing copied yet.');
    studio.addLayerWith(clip.canvas, studio.unique('Pasted'));
  }
  // Copy & Paste: the selected pixels become a new layer above, the original stays.
  function copyPaste() {
    const l = studio.active;
    if (!l?.canvas) return toast('Select a drawing layer first.');
    if (!studio.selection) return toast('Make a selection first.');
    studio.addLayerWith(layerPixels(l), studio.unique('Selection'));
  }
  function colourFill() {
    const l = studio.active;
    if (!l?.canvas) return toast('Select a drawing layer first.');
    const before = studio.grab(l.canvas);
    const g = l.ctx;
    g.save();
    g.fillStyle = getColour();
    if (studio.selection) {
      const tmp = newMask();
      const tg = tmp.getContext('2d');
      tg.fillStyle = getColour();
      tg.fillRect(0, 0, tmp.width, tmp.height);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(studio.selection, 0, 0);
      if (l.alphaLock) g.globalCompositeOperation = 'source-atop';
      g.drawImage(tmp, 0, 0);
    } else {
      if (l.alphaLock) g.globalCompositeOperation = 'source-atop';
      g.fillRect(0, 0, l.canvas.width, l.canvas.height);
    }
    g.restore();
    studio.commitWhole('Colour fill', l, before);
  }
  // Select what is painted on a layer (the Layers menu's Select).
  function fromLayer(layer) {
    if (!layer?.canvas) return;
    const c = newMask();
    const g = c.getContext('2d');
    g.drawImage(layer.canvas, 0, 0);
    // Anything painted counts as fully selected.
    const im = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < im.data.length; i += 4) {
      im.data[i] = im.data[i + 1] = im.data[i + 2] = 255;
      im.data[i + 3] = im.data[i + 3] ? 255 : 0;
    }
    g.putImageData(im, 0, 0);
    setSelection(isEmpty(c) ? null : c);
  }

  // ------------------------------------------------------------ the bar
  const ICON = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const MODES = [['auto', 'Automatic', '<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>'], ['free', 'Freehand', '<path d="M15.5 6.5c-1.5-2-6.5-1.6-6.5 1.3 0 3.4 7 2.5 7 6.6 0 3-5 3.6-7 1.4"/>'], ['rect', 'Rectangle', '<rect x="5" y="6" width="14" height="12" rx="1.5" fill="currentColor" stroke="none" opacity=".85"/>'], ['ellipse', 'Ellipse', '<ellipse cx="12" cy="12" rx="8" ry="5.5" fill="currentColor" stroke="none" opacity=".85"/>']];
  // The icon row under the shape pill, in the order Procreate has it.
  const ACTS = [
    ['op', 'add', 'Add', '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="currentColor" stroke="none"/><path d="M12 8.5v7M8.5 12h7" stroke="#1c1c1e"/>'],
    ['op', 'remove', 'Remove', '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="currentColor" stroke="none"/><path d="M8.5 12h7" stroke="#1c1c1e"/>'],
    ['do', 'invert', 'Invert', '<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M19.5 4.5v15h-15z" fill="currentColor" stroke="none"/>', true],
    ['do', 'copypaste', 'Copy & Paste', '<path d="M12 5.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" stroke="none"/><path d="M12 5.5a6.5 6.5 0 0 1 0 13" /><path d="M12 4v16" stroke-dasharray="1.5 2.4"/>', true],
    ['do', 'tune', 'Feather', '<circle cx="12" cy="12" r="6.5" opacity=".5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>'],
    ['do', 'saves', 'Save & Load', '<path d="M12 19.5s-7-4.3-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.3c0 4.900-7 9.200-7 9.200z" fill="currentColor" stroke="none"/>'],
    ['do', 'fill', 'Color Fill', '<path d="M5 13.5l6.5-7 6 6-6.500 6.500a2 2 0 0 1-2.800 0L5 16.300a2 2 0 0 1 0-2.800z" fill="currentColor" stroke="none"/><path d="M19 17.500c0 1.100-.9 2-2 2s-2-.9-2-2 2-3.500 2-3.500 2 2.400 2 3.500z" fill="currentColor" stroke="none"/>'],
    ['do', 'clear', 'Clear', '<path d="M4.500 19.500c4 .5 6.500-1 8-3l5.500-7.500a2 2 0 0 0-3-2.500l-6.500 6.500c-2 2-3 4-4 6.500z" fill="currentColor" stroke="none"/>', true],
  ];
  let panel = null; // null | 'tune' (Threshold and Feather) | 'saves'
  const SAVES = 'promove.selections';
  const saved = () => { try { return JSON.parse(localStorage.getItem(SAVES) || '[]'); } catch { return []; } };
  function putSaved(list) {
    try { localStorage.setItem(SAVES, JSON.stringify(list.slice(0, 8))); } catch { toast('Not enough room to keep this selection.'); }
  }
  function renderBar() {
    if (!bar) return;
    const has = !!studio.selection;
    const sv = saved();
    const tune = panel === 'tune' ? `<div class="sel-panel">
        ${mode === 'auto' ? `<label>Threshold<input type="range" id="selThreshold" min="2" max="90" value="${threshold}"><output>${threshold}</output></label>` : ''}
        <label>Feather<input type="range" id="selFeather" min="0" max="60" value="${feather}" ${has ? '' : 'disabled'}><output>${feather}</output></label>
      </div>` : '';
    const saves = panel === 'saves' ? `<div class="sel-panel sel-saves">
        <button data-do="savenow" ${has ? '' : 'disabled'}>Save this selection</button>
        ${sv.map((x, i) => `<span class="sel-save"><button data-load="${i}">${x.name}</button><button data-drop="${i}" aria-label="Delete ${x.name}">&times;</button></span>`).join('') || '<small>Nothing saved yet.</small>'}
      </div>` : '';
    bar.innerHTML = `
      <div class="bar-modes sel-modes" role="group" aria-label="Selection shape">${MODES.map(([id, label, p]) => `<button data-mode="${id}" class="${mode === id ? 'on' : ''}">${ICON(p)}<span>${label}</span></button>`).join('')}</div>
      ${tune}${saves}
      <div class="sel-acts">${ACTS.map(([kind, id, label, p, needs]) => `<button data-${kind}="${id}" class="${(kind === 'op' && op === id) || (kind === 'do' && panel === id) ? 'on' : ''}" ${needs && !has ? 'disabled' : ''}>${ICON(p)}<span>${label}</span></button>`).join('')}</div>`;
  }
  bar?.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    const o = e.target.closest('[data-op]');
    const a = e.target.closest('[data-do]');
    const ld = e.target.closest('[data-load]');
    const dr = e.target.closest('[data-drop]');
    if (m) {
      mode = m.dataset.mode;
      if (mode === 'auto' && !panel) panel = 'tune';
      renderBar();
    } else if (o) {
      op = op === o.dataset.op ? 'replace' : o.dataset.op;
      renderBar();
    } else if (ld) {
      const item = saved()[Number(ld.dataset.load)];
      if (!item) return;
      const img = new Image();
      img.onload = () => {
        const c = newMask();
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        setSelection(isEmpty(c) ? null : c);
      };
      img.src = item.url;
    } else if (dr) {
      const list = saved();
      list.splice(Number(dr.dataset.drop), 1);
      putSaved(list);
      renderBar();
    } else if (a && !a.disabled) {
      const d = a.dataset.do;
      if (d === 'invert') invert();
      else if (d === 'all') selectAll();
      else if (d === 'copypaste') copyPaste();
      else if (d === 'fill') colourFill();
      else if (d === 'clear') setSelection(null);
      else if (d === 'tune' || d === 'saves') {
        panel = panel === d ? null : d;
        renderBar();
      } else if (d === 'savenow' && studio.selection) {
        const list = saved();
        list.unshift({ name: `Selection ${list.length + 1}`, url: studio.selection.toDataURL('image/png') });
        putSaved(list);
        toast('Selection saved.');
        renderBar();
      } else if (d === 'done') exit();
    }
  });
  bar?.addEventListener('input', (e) => {
    if (e.target.id === 'selThreshold') {
      threshold = Number(e.target.value);
      e.target.nextElementSibling.textContent = threshold;
      if (seed) {
        const c = floodFrom(seed);
        if (op === 'replace' || !studio.selection) {
          studio.selection = c;
          drawView();
        }
      }
    } else if (e.target.id === 'selFeather') {
      feather = Number(e.target.value);
      e.target.nextElementSibling.textContent = feather;
      featherTo(feather);
    }
  });
  bar?.addEventListener('change', (e) => {
    if (e.target.id === 'selThreshold' && seed && (op === 'replace' || !studio.selection)) setSelection(floodFrom(seed));
    if (e.target.id === 'selFeather') {
      base = null;
      feather = 0;
      renderBar();
    }
  });

  function enter() {
    active = true;
    panel = mode === 'auto' ? 'tune' : null;
    bar.classList.remove('hidden');
    document.body.classList.add('selecting');
    $('btnSelection')?.classList.add('active');
    renderBar();
    drawView();
  }
  function exit() {
    active = false;
    drag = null;
    bar.classList.add('hidden');
    document.body.classList.remove('selecting');
    $('btnSelection')?.classList.remove('active');
  }
  renderBar();
  return {
    get active() { return active; },
    get has() { return !!studio.selection; },
    enter, exit, down, move, up, invert, selectAll, copy, copyCanvas, paste, copyPaste, colourFill, fromLayer,
    clear: () => setSelection(null),
    eraseSelection,
    cut: (l) => copy(l, { cut: true }),
  };
}
