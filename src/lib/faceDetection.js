import * as faceapi from '@vladmandic/face-api'

let modelsLoaded = false
let loadingPromise = null

export async function loadFaceModels(onProgress) {
  if (modelsLoaded) return
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const MODEL_URL = '/models'
    onProgress?.('Loading face detector…')
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    onProgress?.('Loading landmarks…')
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    onProgress?.('Loading recognition net…')
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    onProgress?.('Models ready')
    modelsLoaded = true
  })()

  return loadingPromise
}

export function areModelsLoaded() {
  return modelsLoaded
}

/**
 * Fast detection (no landmarks/embedding) — used during live preview
 */
export async function detectFaceFast(videoEl) {
  if (!modelsLoaded || !videoEl || videoEl.paused || videoEl.ended) return null
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,  // higher than kiosk because laptops are faster
    scoreThreshold: 0.5,
  })
  const result = await faceapi.detectSingleFace(videoEl, options)
  return result || null
}

/**
 * Full detection with embedding — used at capture time
 */
export async function detectFaceFull(videoEl) {
  if (!modelsLoaded || !videoEl || videoEl.paused || videoEl.ended) return null
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,  // highest quality for enrollment captures
    scoreThreshold: 0.5,
  })
  const result = await faceapi
    .detectSingleFace(videoEl, options)
    .withFaceLandmarks()
    .withFaceDescriptor()
  return result || null
}

/**
 * Quality check — returns { ok, reason }
 */
export function evaluateFaceQuality(detection, videoEl) {
  if (!detection) return { ok: false, reason: 'no_face' }
  const box = detection.box || detection.detection?.box
  const score = detection.score ?? detection.detection?.score
  if (!box) return { ok: false, reason: 'no_face' }

  const videoW = videoEl.videoWidth
  const videoH = videoEl.videoHeight

  if (score < 0.6) return { ok: false, reason: 'low_confidence' }

  const faceArea = box.width * box.height
  const frameArea = videoW * videoH
  const faceRatio = faceArea / frameArea
  if (faceRatio < 0.05) return { ok: false, reason: 'too_far' }
  if (faceRatio > 0.6) return { ok: false, reason: 'too_close' }

  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const offX = Math.abs(cx - videoW / 2) / videoW
  const offY = Math.abs(cy - videoH / 2) / videoH
  if (offX > 0.3 || offY > 0.3) return { ok: false, reason: 'off_center' }

  return { ok: true, reason: 'good' }
}

export function embeddingToArray(descriptor) {
  return Array.from(descriptor)
}
