import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[QHash] Missing required Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  )
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
)

/**
 * Converts an E.164 Ethiopian phone number to an internal Supabase auth email.
 * E.g. "+251912345678" → "251912345678@qhash.app"
 * Users never see this email — it is an implementation detail of the auth system.
 */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `${digits}@qhash.app`
}

/**
 * Normalises user input to E.164 Ethiopian format.
 * Accepts: 09XXXXXXXX, 9XXXXXXXX, +2519XXXXXXXX, 2519XXXXXXXX
 */
export function normaliseEthiopianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('2519') || digits.startsWith('2517')) return `+${digits}`
  if (digits.startsWith('09') || digits.startsWith('07')) return `+251${digits.slice(1)}`
  if (digits.startsWith('9') || digits.startsWith('7')) return `+251${digits}`
  return `+${digits}`
}
