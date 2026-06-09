import { BUCKET, supabase, type PhotoRow } from '../lib/supabase'

/**
 * Upload a processed JPEG straight to Storage, then insert the DB row.
 * No server compute: the client owns the whole pipeline.
 *
 * If you'd rather use S3-compatible storage (Scaleway) with pre-signed URLs,
 * swap the `supabase.storage` call for a PUT to the signed URL returned by a
 * tiny edge function — the DB insert below stays identical.
 */
export async function uploadPhoto(params: {
  blob: Blob
  roomId: string
  guestId: string
}): Promise<PhotoRow> {
  const { blob, roomId, guestId } = params

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
  if (insErr) throw insErr

  return data as PhotoRow
}
