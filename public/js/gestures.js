// Touch gestures on the canvas, like Procreate's: pinch to zoom, pan and (with two fingers) quick
// taps: two fingers = undo, three = redo, four = hide the interface. Also the mouse wheel and a
// trackpad pinch on a laptop. A stroke already started by the first finger is cancelled when a
// second one lands.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const GESTURE_DEFAULTS = { zoom: true, undo: true, redo: true, hideUI: true, hold: true, touchDraw: true };

export function createGestures({ studio, screenEl, workspace, painter, undo, redo, prefs, isRigEditing }) {
  const touches = new Map();
  let g = null; // { n, t0, d0, c0, view0, moved, maxN, scaled }
  const pill = $('zoomPill');

  const pointOf = (e) => {
    const r = workspace.getBoundingClientRect();
    const k = r.width / workspace.offsetWidth || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  function begin() {
    const pts = [...touches.values()];
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
    g = { t0: g?.t0 ?? performance.now(), d0: d, c0: c, view0: { ...studio.view }, moved: g?.moved ?? false, maxN: Math.max(g?.maxN ?? 0, pts.length), scaled: g?.scaled ?? false };
  }
  // The view is "scale s, then shifted by (x, y)", all about the workspace's corner.
  function applyPinch() {
    const pts = [...touches.values()];
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : g.d0;
    const s = clamp(g.view0.s * (d / g.d0), 0.2, 20);
    // Keep the point that was under the fingers under them.
    const px = (g.c0.x - g.view0.x) / g.view0.s, py = (g.c0.y - g.view0.y) / g.view0.s;
    const x = c.x - px * s, y = c.y - py * s;
    if (Math.hypot(c.x - g.c0.x, c.y - g.c0.y) > 12 || Math.abs(d / g.d0 - 1) > 0.06) g.moved = true;
    if (Math.abs(d / g.d0 - 1) > 0.06) g.scaled = true;
    if (prefs().zoom) studio.setView({ s, x, y });
  }

  screenEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.target.closest('#workspace')) return;
    touches.set(e.pointerId, pointOf(e));
    if (touches.size >= 2) {
      // A second finger: this is a gesture, not a stroke.
      painter.cancelStroke();
      begin();
      e.stopPropagation();
    } else if (!prefs().touchDraw) {
      e.stopPropagation();
    }
  }, true);
  screenEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, pointOf(e));
    if (g && touches.size >= 2) {
      applyPinch();
      e.stopPropagation();
    } else if (!prefs().touchDraw) e.stopPropagation();
  }, true);
  const end = (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    const wasGesture = !!g;
    touches.delete(e.pointerId);
    if (wasGesture) e.stopPropagation();
    if (g && touches.size === 0) {
      const quick = performance.now() - g.t0 < 380 && !g.moved && e.type === 'pointerup';
      const n = g.maxN;
      g = null;
      if (quick && !isRigEditing()) {
        const p = prefs();
        if (n === 2 && p.undo) undo();
        else if (n === 3 && p.redo) redo();
        else if (n >= 4 && p.hideUI) document.body.classList.toggle('ui-hidden');
      } else if (quick && n >= 4 && prefs().hideUI) document.body.classList.toggle('ui-hidden');
    } else if (g && touches.size === 1) begin();
  };
  screenEl.addEventListener('pointerup', end, true);
  screenEl.addEventListener('pointercancel', end, true);

  // Laptop: Ctrl + wheel (or a trackpad pinch) zooms about the pointer; Shift + wheel pans.
  workspace.addEventListener('wheel', (e) => {
    if (!prefs().zoom) return;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault();
    const r = workspace.getBoundingClientRect();
    const k = r.width / workspace.offsetWidth || 1;
    const c = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    const v = studio.view;
    if (e.shiftKey && !e.ctrlKey) return studio.setView({ x: v.x - e.deltaY, y: v.y - e.deltaX });
    const s = clamp(v.s * Math.exp(clamp(-e.deltaY * 0.01, -0.35, 0.35)), 0.2, 20);
    const px = (c.x - v.x) / v.s, py = (c.y - v.y) / v.s;
    studio.setView({ s, x: c.x - px * s, y: c.y - py * s });
  }, { passive: false });

  // The zoom pill: shows the zoom and puts the canvas back to fit when tapped.
  function showPill() {
    const v = studio.view;
    const moved = v.s !== 1 || v.x || v.y;
    pill.classList.toggle('hidden', !moved);
    pill.textContent = `${Math.round(v.s * 100)}%`;
  }
  pill.addEventListener('click', () => studio.setView({ s: 1, x: 0, y: 0 }));
  studio.on('view', showPill);
  studio.on('doc', () => studio.setView({ s: 1, x: 0, y: 0 }));
  // A way back from a hidden interface, since there is no four-finger tap on a laptop.
  $('uiShow').addEventListener('click', () => document.body.classList.remove('ui-hidden'));
  return { get busy() { return !!g; } };
}
