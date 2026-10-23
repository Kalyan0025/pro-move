// Welcome tour: three short beats built from the app's own screens (about 11 s), then the
// choice of how to start a character. The same chooser opens from the "New character" button.
//
// Beats auto-advance; a tap on the picture goes forward, Skip jumps to the choice.

const $ = (id) => document.getElementById(id);
const BEAT_MS = 3600;
const BEATS = [
  { title: 'Bring your own character', text: 'Upload a PNG, SVG or PSD from Procreate or anywhere, or sketch one right here.' },
  { title: 'We scan it and add the skeleton', text: 'Joints are found automatically. Nudge any dot that is off.' },
  { title: 'Move, and it moves with you', text: 'Use your camera or the demo performer, then fine-tune the take in layers.' },
  { title: 'Your turn', text: 'How do you want to start?' },
];
const SEEN = 'rig.onboarded';

export function createOnboarding({ onFile, onSketch, onSample }) {
  const root = $('onb');
  const bars = [...root.querySelectorAll('.onb-bars i')];
  let beat = 0;
  let timer = 0;

  function show(i) {
    beat = Math.max(0, Math.min(BEATS.length - 1, i));
    clearTimeout(timer);
    // Restart the beat's CSS animations by flipping the attribute across a reflow.
    root.removeAttribute('data-beat');
    void root.offsetWidth;
    root.setAttribute('data-beat', String(beat));
    $('onbTitle').textContent = BEATS[beat].title;
    $('onbText').textContent = BEATS[beat].text;
    bars.forEach((b, k) => {
      b.className = k < beat ? 'done' : k === beat && beat < BEATS.length - 1 ? 'run' : k === beat ? 'done' : '';
    });
    $('onbSkip').classList.toggle('hidden', beat === BEATS.length - 1);
    if (beat < BEATS.length - 1) timer = setTimeout(() => show(beat + 1), BEAT_MS);
  }

  function close() {
    clearTimeout(timer);
    root.classList.add('hidden');
    try { localStorage.setItem(SEEN, '1'); } catch {}
  }

  // chooser: false goes straight to "how do you want to start?"
  function open({ tour = true } = {}) {
    root.classList.remove('hidden');
    show(tour ? 0 : BEATS.length - 1);
  }

  $('onbSkip').addEventListener('click', () => show(BEATS.length - 1));
  $('onbStage').addEventListener('click', (e) => {
    if (e.target.closest('.onb-choose') || beat >= BEATS.length - 1) return;
    show(beat + 1);
  });
  addEventListener('keydown', (e) => {
    if (root.classList.contains('hidden')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && beat < BEATS.length - 1) show(beat + 1);
    else if (e.key === 'ArrowLeft' && beat > 0) show(beat - 1);
  });
  // Tapping the dim area around the card closes the chooser once the tour is over.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root && beat === BEATS.length - 1) close();
  });

  $('onbSketch').addEventListener('click', (e) => {
    e.preventDefault();
    close();
    onSketch();
  });
  $('onbSample').addEventListener('click', (e) => {
    e.preventDefault();
    close();
    onSample();
  });
  $('onbFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    close();
    onFile(file);
  });

  let seen = false;
  try { seen = localStorage.getItem(SEEN) === '1'; } catch {}
  return {
    open,
    close,
    // First launch only, after the normal first screen has had a moment on its own.
    maybeShow(delay = 900) {
      if (!seen) setTimeout(() => open({ tour: true }), delay);
    },
  };
}
