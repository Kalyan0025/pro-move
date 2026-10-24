// Character physics: the few numbers an animator should touch, and the motion they drive.
//
// The engine underneath already has critically damped springs at a fixed 120 Hz for the skeleton
// (motion.js), shape-preserving skinning (deform.js), XPBD cloth (cloth.js) and one-euro tracking
// filters (filters.js). This module turns five sliders into the settings those use, and adds what
// was missing around them:
//   squash & stretch   a spring on the body's height that stretches with fast vertical movement and
//                      squashes on landing, keeping its area (wider when shorter) like a cartoon
//   ground contact     feet never sink below the floor; a planted foot stays put instead of sliding
//   joint limits       elbows, knees and the head fold only so far
//   volume             a foreshortened limb gets a little fatter (see boneMatrices)
// Physics only changes what is drawn live. Recorded takes, thumbnails and exports keep the rig's own pose.
const KEY = 'promove.physics';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const PRESETS = {
  natural: { label: 'Natural', stiffness: 0.45, squash: 0.2, follow: 0.35, shape: 0.8, ground: 0.5 },
  cartoon: { label: 'Cartoon', stiffness: 0.35, squash: 0.55, follow: 0.85, shape: 0.85, ground: 0.4 },
  soft: { label: 'Soft body', stiffness: 0.2, squash: 0.75, follow: 0.9, shape: 0.6, ground: 0.3 },
  rigid: { label: 'Rigid', stiffness: 0.9, squash: 0, follow: 0.1, shape: 0.95, ground: 0.7 },
};
export const CONTROLS = [
  ['stiffness', 'Rig stiffness', 'How closely the body keeps its intended pose. Low is looser and slower to settle.'],
  ['squash', 'Squash & stretch', 'How much the body stretches when it moves fast and squashes when it lands.'],
  ['follow', 'Follow-through', 'How much forearms, the head and cloth trail behind and swing past before settling.'],
  ['shape', 'Shape preservation', 'Resistance to the drawing collapsing or stretching at the joints.'],
  ['ground', 'Ground contact', 'Keeps the feet on the floor and stops planted feet from sliding.'],
];

export function createPhysics({ rig, toast }) {
  const cfg = { preset: 'natural', ...PRESETS.natural, limits: true };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    Object.assign(cfg, saved);
  } catch {}
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
  };

  // ------------------------------------------------------------ the numbers the engine uses
  function derived() {
    const { stiffness: s, squash, follow, shape, ground } = cfg;
    return {
      smooth: clamp(0.92 - s * 0.85, 0.05, 0.9), // primary springs: higher is slower and softer
      follow,
      overshoot: Math.max(0, follow - 0.5) * 2, // 0 below 50%: no swing past; 1 at 100%
      bounce: 0.15 + follow * 0.7, // cloth swing
      secondary: 0.12 + (1 - s) * 0.33, // how loose the cloth is
      stretch: 0.5 + shape * 0.45, // cloth edges: how hard they resist stretching
      shape, // Delta Mush amount
      volume: shape,
      squash,
      ground,
      limits: cfg.limits ? 1 - shape : null, // null: no joint limits
    };
  }

  // ------------------------------------------------------------ squash & stretch
  const sq = { s: 0, v: 0, prevY: null, prevVy: 0, sy: 1, sx: 1 };
  function squashStep(dt) {
    const d = derived();
    const y = rig.offset.y;
    if (sq.prevY == null) sq.prevY = y;
    const vy = (y - sq.prevY) / Math.max(dt, 1 / 240); // torso lengths per second, down is positive
    sq.prevY = y;
    // Landing: falling fast, then suddenly not. The body is pushed short (negative stretch).
    if (sq.prevVy > 0.9 && vy < sq.prevVy * 0.35) sq.v -= sq.prevVy * 3.2;
    sq.prevVy = vy;
    // A spring on the stretch: it is pulled toward a height-stretch that grows with vertical speed.
    const target = clamp(Math.abs(vy) * 0.05, 0, 0.3);
    const k = (2 * Math.PI * 5) ** 2, c = 2 * 0.3 * Math.sqrt(k); // 5 Hz, underdamped: swings past and settles
    const n = Math.max(1, Math.round(dt * 120));
    const h = Math.min(dt, 0.05) / n;
    for (let i = 0; i < n; i++) {
      sq.v += (k * (target - sq.s) - c * sq.v) * h;
      sq.s += sq.v * h;
    }
    sq.s = clamp(sq.s, -0.4, 0.45);
    const sy = clamp(1 + sq.s * d.squash * 1.4, 0.72, 1.3);
    sq.sy = sy;
    sq.sx = 1 / sy; // the area stays the same
  }

  // ------------------------------------------------------------ ground contact
  const gr = { floor: null, anchor: { R: null, L: null }, prev: { R: null, L: null }, still: { R: 0, L: 0 } };
  function floorY() {
    // Where the lowest foot is when the character stands as drawn, in torso lengths.
    const keep = { a: { ...rig.angle }, r: { ...rig.ratio }, o: { ...rig.offset } };
    Object.assign(rig.angle, rig.rest);
    for (const k of Object.keys(rig.ratio)) rig.ratio[k] = 1;
    rig.offset.x = rig.offset.y = 0;
    const P = rig.solveUnits();
    const y = Math.max(P.ankleR.y, P.ankleL.y);
    Object.assign(rig.angle, keep.a);
    Object.assign(rig.ratio, keep.r);
    Object.assign(rig.offset, keep.o);
    return y;
  }
  function groundStep(dt) {
    const g = derived().ground;
    if (g < 0.02) return;
    if (gr.floor == null) gr.floor = floorY();
    const P = rig.solveUnits();
    const low = Math.max(P.ankleR.y, P.ankleL.y);
    // The floor: a foot below it pushes the whole body up.
    const pen = low - gr.floor;
    if (pen > 0.012) rig.offset.y -= pen * (0.4 + g * 0.6);
    // Planted feet stay where they landed.
    const lock = clamp((g - 0.3) / 0.7, 0, 1) * 0.6;
    if (lock <= 0) return;
    let sum = 0, count = 0;
    for (const side of ['R', 'L']) {
      const a = P[`ankle${side}`];
      const prev = gr.prev[side];
      const speed = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / Math.max(dt, 1 / 240) : 9;
      gr.prev[side] = { x: a.x, y: a.y };
      const onFloor = a.y > gr.floor - 0.06;
      gr.still[side] = onFloor && speed < 0.7 ? gr.still[side] + 1 : 0;
      if (gr.still[side] < 3) {
        gr.anchor[side] = null;
        continue;
      }
      if (!gr.anchor[side]) gr.anchor[side] = a.x;
      const dx = gr.anchor[side] - a.x;
      if (Math.abs(dx) > 0.4) gr.anchor[side] = a.x; // a real step, not drift
      else {
        sum += dx;
        count++;
      }
    }
    if (count) rig.offset.x += clamp((sum / count) * lock, -0.04, 0.04);
  }

  // ------------------------------------------------------------ the public side
  function apply() {
    const d = derived();
    rig.volume = d.volume;
  }
  const plot = { fn: null };
  return {
    cfg,
    get d() { return derived(); },
    presets: PRESETS,
    apply,
    // Once per frame, after the rig has been updated from tracking, when the character is live.
    step(dt, live) {
      apply();
      if (!live) {
        sq.s = sq.v = 0;
        sq.sx = sq.sy = 1;
        sq.prevY = null;
        return;
      }
      squashStep(dt);
      groundStep(dt);
    },
    // The squash for the live draw, about the feet: { sx, sy, y } or null when there is none.
    squashFor(P) {
      if (Math.abs(sq.sy - 1) < 0.004) return null;
      const feet = Math.max(P.ankleR.y, P.ankleL.y) + P.T * 0.06;
      return { sx: sq.sx, sy: sq.sy, x: P.pelvis.x, y: feet };
    },
    get squashNow() { return { sx: sq.sx, sy: sq.sy }; },
    reset() {
      gr.floor = null;
      gr.anchor = { R: null, L: null };
      gr.prev = { R: null, L: null };
      gr.still = { R: 0, L: 0 };
      sq.s = sq.v = 0;
      sq.prevY = null;
    },
    setPreset(id) {
      if (!PRESETS[id]) return;
      Object.assign(cfg, PRESETS[id], { preset: id });
      persist();
      apply();
    },
    set(key, value) {
      cfg[key] = key === 'limits' ? !!value : clamp(Number(value), 0, 1);
      cfg.preset = Object.keys(PRESETS).find((id) => CONTROLS.every(([k]) => Math.abs(PRESETS[id][k] - cfg[k]) < 0.005)) || 'custom';
      persist();
      apply();
    },
    text() {
      const d = derived();
      return [
        'Pro Move: character physics',
        `Preset: ${cfg.preset === 'custom' ? 'custom' : PRESETS[cfg.preset].label}`,
        ...CONTROLS.map(([k, label]) => `${label}: ${Math.round(cfg[k] * 100)}%`),
        `Joint limits: ${cfg.limits ? 'on' : 'off'}`,
        '',
        'Engine settings this gives:',
        `primary smoothing ${d.smooth.toFixed(2)}, follow-through ${d.follow.toFixed(2)}, overshoot ${d.overshoot.toFixed(2)}`,
        `cloth bounce ${d.bounce.toFixed(2)}, looseness ${d.secondary.toFixed(2)}, edge stiffness ${d.stretch.toFixed(2)}`,
        `shape preservation ${d.shape.toFixed(2)}, volume ${d.volume.toFixed(2)}, squash ${d.squash.toFixed(2)}, ground ${d.ground.toFixed(2)}`,
      ].join('\n');
    },
    // A step response of a spring with this much follow-through, for the little graph.
    plotSpring(canvas) {
      const d = derived();
      const g = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(120,120,128,.14)';
      g.fillRect(0, 0, W, H);
      const f = 7.5 - d.smooth * 6;
      const draw = (zeta, wHz, colour, label) => {
        const w = 2 * Math.PI * wHz;
        g.strokeStyle = colour;
        g.lineWidth = 2.5;
        g.beginPath();
        for (let px = 0; px <= W; px++) {
          const t = (px / W) * 1.4;
          let y;
          if (zeta >= 0.999) y = 1 - (1 + w * t) * Math.exp(-w * t);
          else {
            const wd = w * Math.sqrt(1 - zeta * zeta);
            y = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
          }
          const py = H - 10 - y * (H - 36);
          px ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
        g.fillStyle = colour;
        g.font = '11px -apple-system, system-ui, sans-serif';
        g.fillText(label, 8, label === 'Body' ? 14 : 28);
      };
      g.strokeStyle = 'rgba(255,255,255,.18)';
      g.setLineDash([4, 4]);
      g.beginPath();
      const ty = H - 10 - (H - 36);
      g.moveTo(0, ty);
      g.lineTo(W, ty);
      g.stroke();
      g.setLineDash([]);
      draw(1, f, '#7fb6ff', 'Body');
      draw(1 - 0.62 * Math.min(1, d.overshoot), f * (1 - d.follow * 0.45), '#ffb454', 'Forearm and head');
    },
  };
}
