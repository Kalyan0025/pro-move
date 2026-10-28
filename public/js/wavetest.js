// The wave test: one character waving for twelve frames, shown three ways side by side.
//   Drawing         the artwork as it was drawn
//   Rigged mesh     the parts bent by the rig alone, with its mesh drawn over them
//   Corrected       the same frames with everything the rig adds on top: joint covers, dust, AI patches
//                   and the artist's remembered corrections
// Under each frame: how many separate pieces the character has (more than one is a tear) and how much
// its area differs from the drawing. The same frames can be saved as a transparent PNG sequence.
import { downloadBlob } from './export.js';
import { zip } from './aipack.js';
import { drawRigView } from './rigview.js';

const $ = (id) => document.getElementById(id);
const FRAMES = 12;
const W = 200, H = 260; // each frame
const MW = 120, MH = 156; // the smaller copy the numbers are measured on

// The raised arm (the one on the screen's left) waves: the upper arm stays up, the forearm swings.
function wavePose(base, i) {
  const pose = { angle: { ...base.angle }, ratio: { ...base.ratio }, face: { ...base.face }, offset: { x: 0, y: 0 } };
  const t = (i / FRAMES) * Math.PI * 2;
  pose.angle.upperArmR = -Math.PI / 2 - 0.35 + Math.sin(t) * 0.06;
  pose.angle.foreArmR = -Math.PI / 2 + 0.25 + Math.sin(t) * 0.6;
  return pose;
}

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// Separate pieces: the drawing's connected regions, after growing each by a pixel so line art counts as one.
// Specks under 1.5% of the largest piece are ignored.
export function measure(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] > 40) {
      on[i] = 1;
      area++;
    }
  }
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) grown[yy * w + xx] = 1;
    }
  }
  const seen = new Uint8Array(w * h);
  const sizes = [];
  for (let s = 0; s < w * h; s++) {
    if (!grown[s] || seen[s]) continue;
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % w, y = (p / w) | 0;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !grown[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  return { area, pieces: sizes.filter((n) => n >= big * 0.015).length };
}

export function createWaveTest({ rig, getPuppet, render, memory, toast }) {
  const sheet = $('waveSheet');
  let frames = null;

  const label = (text) => `<div class="wt-label">${text}</div>`;
  function cell(canvas, note, bad) {
    const d = document.createElement('div');
    d.className = 'wt-cell';
    d.appendChild(canvas);
    const s = document.createElement('small');
    s.textContent = note;
    if (bad) s.className = 'bad';
    d.appendChild(s);
    return d;
  }

  function run() {
    const puppet = getPuppet();
    if (!puppet) return toast('Pick a drawn character first. The wave test needs its artwork.', 3000);
    const live = rig.getPose();
    const restPose = { angle: { ...rig.rest }, ratio: Object.fromEntries(Object.keys(live.ratio).map((k) => [k, 1])), face: { ...live.face }, offset: { x: 0, y: 0 } };
    const poses = Array.from({ length: FRAMES }, (_, i) => wavePose(restPose, i));

    // Reference: the drawing at rest, measured the same way.
    const refC = mk(MW, MH);
    render(refC.getContext('2d'), MW, MH, restPose, { plain: true });
    const ref = measure(refC);

    const rows = { drawing: [], mesh: [], fixed: [] };
    const stats = { mesh: [], fixed: [] };
    poses.forEach((pose, i) => {
      // The drawing, as drawn.
      const a = mk(W, H);
      const ag = a.getContext('2d');
      const k = Math.min(W / puppet.img.width, H / puppet.img.height) * 0.92;
      ag.drawImage(puppet.img, (W - puppet.img.width * k) / 2, (H - puppet.img.height * k) / 2, puppet.img.width * k, puppet.img.height * k);
      rows.drawing.push(cell(a, `frame ${i + 1}`));

      // The rig alone, with its mesh.
      const m = mk(W, H);
      const mg = m.getContext('2d');
      render(mg, W, H, pose, { plain: true });
      mg.globalAlpha = 0.6;
      drawRigView(mg, puppet, { mesh: true });
      mg.globalAlpha = 1;
      const ms = mk(MW, MH);
      render(ms.getContext('2d'), MW, MH, pose, { plain: true });
      const mm = measure(ms);
      const mDelta = (mm.area / ref.area - 1) * 100;
      stats.mesh.push({ pieces: mm.pieces, delta: mDelta });
      rows.mesh.push(cell(m, `${mm.pieces} piece${mm.pieces === 1 ? '' : 's'} · ${mDelta >= 0 ? '+' : ''}${mDelta.toFixed(0)}%`, mm.pieces > 1));

      // With the joint covers, patches and remembered corrections.
      const f = mk(W, H);
      render(f.getContext('2d'), W, H, pose, { plain: false });
      const fs = mk(MW, MH);
      render(fs.getContext('2d'), MW, MH, pose, { plain: false });
      const fm = measure(fs);
      const fDelta = (fm.area / ref.area - 1) * 100;
      stats.fixed.push({ pieces: fm.pieces, delta: fDelta });
      const w = memory.weightsFor(pose).reduce((s, x) => Math.max(s, x), 0);
      rows.fixed.push(cell(f, `${fm.pieces} piece${fm.pieces === 1 ? '' : 's'} · ${fDelta >= 0 ? '+' : ''}${fDelta.toFixed(0)}%${w > 0.05 ? ` · memory ${Math.round(w * 100)}%` : ''}`, fm.pieces > 1));
    });

    const sum = (arr) => ({
      torn: arr.filter((s) => s.pieces > 1).length,
      worst: Math.max(...arr.map((s) => Math.abs(s.delta))),
      mean: arr.reduce((s, x) => s + Math.abs(x.delta), 0) / arr.length,
    });
    const sm = sum(stats.mesh), sf = sum(stats.fixed);
    $('wtSummary').innerHTML = `
      <div><b>Rigged mesh</b> ${sm.torn} of ${FRAMES} frames torn · area off by ${sm.mean.toFixed(1)}% on average, ${sm.worst.toFixed(0)}% at worst</div>
      <div><b>Corrected</b> ${sf.torn} of ${FRAMES} frames torn · area off by ${sf.mean.toFixed(1)}% on average, ${sf.worst.toFixed(0)}% at worst</div>
      <small>Measured at a small size. "Torn" means the character is in more than one piece. Area is compared with the drawing at rest; a raised arm changes it a little on its own.</small>`;
    const body = $('wtBody');
    body.innerHTML = '';
    for (const [name, title] of [['drawing', 'Drawing'], ['mesh', 'Rigged mesh'], ['fixed', 'Corrected']]) {
      const row = document.createElement('div');
      row.className = 'wt-row';
      row.innerHTML = label(title);
      const strip = document.createElement('div');
      strip.className = 'wt-strip';
      for (const c of rows[name]) strip.appendChild(c);
      row.appendChild(strip);
      body.appendChild(row);
    }
    frames = { poses, summary: { mesh: sm, fixed: sf } };
    sheet.dataset.ready = '1';
    return frames;
  }

  async function exportSequence() {
    if (!frames) run();
    if (!frames) return;
    const files = [];
    for (let i = 0; i < frames.poses.length; i++) {
      const c = mk(512, 640);
      render(c.getContext('2d'), 512, 640, frames.poses[i], { plain: false });
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      files.push([`wave-${String(i + 1).padStart(2, '0')}.png`, new Uint8Array(await blob.arrayBuffer())]);
    }
    downloadBlob(new Blob([zip(files)], { type: 'application/zip' }), 'wave-test-frames.zip');
    toast('Saved 12 transparent frames.', 2200);
  }

  function open() {
    sheet.classList.remove('hidden');
    // Let the sheet appear before the renders start.
    setTimeout(run, 30);
  }
  $('btnWaveTest').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('close-popovers'));
    open();
  });
  $('wtClose').addEventListener('click', () => sheet.classList.add('hidden'));
  $('wtRerun').addEventListener('click', run);
  $('wtExport').addEventListener('click', exportSequence);
  return { open, run, exportSequence, get frames() { return frames; } };
}
