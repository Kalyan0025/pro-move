// The Actions menu and Prefs behind the buttons: Add (files, photos, text, cut / copy / paste), Canvas
// (crop & resize, drawing guide, flip, information, clear), Share (PNG, JPEG, PSD, PDF, .promove),
// Video (time-lapse), and Prefs (pressure curve, stabilisation, gestures). Small dialogs are built
// here too, so the page itself stays light.
import { toPNG, toJPEG, toPSD, toPDF, toPromove, download, fileName, flattenLayers } from './exporters.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PREFS_KEY = 'promove.prefs';

// A small modal dialog: dialog({ title, body, actions }) → { close, root }.
export function dialog({ title, body, actions = [{ label: 'Done', primary: true }], width = 460, onOpen }) {
  const dlg = $('dlg');
  dlg.innerHTML = `<div class="dlg-card" style="width:${width}px" role="dialog" aria-label="${esc(title)}">
    <header><b>${esc(title)}</b></header>
    <div class="dlg-body">${body}</div>
    <footer>${actions.map((a, i) => `<button class="${a.primary ? 'primary' : ''}${a.danger ? ' danger' : ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</footer>
  </div>`;
  dlg.classList.remove('hidden');
  const close = () => dlg.classList.add('hidden');
  dlg.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const a = actions[Number(b.dataset.act)];
      if (a.onClick?.(dlg) === false) return;
      close();
    } else if (e.target === dlg) close();
  };
  onOpen?.(dlg, close);
  return { close, root: dlg };
}

export function createActions({ studio, painter, selection, toast, getColour, stage, bgImage, closePopovers, setDynamic }) {
  // ------------------------------------------------------------ preferences (remembered)
  const prefs = { zoom: true, undo: true, redo: true, hideUI: true, hold: true, touchDraw: true, gamma: 1, smooth: 0, dynamic: true, selVis: 0.25, guide: { on: false, type: 'grid', size: 64, thick: 1, opacity: 0.45, colour: '#1e8bff', sym: 'v' } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    Object.assign(prefs, saved, { guide: { ...prefs.guide, ...(saved.guide || {}) } });
  } catch {}
  const save = () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  };
  const apply = () => {
    painter.gamma = prefs.gamma;
    painter.extraSmoothing = prefs.smooth;
    setDynamic(prefs.dynamic);
    document.documentElement.style.setProperty('--sel-vis', String(prefs.selVis));
    $('prefSelVis').value = prefs.selVis * 100;
    $('prefSelVisOut').textContent = `${(prefs.selVis * 100).toFixed(1)}%`;
    $('prefDynamic').checked = prefs.dynamic;
    drawGuide();
  };

  // ------------------------------------------------------------ Add
  const insertFile = async (file) => {
    if (!file) return;
    closePopovers();
    try {
      const img = await createImageBitmap(file);
      painter.insertImage(img);
      toast('Added as a new layer.', 1600);
    } catch {
      toast("Couldn't read that picture.");
    }
  };
  for (const id of ['insertPhoto', 'insertFile', 'takePhoto']) {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      insertFile(f);
    });
  }
  $('btnAddText').addEventListener('click', () => {
    closePopovers();
    dialog({
      title: 'Add text',
      body: `<textarea id="txVal" rows="3" placeholder="Type something" maxlength="400"></textarea>
        <div class="dlg-row"><label>Font<select id="txFont" class="row-select"><option value="-apple-system, system-ui, sans-serif">Sans</option><option value="Georgia, serif">Serif</option><option value="ui-monospace, Menlo, monospace">Mono</option><option value='"Comic Sans MS", "Chalkboard SE", cursive'>Hand</option></select></label>
        <label>Size<input id="txSize" type="range" min="16" max="320" value="96"></label>
        <label class="dlg-chk">Bold<input id="txBold" type="checkbox" class="switch" checked></label></div>`,
      actions: [{ label: 'Cancel' }, {
        label: 'Add', primary: true,
        onClick: () => {
          const text = $('txVal').value.trim();
          if (!text) return false;
          const d = studio.doc;
          const c = studio.makeCanvas(d.width, d.height);
          c.classList.remove('layer-canvas');
          const g = c.getContext('2d');
          const px = Number($('txSize').value) * (d.width / studio.paper.w) * 0.6;
          g.font = `${$('txBold').checked ? '700' : '400'} ${px}px ${$('txFont').value}`;
          g.fillStyle = getColour();
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const lines = text.split('\n');
          lines.forEach((ln, i) => g.fillText(ln, d.width / 2, d.height / 2 + (i - (lines.length - 1) / 2) * px * 1.2));
          studio.addLayerWith(c, studio.unique('Text'));
        },
      }],
    });
  });
  $('btnCut').addEventListener('click', () => (closePopovers(), selection.cut(studio.active)));
  $('btnCopy').addEventListener('click', () => (closePopovers(), selection.copy(studio.active)));
  $('btnCopyCanvas').addEventListener('click', () => (closePopovers(), selection.copyCanvas()));
  $('btnPaste').addEventListener('click', () => (closePopovers(), selection.paste()));

  // ------------------------------------------------------------ Canvas
  $('btnClearLayer').addEventListener('click', () => {
    closePopovers();
    const l = studio.active;
    if (!l?.canvas) return toast('Select a drawing layer first.');
    studio.selection ? selection.eraseSelection(l) : studio.clearLayer(l.id);
  });
  $('btnClearCanvas').addEventListener('click', () => {
    closePopovers();
    if (!confirm('Clear every layer? You can undo it.')) return;
    for (const l of studio.paintLayers()) studio.clearLayer(l.id);
  });
  $('btnCanvasInfo').addEventListener('click', () => {
    closePopovers();
    const d = studio.doc;
    const layers = studio.paintLayers().length;
    const mb = (d.width * d.height * 4 * layers) / 1048576;
    const maxLayers = Math.max(layers, Math.floor((600 * 1048576) / (d.width * d.height * 4)));
    dialog({
      title: 'Canvas information',
      body: `<table class="dlg-table">
        <tr><td>Name</td><td>${esc(d.name)}</td></tr>
        <tr><td>Dimensions</td><td>${d.width} × ${d.height} px</td></tr>
        <tr><td>Print size</td><td>${(d.width / d.dpi).toFixed(1)} × ${(d.height / d.dpi).toFixed(1)} in at ${d.dpi} DPI</td></tr>
        <tr><td>Colour profile</td><td>${esc(d.profile)}</td></tr>
        <tr><td>Layers</td><td>${layers} of about ${maxLayers}</td></tr>
        <tr><td>Memory in use</td><td>about ${mb.toFixed(0)} MB</td></tr>
        <tr><td>Undo steps</td><td>${studio.history.undo.length}</td></tr>
        <tr><td>Last changed</td><td>${new Date(d.modified).toLocaleString()}</td></tr></table>`,
    });
  });
  $('btnCrop').addEventListener('click', () => {
    closePopovers();
    const d = studio.doc;
    const st = { w: d.width, h: d.height, ax: 0.5, ay: 0.5, resample: false, lock: true };
    dialog({
      title: 'Crop & resize',
      width: 480,
      body: `<div class="dlg-row"><label>Width (px)<input id="crW" type="number" min="16" max="8192" value="${st.w}"></label>
        <label>Height (px)<input id="crH" type="number" min="16" max="8192" value="${st.h}"></label></div>
        <div class="dlg-row"><div class="anchor" id="crAnchor">${[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => `<button data-ax="${x}" data-ay="${y}" class="${x === 0.5 && y === 0.5 ? 'on' : ''}" aria-label="Anchor"></button>`)).join('')}</div>
        <div class="dlg-col"><label class="dlg-chk">Resample canvas<input id="crRes" type="checkbox" class="switch"></label><p class="hint" style="margin:6px 0 0">Off: the picture stays the same size and the canvas is cut or grown around the anchor. On: the picture is stretched to fit.</p></div></div>`,
      actions: [{ label: 'Cancel' }, {
        label: 'Apply', primary: true,
        onClick: () => {
          const w = clamp(Number($('crW').value) || d.width, 16, 8192), h = clamp(Number($('crH').value) || d.height, 16, 8192);
          if (w * h > 4096 * 4096) {
            toast('That is too big for this device (about 16 megapixels at most).', 4000);
            return false;
          }
          studio.cropResize({ w, h, ax: st.ax, ay: st.ay, resample: $('crRes').checked });
          selection.clear();
        },
      }],
      onOpen: (root) => {
        root.querySelector('#crAnchor').onclick = (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          st.ax = Number(b.dataset.ax);
          st.ay = Number(b.dataset.ay);
          root.querySelectorAll('#crAnchor button').forEach((x) => x.classList.toggle('on', x === b));
        };
      },
    });
  });

  // Drawing Guide: a grid, an isometric grid, or symmetry guides that mirror your strokes.
  const guide = document.createElement('canvas');
  guide.className = 'guide-view';
  studio.addOverlay(guide, 650);
  function drawGuide() {
    const gp = prefs.guide;
    const on = $('prefGuide').checked;
    painter.symmetry = on && gp.type === 'sym' ? gp.sym : 'none';
    const g = guide.getContext('2d');
    const d = studio.doc;
    if (!d) return;
    const W = Math.round(Math.min(1800, d.width)), H = Math.round(W * (d.height / d.width));
    if (guide.width !== W || guide.height !== H) {
      guide.width = W;
      guide.height = H;
    }
    g.clearRect(0, 0, W, H);
    if (!on) return;
    const k = W / d.width;
    g.strokeStyle = gp.colour;
    g.globalAlpha = gp.opacity;
    g.lineWidth = Math.max(1, gp.thick * 2 * k * (d.width / studio.paper.w) * 0.5);
    g.beginPath();
    if (gp.type === 'grid') {
      const s = gp.size * k;
      for (let x = s; x < W; x += s) (g.moveTo(x, 0), g.lineTo(x, H));
      for (let y = s; y < H; y += s) (g.moveTo(0, y), g.lineTo(W, y));
    } else if (gp.type === 'iso') {
      const s = gp.size * k;
      for (let x = -H; x < W + H; x += s) {
        g.moveTo(x, 0);
        g.lineTo(x + H / Math.tan(Math.PI / 6), H);
        g.moveTo(x, 0);
        g.lineTo(x - H / Math.tan(Math.PI / 6), H);
      }
      for (let x = s; x < W; x += s) (g.moveTo(x, 0), g.lineTo(x, H));
    } else {
      g.setLineDash([12, 8]);
      if (gp.sym === 'v' || gp.sym === 'q') (g.moveTo(W / 2, 0), g.lineTo(W / 2, H));
      if (gp.sym === 'h' || gp.sym === 'q') (g.moveTo(0, H / 2), g.lineTo(W, H / 2));
      g.globalAlpha = Math.max(0.7, gp.opacity);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
  $('prefGuide').addEventListener('input', () => {
    drawGuide();
    if ($('prefGuide').checked && prefs.guide.type === 'sym') toast('Symmetry on: what you draw is mirrored across the guide.', 2600);
  });
  studio.on('doc', drawGuide);
  studio.on('layout', () => $('prefGuide').checked && drawGuide());
  $('btnGuideOpts').addEventListener('click', () => {
    closePopovers();
    const gp = prefs.guide;
    dialog({
      title: 'Drawing guide',
      body: `<div class="seg" id="gdType">${[['grid', '2D grid'], ['iso', 'Isometric'], ['sym', 'Symmetry']].map(([id, l]) => `<button class="seg-btn ${gp.type === id ? 'active' : ''}" data-t="${id}">${l}</button>`).join('')}</div>
        <div id="gdGrid" class="${gp.type === 'sym' ? 'hidden' : ''}"><label class="dlg-slide">Grid size<input id="gdSize" type="range" min="16" max="400" value="${gp.size}"><output>${gp.size}</output></label>
        <label class="dlg-slide">Thickness<input id="gdThick" type="range" min="1" max="8" value="${gp.thick}"><output>${gp.thick}</output></label></div>
        <div id="gdSym" class="seg ${gp.type === 'sym' ? '' : 'hidden'}">${[['v', 'Vertical'], ['h', 'Horizontal'], ['q', 'Quadrant']].map(([id, l]) => `<button class="seg-btn ${gp.sym === id ? 'active' : ''}" data-s="${id}">${l}</button>`).join('')}</div>
        <label class="dlg-slide">Opacity<input id="gdOp" type="range" min="10" max="100" value="${Math.round(gp.opacity * 100)}"><output>${Math.round(gp.opacity * 100)}%</output></label>
        <label class="dlg-slide">Colour<input id="gdCol" type="color" value="${gp.colour}"></label>`,
      actions: [{ label: 'Done', primary: true }],
      onOpen: (root) => {
        const redraw = () => {
          save();
          if (!$('prefGuide').checked) {
            $('prefGuide').checked = true;
          }
          drawGuide();
        };
        root.querySelector('#gdType').onclick = (e) => {
          const b = e.target.closest('[data-t]');
          if (!b) return;
          gp.type = b.dataset.t;
          root.querySelectorAll('#gdType button').forEach((x) => x.classList.toggle('active', x === b));
          root.querySelector('#gdGrid').classList.toggle('hidden', gp.type === 'sym');
          root.querySelector('#gdSym').classList.toggle('hidden', gp.type !== 'sym');
          redraw();
        };
        root.querySelector('#gdSym').onclick = (e) => {
          const b = e.target.closest('[data-s]');
          if (!b) return;
          gp.sym = b.dataset.s;
          root.querySelectorAll('#gdSym button').forEach((x) => x.classList.toggle('active', x === b));
          redraw();
        };
        root.oninput = (e) => {
          const out = e.target.nextElementSibling;
          if (e.target.id === 'gdSize') gp.size = Number(e.target.value);
          else if (e.target.id === 'gdThick') gp.thick = Number(e.target.value);
          else if (e.target.id === 'gdOp') gp.opacity = Number(e.target.value) / 100;
          else if (e.target.id === 'gdCol') gp.colour = e.target.value;
          else return;
          if (out?.tagName === 'OUTPUT') out.textContent = e.target.id === 'gdOp' ? `${e.target.value}%` : e.target.value;
          redraw();
        };
      },
    });
  });

  // ------------------------------------------------------------ Share
  // The layers of the artwork as export items, with the live character and the picture behind them.
  function exportLayers() {
    const d = studio.doc;
    const out = [];
    // The playground picture, when it is showing, is the bottom layer.
    const img = bgImage();
    if (d.bg.image && d.bg.imageVisible && img?.complete && img.naturalWidth) {
      const c = studio.makeCanvas(d.width, d.height);
      c.classList.remove('layer-canvas');
      const k = Math.max(d.width / img.naturalWidth, d.height / img.naturalHeight);
      c.getContext('2d').drawImage(img, (d.width - img.naturalWidth * k) / 2, (d.height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      out.push({ id: 'bgpic', type: 'paint', name: 'Playground', visible: true, opacity: 1, blend: 'normal', parent: null, canvas: c });
    }
    for (const l of d.layers) {
      if (l.type === 'paint') out.push({ id: l.id, type: 'paint', name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, parent: l.parent, canvas: l.canvas, mask: l.mask });
      else if (l.type === 'group') out.push({ id: l.id, type: 'group', name: l.name, visible: l.visible, opacity: l.opacity, blend: 'normal', parent: l.parent });
      else if (l.type === 'rig' && $('optShow').checked) {
        const c = studio.makeCanvas(d.width, d.height);
        c.classList.remove('layer-canvas');
        const p = studio.paper;
        const sx = stage.width / $('workspace').offsetWidth, sy = stage.height / $('workspace').offsetHeight;
        c.getContext('2d').drawImage(stage, p.x * sx, p.y * sy, p.w * sx, p.h * sy, 0, 0, d.width, d.height);
        out.push({ id: 'rig', type: 'paint', name: 'Motion Rig', visible: true, opacity: 1, blend: 'normal', parent: null, canvas: c });
      }
    }
    return out;
  }
  async function share(fmt) {
    closePopovers();
    const d = studio.doc;
    const base = fileName(d.name);
    try {
      if (fmt === 'png') download(await toPNG(studio.flatten()), `${base}.png`);
      else if (fmt === 'jpg') download(await toJPEG(studio.flatten()), `${base}.jpg`);
      else if (fmt === 'pdf') download(await toPDF(studio.flatten(), { dpi: d.dpi }), `${base}.pdf`);
      else if (fmt === 'psd') download(toPSD(exportLayers().filter((l) => l.type === 'paint'), d), `${base}.psd`);
      else if (fmt === 'promove') {
        await studio.saveNow();
        download(await toPromove(await studio.serialize()), `${base}.promove`);
      } else if (fmt === 'layerpngs') {
        const ls = exportLayers().filter((l) => l.type === 'paint' && l.visible !== false);
        for (let i = 0; i < ls.length; i++) {
          download(await toPNG(ls[i].canvas), `${base}-${String(i + 1).padStart(2, '0')}-${fileName(ls[i].name)}.png`);
          await new Promise((r) => setTimeout(r, 250)); // browsers drop downloads that arrive all at once
        }
      } else if (fmt === 'flat') download(await toPNG(flattenLayers(exportLayers(), { width: d.width, height: d.height, bgColor: d.bg.color, transparent: true })), `${base}-layers.png`);
      toast('Saved to your downloads.', 1800);
    } catch (err) {
      console.error(err);
      toast('Could not export that.', 3500);
    }
  }
  for (const b of document.querySelectorAll('[data-share]')) b.addEventListener('click', () => share(b.dataset.share));

  // ------------------------------------------------------------ Video: time-lapse
  const lapse = { frames: [], on: true, last: 0 };
  function snap() {
    if (!lapse.on || !studio.doc) return;
    const now = performance.now();
    if (now - lapse.last < 500) return;
    lapse.last = now;
    const c = studio.flatten({ width: 640, rig: true });
    lapse.frames.push(c);
    if (lapse.frames.length > 240) lapse.frames = lapse.frames.filter((_, i) => i % 2 === 0);
    $('lapseCount').textContent = `${lapse.frames.length} frames recorded`;
  }
  studio.on('change', snap);
  studio.on('doc', () => {
    lapse.frames = [];
    $('lapseCount').textContent = '0 frames recorded';
  });
  $('lapseOn').addEventListener('input', () => (lapse.on = $('lapseOn').checked));
  function replay(record = false) {
    if (lapse.frames.length < 2) return toast('Draw a little more first: the time-lapse has fewer than two frames.');
    closePopovers();
    const w = lapse.frames[0].width, h = lapse.frames[0].height;
    const d = dialog({ title: record ? 'Exporting time-lapse…' : 'Time-lapse replay', body: `<canvas id="lapseCv" width="${w}" height="${h}" class="lapse-cv"></canvas>`, actions: [{ label: record ? 'Cancel' : 'Close' }], width: 560 });
    const cv = $('lapseCv');
    const g = cv.getContext('2d');
    let rec = null, chunks = [];
    if (record) {
      if (typeof MediaRecorder === 'undefined' || !cv.captureStream) return (d.close(), toast('This browser can not record video.'));
      const stream = cv.captureStream(12);
      rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => chunks.length && download(new Blob(chunks, { type: 'video/webm' }), `${fileName(studio.doc.name)}-timelapse.webm`);
      rec.start();
    }
    let i = 0;
    const tick = () => {
      if ($('dlg').classList.contains('hidden')) return rec?.state === 'recording' && rec.stop();
      g.drawImage(lapse.frames[i], 0, 0);
      i++;
      if (i >= lapse.frames.length) {
        if (record) {
          setTimeout(() => (rec.stop(), d.close(), toast('Time-lapse saved.')), 400);
          return;
        }
        i = 0;
      }
      setTimeout(tick, 1000 / 12);
    };
    tick();
  }
  $('lapseReplay').addEventListener('click', () => replay(false));
  $('lapseExport').addEventListener('click', () => replay(true));

  // ------------------------------------------------------------ Prefs
  $('prefDynamic').addEventListener('input', () => {
    prefs.dynamic = $('prefDynamic').checked;
    save();
    apply();
  });
  $('prefSelVis').addEventListener('input', () => {
    prefs.selVis = Number($('prefSelVis').value) / 100;
    $('prefSelVisOut').textContent = `${Number($('prefSelVis').value).toFixed(1)}%`;
    document.documentElement.style.setProperty('--sel-vis', String(prefs.selVis));
    save();
  });
  $('btnPressure').addEventListener('click', () => {
    closePopovers();
    dialog({
      title: 'Pressure and smoothing',
      width: 520,
      body: `<canvas id="prCurve" width="240" height="240"></canvas>
        <div class="dlg-col grow">
          <div class="seg" id="prPresets">${[['Soft', 0.6], ['Medium', 1], ['Firm', 1.6]].map(([l, v]) => `<button class="seg-btn" data-g="${v}">${l}</button>`).join('')}</div>
          <label class="dlg-slide">Pressure curve<input id="prGamma" type="range" min="40" max="220" value="${Math.round(prefs.gamma * 100)}"><output>${prefs.gamma.toFixed(2)}</output></label>
          <label class="dlg-slide">Stabilisation<input id="prSmooth" type="range" min="0" max="100" value="${Math.round(prefs.smooth * 100)}"><output>${Math.round(prefs.smooth * 100)}%</output></label>
          <canvas id="prPad" width="440" height="150"></canvas>
          <p class="hint" style="margin:6px 0 0">Try a line on the pad. With an Apple Pencil a lighter press makes a thinner line. A mouse or finger always draws at full pressure.</p>
        </div>`,
      actions: [{ label: 'Done', primary: true }],
      onOpen: (root) => {
        const cv = root.querySelector('#prCurve'), cg = cv.getContext('2d');
        const drawCurve = () => {
          cg.clearRect(0, 0, 240, 240);
          cg.fillStyle = 'rgba(120,120,128,.16)';
          cg.fillRect(0, 0, 240, 240);
          cg.strokeStyle = 'rgba(30,139,255,.95)';
          cg.lineWidth = 3;
          cg.beginPath();
          for (let x = 0; x <= 240; x += 4) {
            const y = 240 - Math.pow(x / 240, prefs.gamma) * 240;
            x ? cg.lineTo(x, y) : cg.moveTo(x, y);
          }
          cg.stroke();
        };
        drawCurve();
        const pad = root.querySelector('#prPad'), pg = pad.getContext('2d');
        let last = null;
        pad.addEventListener('pointerdown', (e) => (pad.setPointerCapture(e.pointerId), (last = pt(e))));
        pad.addEventListener('pointermove', (e) => {
          if (!last) return;
          const p = pt(e);
          const press = Math.pow(e.pointerType === 'pen' ? e.pressure || 0.5 : 1, prefs.gamma);
          pg.strokeStyle = '#1e8bff';
          pg.lineCap = 'round';
          pg.lineWidth = 2 + press * 16;
          pg.beginPath();
          pg.moveTo(last.x, last.y);
          pg.lineTo(p.x, p.y);
          pg.stroke();
          last = p;
        });
        pad.addEventListener('pointerup', () => (last = null));
        const pt = (e) => {
          const r = pad.getBoundingClientRect();
          return { x: ((e.clientX - r.left) * pad.width) / r.width, y: ((e.clientY - r.top) * pad.height) / r.height };
        };
        root.oninput = (e) => {
          if (e.target.id === 'prGamma') prefs.gamma = Number(e.target.value) / 100;
          else if (e.target.id === 'prSmooth') prefs.smooth = Number(e.target.value) / 100;
          else return;
          e.target.nextElementSibling.textContent = e.target.id === 'prGamma' ? prefs.gamma.toFixed(2) : `${e.target.value}%`;
          drawCurve();
          apply();
          save();
        };
        root.querySelector('#prPresets').onclick = (e) => {
          const b = e.target.closest('[data-g]');
          if (!b) return;
          prefs.gamma = Number(b.dataset.g);
          root.querySelector('#prGamma').value = prefs.gamma * 100;
          root.querySelector('#prGamma').nextElementSibling.textContent = prefs.gamma.toFixed(2);
          drawCurve();
          apply();
          save();
        };
      },
    });
  });
  $('btnGestures').addEventListener('click', () => {
    closePopovers();
    const rows = [
      ['zoom', 'Pinch to zoom and pan', 'Two fingers move and zoom the canvas'],
      ['undo', 'Two-finger tap: Undo', 'A quick tap with two fingers'],
      ['redo', 'Three-finger tap: Redo', 'A quick tap with three fingers'],
      ['hideUI', 'Four-finger tap: hide the interface', 'Tap again, or tap the corner button, to bring it back'],
      ['hold', 'Touch and hold: Eyedropper', 'Hold still on the canvas to pick that colour'],
      ['touchDraw', 'Draw with a finger', 'Off: only the Pencil paints, fingers just move the canvas'],
    ];
    dialog({
      title: 'Gesture controls',
      body: rows.map(([k, l, s]) => `<label class="dlg-row line"><span><b>${l}</b><small>${s}</small></span><input type="checkbox" class="switch" data-k="${k}" ${prefs[k] ? 'checked' : ''}></label>`).join(''),
      actions: [{ label: 'Done', primary: true }],
      onOpen: (root) => {
        root.oninput = (e) => {
          if (!e.target.dataset.k) return;
          prefs[e.target.dataset.k] = e.target.checked;
          save();
        };
      },
    });
  });

  apply();
  return { prefs, apply, drawGuide, share };
}
