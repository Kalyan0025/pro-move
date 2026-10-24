// The Layers panel, like Procreate's: a list with thumbnails, a tick to show or hide, swipe left
// for Lock / Duplicate / Delete, press and hold to drag a layer to a new place, and a tap on the
// layer's "N" (its blend mode) for the full menu: rename, fill, clear, alpha lock, mask, group,
// merge down, opacity and blend mode.
import { BLEND_MODES } from './studio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const blendLetter = (b) => (b === 'normal' ? 'N' : BLEND_MODES.find((x) => x.id === b)?.label.slice(0, 1) || 'N');
const I = {
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z"/>',
  copy: '<path d="M9 9h10v11H9zM5 5h10v2M5 5v11h2"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  grip: '<path d="M8 8h8M8 12h8M8 16h8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
};
const svg = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

export function createLayersUI({ studio, toast, hooks = {} }) {
  const list = $('layerList');
  const menu = $('layerMenu');
  let thumbTimer = 0;
  let menuFor = null;

  function rowsInOrder() {
    // Top of the stack first. A group's header comes before its children (which are listed under it).
    const layers = studio.layers;
    const out = [];
    const top = layers.filter((l) => !l.parent);
    for (const l of [...top].reverse()) {
      out.push(l);
      if (l.type === 'group' && l.expanded) for (const c of layers.filter((x) => x.parent === l.id).reverse()) out.push(c);
    }
    return out;
  }

  function render() {
    list.innerHTML = '';
    for (const l of rowsInOrder()) list.append(row(l));
    refreshThumbs();
    $('layersCount').textContent = String(studio.layers.filter((l) => l.type !== 'rig').length);
  }

  function row(l) {
    const rig = l.type === 'rig';
    const group = l.type === 'group';
    const el = document.createElement('div');
    el.className = `lrow${l.id === studio.doc.activeId ? ' active' : ''}${group ? ' group' : ''}${l.parent ? ' child' : ''}${rig ? ' rigrow' : ''}${l.locked ? ' locked' : ''}`;
    el.dataset.id = l.id;
    const vis = rig ? $('optShow').checked : l.visible;
    const sub = rig ? 'Extension · live character' : `${blendLetter(l.blend)}${l.opacity < 0.995 ? ` · ${Math.round(l.opacity * 100)}%` : ''}${l.alphaLock ? ' · α' : ''}${l.mask ? ' · mask' : ''}${l.locked ? ' · locked' : ''}`;
    el.innerHTML = `
      <div class="lswipe">
        ${rig ? '' : `<button data-a="lock" class="sw-lock">${svg(I.lock)}<span>${l.locked ? 'Unlock' : 'Lock'}</span></button><button data-a="dup" class="sw-dup">${svg(I.copy)}<span>Duplicate</span></button><button data-a="del" class="sw-del">${svg(I.trash)}<span>Delete</span></button>`}
      </div>
      <div class="lface">
        ${group ? `<button class="lchev ${l.expanded ? 'open' : ''}" data-a="fold" aria-label="${l.expanded ? 'Collapse' : 'Expand'} group">${svg(I.chevron, 14)}</button>` : ''}
        <span class="lthumb${rig ? ' rig-thumb' : ''}${group ? ' group-thumb' : ''}"></span>
        <button class="lname" data-a="select"><b>${esc(l.name)}</b><small data-a="menu" data-tip="${rig ? '' : 'Tap for layer options'}">${esc(sub)}</small></button>
        <input type="checkbox" class="lvis" ${vis ? 'checked' : ''} aria-label="Show ${esc(l.name)}">
      </div>`;
    return el;
  }

  function refreshThumbs() {
    for (const el of list.querySelectorAll('.lrow')) {
      const l = studio.byId(el.dataset.id);
      const slot = el.querySelector('.lthumb');
      if (!l?.canvas || !slot) continue;
      slot.replaceChildren(studio.layerThumb(l, 76, 56));
    }
  }
  const thumbsSoon = () => {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => !$('layersPanel').classList.contains('hidden') && refreshThumbs(), 250);
  };

  // ------------------------------------------------------------ taps
  list.addEventListener('click', (e) => {
    if (drag.moved) return;
    const rowEl = e.target.closest('.lrow');
    if (!rowEl) return;
    const id = rowEl.dataset.id;
    const l = studio.byId(id);
    if (e.target.closest('.lvis')) {
      if (l.type === 'rig') {
        const box = $('optShow');
        box.checked = e.target.closest('.lvis').checked;
        box.dispatchEvent(new Event('input'));
      } else studio.setLayerProp(id, { visible: e.target.closest('.lvis').checked });
      return;
    }
    const act = e.target.closest('[data-a]')?.dataset.a;
    if (act === 'fold') return studio.toggleGroup(id);
    if (rowEl.classList.contains('swiped')) {
      if (act === 'lock') studio.setLayerProp(id, { locked: !l.locked });
      else if (act === 'dup') studio.duplicateLayer(id);
      else if (act === 'del') studio.deleteLayer(id);
      return closeSwipes();
    }
    closeSwipes();
    if (act === 'menu' && l.type !== 'rig' && l.id === studio.doc.activeId) return openMenu(l, rowEl);
    if (l.id !== studio.doc.activeId) studio.setActive(id);
    else if (act === 'select' && l.type !== 'rig') openMenu(l, rowEl);
  });

  // ------------------------------------------------------------ swipe left, press and hold to drag
  const drag = { id: null, el: null, startX: 0, startY: 0, hold: 0, active: false, moved: false, ghost: null, to: null, swipe: false };
  const closeSwipes = () => list.querySelectorAll('.lrow.swiped').forEach((r) => r.classList.remove('swiped'));
  list.addEventListener('pointerdown', (e) => {
    const rowEl = e.target.closest('.lrow');
    if (!rowEl || e.target.closest('input, .lswipe button, .lchev')) return;
    Object.assign(drag, { id: rowEl.dataset.id, el: rowEl, startX: e.clientX, startY: e.clientY, active: false, moved: false, swipe: false, to: null });
    clearTimeout(drag.hold);
    drag.hold = setTimeout(() => {
      if (drag.moved) return;
      drag.active = true;
      rowEl.classList.add('dragging');
      list.classList.add('reordering');
    }, 380);
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag.id) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.active && !drag.swipe && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(drag.hold);
      if (Math.abs(dx) > Math.abs(dy) && !studio.byId(drag.id)?.type?.startsWith('rig')) {
        drag.swipe = true;
        drag.moved = true;
      }
    }
    if (drag.swipe) {
      drag.el.classList.toggle('swiped', dx < -28);
      return;
    }
    if (!drag.active) return;
    drag.moved = true;
    const rows = [...list.querySelectorAll('.lrow:not(.dragging)')];
    const y = e.clientY;
    let target = null, before = true;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y >= b.top && y <= b.bottom) {
        target = r;
        before = y < b.top + b.height / 2;
        break;
      }
    }
    list.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-into'));
    if (!target) return (drag.to = null);
    const tl = studio.byId(target.dataset.id);
    if (tl.type === 'group' && y > target.getBoundingClientRect().top + 14 && y < target.getBoundingClientRect().bottom - 14 && studio.byId(drag.id).type !== 'group') {
      target.classList.add('drop-into');
      drag.to = { id: tl.id, into: true };
    } else {
      target.classList.add(before ? 'drop-before' : 'drop-after');
      drag.to = { id: tl.id, before };
    }
    drag.el.style.transform = `translateY(${dy}px)`;
  });
  const endDrag = () => {
    clearTimeout(drag.hold);
    const { id, to, active } = drag;
    drag.el?.classList.remove('dragging');
    if (drag.el) drag.el.style.transform = '';
    list.classList.remove('reordering');
    list.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-into'));
    if (active && to && id !== to.id) dropLayer(id, to);
    drag.id = null;
    // A drag or swipe must not also count as a tap.
    setTimeout(() => (drag.moved = false), 0);
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);

  function dropLayer(id, to) {
    const L = studio.layers;
    const target = studio.byId(to.id);
    const mover = studio.byId(id);
    if (!target || !mover) return;
    if (target.parent === mover.id) return;
    if (to.into) {
      // Into a group: on top of its other children.
      const kids = L.filter((x) => x.parent === target.id && x !== mover);
      const last = kids.length ? kids[kids.length - 1] : target;
      const at = L.filter((x) => x !== mover).indexOf(last) + 1;
      return studio.moveLayer(id, at, target.id);
    }
    const parent = target.parent;
    // "before" in the list means above in the stack: after the target in array order.
    const rest = L.filter((x) => !(x === mover || (mover.type === 'group' && x.parent === mover.id)));
    let ti = rest.indexOf(target);
    if (target.type === 'group') {
      let last = ti;
      while (rest[last + 1]?.parent === target.id) last++;
      ti = to.before ? last : ti - 1;
    } else ti = to.before ? ti : ti - 1;
    studio.moveLayer(id, ti + 1, parent);
  }

  // ------------------------------------------------------------ the layer menu
  function openMenu(l, rowEl) {
    menuFor = l.id;
    const blends = BLEND_MODES.map((b) => `<option value="${b.id}" ${b.id === l.blend ? 'selected' : ''}>${b.label}</option>`).join('');
    const isGroup = l.type === 'group';
    menu.innerHTML = `
      <div class="lm-title">${esc(l.name)}</div>
      <button data-m="rename">Rename</button>
      ${isGroup ? '' : '<button data-m="select">Select</button><button data-m="copy">Copy</button><button data-m="fill">Fill Layer</button><button data-m="clear">Clear</button>'}
      ${isGroup ? '<button data-m="ungroup">Ungroup</button>' : `
      <label class="lm-row">Alpha Lock<input type="checkbox" class="switch" data-m="alpha" ${l.alphaLock ? 'checked' : ''}></label>
      <button data-m="mask">${l.mask ? 'Remove Mask' : 'Mask'}</button>
      ${l.mask ? `<label class="lm-row">Edit mask<input type="checkbox" class="switch" data-m="editmask" ${l.editMask ? 'checked' : ''}></label><button data-m="applymask">Apply Mask</button>` : ''}
      <button data-m="invert">Invert</button>
      <button data-m="group">Group</button>
      <button data-m="merge">Merge Down</button>`}
      <button data-m="flatten">Flatten Artwork</button>
      <div class="lm-sliders">
        <div class="lm-slide"><span>Opacity</span><output id="lmOpOut">${Math.round(l.opacity * 100)}%</output><input type="range" id="lmOp" min="0" max="100" value="${Math.round(l.opacity * 100)}"></div>
        ${isGroup ? '' : `<label class="lm-slide"><span>Blend</span><select id="lmBlend" class="row-select">${blends}</select></label>`}
      </div>`;
    menu.classList.remove('hidden');
    const pr = $('layersPanel').getBoundingClientRect();
    const sr = $('screen').getBoundingClientRect();
    const k = sr.width / $('screen').offsetWidth || 1;
    const top = (rowEl.getBoundingClientRect().top - sr.top) / k;
    menu.style.left = `${Math.max(8, (pr.left - sr.left) / k - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.max(52, Math.min($('screen').offsetHeight - menu.offsetHeight - 10, top - 20))}px`;
  }
  const closeMenu = () => {
    menu.classList.add('hidden');
    menuFor = null;
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    const l = studio.byId(menuFor);
    if (!b || !l) return;
    const m = b.dataset.m;
    if (m === 'rename') {
      closeMenu();
      const name = prompt('Layer name', l.name);
      if (name) studio.renameLayer(l.id, name);
      return;
    }
    if (m === 'mask') l.mask ? studio.removeMask(l.id) : studio.addMask(l.id);
    else if (m === 'applymask') studio.removeMask(l.id, { apply: true });
    else if (m === 'invert') hooks.invert?.(l);
    else if (m === 'group') studio.groupLayer(l.id);
    else if (m === 'ungroup') studio.ungroup(l.id);
    else if (m === 'merge') studio.mergeDown(l.id);
    else if (m === 'flatten') studio.flattenVisible();
    else if (m === 'clear') (hooks.clear ? hooks.clear(l) : studio.clearLayer(l.id));
    else if (m === 'fill') hooks.fill?.(l);
    else if (m === 'select') hooks.selectLayer?.(l);
    else if (m === 'copy') hooks.copyLayer?.(l);
    closeMenu();
  });
  menu.addEventListener('input', (e) => {
    const l = studio.byId(menuFor);
    if (!l) return;
    if (e.target.id === 'lmOp') {
      $('lmOpOut').textContent = `${e.target.value}%`;
      studio.setLayerProp(l.id, { opacity: e.target.value / 100 }, { record: false });
    } else if (e.target.id === 'lmBlend') studio.setLayerProp(l.id, { blend: e.target.value });
    else if (e.target.dataset.m === 'alpha') studio.setLayerProp(l.id, { alphaLock: e.target.checked });
    else if (e.target.dataset.m === 'editmask') studio.setLayerProp(l.id, { editMask: e.target.checked }, { record: false });
  });
  // One undo step for a whole opacity drag.
  menu.addEventListener('change', (e) => {
    const l = studio.byId(menuFor);
    if (l && e.target.id === 'lmOp') {
      studio.propEntry('Opacity', l, { opacity: e.target.value / 100 });
      // propEntry recorded "old" as the current (already changed) value; fix it from the drag start.
      const entry = studio.history.undo[studio.history.undo.length - 1];
      const prev = Number(e.target.dataset.start ?? 1);
      entry.undo = () => { l.opacity = prev; studio.layout(); studio.emit('layers'); };
    }
  });
  menu.addEventListener('pointerdown', (e) => {
    if (e.target.id === 'lmOp') e.target.dataset.start = String(studio.byId(menuFor)?.opacity ?? 1);
  });
  addEventListener('pointerdown', (e) => {
    if (!menu.classList.contains('hidden') && !e.target.closest('#layerMenu') && !e.target.closest('.lrow')) closeMenu();
    if (!e.target.closest('.lrow')) closeSwipes();
  });

  // ------------------------------------------------------------ header and footer buttons
  $('layerAdd').addEventListener('click', () => {
    studio.addLayer();
    $('layerList').scrollTop = 0;
  });
  $('layerAddGroup').addEventListener('click', () => {
    const l = studio.active;
    if (l && l.type === 'paint') studio.groupLayer(l.id);
    else toast('Select a drawing layer to put in a group.');
  });

  studio.on('layers', () => {
    if ($('layersPanel').classList.contains('hidden')) {
      // Keep the count in the hidden header fresh, build rows the next time it opens.
      return;
    }
    render();
  });
  studio.on('doc', () => !$('layersPanel').classList.contains('hidden') && render());
  studio.on('pixels', thumbsSoon);
  return { render, closeMenu };
}
