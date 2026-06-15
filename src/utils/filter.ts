// Client-side "disposable camera" colorimetry. Runs entirely on-device — the
// server never sees a raw frame. The pipeline for every preset is:
//   1. ctx.filter for cheap, GPU-accelerated tone (contrast/saturation/warmth)
//   2. a single per-pixel pass: optional desaturation, a channel curve + shadow
//      lift for the analog cast, and additive film grain — all in ONE loop so
//      we only touch each pixel once (the loop is the expensive part)
//   3. a radial vignette
//
// Tuned to be fast enough to run once per shutter press on a mid-range phone.
// Adding a preset costs nothing extra at runtime — it's just a parameter set.

export type CaptureSource =
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap

export type PresetId =
  | 'classic'
  | 'warm90s'
  | 'faded'
  | 'sunwashed'
  | 'bw'

/** A named film look. `css` is reused verbatim for BOTH the canvas tone pass
 *  and the live `<video>` preview, so what guests see matches what's baked in. */
export interface FilmPreset {
  id: PresetId
  name: string
  /** CSS filter string — canvas `ctx.filter` + live preview share this. */
  css: string
  /** Per-channel [multiply, add] applied in the per-pixel pass. */
  r: [number, number]
  g: [number, number]
  b: [number, number]
  /** Shadow lift per channel — bigger = milkier, more faded blacks. */
  lift: [number, number, number]
  /** Additive monochrome grain amplitude (0 = none). */
  grain: number
  /** Max corner darkness of the vignette, 0..1. */
  vignette: number
  /** Collapse to luminance before the channel curve (black & white). */
  mono?: boolean
}

export const FILM_PRESETS: FilmPreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    css: 'contrast(1.12) saturate(1.18) sepia(0.18) brightness(1.04) hue-rotate(-6deg)',
    r: [1.06, 6],
    g: [1.01, 2],
    b: [0.92, 0],
    lift: [8, 6, 4],
    grain: 14,
    vignette: 0.45,
  },
  {
    id: 'warm90s',
    name: 'Warm 90s',
    css: 'contrast(1.15) saturate(1.3) sepia(0.3) brightness(1.05) hue-rotate(-10deg)',
    r: [1.1, 10],
    g: [1.02, 4],
    b: [0.85, 0],
    lift: [10, 7, 3],
    grain: 12,
    vignette: 0.4,
  },
  {
    id: 'faded',
    name: 'Faded',
    css: 'contrast(0.9) saturate(0.88) sepia(0.12) brightness(1.08)',
    r: [0.98, 6],
    g: [0.98, 6],
    b: [1.0, 8],
    lift: [24, 22, 20],
    grain: 16,
    vignette: 0.22,
  },
  {
    id: 'sunwashed',
    name: 'Sunwashed',
    css: 'contrast(1.04) saturate(1.22) sepia(0.24) brightness(1.13) hue-rotate(-12deg)',
    r: [1.12, 14],
    g: [1.04, 7],
    b: [0.9, 2],
    lift: [14, 10, 6],
    grain: 10,
    vignette: 0.18,
  },
  {
    id: 'bw',
    name: 'B&W',
    css: 'grayscale(1) contrast(1.18) brightness(1.04) sepia(0.05)',
    r: [1.0, 4],
    g: [1.0, 4],
    b: [1.0, 4],
    lift: [10, 10, 10],
    grain: 18,
    vignette: 0.5,
    mono: true,
  },
]

export const DEFAULT_PRESET_ID: PresetId = 'classic'

const PRESET_BY_ID: Record<PresetId, FilmPreset> = FILM_PRESETS.reduce(
  (acc, p) => {
    acc[p.id] = p
    return acc
  },
  {} as Record<PresetId, FilmPreset>,
)

/** Resolve a preset by id, falling back to the default for unknown values. */
export function getPreset(id: string | null | undefined): FilmPreset {
  return (id && PRESET_BY_ID[id as PresetId]) || PRESET_BY_ID[DEFAULT_PRESET_ID]
}

function sourceSize(src: CaptureSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) {
    return { w: src.videoWidth, h: src.videoHeight }
  }
  return { w: src.width, h: src.height }
}

/**
 * Draw `src` to an offscreen canvas with the chosen film look applied.
 * Returns the canvas so the caller can export it to a Blob.
 */
export function applyVintageFilter(
  src: CaptureSource,
  opts: { maxEdge?: number; preset?: PresetId | FilmPreset } = {},
): HTMLCanvasElement {
  const { w, h } = sourceSize(src)
  const maxEdge = opts.maxEdge ?? 1440
  const preset =
    typeof opts.preset === 'object'
      ? opts.preset
      : getPreset(opts.preset)

  // Downscale very large frames to keep upload size and processing time sane.
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  // 1. Tone pass — cheap, GPU-accelerated. Same string drives the live preview.
  ctx.filter = preset.css
  ctx.drawImage(src, 0, 0, width, height)
  ctx.filter = 'none'

  // 2. Single per-pixel pass: desaturate (optional) + channel curve + shadow
  //    lift + grain. One loop = each pixel touched once.
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const [rm, ra] = preset.r
  const [gm, ga] = preset.g
  const [bm, ba] = preset.b
  const [lr, lg, lb] = preset.lift
  const grain = preset.grain
  const mono = preset.mono === true

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]
    let g = d[i + 1]
    let b = d[i + 2]

    if (mono) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      r = lum
      g = lum
      b = lum
    }

    r = r * rm + ra
    g = g * gm + ga
    b = b * bm + ba

    // Lift the bottom of the curve for a milky-shadow film feel.
    r += lr * (1 - r / 255)
    g += lg * (1 - g / 255)
    b += lb * (1 - b / 255)

    if (grain) {
      const n = (Math.random() - 0.5) * grain
      r += n
      g += n
      b += n
    }

    d[i] = clamp(r)
    d[i + 1] = clamp(g)
    d[i + 2] = clamp(b)
  }
  ctx.putImageData(img, 0, 0)

  // 3. Vignette — darken the corners with a radial gradient.
  if (preset.vignette > 0) {
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
    grd.addColorStop(1, `rgba(0,0,0,${preset.vignette})`)
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, width, height)
  }

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
