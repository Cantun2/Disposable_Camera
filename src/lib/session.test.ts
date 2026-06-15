import { beforeEach, describe, expect, it, vi } from 'vitest'

// session.ts reads the browser `localStorage` global at call time, so a tiny
// in-memory stub is enough — no jsdom needed.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v))
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
  clear(): void {
    this.store.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

import { consumeShot, getRemaining, PHOTO_LIMIT } from './session'

describe('session budget math', () => {
  it('seeds the budget with the event limit on first visit', () => {
    expect(getRemaining('wed', 5)).toBe(5)
  })

  it('defaults to PHOTO_LIMIT when no limit is given', () => {
    expect(getRemaining('wed')).toBe(PHOTO_LIMIT)
  })

  it('consumeShot decrements and persists', () => {
    expect(getRemaining('wed', 3)).toBe(3)
    expect(consumeShot('wed')).toBe(19) // first consume seeds from default 20
  })

  it('decrements down toward zero across calls', () => {
    localStorage.setItem('room:wed:remaining', '2')
    expect(consumeShot('wed')).toBe(1)
    expect(consumeShot('wed')).toBe(0)
  })

  it('never goes below zero', () => {
    localStorage.setItem('room:wed:remaining', '0')
    expect(consumeShot('wed')).toBe(0)
    expect(getRemaining('wed')).toBe(0)
  })

  it('clamps a stored negative value to zero', () => {
    localStorage.setItem('room:wed:remaining', '-5')
    expect(getRemaining('wed', 10)).toBe(0)
  })

  it('falls back to the limit when the stored value is corrupt', () => {
    localStorage.setItem('room:wed:remaining', 'not-a-number')
    expect(getRemaining('wed', 8)).toBe(8)
  })

  it('keeps separate budgets per room', () => {
    localStorage.setItem('room:a:remaining', '4')
    localStorage.setItem('room:b:remaining', '9')
    expect(getRemaining('a', 20)).toBe(4)
    expect(getRemaining('b', 20)).toBe(9)
  })
})
