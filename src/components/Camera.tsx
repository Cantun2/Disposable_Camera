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

// How long the freshly shot Polaroid stays on screen "developing" before it
// files itself into the gallery and the viewfinder returns. The upload happens
// in the background during this window.
const DEVELOP_MS = 5000

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
  const developUrlRef = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [facing, setFacing] = useState<Facing>('environment')
  const [hasMultiCam, setHasMultiCam] = useState(false)
  const [presetId, setPresetId] = useState<PresetId>(
    () => getPreset(getSavedPreset()).id,
  )
  const [remaining, setRemaining] = useState(() => getRemaining(roomId, limit))
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const [develop, setDevelop] = useState<string | null>(null) // object URL on screen
  const [leaving, setLeaving] = useState(false) // play the "file into gallery" exit
  const [errorMsg, setErrorMsg] = useState('')

  const empty = remaining <= 0
  const preset = getPreset(presetId)
  const eventName = title ?? roomId.replace(/-/g, ' ')

  useEffect(() => {
    injectCameraStyles()
  }, [])

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
          // `ideal` is a soft preference — single-camera devices still resolve
          // instead of throwing OverconstrainedError.
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

        // Labels only populate after permission, so detect camera count here to
        // decide whether the flip button is useful.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices()
          setHasMultiCam(devices.filter((d) => d.kind === 'videoinput').length > 1)
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
      if (developUrlRef.current) URL.revokeObjectURL(developUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flipCamera = useCallback(() => {
    if (busy) return
    const next: Facing = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    startStream(next)
  }, [busy, facing, startStream])

  const choosePreset = useCallback((id: PresetId) => {
    setPresetId(id)
    savePreset(id)
  }, [])

  // --- Capture: shoot -> develop on a Polaroid (5s) -> file into gallery -----
  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || busy || empty || status !== 'ready' || develop) return
    if (!video.videoWidth) return // stream not warmed up yet

    setBusy(true)
    setFlash(true)
    setErrorMsg('')
    if (typeof navigator.vibrate === 'function') navigator.vibrate(30)
    window.setTimeout(() => setFlash(false), 180)

    let url: string | null = null
    try {
      // Bake the chosen film look into the frame (all client-side).
      const canvas = applyVintageFilter(video, { preset: presetId })
      const blob = await canvasToJpeg(canvas, 0.85)
      url = URL.createObjectURL(blob)
      developUrlRef.current = url
      setLeaving(false)
      setDevelop(url) // eject the Polaroid

      // Upload runs WHILE the Polaroid develops — no extra wait for the guest.
      const minShow = new Promise<void>((r) =>
        window.setTimeout(r, DEVELOP_MS - 500),
      )
      const upload = (async () => {
        if (!isSupabaseConfigured) throw new Error('unconfigured')
        await uploadPhoto({ blob, roomId, guestId: getGuestId() })
        setRemaining(consumeShot(roomId)) // only spend a shot on a real save
      })()

      const [, up] = await Promise.allSettled([minShow, upload])
      if (up.status === 'rejected') {
        setErrorMsg(
          (up.reason as Error)?.message === 'unconfigured'
            ? 'Shown on screen only — gallery backend isn’t configured.'
            : 'Upload failed — check your connection and try again.',
        )
      }

      // File it away into the gallery, then return to the viewfinder.
      setLeaving(true)
      await new Promise<void>((r) => window.setTimeout(r, 520))
    } catch (err) {
      console.error(err)
      setErrorMsg('Could not process the photo — try again.')
    } finally {
      if (url) URL.revokeObjectURL(url)
      developUrlRef.current = null
      setDevelop(null)
      setLeaving(false)
      setBusy(false)
    }
  }, [busy, empty, status, develop, presetId, roomId])

  // --- UI -------------------------------------------------------------------
  const mirror = facing === 'user'
  const overlay =
    status === 'starting' ||
    status === 'denied' ||
    status === 'nocamera' ||
    status === 'error'

  return (
    <div className="cam-body relative flex h-dvh w-full flex-col overflow-hidden">
      {/* Top plate: engraved nameplate + exposure counter window */}
      <div className="relative z-10 flex items-center gap-3 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
        <div className="cam-plate min-w-0 flex-1 rounded-md px-3 py-1.5">
          <p className="truncate font-serif text-base font-semibold tracking-[0.18em] text-[#3a2c10]">
            {eventName.toUpperCase()}
          </p>
        </div>
        <div className="cam-counter flex shrink-0 items-baseline gap-1 rounded-md px-2.5 py-1">
          <span className="font-mono text-xl font-bold leading-none">{remaining}</span>
          <span className="text-[10px] uppercase tracking-wide opacity-70">exp</span>
        </div>
      </div>

      {/* Viewfinder window */}
      <div className="cam-window relative mx-3 flex-1 overflow-hidden rounded-2xl">
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

        {/* Rangefinder corner brackets */}
        {!overlay && <Brackets />}

        {/* Permission / state overlays (inside the viewfinder) */}
        {overlay && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            {status === 'starting' && (
              <p className="animate-pulse font-serif text-2xl text-gold">Opening camera…</p>
            )}
            {status === 'denied' && (
              <>
                <p className="font-serif text-2xl text-gold">Camera blocked</p>
                <p className="text-sm text-gold-300/70">
                  Allow camera access in your browser settings, then tap below.
                </p>
                <TryAgain onClick={() => startStream(facing)} />
              </>
            )}
            {status === 'nocamera' && (
              <>
                <p className="font-serif text-2xl text-gold">No camera found</p>
                <p className="text-sm text-gold-300/70">
                  We couldn’t find a camera on this device.
                </p>
                <TryAgain onClick={() => startStream(facing)} />
              </>
            )}
            {status === 'error' && (
              <>
                <p className="font-serif text-2xl text-gold">Something went wrong</p>
                <p className="text-sm text-gold-300/70">{errorMsg}</p>
                <TryAgain onClick={() => startStream(facing)} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Transient error toast (when the viewfinder is live) */}
      {errorMsg && status === 'ready' && !develop && (
        <div className="absolute left-1/2 top-24 z-30 w-[88%] max-w-sm -translate-x-1/2 rounded-lg bg-red-900/85 px-4 py-2 text-center text-xs text-white shadow-lg">
          {errorMsg}
        </div>
      )}

      {/* Bottom control deck (extra bottom padding clears the gallery tab bar) */}
      <div className="relative z-10 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+4.25rem)]">
        {empty ? (
          <div className="px-6 text-center">
            <p className="font-serif text-2xl text-gold">Your roll is finished 🎞️</p>
            <p className="mt-1 text-sm text-gold-300/70">
              Thank you for capturing the day. Open the gallery to see every shot.
            </p>
          </div>
        ) : (
          <>
            {/* Film dial */}
            <div className="mb-4 flex justify-center">
              <div className="cam-dial flex max-w-full gap-1 overflow-x-auto rounded-full px-1.5 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none]">
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

            {/* Shutter row: faux film knob (left), shutter (center), flip (right) */}
            <div className="relative flex items-center justify-center">
              <div className="cam-knob absolute left-6 h-11 w-11 rounded-full" aria-hidden="true" />

              <button
                aria-label="Take photo"
                onClick={capture}
                disabled={busy}
                className="cam-shutter disabled:opacity-60"
              >
                <span className={`cam-shutter-core ${busy ? 'busy' : ''}`} />
              </button>

              {hasMultiCam && (
                <button
                  aria-label="Flip camera"
                  onClick={flipCamera}
                  disabled={busy}
                  className="cam-knob absolute right-6 flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-50"
                >
                  <FlipIcon />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Polaroid: develops for 5s, then flies into the gallery */}
      {develop && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-8">
          <figure className={`cam-polaroid ${leaving ? 'cam-polaroid-leaving' : ''}`}>
            <div className="cam-polaroid-frame">
              <div className="cam-polaroid-photo">
                <img
                  src={develop}
                  alt="Your shot"
                  className="cam-developing h-full w-full object-cover"
                />
              </div>
              <figcaption className="cam-polaroid-caption">{eventName}</figcaption>
            </div>
          </figure>
        </div>
      )}
    </div>
  )
}

function TryAgain({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-gold px-6 py-2 text-gold transition active:scale-95"
    >
      Try again
    </button>
  )
}

function Brackets() {
  const base =
    'pointer-events-none absolute h-7 w-7 border-gold/70'
  return (
    <>
      <div className={`${base} left-3 top-3 border-l-2 border-t-2`} />
      <div className={`${base} right-3 top-3 border-r-2 border-t-2`} />
      <div className={`${base} bottom-3 left-3 border-b-2 border-l-2`} />
      <div className={`${base} bottom-3 right-3 border-b-2 border-r-2`} />
    </>
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

// One-time injection of the vintage-camera styling + Polaroid animations.
let cameraStylesInjected = false
function injectCameraStyles() {
  if (cameraStylesInjected || typeof document === 'undefined') return
  cameraStylesInjected = true
  const el = document.createElement('style')
  el.id = 'camera-vintage-styles'
  el.textContent = CAMERA_CSS
  document.head.appendChild(el)
}

const CAMERA_CSS = `
.cam-body{
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(212,175,55,.10), transparent 55%),
    linear-gradient(170deg,#2a2622 0%,#1a1714 45%,#0e0c0a 100%);
}
.cam-body::before{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.10;
  mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='l'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23l)'/%3E%3C/svg%3E");
}
.cam-plate{
  background:linear-gradient(180deg,#e8cf8f 0%,#caa45a 40%,#9c7c34 75%,#806328 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 4px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.45);
}
.cam-counter{
  background:#15120f; color:#ffcf6b; border:1px solid rgba(255,207,107,.25);
  box-shadow:inset 0 2px 6px rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.06);
}
.cam-window{
  background:#000;
  box-shadow:inset 0 0 0 3px rgba(0,0,0,.7), inset 0 0 0 5px rgba(212,175,55,.28), 0 8px 22px rgba(0,0,0,.55);
}
.cam-dial{
  background:rgba(0,0,0,.45); border:1px solid rgba(212,175,55,.18);
  -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
}
.cam-dial::-webkit-scrollbar{ display:none; }
.cam-knob{
  background:radial-gradient(circle at 50% 32%, #dadada, #9a9a9a 55%, #565656 100%);
  color:#2a2620;
  box-shadow:inset 0 1px 1px rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.5);
}
.cam-shutter{
  height:5rem; width:5rem; border-radius:9999px;
  display:flex; align-items:center; justify-content:center;
  background:radial-gradient(circle at 50% 28%, #fdfdfd, #d2d2d2 38%, #9a9a9a 66%, #6d6d6d 100%);
  box-shadow:0 5px 12px rgba(0,0,0,.55), inset 0 2px 2px rgba(255,255,255,.85), inset 0 -3px 7px rgba(0,0,0,.45);
  transition:transform .12s;
}
.cam-shutter:active{ transform:scale(.93); }
.cam-shutter-core{
  height:3.4rem; width:3.4rem; border-radius:9999px;
  background:radial-gradient(circle at 50% 35%, #f0d77f, #d4af37 45%, #9c7c34 100%);
  box-shadow:inset 0 1px 2px rgba(255,255,255,.6), inset 0 -2px 4px rgba(0,0,0,.45);
  transition:transform .15s, opacity .15s;
}
.cam-shutter-core.busy{ transform:scale(.55); opacity:.7; }

@keyframes cam-eject{
  0%{ transform:translateY(30px) rotate(2deg) scale(.9); opacity:0 }
  60%{ opacity:1 }
  100%{ transform:none; opacity:1 }
}
.cam-polaroid{ animation:cam-eject .5s cubic-bezier(.2,.85,.25,1) both; }
.cam-polaroid-leaving{
  transition:transform .5s cubic-bezier(.45,0,.85,.4), opacity .5s ease-in;
  transform:translateY(62vh) scale(.22) rotate(-7deg); opacity:0;
}
.cam-polaroid-frame{
  width:min(78vw,340px);
  background:#fbfbf7; padding:.7rem .7rem 2.5rem; border-radius:3px;
  box-shadow:0 20px 44px rgba(0,0,0,.6), 0 2px 4px rgba(0,0,0,.3);
}
.cam-polaroid-photo{
  position:relative; width:100%; aspect-ratio:1/1; overflow:hidden; background:#0d0d0d;
}
@keyframes cam-develop{
  0%{ filter:brightness(1.9) contrast(.35) saturate(.2) sepia(.35); opacity:.65 }
  35%{ opacity:1 }
  100%{ filter:brightness(1) contrast(1) saturate(1) sepia(0); opacity:1 }
}
.cam-developing{ animation:cam-develop 3.2s ease-out both; }
.cam-polaroid-caption{
  position:absolute; left:0; right:0; bottom:.7rem; text-align:center;
  font-family:'Cormorant Garamond',Georgia,serif; color:#5b5346;
  font-size:1.05rem; letter-spacing:.04em; text-transform:capitalize;
}
`
