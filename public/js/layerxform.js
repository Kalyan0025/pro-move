// Transform for a drawing layer (or what is selected on it), like Procreate's: Uniform, Freeform,
// Distort and Warp, with snapping, Flip, Rotate 45° and Fit to canvas. While you drag, a small
// preview is drawn over the canvas; Done renders it at full size. Nothing changes until Done, and
// Done is one undo step. (The live character has its own Transform; this one is for layers.)
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const rot = (p, c, a) => {
  const s = Math.sin(a), co = Math.cos(a), d = sub(p, c);
  return { x: c.x + d.x * co - d.y * s, y: c.y + d.x * s + d.y * co };
};

// Draw an image onto a context through a mesh: pointAt(u, v) says where each spot of the image goes.
function drawMesh(g, img, pointAt, cells) {
  const sw = img.width, sh = img.height;
  const grid = [];
  for (let j = 0; j <= cells; j++) {
    const row = [];
    for (let i = 0; i <= cells; i++) row.push({ s: { x: (i / cells) * sw, y: (j / cells) * sh }, d: pointAt(i / cells, j / cells) });
    grid.push(row);
  }
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      triangle(g, img, a, b, c);
      triangle(g, img, a, c, d);
    }
  }
}
function triangle(g, img, p0, p1, p2) {
  const [s0, s1, s2] = [p0.s, p1.s, p2.s];
  const [d0, d1, d2] = [p0.d, p1.d, p2.d];
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  // Clip a hair outside the triangle so neighbours overlap and no seam shows.
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p) => {
    const dx = p.x - cx, dy = p.y - cy, L = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / L) * 0.8, y: p.y + (dy / L) * 0.8 };
  };
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  g.save();
  g.beginPath();
  g.moveTo(g0.x, g0.y);
  g.lineTo(g1.x, g1.y);
  g.lineTo(g2.x, g2.y);
  g.closePath();
  g.clip();
  g.transform(a, b, c, d, e, f);
  g.drawImage(img, 0, 0);
  g.restore();
}
// Catmull-Rom through four control points along one axis (t in 0..1 over the whole run).
function spline(pts, t) {
  const n = pts.length - 1;
  const x = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const u = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

export function createLayerTransform({ studio, toast, getSelection, clearSelection }) {
  const view = document.createElement('canvas');
  view.className = 'xf-view';
  studio.addOverlay(view, 760);
  const vg = view.getContext('2d');
  const bar = $('xfBar');
  let active = false;
  let mode = 'uniform';
  let snapping = true;
  let smooth = true;
  let layer = null;
  let before = null; // the layer as it was
  let src = null; // the lifted pixels, cropped to what is painted
  let box = null; // where src was, in artwork pixels
  let Q = null; // four corners (TL, TR, BR, BL) in artwork pixels
  let G = null; // 4 x 4 control points for Warp
  let drag = null;
  let guides = [];

  const D = () => studio.doc;
  const k = () => view.width / D().width; // artwork pixels → overlay pixels
  const cssK = () => view.width / studio.paper.w; // iPad points → overlay pixels

  // ------------------------------------------------------------ geometry
  const centre = () => ({ x: (Q[0].x + Q[1].x + Q[2].x + Q[3].x) / 4, y: (Q[0].y + Q[1].y + Q[2].y + Q[3].y) / 4 });
  const quadAt = (u, v) => {
    const top = add(mul(Q[0], 1 - u), mul(Q[1], u)), bot = add(mul(Q[3], 1 - u), mul(Q[2], u));
    return add(mul(top, 1 - v), mul(bot, v));
  };
  const gridAt = (u, v) => {
    const rows = G.map((row) => spline(row, u));
    return spline(rows, v);
  };
  const pointAt = () => (mode === 'warp' ? gridAt : quadAt);
  function resetQuad() {
    Q = [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
    G = [];
    for (let r = 0; r < 4; r++) {
      G.push([]);
      for (let c = 0; c < 4; c++) G[r].push(quadAt(c / 3, r / 3));
    }
  }
  const gridFromQuad = () => {
    G = [];
    for (let r = 0; r < 4; r++) {
      G.push([]);
      for (let c = 0; c < 4; c++) G[r].push(quadAt(c / 3, r / 3));
    }
  };
  const isParallelogram = () => Math.hypot(Q[0].x + Q[2].x - Q[1].x - Q[3].x, Q[0].y + Q[2].y - Q[1].y - Q[3].y) < 0.5;

  // ------------------------------------------------------------ drawing
  function render(full = false) {
    const d = D();
    const f = full ? 1 : k();
    const g = full ? layer.ctx : vg;
    if (!full) {
      if (view.width !== Math.round(studio.paper.w * Math.min(2, window.devicePixelRatio || 1))) {
        view.width = Math.round(studio.paper.w * Math.min(2, window.devicePixelRatio || 1));
        view.height = Math.round(studio.paper.h * Math.min(2, window.devicePixelRatio || 1));
      }
      vg.clearRect(0, 0, view.width, view.height);
    }
    const sc = full ? 1 : k();
    const S = full ? src : preview();
    g.save();
    g.imageSmoothingEnabled = smooth;
    g.imageSmoothingQuality = 'high';
    if (mode !== 'warp' && mode !== 'distort' && isParallelogram()) {
      const U = sub(Q[1], Q[0]), V = sub(Q[3], Q[0]);
      g.setTransform((U.x * sc) / S.width, (U.y * sc) / S.width, (V.x * sc) / S.height, (V.y * sc) / S.height, Q[0].x * sc, Q[0].y * sc);
      g.drawImage(S, 0, 0);
    } else {
      const at = pointAt();
      const sc2 = (u, v) => {
        const p = at(u, v);
        return { x: p.x * sc, y: p.y * sc };
      };
      drawMesh(g, S, sc2, full ? 20 : 12);
    }
    g.restore();
    if (!full) handles();
    void f;
    void d;
  }
  let small = null;
  function preview() {
    // A reduced copy of the lifted pixels, so dragging stays smooth on large artworks.
    const maxSide = Math.max(src.width, src.height);
    const need = Math.min(1, (Math.max(box.w, box.h) * k() * 2) / maxSide);
    if (small && small.k === need) return small.c;
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(src.width * need));
    c.height = Math.max(2, Math.round(src.height * need));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    small = { c, k: need };
    return c;
  }
  function handleSpots() {
    const spots = [];
    if (mode === 'warp') {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) spots.push({ id: `g${r}${c}`, p: G[r][c] });
    } else {
      Q.forEach((p, i) => spots.push({ id: `c${i}`, p }));
      if (mode === 'freeform') for (let i = 0; i < 4; i++) spots.push({ id: `e${i}`, p: mul(add(Q[i], Q[(i + 1) % 4]), 0.5) });
      if (mode === 'uniform' || mode === 'freeform') {
        const top = mul(add(Q[0], Q[1]), 0.5), c = centre();
        const dir = sub(top, mul(add(Q[2], Q[3]), 0.5));
        const L = Math.hypot(dir.x, dir.y) || 1;
        spots.push({ id: 'rot', p: add(top, mul(dir, (46 / cssK() / k()) / L)) });
      }
      void centre;
    }
    return spots;
  }
  function handles() {
    const kk = k(), ck = cssK();
    vg.save();
    vg.lineWidth = 1.6 * ck;
    vg.strokeStyle = 'rgba(30,139,255,.95)';
    vg.fillStyle = '#fff';
    vg.beginPath();
    if (mode === 'warp') {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const p = G[r][c];
          c ? vg.lineTo(p.x * kk, p.y * kk) : vg.moveTo(p.x * kk, p.y * kk);
        }
      }
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          const p = G[r][c];
          r ? vg.lineTo(p.x * kk, p.y * kk) : vg.moveTo(p.x * kk, p.y * kk);
        }
      }
    } else {
      Q.forEach((p, i) => (i ? vg.lineTo(p.x * kk, p.y * kk) : vg.moveTo(p.x * kk, p.y * kk)));
      vg.closePath();
    }
    vg.stroke();
    // snapping guides
    vg.setLineDash([6 * ck, 5 * ck]);
    vg.strokeStyle = 'rgba(255,204,0,.95)';
    for (const gd of guides) {
      vg.beginPath();
      if (gd.x != null) {
        vg.moveTo(gd.x * kk, 0);
        vg.lineTo(gd.x * kk, view.height);
      } else {
        vg.moveTo(0, gd.y * kk);
        vg.lineTo(view.width, gd.y * kk);
      }
      vg.stroke();
    }
    vg.setLineDash([]);
    for (const s of handleSpots()) {
      const x = s.p.x * kk, y = s.p.y * kk;
      vg.beginPath();
      if (s.id === 'rot') {
        const top = s.p;
        vg.moveTo(top.x * kk, top.y * kk);
      }
      vg.arc(x, y, (s.id[0] === 'e' ? 6 : 8.5) * ck, 0, Math.PI * 2);
      vg.fillStyle = s.id === 'rot' ? '#1e8bff' : '#fff';
      vg.fill();
      vg.strokeStyle = 'rgba(30,139,255,.95)';
      vg.lineWidth = 2 * ck;
      vg.stroke();
    }
    vg.restore();
  }

  // ------------------------------------------------------------ pointer
  const toDoc = (e) => {
    const r = view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * D().width) / r.width, y: ((e.clientY - r.top) * D().height) / r.height };
  };
  const hitRadius = () => 24 / (studio.paper.k * (studio.paper.w / D().width)) / (D().width / studio.paper.w) / 1; // 24 iPad points in artwork pixels
  const pxPerPoint = () => D().width / studio.paper.w;
  function inside(p) {
    const poly = mode === 'warp' ? [G[0][0], G[0][3], G[3][3], G[3][0]] : Q;
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    }
    return c;
  }
  function down(e) {
    const p = toDoc(e);
    const R = 26 * pxPerPoint();
    let hit = null, best = R;
    for (const s of handleSpots()) {
      const d = Math.hypot(s.p.x - p.x, s.p.y - p.y);
      if (d < best) [hit, best] = [s, d];
    }
    drag = { start: p, Q: Q.map((q) => ({ ...q })), G: G.map((r) => r.map((q) => ({ ...q }))), id: hit?.id || (inside(p) ? 'move' : null), c0: centre() };
    if (drag.id === 'rot') drag.a0 = Math.atan2(p.y - drag.c0.y, p.x - drag.c0.x);
    if (!drag.id) drag = null;
  }
  function move(e) {
    if (!drag) return;
    const p = toDoc(e);
    const d = sub(p, drag.start);
    guides = [];
    const id = drag.id;
    if (id === 'move') {
      let dd = d;
      if (snapping && mode !== 'warp') {
        const c = add(drag.c0, d), W = D().width / 2, H = D().height / 2, tol = 10 * pxPerPoint();
        if (Math.abs(c.x - W) < tol) {
          dd = { ...dd, x: dd.x + (W - c.x) };
          guides.push({ x: W });
        }
        if (Math.abs(c.y - H) < tol) {
          dd = { ...dd, y: dd.y + (H - c.y) };
          guides.push({ y: H });
        }
      }
      Q = drag.Q.map((q) => add(q, dd));
      G = drag.G.map((r) => r.map((q) => add(q, dd)));
    } else if (id === 'rot') {
      let da = Math.atan2(p.y - drag.c0.y, p.x - drag.c0.x) - drag.a0;
      if (snapping) {
        const step = (15 * Math.PI) / 180, snapped = Math.round(da / step) * step;
        if (Math.abs(da - snapped) < (4 * Math.PI) / 180) da = snapped;
      }
      Q = drag.Q.map((q) => rot(q, drag.c0, da));
      G = drag.G.map((r) => r.map((q) => rot(q, drag.c0, da)));
    } else if (id[0] === 'g') {
      const r = Number(id[1]), c = Number(id[2]);
      G = drag.G.map((row) => row.map((q) => ({ ...q })));
      G[r][c] = add(drag.G[r][c], d);
    } else if (mode === 'distort') {
      const i = Number(id[1]);
      Q = drag.Q.map((q) => ({ ...q }));
      Q[i] = add(drag.Q[i], d);
      gridFromQuad();
    } else if (id[0] === 'c') {
      cornerDrag(Number(id[1]), p);
    } else if (id[0] === 'e') {
      edgeDrag(Number(id[1]), p);
    }
    render();
  }
  // Drag a corner of a parallelogram: the opposite corner stays; Uniform keeps the shape.
  function cornerDrag(i, p) {
    const q = drag.Q;
    const O = q[0], U = sub(q[1], q[0]), V = sub(q[3], q[0]);
    const cx = i === 1 || i === 2 ? 1 : 0, cy = i === 2 || i === 3 ? 1 : 0;
    const opp = add(add(O, mul(U, 1 - cx)), mul(V, 1 - cy));
    const D0 = add(mul(U, 2 * cx - 1), mul(V, 2 * cy - 1));
    const dd = sub(p, opp);
    let U2, V2;
    if (mode === 'uniform') {
      const s = dot(dd, D0) / dot(D0, D0);
      U2 = mul(U, s);
      V2 = mul(V, s);
    } else {
      // Free: solve dd = a U + b V
      const det = U.x * V.y - U.y * V.x || 1e-9;
      const a = (dd.x * V.y - dd.y * V.x) / det, b = (U.x * dd.y - U.y * dd.x) / det;
      U2 = mul(U, a / (2 * cx - 1));
      V2 = mul(V, b / (2 * cy - 1));
    }
    const O2 = sub(sub(opp, mul(U2, 1 - cx)), mul(V2, 1 - cy));
    Q = [O2, add(O2, U2), add(add(O2, U2), V2), add(O2, V2)];
    gridFromQuad();
  }
  function edgeDrag(i, p) {
    const q = drag.Q;
    const O = q[0], U = sub(q[1], q[0]), V = sub(q[3], q[0]);
    let U2 = U, V2 = V, O2 = O;
    if (i === 0 || i === 2) {
      // top or bottom edge: scale along V
      const dir = mul(V, 1 / Math.hypot(V.x, V.y));
      const fixed = i === 0 ? add(O, V) : O;
      const along = dot(sub(p, fixed), dir);
      V2 = mul(dir, i === 0 ? -along : along);
      O2 = i === 0 ? add(fixed, V2) : O;
    } else {
      const dir = mul(U, 1 / Math.hypot(U.x, U.y));
      const fixed = i === 3 ? add(O, U) : O;
      const along = dot(sub(p, fixed), dir);
      U2 = mul(dir, i === 3 ? -along : along);
      O2 = i === 3 ? add(fixed, U2) : O;
    }
    Q = [O2, add(O2, U2), add(add(O2, U2), V2), add(O2, V2)];
    gridFromQuad();
  }
  function up() {
    drag = null;
    guides = [];
    render();
  }

  // ------------------------------------------------------------ begin, finish
  function begin() {
    const l = studio.active;
    if (!l || l.type !== 'paint') return false;
    if (l.locked) {
      toast('This layer is locked.');
      return false;
    }
    layer = l;
    const W = l.canvas.width, H = l.canvas.height;
    before = studio.grab(l.canvas);
    // Lift the pixels: the selected part, or the whole layer.
    const lifted = studio.makeCanvas(W, H);
    lifted.classList.remove('layer-canvas');
    const lg = lifted.getContext('2d');
    lg.drawImage(l.canvas, 0, 0);
    const sel = getSelection();
    if (sel) {
      lg.globalCompositeOperation = 'destination-in';
      lg.drawImage(sel, 0, 0);
    }
    // Where something is painted.
    const d = lg.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 2) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      toast(sel ? 'Nothing is painted inside the selection.' : 'This layer is empty. Draw something to transform.');
      layer = null;
      return false;
    }
    box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    src = studio.makeCanvas(box.w, box.h);
    src.classList.remove('layer-canvas');
    src.getContext('2d').drawImage(lifted, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    small = null;
    // Take the lifted pixels off the layer while moving them.
    if (sel) {
      l.ctx.save();
      l.ctx.globalCompositeOperation = 'destination-out';
      l.ctx.drawImage(sel, 0, 0);
      l.ctx.restore();
    } else l.ctx.clearRect(0, 0, W, H);
    resetQuad();
    mode = 'uniform';
    active = true;
    view.width = Math.round(studio.paper.w * Math.min(2, window.devicePixelRatio || 1));
    view.height = Math.round(studio.paper.h * Math.min(2, window.devicePixelRatio || 1));
    document.body.classList.add('transforming-layer');
    bar.classList.remove('hidden');
    renderBar();
    render();
    return true;
  }
  function finish(apply) {
    if (!active) return;
    if (apply) {
      render(true);
      studio.commitWhole('Transform', layer, before);
      clearSelection?.();
    } else {
      layer.ctx.putImageData(before, 0, 0);
    }
    cleanup();
  }
  function cleanup() {
    active = false;
    drag = null;
    guides = [];
    vg.clearRect(0, 0, view.width, view.height);
    bar.classList.add('hidden');
    document.body.classList.remove('transforming-layer');
    $('btnTransform').classList.remove('active');
    layer = before = src = null;
  }
  const flip = (h) => {
    const c = centre();
    const f = (p) => (h ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
    Q = h ? [f(Q[1]), f(Q[0]), f(Q[3]), f(Q[2])] : [f(Q[3]), f(Q[2]), f(Q[1]), f(Q[0])];
    G = G.map((r) => r.map(f));
    if (h) G = G.map((r) => r.reverse());
    else G.reverse();
    render();
  };
  function rotate45() {
    const c = centre();
    const a = Math.PI / 4;
    Q = Q.map((q) => rot(q, c, a));
    G = G.map((r) => r.map((q) => rot(q, c, a)));
    render();
  }
  function fit() {
    const d = D();
    const c = centre();
    const xs = Q.map((q) => q.x), ys = Q.map((q) => q.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const s = Math.min(d.width / w, d.height / h);
    const t = (p) => ({ x: d.width / 2 + (p.x - c.x) * s, y: d.height / 2 + (p.y - c.y) * s });
    Q = Q.map(t);
    G = G.map((r) => r.map(t));
    render();
  }
  function renderBar() {
    bar.innerHTML = `
      <div class="bar-seg" role="group" aria-label="Transform type">${[['uniform', 'Uniform'], ['freeform', 'Freeform'], ['distort', 'Distort'], ['warp', 'Warp']].map(([id, l]) => `<button data-mode="${id}" class="${mode === id ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="bar-sep"></span>
      <div class="bar-acts">
        <button data-do="snap" class="${snapping ? 'on' : ''}" data-tip="Snap to the middle of the canvas and to 15° turns">Snapping</button>
        <button data-do="fliph">Flip horizontal</button>
        <button data-do="flipv">Flip vertical</button>
        <button data-do="rot45">Rotate 45°</button>
        <button data-do="fit">Fit to canvas</button>
        <button data-do="smooth" class="${smooth ? 'on' : ''}" data-tip="Smooth edges (off for pixel art)">${smooth ? 'Bilinear' : 'Nearest'}</button>
        <button data-do="reset">Reset</button>
      </div>
      <button class="bar-cancel" data-do="cancel">Cancel</button><button class="bar-done" data-do="done">Done</button>`;
  }
  bar.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    const a = e.target.closest('[data-do]');
    if (m) {
      const next = m.dataset.mode;
      if (next === 'warp' && mode !== 'warp') gridFromQuad();
      if (mode === 'warp' && next !== 'warp') {
        Q = [G[0][0], G[0][3], G[3][3], G[3][0]].map((q) => ({ ...q }));
        gridFromQuad();
      }
      mode = next;
      renderBar();
      render();
    } else if (a) {
      const d = a.dataset.do;
      if (d === 'snap') snapping = !snapping;
      else if (d === 'smooth') smooth = !smooth;
      else if (d === 'fliph') flip(true);
      else if (d === 'flipv') flip(false);
      else if (d === 'rot45') rotate45();
      else if (d === 'fit') fit();
      else if (d === 'reset') {
        resetQuad();
        render();
      } else if (d === 'done') return finish(true);
      else if (d === 'cancel') return finish(false);
      renderBar();
      render();
    }
  });
  window.addEventListener('resize', () => active && render());
  studio.on('layout', () => active && render());
  return {
    get active() { return active; },
    begin, down, move, up, finish,
  };
}
