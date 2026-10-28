// Motion Memory: corrections the artist paints by hand, remembered by pose.
//
// Freeze the character where it looks wrong, paint over the problem (an elbow that creases, a sleeve
// that gaps), and press Remember. The painted patch is stored with the pose of the limb it belongs
// to and follows that limb's bone. Later, whenever the limb is near the same pose, the patch fades
// back in; between two remembered poses their patches cross-fade. This is pose-space deformation
// with the artist's own painting as the corrective shape, so nothing here is generated.
import { BONES } from './rig.js';

const KEY = (character) => `rig.memory.${character}`;
const OPTS = 'rig.memory.opts';
const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const $ = (id) => document.getElementById(id);

// Bones that carry a patch, and the bones whose angles decide when it applies.
const FAMILY = {
  upperArmR: ['upperArmR', 'foreArmR'], foreArmR: ['upperArmR', 'foreArmR'],
  upperArmL: ['upperArmL', 'foreArmL'], foreArmL: ['upperArmL', 'foreArmL'],
  thighR: ['thighR', 'shinR'], shinR: ['thighR', 'shinR'],
  thighL: ['thighL', 'shinL'], shinL: ['thighL', 'shinL'],
  spine: ['spine', 'neck'], neck: ['spine', 'neck'],
};
const BONE = Object.fromEntries(BONES.map(([name, from, to]) => [name, { from, to }]));
const LABEL = {
  upperArmR: 'Left arm', foreArmR: 'Left arm', upperArmL: 'Right arm', foreArmL: 'Right arm',
  thighR: 'Left leg', shinR: 'Left leg', thighL: 'Right leg', shinL: 'Right leg', spine: 'Body', neck: 'Head',
};

function nearestBone(P, x, y) {
  let best = null, bestD = Infinity;
  for (const name of Object.keys(FAMILY)) {
    const a = P[BONE[name].from], b = P[BONE[name].to];
    if (!a || !b) continue;
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    const d = Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t));
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

export function createMemory({ rig, stage, getP, getColour, setColour, toast }) {
  let character = null;
  let entries = [];
  const opts = { on: true, radius: 0.45, strength: 1 };
  try { Object.assign(opts, JSON.parse(localStorage.getItem(OPTS) || '{}')); } catch {}
  const persistOpts = () => { try { localStorage.setItem(OPTS, JSON.stringify(opts)); } catch {} };
  let onChange = () => {};

  function save() {
    if (!character) return;
    try {
      localStorage.setItem(KEY(character), JSON.stringify(entries.map(({ canvas, ...e }) => ({ ...e, src: canvas.toDataURL('image/png') }))));
    } catch {
      toast('Too big to keep on this device. The correction works until you reload.', 3500);
    }
  }

  // How strongly each entry applies to a pose. The weights of entries for the same limb add up to at most 1,
  // so two nearby corrections cross-fade instead of piling on.
  function weights(pose) {
    const w = entries.map((e) => {
      const fam = FAMILY[e.bone];
      let sum = 0;
      for (const k of fam) sum += wrap((pose.angle[k] ?? 0) - (e.pose[k] ?? 0)) ** 2;
      const d = Math.sqrt(sum / fam.length);
      return smooth(Math.max(0, Math.min(1, 1 - d / opts.radius)));
    });
    const total = {};
    entries.forEach((e, i) => { total[FAMILY[e.bone][0]] = (total[FAMILY[e.bone][0]] || 0) + w[i]; });
    return w.map((x, i) => x / Math.max(1, total[FAMILY[entries[i].bone][0]]) * opts.strength);
  }

  const api = {
    opts,
    get entries() { return entries; },
    get count() { return entries.length; },
    get character() { return character; },
    set onChange(fn) { onChange = fn; },
    setOpt(k, v) { opts[k] = v; persistOpts(); onChange(); },
    weightsFor: (pose) => weights(pose),

    async load(key) {
      character = key;
      entries = [];
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(KEY(key)) || '[]'); } catch {}
      for (const e of saved) {
        const img = new Image();
        img.src = e.src;
        await img.decode().catch(() => {});
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        delete e.src;
        entries.push({ ...e, canvas });
      }
      onChange();
    },
    remove(id) {
      entries = entries.filter((e) => e.id !== id);
      save();
      onChange();
    },
    clear() {
      entries = [];
      save();
      onChange();
    },

    // Put the remembered patches that match the rig's pose over the drawing. sq: the live squash, if any.
    draw(ctx, pose, P, sq = null) {
      if (!opts.on || !entries.length || !P) return;
      const w = weights(pose);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (sq) {
        ctx.translate(sq.x, sq.y);
        ctx.scale(sq.sx, sq.sy);
        ctx.translate(-sq.x, -sq.y);
      }
      entries.forEach((e, i) => {
        if (w[i] <= 0.004) return;
        const at = P[BONE[e.bone].from];
        if (!at) return;
        const k = P.T / e.T;
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(wrap((pose.angle[e.bone] ?? 0) - e.boneAngle));
        ctx.scale(k, k);
        ctx.translate(-e.ax, -e.ay);
        ctx.globalAlpha = Math.min(1, w[i]);
        ctx.drawImage(e.canvas, e.x0, e.y0);
        ctx.restore();
      });
      ctx.restore();
    },

    // ------------------------------------------------------------ teaching
    get teaching() { return !!session; },
    teach() {
      const P = getP();
      if (!P) return toast('Show the character first.');
      if (session) return;
      beginSession(P);
    },
    cancel() { endSession(); },
    remember() { return finish(); },
    // For tests and scripts: remember a patch cut from a canvas, as if it had been painted.
    addPatch({ canvas, pose, P, bone }) {
      const bb = box(canvas);
      if (!bb) return null;
      return store(canvas, bb, pose, P, bone);
    },
  };

  // ------------------------------------------------------------ the painting session
  let session = null;

  function box(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  function store(canvas, bb, pose, P, boneOverride) {
    const pad = 4;
    const x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad);
    const x1 = Math.min(canvas.width - 1, bb.x1 + pad), y1 = Math.min(canvas.height - 1, bb.y1 + pad);
    const patch = document.createElement('canvas');
    patch.width = x1 - x0 + 1;
    patch.height = y1 - y0 + 1;
    patch.getContext('2d').drawImage(canvas, -x0, -y0);
    const bone = boneOverride || nearestBone(P, (x0 + x1) / 2, (y0 + y1) / 2);
    const from = P[BONE[bone].from];
    const n = entries.filter((e) => LABEL[e.bone] === LABEL[bone]).length + 1;
    const entry = {
      id: Math.random().toString(36).slice(2, 9),
      name: `${LABEL[bone]} ${n}`,
      bone,
      pose: Object.fromEntries(FAMILY[bone].map((k) => [k, pose.angle[k]])),
      boneAngle: pose.angle[bone],
      ax: from.x, ay: from.y, T: P.T, x0, y0, canvas: patch,
    };
    entries.push(entry);
    save();
    onChange();
    return entry;
  }

  function beginSession(P) {
    const cv = document.createElement('canvas');
    cv.width = stage.width;
    cv.height = stage.height;
    cv.className = 'mem-canvas';
    cv.style.transform = stage.style.transform;
    cv.style.transformOrigin = stage.style.transformOrigin;
    stage.parentElement.appendChild(cv);
    const g = cv.getContext('2d', { willReadFrequently: true });
    const bar = document.createElement('div');
    bar.className = 'toolbar mem-bar';
    bar.innerHTML = `
      <span class="bar-title">Paint over the problem</span>
      <label class="mem-col" data-tip="Colour"><input type="color" value="${getColour()}"></label>
      <button class="bar-btn" data-m="pick" data-tip="Tap the drawing to take its colour">Pick colour</button>
      <button class="bar-btn" data-m="erase">Erase</button>
      <label class="bar-slide"><span>Size</span><input type="range" min="2" max="60" value="16"><output>16</output></label>
      <button class="bar-btn" data-m="undo">Undo</button>
      <button class="bar-cancel" data-m="cancel">Cancel</button>
      <button class="bar-done" data-m="remember">Remember</button>`;
    document.body.appendChild(bar);
    const prevFreeze = !!window.motionRig?.freeze;
    if (window.motionRig) window.motionRig.freeze = true;
    session = { cv, g, bar, P, pose: rig.getPose(), prevFreeze, mode: 'paint', size: 16, undo: [], down: null };
    const s = session;
    const colourIn = bar.querySelector('input[type=color]');
    const sizeIn = bar.querySelector('input[type=range]');

    const at = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * stage.width, y: ((e.clientY - r.top) / r.height) * stage.height };
    };
    const dab = (a, b, pr) => {
      const r = (s.size / 2) * (0.4 + 0.6 * pr);
      g.save();
      g.lineCap = g.lineJoin = 'round';
      g.lineWidth = r * 2;
      g.strokeStyle = colourIn.value;
      g.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.restore();
    };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = at(e);
      if (s.mode === 'pick') {
        const px = stage.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        if (px[3] > 20) colourIn.value = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        s.mode = 'paint';
        bar.querySelector('[data-m=pick]').classList.remove('on');
        return;
      }
      cv.setPointerCapture(e.pointerId);
      s.undo.push(g.getImageData(0, 0, cv.width, cv.height));
      if (s.undo.length > 12) s.undo.shift();
      s.down = p;
      dab(p, p, e.pointerType === 'pen' ? e.pressure || 0.5 : 1);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!s.down) return;
      const p = at(e);
      dab(s.down, p, e.pointerType === 'pen' ? e.pressure || 0.5 : 1);
      s.down = p;
    });
    const up = () => { s.down = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    sizeIn.addEventListener('input', () => { s.size = Number(sizeIn.value); sizeIn.nextElementSibling.textContent = sizeIn.value; });
    bar.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      if (m === 'pick' || m === 'erase') {
        s.mode = s.mode === m ? 'paint' : m;
        for (const b of bar.querySelectorAll('[data-m=pick],[data-m=erase]')) b.classList.toggle('on', b.dataset.m === s.mode);
      } else if (m === 'undo') {
        const im = s.undo.pop();
        if (im) g.putImageData(im, 0, 0);
      } else if (m === 'cancel') endSession();
      else if (m === 'remember') finish();
    });
    toast('Paint the fix on the frozen pose, then tap Remember.', 3200);
  }

  function finish() {
    if (!session) return null;
    const { cv, P, pose } = session;
    const bb = box(cv);
    if (!bb) {
      toast('Paint something first.');
      return null;
    }
    const e = store(cv, bb, pose, P);
    endSession();
    toast(`Remembered "${e.name}". It comes back near this pose.`, 2600);
    return e;
  }

  function endSession() {
    if (!session) return;
    session.cv.remove();
    session.bar.remove();
    if (window.motionRig) window.motionRig.freeze = session.prevFreeze;
    session = null;
    onChange();
  }

  return api;
}

// The Memory tab (Actions › Rig › Memory).
export function createMemoryUI({ memory, actionsPanel }) {
  const list = $('memList');
  function show() {
    $('memOn').checked = memory.opts.on;
    $('memRadius').value = Math.round(memory.opts.radius * 100);
    $('memRadiusOut').textContent = `${Math.round((memory.opts.radius * 180) / Math.PI)}°`;
    $('memStrength').value = Math.round(memory.opts.strength * 100);
    $('memStrengthOut').textContent = `${Math.round(memory.opts.strength * 100)}%`;
    list.innerHTML = memory.entries.length
      ? memory.entries.map((e) => `<div class="row mem-item"><img alt="" src="${e.canvas.toDataURL()}"><span>${e.name}<small>${FAMILY[e.bone].map((k) => `${Math.round((e.pose[k] * 180) / Math.PI)}°`).join(' · ')}</small></span><button class="mem-del" data-id="${e.id}" aria-label="Forget ${e.name}">&times;</button></div>`).join('')
      : '<p class="hint">Nothing remembered yet. Freeze a pose that looks wrong and paint the fix.</p>';
  }
  memory.onChange = show;
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.mem-del');
    if (b) memory.remove(b.dataset.id);
  });
  $('memTeach').addEventListener('click', () => {
    actionsPanel();
    memory.teach();
  });
  $('memOn').addEventListener('input', () => memory.setOpt('on', $('memOn').checked));
  $('memRadius').addEventListener('input', () => memory.setOpt('radius', Number($('memRadius').value) / 100));
  $('memStrength').addEventListener('input', () => memory.setOpt('strength', Number($('memStrength').value) / 100));
  $('memClear').addEventListener('click', () => {
    if (memory.count && confirm('Forget every remembered correction for this character?')) memory.clear();
  });
  show();
  return { show };
}
