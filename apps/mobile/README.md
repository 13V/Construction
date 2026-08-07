# Crewline — native shell

This exists for one reason: **background location**.

Everything a worker sees is the same React app served at `/worker`. Mobile web
cannot keep the product's central promise — `navigator.geolocation.watchPosition`
stops the moment the phone locks, which is most of a working day, so a worker
who pockets their phone stops being tracked and loses hours. A native wrapper
with a foreground service does not stop.

The app code does not fork. `apps/dashboard/src/worker/location.ts` picks a
backend at runtime and the rest of the worker app is unchanged:

| Running in | Backend | Behaviour |
|---|---|---|
| Any browser | `navigator.geolocation` | Reports only while the page is open. The privacy line says so. |
| This shell | `@capacitor-community/background-geolocation` | Keeps reporting with the screen off, behind a persistent notification. |

If the native plugin fails to start, it falls back to the browser watcher and
tells the worker — a broken build degrades to the old behaviour, not to silence.

## Build it

Neither platform has been compiled yet: this container has no Android SDK and
no Xcode, so the steps below are written but unrun. Expect to fix something.

```bash
cd apps/mobile
npm install

# Adds android/ and ios/ — one time.
npx cap add android
npx cap add ios

# Merge the permission blocks. They are not optional; without
# ACCESS_BACKGROUND_LOCATION and UIBackgroundModes the shell is just a slower
# browser and the whole exercise is pointless.
#   native-config/AndroidManifest.additions.xml  -> android/app/src/main/AndroidManifest.xml
#   native-config/Info.plist.additions.xml       -> ios/App/App/Info.plist

npm run android      # builds the web app, syncs, opens Android Studio
npm run ios          # same, opens Xcode
```

`npm run sync` rebuilds the web app with `VITE_SURFACE=worker` and copies it in.
The web assets are bundled rather than loaded from the hosted URL, because a job
site is exactly where the signal drops — the app must open, show the clock and
queue fixes with no network. The trade is that a Vercel deploy no longer reaches
installed phones by itself; shipping UI means `npm run sync` and a new build.

## What to check on a real device

The emulator will not tell you any of this.

1. Start tracking, lock the phone, drive to a fenced site. The shift should open
   without touching the phone. This is the whole product.
2. Leave it locked for an hour on site. Android's Doze will throttle a badly
   configured watcher into uselessness.
3. Turn airplane mode on for ten minutes on site, then off. The queued fixes
   should drain and the shift times should be right, not shifted by the outage.
4. Kill the app from the task switcher while clocked on. Android will stop the
   service; decide whether that should clock the worker out or flag for review.
   It currently does neither.
5. Deny "Always" and pick "While using". The app must say tracking is degraded
   rather than pretending it is fine.

## Before it ships

- **Play Store background-location review.** Declared use: automatic timesheet
  clock-in at the employer's own job sites, only while the worker has switched
  tracking on, with a persistent notification throughout.
- **Written consent from the crew.** Required in Australia before tracking
  anyone; notice requirements vary by state. This is a legal gate, not a task.
- **Battery.** `distanceFilter` is 15 m. Tune it against a real day before
  handing it to a crew — a phone flat by 2pm is a product that gets uninstalled.
