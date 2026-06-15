import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhotoRow } from '../lib/supabase'

// Minimal navigator typings for Web Share API (level 2 / files) — keeps us
// off the `any` train without pulling in a polyfill.
type ShareNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
}

type Props = {
  photos: PhotoRow[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
  autoplay?: boolean // open straight into slideshow mode
}

const SWIPE_THRESHOLD = 60 // px of travel before a swipe commits
const CLOSE_THRESHOLD = 110 // px of downward drag before we dismiss
const SLIDESHOW_MS = 4000

// Full-screen, gesture-driven photo viewer. Self-contained: swipe between
// shots, tap to zoom, drag down to dismiss, download / share, and an
// auto-advancing slideshow mode for projecting at the venue.
export default function Lightbox({ photos, index, onIndexChange, onClose, autoplay }: Props) {
  const photo = photos[index]

  const [zoom, setZoom] = useState(false)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [animating, setAnimating] = useState(false)
  const [enterDir, setEnterDir] = useState(0) // -1 prev, 1 next, 0 none
  const [slideshow, setSlideshow] = useState(Boolean(autoplay))
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Gesture bookkeeping kept in a ref so listeners don't churn on every move.
  const gesture = useRef<{ x: number; y: number; axis: '' | 'x' | 'y'; t: number }>({
    x: 0,
    y: 0,
    axis: '',
    t: 0,
  })

  const atFirst = index <= 0
  const atLast = index >= photos.length - 1

  const go = useCallback(
    (dir: -1 | 1) => {
      const next = index + dir
      if (next < 0 || next >= photos.length) return
      setZoom(false)
      setEnterDir(dir)
      onIndexChange(next)
    },
    [index, photos.length, onIndexChange],
  )

  // Keyboard support for desktop / projector use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        setSlideshow((s) => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Slideshow auto-advance. Loops back to the first photo at the end.
  useEffect(() => {
    if (!slideshow) return
    const id = window.setTimeout(() => {
      if (atLast) onIndexChange(0)
      else go(1)
      setEnterDir(1)
    }, SLIDESHOW_MS)
    return () => window.clearTimeout(id)
  }, [slideshow, index, atLast, go, onIndexChange])

  // Clear the entry-animation flag shortly after a slide change.
  useEffect(() => {
    if (!enterDir) return
    const id = window.setTimeout(() => setEnterDir(0), 320)
    return () => window.clearTimeout(id)
  }, [enterDir, index])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  // --- Gestures -------------------------------------------------------------
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1 || zoom) return
    const t = e.touches[0]
    gesture.current = { x: t.clientX, y: t.clientY, axis: '', t: 0 }
    setAnimating(false)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 1 || zoom) return
    const t = e.touches[0]
    const dx = t.clientX - gesture.current.x
    const dy = t.clientY - gesture.current.y
    if (!gesture.current.axis) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        gesture.current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
    }
    if (gesture.current.axis === 'x') {
      // Rubber-band when there's no neighbour in that direction.
      const damp = (dx > 0 && atFirst) || (dx < 0 && atLast) ? 0.3 : 1
      setDrag({ x: dx * damp, y: 0 })
    } else if (gesture.current.axis === 'y' && dy > 0) {
      setDrag({ x: 0, y: dy })
    }
  }

  function onTouchEnd() {
    if (zoom) return
    const { axis } = gesture.current
    setAnimating(true)
    if (axis === 'x') {
      if (drag.x <= -SWIPE_THRESHOLD && !atLast) go(1)
      else if (drag.x >= SWIPE_THRESHOLD && !atFirst) go(-1)
    } else if (axis === 'y' && drag.y >= CLOSE_THRESHOLD) {
      onClose()
      return
    }
    setDrag({ x: 0, y: 0 })
  }

  // Tap toggles a 2× zoom centred on the tap point.
  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    e.stopPropagation()
    if (Math.abs(drag.x) > 4 || Math.abs(drag.y) > 4) return
    const img = e.currentTarget
    const rect = img.getBoundingClientRect()
    const ox = ((e.clientX - rect.left) / rect.width) * 100
    const oy = ((e.clientY - rect.top) / rect.height) * 100
    img.style.transformOrigin = `${ox}% ${oy}%`
    setSlideshow(false)
    setZoom((z) => !z)
  }

  async function handleDownload() {
    if (!photo) return
    setBusy(true)
    try {
      const res = await fetch(photo.photo_url)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      triggerDownload(url, filenameFor(photo))
      URL.revokeObjectURL(url)
      flash('Saved to your device')
    } catch {
      // Cross-origin / offline: fall back to a direct link open.
      triggerDownload(photo.photo_url, filenameFor(photo), true)
      flash('Opening photo…')
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    if (!photo) return
    const nav = navigator as ShareNavigator
    const pageUrl = window.location.href
    setBusy(true)
    try {
      // Best: share the actual image file (iOS/Android share sheet).
      try {
        const res = await fetch(photo.photo_url)
        const blob = await res.blob()
        const file = new File([blob], filenameFor(photo), { type: blob.type })
        if (nav.canShare?.({ files: [file] }) && nav.share) {
          await nav.share({ files: [file], title: 'A moment from the wedding' })
          return
        }
      } catch {
        /* fall through to link sharing */
      }
      if (nav.share) {
        await nav.share({ title: 'Wedding gallery', url: pageUrl })
        return
      }
      await navigator.clipboard.writeText(pageUrl)
      flash('Link copied to clipboard')
    } catch {
      // User dismissed the sheet, or clipboard blocked — stay quiet on abort.
    } finally {
      setBusy(false)
    }
  }

  if (!photo) return null

  // Transform for the live drag / settle of the current slide.
  const dragStyle: React.CSSProperties = {
    transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
    transition: animating ? 'transform 0.25s ease' : 'none',
    opacity: drag.y > 0 ? Math.max(0.3, 1 - drag.y / 400) : 1,
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <StyleOnce />

      {/* Top bar: counter + slideshow toggle + close */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <span className="pointer-events-auto rounded-full bg-black/40 px-3 py-1 text-xs uppercase tracking-[0.2em] text-gold-300/80">
          {index + 1} / {photos.length}
        </span>
        <div className="pointer-events-auto flex items-center gap-2">
          <IconButton
            label={slideshow ? 'Pause slideshow' : 'Start slideshow'}
            onClick={() => setSlideshow((s) => !s)}
            active={slideshow}
          >
            {slideshow ? '❚❚' : '►'}
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            ×
          </IconButton>
        </div>
      </div>

      {/* Stage */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onClick={onClose}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Prev / next arrows (desktop) */}
        {!atFirst && (
          <Arrow side="left" onClick={() => go(-1)} />
        )}
        {!atLast && <Arrow side="right" onClick={() => go(1)} />}

        <img
          key={photo.id}
          src={photo.photo_url}
          alt=""
          draggable={false}
          onClick={onImageClick}
          style={dragStyle}
          className={[
            'max-h-full max-w-full select-none rounded-lg object-contain',
            zoom ? 'scale-[2] cursor-zoom-out' : 'cursor-zoom-in',
            enterDir === 1 ? 'dwc-enter-right' : enterDir === -1 ? 'dwc-enter-left' : '',
            'transition-transform duration-200',
          ].join(' ')}
        />
      </div>

      {/* Bottom bar: metadata + actions */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-8">
        <div className="min-w-0">
          <p className="truncate font-serif text-base text-gold">{formatDate(photo.created_at)}</p>
          <p className="truncate text-[0.7rem] uppercase tracking-[0.15em] text-gold-300/50">
            {relativeTime(photo.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActionButton label="Download" onClick={handleDownload} disabled={busy}>
            ↓
          </ActionButton>
          <ActionButton label="Share" onClick={handleShare} disabled={busy}>
            ↗
          </ActionButton>
        </div>
      </div>

      {/* Tiny confirmation toast */}
      {toast && (
        <div className="dwc-toast pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-gold px-4 py-2 text-sm font-medium text-navy shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// --- Small presentational helpers ------------------------------------------

function IconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
        active ? 'bg-gold text-navy' : 'bg-black/50 text-gold'
      }`}
    >
      {children}
    </button>
  )
}

function ActionButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-black/40 px-4 py-2 text-sm font-medium text-gold transition active:scale-95 disabled:opacity-50"
    >
      <span className="text-base leading-none">{children}</span>
      {label}
    </button>
  )
}

function Arrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-2xl text-gold sm:flex ${
        side === 'left' ? 'left-3' : 'right-3'
      }`}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  )
}

// Scoped keyframes for the lightbox. Injected once; doesn't touch global CSS.
function StyleOnce() {
  return (
    <style>{`
      @keyframes dwcEnterRight { from { opacity: 0; transform: translateX(28px) } to { opacity: 1; transform: translateX(0) } }
      @keyframes dwcEnterLeft { from { opacity: 0; transform: translateX(-28px) } to { opacity: 1; transform: translateX(0) } }
      @keyframes dwcToast { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
      .dwc-enter-right { animation: dwcEnterRight 0.28s ease both }
      .dwc-enter-left { animation: dwcEnterLeft 0.28s ease both }
      .dwc-toast { animation: dwcToast 0.2s ease both }
      @media (prefers-reduced-motion: reduce) {
        .dwc-enter-right, .dwc-enter-left, .dwc-toast { animation: none }
      }
    `}</style>
  )
}

// --- Pure utils ------------------------------------------------------------

function filenameFor(p: PhotoRow): string {
  const stamp = p.created_at?.slice(0, 19).replace(/[:T]/g, '-') || 'photo'
  return `wedding-${stamp}.jpg`
}

function triggerDownload(href: string, name: string, newTab = false) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  if (newTab) a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Just now'
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const secs = Math.round((Date.now() - d) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
