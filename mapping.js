// Per-point value mapping: raw position → your range, before anything is sent.
//
//   raw (0–1)  ──input range──▶ 0–1 ──invert──▶ ──curve──▶ t (0–1) ──output range──▶ out
//                                                                    └──────────────▶ MIDI 0–127
//
// Raw X: 0 = left … 1 = right. Raw Y: 0 = bottom … 1 = top. In "body" coordinates they are
// measured from the performer's chest instead of the camera frame (0.5 = at the chest,
// 1 unit = 4 torso lengths), so walking around or towards the camera doesn't change them.
//
// MIDI always carries 0–127: if the output range is inside 0–127 the MIDI value IS the output
// (so you can narrow it, e.g. 30–90); for any other output range (e.g. 20–20000 Hz) MIDI sends
// the same position scaled to 0–127.
(function () {
  const axisDefault = () => ({ in0: 0, in1: 1, out0: 0, out1: 127, inv: false, curve: 'lin' });
  const DEF = () => ({ coords: 'frame', x: axisDefault(), y: axisDefault() });

  const CURVES = {
    lin: { name: 'Linear', f: (t) => t },
    exp: { name: 'Slow → fast', f: (t) => t * t },
    log: { name: 'Fast → slow', f: (t) => Math.sqrt(t) },
    s: { name: 'S-curve', f: (t) => t * t * (3 - 2 * t) },
  };

  let maps = {};
  try { maps = JSON.parse(localStorage.getItem('bmt.maps') || '{}'); } catch {}
  const save = () => { try { localStorage.setItem('bmt.maps', JSON.stringify(maps)); } catch {} };
  const clone = (m) => JSON.parse(JSON.stringify(m));

  function get(k) { return maps[k] || DEF(); }
  function isCustom(k) { return !!maps[k]; }
  function set(k, m) { maps[k] = m; save(); }
  function reset(k) { delete maps[k]; delete learning[k]; save(); M.onchange?.(); }
  function copyToAll(k) {
    const id = k.slice(k.indexOf(':') + 1), m = clone(get(k));
    for (let b = 0; b < 4; b++) maps[b + ':' + id] = clone(m);
    save(); M.onchange?.();
  }

  function axis(a, v) {
    const span = a.in1 - a.in0;
    let t = span === 0 ? 0 : (v - a.in0) / span;
    t = Math.max(0, Math.min(1, t));
    if (a.inv) t = 1 - t;
    t = (CURVES[a.curve] || CURVES.lin).f(t);
    const out = a.out0 + t * (a.out1 - a.out0);
    const inMidi = Math.min(a.out0, a.out1) >= 0 && Math.max(a.out0, a.out1) <= 127;
    const midi = Math.max(0, Math.min(127, Math.round(inMidi ? out : t * 127)));
    return { t, out, midi };
  }
  const isDefaultOut = (a) => a.out0 === 0 && a.out1 === 127;

  // Learn: watch the point for 5 seconds and use the range it moved through as the input range.
  const learning = {};
  const LEARN_MS = 5000;
  function startLearn(k) {
    learning[k] = { until: performance.now() + LEARN_MS, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  }
  function feed(k, rx, ry) {
    const L = learning[k];
    if (!L) return;
    L.x0 = Math.min(L.x0, rx); L.x1 = Math.max(L.x1, rx);
    L.y0 = Math.min(L.y0, ry); L.y1 = Math.max(L.y1, ry);
    if (performance.now() < L.until) return;
    delete learning[k];
    const m = clone(get(k));
    const fit = (a, lo, hi) => {
      if (!(hi - lo > 0.02)) return; // barely moved: keep the old range
      const pad = (hi - lo) * 0.03;
      a.in0 = +(lo - pad).toFixed(3); a.in1 = +(hi + pad).toFixed(3);
    };
    fit(m.x, L.x0, L.x1); fit(m.y, L.y0, L.y1);
    set(k, m);
    M.onchange?.();
  }
  const learnLeft = (k) => (learning[k] ? Math.max(0, (learning[k].until - performance.now()) / 1000) : 0);
  const learnBox = (k) => learning[k];

  const M = window.Mapping = { CURVES, get, set, reset, isCustom, copyToAll, axis, isDefaultOut, startLearn, feed, learnLeft, learnBox, onchange: null };
})();
