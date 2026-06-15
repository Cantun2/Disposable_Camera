import { describe, expect, it, vi } from 'vitest'

// validateImageBlob is pure, but upload.ts imports the supabase client at module
// load — stub it so the test stays offline and fast.
vi.mock('../lib/supabase', () => ({
  BUCKET: 'photos',
  supabase: {},
}))

import { MAX_UPLOAD_BYTES, validateImageBlob } from './upload'

const blobOfSize = (bytes: number, type: string) =>
  new Blob([new Uint8Array(bytes)], { type })

describe('validateImageBlob', () => {
  it('accepts a normal image blob', () => {
    expect(() => validateImageBlob(blobOfSize(1024, 'image/jpeg'))).not.toThrow()
  })

  it('rejects an empty blob', () => {
    expect(() => validateImageBlob(blobOfSize(0, 'image/jpeg'))).toThrow(/empty/i)
  })

  it('rejects a non-image blob', () => {
    expect(() => validateImageBlob(blobOfSize(1024, 'application/pdf'))).toThrow(
      /image files/i,
    )
  })

  it('rejects a blob over the size cap', () => {
    expect(() => validateImageBlob(blobOfSize(MAX_UPLOAD_BYTES + 1, 'image/png'))).toThrow(
      /too large/i,
    )
  })
})
