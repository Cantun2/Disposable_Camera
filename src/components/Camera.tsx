import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyVintageFilter,
  canvasToJpeg,
  FILM_PRESETS,
  getPreset,
  type PresetId,
} from '../utils/filter'
import { uploadPhoto } from '../utils/upload'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  consumeShot,
  getGuestId,
  getRemaining,
  getSavedPreset,
  savePreset,
  PHOTO_LIMIT,
} from '../lib/session'

type Status = 'idle' | 'starting' | 'ready' | 'denied' | 'nocamera' | 'error'
type Facing = 'environment' | 'user'

type Review = { url: string; blob: Blob }

export default function Camera({
  roomId,
  title,
  limit = PHOTO_LIMIT,
}: {
  roomId: string
  title?: string
  limit?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const reviewRef = useRef<Review | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [facing, setFacing] = useState<Facing>('environment')
  const [hasMultiCam, setHasMultiCam] = useState(false)
  const [presetId, setPresetId] = useState<PresetId>(
    () => getPreset(getSavedPreset()).id,
  )
  const [remaining, setRemaining] = useState(() => getRemaining(roomId, limit))
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const empty = remaining <= 0
  const preset = getPreset(presetId)

  // --- Stream lifecycle -----------------------------------------------------
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const startStream = useCallback(
    async (mode: Facing) => {
      stopStream()
      setStatus('starting')
      setErrorMsg('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` is a soft preference — devices with only one camera still
          // resolve instead of throwing OverconstrainedError.
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStatus('ready')

        // Labels are only populated after permission is granted, so detect the
        // number of cameras here to decide whether the flip button is useful.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const cams = devices.filter((d) => d.kind === 'videoinput')
          setHasMultiCam(cams.length > 1)
        } catch {
          /* enumerateDevices unsupported — just hide the flip control */
        }
      } catch (err) {
        const e = err as DOMException
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
          setStatus('denied')
        } else if (
          e.name === 'NotFoundError' ||
          e.name === 'DevicesNotFoundError' ||
          e.name === 'OverconstrainedError'
        ) {
          setStatus('nocamera')
        } else {
          setErrorMsg(e.message || 'Could not start the camera')
          setStatus('error')
        }
      }
    },
    [stopStream],
  )

  // Mount: open the camera. Unmount: ALWAYS release tracks + any preview blob.
  useEffect(() => {
    startStream(facing)
    return () => {
      stopStream()
      if (reviewRef.current) URL.revokeObjectURL(reviewRef.current.url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep a ref in sync so the unmount cleanup can revoke the live preview URL.
  useEffect(() => {
    reviewRef.current = review
  }, [review])

  const flipCamera = useCallback(() => {
    if (busy || saving) return
    const next: Facing = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    startStream(next)
  }, [busy, saving, facing, startStream])

  // --- Preset selection -----------------------------------------------------
  const choosePreset = useCallback((id: PresetId) => {
    setPresetId(id)
    savePreset(id)
  }, [])

  // --- Capture --------------------------------------------------------------
  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || busy || empty || status !== 'ready' || review) return
    if (!video.videoWidth) return // stream not warmed up yet

    setBusy(true)
    setFlash(true)
    if (typeof navigator.vibrate === 'function') navigator.vibrate(30)
    window.setTimeout(() => setFlash(false), 180)

    try {
      // Draw the current frame to canvas with the chosen look baked in.
      const canvas = applyVintageFilter(video, { preset: presetId })
      const blob = await canvasToJpeg(canvas, 0.85)
      // Hold it for a confirm/retake step — nothing is uploaded or spent yet.
      setReview({ url: URL.createObjectURL(blob), blob })
    } catch (err) {
      console.error(err)
      setErrorMsg('Could not process the photo — try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, empty, status, review, presetId])

  const discardReview = useCallback(() => {
    setReview((cur) => {
      if (cur) URL.revokeObjectURL(cur.url)
      return null
    })
  }, [])

  const retake = useCallback(() => {
    if (saving) return
    discardReview()
  }, [saving, discardReview])

  // Save the reviewed shot to the guest's phone (no backend needed).
  const downloadShot = useCallback(() => {
    if (!review) return
    const a = document.createElement('a')
    a.href = review.url
    a.download = `wedding-${roomId}-${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [review, roomId])

  // Confirm: upload, spend a shot, return to the viewfinder.
  const keepShot = useCallback(async () => {
    if (!review || saving) return
    if (!isSupabaseConfigured) {
      setErrorMsg(
        'Supabase isn’t configured — add your keys to .env.local to save to the gallery. You can still download the shot.',
      )
      return
    }
    setSaving(true)
    setErrorMsg('')
    try {
      await uploadPhoto({ blob: review.blob, roomId, guestId: getGuestId() })
      setRemaining(consumeShot(roomId))
      discardReview()
    } catch (err) {
      console.error(err)
      setErrorMsg('Upload failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }, [review, saving, roomId, discardReview])

  // --- UI -------------------------------------------------------------------
  const mirror = facing === 'user'

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      {/* Viewfinder. The CSS filter here is a live PREVIEW of the look;
          the same look is baked in at higher fidelity at capture time. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="grain absolute inset-0 h-full w-full object-cover"
        style={{
          filter: preset.css,
          transform: mirror ? 'scaleX(-1)' : undefined,
        }}
      />

      {/* Shutter flash */}
      <div
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${
          flash ? 'opacity-80' : 'opacity-0'
        }`}
      />

      {/* Permission / state overlays */}
      {(status === 'denied' ||
        status === 'error' ||
        status === 'nocamera' ||
        status === 'starting') && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-navy/95 px-8 text-center">
          {status === 'starting' && (
            <p className="animate-pulse font-serif text-2xl text-gold">
              Opening camera…
            </p>
          )}
          {status === 'denied' && (
            <>
              <p className="font-serif text-2xl text-gold">Camera blocked</p>
              <p className="text-sm text-gold-300/70">
                Allow camera access in your browser settings, then tap below.
              </p>
              <button
                onClick={() => startStream(facing)}
                className="rounded-full border border-gold px-6 py-2 text-gold transition active:scale-95"
              >
                Try again
              </button>
            </>
          )}
          {status === 'nocamera' && (
            <>
              <p className="font-serif text-2xl text-gold">No camera found</p>
              <p className="text-sm text-gold-300/70">
                We couldn’t find a camera on this device.
              </p>
              <button
                onClick={() => startStream(facing)}
                className="rounded-full border border-gold px-6 py-2 text-gold transition active:scale-95"
              >
                Try again
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="font-serif text-2xl text-gold">
                Something went wrong
              </p>
              <p className="text-sm text-gold-300/70">{errorMsg}</p>
              <button
                onClick={() => startStream(facing)}
                className="rounded-full border border-gold px-6 py-2 text-gold transition active:scale-95"
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {/* Top bar: title + remaining counter */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="font-serif text-lg tracking-wide text-gold-300/90">
          {title ?? roomId.replace(/-/g, ' ')}
        </span>
        <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-medium text-gold backdrop-blur">
          {remaining} / {limit} left
        </span>
      </div>

      {/* Transient upload/processing error toast */}
      {errorMsg && status === 'ready' && (
        <div className="absolute left-1/2 top-20 z-20 w-[88%] max-w-sm -translate-x-1/2 rounded-lg bg-red-900/85 px-4 py-2 text-center text-xs text-white shadow-lg">
          {errorMsg}
        </div>
      )}

      {/* Bottom controls: filter picker + shutter row */}
      {status === 'ready' && !review && (
        <div className="absolute bottom-0 left-0 right-0 z-10 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {empty ? (
            <div className="px-8 pb-4 text-center">
              <p className="font-serif text-2xl text-gold">
                Your roll is finished 🎞️
              </p>
              <p className="mt-1 text-sm text-gold-300/70">
                Thank you for capturing the day. Open the gallery to see every
                shot.
              </p>
            </div>
          ) : (
            <>
              {/* Film preset selector */}
              <div className="mb-5 flex justify-center px-3">
                <div className="flex max-w-full gap-2 overflow-x-auto rounded-full bg-black/40 px-2 py-2 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none]">
                  {FILM_PRESETS.map((p) => {
                    const active = p.id === presetId
                    return (
                      <button
                        key={p.id}
                        onClick={() => choosePreset(p.id)}
                        aria-pressed={active}
                        className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition active:scale-95 ${
                          active
                            ? 'bg-gold font-medium text-navy'
                            : 'text-gold-300/80 hover:text-gold'
                        }`}
                      >
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Shutter row: shutter centered, flip on the right */}
              <div className="relative flex items-center justify-center">
                <button
                  aria-label="Take photo"
                  onClick={capture}
                  disabled={busy}
                  className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-gold/90 bg-transparent shadow-[0_0_25px_rgba(212,175,55,0.25)] transition active:scale-90 disabled:opacity-50"
                >
                  <span
                    className={`rounded-full bg-gold transition-all duration-150 ${
                      busy ? 'h-10 w-10 opacity-70' : 'h-16 w-16'
                    }`}
                  />
                </button>

                {hasMultiCam && (
                  <button
                    aria-label="Flip camera"
                    onClick={flipCamera}
                    disabled={busy}
                    className="absolute right-8 flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-gold backdrop-blur transition active:scale-90 disabled:opacity-50"
                  >
                    <FlipIcon />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Post-shot review: confirm / retake / download */}
      {review && (
        <div className="absolute inset-0 z-40 flex flex-col bg-navy/95">
          <div className="flex flex-1 items-center justify-center p-4">
            <img
              src={review.url}
              alt="Your shot"
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>

          {errorMsg && (
            <p className="px-6 pb-2 text-center text-xs text-red-300">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2">
            <button
              onClick={retake}
              disabled={saving}
              className="rounded-full border border-gold/70 px-6 py-3 text-gold transition active:scale-95 disabled:opacity-50"
            >
              Retake
            </button>
            <button
              onClick={downloadShot}
              disabled={saving}
              aria-label="Save to phone"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold-300 transition active:scale-95 disabled:opacity-50"
            >
              <DownloadIcon />
            </button>
            <button
              onClick={keepShot}
              disabled={saving}
              className="flex-1 rounded-full bg-gold px-6 py-3 font-medium text-navy shadow-lg transition active:scale-95 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Keep it'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FlipIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 9a8 8 0 0 0-14-3.5L3 8" />
      <path d="M3 4v4h4" />
      <path d="M4 15a8 8 0 0 0 14 3.5L21 16" />
      <path d="M21 20v-4h-4" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}
