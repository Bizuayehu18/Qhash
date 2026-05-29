import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types.js'

let _adminClient: ReturnType<typeof createClient<Database>> | null = null

export function getAdminClient() {
  if (_adminClient) return _adminClient

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) {
    throw new Error('Server is not configured. Contact support.')
  }
  _adminClient = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _adminClient
}
