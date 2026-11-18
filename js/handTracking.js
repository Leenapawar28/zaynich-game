import {
  HandLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Palm-center landmark (middle-finger MCP) — steadier than the wrist or
// fingertips for driving a hover position. Wrist is used alongside it to
// estimate hand size (our depth proxy — a 2D webcam has no real depth).
const PALM_LANDMARK = 9;
const WRIST_LANDMARK = 0;

// Window (ms) over which we measure displacement to get a swing "speed",
// used only to scale impact effects — the swing itself is now driven
// directly by hand height, not by speed.
const SPEED_WINDOW_MS = 140;
const SMOOTHING = 0.45;
const DEPTH_SMOOTHING = 0.35;

// Normalized wrist-to-palm span observed at a comfortable arm's-length
// distance (SPAN_FAR) versus leaning in close to the camera (SPAN_NEAR).
// Span is normalized image distance, so it's roughly scale-invariant across
// webcam resolutions.
const SPAN_FAR = 0.10;
const SPAN_NEAR = 0.24;

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Weapon selected by how many fingers are extended — the "combination
// therapy" gimmick: a closed fist is the only gesture that lets the
// Zidebactam/Cefepime mallets actually connect.
const GESTURE_BY_COUNT = { 0: 'mallet', 1: 'knife', 2: 'gun', 3: 'bat', 4: 'hammer', 5: 'glove' };

// tip/pip landmark pairs for the four non-thumb fingers.
const FINGER_JOINTS = [
  [8, 6], // index
  [12, 10], // middle
  [16, 14], // ring
  [20, 18], // pinky
];

// A finger reads as "extended" when its tip sits meaningfully farther from
// the wrist than its own middle knuckle — robust to hand size/scale since
// both distances are measured in the same normalized image space.
function isFingerExtended(landmarks, tipIdx, pipIdx) {
  const wrist = landmarks[0];
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
  return dTip > dPip * 1.15;
}

// The thumb folds sideways rather than curling toward the wrist, so it's
// judged by how far its tip strays from its own base knuckle instead.
function isThumbExtended(landmarks) {
  const wrist = landmarks[0];
  const tip = landmarks[4];
  const mcp = landmarks[2];
  const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const dMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
  return dTip > dMcp * 1.2;
}

function classifyGesture(landmarks) {
  const extended = FINGER_JOINTS.map(([tip, pip]) => isFingerExtended(landmarks, tip, pip));
  const count = extended.filter(Boolean).length;
  const thumbOut = isThumbExtended(landmarks);
  if (count === 4 && thumbOut) return 'glove'; // all five fingers spread
  if (GESTURE_BY_COUNT[count] !== undefined) return GESTURE_BY_COUNT[count];
  return 'mallet';
}

// Frames a new classification must persist for before it's committed —
// rides out single-frame landmark jitter without adding noticeable lag.
const GESTURE_DEBOUNCE_FRAMES = 4;

export class HandTrackerError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'camera' | 'model'
  }
}

// The underlying wasm loader can silently retry for ~15s per delegate before
// giving up on its own, so we race a tighter deadline (per GPU/CPU attempt)
// to keep the worst case (both attempts failing) well under 20s.
const MODEL_LOAD_TIMEOUT_MS = 8000;

// The MediaPipe wasm loader can hang indefinitely (rather than rejecting)
// when its CDN is unreachable, so give it a hard deadline.
function withTimeout(promise, ms, timeoutError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export class HandTracker {
  constructor({ videoElement, onStatus } = {}) {
    this.video = videoElement;
    this.onStatus = onStatus || (() => {});
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.handStates = new Map();
    this.lastVideoTime = -1;
    this.latestResult = null;
    this._loop = this._loop.bind(this);
  }

  async start() {
    this.onStatus('loading', 'Loading hand-tracking model…');

    const timeoutErr = new HandTrackerError(
      'model',
      'The hand-tracking model took too long to load. Check your connection and try again.'
    );

    let vision;
    try {
      vision = await withTimeout(FilesetResolver.forVisionTasks(WASM_BASE), MODEL_LOAD_TIMEOUT_MS, timeoutErr);
    } catch (err) {
      if (err instanceof HandTrackerError) throw err;
      throw new HandTrackerError('model', 'Could not load the hand-tracking engine.');
    }

    try {
      this.landmarker = await withTimeout(
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        }),
        MODEL_LOAD_TIMEOUT_MS,
        timeoutErr
      );
    } catch (err) {
      if (err instanceof HandTrackerError) throw err;
      try {
        this.landmarker = await withTimeout(
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          }),
          MODEL_LOAD_TIMEOUT_MS,
          timeoutErr
        );
      } catch (err2) {
        if (err2 instanceof HandTrackerError) throw err2;
        throw new HandTrackerError('model', 'Could not load the hand-tracking model.');
      }
    }

    this.onStatus('loading', 'Requesting camera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      throw new HandTrackerError(
        'camera',
        denied ? 'Camera permission was denied.' : 'Could not access a camera.'
      );
    }

    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.onStatus('ready');
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }

  _loop() {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.latestResult = result;
      this._processResult(result);
    }
    requestAnimationFrame(this._loop);
  }

  _processResult(result) {
    const now = performance.now();
    const seen = new Set();
    const landmarksList = result.landmarks || [];
    const handednessList = result.handedness || [];

    landmarksList.forEach((landmarks, i) => {
      const label = handednessList[i]?.[0]?.categoryName || (i === 0 ? 'Right' : 'Left');
      seen.add(label);
      const palm = landmarks[PALM_LANDMARK];
      const wrist = landmarks[WRIST_LANDMARK];
      // Mirror horizontally so the on-screen mallet moves the way it would
      // in a mirror, matching a front-facing selfie webcam.
      const rawX = 1 - palm.x;
      const rawY = palm.y;
      const rawSpan = Math.hypot(palm.x - wrist.x, palm.y - wrist.y);
      const rawZ = clamp01((rawSpan - SPAN_FAR) / (SPAN_NEAR - SPAN_FAR));

      let state = this.handStates.get(label);
      if (!state) {
        state = {
          x: rawX, y: rawY, z: rawZ, history: [], speed: 0, present: true, lastSeen: now, landmarks,
          gesture: 'mallet', pendingGesture: 'mallet', pendingCount: 0,
        };
        this.handStates.set(label, state);
      }
      state.x += (rawX - state.x) * SMOOTHING;
      state.y += (rawY - state.y) * SMOOTHING;
      state.z += (rawZ - state.z) * DEPTH_SMOOTHING;
      state.landmarks = landmarks;

      const rawGesture = classifyGesture(landmarks);
      if (rawGesture === state.pendingGesture) {
        state.pendingCount++;
      } else {
        state.pendingGesture = rawGesture;
        state.pendingCount = 1;
      }
      if (state.pendingCount >= GESTURE_DEBOUNCE_FRAMES) {
        state.gesture = rawGesture;
      }

      state.history.push({ x: state.x, y: state.y, t: now });
      while (state.history.length && now - state.history[0].t > SPEED_WINDOW_MS) {
        state.history.shift();
      }
      if (state.history.length >= 2) {
        const a = state.history[0];
        const b = state.history[state.history.length - 1];
        const dt = (b.t - a.t) / 1000;
        if (dt > 0.01) {
          state.speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
        }
      }
      state.present = true;
      state.lastSeen = now;
    });

    for (const [label, state] of this.handStates) {
      if (!seen.has(label) && now - state.lastSeen > 250) {
        state.present = false;
        state.speed = 0;
        state.history.length = 0;
        state.landmarks = null;
      }
    }
  }

  /**
   * Returns [{ label, x, y, z, speed, present, landmarks, gesture }] in
   * normalized [0,1] image space (z: 0=far, 1=near). gesture is one of
   * 'mallet' | 'knife' | 'gun' | 'bat' | 'hammer' | 'glove'.
   */
  getHands() {
    return Array.from(this.handStates.entries()).map(([label, s]) => ({
      label,
      x: s.x,
      y: s.y,
      z: s.z,
      speed: s.speed,
      present: s.present,
      landmarks: s.landmarks,
      gesture: s.gesture,
    }));
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
