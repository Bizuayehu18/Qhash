import { createServerFn } from '@tanstack/react-start'
import { getAdminClient } from './supabase-admin.js'
import { throwSafe } from '../errors.js'

export const getPlansFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const admin = getAdminClient()

    const { data, error } = await admin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('investment_amount', { ascending: true })

    if (error) {
      console.error('[QHash] Plans load error:', error.message)
      throwSafe('SERVER', 'Failed to load plans.', `DB error: ${error.message}`)
    }

    return data ?? []
  })

export const getPlanByIdFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== 'object') throwSafe('SERVER', 'Failed to load plan.', 'Invalid request data')
    const { planId } = data as Record<string, unknown>
    if (typeof planId !== 'string' || planId.length === 0) throwSafe('SERVER', 'Failed to load plan.', 'Missing plan ID')
    return { planId }
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient()

    const { data: plan, error } = await admin
      .from('plans')
      .select('*')
      .eq('id', data.planId)
      .eq('is_active', true)
      .single()

    if (error || !plan) {
      throwSafe('SERVER', 'Plan not found.', `Plan query error: ${error?.message}`)
    }

    return plan
  })
