import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase.js'
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

let listenerRegistered = false
let initPromise: Promise<void> | null = null

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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error) {
        console.error('[QHash] Failed to load profile:', error.message)
      }
      set({ profile: data ?? null })
    } catch (err) {
      console.error('[QHash] Profile load error:', err)
      set({ profile: null })
    }
  },

  signOut: async () => {
    set({ session: null, user: null, profile: null, loading: false })
    try {
      await supabase.auth.signOut()
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
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 8000)
          ),
        ])

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
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single()
            profile = data ?? null
          } catch {
            // Profile load failed — continue without it
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
              const { data } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', newSession.user.id)
                .single()
              newProfile = data ?? null
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
