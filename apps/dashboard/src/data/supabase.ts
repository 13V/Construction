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

// ------------------------------------------------- v2 row types (schema_v2)

export interface AssignmentRow {
  id: string
  company_id: string
  worker_id: string
  site_id: string
  starts_at: string
  ends_at: string
  note: string | null
  published: boolean
}

export interface SiteFileRow {
  id: string
  company_id: string
  site_id: string
  uploaded_by: string | null
  kind: 'photo' | 'document'
  storage_path: string
  name: string
  mime: string | null
  size_bytes: number | null
  category: string | null
  caption: string | null
  lat: number | null
  lng: number | null
  taken_at: string | null
  version: string | null
  supersedes: string | null
  created_at: string
}

export interface ExpenseRow {
  id: string
  company_id: string
  site_id: string | null
  submitted_by: string | null
  vendor: string
  spent_on: string
  amount: number
  tax: number
  category: string | null
  cost_code: string | null
  receipt_path: string | null
  status: 'needs_review' | 'confirmed' | 'flagged'
  ai_note: string | null
  ai_confidence: number | null
  line_items: Array<{ description: string; amount: number }>
  created_at: string
}

export interface DailyLogRow {
  id: string
  company_id: string
  site_id: string
  log_date: string
  status: 'draft' | 'confirmed'
  weather: string | null
  work_completed: string | null
  materials: string | null
  equipment_note: string | null
  issues: string | null
  extra_notes: string | null
  crew_summary: Array<{ name: string; hours: number }>
  generated_at: string | null
  confirmed_by: string | null
  confirmed_at: string | null
}

export interface ChannelRow {
  id: string
  company_id: string
  site_id: string | null
  kind: 'site' | 'dm'
  name: string
}

export interface MessageRow {
  id: string
  company_id: string
  channel_id: string
  author_id: string | null
  kind: 'user' | 'system'
  body: string
  attachment_path: string | null
  created_at: string
}

export interface EquipmentRow {
  id: string
  company_id: string
  code: string
  name: string
  type: string | null
  site_id: string | null
  operator_id: string | null
  status: 'in_use' | 'idle' | 'maintenance'
  hours_total: number
  last_used_at: string | null
  service_due: string | null
  notes: string | null
}

export interface SafetyRow {
  id: string
  company_id: string
  site_id: string | null
  worker_id: string | null
  kind: 'jha' | 'incident' | 'toolbox' | 'hazard'
  title: string
  body: string | null
  severity: 'low' | 'medium' | 'high' | null
  occurred_at: string
  photo_path: string | null
  signatures: Array<{ worker_id: string; name: string; signed_at: string }>
  status: 'open' | 'closed'
}

export interface CertificationRow {
  id: string
  company_id: string
  worker_id: string
  name: string
  expires_on: string | null
}
