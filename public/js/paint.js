// Painting on the active layer: brush, smudge and eraser, with Procreate-like brushes.
//
// A brush line is a run of stamps (see brushes.js) laid along a smoothed path. The brush tool
// paints into a separate stroke canvas shown at the brush opacity, then lays the finished stroke
// onto the layer in one go, so overlapping stamps never darken it. The eraser and smudge work on
// the layer directly. Alpha lock, masks and the selection are all respected, and every stroke is
// one undo step that remembers only the pixels it touched.
import { stamp, tip } from './brushes.js';

const rnd = Math.random;
const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

export class Painter {
  constructor(studio, strokeCanvas) {
    this.studio = studio;
    this.stroke = strokeCanvas;
    this.sctx = strokeCanvas.getContext('2d');
    this.tool = 'brush';
    this.brush = { hardness: 0.8, spacing: 0.06, flow: 1, grain: 0, scatter: 0, pressureSize: 0.4, pressureOpacity: 0, smoothing: 0.2 };
    this.color = '#000000';
    this.size = 18; // iPad points
    this.opacity = 1;
    this.gamma = 1; // pressure curve: below 1 is lighter to reach full width, above 1 needs a harder press
    this.picking = false;
    this.onPick = null;
    this.onError = null;
    this.onStroke = null; // called when a stroke lands
    this.extraSmoothing = 0; // global stabilisation added to every brush (Prefs)
    this.dynamic = true; // keep the brush the same size on screen when the canvas is zoomed
    this.symmetry = 'none'; // 'none' | 'v' | 'h' | 'q': strokes are mirrored (Drawing Guide)
    this.s = null; // the stroke in progress
    this.snap = document.createElement('canvas');
  }

  get busy() {
    return !!this.s;
  }

  // Pointer event → pixels of the artwork (works with the scaled iPad frame, zoom and fitted paper).
  toCanvas(e) {
    const r = this.stroke.getBoundingClientRect();
    const pen = e.pointerType === 'pen';
    const raw = pen ? e.pressure || 0.5 : 1;
    return {
      x: ((e.clientX - r.left) * this.stroke.width) / r.width,
      y: ((e.clientY - r.top) * this.stroke.height) / r.height,
      p: Math.pow(Math.max(0.02, raw), this.gamma),
      pen,
    };
  }
  get k() {
    return this.stroke.width / this.studio.paper.w / (this.dynamic ? this.studio.view.s : 1); // artwork pixels per iPad point
  }

  down(e) {
    const pt = this.toCanvas(e);
    if (this.picking) {
      this.onPick?.(this.sample(pt));
      return;
    }
    const t = this.studio.paintTarget();
    if (!t) return;
    if (t.error) return this.onError?.(t.error);
    if (this.tool === 'eraser' && t.layer.alphaLock && !t.isMask) return this.onError?.('Alpha lock is on, so there is nothing to erase. Turn it off to erase.');
    const sizePx = Math.max(1, this.size * this.k);
    this.snap.width = t.canvas.width;
    this.snap.height = t.canvas.height;
    this.snap.getContext('2d').drawImage(t.canvas, 0, 0);
    if (this.tool === 'brush') {
      this.stroke.style.opacity = String(this.opacity);
      this.sctx.clearRect(0, 0, this.stroke.width, this.stroke.height);
    }
    this.s = { t, sizePx, raw: pt, sm: pt, prev: pt, mid: pt, carry: 0, rect: null, carryCanvas: null };
    if (this.tool === 'smudge') this.beginSmudge(pt);
    this.lay(pt);
  }

  move(e) {
    if (!this.s) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.extend(this.toCanvas(ev));
  }

  // Add a point to the path: smooth it, then lay stamps along the curve from the last midpoint.
  extend(pt) {
    const s = this.s;
    const a = 1 - Math.min(0.9, ((this.brush.smoothing || 0) + this.extraSmoothing) * 0.85);
    const sm = { x: s.sm.x + (pt.x - s.sm.x) * a, y: s.sm.y + (pt.y - s.sm.y) * a, p: s.sm.p + (pt.p - s.sm.p) * 0.5, pen: pt.pen };
    const mid = { x: (s.prev.x + sm.x) / 2, y: (s.prev.y + sm.y) / 2, p: (s.prev.p + sm.p) / 2 };
    const from = s.mid;
    const chord = Math.hypot(mid.x - from.x, mid.y - from.y) + Math.hypot(sm.x - from.x, sm.y - from.y) * 0.0;
    const step = Math.max(0.75, s.sizePx * (this.brush.spacing || 0.06) * 0.5);
    const n = Math.max(1, Math.ceil(chord / step));
    let last = from;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      // Quadratic curve: from the last midpoint, bending toward the new point, to the new midpoint.
      const x = (1 - u) * (1 - u) * from.x + 2 * (1 - u) * u * s.prev.x + u * u * mid.x;
      const y = (1 - u) * (1 - u) * from.y + 2 * (1 - u) * u * s.prev.y + u * u * mid.y;
      const p = from.p + (mid.p - from.p) * u;
      this.along(last, { x, y, p });
      last = { x, y, p };
    }
    s.prev = sm;
    s.sm = sm;
    s.mid = mid;
  }
  // Walk from one sample to the next, stamping every `spacing` pixels.
  along(a, b) {
    const s = this.s;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (!dist) return;
    const spacing = Math.max(0.6, s.sizePx * (this.brush.spacing || 0.06));
    let d = spacing - s.carry;
    while (d <= dist) {
      const u = d / dist;
      this.lay({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, p: a.p + (b.p - a.p) * u }, Math.atan2(b.y - a.y, b.x - a.x));
      d += spacing;
    }
    s.carry = dist - (d - spacing);
  }

  // One dab at a point.
  lay(pt, dir = 0) {
    const s = this.s;
    const b = this.brush;
    const sizeK = 1 - (b.pressureSize || 0) * (1 - pt.p);
    const alphaK = 1 - (b.pressureOpacity || 0) * (1 - pt.p);
    const dia = Math.max(1, s.sizePx * sizeK);
    let { x, y } = pt;
    if (b.scatter) {
      x += (rnd() - 0.5) * 2 * b.scatter * dia;
      y += (rnd() - 0.5) * 2 * b.scatter * dia;
    }
    const flow = (b.flow ?? 1) * alphaK;
    const r = dia / 2 + 2;
    const W = this.stroke.width, H = this.stroke.height;
    // With a symmetry guide on, every dab is repeated across the guide (not for smudge).
    const at = [[x, y]];
    if (this.tool !== 'smudge' && this.symmetry !== 'none') {
      if (this.symmetry === 'v' || this.symmetry === 'q') at.push([W - x, y]);
      if (this.symmetry === 'h' || this.symmetry === 'q') at.push([x, H - y]);
      if (this.symmetry === 'q') at.push([W - x, H - y]);
    }
    for (const [px, py] of at) {
      s.rect = s.rect
        ? { x0: Math.min(s.rect.x0, px - r), y0: Math.min(s.rect.y0, py - r), x1: Math.max(s.rect.x1, px + r), y1: Math.max(s.rect.y1, py + r) }
        : { x0: px - r, y0: py - r, x1: px + r, y1: py + r };
      if (this.tool === 'brush') {
        stamp(this.sctx, b, px, py, dia, flow, this.color, 0);
        this.sctx.globalAlpha = 1;
      } else if (this.tool === 'eraser') {
        const ctx = s.t.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        stamp(ctx, b, px, py, dia, flow * this.opacity, '#000000', 0);
        ctx.restore();
      } else {
        this.smudgeStep(px, py, dia, flow * this.opacity);
      }
    }
  }

  // Abandon the stroke in progress (a second finger landed, or a touch-and-hold became an eyedropper).
  cancelStroke() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    s.t.ctx.save();
    s.t.ctx.setTransform(1, 0, 0, 1, 0, 0);
    s.t.ctx.clearRect(0, 0, s.t.canvas.width, s.t.canvas.height);
    s.t.ctx.drawImage(this.snap, 0, 0);
    s.t.ctx.restore();
    this.sctx.clearRect(0, 0, this.stroke.width, this.stroke.height);
    this.stroke.style.opacity = '';
  }

  // Smudge: carry the paint under the brush along, laying it down a little at each step.
  beginSmudge(pt) {
    const s = this.s;
    const d = Math.ceil(s.sizePx);
    const c = document.createElement('canvas');
    c.width = c.height = d;
    c.getContext('2d').drawImage(s.t.canvas, Math.round(pt.x - d / 2), Math.round(pt.y - d / 2), d, d, 0, 0, d, d);
    s.carryCanvas = c;
    s.smudgeFirst = true;
  }
  smudgeStep(x, y, dia, strength) {
    const s = this.s;
    const c = s.carryCanvas;
    const d = c.width;
    const bx = Math.round(x - d / 2), by = Math.round(y - d / 2);
    const ctx = s.t.ctx;
    if (s.smudgeFirst) {
      s.smudgeFirst = false;
      return;
    }
    // The carried paint, shaped by the brush tip, laid onto the layer.
    const shaped = document.createElement('canvas');
    shaped.width = shaped.height = d;
    const g = shaped.getContext('2d');
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(tip(this.brush, d, '#000000'), 0, 0, d, d);
    ctx.save();
    ctx.globalAlpha = Math.min(1, strength * 0.9);
    ctx.drawImage(shaped, bx, by);
    ctx.restore();
    // Pick up some of what is there now.
    const cg = c.getContext('2d');
    cg.save();
    cg.globalAlpha = 0.3;
    cg.drawImage(s.t.canvas, bx, by, d, d, 0, 0, d, d);
    cg.restore();
  }

  up() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    const { t } = s;
    const W = t.canvas.width, H = t.canvas.height;
    if (!s.rect) return;
    const rect = {
      x: Math.max(0, Math.floor(s.rect.x0)), y: Math.max(0, Math.floor(s.rect.y0)),
      w: 0, h: 0,
    };
    rect.w = Math.min(W, Math.ceil(s.rect.x1)) - rect.x;
    rect.h = Math.min(H, Math.ceil(s.rect.y1)) - rect.y;
    const clearStroke = () => {
      this.sctx.clearRect(0, 0, this.stroke.width, this.stroke.height);
      this.stroke.style.opacity = '';
    };
    if (rect.w <= 0 || rect.h <= 0) return clearStroke();
    const selection = this.studio.selection;
    const ctx = t.ctx;
    if (this.tool === 'brush') {
      let src = this.stroke;
      if (selection) {
        const tmp = this.studio.makeCanvas(W, H);
        tmp.classList.remove('layer-canvas');
        const g = tmp.getContext('2d');
        g.drawImage(this.stroke, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(selection, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
        src = tmp;
      }
      ctx.save();
      ctx.globalAlpha = this.opacity;
      if (t.isMask) ctx.globalCompositeOperation = luma(this.color) < 0.5 ? 'destination-out' : 'source-over';
      else if (t.layer.alphaLock) ctx.globalCompositeOperation = 'source-atop';
      ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      clearStroke();
    } else if ((selection || t.layer.alphaLock) && !t.isMask) {
      this.constrain(t, rect, selection);
    } else if (selection) {
      this.constrain(t, rect, selection);
    }
    const before = this.snap.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
    this.studio.pushHistory(this.studio.rectEntry(this.tool === 'brush' ? 'Paint' : this.tool === 'eraser' ? 'Erase' : 'Smudge', t.canvas, rect, before));
    if (t.isMask) this.studio.maskChanged(t.layer);
    this.studio.emit('pixels', t.layer);
    this.onStroke?.();
  }

  // Keep the stroke inside the selection (and, with alpha lock, inside what was already painted).
  constrain(t, rect, selection) {
    const ctx = t.ctx;
    const after = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const before = this.snap.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
    const sel = selection ? selection.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h).data : null;
    const lock = t.layer.alphaLock && !t.isMask;
    const A = after.data, B = before.data;
    for (let i = 0; i < A.length; i += 4) {
      const m = sel ? sel[i + 3] / 255 : 1;
      if (m < 1) for (let c = 0; c < 4; c++) A[i + c] = B[i + c] + (A[i + c] - B[i + c]) * m;
      if (lock) A[i + 3] = B[i + 3];
    }
    ctx.putImageData(after, rect.x, rect.y);
  }

  // The colour you see at a point: every visible layer, the picture behind and the character.
  sample(pt) {
    return this.studio.sampleAt(pt.x, pt.y);
  }

  // Whole-layer helpers used by the Actions menu.
  clear() {
    const l = this.studio.active;
    if (l?.canvas) this.studio.clearLayer(l.id);
  }
  insertImage(img) {
    const doc = this.studio.doc;
    const c = this.studio.makeCanvas(doc.width, doc.height);
    c.classList.remove('layer-canvas');
    const k = Math.min(1, (doc.width * 0.8) / img.width, (doc.height * 0.8) / img.height);
    const w = img.width * k, h = img.height * k;
    c.getContext('2d').drawImage(img, (doc.width - w) / 2, (doc.height - h) / 2, w, h);
    return this.studio.addLayerWith(c, this.studio.unique('Photo'));
  }
  undo() {
    return this.studio.undo();
  }
  redo() {
    return this.studio.redo();
  }
}
