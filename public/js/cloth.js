// Secondary motion for loose clothing, solved with XPBD (extended position-based dynamics). After the
// skeleton has posed the mesh (primary motion), each loose vertex is held to its skinned position by a
// soft attachment (a spring, written as a compliant constraint) and to its neighbours by distance
// constraints that keep the cloth from stretching. It lags on fast moves, swings a little
// and settles. The springs pull toward the animated rest position, never toward raw camera
// landmarks, so tracking noise doesn't turn into wobble.
//
// Rigidity (1 = moves only with the bones) comes from where a vertex sits on the body:
//   head, torso, upper arms, hands, shoes  100% (not simulated)
//   jacket hem 38%, sleeve cuffs 50%, trouser cuffs 35%
import { STEP } from './motion.js';

const RIGID = 0.97; // at or above this, a vertex just follows the skeleton
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// 1 inside [a, b], easing to 0 over `soft` on either side.
const band = (x, a, b, soft) => smooth(a - soft, a, x) * (1 - smooth(b, b + soft, x));

function along(J, from, to, x, y) {
  const [ax, ay] = J[from], [bx, by] = J[to];
  const vx = bx - ax, vy = by - ay;
  return ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1); // 0 at `from`, 1 at `to`
}

// Rigidity of a drawing point (image pixels) on a piece carried by `bone`.
export function rigidityAt(puppet, bone, x, y) {
  const J = puppet.joints;
  const T = puppet.torso;
  if (bone === 'spine') {
    // Jacket hem: the band just above and below the hip line.
    return 1 - 0.62 * smooth(J.pelvis[1] - T * 0.28, J.pelvis[1] + T * 0.02, y);
  }
  if (bone === 'foreArmR' || bone === 'foreArmL') {
    const s = bone.endsWith('R') ? 'R' : 'L';
    return 1 - 0.5 * band(along(J, `elbow${s}`, `wrist${s}`, x, y), 0.72, 1.0, 0.12); // cuff, not hand
  }
  if (bone === 'shinR' || bone === 'shinL') {
    const s = bone.endsWith('R') ? 'R' : 'L';
    return 1 - 0.65 * band(along(J, `knee${s}`, `ankle${s}`, x, y), 0.72, 0.96, 0.1); // cuff, not shoe
  }
  if (bone === 'thighR' || bone === 'thighL' || bone === 'hips') return 0.9; // baggy, but mostly follows
  return 1;
}

export function createCloth() {
  let acc = 0;
  let steps = 0;
  let alpha = 1;
  let settings = { bounce: 0.4 };
  let state = new WeakMap(); // mesh → { rig, loose, x, v, prev }

  function prepare(puppet, piece, mesh) {
    let st = state.get(mesh);
    if (st) return st;
    const n = mesh.count;
    const rig = new Float32Array(n);
    let loose = 0;
    for (let i = 0; i < n; i++) {
      rig[i] = rigidityAt(puppet, piece.bone, mesh.img[i * 2], mesh.img[i * 2 + 1]);
      if (rig[i] < RIGID) loose++;
    }
    // Distance constraints along the mesh's edges (only where at least one end is loose).
    const seen = new Set();
    const list = [];
    const ix = mesh.index;
    for (let t = 0; t < ix.length; t += 3) {
      for (const [a, b] of [[ix[t], ix[t + 1]], [ix[t + 1], ix[t + 2]], [ix[t + 2], ix[t]]]) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const key = lo * n + hi;
        if (seen.has(key) || (rig[lo] >= RIGID && rig[hi] >= RIGID)) continue;
        seen.add(key);
        list.push(lo, hi);
      }
    }
    st = { rig, loose, x: null, v: null, prev: null, edges: Uint32Array.from(list), lambda: new Float32Array(list.length / 2), rest: new Float32Array(list.length / 2) };
    state.set(mesh, st);
    return st;
  }

  return {
    // Once per frame, before drawing: fixed 120 Hz steps, plus the cloth bounce setting (0..1).
    // amount: secondary motion amount (0..1); 0.3 is the designed looseness, higher loosens further.
    frame(dt, bounce, amount = 0.3, stretch = 0.7) {
      acc += Math.min(Math.max(dt, 0), 0.1);
      steps = Math.floor(acc / STEP);
      acc -= steps * STEP;
      alpha = acc / STEP;
      settings = { bounce, amount, stretch };
    },
    // Start every mesh again from its skinned pose (new character, recentre).
    reset() {
      acc = 0;
      state = new WeakMap();
    },

    // Called by the renderer right after skinning: `out` holds the skinned positions (pixels).
    apply(puppet, piece, mesh) {
      const st = prepare(puppet, piece, mesh);
      if (!st.loose) return;
      const out = mesh.out;
      const n = mesh.count;
      if (!st.x || st.x.length !== out.length) {
        st.x = Float32Array.from(out);
        st.prev = Float32Array.from(out);
        st.v = new Float32Array(out.length);
      }
      const zeta = 0.9 - settings.bounce * 0.65; // 0.9 (settles) .. 0.25 (swings)
      const snap = puppet.torso * 0.6; // a big jump (resize, recentre) restarts instead of swinging
      const scale = settings.amount / 0.3;
      const edgeAlpha = 1e-6 + (1 - (settings.stretch ?? 0.7)) * 4e-4; // distance constraints: stiff, a touch of give
      const r = new Float32Array(n);
      const w2 = new Float32Array(n);
      let restart = false;
      for (let i = 0; i < n; i++) {
        r[i] = Math.max(0.1, 1 - (1 - st.rig[i]) * scale);
        const ix = i * 2, iy = ix + 1;
        w2[i] = ((2 * Math.PI) * (2.5 + 9 * r[i])) ** 2; // looser = slower, swingier
        if (r[i] < RIGID && (Math.abs(out[ix] - st.x[ix]) > snap || Math.abs(out[iy] - st.x[iy]) > snap)) restart = true;
      }
      const E = st.edges.length / 2;
      // How long each edge is in the skinned pose: the cloth tries to keep exactly that.
      for (let e = 0; e < E; e++) {
        const i = st.edges[e * 2], j = st.edges[e * 2 + 1];
        st.rest[e] = Math.hypot(out[i * 2] - out[j * 2], out[i * 2 + 1] - out[j * 2 + 1]);
      }
      if (restart) {
        st.x.set(out);
        st.prev.set(out);
        st.v.fill(0);
      }
      const dt = STEP, aE = edgeAlpha / (dt * dt);
      for (let s2 = 0; s2 < steps; s2++) {
        st.prev.set(st.x);
        // Predict: carry on with the current velocity, a little damped.
        for (let i = 0; i < n; i++) {
          const ix = i * 2, iy = ix + 1;
          if (r[i] >= RIGID) {
            st.x[ix] = out[ix];
            st.x[iy] = out[iy];
            st.v[ix] = st.v[iy] = 0;
            continue;
          }
          const w = Math.sqrt(w2[i]);
          const damp = Math.max(0, 1 - 2 * zeta * w * dt);
          st.x[ix] += st.v[ix] * damp * dt;
          st.x[iy] += st.v[iy] * damp * dt;
        }
        st.lambda.fill(0);
        for (let it = 0; it < 2; it++) {
          // Attachment to the skinned position: a compliant constraint with stiffness w^2.
          for (let i = 0; i < n; i++) {
            if (r[i] >= RIGID) continue;
            const ix = i * 2, iy = ix + 1;
            const dx = st.x[ix] - out[ix], dy = st.x[iy] - out[iy];
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const aA = 1 / (w2[i] * dt * dt); // compliance / dt^2
            const k = (-len) / (1 + aA) / len; // delta-lambda along the unit vector, with lambda = 0 each step
            st.x[ix] += dx * k;
            st.x[iy] += dy * k;
          }
          // Neighbours keep their distance, so the cloth moves as one piece and does not stretch.
          for (let e = 0; e < E; e++) {
            const i = st.edges[e * 2], j = st.edges[e * 2 + 1];
            const wi = r[i] >= RIGID ? 0 : 1, wj = r[j] >= RIGID ? 0 : 1;
            if (!wi && !wj) continue;
            const dx = st.x[i * 2] - st.x[j * 2], dy = st.x[i * 2 + 1] - st.x[j * 2 + 1];
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const C = len - st.rest[e];
            const dl = (-C - aE * st.lambda[e]) / (wi + wj + aE);
            st.lambda[e] += dl;
            const nx = dx / len, ny = dy / len;
            st.x[i * 2] += wi * dl * nx;
            st.x[i * 2 + 1] += wi * dl * ny;
            st.x[j * 2] -= wj * dl * nx;
            st.x[j * 2 + 1] -= wj * dl * ny;
          }
        }
        // New velocity from how far each vertex actually moved.
        for (let i = 0; i < n * 2; i++) st.v[i] = (st.x[i] - st.prev[i]) / dt;
      }
      for (let i = 0; i < n; i++) {
        const ix = i * 2, iy = ix + 1;
        if (r[i] >= RIGID) continue;
        // Blend by rigidity so the transition from stiff to loose cloth stays seamless.
        const k = (1 - r[i]) / (1 - 0.35);
        const sx = st.prev[ix] + (st.x[ix] - st.prev[ix]) * alpha;
        const sy = st.prev[iy] + (st.x[iy] - st.prev[iy]) * alpha;
        out[ix] += (sx - out[ix]) * Math.min(1, k);
        out[iy] += (sy - out[iy]) * Math.min(1, k);
      }
    },
  };
}
