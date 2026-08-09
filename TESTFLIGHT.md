# Getting Crewline onto TestFlight

There is no Mac in this project and there never has been. The build runs on a
GitHub-hosted macOS runner (`.github/workflows/ios-testflight.yml`), and every
step below is done from a browser or a Linux shell.

Everything that can be automated already is. What is left is roughly ninety
minutes of clicking in Apple's portal, once, plus one decision that cannot be
undone afterwards. Read that decision first.

---

## 0. Who owns the app — decide before the first upload

The client will own Crewline. The developer has the Apple Developer account
today. It is tempting to ship under the developer's account now and hand it over
later. **That door closes the moment CI uploads its first build**, for two
reasons that compound:

- **App Transfer needs a public release first.** Apple's transfer criteria
  require that "the app must have at least one version that was released to the
  App Store." An app that has only ever existed in TestFlight cannot be
  transferred to another team at all.
- **The bundle ID is claimed permanently.** Once a build has been uploaded under
  `app.crewline.worker`, Apple will not let another account register that
  identifier. Deleting the app record does not release it. Apple's own advice in
  this situation is to pick a new bundle ID — which resets the TestFlight tester
  list and anything else keyed to the old identifier.

So there are three honest options.

**A. Client enrols first, app is registered under their team from day one.**
The clean one. Organization enrolment needs a D-U-N-S Number for the legal
entity — the Pty Ltd, not a trading name or an ABN sole trader, because the
legal entity name becomes the App Store seller name. Run Apple's free lookup at
<https://developer.apple.com/enroll/duns-lookup/> before assuming this is slow:
D&B build their ANZ records from ASIC data, so an established company very often
already has a number and the lookup returns it immediately. If it does not,
budget up to 5 business days for D&B plus up to 2 for Apple, then identity
verification on top. The developer is then added to the client's team as Admin
or App Manager, and CI changes by exactly three secrets — `APPLE_TEAM_ID` and
the two App Store Connect API key values. Nothing in this repo is pinned to a
team.

**B. Ship under the developer's account this week, transfer later.**
Legitimate, but it commits you: to hand over you must first release publicly on
the App Store under the developer's name, turn TestFlight off (remove all builds
and testers, clear the Test Information), and then transfer. If the developer is
enrolled as an Individual, the App Store seller name is their personal legal
name until that transfer happens.

**C. Ship under the developer's account and abandon the bundle ID later.**
Cheapest now, and it costs a re-registration under a new identifier and a
re-invite of every tester later.

**Recommendation: run the D-U-N-S lookup today.** It takes two minutes. If the
client's company already has a number, option A is a day's work and there is no
reason to take on B or C. If it does not, do B deliberately — and start the
D-U-N-S request the same day, so the client's team exists well before any public
release.

One thing that is *not* a blocker either way: an Individual enrolment can still
add the client's staff in App Store Connect under Users and Access, which is all
they need to be internal TestFlight testers and to manage builds. What an
Individual account cannot do is make them members of the Developer Program — so
they cannot hold their own signing certificates. Given that CI does all the
signing, that limitation never bites here.

---

## 1. What the workflow needs from you

Nine GitHub Actions secrets, under **Settings → Secrets and variables →
Actions**:

| Secret | Where it comes from |
|---|---|
| `APPLE_TEAM_ID` | developer.apple.com → Membership details. Ten characters. |
| `IOS_DIST_CERT_P12_BASE64` | step 3 below |
| `IOS_DIST_CERT_PASSWORD` | step 3 below |
| `IOS_PROVISIONING_PROFILE_BASE64` | step 4 below |
| `APP_STORE_CONNECT_KEY_ID` | step 5 below |
| `APP_STORE_CONNECT_ISSUER_ID` | step 5 below |
| `APP_STORE_CONNECT_PRIVATE_KEY` | step 5 below — paste the whole `.p8`, `-----BEGIN` line included |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | same page. The **anon** key. Never the service role key. |

There is no keychain password secret: the workflow generates one per run for a
keychain that exists for the length of one job.

---

## 2. Register the App ID

developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → **+**
→ App IDs → App.

- Bundle ID: **explicit**, `app.crewline.worker`. It must match
  `apps/mobile/capacitor.config.ts` and `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode
  project exactly.
- Capabilities: nothing needs enabling. The app uses background location, which
  is an `Info.plist` background mode, not an entitlement.

This is the step that decides ownership. See section 0.

## 3. A distribution certificate, without a Mac

Every guide for this assumes Keychain Access. None of it is necessary — the
portal accepts a certificate signing request from any OpenSSL.

```sh
./scripts/ios-signing.sh csr you@example.com
```

That writes `ios-signing/ios_distribution.key` and `.csr`. The key is the thing
an attacker would need in order to sign software as you; keep it where you keep
passwords, and note that `ios-signing/` is gitignored for that reason.

Upload the `.csr` at
<https://developer.apple.com/account/resources/certificates/add>, choosing
**Apple Distribution**. Not Apple Development — a build signed with a
development certificate is rejected on upload. Download the `.cer`, then:

```sh
./scripts/ios-signing.sh p12 ~/Downloads/distribution.cer
```

It checks that what Apple gave you really is a distribution certificate, staples
it to your key, and prints `IOS_DIST_CERT_P12_BASE64` and
`IOS_DIST_CERT_PASSWORD`. The `.p12` is written in the legacy PKCS#12 format on
purpose: OpenSSL 3's default AES-256 container cannot be read by macOS's
`security import`, and the failure it produces — "MAC verification failed" — says
nothing about why.

## 4. A provisioning profile

Portal → Profiles → **+** → Distribution → **App Store Connect**. Pick the
`app.crewline.worker` App ID and the certificate from step 3. Give it a name you
will recognise; the workflow reads the name out of the file itself, so it is not
something you have to keep in a secret and in step with reality.

```sh
./scripts/ios-signing.sh profile ~/Downloads/Crewline_App_Store.mobileprovision
```

It refuses a profile for the wrong app and refuses a development profile (they
list specific devices), then prints `IOS_PROVISIONING_PROFILE_BASE64`.

## 5. An App Store Connect API key

App Store Connect → Users and Access → Integrations → App Store Connect API →
**+**. Role **App Manager** is enough to upload builds.

Apple lets you download the `.p8` exactly once. The Key ID and Issuer ID are on
the same page.

## 6. The app record

App Store Connect → Apps → **+** → New App.

- Platform iOS, bundle ID `app.crewline.worker`.
- **Name**: "Crewline" is taken on the App Store by unrelated apps, and App Store
  Connect will refuse it. Pick the public name now — it can be changed later
  while the app is unreleased, but you cannot create the record without one.
- SKU: anything internal, e.g. `crewline-worker`.

TestFlight needs the record to exist before a build can attach to it.

---

## 7. Run it

Actions → **iOS → TestFlight** → Run workflow. The one input is the backend URL,
and it defaults to the current Vercel deployment.

What the run does, and why each part is there:

- Pins Xcode 26 and fails loudly below it. Since **28 April 2026** App Store
  Connect rejects any upload not built with Xcode 26 and an iOS 26 SDK. This is
  why the job is on `macos-26` and not `macos-15`, whose default Xcode is still
  16.4 — that combination archives perfectly and then bounces at upload.
- Installs `node_modules` in **both** apps. `apps/mobile`'s is not just the
  Capacitor CLI: `CapApp-SPM/Package.swift` has path dependencies pointing into
  it, so Swift Package Manager cannot resolve without it.
- Greps the built bundle for the backend URL. A bundle built without
  `VITE_API_BASE` calls `/api/...` relative to `capacitor://localhost`, which
  Capacitor's own asset handler answers with `index.html` and a **200** — so the
  app installs, opens, asks for location, and records nothing.
- Signs manually from an imported identity rather than using
  `-allowProvisioningUpdates`. Automatic signing works, but it works by creating
  identifiers and certificates in the Apple account as a side effect of a build,
  on a fresh empty VM every time. Given section 0, registering the bundle ID
  should be a deliberate act in the portal, not a consequence of pressing a
  button.
- Sets the build number from `github.run_number` by overriding
  `CURRENT_PROJECT_VERSION` on the xcodebuild command line. No `agvtool`: it only
  drives projects whose `VERSIONING_SYSTEM` is `apple-generic`, which this one
  never sets. `Info.plist` already reads `CFBundleVersion` from that setting, so
  nothing on disk is mutated.

Expect 20–35 minutes, most of it Swift Package Manager and the archive.

## 8. After the upload

Processing takes 5–30 minutes, then the build appears under TestFlight.

- **Export compliance** should clear itself. `ITSAppUsesNonExemptEncryption` is
  already `false` in `Info.plist`, which is accurate: every call is HTTPS to
  Vercel and Supabase and the app implements no cipher of its own.
- **What to Test** has to be written in App Store Connect. Nothing in the
  workflow can set it, and TestFlight will not release to external testers
  without it.
- **Internal testers** — anyone with an App Store Connect account on the team,
  up to 100 — get the build immediately with no review.
- **External testers** wait on Beta App Review, and background location gets that
  read properly. Say plainly that tracking is switched on by the worker, exists
  to clock them in at their own employer's sites, runs with a persistent
  notification, and can be switched off at any time. `PRIVACY.md` is the source
  of truth for the wording.
- **Testing it in Australia from Cupertino.** The demo tenant seeded by
  `scripts/seed-demo.mjs` includes a job site at Apple Park (lat 37.3349, lng
  -122.0090, 800 m radius) precisely so a reviewer standing in Cupertino is
  inside a geofence. Without it every Crewline site is in Adelaide and the
  reviewer sees an app that does nothing.

---

## When it fails

**"No Apple Distribution identity in the keychain."** The `.p12` holds a
development certificate. Redo step 3 and pick Apple Distribution.

**"Profile covers X, not app.crewline.worker."** Wrong profile downloaded, or
the App ID was registered with a different bundle ID.

**"That is a development profile (it lists devices)."** Profiles → Distribution →
App Store Connect, not Development.

**Upload rejected with ITMS-90725.** Built with the wrong Xcode. The workflow
guards against this; if it reappears, the runner image changed.

**SPM cannot resolve `CapacitorCommunityBackgroundGeolocation`.** `npm ci` in
`apps/mobile` did not run or did not complete. (The plugin itself is fine on
Capacitor 8 — its `Package.swift` depends on `capacitor-swift-pm` `from: 8.0.0`,
which the app's `exact: 8.5.0` satisfies.)

**A white screen on the phone with everything else working.** `npx cap sync ios`
did not copy the web assets. `ios/App/App/public/` is gitignored, so it is empty
in a fresh checkout until that step runs.
