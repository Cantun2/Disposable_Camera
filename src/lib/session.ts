// Zero-login guest identity + per-room photo budget, all in localStorage.
// No PII, no cookies to consent to — just an anonymous token per device.

const MAX_PHOTOS = 20

function uid(): string {
  // crypto.randomUUID is available in all secure-context browsers we target.
  return crypto.randomUUID()
}

/** Stable anonymous id for this device/guest, created on first visit. */
export function getGuestId(): string {
  let id = localStorage.getItem('guest_id')
  if (!id) {
    id = uid()
    localStorage.setItem('guest_id', id)
  }
  return id
}

const budgetKey = (roomId: string) => `room:${roomId}:remaining`

/** How many shots this guest has left in this room. On first visit the budget
 *  is seeded with `limit` (the event's per-guest limit, default MAX_PHOTOS). */
export function getRemaining(roomId: string, limit: number = MAX_PHOTOS): number {
  const raw = localStorage.getItem(budgetKey(roomId))
  if (raw === null) return limit
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.max(0, n) : limit
}

/** Decrement and persist the remaining budget; returns the new value. */
export function consumeShot(roomId: string): number {
  const next = Math.max(0, getRemaining(roomId) - 1)
  localStorage.setItem(budgetKey(roomId), String(next))
  return next
}

export const PHOTO_LIMIT = MAX_PHOTOS
