// Web MIDI output (Chrome / Edge). Sends Control Change messages to whatever port you pick —
// on macOS that is normally "IAC Driver Bus 1", which Ableton Live listens to.
(function () {
  const M = window.Midi = {
    supported: !!navigator.requestMIDIAccess,
    access: null,
    out: null,
    channel: 1,
    error: '',
    sent: 0,          // messages since the last rate sample
    rate: 0,          // messages per second
    lastActivity: 0,  // performance.now() of the last message
    log: [],          // recent messages, newest first
    solo: null,       // { id, axis, cc, until } while a "map" button is held open
    onchange: null,   // UI hook, called when the list of ports changes

    async init() {
      if (!M.supported) { M.error = 'This browser has no Web MIDI. Open the app in Chrome or Edge.'; M.onchange?.(); return; }
      try {
        M.access = await navigator.requestMIDIAccess({ sysex: false });
        M.access.onstatechange = () => { M.restore(); M.onchange?.(); };
        M.restore();
      } catch (e) {
        M.error = 'MIDI permission was blocked: ' + e.message;
      }
      M.onchange?.();
      setInterval(() => { M.rate = M.sent; M.sent = 0; }, 1000);
    },

    outputs() { return M.access ? [...M.access.outputs.values()] : []; },

    // Reconnect to the last-used port (or the IAC bus if there is one).
    restore() {
      const outs = M.outputs();
      let saved = null;
      try { saved = localStorage.getItem('bmt.midiOut'); } catch {}
      const pick = outs.find((o) => o.id === saved) || outs.find((o) => /IAC/i.test(o.name)) || outs[0] || null;
      if (!M.out || !outs.includes(M.out)) M.out = pick;
    },

    select(id) {
      M.out = M.outputs().find((o) => o.id === id) || null;
      try { localStorage.setItem('bmt.midiOut', id); } catch {}
    },

    // ch = 1..16 (each body has its own; defaults to the panel's channel)
    cc(num, value, ch = M.channel) {
      if (!M.out) return;
      const v = Math.max(0, Math.min(127, value | 0));
      try { M.out.send([0xb0 | ((ch - 1) & 15), num & 127, v]); } catch (e) { M.error = e.message; return; }
      M.sent++;
      M.lastActivity = performance.now();
      M.log.unshift(`ch${String(ch).padEnd(2)}  CC ${String(num).padStart(3)}  ${String(v).padStart(3)}`);
      if (M.log.length > 8) M.log.length = 8;
    },

    // Raw message + monitor line.
    raw(bytes, text) {
      if (!M.out) return;
      try { M.out.send(bytes); } catch (e) { M.error = e.message; return; }
      M.sent++;
      M.lastActivity = performance.now();
      M.log.unshift(text);
      if (M.log.length > 8) M.log.length = 8;
    },
    noteOn(note, vel, ch = M.channel) {
      M.raw([0x90 | ((ch - 1) & 15), note & 127, Math.max(1, Math.min(127, vel | 0))],
        `ch${String(ch).padEnd(2)}  ON  ${Notes.name(note).padEnd(4)} v${vel}`);
    },
    noteOff(note, ch = M.channel) {
      M.raw([0x80 | ((ch - 1) & 15), note & 127, 0], `ch${String(ch).padEnd(2)}  OFF ${Notes.name(note)}`);
    },
    // value -1 … +1 (0 = centre)
    bend(value, ch = M.channel) {
      const v = Math.max(0, Math.min(16383, Math.round((value + 1) * 8191.5)));
      M.raw([0xe0 | ((ch - 1) & 15), v & 127, v >> 7], `ch${String(ch).padEnd(2)}  BEND ${v - 8192}`);
    },
    allNotesOff(ch = M.channel) {
      if (!M.out) return;
      try { M.out.send([0xb0 | ((ch - 1) & 15), 123, 0]); } catch {}
    },

    // Send only this one CC (of body b) for a moment so Ableton's MIDI Map mode can learn it.
    map(b, id, axis) {
      const p = window.BodyPoints.byId[id];
      M.solo = { b, id, axis, cc: axis === 'x' ? p.cc : p.cc + 1, until: performance.now() + 1500 };
    },
  };
})();
