import type { User } from '@supabase/supabase-js'
import type { Profile } from './database.types.js'

function readUserValue(user: User | null | undefined, key: string): string | null {
  const data = user?.['user_metadata' as keyof User] as Record<string, unknown> | null | undefined
  const value = data?.[key]

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function getDisplayUsername(profile: Profile | null | undefined, user: User | null | undefined): string {
  return profile?.username || readUserValue(user, 'username') || 'User'
}

export function getDisplayPhone(profile: Profile | null | undefined, user: User | null | undefined): string {
  return profile?.phone || readUserValue(user, 'phone') || ''
}

export function getDisplayInitial(profile: Profile | null | undefined, user: User | null | undefined): string {
  return getDisplayUsername(profile, user)[0]?.toUpperCase() ?? 'U'
}
