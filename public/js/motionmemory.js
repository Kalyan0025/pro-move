// Motion Memory: the artist paints a fix over a joint that breaks in the current pose. The fix is
// stored with that joint's bend (correctives.js) and fades back in whenever the joint bends close
// to the same angle again, following the parent bone. Hand fixes and AI repairs share one store.
import { hingeLevels } from './comfy.js';

export function createMotionMemory({ rig, correctives, stage, getP, getPose, toast, onChange }) {
  let phase = 'off'; // off | pick | paint
  let hinge = null;
  let pose = null;
  let P = null;
  let paint = null;
  let pen = { size: 10, color: '#c8403a', erase: false, sample: false };
  let last = null;

  const point = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * stage.width) / r.width, y: ((e.clientY - r.top) * stage.height) / r.height };
  };
  const hold = (on) => {
    if (window.motionRig) window.motionRig.freeze = on;
  };

  function leave() {
    phase = 'off';
    hinge = pose = P = paint = last = null;
    hold(false);
    onChange?.();
  }

  function stroke(a, b) {
    const g = paint.getContext('2d');
    g.save();
    // Strokes stay inside the circle around the joint, so a correction is always local.
    g.beginPath();
    g.arc(hinge.x, hinge.y, hinge.r, 0, Math.PI * 2);
    g.clip();
    g.globalCompositeOperation = pen.erase ? 'destination-out' : 'source-over';
    g.strokeStyle = g.fillStyle = pen.color;
    g.lineWidth = pen.size * (P.T / 300);
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.restore();
  }

  function pickColour(at) {
    const d = stage.getContext('2d').getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data;
    if (!d[3]) return;
    pen.color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    pen.sample = false;
    onChange?.();
  }

  return {
    get phase() { return phase; },
    get pen() { return pen; },
    get hinge() { return hinge; },
    setPen(next) {
      pen = { ...pen, ...next };
      onChange?.();
    },
    start() {
      phase = 'pick';
      toast('Pose the character, then tap the joint that breaks.', 4000);
      onChange?.();
    },
    cancel() {
      if (phase !== 'off') leave();
    },
    // Save the strokes as a correction for this bend.
    done() {
      if (phase !== 'paint') return;
      correctives.addHand(paint, hinge, P, pose);
      const name = hinge.joint.replace(/([RL])$/, ' $1').replace('headPivot', 'neck');
      leave();
      toast(`Remembered: ${name}. It shows whenever this joint bends about this far.`, 4000);
    },
    // Pointer events on the stage. Returns true when the event was used.
    down(e) {
      if (phase === 'off') return false;
      const at = point(e);
      if (phase === 'pick') {
        const p = getP();
        const shown = getPose();
        if (!p) return true;
        const hits = hingeLevels(shown, p, rig.rest, 0)
          .map((h) => ({ h, d: Math.hypot(h.x - at.x, h.y - at.y) }))
          .filter(({ h, d }) => d < h.r * 1.6)
          .sort((a, b) => a.d - b.d);
        if (!hits.length) {
          toast('No joint there. Tap a shoulder, elbow, hip, knee or the neck.', 2500);
          return true;
        }
        hinge = hits[0].h;
        pose = shown;
        P = p;
        paint = document.createElement('canvas');
        paint.width = stage.width;
        paint.height = stage.height;
        phase = 'paint';
        hold(true);
        onChange?.();
        return true;
      }
      if (pen.sample) {
        pickColour(at);
        return true;
      }
      last = at;
      stroke(at, at);
      return true;
    },
    move(e) {
      if (phase !== 'paint' || !last) return;
      const at = point(e);
      stroke(last, at);
      last = at;
    },
    up() {
      last = null;
    },
    // On top of the character while choosing and painting.
    draw(ctx) {
      if (phase === 'off') return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (phase === 'paint') {
        ctx.drawImage(paint, 0, 0);
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1e8bff';
        ctx.beginPath();
        ctx.arc(hinge.x, hinge.y, hinge.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (getP()) {
        // Show the joints that can be corrected.
        ctx.fillStyle = 'rgba(30,139,255,.35)';
        ctx.strokeStyle = '#1e8bff';
        ctx.lineWidth = 2;
        for (const h of hingeLevels(getPose(), getP(), rig.rest, 0)) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}
