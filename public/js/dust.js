// Joint dust (optional, off by default): when a joint bends far enough to open a break, a dense
// cloud of very small dots in the colours the artist used around that joint fills the gap. The
// dots are placed once per joint (a sunflower spiral, so density is even), so nothing flickers;
// they only drift a little, and the cloud grows from the middle outward as the bend gets harder.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const GOLDEN = 2.399963229728653;
const TIERS = 6; // colours per joint, picked across the palette from dark to light

// Cheap stable hash → 0..1, so every dot has its own fixed jitter, colour and drift.
const hash = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Pick TIERS colours from the palette, spread from dark to light.
function tiers(pal) {
  const sorted = [...pal].sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  const out = [];
  for (let t = 0; t < TIERS; t++) out.push(sorted[Math.min(sorted.length - 1, Math.floor(((t + 0.5) / TIERS) * sorted.length))]);
  return out.map(([r, g, b]) => `rgb(${r},${g},${b})`);
}

// balls: the joint balls module; it already reads each joint's position, thickness and colours.
export function createJointDust(balls) {
  const cache = new WeakMap(); // sample entry → colour tiers

  // density: 0.4..1.6 (how packed), size: 0.6..2 (how big each dot is, still tiny at 1)
  function draw(ctx, p, rig, P, { alpha = 1, flip = false, density = 1, size = 1, time = 0 } = {}) {
    if (!p?.joints || !p.img) return;
    const S = P.T / p.torso;
    const rest = p.rest;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const s of balls.sample(p)) {
      if (!s.pal?.length) continue;
      const bend = Math.abs(wrap((rig.angle[s.child] - rig.angle[s.parent]) - (rest[s.child] - rest[s.parent])));
      const stretch = Math.abs((rig.ratio[s.child] ?? 1) - 1);
      // Starts a little before the joint balls do, so the break is covered the moment it opens.
      const k = clamp((bend - 0.1) / 0.4 + stretch * 1.5, 0, 1);
      if (k <= 0.01) continue;
      const A = P[s.joint], B = P[s.tip];
      if (!A || !B) continue;
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let cx = A.x + (-(B.y - A.y) / L) * s.off * S;
      let cy = A.y + ((B.x - A.x) / L) * s.off * S;
      if (flip) cx = 2 * P.pelvis.x - cx;
      const R = s.r * S * 1.2; // the cloud reaches a little past the limb's width
      const dot = clamp(R * 0.07, 1.1, 2.2) * size;
      const N = clamp(Math.round(((Math.PI * R * R) / (dot * dot)) * 1.15 * density), 120, 1800);
      const n = Math.ceil(k * N);
      let cols = cache.get(s);
      if (!cols) cache.set(s, (cols = tiers(s.pal)));
      const drift = R * 0.05;
      // One path per colour and fade tier, so a few thousand dots cost a dozen fills.
      const paths = new Map();
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / N;
        const rr = Math.sqrt(u) + (hash(i, 1) - 0.5) * (1.2 / Math.sqrt(N));
        const th = i * GOLDEN + hash(i, 2) * 0.9;
        const ph = hash(i, 3) * 6.283;
        const wob = Math.sin(time * (0.6 + hash(i, 4)) + ph);
        const wob2 = Math.cos(time * (0.5 + hash(i, 5)) + ph);
        const x = cx + Math.cos(th) * Math.max(0, rr) * R + wob * drift;
        const y = cy + Math.sin(th) * Math.max(0, rr) * R + wob2 * drift;
        const edge = rr > 0.78 ? 1 : 0; // the rim fades so the cloud has no hard outline
        const key = ((hash(i, 6) * TIERS) | 0) * 2 + edge;
        let path = paths.get(key);
        if (!path) paths.set(key, (path = new Path2D()));
        const d = dot * (0.8 + hash(i, 7) * 0.7);
        path.rect(x - d / 2, y - d / 2, d, d);
      }
      for (const [key, path] of paths) {
        ctx.globalAlpha = alpha * (key & 1 ? 0.5 : 0.95) * Math.min(1, k * 2.5);
        ctx.fillStyle = cols[key >> 1];
        ctx.fill(path);
      }
    }
    ctx.restore();
  }

  return { draw };
}
