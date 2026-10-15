import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The website's one way in, imported only by officeSurface() in
      // src/main.tsx. An alias rather than a relative path so the phone's
      // typecheck (tsconfig.phone.json) can point the same name at a stub and
      // never read src/web at all; tsconfig.app.json maps it here for the full
      // typecheck. A phone build never gets this far: VITE_SURFACE=worker
      // folds the branch that imports it away first (measured: the phone
      // bundle is byte-identical with src/web deleted).
      '@web/entry': fileURLToPath(new URL('./src/web/entry.tsx', import.meta.url)),
    },
  },
})
