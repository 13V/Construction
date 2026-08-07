# Crewline — the phone app

Exists for one reason: **background location**.

Mobile web stops reporting the moment the phone locks or the browser is
backgrounded, which is most of a working day. The whole product promise is that
a worker drives to site and is on the clock before they get out of the ute, and
on the web that promise is false. This shell keeps the watcher running with the
screen off. Everything else on the phone — the clock, the day's hours, photos,
chat — is the same worker surface the web serves at `/worker`.

## State of play

| | |
|---|---|
| Android | **Builds.** `app-debug.apk`, 5.2 MB, produced and inspected. Not yet run on a physical phone. |
| iOS | **Scaffolded, never compiled.** Needs macOS and Xcode; neither existed in the environment this was written in. |

What "not yet run on a physical phone" rules out: whether Android's Doze mode
lets the foreground service keep reporting overnight, whether the manufacturer's
battery optimiser kills it (Xiaomi, Huawei and Samsung are the usual offenders),
and whether the fixes actually arrive often enough for the 2-minute dwell rule.
Those cannot be answered without a phone in a ute. Do that before a crew relies
on it.

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

Android — the plugin's own manifest merges in fine/coarse location, the
foreground service, its type, and `POST_NOTIFICATIONS`. It deliberately leaves
one to us:

- **`ACCESS_BACKGROUND_LOCATION`** — declared in
  `android/app/src/main/AndroidManifest.xml`. This is the one that matters and
  the one that triggers a Play Store review, which is why the plugin makes it an
  explicit decision rather than declaring it for you. Without it Android stops
  delivering fixes the moment the app leaves the foreground.
- **`WAKE_LOCK`** — keeps the service alive through Doze between fixes.

iOS — `Info.plist` carries `NSLocationAlwaysAndWhenInUseUsageDescription` and
`UIBackgroundModes: location`. iOS shows those strings verbatim in the prompt, so
they are written for the worker holding the phone, not for a reviewer. A vague
one gets declined, and a declined permission means hours silently stop
recording.

Android requires a persistent notification for background location. That is a
feature here, not a tax: the crew can see exactly when the app is tracking them,
and turning it off is one tap away.

## Store review

Background location gets a manual review on both stores. The declared use is
automatic timesheet clock-in at the employer's own job sites, only while the
worker has switched tracking on, with a visible notification throughout.

**Have written consent from every worker on file before you submit.** Australian
workplace surveillance law is state-based and the notice requirements differ.
See `SHIP.md`.

## Known rough edges

- `@capacitor-community/background-geolocation@1.2.26` is built against
  Capacitor 7; this project is on Capacitor 8 and the CLI warns about it on
  `cap add ios`. The Android build works regardless. Watch it on iOS.
- The web assets are bundled rather than pointed at the hosted URL, because a
  job site is exactly where signal drops — the app has to open and show the
  clock with no network. The trade is that a web deploy no longer reaches
  installed phones on its own: shipping UI changes means `npm run sync` and a
  new build.
- `app-debug.apk` is debug-signed. A release build needs a keystore, which
  should not live in this repo.
