// Notes mode: each selected point PLAYS notes. Its height picks a note from a scale (low = low
// note, high = high note); a new note starts when the point moves into the next step of the
// scale. Faster movement = louder (velocity). Works with any MIDI synth, e.g. the DX7 at
// synth.playtronica.com, or an instrument track in Ableton.
(function () {
  const SCALES = {
    'Minor pentatonic': [0, 3, 5, 7, 10],
    'Major pentatonic': [0, 2, 4, 7, 9],
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Whole tone': [0, 2, 4, 6, 8, 10],
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = (n) => NAMES[n % 12] + (Math.floor(n / 12) - 1); // 60 = C4

  // The notes a point can play, bottom to top of the frame.
  let cache = null, cacheKey = '';
  function steps() {
    const key = [UI.scale, UI.root, UI.octave, UI.range].join();
    if (key !== cacheKey) {
      const sc = SCALES[UI.scale] || SCALES['Minor pentatonic'];
      const base = 12 * (UI.octave + 1) + UI.root;
      const out = [];
      for (let o = 0; o < UI.range; o++) for (const d of sc) out.push(base + 12 * o + d);
      out.push(base + 12 * UI.range);
      cache = out.filter((n) => n >= 0 && n <= 127);
      cacheKey = key;
    }
    return cache;
  }

  // st = this point's note state (kept per body + point); up = height 0 (bottom) … 1 (top).
  function update(st, up, ch) {
    const L = steps();
    const pos = up * L.length;
    const speed = st.prevUp == null ? 0 : Math.abs(up - st.prevUp);
    st.prevUp = up;
    st.speed = st.speed == null ? speed : st.speed * 0.6 + speed * 0.4;
    // Hysteresis: only change note once the point is clearly inside the next step,
    // so standing on a border doesn't flutter between two notes.
    let idx = st.idx;
    if (idx == null || idx >= L.length || pos < idx - 0.25 || pos > idx + 1.25) {
      idx = Math.max(0, Math.min(L.length - 1, Math.floor(pos)));
    }
    if (st.note != null && idx === st.idx && st.ch === ch) return;
    const note = L[idx];
    if (st.note != null) Midi.noteOff(st.note, st.ch);
    const vel = Math.round(Math.max(55, Math.min(127, 55 + st.speed * 1800)));
    Midi.noteOn(note, vel, ch);
    Object.assign(st, { note, idx, ch, vel });
  }

  function release(st) {
    if (st && st.note != null) { Midi.noteOff(st.note, st.ch); st.note = null; st.idx = null; }
  }

  // Stop every note (and reset mod wheel / pitch bend) — on mode, scale or body changes.
  function panic() {
    for (const s of slots) {
      for (const id in s.notes) release(s.notes[id]);
      s.notes = {};
      delete s.lastSent.mod; delete s.lastSent.bend;
    }
    for (let b = 0; b < MAX_BODIES; b++) Midi.allNotesOff(chOf(b));
  }

  window.Notes = { SCALES, NAMES, name, steps, update, release, panic };
  window.addEventListener('pagehide', () => { try { panic(); } catch {} });
})();
