import { createServerFn } from '@tanstack/react-start'
import { getAdminClient } from './supabase-admin.js'
import { throwSafe } from '../errors.js'
import type { Plan } from '../database.types.js'

export interface PlanEligibility {
  activePlanCount: number
  maxActivePerUser: number
  activeLevel1Referrals: number
  activeLevel2Referrals: number
  activeLevel3Referrals: number
  requiredLevel1Referrals: number
  requiredLevel2Referrals: number
  requiredLevel3Referrals: number
  limitReached: boolean
  referralRequirementMet: boolean
  isEligible: boolean
}

export type PlanWithEligibility = Plan & {
  eligibility: PlanEligibility
}

function validateOptionalAccessToken(data: unknown): { accessToken: string | null } {
  if (!data || typeof data !== 'object') return { accessToken: null }
  const { accessToken } = data as Record<string, unknown>
  return { accessToken: typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null }
}

function buildDefaultEligibility(plan: Plan): PlanEligibility {
  return {
    activePlanCount: 0,
    maxActivePerUser: plan.max_active_per_user,
    activeLevel1Referrals: 0,
    activeLevel2Referrals: 0,
    activeLevel3Referrals: 0,
    requiredLevel1Referrals: plan.required_active_level1_referrals,
    requiredLevel2Referrals: plan.required_active_level2_referrals,
    requiredLevel3Referrals: plan.required_active_level3_referrals,
    limitReached: false,
    referralRequirementMet:
      plan.required_active_level1_referrals === 0 &&
      plan.required_active_level2_referrals === 0 &&
      plan.required_active_level3_referrals === 0,
    isEligible:
      plan.required_active_level1_referrals === 0 &&
      plan.required_active_level2_referrals === 0 &&
      plan.required_active_level3_referrals === 0,
  }
}

export const getPlansFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const admin = getAdminClient()

    const { data, error } = await admin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('investment_amount', { ascending: true })

    if (error) {
      console.error('[QHash] Plans load error:', error.message)
      throwSafe('SERVER', 'Failed to load plans.', `DB error: ${error.message}`)
    }

    return data ?? []
  })

export const getPlansWithEligibilityFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => validateOptionalAccessToken(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient()

    const { data: plans, error } = await admin
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('investment_amount', { ascending: true })

    if (error) {
      console.error('[QHash] Plans load error:', error.message)
      throwSafe('SERVER', 'Failed to load plans.', `DB error: ${error.message}`)
    }

    const planRows = plans ?? []
    if (planRows.length === 0) return []

    let userId: string | null = null
    if (data.accessToken) {
      const {
        data: { user: authUser },
        error: authError,
      } = await admin.auth.getUser(data.accessToken)

      if (!authError && authUser) {
        userId = authUser.id
      } else {
        console.warn('[QHash] Plan eligibility auth failed:', authError?.message)
      }
    }

    if (!userId) {
      return planRows.map((plan) => ({
        ...plan,
        eligibility: buildDefaultEligibility(plan),
      })) satisfies PlanWithEligibility[]
    }

    const { data: userInvestments, error: investmentsError } = await admin
      .from('investments')
      .select('plan_id')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (investmentsError) {
      console.error('[QHash] Plan eligibility investments load error:', investmentsError.message)
      throwSafe('SERVER', 'Failed to load plan eligibility.', `DB error: ${investmentsError.message}`)
    }

    const activeCountByPlan = new Map<string, number>()
    for (const inv of userInvestments ?? []) {
      activeCountByPlan.set(inv.plan_id, (activeCountByPlan.get(inv.plan_id) ?? 0) + 1)
    }

    const { data: referralRows, error: referralsError } = await admin
      .from('referrals')
      .select('level, referred_user_id')
      .eq('referrer_id', userId)
      .gte('level', 1)
      .lte('level', 3)

    if (referralsError) {
      console.error('[QHash] Plan eligibility referrals load error:', referralsError.message)
      throwSafe('SERVER', 'Failed to load plan eligibility.', `DB error: ${referralsError.message}`)
    }

    const referredIds = Array.from(new Set((referralRows ?? []).map((row) => row.referred_user_id)))
    const activeReferredIds = new Set<string>()

    if (referredIds.length > 0) {
      const { data: activeReferralInvestments, error: activeReferralError } = await admin
        .from('investments')
        .select('user_id')
        .in('user_id', referredIds)
        .eq('status', 'active')

      if (activeReferralError) {
        console.error('[QHash] Active referral investments load error:', activeReferralError.message)
        throwSafe('SERVER', 'Failed to load plan eligibility.', `DB error: ${activeReferralError.message}`)
      }

      for (const inv of activeReferralInvestments ?? []) {
        activeReferredIds.add(inv.user_id)
      }
    }

    const activeReferralCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
    for (const level of [1, 2, 3]) {
      const idsForLevel = new Set(
        (referralRows ?? [])
          .filter((row) => row.level === level && activeReferredIds.has(row.referred_user_id))
          .map((row) => row.referred_user_id),
      )
      activeReferralCounts[level] = idsForLevel.size
    }

    return planRows.map((plan) => {
      const activePlanCount = activeCountByPlan.get(plan.id) ?? 0
      const limitReached = activePlanCount >= plan.max_active_per_user
      const referralRequirementMet =
        activeReferralCounts[1] >= plan.required_active_level1_referrals &&
        activeReferralCounts[2] >= plan.required_active_level2_referrals &&
        activeReferralCounts[3] >= plan.required_active_level3_referrals

      return {
        ...plan,
        eligibility: {
          activePlanCount,
          maxActivePerUser: plan.max_active_per_user,
          activeLevel1Referrals: activeReferralCounts[1],
          activeLevel2Referrals: activeReferralCounts[2],
          activeLevel3Referrals: activeReferralCounts[3],
          requiredLevel1Referrals: plan.required_active_level1_referrals,
          requiredLevel2Referrals: plan.required_active_level2_referrals,
          requiredLevel3Referrals: plan.required_active_level3_referrals,
          limitReached,
          referralRequirementMet,
          isEligible: !limitReached && referralRequirementMet,
        },
      }
    }) satisfies PlanWithEligibility[]
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
