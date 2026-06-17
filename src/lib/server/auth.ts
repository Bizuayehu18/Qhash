import { createServerFn } from '@tanstack/react-start'
import { getAdminClient } from './supabase-admin.js'
import { throwSafe } from '../errors.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types.js'

interface RegisterInput {
  username: string
  phone: string
  password: string
  referredBy?: string
}

export type RegisterUserResult =
  | {
      success: true
      email: string
    }
  | {
      success: false
      code: 'username_taken' | 'phone_taken' | 'invalid_phone'
      message: string
    }

function validateRegisterInput(data: unknown): RegisterInput {
  if (!data || typeof data !== 'object') {
    throwSafe('AUTH', 'Registration failed. Please try again.', 'Invalid request data')
  }
  const { username, phone, password, referredBy } = data as Record<string, unknown>
  if (typeof username !== 'string' || !/^[a-z0-9_]{3,30}$/.test(username)) {
    throwSafe('AUTH', 'Username must be 3–30 characters: lowercase letters, numbers, and underscores.', 'Invalid username format: ' + String(username))
  }
  if (typeof phone !== 'string') {
    throwSafe('AUTH', 'Invalid phone number format.', 'Invalid phone value type: ' + typeof phone)
  }
  if (typeof password !== 'string' || password.length < 8) {
    throwSafe('AUTH', 'Password must be at least 8 characters.', 'Password too short')
  }
  return {
    username,
    phone,
    password,
    referredBy: typeof referredBy === 'string' && referredBy.length > 0 ? referredBy : undefined,
  }
}

function phoneToEmail(phone: string): string {
  return phone.replace(/\D/g, '') + '@qhash.app'
}

async function buildReferralChain(
  admin: SupabaseClient<Database>,
  newUserId: string,
  referrerId: string,
): Promise<void> {
  if (referrerId === newUserId) {
    return
  }

  const inserted: Array<{ level: number; referrer: string }> = []

  // Level 1: direct referrer -> new user
  const { error: l1Err, status: l1Status } = await admin.from('referrals').upsert(
    { referrer_id: referrerId, referred_user_id: newUserId, level: 1 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (l1Err) {
    return
  }
  if (l1Status === 201) {
    inserted.push({ level: 1, referrer: referrerId })
  }

  // Level 2: referrer's referrer -> new user
  const { data: l1Profile } = await admin
    .from('profiles')
    .select('referred_by')
    .eq('id', referrerId)
    .maybeSingle()

  const l2Id = l1Profile?.referred_by
  if (!l2Id) {
    return
  }
  if (l2Id === newUserId || l2Id === referrerId) {
    return
  }

  const { error: l2Err, status: l2Status } = await admin.from('referrals').upsert(
    { referrer_id: l2Id, referred_user_id: newUserId, level: 2 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (l2Err) {
    return
  }
  if (l2Status === 201) {
    inserted.push({ level: 2, referrer: l2Id })
  }

  // Level 3: referrer's referrer's referrer -> new user
  const { data: l2Profile } = await admin
    .from('profiles')
    .select('referred_by')
    .eq('id', l2Id)
    .maybeSingle()

  const l3Id = l2Profile?.referred_by
  if (!l3Id) {
    return
  }
  if (l3Id === newUserId || l3Id === referrerId || l3Id === l2Id) {
    return
  }

  const { error: l3Err, status: l3Status } = await admin.from('referrals').upsert(
    { referrer_id: l3Id, referred_user_id: newUserId, level: 3 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (!l3Err && l3Status === 201) {
    inserted.push({ level: 3, referrer: l3Id })
  }

  void inserted
}

export const registerUserFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => validateRegisterInput(data))
  .handler(async ({ data }): Promise<RegisterUserResult> => {
    const { username, phone, password, referredBy } = data

    if (!/^\+251[79]\d{8}$/.test(phone)) {
      return {
        success: false,
        code: 'invalid_phone',
        message: 'Invalid phone number format.',
      }
    }

    const admin = getAdminClient()

    const { data: takenUsername } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (takenUsername) {
      return {
        success: false,
        code: 'username_taken',
        message: 'That username is already taken.',
      }
    }

    const { data: takenPhone } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()

    if (takenPhone) {
      return {
        success: false,
        code: 'phone_taken',
        message: 'That phone number is already registered.',
      }
    }

    let referrerId: string | null = null
    if (referredBy && referredBy !== username) {
      const { data: referrer } = await admin
        .from('profiles')
        .select('id')
        .eq('username', referredBy)
        .maybeSingle()
      if (referrer) {
        referrerId = referrer.id
      }
    }

    const email = phoneToEmail(phone)
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, phone },
    })

    if (authErr || !authData.user) {
      console.error('[QHash] Auth createUser error:', authErr?.message)
      throwSafe('AUTH', 'Account creation failed. Please try again.', `Supabase auth error: ${authErr?.message}`)
    }

    const userId = authData.user.id

    const { error: profileErr } = await admin.from('profiles').insert({
      id: userId,
      username,
      phone,
      referred_by: referrerId,
    })

    if (profileErr) {
      if (referrerId) {
        console.error(`[QHash Referral] Profile insert failed with referral (referrer=${referrerId}), retrying without: ${profileErr.message}`)
        const { error: retryErr } = await admin.from('profiles').insert({
          id: userId,
          username,
          phone,
          referred_by: null,
        })
        if (retryErr) {
          await admin.auth.admin.deleteUser(userId)
          console.error('[QHash] Profile insert error (retry without referral):', retryErr.message)
          throwSafe('AUTH', 'Account creation failed. Please try again.', `Profile insert error: ${retryErr.message}`)
        }
        return { success: true, email }
      }

      await admin.auth.admin.deleteUser(userId)
      console.error('[QHash] Profile insert error:', profileErr.message)
      throwSafe('AUTH', 'Account creation failed. Please try again.', `Profile insert error: ${profileErr.message}`)
    }

    // Build referral chain server-side (DB trigger also creates rows as backup;
    // upsert with ignoreDuplicates ensures no double-inserts)
    if (referrerId) {
      try {
        await buildReferralChain(admin, userId, referrerId)
      } catch (chainErr) {
        console.error(`[QHash Referral] CHAIN uncaught-error: newUser=${userId} referrer=${referrerId}`, chainErr)
      }
    }

    return { success: true, email }
  })
