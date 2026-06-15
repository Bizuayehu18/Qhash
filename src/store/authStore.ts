import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase.js'
import { withTimeout } from '@/lib/async.js'
import type { Profile } from '@/lib/database.types.js'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  initialized: boolean
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  loadProfile: (userId: string) => Promise<void>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
}

const SESSION_RESTORE_TIMEOUT_MS = 8_000
const PROFILE_LOAD_TIMEOUT_MS = 8_000
const SIGN_OUT_TIMEOUT_MS = 8_000

let listenerRegistered = false
let initPromise: Promise<void> | null = null

async function loadProfileRow(userId: string): Promise<Profile | null> {
  const query = supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  const { data, error } = await withTimeout(
    Promise.resolve(query),
    PROFILE_LOAD_TIMEOUT_MS,
    'Profile request timed out.',
  )

  if (error) {
    console.error('[QHash] Failed to load profile:', error.message)
    return null
  }

  return data ?? null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,
  initialized: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile }),

  loadProfile: async (userId: string) => {
    try {
      const profile = await loadProfileRow(userId)
      set({ profile })
    } catch (err) {
      console.error('[QHash] Profile load error:', err)
      set({ profile: null })
    }
  },

  signOut: async () => {
    set({ session: null, user: null, profile: null, loading: false })
    try {
      await withTimeout(
        supabase.auth.signOut(),
        SIGN_OUT_TIMEOUT_MS,
        'Sign out request timed out.',
      )
    } catch {
      // State already cleared — ignore network errors
    }
  },

  initialize: async () => {
    if (get().initialized) return
    if (initPromise) return initPromise

    initPromise = (async () => {
      const finish = (state: Partial<AuthState>) =>
        set({ loading: false, initialized: true, ...state })

      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          SESSION_RESTORE_TIMEOUT_MS,
          'Session restore timed out.',
        )

        const session = sessionResult.data?.session ?? null
        const error = sessionResult.error

        if (error) {
          console.error('[QHash] Session restore error:', error.message)
          finish({ session: null, user: null, profile: null })
          return
        }

        let profile: Profile | null = null
        if (session?.user) {
          try {
            profile = await loadProfileRow(session.user.id)
          } catch (err) {
            console.error('[QHash] Initial profile load error:', err)
            profile = null
          }
        }

        finish({ session, user: session?.user ?? null, profile })
      } catch (err) {
        console.error('[QHash] Auth init error:', err)
        finish({ session: null, user: null, profile: null })
      }

      if (!listenerRegistered) {
        listenerRegistered = true
        supabase.auth.onAuthStateChange(async (event, newSession) => {
          if (event === 'SIGNED_OUT') {
            set({ session: null, user: null, profile: null, loading: false })
            return
          }

          try {
            let newProfile: Profile | null = null
            if (newSession?.user) {
              newProfile = await loadProfileRow(newSession.user.id)
            }
            set({ session: newSession, user: newSession?.user ?? null, profile: newProfile, loading: false })
          } catch (err) {
            console.error('[QHash] Auth state change error:', err)
            set({ session: newSession, user: newSession?.user ?? null, profile: null, loading: false })
          }
        })
      }
    })()

    return initPromise
  },
}))
