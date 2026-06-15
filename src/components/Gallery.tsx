import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { isSupabaseConfigured, supabase, type PhotoRow } from '../lib/supabase'
import Lightbox from './Lightbox'

type LoadState = 'loading' | 'ready' | 'error'

const PAGE_SIZE = 24 // photos revealed per "page" so big rolls load fast

// Live, collaborative gallery for one room.
//  1. Fetch the existing roll once (newest first).
//  2. Subscribe to Postgres INSERTs scoped to this room_id and prepend them
//     as guests around the venue keep shooting — no polling, no refresh.
export default function Gallery({ roomId, title }: { roomId: string; title?: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [active, setActive] = useState<number | null>(null) // lightbox index
  const [autoplay, setAutoplay] = useState(false) // opened via "Slideshow"
  const [visible, setVisible] = useState(PAGE_SIZE) // infinite-scroll window
  const [newCount, setNewCount] = useState(0) // arrivals while scrolled down

  // Keep the latest ids in a ref so the realtime handler can dedupe without
  // being re-created (and re-subscribing) on every state change.
  const seen = useRef<Set<string>>(new Set())
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const justArrived = useRef<Set<string>>(new Set()) // ids to animate in

  useEffect(() => {
    if (!isSupabaseConfigured) return // nothing to fetch/subscribe to yet
    let cancelled = false
    seen.current = new Set()
    setVisible(PAGE_SIZE)

    // --- 1. Initial load ----------------------------------------------------
    ;(async () => {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) {
        console.error(error)
        setState('error')
        return
      }
      const rows = (data ?? []) as PhotoRow[]
      rows.forEach((r) => seen.current.add(r.id))
      setPhotos(rows)
      setState('ready')
    })()

    // --- 2. Realtime INSERT subscription ------------------------------------
    const channel = supabase
      .channel(`gallery:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'photos',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as PhotoRow
          if (seen.current.has(row.id)) return // already have it (e.g. our own upload)
          seen.current.add(row.id)
          justArrived.current.add(row.id)
          // Drop the "animate-in" mark once the pop has played so the thumbnail
          // doesn't re-animate on a later re-render (and the set stays bounded).
          window.setTimeout(() => justArrived.current.delete(row.id), 600)
          setPhotos((prev) => [row, ...prev])

          // If the guest isn't pinned to the top, surface a "new photo" pill
          // instead of yanking their scroll position.
          const el = scrollerRef.current
          if (el && el.scrollTop > 120) setNewCount((n) => n + 1)
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // Infinite scroll: reveal another page when the sentinel enters view.
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = scrollerRef.current
    if (!sentinel || !root) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < photos.length ? v + PAGE_SIZE : v))
        }
      },
      { root, rootMargin: '600px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [photos.length, state])

  const jumpToTop = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setNewCount(0)
  }, [])

  // --- UI -------------------------------------------------------------------
  if (!isSupabaseConfigured) {
    return (
      <CenteredMessage>
        <div className="text-4xl">🎞️</div>
        <p className="font-serif text-2xl text-gold">Almost there</p>
        <p className="max-w-xs text-sm text-gold-300/60">
          Add your Supabase URL and anon key to <code className="text-gold-300/80">.env.local</code>,
          then restart the dev server to enable uploads and the live gallery.
        </p>
      </CenteredMessage>
    )
  }

  if (state === 'loading') return <GallerySkeleton title={title ?? roomId.replace(/-/g, ' ')} />

  if (state === 'error') {
    return (
      <CenteredMessage>
        <div className="text-4xl">📷</div>
        <p className="font-serif text-xl text-gold">Couldn’t load the gallery</p>
        <p className="text-sm text-gold-300/60">Check your connection and try again.</p>
      </CenteredMessage>
    )
  }

  if (photos.length === 0) {
    return (
      <CenteredMessage>
        <div className="text-4xl">🎞️</div>
        <p className="font-serif text-2xl text-gold">No shots yet</p>
        <p className="max-w-xs text-sm text-gold-300/60">
          Be the first to capture a moment from {roomId.replace(/-/g, ' ')}.
        </p>
      </CenteredMessage>
    )
  }

  const shown = photos.slice(0, visible)

  return (
    <div ref={scrollerRef} className="h-dvh w-full overflow-y-auto bg-navy">
      <StyleOnce />

      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-navy/80 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl tracking-wide text-gold">
            {title ?? roomId.replace(/-/g, ' ')}
          </h1>
          <p className="text-xs uppercase tracking-[0.2em] text-gold-300/50">
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-gold align-middle" />
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'} · live
          </p>
        </div>
        <button
          onClick={() => {
            setAutoplay(true)
            setActive(0)
          }}
          className="shrink-0 rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold transition active:scale-95"
        >
          Slideshow
        </button>
      </header>

      {/* "New photos" pill — appears when arrivals land while scrolled down */}
      {newCount > 0 && (
        <button
          onClick={jumpToTop}
          className="dwc-pill fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 -translate-x-1/2 rounded-full bg-gold px-4 py-2 text-sm font-medium text-navy shadow-lg"
        >
          ↑ {newCount} new {newCount === 1 ? 'photo' : 'photos'}
        </button>
      )}

      {/* Masonry grid via CSS columns — cheap, no layout library. */}
      <div className="columns-2 gap-2 px-2 pb-28 [column-fill:_balance] sm:columns-3">
        {shown.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActive(i)}
            className={`mb-2 block w-full break-inside-avoid overflow-hidden rounded-lg border border-gold/10 focus:outline-none focus:ring-2 focus:ring-gold/40 ${
              justArrived.current.has(p.id) ? 'dwc-pop' : ''
            }`}
          >
            <Thumb photo={p} />
          </button>
        ))}
      </div>

      {/* Infinite-scroll sentinel + remaining-count hint */}
      {visible < photos.length && (
        <div ref={sentinelRef} className="flex justify-center pb-28 pt-2">
          <span className="text-xs uppercase tracking-[0.2em] text-gold-300/40">
            Loading more…
          </span>
        </div>
      )}

      {/* Lightbox */}
      {active !== null && photos[active] && (
        <Lightbox
          photos={photos}
          index={active}
          autoplay={autoplay}
          onIndexChange={setActive}
          onClose={() => {
            setActive(null)
            setAutoplay(false)
          }}
        />
      )}
    </div>
  )
}

// A single thumbnail with a shimmer placeholder until the image decodes.
function Thumb({ photo }: { photo: PhotoRow }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative bg-navy-800">
      {!loaded && <div className="dwc-shimmer aspect-[3/4] w-full" />}
      <img
        src={photo.photo_url}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`block w-full object-cover transition-opacity duration-500 ${
          loaded ? 'opacity-100' : 'absolute inset-0 opacity-0'
        }`}
      />
    </div>
  )
}

// Skeleton grid shown during the initial fetch — keeps perceived load fast.
function GallerySkeleton({ title }: { title: string }) {
  const heights = ['h-44', 'h-56', 'h-40', 'h-52', 'h-48', 'h-60', 'h-44', 'h-52', 'h-40']
  return (
    <div className="h-dvh w-full overflow-hidden bg-navy">
      <StyleOnce />
      <header className="sticky top-0 z-10 bg-navy/80 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur">
        <h1 className="font-serif text-2xl tracking-wide text-gold">{title}</h1>
        <p className="text-xs uppercase tracking-[0.2em] text-gold-300/50">Developing the film…</p>
      </header>
      <div className="columns-2 gap-2 px-2 sm:columns-3">
        {heights.map((h, i) => (
          <div key={i} className={`dwc-shimmer mb-2 w-full break-inside-avoid rounded-lg ${h}`} />
        ))}
      </div>
    </div>
  )
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 px-8 text-center">
      {children}
    </div>
  )
}

// Scoped keyframes (shimmer / pop / pill). Injected from this component so we
// don't have to touch the global stylesheet (owned by the design agent).
function StyleOnce() {
  return (
    <style>{`
      @keyframes dwcShimmer { 0% { background-position: -480px 0 } 100% { background-position: 480px 0 } }
      .dwc-shimmer {
        background: linear-gradient(100deg, #0e1530 30%, #18224d 50%, #0e1530 70%);
        background-size: 960px 100%;
        animation: dwcShimmer 1.4s linear infinite;
      }
      @keyframes dwcPop { from { opacity: 0; transform: scale(0.94) translateY(-6px) } to { opacity: 1; transform: none } }
      .dwc-pop { animation: dwcPop 0.45s cubic-bezier(0.22, 1, 0.36, 1) both }
      @keyframes dwcPill { from { opacity: 0; transform: translate(-50%, -8px) } to { opacity: 1; transform: translate(-50%, 0) } }
      .dwc-pill { animation: dwcPill 0.25s ease both }
      @media (prefers-reduced-motion: reduce) {
        .dwc-shimmer { animation: none }
        .dwc-pop, .dwc-pill { animation: none }
      }
    `}</style>
  )
}
