import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, type PhotoRow } from '../lib/supabase'
import {
  createEvent,
  deleteEvent,
  getPhotoCount,
  listEvents,
  listPhotos,
  slugify,
  updateEvent,
  type EventRow,
} from '../lib/events'
import { deletePhoto } from '../utils/upload'
import {
  getAdminSession,
  onAdminAuthChange,
  signInWithMagicLink,
  signInWithPassword,
  signOutAdmin,
} from '../lib/admin'

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthReady(true)
      return
    }
    let cancelled = false
    getAdminSession()
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })
    const unsub = onAdminAuthChange((s) => setSession(s))
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  if (!isSupabaseConfigured) return <NotConfigured />
  if (!authReady) return <Centered>Loading…</Centered>
  if (!session) return <LoginScreen />
  return <Console email={session.user.email ?? ''} />
}

// ── Console ────────────────────────────────────────────────────────────────
function Console({ email }: { email: string }) {
  const [events, setEvents] = useState<EventRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const rows = await listEvents()
      setEvents(rows)
      setLoadError('')
      // Photo counts are a nice-to-have stat; fetch them opportunistically.
      const entries = await Promise.all(
        rows.map(async (e) => [e.slug, await getPhotoCount(e.slug).catch(() => 0)] as const),
      )
      setCounts(Object.fromEntries(entries))
    } catch (err) {
      console.error(err)
      setLoadError((err as Error).message || 'Could not load events.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-8">
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-gold">Event console</h1>
          <p className="truncate text-xs uppercase tracking-[0.2em] text-gold-300/50">
            {email || 'Disposable Wedding Cam · admin'}
          </p>
        </div>
        <button
          onClick={() => signOutAdmin()}
          className="shrink-0 rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300/70 hover:text-gold"
        >
          Sign out
        </button>
      </header>

      <CreateEventForm onCreated={refresh} />

      <h2 className="mb-3 mt-10 font-serif text-xl text-gold">Your events</h2>
      {loading ? (
        <p className="text-gold-300/60">Loading…</p>
      ) : loadError ? (
        <p className="text-red-400">{loadError}</p>
      ) : events.length === 0 ? (
        <p className="text-gold-300/60">No events yet — create your first one above.</p>
      ) : (
        <div className="grid gap-4">
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              photoCount={counts[e.slug] ?? 0}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Create form ──────────────────────────────────────────────────────────────
function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [limit, setLimit] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const preview = slugify(name)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!preview || busy) return
    setBusy(true)
    setError('')
    try {
      await createEvent({ name, eventDate: date || null, photoLimit: limit })
      setName('')
      setDate('')
      setLimit(20)
      onCreated()
    } catch (err) {
      setError((err as Error).message || 'Could not create the event.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-gold/15 bg-navy-800/60 p-5"
    >
      <h2 className="mb-4 font-serif text-xl text-gold">Create an event</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">
            Event name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aurélie & Thomas"
            className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">
            Date (optional)
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">
            Photos per guest
          </span>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
          />
        </label>
      </div>

      {preview && (
        <p className="mt-3 text-sm text-gold-300/60">
          Link will be{' '}
          <code className="text-gold">
            {location.origin}/room/{preview}
          </code>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={!preview || busy}
        className="mt-4 rounded-full bg-gold px-6 py-2 font-medium text-navy transition active:scale-95 disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create event'}
      </button>
    </form>
  )
}

// ── Event card (link + QR + stats + management) ───────────────────────────────
function EventCard({
  event,
  photoCount,
  onChanged,
}: {
  event: EventRow
  photoCount: number
  onChanged: () => void
}) {
  const qrRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moderating, setModerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const url = `${location.origin}/room/${event.slug}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be blocked; the link is still selectable below */
    }
  }

  const downloadQr = () => {
    const canvas = qrRef.current?.querySelector('canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qr-${event.slug}.png`
    a.click()
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = () =>
    run(() => updateEvent(event.id, { isActive: !event.is_active }))

  const remove = () => {
    if (
      !window.confirm(
        `Delete "${event.name}"? Guests will no longer be able to use this link. (Photos already taken are kept until you moderate them.)`,
      )
    )
      return
    run(() => deleteEvent(event.id))
  }

  return (
    <div
      className={`rounded-2xl border bg-navy-800/60 p-5 ${
        event.is_active ? 'border-gold/15' : 'border-gold/10 opacity-70'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div ref={qrRef} className="shrink-0 self-center rounded-lg bg-white p-2">
          <QRCodeCanvas value={url} size={128} includeMargin={false} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-serif text-xl text-gold">{event.name}</h3>
            <div className="flex shrink-0 items-center gap-2">
              {!event.is_active && (
                <span className="rounded-full border border-gold/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gold-300/60">
                  Archived
                </span>
              )}
              {event.event_date && (
                <span className="text-xs text-gold-300/50">{event.event_date}</span>
              )}
            </div>
          </div>

          <p className="mt-1 text-xs text-gold-300/50">
            {photoCount} {photoCount === 1 ? 'photo' : 'photos'} · {event.photo_limit} per guest
          </p>

          <a
            href={url}
            className="mt-2 block truncate text-sm text-gold underline decoration-gold/30 underline-offset-2"
          >
            {url}
          </a>

          <div className="mt-3 flex flex-wrap gap-2">
            <CardButton onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</CardButton>
            <CardButton onClick={downloadQr}>Download QR</CardButton>
            <a
              href={`/room/${event.slug}/gallery`}
              className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300 hover:text-gold"
            >
              View gallery
            </a>
            <CardButton onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close' : 'Edit'}
            </CardButton>
            <CardButton onClick={toggleActive} disabled={busy}>
              {event.is_active ? 'Archive' : 'Unarchive'}
            </CardButton>
            <CardButton onClick={() => setModerating((v) => !v)}>
              {moderating ? 'Hide photos' : 'Moderate'}
            </CardButton>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-300/90 hover:text-red-300 disabled:opacity-40"
            >
              Delete
            </button>
          </div>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {editing && (
        <EditEventForm
          event={event}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
        />
      )}

      {moderating && <PhotoModeration slug={event.slug} onChanged={onChanged} />}
    </div>
  )
}

function CardButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300 hover:text-gold disabled:opacity-40"
    >
      {children}
    </button>
  )
}

// ── Edit event ────────────────────────────────────────────────────────────────
function EditEventForm({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [name, setName] = useState(event.name)
  const [date, setDate] = useState(event.event_date ?? '')
  const [limit, setLimit] = useState(event.photo_limit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await updateEvent(event.id, {
        name,
        eventDate: date || null,
        photoLimit: Math.max(1, limit),
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message || 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-gold/10 pt-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">Date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-gold-300/60">
          Photos per guest
        </span>
        <input
          type="number"
          min={1}
          max={200}
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
          className="w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-gold-300 outline-none focus:border-gold/60"
        />
      </label>
      {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-gold px-6 py-2 font-medium text-navy transition active:scale-95 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

// ── Photo moderation ──────────────────────────────────────────────────────────
function PhotoModeration({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      setPhotos(await listPhotos(slug))
      setState('ready')
    } catch (err) {
      console.error(err)
      setState('error')
    }
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (p: PhotoRow) => {
    if (!window.confirm('Delete this photo for everyone? This cannot be undone.')) return
    setRemoving(p.id)
    try {
      await deletePhoto(p)
      setPhotos((prev) => prev.filter((x) => x.id !== p.id))
      onChanged()
    } catch (err) {
      console.error(err)
      window.alert((err as Error).message || 'Could not delete the photo.')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="mt-4 border-t border-gold/10 pt-4">
      {state === 'loading' ? (
        <p className="text-sm text-gold-300/60">Loading photos…</p>
      ) : state === 'error' ? (
        <p className="text-sm text-red-400">Could not load photos.</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-gold-300/60">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-lg border border-gold/10">
              <img
                src={p.photo_url}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              <button
                onClick={() => remove(p)}
                disabled={removing === p.id}
                aria-label="Delete photo"
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-red-300 backdrop-blur transition hover:bg-red-900/80 disabled:opacity-40"
              >
                {removing === p.id ? '…' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'magic') {
        await signInWithMagicLink(email)
        setSent(true)
      } else {
        await signInWithPassword(email, password)
        // onAuthStateChange in <Admin> will swap us into the console.
      }
    } catch (err) {
      setError((err as Error).message || 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8">
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <h1 className="font-serif text-3xl text-gold">Admin</h1>
        <p className="mt-1 text-sm text-gold-300/60">Sign in to manage your events.</p>

        {sent ? (
          <p className="mt-6 text-sm text-gold-300/80">
            Check your inbox — we sent a magic link to <strong>{email}</strong>.
          </p>
        ) : (
          <>
            <input
              type="email"
              autoFocus
              required
              value={email}
              placeholder="you@example.com"
              onChange={(e) => {
                setEmail(e.target.value)
                setError('')
              }}
              className="mt-5 w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-center text-gold-300 outline-none focus:border-gold/60"
            />
            {mode === 'password' && (
              <input
                type="password"
                required
                value={password}
                placeholder="Password"
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
                className="mt-3 w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-center text-gold-300 outline-none focus:border-gold/60"
              />
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-4 w-full rounded-full bg-gold px-6 py-2 font-medium text-navy active:scale-95 disabled:opacity-40"
            >
              {busy ? 'Working…' : mode === 'magic' ? 'Email me a link' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'password' ? 'magic' : 'password'))
                setError('')
              }}
              className="mt-3 text-xs text-gold-300/60 underline underline-offset-2 hover:text-gold"
            >
              {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}

// ── Fallbacks ─────────────────────────────────────────────────────────────────
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 px-8 text-center text-gold-300/70">
      {children}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 px-8 text-center">
      <h1 className="font-serif text-2xl text-gold">Supabase isn’t configured</h1>
      <p className="max-w-sm text-sm text-gold-300/60">
        Add your <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{' '}
        to <code>.env.local</code> and restart the dev server to use the admin console.
      </p>
    </div>
  )
}
