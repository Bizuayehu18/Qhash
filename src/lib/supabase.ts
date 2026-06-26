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

type AuthStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const isBrowser = typeof window !== 'undefined'
const memoryStorage = isBrowser ? new Map<string, string>() : null

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  if (!isBrowser) return null

  try {
    return window[kind]
  } catch {
    return null
  }
}

function safeGet(storage: Storage | null, key: string): string | null {
  if (!storage) return null

  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false

  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeRemove(storage: Storage | null, key: string): void {
  if (!storage) return

  try {
    storage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures. The in-memory fallback is cleared below.
  }
}

const resilientAuthStorage: AuthStorage = {
  getItem: (key) => {
    if (!isBrowser) return null

    const localValue = safeGet(getBrowserStorage('localStorage'), key)
    if (localValue !== null) return localValue

    const sessionValue = safeGet(getBrowserStorage('sessionStorage'), key)
    if (sessionValue !== null) return sessionValue

    return memoryStorage?.get(key) ?? null
  },
  setItem: (key, value) => {
    if (!isBrowser) return

    const wroteLocal = safeSet(getBrowserStorage('localStorage'), key, value)
    const wroteSession = safeSet(getBrowserStorage('sessionStorage'), key, value)

    if (!wroteLocal && !wroteSession) {
      memoryStorage?.set(key, value)
    } else {
      // Keep an in-memory copy for the current page lifetime in constrained mobile WebViews.
      memoryStorage?.set(key, value)
    }
  },
  removeItem: (key) => {
    if (!isBrowser) return

    safeRemove(getBrowserStorage('localStorage'), key)
    safeRemove(getBrowserStorage('sessionStorage'), key)
    memoryStorage?.delete(key)
  },
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: resilientAuthStorage,
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
