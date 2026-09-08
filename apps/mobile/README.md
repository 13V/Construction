# Crewline — the phone app

It existed for one reason — **background location** — and that reason is gone.

App Review rejected it twice under 5.6, so the plugin, the `Always` prompt and
`UIBackgroundModes` all came out (see `location.ts`). What ships now reads
location **only while the app is open**, to check a worker is standing at the
job site when they clock on or off. A shift can still open on its own, but only
with the app in front of the worker.

That leaves the shell earning its keep on the smaller things: an icon on the
home screen, the camera and photo pickers behaving like a native app, and no
browser chrome in the sun. Everything on the phone — the clock, the day's hours,
photos, chat — is the same worker surface the web serves at `/worker`.

## State of play

| | |
|---|---|
| Android | **Builds.** `app-debug.apk`, 5.2 MB, produced and inspected. Not yet run on a physical phone. |
| iOS | **Ships.** `.github/workflows/ios-testflight.yml` builds and uploads on a GitHub macOS runner; builds have gone through TestFlight and App Review. See `TESTFLIGHT.md`. |

What "not yet run on a physical phone" still rules out on Android: whether the
fixes arrive often enough for the 2-minute dwell rule while the worker has the
app open. That cannot be answered without a phone in a ute. Do it before a crew
relies on it.

## Build it

Requires JDK 17+, the Android SDK, and `ANDROID_HOME` set.

```bash
cd apps/mobile
npm install
npm run sync                 # builds the worker web bundle, copies it in
cd android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

`npm run android` opens it in Android Studio instead, and `npm run run:android`
installs straight onto an attached device.

For iOS you need a Mac:

```bash
cd apps/mobile
npm install
npm run sync
npx cap open ios             # then Signing & Capabilities → your team → Run
```

Xcode needs **Background Modes → Location updates** ticked under Signing &
Capabilities. The `Info.plist` already declares it, but Xcode also writes it
into the target's entitlements and the two have to agree.

## What the phone actually downloads

`main.tsx` picks its surface from a build-time flag, so a phone build contains
only the worker app:

| | Before | Now |
|---|---|---|
| JavaScript parsed | 1,457 kB | 514 kB |
| Dead files in the APK | ~1.7 MB | none |

The office dashboard imported both surfaces statically, so the phone was
downloading and parsing the entire dashboard — MapLibre GL included, roughly
800 kB of a mapping library the worker surface never once references — before it
could show a clock-in button. `VITE_SURFACE=worker` now folds to a constant at
build time and Rollup drops the dashboard entirely.

## What is on the phone

Four tabs — Jobs, Time, Photos, Chat — and five things you do at a job:
Take Photo, Upload Receipt, Plans, Safety and Daily Log.

| Screen | What it is for |
|---|---|
| Jobs | The clock-in story: approaching, the two-minute settle window, on the clock |
| Time | The payday screen — the week against your own ordinary hours, the evidence behind each punch, Fix a Punch, and Time off |
| Photos | The job's photos, grouped by day, filtered, with a full-screen viewer |
| Chat | The site channel, shared with the office |
| Plans | Sheets with the revision loudest, superseded in red, and pins you can drop and resolve |
| Safety | Your tickets, and the sign-on gate: no start until the SWMS is signed |
| Daily Log | Drafted from today's punches, photos and deliveries, posted only when you send it |

## Permissions, and why each one

There is no location plugin any more. The web layer's own
`navigator.geolocation` is all that runs, so the permission surface is the
smallest one either platform offers.

iOS — `Info.plist` carries **`NSLocationWhenInUseUsageDescription` and nothing
else**. No `NSLocationAlwaysAndWhenInUseUsageDescription`, no `UIBackgroundModes`.
The app cannot ask for `Always`; the prompt does not offer it. iOS shows that
string verbatim, so it is written for the worker holding the phone, not for a
reviewer.

Android — fine and coarse location only. **`ACCESS_BACKGROUND_LOCATION` is not
declared** and must not be added back without re-reading the section below.

Keep both plists honest with what `location.ts` actually does. Two of the six
rejections on 1.0 were the gap between the two.

## Store review

Background location gets a manual review on both stores, and on iOS this app
lost that argument twice — App Review does not accept employee-monitoring as a
justification for it, however the feature is framed. Do not reach for it again
without a use case that survives 5.6 and 5.1.2 on its own.

What is declared now: location read while the app is open, to confirm a worker
is at their employer's own job site when they clock on or off.

**Have written consent from every worker on file before you submit.** Australian
workplace surveillance law is state-based and the notice requirements differ.
See `SHIP.md`.

## Known rough edges

- `ios/App/CapApp-SPM/Package.swift` is regenerated by `npx cap sync ios` on
  every CI build, so the committed copy is only ever a snapshot. It went stale
  once already, still naming the background-geolocation package after the
  plugin had been removed from `package.json`. CI was unaffected — it syncs
  first — but a local `xcodebuild` would have failed to resolve. If you change
  plugins, run `cap sync` and commit what it writes.
- The web assets are bundled rather than pointed at the hosted URL, because a
  job site is exactly where signal drops — the app has to open and show the
  clock with no network. The trade is that a web deploy no longer reaches
  installed phones on its own: shipping UI changes means `npm run sync` and a
  new build.
- `app-debug.apk` is debug-signed. A release build needs a keystore, which
  should not live in this repo.
