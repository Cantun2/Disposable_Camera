# Disposable Wedding Cam

A zero-friction, browser-based **disposable camera** for weddings. Guests scan a
QR code, land straight in the event "room", shoot up to 20 photos with a live
**vintage film** filter applied entirely on-device, and watch a **real-time**
collaborative gallery fill up.

- **Frontend:** React + Vite + TypeScript (mobile-first, tiny bundle)
- **Styling:** Tailwind CSS — dark by default, navy + gold
- **Backend:** Supabase (Postgres + Realtime + Storage)
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

## 2. Provision Supabase

In a new Supabase project, open the **SQL editor** and run
[`supabase/schema.sql`](supabase/schema.sql). It creates:

- the `photos` table (`room_id`, `photo_url`, `guest_id`, `created_at`)
- the realtime publication for live INSERTs
- RLS policies allowing anonymous **read + insert** (zero-login product)
- a public `photos` Storage bucket with matching policies

> The anon key is public by design. Clients can read and insert, but **never**
> update or delete — abuse is bounded by the per-device 20-shot budget and you
> can prune rooms server-side.

## 3. Run

```bash
npm run dev      # http://localhost:5173/room/aurelie-thomas
```

`getUserMedia` needs a **secure context**. `localhost` qualifies, but to test on
a real phone over your LAN you need HTTPS — use a tunnel (`cloudflared` /
`ngrok`) or add [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl).

## 4. Build & deploy

```bash
npm run build    # -> dist/ (static)
npm run preview  # smoke-test the production build
```

Deploy `dist/` to Vercel or Netlify. Because routing is client-side, add an
SPA rewrite so deep links like `/room/aurelie-thomas/gallery` resolve:

- **Vercel** — `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`
- **Netlify** — `_redirects`: `/*  /index.html  200`

---

## How it works

| Concern | Where |
| --- | --- |
| Room access (no login) | URL param `:roomId`; anon guest token in `localStorage` — [`src/lib/session.ts`](src/lib/session.ts) |
| Camera stream + capture | [`src/components/Camera.tsx`](src/components/Camera.tsx) |
| Client-side vintage filter | [`src/utils/filter.ts`](src/utils/filter.ts) — tone pass, warm curve, grain, vignette |
| Upload + DB insert | [`src/utils/upload.ts`](src/utils/upload.ts) |
| Live masonry gallery | [`src/components/Gallery.tsx`](src/components/Gallery.tsx) — initial fetch + realtime subscription |

### One QR per event

Generate a QR pointing at `https://your-app.com/room/<slug>` for each wedding.
Anything after `/room/` becomes the room id, so no setup is required to add a new
event — the first photo creates the room implicitly.
