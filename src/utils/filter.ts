// Client-side "disposable camera" colorimetry. Runs entirely on-device — the
// server never sees a raw frame. The pipeline for every preset is:
//   1. ctx.filter for cheap, GPU-accelerated tone (shared with the live preview)
//   2. (optional) AUTO-BALANCE — analyse the frame and normalise exposure +
//      white balance so every photo comes out evenly lit, regardless of the
//      room's lighting. This is what makes shots look consistently "right".
//   3. a single per-pixel pass: white-balance + auto-levels + channel curve +
//      shadow lift + split-tone + grain — all in ONE loop (touch each pixel once)
//   4. a "flash" highlight bloom + a radial vignette
//
// Tuned to run once per shutter press on a mid-range phone.

export type CaptureSource =
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap

export type PresetId =
  | 'polaroid'
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
  /** Analyse each frame and auto-correct exposure + white balance first. */
  autoBalance?: boolean
  /** Strength of the centred "flash" highlight bloom, 0..1 (0 = none). */
  flash?: number
  /** Split-tone tints added to shadows / highlights, signed RGB. */
  splitShadow?: [number, number, number]
  splitHighlight?: [number, number, number]
}

export const FILM_PRESETS: FilmPreset[] = [
  {
    // The headline look: a balanced, true-to-life Polaroid with flash.
    id: 'polaroid',
    name: 'Polaroid',
    css: 'contrast(0.92) saturate(1.06) brightness(1.06) sepia(0.10)',
    r: [1.0, 4],
    g: [1.0, 2],
    b: [0.98, 2],
    lift: [14, 12, 10],
    grain: 9,
    vignette: 0.32,
    autoBalance: true,
    flash: 0.5,
    splitShadow: [-9, 1, 11], // cool, slightly teal shadows
    splitHighlight: [12, 6, -8], // warm, creamy highlights
  },
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

export const DEFAULT_PRESET_ID: PresetId = 'polaroid'

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

type Balance = {
  // per-channel white-balance gains
  gr: number
  gg: number
  gb: number
  // auto-levels mapping: out = (in - black) * scale + LIFTED_BLACK
  black: number
  scale: number
}

const LUMA = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b

// Analyse a subsample of the frame to derive exposure + white-balance fixes.
// Subsampling (every 4th pixel) keeps this cheap on phones.
function analyseBalance(d: Uint8ClampedArray): Balance {
  const hist = new Uint32Array(256)
  let sr = 0
  let sg = 0
  let sb = 0
  let count = 0
  const step = 16 // 4 px * 4 channels

  for (let i = 0; i < d.length; i += step) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    hist[LUMA(r, g, b) | 0]++
    sr += r
    sg += g
    sb += b
    count++
  }
  if (count === 0) return { gr: 1, gg: 1, gb: 1, black: 0, scale: 1 }

  // Black / white points from the 0.5% / 99.5% luminance percentiles, so a few
  // stray bright or dark pixels don't wreck the stretch.
  const lo = count * 0.005
  const hi = count * 0.995
  let acc = 0
  let bp = 0
  let wp = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= lo) {
      bp = v
      break
    }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= hi) {
      wp = v
      break
    }
  }

  // Auto-levels: stretch [bp, wp] -> [~10, ~245]. Cap the gain so low-contrast
  // frames get a lift without amplifying noise to extremes.
  const span = Math.max(24, wp - bp)
  const scale = Math.min(1.8, 235 / span)

  // Gray-world white balance, applied at partial strength so we neutralise a
  // colour cast without fully bleaching intentional warmth.
  const avgR = sr / count
  const avgG = sg / count
  const avgB = sb / count
  const gray = (avgR + avgG + avgB) / 3
  const STRENGTH = 0.6
  const gain = (avg: number) => {
    const raw = avg > 1 ? gray / avg : 1
    const clamped = Math.min(1.25, Math.max(0.8, raw))
    return 1 + (clamped - 1) * STRENGTH
  }

  return { gr: gain(avgR), gg: gain(avgG), gb: gain(avgB), black: bp, scale }
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
    typeof opts.preset === 'object' ? opts.preset : getPreset(opts.preset)

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

  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data

  // 2. Optional analysis for exposure + white-balance normalisation.
  const bal = preset.autoBalance ? analyseBalance(d) : null
  const LIFTED_BLACK = 8 // never crush to pure black — film keeps milky shadows

  // 3. Single per-pixel pass.
  const [rm, ra] = preset.r
  const [gm, ga] = preset.g
  const [bm, ba] = preset.b
  const [lr, lg, lb] = preset.lift
  const grain = preset.grain
  const mono = preset.mono === true
  const ss = preset.splitShadow
  const sh = preset.splitHighlight

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]
    let g = d[i + 1]
    let b = d[i + 2]

    // 3a. Auto white-balance + auto-levels (per analysed frame).
    if (bal) {
      r *= bal.gr
      g *= bal.gg
      b *= bal.gb
      r = (r - bal.black) * bal.scale + LIFTED_BLACK
      g = (g - bal.black) * bal.scale + LIFTED_BLACK
      b = (b - bal.black) * bal.scale + LIFTED_BLACK
    }

    // 3b. Black & white collapse.
    if (mono) {
      const lum = LUMA(r, g, b)
      r = lum
      g = lum
      b = lum
    }

    // 3c. Creative channel curve.
    r = r * rm + ra
    g = g * gm + ga
    b = b * bm + ba

    // 3d. Shadow lift — milky film blacks.
    r += lr * (1 - r / 255)
    g += lg * (1 - g / 255)
    b += lb * (1 - b / 255)

    // 3e. Split-tone: tint shadows one way, highlights the other.
    if (ss && sh) {
      const t = LUMA(r, g, b) / 255 // 0 = shadow, 1 = highlight
      const it = 1 - t
      r += ss[0] * it + sh[0] * t
      g += ss[1] * it + sh[1] * t
      b += ss[2] * it + sh[2] * t
    }

    // 3f. Additive monochrome grain.
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

  const cx = width / 2
  const cy = height / 2
  const maxR = Math.max(width, height) * 0.75

  // 4a. Flash bloom — a warm highlight centred slightly high, like an on-camera
  //     flash. `screen` lightens without washing the whole frame flat.
  if (preset.flash && preset.flash > 0) {
    const fg = ctx.createRadialGradient(
      cx,
      cy * 0.82,
      0,
      cx,
      cy * 0.82,
      maxR * 1.1,
    )
    const a = 0.5 * preset.flash
    fg.addColorStop(0, `rgba(255,248,235,${a})`)
    fg.addColorStop(0.55, `rgba(255,248,235,${a * 0.25})`)
    fg.addColorStop(1, 'rgba(255,248,235,0)')
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = fg
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 4b. Vignette — darken the corners.
  if (preset.vignette > 0) {
    const grd = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(width, height) * 0.35,
      cx,
      cy,
      maxR,
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
