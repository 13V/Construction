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
    Keyboard: {
      // Shrink the webview above the keyboard instead of letting iOS pan the
      // whole page — panning shoved the header off-screen and did not always
      // pan back after the keyboard closed.
      resize: 'native',
    },
    BackgroundGeolocation: {
      // Android will not grant background location without a visible
      // notification. Showing the crew when they are being tracked is the
      // right default anyway.
      notificationTitle: 'Crewline is tracking your location',
      // Was "Only while you are clocked on" — false. This notification is live
      // from the START TRACKING tap, well before any clock-in (the drive to
      // site, the arrival dwell), and every fix it produces is sent and
      // stored, not only ones near a site. See src/worker/location.ts for the
      // matching fix to the watcher's own backgroundMessage.
      notificationText: 'Recording your location while tracking is on. Tap to open.',
    },
  },
}

export default config
