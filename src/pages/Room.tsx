import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import Camera from '../components/Camera'
import Gallery from '../components/Gallery'
import { getGuestId } from '../lib/session'
import { isSupabaseConfigured } from '../lib/supabase'
import { getEventBySlug, type EventRow } from '../lib/events'

type State = 'loading' | 'ready' | 'invalid'

// The room page hosts the two views (camera / gallery) behind a bottom tab.
export default function Room() {
  const { roomId = '', tab } = useParams()
  const [state, setState] = useState<State>('loading')
  const [event, setEvent] = useState<EventRow | null>(null)

  // Touching the room URL provisions an anonymous guest token, then looks up
  // the event so we can show its name and enforce its per-guest photo limit.
  useEffect(() => {
    getGuestId()

    // No backend configured → demo mode: let the camera run against the slug.
    if (!isSupabaseConfigured) {
      setState('ready')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const ev = await getEventBySlug(roomId)
        if (cancelled) return
        if (!ev) {
          setState('invalid')
          return
        }
        setEvent(ev)
        setState('ready')
      } catch (err) {
        console.error(err)
        if (!cancelled) setState('invalid')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [roomId])

  if (state === 'loading') {
    return (
      <Centered>
        <p className="font-serif text-xl text-gold-300/70">Loading the event…</p>
      </Centered>
    )
  }

  if (state === 'invalid') {
    return (
      <Centered>
        <p className="font-serif text-2xl text-gold">This link isn’t active</p>
        <p className="max-w-xs text-sm text-gold-300/60">
          Double-check the QR code or link with your host — this event doesn’t exist
          (or hasn’t been created yet).
        </p>
      </Centered>
    )
  }

  const showGallery = tab === 'gallery'
  const title = event?.name
  const limit = event?.photo_limit

  return (
    <div className="relative h-dvh w-full bg-navy">
      {showGallery ? (
        <Gallery roomId={roomId} title={title} />
      ) : (
        <Camera roomId={roomId} title={title} limit={limit} />
      )}

      {/* Bottom tab bar */}
      <nav className="absolute bottom-0 left-0 right-0 z-30 flex justify-around border-t border-gold/15 bg-navy/80 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
        <Tab to={`/room/${roomId}`} active={!showGallery} label="Camera" />
        <Tab to={`/room/${roomId}/gallery`} active={showGallery} label="Gallery" />
      </nav>
    </div>
  )
}

function Tab({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <NavLink
      to={to}
      className={`px-6 py-1 font-serif text-lg tracking-wide ${
        active ? 'text-gold' : 'text-gold-300/50'
      }`}
    >
      {label}
    </NavLink>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 px-8 text-center">
      {children}
    </div>
  )
}
