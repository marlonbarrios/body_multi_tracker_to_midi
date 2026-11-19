// MediaPipe Pose Landmarker (33 body landmarks per person, up to 4 people) and Hand Landmarker
// (21 points per hand, for the five fingers).
// Exposes window.Pose.detect(video, timeMs), Pose.setNum(n) for how many bodies to look for,
// and Pose.detectHands(video, timeMs) / Pose.setHands(n) for the hands.
import { FilesetResolver, PoseLandmarker, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const P = window.Pose;
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const OPTS = { runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };

const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const HAND_OPTS = { runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 };

async function make(fileset, delegate) {
  return PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, ...OPTS });
}
async function makeHands(fileset, delegate) {
  return HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, ...HAND_OPTS });
}

(async () => {
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    let pose;
    try { pose = await make(fileset, 'GPU'); } catch { pose = await make(fileset, 'CPU'); }
    P.numPoses = 1;
    P.detect = (video, t) => pose.detectForVideo(video, t);
    P.setNum = (n) => {
      P.numPoses = n;
      Promise.resolve(pose.setOptions({ numPoses: n })).catch((e) => console.warn('[pose] numPoses', e));
    };
    P.ready = true;
    P.status = 'body tracking ready';

    // Hands load separately: if they fail, the body still works (fingers fall back to pose).
    try {
      let hands;
      try { hands = await makeHands(fileset, 'GPU'); } catch { hands = await makeHands(fileset, 'CPU'); }
      P.numHands = 2;
      P.detectHands = (video, t) => hands.detectForVideo(video, t);
      P.setHands = (n) => {
        P.numHands = n;
        Promise.resolve(hands.setOptions({ numHands: n })).catch((e) => console.warn('[hands] numHands', e));
      };
      P.handsReady = true;
    } catch (e) {
      P.handsError = e.message;
      console.warn('[hands]', e);
    }
  } catch (e) {
    P.status = 'body tracking failed: ' + e.message;
    console.warn('[pose]', e);
  }
})();
