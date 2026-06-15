import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared, mutable result the mocked Supabase query resolves to. Declared via
// vi.hoisted so the (hoisted) vi.mock factory below can reference it.
const h = vi.hoisted(() => ({
  state: { result: { data: null, error: null, count: 0 } as Record<string, unknown> },
  fromArgs: [] as unknown[],
}))

// Minimal chainable Supabase stub: every builder method returns the builder,
// the builder is awaitable (resolves to state.result), and single/maybeSingle
// resolve directly. This lets us exercise the real events.ts query chains.
vi.mock('./supabase', () => {
  const builder: Record<string, unknown> = {}
  const chain = ['select', 'insert', 'update', 'delete', 'eq', 'order']
  for (const m of chain) builder[m] = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(h.state.result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(h.state.result))
  // Make the builder thenable for chains that end at eq()/order().
  builder.then = (resolve: (v: unknown) => unknown) => resolve(h.state.result)
  return {
    supabase: {
      from: vi.fn((...args: unknown[]) => {
        h.fromArgs = args
        return builder
      }),
    },
  }
})

import {
  createEvent,
  deleteEvent,
  getEventBySlug,
  getPhotoCount,
  listEvents,
  listPhotos,
  slugify,
  updateEvent,
} from './events'

beforeEach(() => {
  h.state.result = { data: null, error: null, count: 0 }
})
afterEach(() => vi.clearAllMocks())

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Aurelie Thomas')).toBe('aurelie-thomas')
  })
  it('strips accents', () => {
    expect(slugify('Aurélie')).toBe('aurelie')
  })
  it('expands ampersands to "and"', () => {
    expect(slugify('Aurélie & Thomas')).toBe('aurelie-and-thomas')
  })
  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(slugify('  Ben + Jé!!!ss{}ica  ')).toBe('ben-je-ss-ica')
  })
  it('trims leading/trailing hyphens', () => {
    expect(slugify('---Hello---')).toBe('hello')
  })
  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('')
  })
  it('expands each ampersand even in a run', () => {
    expect(slugify('   &&&   ')).toBe('and-and-and')
  })
})

describe('createEvent', () => {
  it('rejects names that slugify to nothing', async () => {
    await expect(createEvent({ name: '!!!' })).rejects.toThrow(/at least one letter/i)
  })

  it('returns the inserted row on success', async () => {
    const row = { id: '1', slug: 'a-b', name: 'A B', is_active: true }
    h.state.result = { data: row, error: null }
    await expect(createEvent({ name: 'A B' })).resolves.toEqual(row)
  })

  it('maps a unique-violation into a friendly duplicate-slug error', async () => {
    h.state.result = { data: null, error: { code: '23505' } }
    await expect(createEvent({ name: 'A B' })).rejects.toThrow(/already exists/i)
  })

  it('rethrows other errors', async () => {
    h.state.result = { data: null, error: { code: '500', message: 'boom' } }
    await expect(createEvent({ name: 'A B' })).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('read helpers', () => {
  it('listEvents returns the data array', async () => {
    h.state.result = { data: [{ id: '1' }, { id: '2' }], error: null }
    await expect(listEvents()).resolves.toHaveLength(2)
  })

  it('listEvents throws on error', async () => {
    h.state.result = { data: null, error: { message: 'nope' } }
    await expect(listEvents()).rejects.toMatchObject({ message: 'nope' })
  })

  it('getEventBySlug returns null when there is no match', async () => {
    h.state.result = { data: null, error: null }
    await expect(getEventBySlug('missing')).resolves.toBeNull()
  })

  it('getPhotoCount returns the count (0 when null)', async () => {
    h.state.result = { count: 7, error: null }
    await expect(getPhotoCount('a-b')).resolves.toBe(7)
    h.state.result = { count: null, error: null }
    await expect(getPhotoCount('a-b')).resolves.toBe(0)
  })

  it('listPhotos returns the data array', async () => {
    h.state.result = { data: [{ id: 'p1' }], error: null }
    await expect(listPhotos('a-b')).resolves.toHaveLength(1)
  })
})

describe('updateEvent / deleteEvent', () => {
  it('updateEvent returns the updated row', async () => {
    const row = { id: '1', name: 'New', is_active: false }
    h.state.result = { data: row, error: null }
    await expect(
      updateEvent('1', { name: 'New', isActive: false }),
    ).resolves.toEqual(row)
  })

  it('deleteEvent resolves on success', async () => {
    h.state.result = { error: null }
    await expect(deleteEvent('1')).resolves.toBeUndefined()
  })

  it('deleteEvent throws on error', async () => {
    h.state.result = { error: { message: 'denied' } }
    await expect(deleteEvent('1')).rejects.toMatchObject({ message: 'denied' })
  })
})
