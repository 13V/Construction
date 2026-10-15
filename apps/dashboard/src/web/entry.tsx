/**
 * The website's only way in. main.tsx's officeSurface() lazy-loads this as
 * '@web/entry' (vite.config.ts, tsconfig.app.json); nothing else outside
 * src/web may import anything in it (boundary.test.ts).
 *
 * The phone build never reaches this file: VITE_SURFACE=worker folds the
 * branch that imports it away, and its typecheck (tsconfig.phone.json) maps
 * '@web/entry' to a null stub. The phone-fingerprint gate proves the iOS
 * bundle is byte-identical with or without everything under src/web.
 *
 * main.tsx renders the default export with no props.
 */
import { WebApp } from './WebApp'

export default function WebEntry() {
  return <WebApp />
}
