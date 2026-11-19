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
    openMaps: new Set(), // rows whose range editor is open ("b:id")
    oscOn: false,     // OSC OUT via the bridge
    oscUrl: 'ws://localhost:8766',
    oscHost: '127.0.0.1',
    oscPort: 9000,
    oscRaw: true,     // send /raw (0–1)
    oscOut: false,    // send /out (mapped)
    oscAll: false,    // all points, not only selected

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
      document.querySelectorAll('.fsBtn').forEach((b) => (b.onclick = () => UI.toggleFullscreen()));
      document.querySelectorAll('.panelBtn').forEach((b) => (b.onclick = () => UI.togglePanel()));
      document.addEventListener('fullscreenchange', UI.viewChanged);
      document.addEventListener('webkitfullscreenchange', UI.viewChanged);
      UI.viewChanged();
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

      Mapping.onchange = () => UI.rebuild();

      // OSC OUT
      for (const [id, key] of [['#oscOn', 'oscOn'], ['#oscRaw', 'oscRaw'], ['#oscOut', 'oscOut'], ['#oscAll', 'oscAll']]) {
        $(id).checked = UI[key];
        $(id).onchange = (e) => { UI.set(key, e.target.checked); UI.oscView(); OSC.update(); };
      }
      $('#oscHost').value = UI.oscHost; $('#oscPort').value = UI.oscPort; $('#oscUrl').value = UI.oscUrl;
      $('#oscHost').onchange = (e) => { UI.set('oscHost', e.target.value.trim() || '127.0.0.1'); OSC.configure(); };
      $('#oscPort').onchange = (e) => { UI.set('oscPort', Math.max(1, Math.min(65535, +e.target.value || 9000))); OSC.configure(); };
      $('#oscUrl').onchange = (e) => { UI.set('oscUrl', e.target.value.trim() || 'ws://localhost:8766'); OSC.reconnect(); };
      UI.oscView();
      OSC.update();
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
        const keep = ['smoothing', 'showVideo', 'mirror', 'bodies', 'link', 'chipBody', 'sendMode', 'scale', 'root', 'octave', 'range', 'xControl', 'fingers', 'panelHidden',
          'oscOn', 'oscUrl', 'oscHost', 'oscPort', 'oscRaw', 'oscOut', 'oscAll'];
        localStorage.setItem('bmt.ui', JSON.stringify(Object.fromEntries(keep.map((k) => [k, UI[k]]))));
      } catch {}
    },

    oscView() { $('#oscSet').hidden = !UI.oscOn; },

    // Full screen hides Chrome's title bar and everything else; Esc (or F) leaves.
    toggleFullscreen() {
      const d = document, el = d.documentElement;
      const isFs = d.fullscreenElement || d.webkitFullscreenElement;
      if (isFs) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else {
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (p && p.catch) p.catch((e) => console.warn('fullscreen', e));
      }
    },
    // Hide the right-hand panel so the stage fills the window (MIDI keeps running).
    togglePanel() {
      UI.set('panelHidden', !UI.panelHidden);
      UI.viewChanged();
    },
    viewChanged() {
      const d = document;
      const isFs = !!(d.fullscreenElement || d.webkitFullscreenElement);
      document.body.classList.toggle('nopanel', !!UI.panelHidden);
      document.querySelectorAll('.fsBtn').forEach((b) => (b.textContent = isFs ? '⛶ Exit full screen' : '⛶ Full screen'));
      if (typeof resizeCanvas === 'function' && window._setupDone) resizeCanvas(stageW(), windowHeight);
    },

    // The range editor for one point (opened with "⚙ range").
    mapEditor(k) {
      const m = Mapping.get(k);
      const curves = Object.entries(Mapping.CURVES).map(([v, c]) => `<option value="${v}">${c.name}</option>`).join('');
      const row = (ax) => `
        <span class="ax">${ax.toUpperCase()}</span>
        <input type="number" step="0.01" data-ax="${ax}" data-f="in0" value="${m[ax].in0}">
        <input type="number" step="0.01" data-ax="${ax}" data-f="in1" value="${m[ax].in1}">
        <input type="number" step="any" data-ax="${ax}" data-f="out0" value="${m[ax].out0}">
        <input type="number" step="any" data-ax="${ax}" data-f="out1" value="${m[ax].out1}">
        <label class="inv" title="Invert"><input type="checkbox" data-ax="${ax}" data-f="inv" ${m[ax].inv ? 'checked' : ''}>inv</label>
        <select data-ax="${ax}" data-f="curve">${curves.replace(`value="${m[ax].curve}"`, `value="${m[ax].curve}" selected`)}</select>`;
      return `<div class="mapedit">
        <div class="coords">Measure from
          <label><input type="radio" name="c-${k}" value="frame" ${m.coords !== 'body' ? 'checked' : ''}> camera frame</label>
          <label><input type="radio" name="c-${k}" value="body" ${m.coords === 'body' ? 'checked' : ''}> body (chest)</label></div>
        <div class="mgrid"><span></span><i>in min</i><i>in max</i><i>out min</i><i>out max</i><i></i><i>curve</i>${row('x')}${row('y')}</div>
        <div class="mbtns"><button class="learn">● Learn range (5 s)</button><button class="mreset">Reset</button>${UI.bodies > 1 ? '<button class="mcopy">Copy to all bodies</button>' : ''}</div>
        <div class="mhelp">In = the raw range that counts (0–1). Out = what it becomes. MIDI sends 0–127: the output itself if it fits in 0–127, otherwise the same position scaled.</div>
      </div>`;
    },
    bindEditor(el, k) {
      const box = el.querySelector('.mapedit');
      box.querySelectorAll('[data-f]').forEach((inp) => (inp.onchange = () => {
        const m = JSON.parse(JSON.stringify(Mapping.get(k)));
        const a = m[inp.dataset.ax], f = inp.dataset.f;
        a[f] = f === 'inv' ? inp.checked : f === 'curve' ? inp.value : (isFinite(+inp.value) ? +inp.value : a[f]);
        Mapping.set(k, m);
        el.querySelector('.rng').classList.add('custom');
      }));
      box.querySelectorAll('input[type=radio]').forEach((r) => (r.onchange = () => {
        const m = JSON.parse(JSON.stringify(Mapping.get(k)));
        m.coords = r.value;
        // switching coordinates: start from the full range again
        m.x.in0 = m.y.in0 = 0; m.x.in1 = m.y.in1 = 1;
        Mapping.set(k, m);
        UI.rebuild();
      }));
      box.querySelector('.learn').onclick = () => Mapping.startLearn(k);
      box.querySelector('.mreset').onclick = () => Mapping.reset(k);
      const cp = box.querySelector('.mcopy');
      if (cp) cp.onclick = () => Mapping.copyToAll(k);
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
            <div class="head"><span class="sym">◉</span><span class="state">SENDING</span><b>${P.name}</b><button class="rng${Mapping.isCustom(k) ? ' custom' : ''}${UI.openMaps.has(k) ? ' open' : ''}" title="Range: map this point's X / Y to your own values">⚙ range</button><button class="x" title="Stop sending">×</button></div>
            <div class="axis"><span>X</span><i>CC ${P.cc}</i><div class="bar"><div class="fill fx"></div></div><em class="vx">—</em><button class="map" data-axis="x" title="Send only this CC for 1.5 s, for Ableton MIDI Map">map</button></div>
            <div class="axis"><span>Y</span><i>CC ${P.cc + 1}</i><div class="bar"><div class="fill fy"></div></div><em class="vy">—</em><button class="map" data-axis="y" title="Send only this CC for 1.5 s, for Ableton MIDI Map">map</button></div>
            <div class="noteline"><span>♪</span><b class="nn">—</b><i class="nv"></i></div>
            <div class="rawline"></div>
            ${UI.openMaps.has(k) ? UI.mapEditor(k) : ''}`;
          el.querySelector('.x').onclick = () => toggle(k);
          el.querySelector('.rng').onclick = () => { UI.openMaps.has(k) ? UI.openMaps.delete(k) : UI.openMaps.add(k); UI.rebuild(); };
          if (UI.openMaps.has(k)) UI.bindEditor(el, k);
          el.querySelectorAll('.map').forEach((m) => (m.onclick = () => Midi.map(b, P.id, m.dataset.axis)));
          list.append(el);
          rows[k] = { b, id: P.id, el, vx: el.querySelector('.vx'), vy: el.querySelector('.vy'), fx: el.querySelector('.fx'), fy: el.querySelector('.fy'), state: el.querySelector('.state'), nn: el.querySelector('.nn'), nv: el.querySelector('.nv'), raw: el.querySelector('.rawline'), learn: el.querySelector('.learn') };
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
        r.fx.style.width = live ? live.tx * 100 + '%' : '0';
        r.fy.style.width = live ? live.ty * 100 + '%' : '0';
        // raw position → mapped output (only shown when the output range is your own)
        if (live) {
          const m = Mapping.get(r.b + ':' + r.id);
          const f3 = (v) => v.toFixed(3);
          const fo = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
          let t = `raw ${f3(live.rx)}, ${f3(live.ry)}${m.coords === 'body' ? ' (body)' : ''}`;
          if (!Mapping.isDefaultOut(m.x) || !Mapping.isDefaultOut(m.y)) t += ` → out ${fo(live.ox)}, ${fo(live.oy)}`;
          r.raw.textContent = t;
        } else r.raw.textContent = '';
        if (r.learn) {
          const left = Mapping.learnLeft(r.b + ':' + r.id);
          r.learn.textContent = left > 0 ? `● Learning… ${left.toFixed(1)} s` : '● Learn range (5 s)';
          r.learn.classList.toggle('active', left > 0);
        }
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

      // OSC status
      const oled = $('#oscLed'), st = $('#oscState');
      oled.className = !UI.oscOn ? '' : OSC.connected ? 'on' : 'wait';
      st.textContent = !UI.oscOn ? 'off'
        : OSC.connected ? `● bridge connected → ${OSC.dest || UI.oscHost + ':' + UI.oscPort} · ${OSC.bridgeRate} msg/s`
        : '○ waiting for the bridge…';
      $('#oscHelp').hidden = !UI.oscOn || OSC.connected;
      $('#oscSample').textContent = UI.oscOn && OSC.connected && OSC.sample ? 'last: ' + OSC.sample : '';
      if (OSC.error) st.textContent += ' · ' + OSC.error;
    },
  };
})();
