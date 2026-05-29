import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PREFIX = `test_ref_${Date.now()}_`
const testUsers: Array<{ id: string; username: string; email: string }> = []
let phoneSeq = 0

async function createTestUser(
  username: string,
  referredBy: string | null,
): Promise<string> {
  const email = `${username}@test-referral.local`
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
    user_metadata: { username, phone: '+251900000000' },
  })
  if (authErr || !authData.user) throw new Error(`Auth create failed for ${username}: ${authErr?.message}`)
  const userId = authData.user.id
  testUsers.push({ id: userId, username, email })

  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    username,
    phone: `+2519${String(Date.now()).slice(-5)}${String(++phoneSeq).padStart(4, '0')}`,
    referred_by: referredBy,
  })
  if (profileErr) throw new Error(`Profile insert failed for ${username}: ${profileErr.message}`)

  return userId
}

async function buildReferralChain(
  newUserId: string,
  referrerId: string,
): Promise<void> {
  if (referrerId === newUserId) {
    console.log(`  [CHAIN] circular-loop-prevented: self-referral`)
    return
  }
  console.log(`  [CHAIN] start: newUser=${newUserId} directReferrer=${referrerId}`)

  // Level 1
  const { error: l1Err, status: l1Status } = await admin.from('referrals').upsert(
    { referrer_id: referrerId, referred_user_id: newUserId, level: 1 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (l1Err) { console.log(`  [CHAIN] level-1-error: ${l1Err.message}`); return }
  console.log(`  [CHAIN] level-1: ${l1Status === 201 ? 'inserted' : 'duplicate-skipped'}`)

  // Level 2
  const { data: l1Profile } = await admin
    .from('profiles').select('referred_by').eq('id', referrerId).maybeSingle()
  const l2Id = l1Profile?.referred_by
  if (!l2Id || l2Id === newUserId || l2Id === referrerId) {
    console.log(`  [CHAIN] level-2-skipped: ${l2Id ? 'circular' : 'no upline'}`)
    return
  }
  const { error: l2Err, status: l2Status } = await admin.from('referrals').upsert(
    { referrer_id: l2Id, referred_user_id: newUserId, level: 2 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (l2Err) { console.log(`  [CHAIN] level-2-error: ${l2Err.message}`); return }
  console.log(`  [CHAIN] level-2: ${l2Status === 201 ? 'inserted' : 'duplicate-skipped'}`)

  // Level 3
  const { data: l2Profile } = await admin
    .from('profiles').select('referred_by').eq('id', l2Id).maybeSingle()
  const l3Id = l2Profile?.referred_by
  if (!l3Id || l3Id === newUserId || l3Id === referrerId || l3Id === l2Id) {
    console.log(`  [CHAIN] level-3-skipped: ${l3Id ? 'circular' : 'no upline'}`)
    return
  }
  const { error: l3Err, status: l3Status } = await admin.from('referrals').upsert(
    { referrer_id: l3Id, referred_user_id: newUserId, level: 3 },
    { onConflict: 'referrer_id,referred_user_id', ignoreDuplicates: true },
  )
  if (l3Err) { console.log(`  [CHAIN] level-3-error: ${l3Err.message}`); return }
  console.log(`  [CHAIN] level-3: ${l3Status === 201 ? 'inserted' : 'duplicate-skipped'}`)
}

async function cleanup() {
  console.log('\n--- CLEANUP ---')
  for (const u of testUsers) {
    await admin.from('referrals').delete().or(`referrer_id.eq.${u.id},referred_user_id.eq.${u.id}`)
  }
  for (const u of testUsers) {
    await admin.from('profiles').delete().eq('id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  console.log(`Cleaned up ${testUsers.length} test users and their referral rows`)
}

async function queryReferrals(userIds: string[]): Promise<void> {
  const { data, error } = await admin
    .from('referrals')
    .select('referrer_id, referred_user_id, level')
    .or(userIds.map((id) => `referred_user_id.eq.${id}`).join(','))
    .order('level', { ascending: true })
  if (error) { console.log(`  Query error: ${error.message}`); return }
  console.log(`  Referral rows found: ${data.length}`)
  const usernameMap = new Map(testUsers.map((u) => [u.id, u.username]))
  for (const row of data) {
    console.log(`    ${usernameMap.get(row.referrer_id) ?? row.referrer_id} -> ${usernameMap.get(row.referred_user_id) ?? row.referred_user_id} (level ${row.level})`)
  }
}

async function run() {
  let passed = 0
  let failed = 0

  try {
    // ==================== TEST 1: A -> B ====================
    console.log('\n===== TEST 1: A invites B =====')
    const aId = await createTestUser(PREFIX + 'user_a', null)
    console.log(`  Created A: ${aId}`)

    const bId = await createTestUser(PREFIX + 'user_b', aId)
    console.log(`  Created B: ${bId} (referred_by A)`)

    await buildReferralChain(bId, aId)

    console.log('\n  Expected: A -> B level 1')
    await queryReferrals([bId])

    const { data: t1 } = await admin.from('referrals')
      .select('*').eq('referrer_id', aId).eq('referred_user_id', bId).eq('level', 1).maybeSingle()
    if (t1) { console.log('  ✓ TEST 1 PASSED: A -> B level 1 exists'); passed++ }
    else { console.log('  ✗ TEST 1 FAILED: A -> B level 1 missing'); failed++ }

    // ==================== TEST 2: A -> B -> C ====================
    console.log('\n===== TEST 2: B invites C (chain: A -> B -> C) =====')
    const cId = await createTestUser(PREFIX + 'user_c', bId)
    console.log(`  Created C: ${cId} (referred_by B)`)

    await buildReferralChain(cId, bId)

    console.log('\n  Expected: B -> C level 1, A -> C level 2')
    await queryReferrals([cId])

    const { data: t2a } = await admin.from('referrals')
      .select('*').eq('referrer_id', bId).eq('referred_user_id', cId).eq('level', 1).maybeSingle()
    const { data: t2b } = await admin.from('referrals')
      .select('*').eq('referrer_id', aId).eq('referred_user_id', cId).eq('level', 2).maybeSingle()
    if (t2a && t2b) { console.log('  ✓ TEST 2 PASSED: B->C L1 + A->C L2'); passed++ }
    else { console.log(`  ✗ TEST 2 FAILED: B->C L1=${!!t2a} A->C L2=${!!t2b}`); failed++ }

    // ==================== TEST 3: A -> B -> C -> D ====================
    console.log('\n===== TEST 3: C invites D (chain: A -> B -> C -> D) =====')
    const dId = await createTestUser(PREFIX + 'user_d', cId)
    console.log(`  Created D: ${dId} (referred_by C)`)

    await buildReferralChain(dId, cId)

    console.log('\n  Expected: C -> D level 1, B -> D level 2, A -> D level 3')
    await queryReferrals([dId])

    const { data: t3a } = await admin.from('referrals')
      .select('*').eq('referrer_id', cId).eq('referred_user_id', dId).eq('level', 1).maybeSingle()
    const { data: t3b } = await admin.from('referrals')
      .select('*').eq('referrer_id', bId).eq('referred_user_id', dId).eq('level', 2).maybeSingle()
    const { data: t3c } = await admin.from('referrals')
      .select('*').eq('referrer_id', aId).eq('referred_user_id', dId).eq('level', 3).maybeSingle()
    if (t3a && t3b && t3c) { console.log('  ✓ TEST 3 PASSED: C->D L1 + B->D L2 + A->D L3'); passed++ }
    else { console.log(`  ✗ TEST 3 FAILED: C->D L1=${!!t3a} B->D L2=${!!t3b} A->D L3=${!!t3c}`); failed++ }

    // ==================== TEST 4: Duplicate prevention ====================
    console.log('\n===== TEST 4: Duplicate insert (re-run chain for B) =====')
    await buildReferralChain(bId, aId)
    const { data: dupes } = await admin.from('referrals')
      .select('*').eq('referrer_id', aId).eq('referred_user_id', bId)
    if (dupes && dupes.length === 1) { console.log('  ✓ TEST 4 PASSED: No duplicate rows'); passed++ }
    else { console.log(`  ✗ TEST 4 FAILED: Expected 1 row, found ${dupes?.length}`); failed++ }

    // ==================== FULL DUMP ====================
    console.log('\n===== FULL REFERRAL TABLE DUMP =====')
    await queryReferrals([bId, cId, dId])

    console.log(`\n===== RESULTS: ${passed} passed, ${failed} failed =====`)
  } finally {
    await cleanup()
  }

  process.exit(failed > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1) })
