// Real admin authentication for the /admin console, backed by Supabase Auth.
//
// The old VITE_ADMIN_PASSCODE was baked into the public bundle, so it was never
// real security. The console is now gated on a genuine auth SESSION: operators
// sign in with email + password (or a magic link), and RLS in schema.sql only
// grants event create/edit/delete + photo moderation to the `authenticated`
// role. A guest with the public anon key can do none of that.
//
// These are thin helpers around supabase.auth; the gate itself (Admin.tsx)
// reacts to the real session.

import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Current operator session, or null when signed out. */
export async function getAdminSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
export function onAdminAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

/** Sign in with email + password. Throws on bad credentials. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
}

/** Send a passwordless magic-link to the operator's email (requires email
 *  delivery to be configured in the Supabase dashboard). */
export async function signInWithMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: `${window.location.origin}/admin` },
  })
  if (error) throw error
}

/** End the operator session. */
export async function signOutAdmin(): Promise<void> {
  await supabase.auth.signOut()
}
