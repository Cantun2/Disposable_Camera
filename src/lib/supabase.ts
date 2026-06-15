import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/** True only when both env vars are present. Features that hit Supabase
 *  (upload, gallery) check this and show a friendly setup message otherwise. */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill them in.',
  )
}

export const BUCKET = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'photos'

// Guests stay anonymous, but the /admin console now uses real Supabase Auth, so
// we persist + auto-refresh the operator's session (guest pages simply never
// have one). Fall back to harmless placeholders when unconfigured so
// createClient doesn't throw at import time and white-screen the whole app —
// the UI gates real calls on `isSupabaseConfigured`.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

export type PhotoRow = {
  id: string
  room_id: string
  photo_url: string
  guest_id: string
  created_at: string
}
