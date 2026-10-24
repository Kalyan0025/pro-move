// The Gallery: every artwork as a card, with New Canvas, Import, Photo, Select (stack, preview, share,
// duplicate, delete), rename, and stacks. Artworks live in this browser (store.js).
import { store, uid, blobToCanvas } from './store.js';
import { PRESETS } from './studio.js';
import {
  download, fileName, recordLayers, flattenLayers, toPNG, toJPEG, toPSD, toPDF, toPromove, fromPromove, fromPSD,
} from './exporters.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MAX_PIXELS = 4096 * 4096;
const svg = (p, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="M15 5l-7 7 7 7"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  stack: '<rect x="6" y="8" width="13" height="11" rx="2"/><path d="M9 5h9a2 2 0 0 1 2 2v9"/>', eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9"/>', copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  photo: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3.4"/><path d="M8.5 6l1.2-2h4.6l1.2 2"/>', import: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
};

export function createGallery({ studio, toast, screenSize, bgImage, onOpen }) {
  const root = $('gallery');
  let items = [];
  let view = null; // a stack's id while inside a stack
  let selecting = false;
  const selected = new Set();
  let busy = false;

  const isStack = (r) => r.kind === 'stack';
  const stackKids = (id) => items.filter((r) => !isStack(r) && r.stack === id);

  async function refresh() {
    // Show what is saved right away, with the open artwork's card drawn from the canvas as it is now.
    const saved = store.available ? await store.list() : [];
    const d = studio.doc;
    if (d) {
      const live = { id: d.id, name: d.name, width: d.width, height: d.height, layerCount: d.layers.filter((l) => l.type !== 'rig').length, modified: Date.now(), stack: d.stack, thumb: studio.thumbnail(), bg: d.bg };
      items = [live, ...saved.filter((r) => r.id !== d.id)];
    } else items = saved;
    render();
    // Then save it for real, so the card (and a reload) match.
    if (d) {
      await studio.saveNow();
      const again = store.available ? await store.list() : [];
      if (!root.classList.contains('hidden')) {
        items = again;
        render();
      }
    }
  }

  function render() {
    const stack = view ? items.find((r) => r.id === view) : null;
    $('galTitle').textContent = stack ? stack.name : 'Gallery';
    $('galBack').classList.toggle('hidden', !stack);
    $('galSelect').textContent = selecting ? 'Done' : 'Select';
    $('galSelect').classList.toggle('on', selecting);
    $('galTools').classList.toggle('hidden', selecting);
    $('galActions').classList.toggle('hidden', !selecting);
    const visible = items.filter((r) => (stack ? r.stack === stack.id : isStack(r) || !r.stack));
    // Stacks first, then artworks, newest first.
    visible.sort((a, b) => Number(isStack(b)) - Number(isStack(a)) || b.modified - a.modified);
    const cards = visible.map((r) => (isStack(r) ? stackCard(r) : card(r))).join('');
    $('galGrid').innerHTML = cards || `<div class="gal-empty"><b>${stack ? 'This stack is empty' : 'No artworks yet'}</b><p>${stack ? 'Drag artworks in with Select, then Stack.' : 'Tap + to start a new canvas, or import a picture.'}</p></div>`;
    for (const el of $('galGrid').querySelectorAll('.gcard')) el.classList.toggle('sel', selected.has(el.dataset.id));
    updateActions();
  }
  const card = (r) => `
    <div class="gcard" data-id="${r.id}" data-kind="art">
      <div class="gthumb">${r.thumb ? `<img src="${r.thumb}" alt="">` : ''}<i class="gcheck">${svg(ICON.check, 16)}</i>${r.id === studio.doc?.id ? '<em class="gopen">Open</em>' : ''}</div>
      <div class="gmeta"><b class="gname" data-rename="${r.id}">${esc(r.name)}</b><small>${r.width} × ${r.height} px · ${r.layerCount} layer${r.layerCount === 1 ? '' : 's'}</small></div>
    </div>`;
  const stackCard = (r) => {
    const kids = stackKids(r.id).slice(0, 4);
    return `<div class="gcard stack" data-id="${r.id}" data-kind="stack">
      <div class="gthumb stackthumb n${kids.length}">${kids.map((k) => `<img src="${k.thumb}" alt="">`).join('')}<i class="gcheck">${svg(ICON.check, 16)}</i></div>
      <div class="gmeta"><b class="gname" data-rename="${r.id}">${esc(r.name)}</b><small>${stackKids(r.id).length} artwork${stackKids(r.id).length === 1 ? '' : 's'}</small></div>
    </div>`;
  };
  function updateActions() {
    const n = selected.size;
    $('galCount').textContent = n ? `${n} selected` : 'Select artworks';
    for (const b of $('galActions').querySelectorAll('button[data-do]')) {
      const need = b.dataset.do === 'preview' || b.dataset.do === 'rename' ? n === 1 : n > 0;
      b.disabled = !need;
    }
  }

  // ------------------------------------------------------------ taps
  $('galGrid').addEventListener('click', async (e) => {
    const nameEl = e.target.closest('[data-rename]');
    const el = e.target.closest('.gcard');
    if (!el) return;
    const id = el.dataset.id;
    if (selecting) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      el.classList.toggle('sel', selected.has(id));
      return updateActions();
    }
    if (nameEl) return rename(id);
    if (el.dataset.kind === 'stack') {
      view = id;
      return render();
    }
    await openArt(id);
  });
  async function openArt(id) {
    if (busy) return;
    busy = true;
    try {
      if (id !== studio.doc?.id) await studio.open(id);
      close();
      onOpen?.();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not open that artwork.');
    } finally {
      busy = false;
    }
  }
  async function rename(id) {
    const r = items.find((x) => x.id === id);
    const name = prompt('Name', r.name);
    if (!name?.trim()) return;
    if (id === studio.doc?.id) {
      studio.doc.name = name.trim();
      studio.touch(false);
      await studio.saveNow();
    } else {
      const rec = await store.get(id);
      rec.name = name.trim();
      await store.put(rec);
    }
    await refresh();
  }

  $('galSelect').addEventListener('click', () => {
    selecting = !selecting;
    selected.clear();
    render();
  });
  $('galBack').addEventListener('click', () => {
    view = null;
    render();
  });
  $('galClose').addEventListener('click', () => {
    if (studio.doc) close();
  });

  // ------------------------------------------------------------ select-mode actions
  $('galActions').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-do]');
    if (!b || b.disabled) return;
    const ids = [...selected];
    const what = b.dataset.do;
    try {
      if (what === 'stack') await makeStack(ids);
      else if (what === 'duplicate') await duplicate(ids);
      else if (what === 'delete') await remove(ids);
      else if (what === 'preview') await preview(ids[0]);
      else if (what === 'share') shareMenu(ids);
      else if (what === 'rename') await rename(ids[0]);
    } catch (err) {
      console.error(err);
      toast(err.message || 'That did not work.');
    }
  });
  async function makeStack(ids) {
    const arts = ids.filter((id) => !isStack(items.find((r) => r.id === id) || {}));
    if (!arts.length) return toast('Select artworks to put in a stack.');
    const stack = { id: uid(), kind: 'stack', name: 'Stack', width: 0, height: 0, layers: [], created: Date.now(), modified: Date.now(), thumb: '' };
    await store.put(stack);
    for (const id of arts) await setStack(id, stack.id);
    selecting = false;
    selected.clear();
    toast('Stack made. Tap its name to rename it.');
    await refresh();
  }
  async function setStack(id, stackId) {
    if (id === studio.doc?.id) {
      studio.doc.stack = stackId;
      studio.touch(false);
      return studio.saveNow();
    }
    const rec = await store.get(id);
    rec.stack = stackId;
    await store.put(rec);
  }
  async function duplicate(ids) {
    for (const id of ids) {
      const base = items.find((r) => r.id === id);
      if (isStack(base)) continue;
      if (id === studio.doc?.id) await studio.saveNow();
      const rec = await store.get(id);
      rec.id = uid();
      rec.name = `${rec.name} copy`;
      rec.modified = rec.created = Date.now();
      await store.put(rec);
    }
    selecting = false;
    selected.clear();
    await refresh();
  }
  async function remove(ids) {
    const names = ids.map((id) => items.find((r) => r.id === id)?.name).filter(Boolean);
    if (!confirm(`Delete ${names.length === 1 ? `"${names[0]}"` : `${names.length} items`}? This can not be undone.`)) return;
    for (const id of ids) {
      const r = items.find((x) => x.id === id);
      if (isStack(r)) for (const k of stackKids(id)) await setStack(k.id, null);
      if (id === studio.doc?.id) {
        // The open artwork goes: start a fresh one so the canvas always has something.
        const { w, h } = screenSize();
        await store.remove(id);
        await studio.newArtwork({ name: 'Untitled artwork', screen: true, width: w, height: h });
      } else await store.remove(id);
    }
    selecting = false;
    selected.clear();
    await refresh();
  }
  async function preview(id) {
    const r = items.find((x) => x.id === id);
    if (isStack(r)) {
      view = id;
      selecting = false;
      selected.clear();
      return render();
    }
    if (id === studio.doc?.id) await studio.saveNow();
    const rec = await store.get(id);
    const c = await renderRecord(rec, 1400);
    $('galPreviewImg').src = c.toDataURL('image/jpeg', 0.9);
    $('galPreviewName').textContent = rec.name;
    $('galPreview').classList.remove('hidden');
  }
  $('galPreview').addEventListener('click', () => $('galPreview').classList.add('hidden'));
  async function renderRecord(rec, width) {
    const layers = await recordLayers(rec);
    // Layers are listed without their group headers; keep the groups for visibility and opacity.
    const groups = rec.layers.filter((l) => l.type === 'group');
    const c = flattenLayers([...groups, ...layers], { width: rec.width, height: rec.height, bgColor: rec.bg.color, transparent: rec.bg.transparent, scale: width / rec.width });
    const img = bgImage();
    if (rec.bg.imageVisible && img?.complete && img.naturalWidth) {
      const g = c.getContext('2d');
      const k = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
      g.globalCompositeOperation = 'destination-over';
      g.drawImage(img, (c.width - img.naturalWidth * k) / 2, (c.height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      g.globalCompositeOperation = 'source-over';
    }
    return c;
  }

  // Share: PNG, JPEG, PSD, PDF or a .promove file, for each selected artwork.
  function shareMenu(ids) {
    const menu = $('galShare');
    menu.classList.remove('hidden');
    menu.onclick = async (e) => {
      const b = e.target.closest('button[data-fmt]');
      if (!b) return menu.classList.add('hidden');
      menu.classList.add('hidden');
      for (const id of ids) {
        const r = items.find((x) => x.id === id);
        if (isStack(r)) continue;
        if (id === studio.doc?.id) await studio.saveNow();
        const rec = await store.get(id);
        const base = fileName(rec.name);
        const fmt = b.dataset.fmt;
        try {
          if (fmt === 'promove') download(await toPromove(rec), `${base}.promove`);
          else if (fmt === 'psd') download(toPSD(await recordLayers(rec), rec), `${base}.psd`);
          else {
            const c = await renderRecord(rec, rec.width);
            if (fmt === 'png') download(await toPNG(c), `${base}.png`);
            else if (fmt === 'jpg') download(await toJPEG(c), `${base}.jpg`);
            else if (fmt === 'pdf') download(await toPDF(c, { dpi: rec.dpi }), `${base}.pdf`);
          }
        } catch (err) {
          console.error(err);
          toast(`Could not export ${r.name}.`);
        }
      }
    };
  }

  // ------------------------------------------------------------ Import and Photo
  $('galImportFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importFile(file);
  });
  $('galPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importFile(file);
  });
  async function importFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      toast('Importing…', 1800);
      let rec;
      if (ext === 'procreate') return toast('Procreate files can not be opened directly. In Procreate choose Share, then PSD (keeps layers) or PNG, and import that.', 8000);
      if (ext === 'promove' || ext === 'json') rec = await fromPromove(await file.text());
      else if (ext === 'psd') {
        const r = await fromPSD(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''));
        rec = { id: uid(), kind: 'art', dpi: 132, profile: 'Display P3', screen: false, bg: { color: '#ffffff', transparent: true, image: true, imageVisible: false }, created: Date.now(), modified: Date.now(), stack: null, anim: { fps: 12, loop: 'loop', onion: 2, onionOpacity: 0.35, enabled: false, hold: 1 }, ...r };
      } else {
        const img = await createImageBitmap(file);
        const k = Math.min(1, 4096 / img.width, 4096 / img.height);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const id = uid();
        rec = {
          id, name: file.name.replace(/\.[^.]+$/, '') || 'Imported picture', width: c.width, height: c.height, dpi: 132, profile: 'Display P3', screen: false,
          bg: { color: '#ffffff', transparent: false, image: true, imageVisible: false }, created: Date.now(), modified: Date.now(), stack: null, activeId: 'l1',
          anim: { fps: 12, loop: 'loop', onion: 2, onionOpacity: 0.35, enabled: false, hold: 1 },
          layers: [{ id: 'l1', name: 'Picture', type: 'paint', visible: true, opacity: 1, blend: 'normal', alphaLock: false, locked: false, parent: null, expanded: true, hold: 0, blob: await new Promise((res) => c.toBlob(res, 'image/png')) }],
        };
      }
      if (rec.width * rec.height > MAX_PIXELS) throw new Error('That picture is too large to open (the limit is about 16 megapixels).');
      const layers = await recordLayers(rec);
      rec.thumb = flattenLayers(layers, { width: rec.width, height: rec.height, bgColor: rec.bg.color, transparent: rec.bg.transparent, scale: 360 / rec.width }).toDataURL('image/jpeg', 0.7);
      await store.put(rec);
      toast(`Imported ${rec.name}.`);
      await openArt(rec.id);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not import that file.', 5000);
    }
  }

  // ------------------------------------------------------------ New Canvas
  const nc = { preset: 'screen', w: 2048, h: 2048, dpi: 132, name: '', bg: '#ffffff', transparent: false, profile: 'Display P3' };
  function drawNewCanvas() {
    $('ncPresets').innerHTML = PRESETS.map((p) => {
      const w = p.id === 'screen' ? screenSize().w : p.w, h = p.id === 'screen' ? screenSize().h : p.h;
      const ratio = w / h;
      const bw = ratio >= 1 ? 54 : 54 * ratio, bh = ratio >= 1 ? 54 / ratio : 54;
      return `<button class="ncp ${nc.preset === p.id ? 'on' : ''}" data-p="${p.id}"><span class="ncp-box" style="width:${bw}px;height:${bh}px"></span><b>${p.name}</b><small>${p.id === 'screen' ? 'This screen' : `${p.w} × ${p.h}`}</small></button>`;
    }).join('') + `<button class="ncp ${nc.preset === 'custom' ? 'on' : ''}" data-p="custom"><span class="ncp-box custom"></span><b>Custom</b><small>${nc.w} × ${nc.h}</small></button>`;
    $('ncCustom').classList.toggle('hidden', nc.preset !== 'custom');
    $('ncW').value = nc.w;
    $('ncH').value = nc.h;
    $('ncDpi').value = nc.dpi;
    $('ncProfile').value = nc.profile;
    $('ncBg').value = nc.bg;
    $('ncTransparent').checked = nc.transparent;
    $('ncName').value = nc.name;
    const w = nc.preset === 'screen' ? screenSize().w : nc.w, h = nc.preset === 'screen' ? screenSize().h : nc.h;
    const px = w * h;
    $('ncInfo').textContent = `${w} × ${h} px · ${((w / nc.dpi)).toFixed(1)} × ${((h / nc.dpi)).toFixed(1)} in at ${nc.dpi} DPI · about ${Math.max(1, Math.round(px * 4 / 1048576))} MB per layer`;
    $('ncInfo').classList.toggle('warn', px > MAX_PIXELS);
  }
  $('ncPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    nc.preset = b.dataset.p;
    const p = PRESETS.find((x) => x.id === nc.preset);
    if (p && p.w) Object.assign(nc, { w: p.w, h: p.h, dpi: p.dpi });
    if (p && !p.w) nc.dpi = p.dpi;
    drawNewCanvas();
  });
  $('newCanvas').addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'ncW') nc.w = Math.max(16, Math.min(8192, Number(e.target.value) || 16));
    else if (id === 'ncH') nc.h = Math.max(16, Math.min(8192, Number(e.target.value) || 16));
    else if (id === 'ncDpi') nc.dpi = Math.max(36, Math.min(600, Number(e.target.value) || 132));
    else if (id === 'ncProfile') nc.profile = e.target.value;
    else if (id === 'ncBg') nc.bg = e.target.value;
    else if (id === 'ncTransparent') nc.transparent = e.target.checked;
    else if (id === 'ncName') nc.name = e.target.value;
    if (['ncW', 'ncH', 'ncDpi'].includes(id)) {
      const w = nc.preset === 'screen' ? screenSize().w : nc.w, h = nc.preset === 'screen' ? screenSize().h : nc.h;
      $('ncInfo').textContent = `${w} × ${h} px · ${(w / nc.dpi).toFixed(1)} × ${(h / nc.dpi).toFixed(1)} in at ${nc.dpi} DPI`;
      $('ncInfo').classList.toggle('warn', w * h > MAX_PIXELS);
    }
  });
  $('galNew').addEventListener('click', () => {
    nc.name = '';
    $('newCanvas').classList.remove('hidden');
    drawNewCanvas();
  });
  $('ncCancel').addEventListener('click', () => $('newCanvas').classList.add('hidden'));
  $('ncCreate').addEventListener('click', async () => {
    const screen = nc.preset === 'screen';
    const { w: sw, h: sh } = screenSize();
    const w = screen ? sw : nc.w, h = screen ? sh : nc.h;
    if (w * h > MAX_PIXELS) return toast('That canvas is too big for this device. The limit is about 16 megapixels (4096 × 4096).', 5000);
    $('newCanvas').classList.add('hidden');
    try {
      await studio.newArtwork({
        name: nc.name.trim() || 'Untitled artwork', width: w, height: h, dpi: nc.dpi, profile: nc.profile, screen,
        bgColor: nc.bg, transparent: nc.transparent,
      });
      close();
      onOpen?.();
    } catch (err) {
      console.error(err);
      toast('Could not make that canvas.');
    }
  });

  // ------------------------------------------------------------ open and close
  function open() {
    view = null;
    selecting = false;
    selected.clear();
    root.classList.remove('hidden');
    document.body.classList.add('in-gallery');
    render();
    refresh();
  }
  function close() {
    root.classList.add('hidden');
    $('galPreview').classList.add('hidden');
    $('galShare').classList.add('hidden');
    document.body.classList.remove('in-gallery');
  }
  return { open, close, refresh, get isOpen() { return !root.classList.contains('hidden'); } };
}
