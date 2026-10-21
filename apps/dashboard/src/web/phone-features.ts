/**
 * The phone's feature hooks and screens, for the website's lazily loaded
 * pages only.
 *
 * These modules are large (the waterproofing panel, the safety shelves, the
 * schedule, the team and business sheets) and pull in PDF builders and the
 * like. Importing this file from eager code (WebApp, the shell, the kit, the
 * sign-in, anything entry.tsx reaches without a dynamic import) would put all
 * of it in the first download, so boundary.test.ts walks the static import
 * graph from entry.tsx and fails if this file is on it.
 *
 * The phone's own panels are mounted unchanged inside shell/Contained.tsx, a
 * transform:translateZ(0) host that keeps their bottom sheets inside it. No
 * prop is ever added to a phone component for the website's sake: even a
 * default-valued one changes the iOS bundle's bytes.
 */

// The builder's programme: the current revision and the one-line summary.
export { useProgrammes, programmeLine, type ProgrammeRow } from '../worker/simple/Programme'

// Waterproofing: the package, its six steps, and the phone's own panel.
export {
  useWaterproofing,
  stepsOf,
  WaterproofingPanel,
  type WpPackageRow,
  type WpFile,
  type Step,
  type StepKey,
  type FloodResult,
} from '../worker/simple/Waterproofing'

// Safety: the four shelves, their states, and the phone's own Safety tab.
export {
  useSafety,
  SHELVES,
  docState,
  shelfState,
  SafetyTab,
  type SafetyDoc,
  type ShelfKind,
  type DocState,
} from '../worker/simple/Safety'

// How a drawing's sheet number groups into a level.
export { levelOf } from '../worker/PlansScreen'

// The company: ABN check, what is still missing, and the phone's Business sheet.
export { abnLooksValid, complianceGaps, BusinessSheet } from '../worker/simple/Business'

// The phone's Team sheet.
export { TeamSheet } from '../worker/simple/Team'

// The PDF writer the phone prints its SWMS and certificates with: the
// website prints a spreadsheet programme's lines with it (data/programmePdf.ts).
export { Page, buildPdf, table, LEFT, RIGHT, WIDTH, type Cell, type TableColumn } from '../data/pdf'

// The phone's schedule (Quarter, Month, Week, Day), and the tab names its
// onOpenJob passes, which are the phone's tabs rather than the website's.
export { SimpleSchedule } from '../worker/simple/Schedule'
export type { JobTab as PhoneJobTab } from '../worker/simple/Job'

// ---- Photos: what the website's Photos tab (job/tabs/PhotosTab.tsx) shares with the phone.

// ---- Chat: what the website's Chat tab and Chat page share with the phone.

// ---- Money: what the website's Money tab (job/tabs/MoneyTab.tsx) shares with the phone.
