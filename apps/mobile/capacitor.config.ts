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
    // The dwell engine treats a stale fix as a real one, so never let the
    // system serve a cached position.
    allowMixedContent: false,
  },
  plugins: {
    BackgroundGeolocation: {
      // Android will not grant background location without a visible
      // notification. Showing the crew when they are being tracked is the
      // right default anyway.
      notificationTitle: 'Crewline is tracking your location',
      notificationText: 'Only while you are clocked on.',
    },
  },
}

export default config
