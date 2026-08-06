import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

/** Browser Supabase client. Throws if the app was built without credentials. */
export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !anonKey) {
      throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required')
    }
    client = createClient(url, anonKey)
  }
  return client
}

// ------------------------------------------------------------------ row types

export interface WorkerRow {
  id: string
  company_id: string
  auth_user_id: string | null
  name: string
  initials: string
  trade: string
  rate: number
  is_office: boolean
  active: boolean
}

export interface JobSiteRow {
  id: string
  company_id: string
  name: string
  address: string
  job_type: string
  status: 'active' | 'starting_soon' | 'archived'
  lat: number
  lng: number
  radius_m: number
}

export interface PositionRow {
  worker_id: string
  at: string
  lat: number
  lng: number
  accuracy_m: number | null
}

export interface ShiftRow {
  id: string
  worker_id: string
  site_id: string | null
  started_at: string
  ended_at: string | null
  cost_code: string | null
  source: 'auto' | 'manual'
  edited: boolean
  approved_at: string | null
}

export interface EventRow {
  id: number
  worker_id: string
  site_id: string | null
  at: string
  kind: string
  message: string
}
