import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  createEvent,
  getPhotoCount,
  listEvents,
  slugify,
  type EventRow,
} from '../lib/events'
import {
  isAdminUnlocked,
  lockAdmin,
  requiresPasscode,
  unlockAdmin,
} from '../lib/admin'

export default function Admin() {
  const [unlocked, setUnlocked] = useState(() => isAdminUnlocked())

  if (!isSupabaseConfigured) return <NotConfigured />
  if (!unlocked) return <PasscodeGate onUnlock={() => setUnlocked(true)} />
  return <Console />
}

// ── Console ────────────────────────────────────────────────────────────────
function Console() {
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
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl text-gold">Event console</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-gold-300/50">
            Disposable Wedding Cam · admin
          </p>
        </div>
        {requiresPasscode && (
          <button
            onClick={() => {
              lockAdmin()
              location.reload()
            }}
            className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300/70 hover:text-gold"
          >
            Lock
          </button>
        )}
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
            <EventCard key={e.id} event={e} photoCount={counts[e.slug] ?? 0} />
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

// ── Event card (link + QR + stats) ───────────────────────────────────────────
function EventCard({ event, photoCount }: { event: EventRow; photoCount: number }) {
  const qrRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
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

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gold/15 bg-navy-800/60 p-5 sm:flex-row">
      <div ref={qrRef} className="shrink-0 self-center rounded-lg bg-white p-2">
        <QRCodeCanvas value={url} size={128} includeMargin={false} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-serif text-xl text-gold">{event.name}</h3>
          {event.event_date && (
            <span className="shrink-0 text-xs text-gold-300/50">{event.event_date}</span>
          )}
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
          <button
            onClick={copy}
            className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300 hover:text-gold"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            onClick={downloadQr}
            className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300 hover:text-gold"
          >
            Download QR
          </button>
          <a
            href={`/room/${event.slug}/gallery`}
            className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-300 hover:text-gold"
          >
            View gallery
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Gates / fallbacks ─────────────────────────────────────────────────────────
function PasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (unlockAdmin(code)) onUnlock()
    else setError(true)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8">
      <form onSubmit={submit} className="w-full max-w-xs text-center">
        <h1 className="font-serif text-3xl text-gold">Admin</h1>
        <p className="mt-1 text-sm text-gold-300/60">Enter your passcode to continue.</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError(false)
          }}
          className="mt-5 w-full rounded-lg border border-gold/20 bg-navy px-3 py-2 text-center text-gold-300 outline-none focus:border-gold/60"
        />
        {error && <p className="mt-2 text-sm text-red-400">Wrong passcode.</p>}
        <button
          type="submit"
          className="mt-4 w-full rounded-full bg-gold px-6 py-2 font-medium text-navy active:scale-95"
        >
          Unlock
        </button>
      </form>
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
