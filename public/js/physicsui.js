// The Physics tab (Actions › Rig › Physics): presets, five sliders, a small graph of how the body and
// the forearm settle, a live readout of the squash, and Copy configuration.
import { PRESETS, CONTROLS } from './physics.js';

const $ = (id) => document.getElementById(id);

export function createPhysicsUI({ physics, toast }) {
  const cfg = physics.cfg;
  $('phPresets').innerHTML = Object.entries(PRESETS).map(([id, p]) => `<button data-p="${id}">${p.label}</button>`).join('');
  $('phSliders').innerHTML = CONTROLS.map(([k, label, hint]) => `
    <div class="row slider-row ph-row"><span>${label}</span><output id="ph_${k}_out"></output>
      <input type="range" id="ph_${k}" data-k="${k}" min="0" max="100" step="1" aria-label="${label}"><small class="ph-hint">${hint}</small></div>`).join('');
  function show() {
    for (const [k] of CONTROLS) {
      $(`ph_${k}`).value = Math.round(cfg[k] * 100);
      $(`ph_${k}_out`).textContent = `${Math.round(cfg[k] * 100)}%`;
    }
    for (const b of $('phPresets').querySelectorAll('button')) b.classList.toggle('on', b.dataset.p === cfg.preset);
    $('phLimits').checked = cfg.limits;
    physics.plotSpring($('phPlot'));
  }
  $('phPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    physics.setPreset(b.dataset.p);
    show();
  });
  $('phSliders').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    physics.set(k, Number(e.target.value) / 100);
    show();
  });
  $('phLimits').addEventListener('input', () => physics.set('limits', $('phLimits').checked));
  $('phCopy').addEventListener('click', async () => {
    const text = physics.text();
    try {
      await navigator.clipboard.writeText(text);
      toast('Physics configuration copied.', 1600);
    } catch {
      prompt('Copy this configuration', text);
    }
  });
  // A live readout of the body's squash and stretch, a few times a second, while the tab is open.
  setInterval(() => {
    if ($('phNow').offsetParent === null) return;
    const { sy } = physics.squashNow;
    const pct = Math.round((sy - 1) * 100);
    $('phNow').textContent = Math.abs(pct) < 1 ? 'The body is at its normal height. Move, jump or step in the camera view to see it work.' : `Body height ${pct > 0 ? '+' : ''}${pct}% (width ${Math.round((1 / sy - 1) * 100)}%), the area stays the same.`;
  }, 250);
  physics.apply();
  show();
  return { show };
}
