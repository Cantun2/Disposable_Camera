// Soft passcode gate for the /admin console.
//
// SECURITY NOTE: this is a Vite client app, so VITE_* values are baked into the
// public bundle — this passcode only keeps casual visitors out, it is NOT real
// security. Anyone determined can read the bundle. For true protection, put the
// admin behind Supabase Auth (email magic link) and gate event-creation with an
// RLS policy restricted to authenticated users. Good enough for "runs on my
// computer / hand the link to a client" MVP usage.

const PASSCODE = (import.meta.env.VITE_ADMIN_PASSCODE as string) || ''
const KEY = 'admin_unlocked'

/** When no passcode is configured the console is open (local-only convenience). */
export const requiresPasscode = PASSCODE.length > 0

export function isAdminUnlocked(): boolean {
  if (!requiresPasscode) return true
  return localStorage.getItem(KEY) === '1'
}

/** Returns true on success. */
export function unlockAdmin(code: string): boolean {
  if (code === PASSCODE) {
    localStorage.setItem(KEY, '1')
    return true
  }
  return false
}

export function lockAdmin(): void {
  localStorage.removeItem(KEY)
}
