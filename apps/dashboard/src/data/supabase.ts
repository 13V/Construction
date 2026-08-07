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
  budget: number | null
  client_name: string | null
  progress_pct: number | null
  schedule_note: string | null
  contract_value: number | null
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
  /** Unpaid break the worker recorded on their own shift. */
  break_minutes: number
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
  po_id: string | null
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

export interface MaterialRow {
  id: string
  company_id: string
  site_id: string
  name: string
  quantity: number
  unit: string
  unit_cost: number
  /** Generated in Postgres as round(quantity * unit_cost, 2) — never write it. */
  total_cost: number
  supplier: string | null
  cost_code: string | null
  status: 'ordered' | 'delivered' | 'used' | 'returned'
  ordered_on: string | null
  delivered_on: string | null
  expense_id: string | null
  note: string | null
  created_by: string | null
  created_at: string
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

// ------------------------------------------------- v4 row types (schema_v4)

export interface EstimateRow {
  id: string
  company_id: string
  site_id: string | null
  client_name: string
  title: string
  revision: number
  parent_id: string | null
  status: 'draft' | 'awaiting_approval' | 'approved' | 'rejected' | 'superseded'
  note: string | null
  sent_at: string | null
  created_at: string
}

export interface EstimateLineRow {
  id: string
  estimate_id: string
  cost_code: string | null
  name: string
  qty: number
  unit: string
  unit_price: number
  markup_pct: number
  /** Generated in Postgres: qty * unit_price * (1 + markup/100). Never write it. */
  line_total: number
  sort: number
}

export interface PurchaseOrderRow {
  id: string
  company_id: string
  site_id: string | null
  po_no: string
  vendor: string
  issued_on: string
  expected_on: string | null
  status: 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled'
  note: string | null
}

export interface PoLineRow {
  id: string
  po_id: string
  name: string
  ordered_qty: number
  received_qty: number
  unit: string
  unit_cost: number
  /** Generated: ordered_qty * unit_cost. */
  line_total: number
  cost_code: string | null
  sort: number
}

export interface InvoiceRow {
  id: string
  company_id: string
  site_id: string | null
  invoice_no: string
  client_name: string
  period: string | null
  issued_on: string
  due_on: string | null
  amount: number
  paid_amount: number
  status: 'draft' | 'sent' | 'paid' | 'void'
  note: string | null
  retention_pct: number
  retention_amount: number
}

/**
 * A payment against an invoice. `invoices.paid_amount` and `status` are
 * derived from these rows by trigger (schema_v9.sql), so this ledger is the
 * only thing that should ever be written — patching paid_amount directly is
 * overwritten the next time a payment moves.
 */
export interface InvoicePaymentRow {
  id: string
  company_id: string
  invoice_id: string
  amount: number
  received_on: string
  method: 'bank' | 'card' | 'cash' | 'cheque' | 'other'
  reference: string | null
  note: string | null
  created_at: string
}

export interface InvoiceLineRow {
  id: string
  invoice_id: string
  cost_code: string | null
  description: string
  pct_complete: number | null
  amount: number
  sort: number
}

export interface ChangeOrderRow {
  id: string
  company_id: string
  site_id: string | null
  co_no: string
  description: string
  detail: string | null
  cost_impact: number
  days_impact: number
  status: 'draft' | 'pending_client' | 'approved' | 'rejected'
  raised_on: string
  signature: { name: string; signed_at: string } | null
}

export interface ChangeOrderLineRow {
  id: string
  change_order_id: string
  cost_code: string | null
  name: string
  detail: string | null
  amount: number
  sort: number
}

export interface MilestoneRow {
  id: string
  company_id: string
  site_id: string
  name: string
  due_on: string | null
  done_on: string | null
  sort: number
}

export interface SelectionRow {
  id: string
  company_id: string
  site_id: string
  name: string
  detail: string | null
  needed_by: string | null
  status: 'pending' | 'chosen'
  chosen: string | null
  chosen_at: string | null
}

export interface PortalContactRow {
  id: string
  company_id: string
  site_id: string | null
  auth_user_id: string | null
  kind: 'client' | 'sub'
  name: string
  org: string | null
  invite_email: string | null
  active: boolean
}

export interface TimeOffRow {
  id: string
  company_id: string
  worker_id: string
  kind: 'annual' | 'personal' | 'unpaid' | 'other'
  starts_on: string
  ends_on: string
  hours: number | null
  reason: string | null
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export interface ShiftCorrectionRow {
  id: string
  company_id: string
  shift_id: string | null
  worker_id: string
  reason_code: 'parked_offsite' | 'access_changed' | 'blocked' | 'forgot' | 'other'
  detail: string | null
  requested_start: string | null
  requested_end: string | null
  status: 'open' | 'accepted' | 'rejected'
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
}

export interface PlanPinRow {
  id: string
  company_id: string
  site_id: string
  file_id: string
  x: number
  y: number
  kind: 'issue' | 'photo' | 'note'
  label: string
  photo_id: string | null
  created_by: string | null
  created_at: string
}

export interface NotificationRow {
  id: string
  company_id: string
  worker_id: string | null
  kind:
    | 'roster_published'
    | 'leave_decided'
    | 'correction_raised'
    | 'correction_decided'
    | 'timeoff_requested'
    | 'shift_flagged'
  title: string
  body: string | null
  link_nav: string | null
  read_at: string | null
  created_at: string
}
