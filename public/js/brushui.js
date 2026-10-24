// The Brush Library popover and Brush Studio, like Procreate's: sets down the left, brushes with
// a sample stroke on the right, search, and a studio sheet to tune a brush with a live preview.
import { previewStroke, stamp } from './brushes.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// [key, label, min, max, step, format]
const CONTROLS = [
  ['size', 'Default size', 1, 120, 1, (v) => `${v}`],
  ['opacity', 'Default opacity', 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['hardness', 'Hardness', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['spacing', 'Spacing', 0.01, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['flow', 'Flow', 0.05, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['grain', 'Grain', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['scatter', 'Scatter', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['aspect', 'Tip shape (round to flat)', 0.15, 1, 0.01, (v) => (v >= 0.99 ? 'Round' : `${Math.round(v * 100)}%`)],
  ['angle', 'Tip angle', -90, 90, 1, (v) => `${v}°`],
  ['pressureSize', 'Pressure: size', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['pressureOpacity', 'Pressure: opacity', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
  ['smoothing', 'Stabilisation', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`],
];

export function createBrushUI({ library, painter, onChosen, toast }) {
  const panel = $('brushPanel');
  const studioSheet = $('brushStudio');
  let setId = null;
  let tool = 'brush';
  let editing = null;
  const colour = () => (document.body.classList.contains('light') ? '#1c1c1e' : '#f2f2f4');

  function render() {
    const sets = library.sets();
    const q = $('bpSearch').value.trim().toLowerCase();
    if (!setId || !sets.some((s) => s.id === setId)) setId = library.find(library.toolBrush(tool).id)?.set || sets[0].id;
    $('bpSets').innerHTML = sets.map((s) => `<button class="bp-set ${s.id === setId && !q ? 'on' : ''}" data-set="${s.id}">${esc(s.name)}<small>${s.brushes.length}</small></button>`).join('');
    const shown = q ? sets.flatMap((s) => s.brushes.filter((b) => b.name.toLowerCase().includes(q))) : sets.find((s) => s.id === setId).brushes;
    const current = library.toolBrush(tool).id;
    $('bpList').innerHTML = shown.length
      ? shown.map((b) => `<div class="bp-brush ${b.id === current ? 'on' : ''}" data-id="${b.id}"><canvas width="360" height="84" data-prev="${b.id}"></canvas><span>${esc(b.name)}</span></div>`).join('')
      : '<p class="hint">No brushes match.</p>';
    for (const c of $('bpList').querySelectorAll('canvas[data-prev]')) previewStroke(c, library.find(c.dataset.prev), colour());
  }

  function choose(id) {
    library.selectFor(tool, id);
    const b = library.toolBrush(tool);
    painter.brush = b;
    const used = library.used(b.id);
    $('brushSize').value = used?.size ?? b.size;
    $('brushOpacity').value = used?.opacity ?? b.opacity;
    $('brushSize').dispatchEvent(new Event('input'));
    $('brushOpacity').dispatchEvent(new Event('input'));
    onChosen?.(b);
    render();
  }

  $('bpSets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    setId = b.dataset.set;
    $('bpSearch').value = '';
    render();
  });
  $('bpList').addEventListener('click', (e) => {
    const row = e.target.closest('.bp-brush');
    if (!row) return;
    // Tap the brush you are already using to open it in Brush Studio.
    if (row.dataset.id === library.toolBrush(tool).id) openStudio(row.dataset.id);
    else choose(row.dataset.id);
  });
  $('bpSearch').addEventListener('input', render);
  $('bpNew').addEventListener('click', () => {
    const copy = library.duplicate(library.toolBrush(tool).id);
    if (copy) {
      setId = 'mine';
      choose(copy.id);
      openStudio(copy.id);
    }
  });

  // ------------------------------------------------------------ Brush Studio
  function openStudio(id) {
    editing = id;
    const b = library.find(id);
    $('bsName').value = b.name;
    $('bsSliders').innerHTML = CONTROLS.map(([k, label, min, max, step, fmt]) => {
      const v = b[k] ?? (k === 'aspect' ? 1 : 0);
      return `<label class="bs-row"><span>${label}</span><output data-out="${k}">${fmt(v)}</output><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
    }).join('');
    $('bsReset').classList.toggle('hidden', library.isCustom(id) || !library.isEdited(id));
    $('bsDelete').classList.toggle('hidden', !library.isCustom(id));
    studioSheet.classList.remove('hidden');
    panel.classList.add('hidden');
    drawStudioPreview();
  }
  function drawStudioPreview() {
    const b = library.find(editing);
    previewStroke($('bsPreview'), b, colour());
  }
  $('bsSliders').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const v = Number(e.target.value);
    const ctl = CONTROLS.find((c) => c[0] === k);
    studioSheet.querySelector(`[data-out="${k}"]`).textContent = ctl[5](v);
    library.update(editing, { [k]: v });
    if (k === 'aspect' && v >= 0.99) library.update(editing, { aspect: undefined });
    drawStudioPreview();
    if (library.toolBrush(tool).id === editing) painter.brush = library.find(editing);
  });
  $('bsName').addEventListener('change', () => {
    if ($('bsName').value.trim()) library.rename(editing, $('bsName').value.trim());
  });
  $('bsDone').addEventListener('click', () => {
    studioSheet.classList.add('hidden');
    painter.brush = library.toolBrush(tool);
    render();
  });
  $('bsReset').addEventListener('click', () => {
    library.reset(editing);
    openStudio(editing);
    painter.brush = library.toolBrush(tool);
  });
  $('bsDelete').addEventListener('click', () => {
    library.remove(editing);
    studioSheet.classList.add('hidden');
    painter.brush = library.toolBrush(tool);
    render();
    toast('Brush deleted.');
  });
  $('bsDuplicate').addEventListener('click', () => {
    const copy = library.duplicate(editing);
    if (copy) {
      choose(copy.id);
      openStudio(copy.id);
    }
  });
  // Try the brush on the pad inside the studio.
  const pad = $('bsPad');
  const pg = pad.getContext('2d');
  let down = null;
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * pad.width) / r.width, y: ((e.clientY - r.top) * pad.height) / r.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    down = at(e);
    scribble(down, down, e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = at(e);
    scribble(down, p, e);
    down = p;
  });
  pad.addEventListener('pointerup', () => (down = null));
  $('bsPadClear').addEventListener('click', () => pg.clearRect(0, 0, pad.width, pad.height));
  function scribble(a, b, e) {
    const br = library.find(editing);
    const dia = Math.max(2, br.size * (pad.width / 520) * 1.2);
    const press = e.pointerType === 'pen' ? e.pressure || 0.5 : 1;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const sp = Math.max(0.8, dia * (br.spacing || 0.06));
    const n = Math.max(1, Math.round(dist / sp));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const d = Math.max(1, dia * (1 - (br.pressureSize || 0) * (1 - press)));
      stamp(pg, br, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, d, (br.flow ?? 1) * (1 - (br.pressureOpacity || 0) * (1 - press)), colour());
    }
    pg.globalAlpha = 1;
  }

  return {
    // tool: 'brush' | 'smudge' | 'eraser'
    open(forTool) {
      tool = forTool;
      $('bpTitle').textContent = tool === 'brush' ? 'Brush Library' : tool === 'smudge' ? 'Smudge brushes' : 'Eraser brushes';
      setId = library.find(library.toolBrush(tool).id)?.set;
      $('bpSearch').value = '';
      render();
    },
    render,
  };
}
