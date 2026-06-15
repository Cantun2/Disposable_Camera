import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isSupabaseConfigured, supabase, type PhotoRow } from '../lib/supabase'

type LoadState = 'loading' | 'ready' | 'error'

// Live, collaborative gallery for one room.
//  1. Fetch the existing roll once (newest first).
//  2. Subscribe to Postgres INSERTs scoped to this room_id and prepend them
//     as guests around the venue keep shooting — no polling, no refresh.
export default function Gallery({ roomId, title }: { roomId: string; title?: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [active, setActive] = useState<PhotoRow | null>(null) // lightbox

  // Keep the latest ids in a ref so the realtime handler can dedupe without
  // being re-created (and re-subscribing) on every state change.
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isSupabaseConfigured) return // nothing to fetch/subscribe to yet
    let cancelled = false
    seen.current = new Set()

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
          setPhotos((prev) => [row, ...prev])
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // --- UI -------------------------------------------------------------------
  if (!isSupabaseConfigured) {
    return (
      <CenteredMessage>
        <p className="font-serif text-2xl text-gold">Almost there</p>
        <p className="text-sm text-gold-300/60">
          Add your Supabase URL and anon key to <code>.env.local</code>, then
          restart the dev server to enable uploads and the live gallery.
        </p>
      </CenteredMessage>
    )
  }

  if (state === 'loading') {
    return (
      <CenteredMessage>
        <p className="font-serif text-xl text-gold-300/70">Developing the film…</p>
      </CenteredMessage>
    )
  }

  if (state === 'error') {
    return (
      <CenteredMessage>
        <p className="font-serif text-xl text-gold">Couldn’t load the gallery</p>
        <p className="text-sm text-gold-300/60">Check your connection and try again.</p>
      </CenteredMessage>
    )
  }

  if (photos.length === 0) {
    return (
      <CenteredMessage>
        <p className="font-serif text-2xl text-gold">No shots yet 🎞️</p>
        <p className="text-sm text-gold-300/60">
          Be the first to capture a moment from {roomId.replace(/-/g, ' ')}.
        </p>
      </CenteredMessage>
    )
  }

  return (
    <div className="h-dvh w-full overflow-y-auto bg-navy">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-navy/80 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur">
        <h1 className="font-serif text-2xl tracking-wide text-gold">
          {title ?? roomId.replace(/-/g, ' ')}
        </h1>
        <p className="text-xs uppercase tracking-[0.2em] text-gold-300/50">
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'} · live
        </p>
      </header>

      {/* Masonry grid via CSS columns — cheap, no layout library. */}
      <div className="columns-2 gap-2 px-2 pb-28 [column-fill:_balance] sm:columns-3">
        {photos.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p)}
            className="mb-2 block w-full break-inside-avoid overflow-hidden rounded-lg border border-gold/10 focus:outline-none"
          >
            <img
              src={p.photo_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="block w-full bg-navy-800 object-cover"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={active.photo_url}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            aria-label="Close"
            onClick={() => setActive(null)}
            className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-2xl text-gold"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 px-8 text-center">
      {children}
    </div>
  )
}
