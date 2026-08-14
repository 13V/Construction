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
  /**
   * Null for anyone who is not office staff, and that is the security model
   * rather than missing data. Since schema_v24 the wage lives in `worker_pay`,
   * whose policy is office-only, and `crew_v` left-joins it — so a captain or a
   * labourer querying the crew list gets every other column and a null here,
   * decided by Postgres rather than by a screen remembering to check a role.
   * Read it through crew_v; `workers` no longer has the column at all.
   */
  rate: number | null
  /**
   * Derived from `role` by trigger (schema_v18) and kept because every money
   * policy since schema_v14 keys off it. Writing either keeps the other in
   * step; a captain is deliberately NOT office.
   */
  is_office: boolean
  /** owner = the company. captain = the jobs they run. employee = themselves. */
  role: 'owner' | 'captain' | 'employee'
  active: boolean
  /** This worker's ordinary week. 38 under the NES; a part-timer's is less. */
  ordinary_hours: number
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
  /** Superseded by contracts.contract_sum (schema_v17). Do not write it. */
  contract_value: number | null
  /** The crew captain running this job. What captains_site() reads. */
  captain_id: string | null
  /** The job's chosen rail colour (schema_v25). Null → hash-derived. */
  colour: string | null
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
  /**
   * The crew this booking came from. Booking a crew writes one row per member
   * sharing this id, so the block can be moved or pulled off as one thing.
   */
  crew_id: string | null
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
  /** What the builder owes, GST INCLUSIVE. Unchanged meaning since schema_v4. */
  amount: number
  /** The GST portion of `amount` (schema_v15). Zero on anything raised before it. */
  tax_amount: number
  /** Generated in Postgres as amount - tax_amount. Never write it. */
  ex_tax: number
  tax_rate: number
  paid_amount: number
  status: 'draft' | 'sent' | 'paid' | 'void'
  note: string | null
  retention_pct: number
  retention_amount: number
  builder_id: string | null
  /** Stamped at issue, because a company can re-register or change details. */
  supplier_abn: string | null
  builder_abn: string | null
  /** The builder's own job or lot number. Their accounts team searches on this. */
  builder_job_ref: string | null
  /** An RCTI is raised by the recipient; the document says so on its face. */
  is_rcti: boolean
  /** The contract this claim is made against (schema_v17). */
  contract_id: string | null
  /** Set when the claim is for one specific variation rather than the base contract. */
  variation_id: string | null
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

/**
 * A variation. Called `change_orders` in the database since schema_v4 and
 * shown as "Variations" everywhere in the app, because that is the word used
 * on every Australian site — a builder asks for a VO, never a CO.
 */
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
  /** The contract this variation adds to (schema_v17). */
  contract_id: string | null
  /** Stamped by the database when status becomes approved; cleared if it moves back. */
  approved_on: string | null
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

// ----------------------------------------- v15/v17 row types (the contract)

export interface BuilderRow {
  id: string
  company_id: string
  name: string
  abn: string | null
  accounts_email: string | null
  phone: string | null
  address: string | null
  payment_terms_days: number
  default_retention_pct: number
  /** True when the BUILDER raises the invoice under an RCTI agreement. */
  rcti: boolean
  note: string | null
  active: boolean
}

/** The head contract received from the builder. One per job site (schema_v17). */
export interface ContractRow {
  id: string
  company_id: string
  site_id: string
  builder_id: string | null
  contract_no: string | null
  order_no: string | null
  title: string | null
  /** The sum as the contract states it — read with `gst_inclusive`, never alone. */
  contract_sum: number
  gst_inclusive: boolean
  gst_rate: number
  retention_pct: number
  payment_terms_days: number
  signed_on: string | null
  starts_on: string | null
  due_on: string | null
  status: 'draft' | 'active' | 'completed' | 'terminated'
  note: string | null
  created_at: string
}

/**
 * One row per job site from `job_value_v`: what the job is worth once approved
 * variations are counted, against what has been claimed and paid. Office only.
 *
 * Every figure is derived in Postgres so that no two screens can disagree
 * about it. `contract_id` is null when no contract has been entered yet, in
 * which case every money field is zero rather than absent.
 */
export interface JobValueRow {
  site_id: string
  company_id: string
  site_name: string
  contract_id: string | null
  contract_no: string | null
  order_no: string | null
  builder_id: string | null
  contract_status: ContractRow['status'] | null
  signed_on: string | null
  due_on: string | null
  retention_pct: number | null
  payment_terms_days: number | null
  gst_inclusive: boolean | null
  gst_rate: number
  contract_sum: number
  contract_sum_ex: number
  contract_sum_inc: number
  approved_variations: number
  pending_variations: number
  approved_variation_count: number
  pending_variation_count: number
  /** Contract sum plus approved variations. What the job is worth now. */
  job_value_ex: number
  job_value_inc: number
  claimed_inc: number
  claimed_ex: number
  paid_inc: number
  outstanding_inc: number
  retention_held: number
  draft_invoice_count: number
  /** Job value less what has been claimed. Negative means over-claimed. */
  to_claim_inc: number
}


// ------------------------------------------- v18 row types (roles and crews)

export interface CrewRow {
  id: string
  company_id: string
  name: string
  captain_id: string | null
  colour: string | null
  note: string | null
  active: boolean
  created_at: string
}

export interface CrewMemberRow {
  crew_id: string
  worker_id: string
  company_id: string
  added_at: string
}

// ------------------------------------ v19 row types (what happens on a job)

export interface SiteInstructionRow {
  id: string
  company_id: string
  site_id: string
  ref: string | null
  builder_ref: string | null
  received_on: string
  from_name: string | null
  from_contact_id: string | null
  how: 'verbal' | 'email' | 'site_meeting' | 'written' | 'drawing'
  instruction: string
  /** Marked when the instruction changes scope — a variation waiting to be raised. */
  is_variation: boolean
  change_order_id: string | null
  status: 'open' | 'actioned' | 'disputed' | 'closed'
  photo_path: string | null
  note: string | null
  raised_by: string | null
  created_at: string
}

export interface DefectRow {
  id: string
  company_id: string
  site_id: string
  ref: string | null
  location: string | null
  description: string
  raised_by_party: 'builder' | 'client' | 'us' | 'certifier' | 'other'
  /** Half a tiler's defect list is other trades' damage, and this decides who pays. */
  responsible: 'us' | 'builder' | 'other_trade' | 'client' | 'unknown'
  severity: 'minor' | 'major' | 'critical'
  status: 'open' | 'in_progress' | 'fixed' | 'rejected' | 'verified'
  raised_on: string
  due_on: string | null
  fixed_on: string | null
  verified_on: string | null
  verified_by: string | null
  photo_path: string | null
  fixed_photo_path: string | null
  plan_pin_id: string | null
  /** What it will cost US to fix. Never shown in the portal. */
  cost_estimate: number | null
  note: string | null
  created_by: string | null
  created_at: string
}

export interface ProgressEntryRow {
  id: string
  company_id: string
  site_id: string
  area: string
  cost_code: string | null
  unit: 'm2' | 'lm' | 'item' | 'room' | '%'
  quantity: number | null
  done_quantity: number
  pct_complete: number
  assessed_on: string
  assessed_by: string | null
  note: string | null
  created_at: string
}

/** Latest assessment per area, rolled up weighted by quantity (schema_v19). */
export interface SiteProgressRow {
  site_id: string
  area_count: number
  last_assessed_on: string | null
  pct_complete: number
  total_quantity: number
  done_quantity: number
}

/**
 * One wet area's membrane, per AS 3740. This record is the entire defence if a
 * shower leaks in two years, because the membrane is under screed and tiles
 * within a day of going in.
 */
export interface WaterproofingRow {
  id: string
  company_id: string
  site_id: string
  area: string
  product_id: string | null
  product_name: string | null
  batch_no: string | null
  substrate: string | null
  primer: string | null
  coats: number
  bond_breaker: boolean
  angle_fillet: boolean
  wall_height_mm: number | null
  started_on: string | null
  completed_on: string | null
  flood_tested: boolean
  flood_test_on: string | null
  flood_test_hours: number | null
  installer_id: string | null
  installer_licence: string | null
  status: 'planned' | 'in_progress' | 'complete' | 'signed_off' | 'failed'
  /** All three are stamped by the database from identity — never write them. */
  signed_off_by: string | null
  signed_off_at: string | null
  signed_off_name: string | null
  certificate_path: string | null
  certificate_no: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export interface WaterproofingPhotoRow {
  id: string
  company_id: string
  waterproofing_id: string
  file_id: string | null
  storage_path: string
  stage: 'substrate' | 'primer' | 'fillet' | 'membrane' | 'second_coat' | 'flood_test' | 'other'
  caption: string | null
  taken_at: string
  created_at: string
}

export interface SiteWaterproofingRow {
  site_id: string
  area_count: number
  signed_off_count: number
  failed_count: number
  outstanding_count: number
  /** Signed off with no flood test, or no photo. Certificates that will not hold. */
  unflooded_count: number
  unphotographed_count: number
  first_completed_on: string | null
  last_completed_on: string | null
}

// --------------------------------------- v20/v21 row types (money and time)

export interface JobCostRow {
  site_id: string
  company_id: string
  site_name: string
  labour_hours: number
  labour_cost: number
  material_cost: number
  expense_cost: number
  sublet_cost: number
  total_cost: number
}

/** What a job is worth, what it cost, and what that leaves. Office only, ex GST. */
export interface JobProfitRow {
  site_id: string
  company_id: string
  site_name: string
  contract_id: string | null
  contract_status: ContractRow['status'] | null
  builder_id: string | null
  contract_sum_ex: number
  approved_variations: number
  job_value_ex: number
  job_value_inc: number
  claimed_inc: number
  claimed_ex: number
  paid_inc: number
  outstanding_inc: number
  to_claim_inc: number
  retention_held: number
  labour_hours: number
  labour_cost: number
  material_cost: number
  expense_cost: number
  sublet_cost: number
  total_cost: number
  margin: number
  margin_pct: number | null
  /** What an hour on this job returned after everything that was not labour. */
  value_per_labour_hour: number | null
  unbilled_cost: number
  progress_pct: number | null
  progress_assessed_on: string | null
  claimed_pct: number | null
}

export interface CompanyOverviewRow {
  active_jobs: number
  starting_soon: number
  on_the_clock: number
  work_in_hand: number
  left_to_claim: number
  owed_to_us: number
  retention_held: number
  margin_to_date: number
  overdue_invoices: number
  overdue_amount: number
  variations_pending: number
  variations_pending_value: number
  open_defects: number
  open_instructions: number
  waterproofing_outstanding: number
  tickets_expiring: number
}

export interface ProgrammeRow {
  id: string
  company_id: string
  site_id: string
  name: string
  revision: string | null
  issued_on: string | null
  received_on: string
  source: 'pdf' | 'excel' | 'csv' | 'manual'
  file_id: string | null
  storage_path: string | null
  status: 'draft' | 'current' | 'superseded'
  import_note: string | null
  imported_by: string | null
  created_at: string
}

export interface ProgrammeTaskRow {
  id: string
  company_id: string
  programme_id: string
  site_id: string
  ref: string | null
  name: string
  trade: string | null
  starts_on: string | null
  ends_on: string | null
  duration_days: number | null
  /** Ours to do. Everything that answers "when are we on" reads this. */
  is_ours: boolean
  /** A line that must finish before we can start. What makes readiness answerable. */
  is_predecessor: boolean
  pct_complete: number
  status: 'planned' | 'in_progress' | 'done' | 'not_started' | 'slipped'
  /** Where this line sat on the PREVIOUS revision. Null on a first import. */
  prev_starts_on: string | null
  prev_ends_on: string | null
  sort: number
  note: string | null
  created_at: string
}

/** Our next window on the builder's current programme, and whether it is ready. */
export interface SiteProgrammeRow {
  site_id: string
  programme_id: string
  revision: string | null
  received_on: string
  our_task: string | null
  our_start: string | null
  our_end: string | null
  prev_starts_on: string | null
  our_status: ProgrammeTaskRow['status'] | null
  our_pct: number | null
  /** Positive means the start has moved later since the last revision. */
  start_moved_days: number | null
  days_until_start: number | null
  blockers_open: number
  blocked_by: string | null
  /** Null when the programme names no predecessors — "unknown", not "go". */
  ready: boolean | null
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
