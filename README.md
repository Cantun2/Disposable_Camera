# Disposable Wedding Cam

A zero-friction, browser-based **disposable camera** for weddings. Guests scan a
QR code, land straight in the event "room", shoot a limited roll with a live
**vintage film** filter applied entirely on-device, and watch a **real-time**
collaborative gallery fill up. An operator manages events from a password-gated
**admin console**.

- **Frontend:** React + Vite + TypeScript (mobile-first, tiny bundle)
- **Styling:** Tailwind CSS — dark by default, navy + gold
- **Backend:** Supabase (Postgres + Realtime + Storage + **Auth**)
- **Image processing:** 100% client-side `<canvas>` — the server never sees a raw frame
- **Deploy:** Vercel / Netlify (static SPA)

---

## 1. Setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
```

`.env.local`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_SUPABASE_BUCKET=photos
```

All `VITE_*` values are inlined into the public bundle, so the anon key is
**public by design**. Real security lives in Supabase Auth + the RLS policies in
`supabase/schema.sql` — not in any env var. (There is no longer an admin
passcode env var; the console uses real auth.)

## 2. Provision Supabase

In a new Supabase project, open the **SQL editor** and run
[`supabase/schema.sql`](supabase/schema.sql). It is idempotent (safe to re-run)
and creates:

- the `events` table (`slug`, `name`, `event_date`, `photo_limit`, **`is_active`**)
- the `photos` table (`room_id`, `photo_url`, `guest_id`, `created_at`)
- the realtime publication for live photo INSERTs
- a **`BEFORE INSERT` trigger** that enforces the per-guest photo limit and event
  validity server-side
- all RLS policies (see the model below)
- a public `photos` Storage bucket with matching policies

### Create an operator login

The admin console requires a real sign-in. Two options:

- **Email + password (simplest):** Supabase dashboard → **Authentication →
  Users → Add user**. Enter the operator's email + password and tick *Auto
  Confirm*. They can now sign in at `/admin`.
- **Magic link (passwordless):** configure email delivery (dashboard →
  Authentication → Providers → Email, or set up SMTP), then use the *“Use a
  magic link instead”* option on the login screen.

> **Tip:** in **Authentication → Providers**, disable open **sign-ups** so only
> users you add by hand can authenticate.

## 3. Auth & RLS model

The product is still **zero-login for guests** — but event management is locked
down to authenticated operators.

| Role | Events | Photos | Storage |
| --- | --- | --- | --- |
| `anon` (guest) | **read active only** | **read all**; **insert** only into an existing, active event and only up to its `photo_limit` | read public; upload to bucket |
| `authenticated` (operator) | read / create / edit / archive / delete | read / **delete (moderation)** | read; **delete (moderation)** |

Key guarantees:

- The per-guest photo cap is enforced by a **database trigger**, so clearing
  `localStorage` cannot grant a guest extra shots, and anon can never spam
  events (the old "anon can create events" policy is removed).
- **Archiving** an event (`is_active = false`) instantly makes its room read as
  *"This link isn’t active"* on the guest side, with no data deleted. Unarchive
  to re-enable.
- Guests can never UPDATE or DELETE photos. Only operators can moderate.

## 4. Free photo storage

Use the **Supabase free tier** — one project already bundles Postgres +
Realtime + **Storage** + Auth. Storage is ~**1 GB free**, which at ~200–400 KB
per filtered JPEG is **thousands of photos** — plenty for a wedding. If a venue
ever outgrows it, Cloudflare R2's 10 GB free tier is the natural next step
behind the same DB rows (swap the upload call for a pre-signed PUT); no provider
switch is needed today.

## 5. Run

```bash
npm run dev      # http://localhost:5173/admin  (operator console)
                 # http://localhost:5173/room/<slug>  (guest room)
```

`getUserMedia` needs a **secure context**. `localhost` qualifies, but to test on
a real phone over your LAN you need HTTPS — use a tunnel (`cloudflared` /
`ngrok`) or add [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl).

## 6. Test

```bash
npm test         # Vitest: slugify, session budget math, events + upload helpers
```

## 7. Build & deploy

```bash
npm run build    # -> dist/ (static)
npm run preview  # smoke-test the production build
```

Deploy `dist/` to Vercel or Netlify. Because routing is client-side, an SPA
rewrite is included so deep links like `/room/aurelie-thomas/gallery` resolve:

- **Vercel** — [`vercel.json`](vercel.json) rewrites everything to `/`.
- **Netlify** — [`public/_redirects`](public/_redirects): `/*  /index.html  200`.

Set the three `VITE_SUPABASE_*` environment variables in your host's dashboard
so the production build can reach Supabase.

---

## How it works

| Concern | Where |
| --- | --- |
| Operator auth + console | [`src/pages/Admin.tsx`](src/pages/Admin.tsx), [`src/lib/admin.ts`](src/lib/admin.ts) |
| Room access (no login) | URL param `:roomId`; anon guest token in `localStorage` — [`src/lib/session.ts`](src/lib/session.ts) |
| Camera stream + capture | [`src/components/Camera.tsx`](src/components/Camera.tsx) |
| Client-side vintage filter | [`src/utils/filter.ts`](src/utils/filter.ts) — tone pass, warm curve, grain, vignette |
| Upload (validated) + DB insert | [`src/utils/upload.ts`](src/utils/upload.ts) |
| Live masonry gallery | [`src/components/Gallery.tsx`](src/components/Gallery.tsx) — initial fetch + realtime subscription |
| Schema + RLS + trigger | [`supabase/schema.sql`](supabase/schema.sql) |

### One QR per event

Create the event in `/admin`, then share its link/QR pointing at
`https://your-app.com/room/<slug>`. Unlike the old MVP, rooms are **not** created
implicitly by the first photo — a guest link only works once an operator has
created (and kept active) the matching event.
