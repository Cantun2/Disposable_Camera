// Temporary diagnostic — reads .env.local and inspects events + photos.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const { data: events, error: evErr } = await supabase
  .from('events')
  .select('slug,name,is_active,photo_limit')
console.log('EVENTS:', evErr ? `ERROR ${evErr.message}` : JSON.stringify(events, null, 2))

const { data: photos, error: phErr, count } = await supabase
  .from('photos')
  .select('id,room_id,created_at', { count: 'exact' })
  .order('created_at', { ascending: false })
  .limit(10)
console.log('PHOTO COUNT:', phErr ? `ERROR ${phErr.message}` : count)
console.log('RECENT PHOTOS:', phErr ? '' : JSON.stringify(photos, null, 2))
