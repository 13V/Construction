/**
 * Everything the website shares with the phone app, light enough for the
 * website's eager code: the shell, the kit, the sign-in and the router may
 * import from here.
 *
 * This file and ./phone-features.ts are the only two places in src/web that
 * reach into phone-side code (boundary.test.ts fails the build otherwise).
 * That keeps the surface the website depends on in one greppable list: a
 * change to anything named below is a change to the iOS app, and has to go
 * through the phone-fingerprint gate as one.
 *
 * Re-exports only, nothing renamed or wrapped. A job must read the same on
 * both surfaces, so the website uses the phone's own formatters (addressLine,
 * builderOf, railOf, siteSpan) rather than lookalikes.
 *
 * Feature hooks and the phone's own panels are in ./phone-features.ts, which
 * only lazily loaded pages import.
 */

// The Simple design: palette, job rail colours, how a job names itself.
export {
  s,
  sFont,
  JOB_COLOURS,
  jobColour,
  railOf,
  AV_GREYS,
  avatarGrey,
  addressLine,
  builderOf,
  streetLine,
  ticketTone,
  TICKET_HELD,
  TICKET_MISSING,
  CERT_WARN_DAYS,
} from '../worker/simple/stheme'

// The data hook every phone screen reads, and the date span rule.
export { useSimpleData, siteSpan, type SimpleData, type SpanRows } from '../worker/simple/data'

// The one Supabase client (one sb- session key, shared with /worker) and its row types.
export {
  supabase,
  supabaseConfigured,
  type WorkerRow,
  type JobSiteRow,
  type AssignmentRow,
  type ShiftRow,
  type SiteFileRow,
  type SelectionRow,
  type BuilderRow,
  type PlanPinRow,
  type CrewRow,
  type DefectRow,
  type ChannelRow,
  type CertificationRow,
  type ProgrammeTaskRow,
  type SiteProgrammeRow,
  type WaterproofingRow,
  type SiteWaterproofingRow,
} from '../data/supabase'

// Storage: object keys are <company>/<site>/..., which the storage policies check.
export { BUCKET_FILES, BUCKET_RECEIPTS, objectPath, uploadFile, signedUrl, removeFile } from '../data/storage'

// Our serverless functions. The base is empty on the web, so calls are same-origin.
export { api } from '../data/api'

// Where a map opens, and its tiles.
export { DEFAULT_CENTER, MAP_STYLE_URL } from '../data/mapconfig'

// True-metre geometry for fences.
export { distanceM, offset } from '../geofence/geo'

// The session and the workers row it maps to, including the bootstrap that
// finishes a company sign-up after the confirmation email.
export { useSession, type SessionState } from '../auth/useSession'

// Where every file opens. WebApp mounts the host once; viewFile does nothing without it.
export { viewFile, FileViewerHost, type ViewableFile } from '../worker/simple/FileViewer'

// Auth errors in words a person can act on (tested in SignIn.test.ts).
export { readableAuthError } from '../worker/simple/SignIn'
