// The body points the app tracks, built from MediaPipe's 33 pose landmarks.
// Some points are MediaPipe landmarks as-is; others (head top, neck, chest, belly, pelvis,
// mid upper arm, mid forearm, hand centre, thigh, shin) are derived from them.
// "Left"/"right" are the PERFORMER's left and right.
//
// Every point owns two fixed MIDI CCs: X on cc, Y on cc + 1 (CC 20 … 91 for the body, and
// 92–95 + 102–117 for the fingers), so mappings in Ableton never move when you select or
// deselect other points.
//
// Fingers: when MediaPipe's hand model sees a hand, "hand" becomes the true palm centre and the
// five finger points are the fingertips. Without it (or when the hand is too small/blurred)
// they fall back to the pose model's rougher thumb / index / pinky.
(function () {
  // MediaPipe pose landmark indices
  const I = {
    nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8, mouthL: 9, mouthR: 10,
    shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
    piL: 17, piR: 18, inL: 19, inR: 20, thL: 21, thR: 22,
    hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28,
    heL: 29, heR: 30, ftL: 31, ftR: 32,
  };

  const lm = (a, i) => ({ x: a[i].x, y: a[i].y, v: a[i].visibility ?? 1 });
  const mix = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, v: Math.min(p.v, q.v) });
  const mean = (...ps) => ({
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
    v: Math.min(...ps.map((p) => p.v)),
  });

  const midSh = (a) => mean(lm(a, I.shL), lm(a, I.shR));
  const midHip = (a) => mean(lm(a, I.hipL), lm(a, I.hipR));

  // Top of the head: MediaPipe has no landmark there, so go "up" from the mouth through the
  // eyes and step out by roughly the size of the head. ar = video width / height, so the
  // maths happens in square (pixel-like) space.
  function headTop(a, ar) {
    const eyes = mean(lm(a, I.eyeL), lm(a, I.eyeR));
    const mouth = mean(lm(a, I.mouthL), lm(a, I.mouthR));
    const eL = lm(a, I.earL), eR = lm(a, I.earR);
    let ux = (eyes.x - mouth.x) * ar, uy = eyes.y - mouth.y;
    const d = Math.hypot(ux, uy) || 1e-6;
    ux /= d; uy /= d;
    const headW = Math.hypot((eL.x - eR.x) * ar, eL.y - eR.y);
    const len = Math.max(headW * 0.7, d * 1.9);
    return { x: eyes.x + (ux * len) / ar, y: eyes.y + uy * len, v: Math.min(eyes.v, mouth.v) };
  }

  // Pose-only fallbacks for the fingers (pose has thumb, index and pinky but no middle/ring).
  const fingerFallback = (k, which) => (a) => {
    const idx = lm(a, k('in')), pk = lm(a, k('pi'));
    if (which === 'thumb') return lm(a, k('th'));
    if (which === 'index') return idx;
    if (which === 'middle') return mix(idx, pk, 1 / 3);
    if (which === 'ring') return mix(idx, pk, 2 / 3);
    return pk;
  };

  const side = (s) => {
    const k = (n) => I[n + s];
    const word = s === 'L' ? 'Left' : 'Right';
    const id = s === 'L' ? '_l' : '_r';
    return {
      arm: [
        { id: 'shoulder' + id, name: word + ' shoulder', f: (a) => lm(a, k('sh')) },
        { id: 'upperarm' + id, name: word + ' upper arm', f: (a) => mix(lm(a, k('sh')), lm(a, k('el')), 0.5) },
        { id: 'elbow' + id, name: word + ' elbow', f: (a) => lm(a, k('el')) },
        { id: 'forearm' + id, name: word + ' forearm', f: (a) => mix(lm(a, k('el')), lm(a, k('wr')), 0.5) },
        { id: 'wrist' + id, name: word + ' wrist', f: (a) => lm(a, k('wr')) },
        { id: 'hand' + id, name: word + ' hand', f: (a) => mean(lm(a, k('wr')), lm(a, k('pi')), lm(a, k('in')), lm(a, k('th'))) },
      ],
      fingers: ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => (
        { id: f + id, name: word + ' ' + f, f: fingerFallback(k, f), finger: true }
      )),
      leg: [
        { id: 'thigh' + id, name: word + ' thigh', f: (a) => mix(lm(a, k('hip')), lm(a, k('kn')), 0.5) },
        { id: 'knee' + id, name: word + ' knee', f: (a) => lm(a, k('kn')) },
        { id: 'shin' + id, name: word + ' shin', f: (a) => mix(lm(a, k('kn')), lm(a, k('an')), 0.5) },
        { id: 'ankle' + id, name: word + ' ankle', f: (a) => lm(a, k('an')) },
        { id: 'heel' + id, name: word + ' heel', f: (a) => lm(a, k('he')) },
        { id: 'toes' + id, name: word + ' toes', f: (a) => lm(a, k('ft')) },
      ],
    };
  };
  const L = side('L'), R = side('R');

  const groups = [
    ['Head', [
      { id: 'head_top', name: 'Head top', f: headTop },
      { id: 'nose', name: 'Nose', f: (a) => lm(a, I.nose) },
      { id: 'eye_l', name: 'Left eye', f: (a) => lm(a, I.eyeL) },
      { id: 'eye_r', name: 'Right eye', f: (a) => lm(a, I.eyeR) },
      { id: 'ear_l', name: 'Left ear', f: (a) => lm(a, I.earL) },
      { id: 'ear_r', name: 'Right ear', f: (a) => lm(a, I.earR) },
    ]],
    ['Torso', [
      { id: 'neck', name: 'Neck', f: (a) => mix(midSh(a), lm(a, I.nose), 0.3) },
      { id: 'chest', name: 'Chest', f: (a) => mix(midSh(a), midHip(a), 0.22), core: true },
      { id: 'belly', name: 'Belly', f: (a) => mix(midSh(a), midHip(a), 0.62) },
      { id: 'pelvis', name: 'Pelvis (hip centre)', f: midHip, core: true },
      { id: 'hip_l', name: 'Left hip', f: (a) => lm(a, I.hipL) },
      { id: 'hip_r', name: 'Right hip', f: (a) => lm(a, I.hipR) },
    ]],
    ['Left arm', L.arm],
    ['Right arm', R.arm],
    ['Left leg', L.leg],
    ['Right leg', R.leg],
    ['Left fingers', L.fingers],
    ['Right fingers', R.fingers],
  ];
  // Finger CCs: skip 96–101, which synths read as data entry / RPN / NRPN.
  const FINGER_CC = [92, 94, 102, 104, 106, 108, 110, 112, 114, 116];

  const POINTS = [];
  for (const [group, list] of groups) for (const p of list) {
    p.group = group;
    p.index = POINTS.length;
    p.cc = p.finger ? FINGER_CC[POINTS.filter((q) => q.finger).length] : 20 + p.index * 2; // X = cc, Y = cc + 1
    p.live = null;
    POINTS.push(p);
  }
  const byId = Object.fromEntries(POINTS.map((p) => [p.id, p]));

  const EDGES = [
    ['ear_l', 'eye_l'], ['eye_l', 'nose'], ['nose', 'eye_r'], ['eye_r', 'ear_r'],
    ['nose', 'neck'], ['neck', 'chest'], ['chest', 'belly'], ['belly', 'pelvis'],
    ['pelvis', 'hip_l'], ['pelvis', 'hip_r'], ['hip_l', 'hip_r'],
    ['neck', 'shoulder_l'], ['neck', 'shoulder_r'],
    ['shoulder_l', 'hip_l'], ['shoulder_r', 'hip_r'],
    ['shoulder_l', 'upperarm_l'], ['upperarm_l', 'elbow_l'], ['elbow_l', 'forearm_l'], ['forearm_l', 'wrist_l'], ['wrist_l', 'hand_l'],
    ['shoulder_r', 'upperarm_r'], ['upperarm_r', 'elbow_r'], ['elbow_r', 'forearm_r'], ['forearm_r', 'wrist_r'], ['wrist_r', 'hand_r'],
    ['hip_l', 'thigh_l'], ['thigh_l', 'knee_l'], ['knee_l', 'shin_l'], ['shin_l', 'ankle_l'], ['ankle_l', 'heel_l'], ['heel_l', 'toes_l'], ['ankle_l', 'toes_l'],
    ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [['hand_l', f + '_l'], ['hand_r', f + '_r']]),
    ['hip_r', 'thigh_r'], ['thigh_r', 'knee_r'], ['knee_r', 'shin_r'], ['shin_r', 'ankle_r'], ['ankle_r', 'heel_r'], ['heel_r', 'toes_r'], ['ankle_r', 'toes_r'],
  ];

  function compute(landmarks, ar) {
    const out = {};
    for (const p of POINTS) out[p.id] = p.f(landmarks, ar);
    return out;
  }

  // Replace one side's palm + fingers with the hand model's 21 landmarks (h).
  // Hand landmarks: 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip,
  // 5/9/13/17 knuckles.
  function applyHand(det, s, h) {
    const P = (i) => ({ x: h[i].x, y: h[i].y, v: 1 });
    det['hand' + s] = mean(P(0), P(5), P(9), P(13), P(17));
    det['thumb' + s] = P(4);
    det['index' + s] = P(8);
    det['middle' + s] = P(12);
    det['ring' + s] = P(16);
    det['pinky' + s] = P(20);
    det.__hands = (det.__hands || 0) + 1;
  }

  window.BodyPoints = { POINTS, byId, EDGES, groups: groups.map((g) => g[0]), compute, applyHand };
})();
