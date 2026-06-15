import { supabase, type PhotoRow } from './supabase'

export type EventRow = {
  id: string
  slug: string
  name: string
  event_date: string | null
  photo_limit: number
  is_active: boolean
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

/** Edit an event's name / date / per-guest limit / active flag (operator-only,
 *  enforced by RLS). Only the provided fields are changed. */
export async function updateEvent(
  id: string,
  patch: {
    name?: string
    eventDate?: string | null
    photoLimit?: number
    isActive?: boolean
  },
): Promise<EventRow> {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.eventDate !== undefined) update.event_date = patch.eventDate || null
  if (patch.photoLimit !== undefined) update.photo_limit = patch.photoLimit
  if (patch.isActive !== undefined) update.is_active = patch.isActive

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as EventRow
}

/** Permanently delete an event (operator-only). Does not remove its photos —
 *  use photo moderation for those. */
export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

/** All photos for a room, newest first (admin moderation view). */
export async function listPhotos(slug: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('room_id', slug)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PhotoRow[]
}
