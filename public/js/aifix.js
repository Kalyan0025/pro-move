// Optional last step: "Fix joints" scans the take, finds the joints that break when the rig bends
// them, then has the local AI (ComfyUI) repaint just those spots. Nothing here runs unless the
// person taps the button. While it works the canvas shows it: a light band sweeps down each
// drawing and marks every joint green / yellow / red, then the broken joints are worked on one
// by one (a turning ring and drifting dots) until a tick shows each one is mended.
// The repairs are saved as corrective patches (correctives.js) that blend in as the take plays.
import { hingeLevels, fixGapsWithComfy, comfyStatus } from './comfy.js';

const $ = (id) => document.getElementById(id);
const COLOUR = { clean: [52, 199, 89], mild: [255, 204, 0], strong: [255, 59, 48] };
const NAMES = { headPivot: 'neck', shoulderR: 'shoulder', shoulderL: 'shoulder', elbowR: 'elbow', elbowL: 'elbow', hipR: 'hip', hipL: 'hip', kneeR: 'knee', kneeL: 'knee' };
const ease = (u) => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);
const hash = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const wait = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('Cancelled')); }, { once: true });
});

export function createAiFix({ rig, correctives, takes, renderPose, toast }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let run = null; // { phase, t0, dwell, abort, mended: Set, targets: [] }

  const hud = (title, text, k = null) => {
    $('aiFix').classList.remove('hidden');
    $('aiFixTitle').textContent = title;
    $('aiFixText').textContent = text;
    $('aiFixBar').style.transform = `scaleX(${k == null ? 0 : k})`;
    $('aiFixBar').parentElement.classList.toggle('hidden', k == null);
  };
  const close = () => {
    $('aiFix').classList.add('hidden');
    takes.preview(null);
    run = null;
  };

  // Joints that need repair in a pose, rated on an offscreen render (so it never depends on the screen).
  function rate(pose) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 768;
    const P = renderPose(c.getContext('2d'), 1024, 768, pose);
    return hingeLevels(pose, P, rig.rest);
  }

  async function start() {
    if (run) {
      if (run.phase === 'off') close();
      else run.abort.abort();
      return;
    }
    const poses = takes.poses();
    if (!poses.length) return toast('Capture something first.');
    const comfy = await comfyStatus();
    if (!comfy.ok) {
      hud('The AI is not running', "Fixing joints uses ComfyUI on this laptop. Start it (scripts\\start-comfyui.ps1), then tap Fix joints again.");
      run = { phase: 'off', abort: new AbortController() };
      setTimeout(() => run?.phase === 'off' && close(), 6000);
      return;
    }
    const abort = new AbortController();
    run = { phase: 'scan', t0: performance.now(), dwell: 0, abort, mended: new Set(), targets: [] };
    const { signal } = abort;
    try {
      // 1. Scan: every drawing in turn, a band sweeping over it.
      const dwell = reduced ? 60 : Math.max(140, Math.min(560, 4200 / poses.length));
      const perFrame = []; // per drawing: break key (joint + how far it bends) → how strong
      for (let i = 0; i < poses.length; i++) {
        takes.preview(poses[i]);
        Object.assign(run, { phase: 'scan', t0: performance.now(), dwell });
        hud('Scanning your drawings', `Drawing ${i + 1} of ${poses.length}`, (i + 1) / poses.length);
        const found = new Map();
        for (const h of rate(poses[i])) if (h.strength > 0.04) found.set(`${h.joint}:${Math.round(h.bend / 0.7)}`, h.strength);
        perFrame.push(found);
        await wait(dwell, signal);
      }
      // 2. What was found. One repair run fixes every break in its drawing, so pick the fewest
      // drawings that cover the most (at most 8): a patch made once is reused wherever that joint bends the same way.
      const all = new Set(perFrame.flatMap((m) => [...m.keys()]));
      const todo = new Set(all);
      const picked = [];
      while (todo.size && picked.length < 8) {
        let best = -1, gain = 0;
        perFrame.forEach((m, i) => {
          let g = 0;
          for (const [k, v] of m) if (todo.has(k)) g += v;
          if (g > gain) [best, gain] = [i, g];
        });
        if (best < 0) break;
        picked.push(best);
        for (const k of perFrame[best].keys()) todo.delete(k);
      }
      run.targets = picked.sort((a, b) => a - b).map((i) => [i]);
      const jointNames = new Set([...all].map((k) => NAMES[k.split(':')[0]]));
      if (!run.targets.length) {
        run.phase = 'clean';
        hud('No broken joints', 'Every joint covers well in this take. Nothing to fix.');
        await wait(2400, signal);
        return close();
      }
      hud(`Found ${all.size} break${all.size > 1 ? 's' : ''}`, `At the ${[...jointNames].join(', ')}. Fixing them now.`);
      run.phase = 'found';
      await wait(900, signal);
      // 3. Fix, one drawing at a time.
      let done = 0;
      for (const [i] of run.targets) {
        const pose = poses[i];
        takes.preview(pose);
        run.phase = 'fix';
        run.t0 = performance.now();
        run.mended = new Set();
        hud('Fixing joints', `Drawing ${i + 1} · ${done + 1} of ${run.targets.length}`, done / run.targets.length);
        await fixGapsWithComfy({
          poses: [pose], renderPose, rest: rig.rest, signal,
          settings: { denoise: 0.55, fast: comfy.cpu },
          onFrame: (_, frame, regs, P) => correctives.addFromFrame(frame, regs, P, pose),
        });
        for (const h of rate(pose)) if (h.strength > 0.04) run.mended.add(h.joint);
        run.phase = 'mended';
        run.t1 = performance.now();
        done++;
        hud('Fixing joints', `Drawing ${i + 1} mended`, done / run.targets.length);
        await wait(reduced ? 100 : 650, signal);
      }
      takes.preview(null);
      document.getElementById('optCorrect').checked = true;
      hud('Joints fixed', 'The repairs blend in as the take plays. Everything else is untouched.', 1);
      run.phase = 'done';
      await wait(2800, signal);
      close();
    } catch (err) {
      if (err.message === 'Cancelled') {
        toast('Fix stopped. Repairs already made are kept.', 3000);
      } else {
        console.error(err);
        toast(`The AI fix failed: ${err.message}`, 6000);
      }
      close();
    }
  }
  $('aiFixStop').addEventListener('click', () => {
    if (!run) return;
    if (run.phase === 'off') close();
    else run.abort.abort();
  });

  // Drawn on the stage every frame while a fix is running. P: solved joints on the stage.
  function draw(ctx, P, pose, now) {
    if (!run || !P || !pose || run.phase === 'off') return;
    const T = P.T;
    const hinges = hingeLevels(pose, P, rig.rest);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = P.pelvis.x;
    const top = P.head.y - T * 0.45;
    const bottom = Math.max(P.ankleR?.y ?? 0, P.ankleL?.y ?? 0, P.pelvis.y + T * 1.5) + T * 0.12;
    if (run.phase === 'scan') {
      const u = Math.min(1, (now - run.t0) / run.dwell);
      const y = top + (bottom - top) * u;
      const w = T * 1.15;
      const g = ctx.createLinearGradient(0, y - T * 0.28, 0, y + T * 0.04);
      g.addColorStop(0, 'rgba(30,139,255,0)');
      g.addColorStop(1, 'rgba(30,139,255,.32)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - w, y - T * 0.28, w * 2, T * 0.32);
      ctx.fillStyle = 'rgba(30,139,255,.95)';
      ctx.fillRect(cx - w, y - 1.5, w * 2, 3);
      // Joints light up as the band passes them.
      for (const h of hinges) {
        const passed = (y - h.y) / (bottom - top);
        if (passed < 0) continue;
        const [r, gg, b] = COLOUR[h.level];
        const k = ease(passed * 7);
        ctx.fillStyle = `rgba(${r},${gg},${b},${0.9 * k})`;
        ctx.beginPath();
        ctx.arc(h.x, h.y, Math.max(3, T * 0.035) * (0.5 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
        if (h.level !== 'clean') {
          ctx.strokeStyle = `rgba(${r},${gg},${b},${0.85 * k})`;
          ctx.lineWidth = Math.max(2, h.r * 0.04);
          ctx.setLineDash([h.r * 0.12, h.r * 0.08]);
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r * 0.8 * (0.6 + 0.4 * k), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    } else if (run.phase === 'fix' || run.phase === 'mended' || run.phase === 'found') {
      const t = (now - run.t0) / 1000;
      hinges.forEach((h, n) => {
        if (h.strength <= 0.04) {
          const [r, gg, b] = COLOUR.clean;
          ctx.fillStyle = `rgba(${r},${gg},${b},.85)`;
          ctx.beginPath();
          ctx.arc(h.x, h.y, Math.max(3, T * 0.03), 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        const fixed = run.phase === 'mended' && run.mended.has(h.joint);
        const [r, gg, b] = fixed ? COLOUR.clean : COLOUR.strong;
        if (!fixed) {
          // Working: a ring turning round the break, and fine dots drifting inside it.
          ctx.strokeStyle = `rgba(${r},${gg},${b},.9)`;
          ctx.lineWidth = Math.max(2, h.r * 0.04);
          ctx.setLineDash([h.r * 0.14, h.r * 0.1]);
          ctx.lineDashOffset = -t * h.r * 0.9;
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r * 0.8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${r},${gg},${b},.8)`;
          for (let i = 0; i < 26; i++) {
            const a = hash(i + n * 40, 1) * 6.283 + t * (0.6 + hash(i, 2));
            const d = Math.sqrt(hash(i + n * 40, 3)) * h.r * 0.72;
            ctx.fillRect(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, 2, 2);
          }
        } else {
          // Mended: a green ring that settles, with a tick.
          const k = ease((now - run.t1) / 350);
          ctx.strokeStyle = `rgba(${r},${gg},${b},${0.9 * (1 - 0.5 * k)})`;
          ctx.lineWidth = Math.max(2, h.r * 0.05);
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r * (0.8 + 0.25 * k), 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = Math.max(2.5, h.r * 0.07);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(h.x - h.r * 0.22, h.y);
          ctx.lineTo(h.x - h.r * 0.05, h.y + h.r * 0.17);
          ctx.lineTo(h.x + h.r * 0.25, h.y - h.r * 0.18);
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  return { start, draw, get running() { return !!run; } };
}
