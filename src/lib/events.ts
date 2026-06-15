import { supabase } from './supabase'

export type EventRow = {
  id: string
  slug: string
  name: string
  event_date: string | null
  photo_limit: number
  created_at: string
}

/** Turn a display name into a URL-safe slug, e.g. "Aurélie & Thomas" -> "aurelie-thomas". */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
}

/** All events, newest first (admin console list). */
export async function listEvents(): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EventRow[]
}

/** Look up a single event by its slug (guest room page). Returns null if none. */
export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return (data as EventRow) ?? null
}

/** Create a new event. Throws if the slug already exists (unique constraint). */
export async function createEvent(params: {
  name: string
  eventDate?: string | null
  photoLimit?: number
}): Promise<EventRow> {
  const slug = slugify(params.name)
  if (!slug) throw new Error('Please enter a name with at least one letter or number.')

  const { data, error } = await supabase
    .from('events')
    .insert({
      slug,
      name: params.name.trim(),
      event_date: params.eventDate || null,
      photo_limit: params.photoLimit ?? 20,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`An event with the link "${slug}" already exists.`)
    }
    throw error
  }
  return data as EventRow
}

/** How many photos have been taken in a room (admin dashboard stat). */
export async function getPhotoCount(slug: string): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', slug)
  if (error) throw error
  return count ?? 0
}
