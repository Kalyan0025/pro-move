// Wave comparison: a 12-frame wave rendered three ways, side by side, with numbers.
//   Drawing    the artwork as drawn (the reference for how much artwork each joint holds)
//   Rigid      each piece follows one bone, no blending: a control that should tear
//   Rigged     weighted mesh skinning only: what the rig does with no help
//   Corrected  shape preservation and any remembered corrections (AI or hand)
// Every frame is scored from its pixels at the joints that bend in the wave:
//   Tearing    share of the limb's centreline near a joint that has no artwork, beyond what the drawing itself leaves empty there
//   Collapse   how much of the limb's artwork around the joint is missing compared with the drawing
import { BONES } from './rig.js';
import { hingeLevels, jointPoint } from './comfy.js';

export const FRAMES = 12;
const CELL = 360; // render size of one frame, in pixels
const OPAQUE = 100; // alpha above this counts as artwork
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The wave: the right arm lifted out and up, the forearm swinging side to side once over 12 frames.
// k exaggerates the wave: 1 is a friendly wave, higher folds the elbow and lifts the arm further.
export function wavePose(rig, i, k = 1) {
  const base = rig.getPose();
  const t = (i / FRAMES) * Math.PI * 2;
  const angle = { ...rig.rest };
  // Upper arm held out to the side and a little up (the drawing has its arms open); the forearm
  // stands up, tilted outward, and swings across that line without reaching the head.
  angle.upperArmR = -Math.PI + 0.3 * k + 0.1 * k * Math.sin(t + 0.6);
  angle.foreArmR = -Math.PI / 2 - 0.3 + 0.5 * k * Math.sin(t);
  return { ...base, angle: { ...base.angle, ...angle }, ratio: { ...base.ratio }, offset: { x: 0, y: 0 } };
}

const alphaAt = (img, x, y) => {
  const ix = Math.round(x), iy = Math.round(y);
  return ix < 0 || iy < 0 || ix >= img.width || iy >= img.height ? 0 : img.data[(iy * img.width + ix) * 4 + 3];
};
function distToSegment(q, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
}

// Measure one bent joint in a rendered frame. img: ImageData of the frame; P: solved joints.
function measure(img, P, h) {
  const child = BONES.find((b) => b[0] === h.child);
  const parent = BONES.find((b) => b[0] === h.parent);
  const J = jointPoint(P, h.joint);
  const toward = (name) => {
    const p = P[name];
    const d = p ? Math.hypot(p.x - J.x, p.y - J.y) : 0;
    return d > 1 ? { x: (p.x - J.x) / d, y: (p.y - J.y) / d } : null;
  };
  const dirs = [toward(child[2]), toward(parent[1])].filter(Boolean);
  const reach = h.r * 0.9;
  const half = P.T * 0.09;
  let holes = 0, total = 0;
  for (const d of dirs) {
    for (let k = 0; k <= 12; k++) {
      for (let l = -2; l <= 2; l++) {
        const along = (k / 12) * reach;
        const side = (l / 2) * half;
        total++;
        if (alphaAt(img, J.x + d.x * along - d.y * side, J.y + d.y * along + d.x * side) < OPAQUE) holes++;
      }
    }
  }
  // Artwork left around the joint: opaque pixels within the disc that lie along the limb bones.
  const segs = [[J, P[child[2]]], [J, P[parent[1]]]].filter(([, b]) => b);
  const limb = P.T * 0.2;
  let area = 0;
  const step = 2;
  for (let y = -h.r; y <= h.r; y += step) {
    for (let x = -h.r; x <= h.r; x += step) {
      if (x * x + y * y > h.r * h.r) continue;
      const q = { x: J.x + x, y: J.y + y };
      if (alphaAt(img, q.x, q.y) < OPAQUE) continue;
      if (segs.some(([a, b]) => distToSegment(q, a, b) <= limb)) area += step * step;
    }
  }
  return { tear: total ? holes / total : 0, area: area / (P.T * P.T) };
}

// Score every frame of the variants against the drawing. frames: [{ variant: { img, P, hinges } }].
export function score(frames, drawing, variants) {
  const bent = new Set();
  for (const f of frames) for (const h of f.corrected.hinges) if (Math.abs(h.bend) > 0.2) bent.add(h.joint);
  const rest = {}, restTear = {};
  for (const h of drawing.hinges) {
    const m = measure(drawing.img, drawing.P, h);
    rest[h.joint] = m.area;
    restTear[h.joint] = m.tear; // line art is mostly empty inside; only holes beyond this count
  }
  return frames.map((f) => {
    const out = {};
    for (const v of variants) {
      let tear = 0, collapse = 0, worst = null;
      for (const h of f[v].hinges) {
        if (!bent.has(h.joint)) continue;
        const m = measure(f[v].img, f[v].P, h);
        const c = rest[h.joint] > 0.001 ? clamp(1 - m.area / rest[h.joint], 0, 1) : 0;
        const t = Math.max(0, m.tear - (restTear[h.joint] || 0));
        if (t > tear) { tear = t; worst = h.joint; }
        collapse = Math.max(collapse, c);
      }
      out[v] = { tear, collapse, joint: worst };
    }
    return out;
  });
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
export function summarize(scores, variants) {
  const out = {};
  for (const v of variants) {
    const t = scores.map((s) => s[v].tear), c = scores.map((s) => s[v].collapse);
    out[v] = { tearMean: mean(t), tearMax: Math.max(...t), collapseMean: mean(c), collapseMax: Math.max(...c) };
  }
  return out;
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const delta = (d) => (Math.abs(d) < 0.0005 ? '0.0%' : `${d < 0 ? '−' : '+'}${pct(Math.abs(d))}`);
const ROWS = [
  ['drawing', 'Drawing', 'As drawn'],
  ['rigid', 'Rigid cutout', 'Control: no blending'],
  ['rigged', 'Rigged mesh', 'Weighted skinning only'],
  ['corrected', 'Corrected', 'Shape + remembered corrections'],
];

// render(variant, target, W, H, pose) draws the character and returns its solved joints.
export function createWaveCompare({ rig, render, correctives, toast }) {
  let root = null;
  let last = null;
  let k = 1;

  function frameOf(variant, pose) {
    const c = document.createElement('canvas');
    c.width = c.height = CELL;
    const P = render(variant, c.getContext('2d'), CELL, CELL, pose);
    const img = c.getContext('2d').getImageData(0, 0, CELL, CELL);
    return { canvas: c, img, P, hinges: hingeLevels(pose, P, rig.rest, 0) };
  }

  function run(amount = k) {
    k = amount;
    const drawing = frameOf('drawing', { ...rig.getPose(), angle: { ...rig.rest }, offset: { x: 0, y: 0 } });
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
      const pose = wavePose(rig, i, k);
      frames.push({ rigid: frameOf('rigid', pose), rigged: frameOf('rigged', pose), corrected: frameOf('corrected', pose) });
    }
    const variants = ['rigid', 'rigged', 'corrected'];
    const scores = score(frames, drawing, variants);
    last = { frames, drawing, scores, summary: summarize(scores, variants), fixes: correctives.count, hand: correctives.handCount };
    return last;
  }

  const csv = () => ['frame,rigged_tear,rigged_collapse,corrected_tear,corrected_collapse',
    ...last.scores.map((s, i) => [i + 1, s.rigged.tear, s.rigged.collapse, s.corrected.tear, s.corrected.collapse].map((v, k) => (k ? Number(v).toFixed(4) : v)).join(','))].join('\n');

  function show() {
    const r = run();
    root?.remove();
    root = document.createElement('div');
    root.className = 'wc';
    const row = (key, label, sub) => `
      <div class="wc-row" data-row="${key}">
        <div class="wc-label"><b>${label}</b><small>${sub}</small></div>
        ${Array.from({ length: FRAMES }, (_, i) => `<div class="wc-cell" data-i="${i}"><canvas width="${CELL}" height="${CELL}"></canvas>${
          key === 'drawing' ? `<span>${i + 1}</span>` : `<span class="${r.scores[i][key].tear > 0.05 ? 'bad' : ''}">${pct(r.scores[i][key].tear)} · ${pct(r.scores[i][key].collapse)}</span>`}</div>`).join('')}
      </div>`;
    const s = r.summary;
    const better = (a, b) => (a <= b ? 'good' : 'bad');
    const sum = (key, label) => `<tr><th>${label}</th><td>${pct(s[key].tearMean)}</td><td>${pct(s[key].tearMax)}</td><td>${pct(s[key].collapseMean)}</td><td>${pct(s[key].collapseMax)}</td></tr>`;
    root.innerHTML = `
      <div class="wc-head"><b>Wave comparison</b><span>12 frames · ${r.fixes} remembered correction${r.fixes === 1 ? '' : 's'} (${r.hand} by hand)</span>
        <button class="mm-btn" id="wcCopy">Copy results</button><button class="mm-btn" id="wcRun">Run again</button><button class="mm-btn" id="wcClose">Close</button></div>
      <table class="wc-sum"><thead><tr><th></th><th>Tearing, mean</th><th>worst frame</th><th>Joint collapse, mean</th><th>worst frame</th></tr></thead>
        <tbody>${sum('rigid', 'Rigid cutout (control)')}${sum('rigged', 'Rigged mesh')}${sum('corrected', 'Corrected')}
        <tr class="wc-delta"><th>Corrected vs rigged</th>${['tearMean', 'tearMax', 'collapseMean', 'collapseMax'].map((k) => `<td class="${better(s.corrected[k], s.rigged[k])}">${delta(s.corrected[k] - s.rigged[k])}</td>`).join('')}</tr></tbody></table>
      <p class="wc-note">Under each frame: tearing · joint collapse. Tearing is the share of the limb's centreline near a bent joint with no artwork, beyond what the drawing leaves empty. Collapse is how much of the artwork around the joint is missing compared with the drawing. Lower is better; red is over 5% tearing.</p>
      <div class="wc-scroll">${ROWS.map((x) => row(...x)).join('')}</div>`;
    document.getElementById('screen').appendChild(root);
    const put = (key, get) => root.querySelectorAll(`[data-row="${key}"] canvas`).forEach((c, i) => c.getContext('2d').drawImage(get(i), 0, 0));
    // The drawing is the same in every column; the rest are each frame's own render.
    put('drawing', () => r.drawing.canvas);
    put('rigid', (i) => r.frames[i].rigid.canvas);
    put('rigged', (i) => r.frames[i].rigged.canvas);
    put('corrected', (i) => r.frames[i].corrected.canvas);
    root.querySelector('#wcClose').onclick = () => root.remove();
    root.querySelector('#wcRun').onclick = show;
    root.querySelector('#wcCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(csv()); toast('Results copied as CSV.'); } catch { toast('Copy was blocked by the browser.'); }
    };
    return r;
  }

  return { run, show, csv: () => (last ? csv() : ''), get last() { return last; } };
}
