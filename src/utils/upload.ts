import { BUCKET, supabase, type PhotoRow } from '../lib/supabase'

/** Reject anything that isn't an image, or is implausibly large. The camera
 *  produces ~200–400 KB JPEGs, so 10 MB is a generous safety cap that still
 *  blocks abusive uploads. Exported for unit testing. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function validateImageBlob(blob: Blob): void {
  if (!blob || blob.size === 0) {
    throw new Error('Nothing to upload — the photo is empty.')
  }
  if (!blob.type.startsWith('image/')) {
    throw new Error('Only image files can be uploaded.')
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('That image is too large to upload.')
  }
}

/**
 * Upload a processed JPEG straight to Storage, then insert the DB row.
 * No server compute: the client owns the whole pipeline.
 *
 * The DB insert is gated by RLS + a trigger (see schema.sql): it only succeeds
 * for an existing, active event and while the guest is under the per-guest
 * limit — so this is bounded server-side, not just by localStorage.
 *
 * If you'd rather use S3-compatible storage (Cloudflare R2) with pre-signed
 * URLs, swap the `supabase.storage` call for a PUT to the signed URL returned
 * by a tiny edge function — the DB insert below stays identical.
 */
export async function uploadPhoto(params: {
  blob: Blob
  roomId: string
  guestId: string
}): Promise<PhotoRow> {
  const { blob, roomId, guestId } = params

  // Client-side guard before we spend bandwidth (the server enforces the rest).
  validateImageBlob(blob)

  // Path is namespaced by room so buckets stay tidy and RLS can scope by prefix.
  const filename = `${roomId}/${crypto.randomUUID()}.jpg`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(filename, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000', // immutable, cache for a year
      upsert: false,
    })
  if (upErr) throw upErr

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(filename)

  const { data, error: insErr } = await supabase
    .from('photos')
    .insert({ room_id: roomId, photo_url: publicUrl, guest_id: guestId })
    .select()
    .single()
  if (insErr) {
    // The DB row was rejected (e.g. limit reached / inactive event). Don't leave
    // an orphaned object in storage.
    await supabase.storage.from(BUCKET).remove([filename]).catch(() => {})
    throw insErr
  }

  return data as PhotoRow
}

/** Derive the in-bucket object path from a public photo URL. Returns null if
 *  the URL doesn't point at our bucket. */
function storagePathFromUrl(photoUrl: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = photoUrl.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(photoUrl.slice(idx + marker.length))
}

/**
 * Moderation helper: remove a photo from BOTH Storage and the DB. Requires an
 * authenticated (operator) session — anon callers are blocked by RLS. Deletes
 * the storage object first (best-effort), then the row.
 */
export async function deletePhoto(photo: {
  id: string
  photo_url: string
}): Promise<void> {
  const path = storagePathFromUrl(photo.photo_url)
  if (path) {
    await supabase.storage.from(BUCKET).remove([path])
  }
  const { error } = await supabase.from('photos').delete().eq('id', photo.id)
  if (error) throw error
}
