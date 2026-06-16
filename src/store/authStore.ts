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
const PROFILE_RETRY_DELAY_MS = 1_500
const PROFILE_RETRY_ATTEMPTS = 2

let listenerRegistered = false
let initPromise: Promise<void> | null = null

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    throw error
  }

  return data ?? null
}

export const useAuthStore = create<AuthState>((set, get) => {
  const retryProfileInBackground = (userId: string) => {
    void (async () => {
      for (let attempt = 1; attempt <= PROFILE_RETRY_ATTEMPTS; attempt += 1) {
        await delay(PROFILE_RETRY_DELAY_MS)

        try {
          const profile = await loadProfileRow(userId)

          if (get().user?.id === userId) {
            set({ profile })
          }

          return
        } catch (err) {
          console.error(`[QHash] Profile retry ${attempt} failed:`, err)
        }
      }
    })()
  }

  return {
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
        retryProfileInBackground(userId)
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
              retryProfileInBackground(session.user.id)
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

            const existingProfile = get().profile
            const nextUserId = newSession?.user?.id ?? null
            const existingUserId = get().user?.id ?? null

            try {
              let newProfile: Profile | null = null
              if (nextUserId) {
                newProfile = await loadProfileRow(nextUserId)
              }

              set({
                session: newSession,
                user: newSession?.user ?? null,
                profile: newProfile,
                loading: false,
              })
            } catch (err) {
              console.error('[QHash] Auth state change profile load error:', err)

              if (nextUserId) {
                retryProfileInBackground(nextUserId)
              }

              set({
                session: newSession,
                user: newSession?.user ?? null,
                profile: nextUserId && nextUserId === existingUserId ? existingProfile : null,
                loading: false,
              })
            }
          })
        }
      })()

      return initPromise
    },
  }
})
