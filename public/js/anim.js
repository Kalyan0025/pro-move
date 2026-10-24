// Animation Assist for drawn frames, like Procreate's: every layer is a frame. A strip along the
// bottom shows them in order with Add, Duplicate, Delete, a Hold for each frame, onion skins (the
// frames before in blue, after in red), the frame rate, a loop mode and Play. The live character
// stays where it is in the stack; this animates what you draw.
const $ = (id) => document.getElementById(id);
// Onion skins are drawn as one-colour silhouettes: the frames before in blue, the frames after in red.
const BLUE = 'brightness(0) invert(0.45) sepia(1) saturate(9) hue-rotate(185deg)';
const RED = 'brightness(0) invert(0.45) sepia(1) saturate(9) hue-rotate(-35deg)';

export function createAnim({ studio, toast, leaveRigTimeline }) {
  const bar = $('animBar');
  let enabled = false;
  let playing = false;
  let raf = 0;
  let playFrames = [];
  let startAt = 0;
  let dir = 1;
  let idx = 0;
  let frameStart = 0;
  const A = () => studio.doc.anim;

  // The layers that count as frames, bottom to top. Background / foreground can be pinned out of the cycle.
  function frames() {
    const all = studio.layers.filter((l) => l.type === 'paint');
    const a = A();
    let list = all;
    if (a.bg && list.length > 1) list = list.slice(1);
    if (a.fg && list.length > 1) list = list.slice(0, -1);
    return list;
  }
  const pinned = () => {
    const all = studio.layers.filter((l) => l.type === 'paint');
    const a = A();
    const out = [];
    if (a.bg && all.length > 1) out.push(all[0]);
    if (a.fg && all.length > 2) out.push(all[all.length - 1]);
    return out;
  };

  // What the canvas shows while editing: this frame, plus onion skins.
  function showEditing() {
    const list = frames().filter((l) => l.visible);
    const a = A();
    const show = new Map();
    for (const p of pinned()) show.set(p.id, { alpha: 1 });
    const cur = studio.active?.type === 'paint' ? studio.active : list[0];
    const ci = list.indexOf(cur);
    if (cur) show.set(cur.id, { alpha: 1 });
    if (ci >= 0) {
      for (let i = 1; i <= a.onion; i++) {
        const fade = a.onionOpacity * (1 - (i - 1) / (a.onion + 1));
        const prev = list[ci - i], next = list[ci + i];
        if (prev && !show.has(prev.id)) show.set(prev.id, { alpha: fade, tint: BLUE });
        if (next && !show.has(next.id)) show.set(next.id, { alpha: fade * 0.8, tint: RED });
      }
    }
    studio.setAnimView({ show });
  }

  // ------------------------------------------------------------ playback
  function play() {
    const list = frames().filter((l) => l.visible);
    if (list.length < 2) return toast('Add a second frame to play an animation.');
    playFrames = list;
    playing = true;
    idx = Math.max(0, list.indexOf(studio.active));
    dir = 1;
    frameStart = performance.now();
    render();
    const step = (now) => {
      if (!playing) return;
      const l = playFrames[idx];
      const dur = ((1 + (l.hold || 0)) / A().fps) * 1000;
      if (now - frameStart >= dur) {
        frameStart = now;
        if (A().loop === 'pingpong') {
          if (idx + dir >= playFrames.length || idx + dir < 0) dir = -dir;
          idx = Math.max(0, Math.min(playFrames.length - 1, idx + dir));
        } else if (idx + 1 >= playFrames.length) {
          if (A().loop === 'once') return stop();
          idx = 0;
        } else idx++;
      }
      const show = new Map([[playFrames[idx].id, { alpha: 1 }]]);
      for (const p of pinned()) show.set(p.id, { alpha: 1 });
      studio.setAnimView({ show });
      highlight(playFrames[idx].id);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    if (enabled) {
      showEditing();
      render();
    }
  }
  const highlight = (id) => bar.querySelectorAll('.af-frame').forEach((el) => el.classList.toggle('playing', el.dataset.id === id));

  // ------------------------------------------------------------ the strip
  function render() {
    if (!enabled || !studio.doc) return;
    const list = frames();
    const a = A();
    const cur = studio.active;
    bar.innerHTML = `
      <button class="af-play ${playing ? 'on' : ''}" data-a="play" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'}</button>
      <div class="af-strip" id="afStrip">${list.map((l, i) => `
        <button class="af-frame ${cur?.id === l.id ? 'cur' : ''} ${l.visible ? '' : 'off'}" data-id="${l.id}" aria-label="Frame ${i + 1}">
          <span class="af-thumb"></span><i class="af-n">${i + 1}</i>${l.hold ? `<em class="af-hold">+${l.hold}</em>` : ''}${l.visible ? '' : '<em class="af-off">off</em>'}
        </button>`).join('')}
        ${pinned().map((l) => `<span class="af-pin" data-tip="${l.id === studio.layers.filter((x) => x.type === 'paint')[0].id ? 'Background: always shown' : 'Foreground: always shown'}">${l.id === studio.layers.filter((x) => x.type === 'paint')[0].id ? 'BG' : 'FG'}</span>`).join('')}
      </div>
      <div class="af-tools">
        <button data-a="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add</button>
        <button data-a="dup"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>Duplicate</button>
        <button data-a="del"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>Delete</button>
        <span class="af-hold-ctl" data-tip="Keep this frame on screen for extra frames">Hold <button data-a="holdminus">−</button><b>${cur?.hold || 0}</b><button data-a="holdplus">+</button></span>
        <button data-a="settings" class="${$('afSettings') && !$('afSettings').classList.contains('hidden') ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>${a.fps} fps</button>
        <button data-a="close" aria-label="Close animation" class="af-x">Done</button>
      </div>`;
    for (const el of bar.querySelectorAll('.af-frame')) {
      const l = studio.byId(el.dataset.id);
      el.querySelector('.af-thumb').append(studio.layerThumb(l, 96, 64));
    }
    const strip = $('afStrip');
    const curEl = strip.querySelector('.cur');
    if (curEl) strip.scrollLeft = curEl.offsetLeft - strip.clientWidth / 2 + 40;
  }
  bar.addEventListener('click', (e) => {
    const f = e.target.closest('.af-frame');
    const b = e.target.closest('[data-a]');
    if (f && !playing) {
      studio.setActive(f.dataset.id);
      return;
    }
    if (!b) return;
    const act = b.dataset.a;
    const cur = studio.active;
    if (act === 'play') playing ? stop() : play();
    else if (act === 'add') {
      stop();
      studio.addLayer(studio.unique('Frame'));
    } else if (act === 'dup') {
      stop();
      cur?.type === 'paint' && studio.duplicateLayer(cur.id);
    } else if (act === 'del') {
      stop();
      cur?.type === 'paint' && studio.deleteLayer(cur.id);
    } else if (act === 'holdplus' && cur?.type === 'paint') {
      studio.setLayerProp(cur.id, { hold: Math.min(8, (cur.hold || 0) + 1) });
    } else if (act === 'holdminus' && cur?.type === 'paint') {
      studio.setLayerProp(cur.id, { hold: Math.max(0, (cur.hold || 0) - 1) });
    } else if (act === 'settings') toggleSettings();
    else if (act === 'close') setEnabled(false);
  });

  // ------------------------------------------------------------ settings
  function toggleSettings() {
    const pop = $('afSettings');
    if (!pop.classList.contains('hidden')) return pop.classList.add('hidden');
    const a = A();
    pop.innerHTML = `
      <div class="seg" id="afLoop">${[['loop', 'Loop'], ['pingpong', 'Ping-pong'], ['once', 'One shot']].map(([id, l]) => `<button class="seg-btn ${a.loop === id ? 'active' : ''}" data-loop="${id}">${l}</button>`).join('')}</div>
      <label class="af-row">Frames per second<output>${a.fps}</output><input type="range" data-k="fps" min="1" max="60" value="${a.fps}"></label>
      <label class="af-row">Onion skin frames<output>${a.onion}</output><input type="range" data-k="onion" min="0" max="8" value="${a.onion}"></label>
      <label class="af-row">Onion skin opacity<output>${Math.round(a.onionOpacity * 100)}%</output><input type="range" data-k="onionOpacity" min="5" max="90" value="${Math.round(a.onionOpacity * 100)}"></label>
      <label class="af-row line">Background<small>keep the bottom layer on every frame</small><input type="checkbox" class="switch" data-k="bg" ${a.bg ? 'checked' : ''}></label>
      <label class="af-row line">Foreground<small>keep the top layer on every frame</small><input type="checkbox" class="switch" data-k="fg" ${a.fg ? 'checked' : ''}></label>`;
    pop.classList.remove('hidden');
  }
  $('afSettings').addEventListener('click', (e) => {
    const l = e.target.closest('[data-loop]');
    if (!l) return;
    A().loop = l.dataset.loop;
    studio.touch(false);
    toggleSettings();
    toggleSettings();
  });
  $('afSettings').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const a = A();
    if (e.target.type === 'checkbox') a[k] = e.target.checked;
    else a[k] = k === 'onionOpacity' ? Number(e.target.value) / 100 : Number(e.target.value);
    const out = e.target.previousElementSibling;
    if (out?.tagName === 'OUTPUT') out.textContent = k === 'onionOpacity' ? `${e.target.value}%` : e.target.value;
    studio.touch(false);
    if (!playing) showEditing();
    render();
  });

  function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      leaveRigTimeline?.();
      studio.doc.anim.enabled = true;
      bar.classList.remove('hidden');
      document.body.classList.add('frame-anim');
      showEditing();
      render();
    } else {
      stop();
      if (studio.doc) studio.doc.anim.enabled = false;
      bar.classList.add('hidden');
      $('afSettings').classList.add('hidden');
      document.body.classList.remove('frame-anim');
      studio.setAnimView(null);
    }
    $('prefFrames').checked = on;
  }
  $('prefFrames').addEventListener('input', () => setEnabled($('prefFrames').checked));
  studio.on('layers', () => {
    if (!enabled) return;
    if (!playing) showEditing();
    render();
  });
  studio.on('active', () => enabled && !playing && (showEditing(), render()));
  studio.on('pixels', () => enabled && !playing && requestAnimationFrame(render));
  // Opening a different artwork: follow its own animation setting.
  studio.on('doc', () => {
    const want = !!studio.doc.anim?.enabled;
    if (enabled && !want) setEnabled(false);
    else if (want && !enabled) setEnabled(true);
    else if (enabled) {
      showEditing();
      render();
    }
  });
  return { setEnabled, get enabled() { return enabled; }, stop };
}
