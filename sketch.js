// Body Multi-Tracker — p5.js sketch.
// Black stage, live skeletons, every tracked point drawn. Click a point to start sending its
// X/Y as MIDI CC; click it again to stop. Up to 4 bodies, each in its own slot and MIDI channel.
const PANEL_W = 380;
const VIS = 0.5;          // MediaPipe visibility needed to count a point as tracked
const MAX_BODIES = 4;
const PALETTE = ['#00e5ff', '#ff3d7f', '#ffd600', '#76ff03', '#d58cff', '#ff9100', '#4d8dff', '#1de9b6'];
const BODY_COLORS = ['#00e5ff', '#ff3d7f', '#ffd600', '#76ff03'];
const MATCH_DIST = 0.35;  // how far (in frame heights) a body may move between frames and keep its slot
const RECENT_MS = 1500;   // a slot seen this recently is still "owned" by its person

let video;
let fit = { x: 0, y: 0, w: 1, h: 1 };
let aspect = 16 / 9;
let lastVideoTime = -1;
let hover = null;         // "b:id" under the mouse
let soloWas = false;

// One slot per body. A slot follows the same person from frame to frame.
const newSlot = () => ({ raw: null, pts: {}, lastSeen: -1e9, center: null, live: {}, trails: {}, lastSent: {}, notes: {} });
let slots = Array.from({ length: MAX_BODIES }, newSlot);

// Selection keys are "body:pointId", e.g. "1:hand_r" = body 2's right hand.
let selected = loadSel();
const keyOf = (b, id) => b + ':' + id;
const parseKey = (k) => { const i = k.indexOf(':'); return [+k.slice(0, i), k.slice(i + 1)]; };
const nBodies = () => UI.bodies || 1;
const chOf = (b) => ((Midi.channel - 1 + b) % 16) + 1;   // body 1 = the panel's channel, body 2 the next…
const isTracked = (b) => millis() - slots[b].lastSeen < 400;

function loadSel() {
  try {
    const arr = JSON.parse(localStorage.getItem('bmt.selected') || '[]');
    return new Set(arr.map((k) => (k.includes(':') ? k : '0:' + k)) // older single-body format
      .filter((k) => { const [b, id] = parseKey(k); return b >= 0 && b < MAX_BODIES && BodyPoints.byId[id]; }));
  } catch { return new Set(); }
}
function saveSel() { try { localStorage.setItem('bmt.selected', JSON.stringify([...selected])); } catch {} }

function setSel(b, id, on) {
  const k = keyOf(b, id), s = slots[b], P = BodyPoints.byId[id];
  if (on) selected.add(k);
  else { selected.delete(k); delete s.trails[id]; delete s.live[id]; Notes.release(s.notes[id]); delete s.notes[id]; }
  delete s.lastSent[P.cc]; delete s.lastSent[P.cc + 1];
}
// Click toggles one body's point — or that point on every body when "same points" is on.
function toggle(k) {
  const [b, id] = parseKey(k);
  const on = !selected.has(k);
  if (UI.link) for (let i = 0; i < nBodies(); i++) setSel(i, id, on);
  else setSel(b, id, on);
  saveSel();
  UI.rebuild();
}
function clearAll() {
  Notes.panic();
  selected.clear();
  for (const s of slots) { s.trails = {}; s.live = {}; s.lastSent = {}; }
  saveSel(); UI.rebuild();
}

// Colour of a selected point: per-selection palette with one body, the body's colour with more.
function colorOf(k) {
  const [b, id] = parseKey(k);
  if (nBodies() > 1) return BODY_COLORS[b];
  const i = [...selected].filter((x) => x.startsWith('0:')).indexOf(k);
  return PALETTE[(i < 0 ? BodyPoints.byId[id].index : i) % PALETTE.length];
}

function stageW() { return UI.panelHidden ? windowWidth : Math.max(240, windowWidth - PANEL_W); }

function setup() {
  const c = createCanvas(stageW(), windowHeight);
  c.parent('stage');
  textFont('monospace');
  video = createCapture({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
  video.elt.setAttribute('playsinline', '');
  video.elt.muted = true;
  video.hide();
  UI.init();
  window._setupDone = true;
  UI.viewChanged();
}

function windowResized() { resizeCanvas(stageW(), windowHeight); }

// ---------- tracking ----------
function track() {
  const v = video && video.elt;
  if (!window.Pose.ready || !v || v.readyState < 2 || !v.videoWidth) return;
  if (v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;
  aspect = v.videoWidth / v.videoHeight;
  if (Pose.numPoses !== nBodies()) Pose.setNum(nBodies());
  let res;
  const t = performance.now();
  try { res = Pose.detect(v, t); } catch (e) { console.warn(e); return; }
  const dets = ((res && res.landmarks) || []).map((l) => BodyPoints.compute(l, aspect));
  if (UI.fingers && Pose.handsReady && dets.length) {
    const want = Math.min(8, 2 * nBodies());
    if (Pose.numHands !== want) Pose.setHands(want);
    try { matchHands(dets, (Pose.detectHands(v, t) || {}).landmarks || []); } catch (e) { console.warn(e); }
  }
  assign(dets);
}

// Give each hand the model found to the body whose pose wrist is closest to the hand's wrist.
// (The hand model's own "left/right" label is unreliable with a mirrored camera, so position decides.)
function matchHands(dets, hands) {
  const pairs = [];
  hands.forEach((h, hi) => {
    const hx = h[0].x * aspect, hy = h[0].y;
    dets.forEach((d, di) => {
      for (const s of ['_l', '_r']) {
        const w = d['wrist' + s];
        pairs.push([Math.hypot(w.x * aspect - hx, w.y - hy), hi, di, s]);
      }
    });
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const usedH = new Set(), usedSide = new Set();
  for (const [dd, hi, di, s] of pairs) {
    if (dd > 0.15 || usedH.has(hi) || usedSide.has(di + s)) continue;
    usedH.add(hi); usedSide.add(di + s);
    BodyPoints.applyHand(dets[di], s, hands[hi]);
  }
}

// Torso centre in square units (x scaled by aspect), used to recognise the same person.
function centerOf(p) {
  const c = ['shoulder_l', 'shoulder_r', 'hip_l', 'hip_r'].map((id) => p[id]);
  return { x: (c.reduce((s, q) => s + q.x, 0) / 4) * aspect, y: c.reduce((s, q) => s + q.y, 0) / 4 };
}

// MediaPipe returns bodies in no fixed order, so match each one to the slot whose person was
// closest last frame. New people take a free slot.
function assign(dets) {
  const n = nBodies(), now = millis();
  for (const s of slots) s.raw = null;
  const centers = dets.map(centerOf);
  const usedD = new Set(), usedS = new Set();

  const pairs = [];
  dets.forEach((_, d) => {
    for (let b = 0; b < n; b++) {
      const s = slots[b];
      if (s.center && now - s.lastSeen < RECENT_MS) {
        pairs.push([Math.hypot(centers[d].x - s.center.x, centers[d].y - s.center.y), d, b]);
      }
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [dd, d, b] of pairs) {
    if (dd > MATCH_DIST || usedD.has(d) || usedS.has(b)) continue;
    usedD.add(d); usedS.add(b); take(b, dets[d], centers[d], now);
  }

  // Leftover people (new, or moved a lot): give them a free slot, preferring one that has been
  // empty for a while and whose last position was nearest.
  const rest = dets.map((_, d) => d).filter((d) => !usedD.has(d));
  for (const d of rest) {
    let best = -1, bestScore = Infinity;
    for (let b = 0; b < n; b++) {
      if (usedS.has(b)) continue;
      const s = slots[b];
      const busy = now - s.lastSeen < RECENT_MS ? 100 : 0;
      const far = s.center ? Math.hypot(centers[d].x - s.center.x, centers[d].y - s.center.y) : 10 + b;
      if (busy + far < bestScore) { bestScore = busy + far; best = b; }
    }
    if (best < 0) break; // more people than slots
    usedS.add(best); take(best, dets[d], centers[d], now);
  }
}
function take(b, det, center, now) {
  const s = slots[b];
  s.raw = det; s.center = center; s.lastSeen = now;
}

// Renumber the bodies from left to right as they appear on screen.
function reassignByPosition() {
  Notes.panic(); // channels move with the slots, so stop sounding notes first
  const n = nBodies();
  const idx = [...Array(n).keys()];
  const sx = (b) => { const c = slots[b].center; const x = c ? c.x / aspect : 0.5; return UI.mirror ? 1 - x : x; };
  const seen = idx.filter((b) => millis() - slots[b].lastSeen < RECENT_MS).sort((a, b) => sx(a) - sx(b));
  const order = [...seen, ...idx.filter((b) => !seen.includes(b))];
  const moved = order.map((b) => slots[b]);
  for (let b = 0; b < n; b++) {
    slots[b] = moved[b];
    slots[b].live = {}; slots[b].trails = {}; slots[b].lastSent = {};
  }
  UI.rebuild();
}

function smoothPoints() {
  const k = UI.smoothing, now = millis();
  for (const s of slots) {
    if (!s.raw) {
      if (now - s.lastSeen > 400) for (const id in s.pts) s.pts[id].v = 0;
      continue;
    }
    for (const id in s.raw) {
      const r = s.raw[id], p = s.pts[id];
      if (!p || p.v < VIS) s.pts[id] = { ...r };
      else { p.x = r.x + (p.x - r.x) * k; p.y = r.y + (p.y - r.y) * k; p.v = r.v; }
    }
  }
}

// Normalised output position, 0..1, mirrored like the screen. y = 0 at the top.
function normOf(p) {
  return { x: constrain(UI.mirror ? 1 - p.x : p.x, 0, 1), y: constrain(p.y, 0, 1) };
}
function screenOf(p) {
  const x = UI.mirror ? 1 - p.x : p.x;
  return { x: fit.x + x * fit.w, y: fit.y + p.y * fit.h };
}
function computeFit() {
  const v = video && video.elt;
  const vw = (v && v.videoWidth) || 16, vh = (v && v.videoHeight) || 9;
  const s = Math.min(width / vw, height / vh);
  fit = { w: vw * s, h: vh * s, x: (width - vw * s) / 2, y: (height - vh * s) / 2 };
}

// ---------- MIDI ----------
function sendAll() {
  const now = performance.now(), n = nBodies();
  for (const k of selected) {
    const [b, id] = parseKey(k);
    if (b >= n) continue;
    const s = slots[b], p = s.pts[id];
    // Lost (body out of view or this point hidden): HOLD the last numbers. Nothing new is sent,
    // so Ableton stays exactly where it was until the point is seen again.
    if (!p || p.v < VIS) { if (s.live[id]) s.live[id].held = true; continue; }
    const o = normOf(p);
    // Raw values: X 0 = left … 1 = right, Y 0 = bottom … 1 = top (raising a limb raises it),
    // either in the camera frame or relative to this body's chest.
    const m = Mapping.get(k);
    let rx = o.x, ry = 1 - o.y;
    if (m.coords === 'body') { const r = bodyRel(s, o); if (r) { rx = r.x; ry = r.y; } }
    Mapping.feed(k, rx, ry);
    const X = Mapping.axis(m.x, rx), Y = Mapping.axis(m.y, ry);
    s.live[id] = { x: o.x, y: o.y, rx, ry, tx: X.t, ty: Y.t, ox: X.out, oy: Y.out, vx: X.midi, vy: Y.midi, held: false };
  }

  const solo = Midi.solo && now < Midi.solo.until ? Midi.solo : null;
  if (solo) {
    const L = slots[solo.b].live[solo.id];
    Midi.cc(solo.cc, L ? (solo.axis === 'x' ? L.vx : L.vy) : 64, chOf(solo.b)); // alone, every frame, for MIDI Map
    soloWas = true;
    return;
  }
  if (soloWas) { soloWas = false; Midi.solo = null; for (const s of slots) s.lastSent = {}; }

  const mode = UI.sendMode; // 'cc' | 'notes' | 'both'
  if (mode !== 'notes') {
    for (const k of selected) {
      const [b, id] = parseKey(k);
      if (b >= n) continue;
      const s = slots[b], L = s.live[id], P = BodyPoints.byId[id], ch = chOf(b);
      if (!L || L.held) continue;
      // With notes too, skip CC 64: synths read it as the sustain pedal.
      if (s.lastSent[P.cc] !== L.vx && !(mode === 'both' && P.cc === 64)) { s.lastSent[P.cc] = L.vx; Midi.cc(P.cc, L.vx, ch); }
      if (s.lastSent[P.cc + 1] !== L.vy) { s.lastSent[P.cc + 1] = L.vy; Midi.cc(P.cc + 1, L.vy, ch); }
    }
  }
  if (mode !== 'cc') playNotes(n);
}

// Position relative to the body: 0.5 = at the chest, 1 unit = 4 torso lengths (torso = shoulders
// to hips), so the value follows the performer, not the camera.
function bodyRel(s, o) {
  const P = s.pts, ids = ['shoulder_l', 'shoulder_r', 'hip_l', 'hip_r', 'chest'];
  if (ids.some((id) => !P[id] || P[id].v < VIS)) return null;
  const n = (id) => normOf(P[id]);
  const sh = { x: (n('shoulder_l').x + n('shoulder_r').x) / 2, y: (n('shoulder_l').y + n('shoulder_r').y) / 2 };
  const hp = { x: (n('hip_l').x + n('hip_r').x) / 2, y: (n('hip_l').y + n('hip_r').y) / 2 };
  const torso = Math.hypot((sh.x - hp.x) * aspect, sh.y - hp.y);
  if (torso < 1e-3) return null;
  const c = n('chest'), unit = 4 * torso;
  return { x: 0.5 + ((o.x - c.x) * aspect) / unit, y: 0.5 + (c.y - o.y) / unit };
}

// Notes mode: height plays a note from the scale; left–right of the body's FIRST selected point
// moves the mod wheel or pitch bend on that body's channel. A lost point stops its note.
function playNotes(n) {
  for (let b = 0; b < n; b++) {
    const s = slots[b], ch = chOf(b);
    let expr = false;
    for (const P of BodyPoints.POINTS) {
      if (!selected.has(keyOf(b, P.id))) continue;
      const L = s.live[P.id];
      if (!L || L.held) { Notes.release(s.notes[P.id]); continue; }
      const st = s.notes[P.id] || (s.notes[P.id] = {});
      Notes.update(st, L.ty, ch); // height after the point's range mapping
      if (!expr) {
        expr = true;
        if (UI.xControl === 'mod' && s.lastSent.mod !== L.vx) { s.lastSent.mod = L.vx; Midi.cc(1, L.vx, ch); }
        if (UI.xControl === 'bend') {
          const v = Math.round((L.tx * 2 - 1) * 100) / 100;
          if (s.lastSent.bend !== v) { s.lastSent.bend = v; Midi.bend(v, ch); }
        }
      }
    }
  }
}

// Faint horizontal lines for the scale steps, so the performer sees where the notes are.
function drawNoteSteps() {
  const L = Notes.steps(), h = fit.h / L.length;
  textSize(10); textAlign(LEFT, CENTER); strokeWeight(1);
  for (let i = 0; i <= L.length; i++) {
    const y = fit.y + fit.h - i * h;
    stroke(255, 16); line(fit.x, y, fit.x + fit.w, y);
    if (i < L.length) {
      const isRoot = L[i] % 12 === UI.root;
      if (h >= 12 || isRoot) { noStroke(); fill(255, isRoot ? 120 : 55); text(Notes.name(L[i]), fit.x + 6, y - h / 2); }
    }
  }
}

// ---------- drawing ----------
function draw() {
  track();
  smoothPoints();
  computeFit();
  background(0);

  if (UI.showVideo && video.elt.readyState >= 2) {
    push();
    tint(255, 60);
    if (UI.mirror) { translate(fit.x + fit.w, fit.y); scale(-1, 1); image(video, 0, 0, fit.w, fit.h); }
    else image(video, fit.x, fit.y, fit.w, fit.h);
    pop();
  }
  noFill(); stroke(255, 22); strokeWeight(1);
  rect(fit.x, fit.y, fit.w, fit.h);

  if (UI.sendMode !== 'cc') drawNoteSteps();
  placedLabels = [];
  drawRanges();
  findHover();
  for (let b = 0; b < nBodies(); b++) drawSkeleton(b);
  for (let b = 0; b < nBodies(); b++) drawPoints(b, false);
  for (let b = 0; b < nBodies(); b++) drawPoints(b, true);
  sendAll();
  drawHud();
  UI.tick();
}

// While a point's range editor is open (or it is learning), show its input range on the stage.
function drawRanges() {
  for (const k of selected) {
    const [b, id] = parseKey(k);
    if (b >= nBodies()) continue;
    const learn = Mapping.learnBox(k);
    if (!learn && !UI.openMaps.has(k)) continue;
    const m = Mapping.get(k);
    const c = color(colorOf(k));
    let box;
    if (learn && isFinite(learn.x0)) box = { x0: learn.x0, x1: learn.x1, y0: learn.y0, y1: learn.y1 };
    else box = { x0: Math.min(m.x.in0, m.x.in1), x1: Math.max(m.x.in0, m.x.in1), y0: Math.min(m.y.in0, m.y.in1), y1: Math.max(m.y.in0, m.y.in1) };
    // to screen: in body coords, centre the box on this body's chest
    let toS = (rx, ry) => ({ x: fit.x + rx * fit.w, y: fit.y + (1 - ry) * fit.h });
    if (m.coords === 'body') {
      const s = slots[b], P = s.pts;
      if (!P.chest || !P.shoulder_l || !P.hip_l) continue;
      const cS = screenOf(P.chest);
      const a = screenOf(P.shoulder_l), z = screenOf(P.hip_l);
      const unitPx = 4 * dist(a.x, a.y, z.x, z.y);
      toS = (rx, ry) => ({ x: cS.x + (rx - 0.5) * unitPx, y: cS.y - (ry - 0.5) * unitPx });
    }
    const p0 = toS(box.x0, box.y1), p1 = toS(box.x1, box.y0);
    c.setAlpha(learn ? 230 : 170); stroke(c); strokeWeight(learn ? 2.5 : 1.5); noFill();
    drawingContext.setLineDash([6, 5]);
    rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    drawingContext.setLineDash([]);
    if (learn) { noStroke(); fill(c); textSize(11); textAlign(LEFT, BOTTOM); text(`learning range… ${Mapping.learnLeft(k).toFixed(1)} s`, p0.x + 4, p0.y - 4); }
  }
}

function findHover() {
  hover = null;
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  let best = 26;
  for (let b = 0; b < nBodies(); b++) {
    for (const P of BodyPoints.POINTS) {
      const p = slots[b].pts[P.id];
      if (!p) continue;
      const s = screenOf(p);
      const d = dist(mouseX, mouseY, s.x, s.y);
      if (d < best) { best = d; hover = keyOf(b, P.id); }
    }
  }
  cursor(hover ? HAND : ARROW);
}

function bodyStroke(b, alpha) {
  if (nBodies() === 1) return stroke(255, alpha);
  const c = color(BODY_COLORS[b]); c.setAlpha(alpha); stroke(c);
}

function drawSkeleton(b) {
  const pts = slots[b].pts;
  strokeCap(ROUND);
  for (const [a, z] of BodyPoints.EDGES) {
    const p = pts[a], q = pts[z];
    if (!p || !q) continue;
    const ok = p.v >= VIS && q.v >= VIS;
    bodyStroke(b, ok ? 120 : 22);
    strokeWeight(ok ? 2 : 1);
    const s = screenOf(p), t = screenOf(q);
    line(s.x, s.y, t.x, t.y);
  }
  // head outline
  const top = pts.head_top, nose = pts.nose;
  if (top && nose) {
    const a = screenOf(top), c = screenOf(nose);
    const ok = top.v >= VIS;
    noFill(); bodyStroke(b, ok ? 80 : 22); strokeWeight(1.5);
    circle(lerp(a.x, c.x, 0.5), lerp(a.y, c.y, 0.5), dist(a.x, a.y, c.x, c.y) * 1.25);
    // body tag above the head
    if (nBodies() > 1) {
      const tag = `BODY ${b + 1} · ch ${chOf(b)}` + (isTracked(b) ? '' : ' · HOLD');
      textSize(11); textAlign(CENTER, BOTTOM); noStroke();
      const col = color(BODY_COLORS[b]); col.setAlpha(ok ? 255 : 110); fill(col);
      text(tag, a.x, a.y - dist(a.x, a.y, c.x, c.y) * 0.35 - 6);
    }
  }
}

function drawPoints(b, selectedPass) {
  const t = millis() / 1000, pts = slots[b].pts, s0 = slots[b];
  for (const P of BodyPoints.POINTS) {
    const k = keyOf(b, P.id);
    const isSel = selected.has(k);
    if (isSel !== selectedPass) continue;
    const p = pts[P.id];
    if (!p) continue;
    const s = screenOf(p);
    const ok = p.v >= VIS;

    if (!isSel) {
      noStroke(); fill(255, ok ? 210 : 45);
      circle(s.x, s.y, P.core ? 11 : P.finger ? 6 : 8);
      if (hover === k) {
        noFill(); stroke(255); strokeWeight(1.5);
        circle(s.x, s.y, 24);
        const who = nBodies() > 1 ? `Body ${b + 1} · ` : '';
        label(s.x, s.y, who + P.name, `click to send · ch ${chOf(b)} · CC ${P.cc}/${P.cc + 1}`, color(255));
      }
      continue;
    }

    const c = color(colorOf(k));
    // trail
    const tr = s0.trails[P.id] || (s0.trails[P.id] = []);
    // stored in camera coordinates, so resizing or mirroring never leaves stray lines
    if (ok) { tr.push({ x: p.x, y: p.y }); if (tr.length > 24) tr.shift(); }
    noFill();
    for (let i = 1; i < tr.length; i++) {
      const a = screenOf(tr[i - 1]), z = screenOf(tr[i]);
      c.setAlpha(map(i, 0, tr.length, 0, 160)); stroke(c); strokeWeight(map(i, 0, tr.length, 0.5, 3));
      line(a.x, a.y, z.x, z.y);
    }
    // crosshair to the frame edges (shows X and Y)
    c.setAlpha(ok ? 55 : 20); stroke(c); strokeWeight(1);
    line(s.x, fit.y, s.x, fit.y + fit.h);
    line(fit.x, s.y, fit.x + fit.w, s.y);
    // pulsing marker
    const pulse = ok ? 18 + 5 * Math.sin(t * 6 + P.index) : 16;
    c.setAlpha(255); stroke(c); strokeWeight(2); noFill();
    circle(s.x, s.y, pulse);
    c.setAlpha(ok ? 255 : 90); fill(c); noStroke();
    circle(s.x, s.y, 9);
    push(); translate(s.x + 14, s.y - 14); rotate(QUARTER_PI); rectMode(CENTER); rect(0, 0, 6, 6); pop();

    const L = s0.live[P.id];
    const st = s0.notes[P.id];
    const nt = UI.sendMode !== 'cc' ? (st && st.note != null ? `♪ ${Notes.name(st.note)}  ` : '♪ —  ') : '';
    const info = !L ? 'waiting for body…' : ok ? `${nt}X ${L.vx}  Y ${L.vy}` : `HOLD  X ${L.vx}  Y ${L.vy}`;
    const who = nBodies() > 1 ? `B${b + 1} ` : '';
    label(s.x, s.y, who + P.name, info, color(colorOf(k)));
  }
}

// Labels placed this frame, so close points (like fingers) stack their labels instead of overlapping.
let placedLabels = [];
function label(x, y, title, sub, c) {
  textSize(12);
  const w = Math.max(textWidth(title), textWidth(sub)) + 14, h = 36;
  let lx = x + 20, ly = y - 44;
  if (lx + w > width) lx = x - 20 - w;
  if (ly < 4) ly = y + 18;
  const hits = (r) => placedLabels.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
  for (let i = 0; i < 12 && hits({ x: lx, y: ly, w, h }); i++) ly += h + 3;
  placedLabels.push({ x: lx, y: ly, w, h });
  if (Math.abs(ly - (y - 44)) > 1) { stroke(c); strokeWeight(0.6); line(x, y, lx, ly + h / 2); }
  noStroke(); fill(0, 200); rect(lx, ly, w, h, 4);
  fill(c); textAlign(LEFT, TOP); text(title, lx + 7, ly + 4);
  fill(200); textSize(11); text(sub, lx + 7, ly + 20);
}

function drawHud() {
  noStroke(); fill(160); textSize(11); textAlign(LEFT, TOP);
  const n = nBodies();
  const seen = [...Array(n).keys()].filter(isTracked).length;
  let tracking;
  if (!window.Pose.ready) tracking = window.Pose.status;
  else if (n === 1) tracking = seen ? 'performer tracked' : 'no performer in view · holding last values';
  else tracking = `${seen}/${n} bodies tracked` + (seen < n ? ' · missing ones hold last values' : '');
  const sending = [...selected].filter((k) => parseKey(k)[0] < n).length;
  text(`${tracking}  ·  ${nf(frameRate(), 2, 0)} fps  ·  ${sending} sending`, 14, 12);
  fill(90);
  text('click a point to send · click again to stop · F full screen · H panel · 1–4 bodies · R re-assign · V video · M mirror · C clear', 14, height - 22);
}

function mousePressed() {
  if (hover && mouseButton === LEFT) toggle(hover);
}

function keyPressed() {
  if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  if (key === 'v' || key === 'V') UI.set('showVideo', !UI.showVideo);
  if (key === 'm' || key === 'M') UI.set('mirror', !UI.mirror);
  if (key === 'c' || key === 'C') clearAll();
  if (key === 'r' || key === 'R') reassignByPosition();
  if (key === 'f' || key === 'F') UI.toggleFullscreen();
  if (key === 'h' || key === 'H') UI.togglePanel();
  if ('1234'.includes(key)) UI.setBodies(+key);
}
