import { createServerFn } from '@tanstack/react-start'
import { getAdminClient } from './supabase-admin.js'
import { throwSafe } from '../errors.js'
import type { Profile } from '../database.types.js'

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== 'object') {
    throwSafe('AUTH', 'Unable to load profile.', 'Invalid request data')
  }

  const { accessToken } = data as Record<string, unknown>
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throwSafe('AUTH', 'Unable to load profile.', 'Missing access token')
  }

  return { accessToken }
}

export const loadCurrentProfileFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }): Promise<Profile | null> => {
    const admin = getAdminClient()

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken)

    if (authError || !authUser) {
      throwSafe('AUTH', 'Unable to load profile.', 'Invalid or expired access token')
    }

    const { data: profile, error } = await admin
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (error) {
      throwSafe('AUTH', 'Unable to load profile.', `Profile query error: ${error.message}`)
    }

    return profile ?? null
  })
