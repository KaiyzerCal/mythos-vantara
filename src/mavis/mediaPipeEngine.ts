/**
 * MediaPipe Engine — In-browser vision tracking for MAVIS.
 *
 * Loads @mediapipe/tasks-vision from CDN (WASM-based, GPU-accelerated) and
 * runs a 15fps inference loop on the user's webcam. Detects:
 *
 *   • Hand gestures  — Thumb_Up, Open_Palm, Closed_Fist, Victory, Pointing_Up,
 *                      ILoveYou, Thumb_Down, None
 *   • Face presence  — is the user at the screen, approximate distance
 *   • Expression     — smile/focused/tired heuristic from landmark geometry
 *   • Pose           — engagement level from shoulder/head relationship
 *
 * Inference results are:
 *   1. Stored in-memory as `currentBiometricState` (polled by provider)
 *   2. Emitted to systemMonitor as `sensor:gesture` / `sensor:presence` events
 *   3. Persisted to mavis_biometric_state (debounced, 5s)
 *   4. Forwarded to touchDesignerBridge for visual feedback
 *
 * Uses dynamic CDN import so no npm package is required. The /* @vite-ignore * /
 * directive tells Vite to skip bundling analysis for the external URL.
 */

import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { systemMonitor } from "@/mavis/systemMonitor";

// ── MediaPipe CDN loader ──────────────────────────────────────────────────────

const MEDIAPIPE_VERSION = "0.10.21";
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const MEDIAPIPE_WASM = `${MEDIAPIPE_CDN}/wasm`;

// Model asset paths hosted by Google
const MODEL_GESTURE   = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const MODEL_FACE      = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const MODEL_POSE      = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Resolved module reference (lazy)
let _mp: MediaPipeModule | null = null;

interface MediaPipeModule {
  FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };
  GestureRecognizer: {
    createFromOptions(vision: unknown, opts: unknown): Promise<GestureRecognizerInstance>;
  };
  FaceDetector: {
    createFromOptions(vision: unknown, opts: unknown): Promise<FaceDetectorInstance>;
  };
  PoseLandmarker: {
    createFromOptions(vision: unknown, opts: unknown): Promise<PoseLandmarkerInstance>;
  };
}

interface GestureRecognizerInstance {
  recognizeForVideo(video: HTMLVideoElement, timestampMs: number): GestureResult;
  close(): void;
}

interface FaceDetectorInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceResult;
  close(): void;
}

interface PoseLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseResult;
  close(): void;
}

interface NormalizedLandmark { x: number; y: number; z: number; visibility?: number }
interface Category { categoryName: string; score: number; index: number; displayName: string }
interface Detection { boundingBox: { originX: number; originY: number; width: number; height: number }; categories: Category[]; keypoints: NormalizedLandmark[] }

interface GestureResult {
  gestures: Category[][];        // per hand
  handLandmarks: NormalizedLandmark[][];
  handedness: Category[][];
}
interface FaceResult { detections: Detection[] }
interface PoseResult { landmarks: NormalizedLandmark[][] }

async function loadMediaPipe(): Promise<MediaPipeModule> {
  if (_mp) return _mp;
  // Dynamic import from CDN — vite-ignore skips bundle analysis
  const mod = await import(
    /* @vite-ignore */
    `${MEDIAPIPE_CDN}/vision_bundle.mjs`
  );
  _mp = mod as MediaPipeModule;
  return _mp;
}

// ── Biometric state ───────────────────────────────────────────────────────────

export type GestureName =
  | "Thumb_Up" | "Thumb_Down" | "Open_Palm" | "Closed_Fist"
  | "Victory" | "Pointing_Up" | "ILoveYou" | "None";

export type Expression = "neutral" | "happy" | "focused" | "tired" | "surprised" | "unknown";
export type Proximity  = "close" | "medium" | "far" | "absent" | "unknown";
export type Engagement = "engaged" | "distracted" | "away" | "resting" | "unknown";

export interface BiometricState {
  // Gesture
  gesture: GestureName;
  gestureConfidence: number;
  gestureHand: "Left" | "Right" | null;
  // Face
  facePresent: boolean;
  faceCount: number;
  proximity: Proximity;
  expression: Expression;
  expressionConfidence: number;
  // Pose
  poseDetected: boolean;
  engagement: Engagement;
  // Meta
  updatedAt: number;
}

const DEFAULT_STATE: BiometricState = {
  gesture: "None", gestureConfidence: 0, gestureHand: null,
  facePresent: false, faceCount: 0, proximity: "unknown",
  expression: "unknown", expressionConfidence: 0,
  poseDetected: false, engagement: "unknown",
  updatedAt: 0,
};

// ── Expression heuristics from face landmarks ─────────────────────────────────
// Face detector gives 6 keypoints: right_eye, left_eye, nose_tip,
// mouth_center, right_ear, left_ear. We derive simple heuristics from
// these relative positions.

function estimateExpression(detection: Detection): { expr: Expression; confidence: number } {
  const kps = detection.keypoints;
  if (!kps?.length) return { expr: "unknown", confidence: 0 };

  const bbox = detection.boundingBox;
  const faceH = bbox.height;
  const faceW = bbox.width;

  // Mouth center is keypoint index 3; nose tip is index 2; right/left eye 0,1
  const mouthY  = kps[3]?.y ?? 0;
  const noseY   = kps[2]?.y ?? 0;
  const eyeAvgY = kps[0] && kps[1] ? (kps[0].y + kps[1].y) / 2 : noseY;

  // Mouth-to-nose distance relative to face height — larger = open/happy
  const mouthGap = (mouthY - noseY) / faceH;
  // Eye-to-nose ratio — squinting = tired
  const eyeNoseRatio = Math.abs(eyeAvgY - noseY) / faceH;

  // Bbox aspect ratio: tall face = surprised (mouth open / raised brows)
  const aspect = faceH / Math.max(faceW, 1);

  if (mouthGap > 0.18) return { expr: "happy", confidence: Math.min(mouthGap * 4, 1) };
  if (eyeNoseRatio < 0.12) return { expr: "tired", confidence: 0.7 };
  if (aspect > 1.3) return { expr: "surprised", confidence: 0.6 };
  if (eyeNoseRatio > 0.18 && mouthGap < 0.12) return { expr: "focused", confidence: 0.65 };
  return { expr: "neutral", confidence: 0.8 };
}

// ── Proximity from face bounding box ─────────────────────────────────────────
// Larger bbox relative to frame = closer to camera

function estimateProximity(detection: Detection, videoW: number): Proximity {
  const faceW = detection.boundingBox.width;
  const ratio = faceW / Math.max(videoW, 1);
  if (ratio > 0.45) return "close";
  if (ratio > 0.2)  return "medium";
  return "far";
}

// ── Pose engagement from shoulder landmarks ───────────────────────────────────
// Pose landmark indices (MediaPipe BlazePose):
//   0 = nose, 11 = left shoulder, 12 = right shoulder

function estimateEngagement(landmarks: NormalizedLandmark[]): Engagement {
  const nose = landmarks[0];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  if (!nose || !lShoulder || !rShoulder) return "unknown";

  // If nose visibility is very low, user is away
  if ((nose.visibility ?? 1) < 0.3) return "away";

  const shoulderMidY = (lShoulder.y + rShoulder.y) / 2;
  const noseAboveShoulder = shoulderMidY - nose.y; // positive = nose above shoulders

  // Nose well above shoulders = sitting upright = engaged
  if (noseAboveShoulder > 0.25) return "engaged";
  // Nose at shoulder level = slumping = distracted
  if (noseAboveShoulder > 0.05) return "distracted";
  return "resting";
}

// ── MediaPipeEngine ───────────────────────────────────────────────────────────

class MediaPipeEngine {
  private _running = false;
  private _gestureRec: GestureRecognizerInstance | null = null;
  private _faceDetector: FaceDetectorInstance | null = null;
  private _poseLandmarker: PoseLandmarkerInstance | null = null;
  private _video: HTMLVideoElement | null = null;
  private _stream: MediaStream | null = null;
  private _rafId: number | null = null;
  private _lastDbPersist = 0;
  private _userId: string | null = null;
  private _gestureListeners = new Set<(state: BiometricState) => void>();
  private _lastGesture: GestureName = "None";
  private _lastGestureTs = 0;
  private _sessionGestureCount = 0;

  state: BiometricState = { ...DEFAULT_STATE };

  get running() { return this._running; }

  /** Start tracking — requests webcam access and begins inference loop */
  async start(userId: string, canvas?: HTMLCanvasElement): Promise<boolean> {
    if (this._running) return true;
    this._userId = userId;

    try {
      const mp = await loadMediaPipe();
      const vision = await mp.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);

      // Initialize all three models in parallel
      [this._gestureRec, this._faceDetector, this._poseLandmarker] = await Promise.all([
        mp.GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_GESTURE, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        }),
        mp.FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_FACE, delegate: "GPU" },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        }),
        mp.PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_POSE, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
        }),
      ]);

      // Get webcam stream
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });

      // Create hidden video element for inference
      this._video = document.createElement("video");
      this._video.srcObject = this._stream;
      this._video.muted = true;
      this._video.playsInline = true;
      await this._video.play();

      this._running = true;
      this._sessionGestureCount = 0;

      // Persist session start
      await this._upsertBiometricState({ tracking_started_at: new Date().toISOString() });

      // Start inference loop
      this._loop();
      return true;
    } catch (err) {
      console.error("[MediaPipeEngine] Start failed:", err);
      this._cleanup();
      return false;
    }
  }

  /** Stop tracking and release webcam */
  stop(): void {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._cleanup();
    this.state = { ...DEFAULT_STATE };
  }

  /** Register a listener for state changes */
  onStateChange(fn: (state: BiometricState) => void): () => void {
    this._gestureListeners.add(fn);
    return () => this._gestureListeners.delete(fn);
  }

  // ── Inference loop (rAF-based at ~15fps) ─────────────────────────────────

  private _loop(): void {
    if (!this._running) return;

    this._rafId = requestAnimationFrame(async () => {
      await this._infer();
      // ~15fps: schedule next frame after ~66ms gap
      setTimeout(() => this._loop(), 66);
    });
  }

  private async _infer(): Promise<void> {
    const video = this._video;
    if (!video || video.readyState < 2) return;

    const now = Date.now();
    const newState: BiometricState = { ...this.state, updatedAt: now };

    try {
      // ── Gesture recognition ────────────────────────────────
      if (this._gestureRec) {
        const gr = this._gestureRec.recognizeForVideo(video, now);
        if (gr.gestures.length > 0) {
          const topGesture = gr.gestures[0][0];
          const handedness = gr.handedness[0]?.[0]?.categoryName as "Left" | "Right" | undefined;

          newState.gesture = topGesture.categoryName as GestureName;
          newState.gestureConfidence = topGesture.score;
          newState.gestureHand = handedness ?? null;
        } else {
          newState.gesture = "None";
          newState.gestureConfidence = 0;
          newState.gestureHand = null;
        }
      }

      // ── Face detection ─────────────────────────────────────
      if (this._faceDetector) {
        const fr = this._faceDetector.detectForVideo(video, now);
        newState.faceCount = fr.detections.length;
        newState.facePresent = fr.detections.length > 0;

        if (fr.detections.length > 0) {
          const primary = fr.detections[0];
          const { expr, confidence } = estimateExpression(primary);
          newState.expression = expr;
          newState.expressionConfidence = confidence;
          newState.proximity = estimateProximity(primary, video.videoWidth || 640);
        } else {
          newState.expression = "unknown";
          newState.proximity = "absent";
        }
      }

      // ── Pose landmarker ────────────────────────────────────
      if (this._poseLandmarker) {
        const pr = this._poseLandmarker.detectForVideo(video, now);
        newState.poseDetected = pr.landmarks.length > 0;
        if (pr.landmarks.length > 0) {
          newState.engagement = estimateEngagement(pr.landmarks[0]);
        }
      }
    } catch {
      // Inference failures are non-fatal; keep previous state
    }

    this.state = newState;

    // ── Emit gesture change event ──────────────────────────
    const gestureChanged = newState.gesture !== "None" &&
      (newState.gesture !== this._lastGesture || now - this._lastGestureTs > 2000);

    if (gestureChanged && newState.gestureConfidence > 0.7) {
      this._lastGesture = newState.gesture;
      this._lastGestureTs = now;
      this._sessionGestureCount++;

      systemMonitor.emit("sensor:gesture", {
        gesture: newState.gesture,
        confidence: newState.gestureConfidence,
        hand: newState.gestureHand,
        expression: newState.expression,
        proximity: newState.proximity,
      });

      // Log to DB (non-blocking)
      this._logGestureEvent(newState.gesture, newState.gestureConfidence, newState.gestureHand);
    }

    // ── Emit presence change ────────────────────────────────
    const presenceChanged = newState.facePresent !== this.state.facePresent;
    if (presenceChanged) {
      systemMonitor.emit("sensor:presence", {
        facePresent: newState.facePresent,
        faceCount: newState.faceCount,
        proximity: newState.proximity,
        engagement: newState.engagement,
      });
    }

    // ── Notify listeners ────────────────────────────────────
    for (const fn of this._gestureListeners) {
      try { fn(newState); } catch {/* non-fatal */}
    }

    // ── Persist biometric state (max every 5s) ──────────────
    if (now - this._lastDbPersist > 5000) {
      this._lastDbPersist = now;
      this._upsertBiometricState({
        face_present: newState.facePresent,
        face_count: newState.faceCount,
        proximity: newState.proximity,
        expression: newState.expression,
        expression_confidence: newState.expressionConfidence,
        pose_detected: newState.poseDetected,
        engagement: newState.engagement,
        last_gesture: newState.gesture !== "None" ? newState.gesture : null,
        last_gesture_at: newState.gesture !== "None" ? new Date().toISOString() : null,
        last_gesture_confidence: newState.gestureConfidence,
        session_gesture_count: this._sessionGestureCount,
        updated_at: new Date().toISOString(),
      }).catch(() => {/* non-fatal */});
    }
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  private async _upsertBiometricState(fields: Record<string, unknown>): Promise<void> {
    if (!this._userId) return;
    await supabase.from("mavis_biometric_state").upsert(
      { user_id: this._userId, ...fields },
      { onConflict: "user_id" }
    ).catch(() => {/* non-fatal */});
  }

  private async _logGestureEvent(
    gesture: GestureName,
    confidence: number,
    hand: "Left" | "Right" | null,
    actionTriggered?: string
  ): Promise<void> {
    if (!this._userId) return;
    await supabase.from("mavis_gesture_events").insert({
      user_id: this._userId,
      source: "mediapipe",
      gesture,
      confidence,
      hand,
      sensor_type: "gesture",
      action_triggered: actionTriggered ?? null,
    }).catch(() => {/* non-fatal */});
  }

  /** Record that a gesture triggered a MAVIS action (call after dispatch) */
  async recordGestureAction(gesture: GestureName, action: string): Promise<void> {
    await this._logGestureEvent(gesture, this.state.gestureConfidence, this.state.gestureHand, action);
  }

  private _cleanup(): void {
    this._gestureRec?.close();
    this._faceDetector?.close();
    this._poseLandmarker?.close();
    this._gestureRec = null;
    this._faceDetector = null;
    this._poseLandmarker = null;
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null;
    this._video = null;
  }
}

export const mediaPipeEngine = new MediaPipeEngine();

// ── Biometric context builder (used by visionPlugin provider) ─────────────────

export function buildBiometricContext(state: BiometricState): string {
  if (state.updatedAt === 0) return "";

  const lines: string[] = ["[Biometric context — from webcam sensors]"];

  if (state.facePresent) {
    lines.push(`• Operator present — proximity: ${state.proximity}, expression: ${state.expression}`);
  } else {
    lines.push("• Operator not detected at screen");
  }

  if (state.poseDetected) {
    lines.push(`• Engagement level: ${state.engagement}`);
  }

  if (state.gesture !== "None") {
    const age = Math.round((Date.now() - state.updatedAt) / 1000);
    lines.push(`• Last gesture: ${state.gesture} (${state.gestureHand ?? "unknown hand"}, ${age}s ago)`);
  }

  return lines.join("\n");
}
