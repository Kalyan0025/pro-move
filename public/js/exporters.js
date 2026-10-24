// Getting an artwork out: PNG, JPEG, a layered PSD (opens in Procreate and Photoshop), a one-page
// PDF, and ".promove", this app's own file with every layer. Also reading a PSD or a .promove back in.
import { BLEND_MODES } from './studio.js';
import { blobToCanvas, canvasToBlob, uid } from './store.js';

const BLEND = Object.fromEntries(BLEND_MODES.map((b) => [b.id, b]));
const PSD_BLEND = { normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge', 'color-burn': 'color burn', 'soft-light': 'soft light', 'hard-light': 'hard light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity', add: 'linear dodge' };
const FROM_PSD = Object.fromEntries(Object.entries(PSD_BLEND).map(([k, v]) => [v, k]));

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const fileName = (name) => (name || 'artwork').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'artwork';

// Layers of a saved record, as canvases.
export async function recordLayers(rec) {
  const out = [];
  for (const l of rec.layers) {
    if (l.type !== 'paint' || !l.blob) continue;
    out.push({
      ...l,
      canvas: await blobToCanvas(l.blob, rec.width, rec.height),
      mask: l.maskBlob ? await blobToCanvas(l.maskBlob, rec.width, rec.height) : null,
    });
  }
  return out;
}

// Flatten layers (bottom to top) over a paper colour, scaled to `width` pixels wide.
export function flattenLayers(layers, { width, height, bgColor = '#ffffff', transparent = false, scale = 1 }) {
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  if (!transparent) {
    g.fillStyle = bgColor;
    g.fillRect(0, 0, w, h);
  }
  const groups = new Map(layers.filter((l) => l.type === 'group').map((l) => [l.id, l]));
  for (const l of layers) {
    if (!l.canvas) continue;
    const grp = l.parent ? groups.get(l.parent) : null;
    if (!l.visible || (grp && !grp.visible)) continue;
    let src = l.canvas;
    if (l.mask) {
      src = document.createElement('canvas');
      src.width = l.canvas.width;
      src.height = l.canvas.height;
      const sg = src.getContext('2d');
      sg.drawImage(l.canvas, 0, 0);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(l.mask, 0, 0);
    }
    g.save();
    g.globalAlpha = l.opacity * (grp?.opacity ?? 1);
    g.globalCompositeOperation = BLEND[l.blend]?.op || 'source-over';
    g.drawImage(src, 0, 0, w, h);
    g.restore();
  }
  return out;
}

export async function toPNG(canvas) {
  return canvasToBlob(canvas, 'image/png');
}
export async function toJPEG(canvas, quality = 0.92) {
  // JPEG has no transparency: put the picture on white.
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0);
  return canvasToBlob(c, 'image/jpeg', quality);
}

// A layered PSD: one layer per paint layer, with opacity, blend mode and visibility.
export function toPSD(layers, { width, height }) {
  const children = layers
    .filter((l) => l.canvas)
    .map((l) => {
      let canvas = l.canvas;
      if (l.mask) {
        canvas = document.createElement('canvas');
        canvas.width = l.canvas.width;
        canvas.height = l.canvas.height;
        const g = canvas.getContext('2d');
        g.drawImage(l.canvas, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(l.mask, 0, 0);
      }
      return { name: l.name, canvas, opacity: l.opacity, hidden: !l.visible, blendMode: PSD_BLEND[l.blend] || 'normal', left: 0, top: 0 };
    });
  const buf = window.agPsd.writePsd({ width, height, children }, { generateThumbnail: false });
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}

// A PDF with the artwork on one page, drawn from a JPEG (a small, dependency-free writer).
export async function toPDF(canvas, { dpi = 132 } = {}) {
  const jpeg = new Uint8Array(await (await toJPEG(canvas, 0.9)).arrayBuffer());
  const wPt = (canvas.width / dpi) * 72, hPt = (canvas.height / dpi) * 72;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offsets[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ".promove": the whole artwork as JSON, every layer a PNG.
export async function toPromove(rec) {
  const toData = (blob) => new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
  const layers = [];
  for (const l of rec.layers) {
    const { blob, maskBlob, ...meta } = l;
    layers.push({ ...meta, data: blob ? await toData(blob) : null, maskData: maskBlob ? await toData(maskBlob) : null });
  }
  const { layers: _l, thumb: _t, ...head } = rec;
  return new Blob([JSON.stringify({ format: 'promove', version: 1, ...head, layers })], { type: 'application/json' });
}
export async function fromPromove(text) {
  const j = JSON.parse(text);
  if (j.format !== 'promove') throw new Error('That is not a Pro Move file.');
  const blobOf = async (d) => (d ? await (await fetch(d)).blob() : null);
  const layers = [];
  for (const l of j.layers) {
    const { data, maskData, ...meta } = l;
    layers.push({ ...meta, blob: await blobOf(data), maskBlob: await blobOf(maskData) });
  }
  const { format, version, ...rest } = j;
  return { ...rest, id: uid(), name: `${j.name}`, layers, created: Date.now(), modified: Date.now(), stack: null };
}

// A PSD (for example from Procreate) as a new artwork record: each layer becomes a paint layer.
export async function fromPSD(buffer, name) {
  const psd = window.agPsd.readPsd(buffer, { skipThumbnail: true });
  const layers = [];
  const walk = (list, parent) => {
    for (const l of list || []) {
      if (l.children) {
        const gid = uid();
        layers.push({ id: gid, type: 'group', name: l.name || 'Group', visible: !l.hidden, opacity: l.opacity ?? 1, blend: 'normal', parent, expanded: false });
        walk(l.children, gid);
      } else if (l.canvas) {
        const c = document.createElement('canvas');
        c.width = psd.width;
        c.height = psd.height;
        c.getContext('2d').drawImage(l.canvas, l.left || 0, l.top || 0);
        layers.push({ id: uid(), type: 'paint', name: l.name || 'Layer', visible: !l.hidden, opacity: l.opacity ?? 1, blend: FROM_PSD[l.blendMode] || 'normal', parent, canvas: c });
      }
    }
  };
  walk(psd.children, null);
  const paints = layers.filter((l) => l.canvas);
  if (!paints.length && psd.canvas) {
    paints.push({ id: uid(), type: 'paint', name: 'Layer 1', visible: true, opacity: 1, blend: 'normal', parent: null, canvas: psd.canvas });
    layers.push(paints[0]);
  }
  if (!paints.length) throw new Error('That PSD has no layers to import.');
  const out = [];
  for (const l of layers) {
    const { canvas, ...meta } = l;
    out.push({ ...meta, alphaLock: false, locked: false, hold: 0, blob: canvas ? await canvasToBlob(canvas) : null });
  }
  return { name: name || 'Imported PSD', width: psd.width, height: psd.height, layers: out, activeId: paints[paints.length - 1].id };
}
