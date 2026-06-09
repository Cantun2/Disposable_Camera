import { useCallback, useEffect, useRef, useState } from 'react'
import { applyVintageFilter, canvasToJpeg } from '../utils/filter'
import { uploadPhoto } from '../utils/upload'
import { consumeShot, getGuestId, getRemaining, PHOTO_LIMIT } from '../lib/session'

type Status = 'idle' | 'starting' | 'ready' | 'denied' | 'error'

export default function Camera({ roomId }: { roomId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [remaining, setRemaining] = useState(() => getRemaining(roomId))
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const empty = remaining <= 0

  // --- Stream lifecycle -----------------------------------------------------
  const startStream = useCallback(async () => {
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // rear camera by default
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
    } catch (err) {
      const e = err as DOMException
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        setStatus('denied')
      } else {
        setErrorMsg(e.message || 'Could not start the camera')
        setStatus('error')
      }
    }
  }, [])

  useEffect(() => {
    startStream()
    return () => {
      // Always release the camera when leaving the view.
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [startStream])

  // --- Capture --------------------------------------------------------------
  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || busy || empty || status !== 'ready') return
    if (!video.videoWidth) return // stream not warmed up yet

    setBusy(true)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)

    try {
      // 1. Draw the current frame to canvas + apply the vintage filter.
      const canvas = applyVintageFilter(video)
      // 2. Encode to JPEG @ 0.8.
      const blob = await canvasToJpeg(canvas, 0.8)
      // 3. Upload + DB insert (no server-side processing).
      await uploadPhoto({ blob, roomId, guestId: getGuestId() })
      // 4. Decrement the local budget.
      setRemaining(consumeShot(roomId))
    } catch (err) {
      console.error(err)
      setErrorMsg('Upload failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, empty, status, roomId])

  // --- UI -------------------------------------------------------------------
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      {/* Viewfinder. The CSS filter here is a live PREVIEW of the look;
          the real, higher-fidelity filter is baked in at capture time. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="grain absolute inset-0 h-full w-full object-cover"
        style={{
          filter: 'contrast(1.12) saturate(1.18) sepia(0.18) brightness(1.04)',
        }}
      />

      {/* Shutter flash */}
      <div
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${
          flash ? 'opacity-80' : 'opacity-0'
        }`}
      />

      {/* Permission / error overlays */}
      {(status === 'denied' || status === 'error' || status === 'starting') && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-navy/95 px-8 text-center">
          {status === 'starting' && (
            <p className="font-serif text-2xl text-gold">Opening camera…</p>
          )}
          {status === 'denied' && (
            <>
              <p className="font-serif text-2xl text-gold">Camera blocked</p>
              <p className="text-sm text-gold-300/70">
                Allow camera access in your browser settings, then reload.
              </p>
              <button
                onClick={startStream}
                className="rounded-full border border-gold px-6 py-2 text-gold"
              >
                Try again
              </button>
            </>
          )}
          {status === 'error' && (
            <p className="text-sm text-gold-300/70">{errorMsg}</p>
          )}
        </div>
      )}

      {/* Top bar: counter */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="font-serif text-lg tracking-wide text-gold-300/90">
          {roomId.replace(/-/g, ' ')}
        </span>
        <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-medium text-gold backdrop-blur">
          {remaining} / {PHOTO_LIMIT} left
        </span>
      </div>

      {/* Transient upload error toast */}
      {errorMsg && status === 'ready' && (
        <div className="absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded bg-red-900/80 px-4 py-2 text-xs text-white">
          {errorMsg}
        </div>
      )}

      {/* Bottom bar: shutter */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        {empty ? (
          <div className="px-8 text-center">
            <p className="font-serif text-2xl text-gold">Your roll is finished 🎞️</p>
            <p className="mt-1 text-sm text-gold-300/70">
              Thank you for capturing the day. Open the gallery to see every shot.
            </p>
          </div>
        ) : (
          <button
            aria-label="Take photo"
            onClick={capture}
            disabled={busy || status !== 'ready'}
            className="relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-gold/90 bg-transparent transition active:scale-95 disabled:opacity-50"
          >
            <span
              className={`h-16 w-16 rounded-full bg-gold transition ${
                busy ? 'scale-75 opacity-60' : 'scale-100'
              }`}
            />
          </button>
        )}
      </div>
    </div>
  )
}
