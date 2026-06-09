import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Fail loud in dev so a missing .env.local is obvious.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

export const BUCKET = (import.meta.env.VITE_SUPABASE_BUCKET as string) || 'photos'

// We don't use Supabase Auth (zero-login product), so disable session persistence.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
})

export type PhotoRow = {
  id: string
  room_id: string
  photo_url: string
  guest_id: string
  created_at: string
}
