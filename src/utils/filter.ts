// Client-side "disposable camera" colorimetry. Runs entirely on-device — the
// server never sees a raw frame. The pipeline is:
//   1. ctx.filter for cheap, GPU-accelerated tone (contrast/saturation/warmth)
//   2. a per-pixel warm curve + subtle channel shift for the analog cast
//   3. additive film grain
//   4. a radial vignette
//
// Tuned to be fast enough to run once per shutter press on a mid-range phone.

export type CaptureSource =
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap

function sourceSize(src: CaptureSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) {
    return { w: src.videoWidth, h: src.videoHeight }
  }
  return { w: src.width, h: src.height }
}

/**
 * Draw `src` to an offscreen canvas with the vintage film look applied.
 * Returns the canvas so the caller can export it to a Blob.
 */
export function applyVintageFilter(
  src: CaptureSource,
  opts: { maxEdge?: number } = {},
): HTMLCanvasElement {
  const { w, h } = sourceSize(src)
  const maxEdge = opts.maxEdge ?? 1440

  // Downscale very large frames to keep upload size and processing time sane.
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  // 1. Tone pass — warm, punchy, slightly faded blacks.
  ctx.filter =
    'contrast(1.12) saturate(1.18) sepia(0.18) brightness(1.04) hue-rotate(-6deg)'
  ctx.drawImage(src, 0, 0, width, height)
  ctx.filter = 'none'

  // 2. Per-pixel warm cast + faded shadows (lift blacks like cheap film).
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    // warm: push red, pull blue a touch
    d[i] = clamp(d[i] * 1.06 + 6) // R
    d[i + 1] = clamp(d[i + 1] * 1.01 + 2) // G
    d[i + 2] = clamp(d[i + 2] * 0.92) // B
    // lift the very bottom of the curve for a milky-shadow film feel
    d[i] = clamp(d[i] + 8 * (1 - d[i] / 255))
    d[i + 1] = clamp(d[i + 1] + 6 * (1 - d[i + 1] / 255))
    d[i + 2] = clamp(d[i + 2] + 4 * (1 - d[i + 2] / 255))
  }

  // 3. Film grain — additive monochrome noise.
  const grain = 14
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * grain
    d[i] = clamp(d[i] + n)
    d[i + 1] = clamp(d[i + 1] + n)
    d[i + 2] = clamp(d[i + 2] + n)
  }
  ctx.putImageData(img, 0, 0)

  // 4. Vignette — darken the corners with a radial gradient.
  const cx = width / 2
  const cy = height / 2
  const grd = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.35,
    cx,
    cy,
    Math.max(width, height) * 0.75,
  )
  grd.addColorStop(0, 'rgba(0,0,0,0)')
  grd.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, width, height)

  return canvas
}

/** Export a canvas to a JPEG Blob at the given quality (default 0.8). */
export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = 0.8,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    )
  })
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
