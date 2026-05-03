// ============================================================================
// PHOTO RESIZE
//
// Browser-based image resize using <canvas>. Targets a hard cap of 200KB
// using a binary search on JPEG quality. Strips EXIF metadata as a side effect
// (good for privacy — removes GPS, camera info).
//
// Inputs:  File | Blob (JPEG, PNG, WebP)
// Outputs: Blob (always JPEG, ≤200KB)
//
// Algorithm:
//   1. Read file into Image element
//   2. Calculate target dimensions (max 800×800, preserve aspect ratio)
//   3. Draw onto canvas at target size
//   4. Try quality 0.85 → measure → adjust down until ≤TARGET_BYTES
//      (binary search: quality between 0.30 and 0.95)
//   5. Return the resulting JPEG blob
// ============================================================================

const TARGET_BYTES = 200 * 1024  // 200 KB
const MAX_DIMENSION = 800        // longest side, in pixels
const MIN_QUALITY = 0.30         // floor — below this, looks ugly
const MAX_QUALITY = 0.95
const MAX_ITERATIONS = 8         // binary search depth (2^8 = 256 quality steps; way more than needed)

/**
 * Resize an image file to ≤200KB JPEG.
 * @param {File|Blob} file - Source image (JPEG, PNG, WebP)
 * @param {Function} [onStatus] - optional progress callback ({ stage, attempt, size })
 * @returns {Promise<Blob>} - Resized JPEG, ≤200KB
 */
export async function resizeImageTo200KB(file, onStatus) {
  if (!file) throw new Error('No file provided')

  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!supportedTypes.includes(file.type)) {
    throw new Error(`Unsupported image type: ${file.type}. Use JPEG, PNG, or WebP.`)
  }

  onStatus?.({ stage: 'loading' })

  // Step 1 — load into Image
  const img = await loadImageFromFile(file)

  // Step 2 — calculate target dimensions
  const { targetWidth, targetHeight } = computeTargetDimensions(img.width, img.height)

  onStatus?.({ stage: 'resizing', dimensions: `${targetWidth}×${targetHeight}` })

  // Step 3 — draw onto canvas
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')
  // White background in case source is transparent (PNG with alpha → JPEG)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetWidth, targetHeight)
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  // Step 4 — binary search for quality that hits ≤TARGET_BYTES
  // Start with conservative quality 0.85; if it fits, we're done quickly.
  let lo = MIN_QUALITY
  let hi = MAX_QUALITY
  let best = null  // best blob found that's ≤TARGET_BYTES

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const quality = (lo + hi) / 2
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    onStatus?.({ stage: 'compressing', attempt: i + 1, size: blob.size, quality })

    if (blob.size <= TARGET_BYTES) {
      best = blob
      // Try higher quality next
      lo = quality
    } else {
      // Too big — try lower quality
      hi = quality
    }

    // Early exit if we've converged
    if (hi - lo < 0.02) break
  }

  // If we still don't have a passing blob, last-resort: try minimum quality
  if (!best) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', MIN_QUALITY)
    if (blob.size <= TARGET_BYTES) {
      best = blob
    } else {
      throw new Error(
        `Could not compress image below 200KB even at minimum quality. ` +
        `Result: ${(blob.size / 1024).toFixed(0)}KB. Try a smaller starting image.`
      )
    }
  }

  onStatus?.({ stage: 'done', size: best.size })
  return best
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode image (file may be corrupt)'))
    }
    img.src = url
  })
}

function computeTargetDimensions(srcWidth, srcHeight) {
  // Preserve aspect ratio; longest side capped at MAX_DIMENSION.
  // If source is already smaller, don't upscale.
  const longest = Math.max(srcWidth, srcHeight)
  if (longest <= MAX_DIMENSION) {
    return { targetWidth: srcWidth, targetHeight: srcHeight }
  }
  const scale = MAX_DIMENSION / longest
  return {
    targetWidth: Math.round(srcWidth * scale),
    targetHeight: Math.round(srcHeight * scale),
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas.toBlob returned null'))
      },
      type,
      quality,
    )
  })
}
