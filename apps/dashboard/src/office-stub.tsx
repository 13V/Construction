/**
 * What the phone's typecheck sees in place of the website: nothing.
 *
 * tsconfig.phone.json maps '@web/entry' here, so the program that gates a
 * TestFlight build (npm run build:phone) never reads src/web, and website-only
 * type errors cannot fail it. Never rendered: the phone build drops
 * officeSurface() before anything is imported, and every other build resolves
 * '@web/entry' to src/web/entry.tsx (vite.config.ts, tsconfig.app.json).
 *
 * The same shape as the real entry, a default-exported component with no
 * props, so main.tsx typechecks identically against either.
 */
export default function OfficeStub() {
  return null
}
