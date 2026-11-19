// Right-hand panel: MIDI port + channel, number of bodies, options, and the live list of
// points being sent, grouped by body.
(function () {
  const $ = (s) => document.querySelector(s);
  let rows = {};      // "b:id" → row elements
  let heads = {};     // b → body header elements
  let lastTick = 0;

  const UI = window.UI = {
    smoothing: 0.5,
    showVideo: false,
    mirror: true,
    bodies: 1,        // how many bodies to track (1–4)
    link: false,      // "same points on all bodies"
    chipBody: 0,      // which body the "All points" chips act on
    sendMode: 'cc',   // 'cc' (controllers, for Ableton knobs) | 'notes' (play a synth) | 'both'
    scale: 'Minor pentatonic',
    root: 0,          // 0 = C … 11 = B
    octave: 3,        // lowest note's octave (C3 = MIDI 48)
    range: 2,         // octaves from bottom to top of the frame
    xControl: 'mod',  // left–right in notes mode: 'mod' | 'bend' | 'none'
    fingers: true,    // run the hand model for real fingertips (costs some speed)

    init() {
      try { Object.assign(UI, JSON.parse(localStorage.getItem('bmt.ui') || '{}')); } catch {}
      UI.bodies = Math.max(1, Math.min(MAX_BODIES, UI.bodies | 0 || 1));
      UI.chipBody = Math.min(UI.chipBody | 0, UI.bodies - 1);
      $('#smooth').value = UI.smoothing;
      $('#video').checked = UI.showVideo;
      $('#mirror').checked = UI.mirror;
      $('#link').checked = UI.link;
      $('#fingers').checked = UI.fingers;
      $('#fingers').onchange = (e) => UI.set('fingers', e.target.checked);
      $('#smooth').oninput = (e) => UI.set('smoothing', +e.target.value);
      $('#video').onchange = (e) => UI.set('showVideo', e.target.checked);
      $('#mirror').onchange = (e) => UI.set('mirror', e.target.checked);
      $('#link').onchange = (e) => UI.set('link', e.target.checked);
      $('#clear').onclick = () => clearAll();
      $('#reassign').onclick = () => reassignByPosition();
      document.querySelectorAll('#bodies button').forEach((b) => (b.onclick = () => UI.setBodies(+b.dataset.n)));
      document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => UI.setMode(b.dataset.m)));

      // note settings
      const fill = (sel, items) => items.forEach(([v, t]) => $(sel).add(new Option(t, v)));
      fill('#scale', Object.keys(Notes.SCALES).map((k) => [k, k]));
      fill('#root', Notes.NAMES.map((n, i) => [i, n]));
      fill('#octave', [1, 2, 3, 4, 5, 6].map((o) => [o, 'Octave ' + o]));
      fill('#range', [1, 2, 3, 4].map((r) => [r, r + (r === 1 ? ' octave' : ' octaves')]));
      for (const [id, key, num] of [['#scale', 'scale'], ['#root', 'root', 1], ['#octave', 'octave', 1], ['#range', 'range', 1], ['#xctl', 'xControl']]) {
        $(id).value = UI[key];
        $(id).onchange = (e) => { Notes.panic(); UI.set(key, num ? +e.target.value : e.target.value); UI.rebuild(); };
      }
      $('#panic').onclick = () => Notes.panic();

      const ch = $('#channel');
      for (let i = 1; i <= 16; i++) ch.add(new Option('Channel ' + i, i));
      try { Midi.channel = +(localStorage.getItem('bmt.channel') || 1); } catch {}
      ch.value = Midi.channel;
      ch.onchange = () => {
        Midi.channel = +ch.value;
        try { localStorage.setItem('bmt.channel', ch.value); } catch {}
        for (const s of slots) s.lastSent = {};
        UI.rebuild();
      };
      $('#port').onchange = (e) => Midi.select(e.target.value);

      Midi.onchange = UI.ports;
      Midi.init();

      UI.buildChips();
      UI.rebuild();
    },

    set(key, value) {
      UI[key] = value;
      if (key === 'showVideo') $('#video').checked = value;
      if (key === 'mirror') $('#mirror').checked = value;
      if (key === 'link') $('#link').checked = value;
      try {
        const keep = ['smoothing', 'showVideo', 'mirror', 'bodies', 'link', 'chipBody', 'sendMode', 'scale', 'root', 'octave', 'range', 'xControl', 'fingers'];
        localStorage.setItem('bmt.ui', JSON.stringify(Object.fromEntries(keep.map((k) => [k, UI[k]]))));
      } catch {}
    },

    setMode(m) {
      Notes.panic();
      for (const s of slots) s.lastSent = {};
      UI.set('sendMode', m);
      UI.rebuild();
    },

    setBodies(n) {
      Notes.panic();
      UI.bodies = n;
      UI.chipBody = Math.min(UI.chipBody, n - 1);
      UI.set('bodies', n);
      UI.rebuild();
    },

    ports() {
      const sel = $('#port');
      const outs = Midi.outputs();
      sel.innerHTML = '';
      if (!outs.length) sel.add(new Option(Midi.supported ? 'No MIDI outputs found' : 'Web MIDI not available', ''));
      for (const o of outs) sel.add(new Option(o.name, o.id));
      if (Midi.out) sel.value = Midi.out.id;
      sel.disabled = !outs.length;
      $('#portHelp').hidden = outs.some((o) => /IAC/i.test(o.name));
    },

    // All points as chips, so a point can also be picked by name.
    buildChips() {
      const box = $('#chips');
      box.innerHTML = '';
      for (const g of BodyPoints.groups) {
        const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; box.append(h);
        for (const P of BodyPoints.POINTS.filter((p) => p.group === g)) {
          const b = document.createElement('button');
          b.className = 'chip'; b.dataset.id = P.id; b.textContent = P.name.replace(/^(Left|Right) /, (m) => m[0] + ' ');
          b.title = `${P.name} — X CC ${P.cc}, Y CC ${P.cc + 1}`;
          b.onclick = () => toggle(keyOf(UI.chipBody, P.id));
          box.append(b);
        }
      }
    },

    rebuild() {
      const n = UI.bodies;
      // body selector + channel summary
      document.querySelectorAll('#bodies button').forEach((b) => b.classList.toggle('on', +b.dataset.n === n));
      document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === UI.sendMode));
      $('#noteSet').hidden = UI.sendMode === 'cc';
      $('#modeHelp').textContent = {
        cc: 'Each point = 2 knobs (X, Y as CC). For mapping in Ableton.',
        notes: 'Each point plays notes: height = pitch in the scale, faster = louder. Left–right of each body\'s first point = the control below. For synths like the Playtronica DX7.',
        both: 'Notes and controllers together. Right wrist X (CC 64) is not sent, because synths read it as the sustain pedal.',
      }[UI.sendMode];
      document.body.dataset.mode = UI.sendMode;
      $('#multi').hidden = n === 1;
      $('#chLabel').textContent = n === 1 ? 'Channel' : 'Body 1 channel';
      $('#chMap').innerHTML = n === 1 ? '' : [...Array(n).keys()]
        .map((b) => `<span style="--c:${BODY_COLORS[b]}"><b>■</b> Body ${b + 1} → ch ${chOf(b)}</span>`).join('');

      // chip tabs (which body the chips act on)
      const tabs = $('#chipTabs');
      tabs.hidden = n === 1;
      tabs.innerHTML = [...Array(n).keys()].map((b) =>
        `<button data-b="${b}" class="${b === UI.chipBody ? 'on' : ''}" style="--c:${BODY_COLORS[b]}">Body ${b + 1}</button>`).join('');
      tabs.querySelectorAll('button').forEach((t) => (t.onclick = () => { UI.set('chipBody', +t.dataset.b); UI.rebuild(); }));

      // sending list, grouped by body
      const list = $('#list');
      list.innerHTML = '';
      rows = {}; heads = {};
      let count = 0;
      for (let b = 0; b < n; b++) {
        const ids = BodyPoints.POINTS.filter((p) => selected.has(keyOf(b, p.id)));
        if (n > 1) {
          const h = document.createElement('div');
          h.className = 'bodyhead';
          h.style.setProperty('--c', BODY_COLORS[b]);
          h.innerHTML = `<b>BODY ${b + 1}</b><span>ch ${chOf(b)}</span><span class="bstate"></span><span class="bcount">${ids.length} point${ids.length === 1 ? '' : 's'}</span>`;
          list.append(h);
          heads[b] = h;
        }
        for (const P of ids) {
          const k = keyOf(b, P.id);
          count++;
          const el = document.createElement('div');
          el.className = 'row';
          el.style.setProperty('--c', colorOf(k));
          el.innerHTML = `
            <div class="head"><span class="sym">◉</span><span class="state">SENDING</span><b>${P.name}</b><button class="x" title="Stop sending">×</button></div>
            <div class="axis"><span>X</span><i>CC ${P.cc}</i><div class="bar"><div class="fill fx"></div></div><em class="vx">—</em><button class="map" data-axis="x" title="Send only this CC for 1.5 s, for Ableton MIDI Map">map</button></div>
            <div class="axis"><span>Y</span><i>CC ${P.cc + 1}</i><div class="bar"><div class="fill fy"></div></div><em class="vy">—</em><button class="map" data-axis="y" title="Send only this CC for 1.5 s, for Ableton MIDI Map">map</button></div>
            <div class="noteline"><span>♪</span><b class="nn">—</b><i class="nv"></i></div>`;
          el.querySelector('.x').onclick = () => toggle(k);
          el.querySelectorAll('.map').forEach((m) => (m.onclick = () => Midi.map(b, P.id, m.dataset.axis)));
          list.append(el);
          rows[k] = { b, id: P.id, el, vx: el.querySelector('.vx'), vy: el.querySelector('.vy'), fx: el.querySelector('.fx'), fy: el.querySelector('.fy'), state: el.querySelector('.state'), nn: el.querySelector('.nn'), nv: el.querySelector('.nv') };
        }
      }
      $('#empty').hidden = count > 0;
      $('#count').textContent = count;

      document.querySelectorAll('.chip').forEach((c) => {
        const k = keyOf(UI.chipBody, c.dataset.id);
        c.classList.toggle('on', selected.has(k));
        c.style.setProperty('--c', colorOf(k));
      });
    },

    // ~15 times a second: live numbers, body states, MIDI activity, monitor.
    tick() {
      const now = performance.now();
      if (now - lastTick < 66) return;
      lastTick = now;
      const solo = Midi.solo && now < Midi.solo.until ? Midi.solo : null;
      for (const k in rows) {
        const r = rows[k];
        const live = slots[r.b].live[r.id];
        const held = !!live && live.held;
        const mine = solo && solo.b === r.b && solo.id === r.id;
        r.el.classList.toggle('lost', !live);
        r.el.classList.toggle('held', held);
        r.el.classList.toggle('paused', !!live && !held && (!Midi.out || (solo && !mine)));
        const st = slots[r.b].notes[r.id];
        const playing = UI.sendMode !== 'cc' && st && st.note != null;
        r.state.textContent = !live ? 'WAITING' : mine ? 'MAPPING ' + solo.axis.toUpperCase()
          : held ? (UI.sendMode === 'notes' ? 'SILENT' : 'HOLD') : !Midi.out ? 'NO PORT' : solo ? 'PAUSED' : playing ? 'PLAYING' : 'SENDING';
        r.nn.textContent = playing ? Notes.name(st.note) : '—';
        r.nv.textContent = playing ? `note ${st.note} · vel ${st.vel}` : held ? 'note off (point not seen)' : '';
        r.vx.textContent = live ? `${live.vx}` : '—';
        r.vy.textContent = live ? `${live.vy}` : '—';
        r.fx.style.width = live ? (live.vx / 127) * 100 + '%' : '0';
        r.fy.style.width = live ? (live.vy / 127) * 100 + '%' : '0';
        r.el.querySelectorAll('.map').forEach((m) => m.classList.toggle('active', !!mine && solo.axis === m.dataset.axis));
      }
      for (const b in heads) {
        const on = isTracked(+b);
        heads[b].classList.toggle('off', !on);
        heads[b].querySelector('.bstate').textContent = on ? '● tracked' : '○ not in view · HOLD';
      }
      const led = $('#led');
      led.classList.toggle('on', now - Midi.lastActivity < 120);
      const chs = UI.bodies === 1 ? `ch ${Midi.channel}` : `ch ${chOf(0)}–${chOf(UI.bodies - 1)}`;
      $('#midiState').textContent = Midi.error
        ? Midi.error
        : Midi.out ? `→ ${Midi.out.name} · ${chs} · ${Midi.rate} msg/s` : (Midi.access ? 'Pick a MIDI output' : 'Waiting for MIDI permission…');
      $('#monitor').textContent = Midi.log.join('\n') || '(no messages yet)';
    },
  };
})();
