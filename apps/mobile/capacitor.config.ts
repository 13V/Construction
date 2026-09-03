import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The web assets are bundled rather than pointed at the hosted URL, because a
 * job site is exactly where the signal drops. The app has to open, show the
 * clock and queue fixes with no network; it syncs when the phone finds one.
 *
 * The trade is that a web deploy no longer reaches installed phones on its
 * own — shipping UI changes means `npm run sync` and a new build.
 */
const config: CapacitorConfig = {
  appId: 'app.crewline.worker',
  appName: 'Crewline',
  webDir: '../dashboard/dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      // Shrink the webview above the keyboard instead of letting iOS pan the
      // whole page — panning shoved the header off-screen and did not always
      // pan back after the keyboard closed.
      resize: 'native',
    },
  },
}

export default config
