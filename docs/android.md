# Android app (phase C4)

TrainRadar for Android is the web app (`web/`) inside a [Capacitor](https://capacitorjs.com)
shell (`app/`). The engine, the map and the reference data ship inside the APK, so the
map opens without downloading them; live feeds come from the central bucket
(`live.<domain>`), history from the API (`api.<domain>`).

- **App id:** `com.metranos.trainradar` (permanent once published). Min Android 8.0
  (SDK 26), target SDK 36.
- **Build flag:** `TARGET=android tools/build-web.sh` sets `CONFIG.platform = "android"`
  in the bundle: no "Invítame a un café" link, no service worker, no "get the app"
  banner.
- **Free edition:** everything the web has, minus the enthusiast details (track facts,
  gradient and height profile, spacing to the trains ahead and behind), which come with
  Pro (phase C5). Plus up to **2 favourites** (trains or stations, ★ in the header),
  sharing a train or station, the Android back button (closes the open panel or popup,
  then leaves the app) and links `trainradar://train/<number>`,
  `trainradar://station/<stop id>`.
- **Location:** only while the app is open, only after "Use my location"; Android asks
  for permission then. It never leaves the phone.
- **Your data:** favourites live in Android's shared preferences, included in Android's
  own backup (Google Drive, `res/xml/data_extraction_rules.xml`); caches and the bundled
  data are left out.

## TrainRadar Pro and tips (phase C5)

- **Billing:** Google Play Billing through `cordova-plugin-purchase` (`web/js/billing.js`),
  with products from `CONFIG.products`: `pro_monthly` (subscription) and the tips
  `tip_small`, `tip_medium`, `tip_large` (consumables, unlock nothing). No server, no
  accounts: Play is asked on the phone at start and on resume, and its answer is cached
  for 7 days offline (`web/js/entitlement.js`, which documents how Play's states map:
  grace period = Pro, cancelled = Pro until the paid period ends, on hold or expired =
  not Pro). "Restore purchases" asks Play again (a new phone, a reinstall).
- **Pro unlocks now:** unlimited favourites and the enthusiast details. The Pro screen
  lists what's coming as "coming in later versions", not as part of the purchase.
- **My trips (Pro, `web/js/trips.js`):** "🧳 I'm on this train" in a train popup, or
  "Am I on this train?" at high confidence, starts a trip. While the train is live the
  delay at each stop it reaches is kept; it ends at the last stop or 15 min after the
  train leaves the feed. Monthly figures (trips, late 5+ min, average delay); per trip a
  **claim summary** (facts only, with a link to Renfe's punctuality commitment page,
  never a statement about eligibility), an **image card** to share, and a **CSV**
  export. Only the train and its times are stored, never the location. Stored with
  Preferences (backed up by Android, included in the export file) as a versioned JSON
  document with a migration step (`parseTrips`); the plan's SQLite isn't needed at this
  size (a few hundred KB after years).
  If the app was closed when the train arrived, the trip ends with no arrival; the app
  then asks the history API (`/v1/history/train/<n>?days=4&today=1`, today's finished
  runs included, cached 5 min) at start, on resume and when My trips opens, at most
  every 10 min, and fills in the arrival, highest delay and missing stop delays from the
  recorded run (matched by scheduled arrival). It keeps trying for 3 days; a run not
  found a day after the trip is given up. The CSV has Spanish headings and `;` as
  separator in Spanish (what Excel expects there), English headings and `,` in English.
- **Replay (Pro, `web/js/replay.js`):** ⓘ → TrainRadar Pro y ajustes → ⏪ Moviola.
  Pick a day and a time (Madrid), play at ×1/×10/×60/×300, scrub through the day;
  trains move between the recorder's minute frames (`replay/<date>/<hour>.json.gz`,
  written by `backend/src/replay.js`) and are coloured by their delay then; tap one
  for its delay at that moment. Live drawing pauses meanwhile; "Volver al directo" or
  Back returns. Data from the first hour the recorder wrote (`replay/first.json`).
- **Delay alerts (Pro):** ⓘ → TrainRadar Pro y ajustes → 🔔. Android asks for the
  notification permission then. Every 15 min (WorkManager, only with a network) the
  app reads the public `rt/summary.json` and notifies a favourite train once per level
  and day: 5+ min late, 15+ min late, cancelled. While the app is open the same check
  runs every minute from the live engine. The rules exist twice with the same test
  cases: `web/js/alerts.js` (in the app) and `AlertRules.java` (background,
  `./gradlew :app:testDebugUnitTest`). Nothing about the user is sent anywhere.
- **Widget (Pro):** long-press the home screen → Widgets → TrainRadar: up to four
  favourite trains with their delay in the map's colours, refreshed with the alerts and
  when the favourites change. A plain `AppWidgetProvider` with `RemoteViews` (Java),
  not Jetpack Glance as the plan suggested: no Kotlin and Compose toolchain for one
  small widget.
- **Full history:** "See history →" in a train's punctuality box, or 📊 in a
  station's popup: a chart of the share on time per day (line or station) and, for a
  train, its runs day by day, from the history API. 7 days for everyone (the web too);
  30, 90 and 365 days with Pro.
- **Commute (Pro):** in a station popup "I leave from here", in another "I go here".
  The app then opens on the next trains between them (`Engine.commuteJson`: trains
  calling at the origin and later at the destination, with live delays); ⓘ → TrainRadar
  Pro y ajustes → 🏠 opens it any time; swap or delete there. Up to 10 commutes
  (`web/js/commutes.js`), shown as tabs; each new origin → destination adds one, and
  the app opens on the one used last. The single commute of 2.0.x is kept. The
  Delays list and the Notices sheet get "All" / one-commute chips (remembered):
  delayed trains that run from the origin to the destination and haven't reached it
  (`Engine.delayedBetweenJson`), and notices at any station on the way or on a line
  its trains run on (`Engine.betweenStationsJson`).
- **Native code:** `app/android/app/src/main/java/com/metranos/trainradar/`:
  `TrainRadarPlugin` (reached from `web/js/native.js` as `appNative`), `AlertsWorker`,
  `AlertRules`, `Notifier`, `Widget`. They read the app's settings from Capacitor
  Preferences (`CapacitorStorage`).
- **Settings (ⓘ → TrainRadar Pro y ajustes):** the Pro screen, tips, Restore, Manage
  subscription (Play's page), and for everyone: export your data to a JSON file
  (`trainradar-backup-YYYYMMDD.json`, through the share sheet), import it (merged, no
  duplicates, within the favourites limit), delete all your data.
- **Tests:** `web/js/pro.test.mjs` (entitlement states, billing wrapper on a fake
  Play, backup round trip), and `tools/feed-check/app-smoke.mjs`, which runs the app
  bundle with a stand-in for Play to check that Pro unlocks the details and favourites.

### Play Console steps (maintainer)

1. Create the app `com.metranos.trainradar`, Play App Signing on.
2. Upload a release build to the **internal testing** track (billing only works for
   an app that Play knows; `docs/android.md` → Release build).
3. Monetise → Products → **Subscriptions**: `pro_monthly`, a monthly auto-renewing base
   plan, €1.99 in Spain (set per product since Oct 2025: enter the Spanish price, let Play convert it for the other countries), no free trial.
4. Monetise → Products → **In-app products**: `tip_small` €1.99, `tip_medium` €4.99,
   `tip_large` €9.99 (managed products; the app consumes them).
5. Settings → **Licence testing**: add your Google account(s), so test purchases are
   free and renew every few minutes.
6. Install from the internal testing link and buy, cancel and restore to check.

## Builds in CI (no secrets)

`.github/workflows/android.yml`, on every pull request and merge:

1. **Test build**: demo data and fixture feeds inside the APK; an emulator runs
   `AppSmokeTest` (the map renders with trains, a train popup opens through the app's
   search, free-edition rows are hidden).
2. **Try-out build**: the deployed site's data and the live feeds (needs the variable
   `LIVE_PUBLIC_URL`). Download the **trainradar-debug-apk** artifact from the run's
   summary page, copy it to your phone and open it (allow "install unknown apps" for
   your file manager). Debug-signed: it can't be updated by a Play Store version later;
   uninstall it first.

The CI web job also runs `tools/feed-check/app-smoke.mjs` on the `TARGET=android`
bundle in a browser (favourites and their limit, links, no coffee link).

## Release build (maintainer, on your computer)

The upload key never goes in the repository. Turn on **Play App Signing** when you
create the app in Play Console, so Google holds the app signing key and your upload
key can be replaced if lost. On Windows, run everything below in **WSL** (Ubuntu): the
build scripts are bash.

### Once: tools

- [ ] **Android Studio** (https://developer.android.com/studio). Open it once and let it
      install the SDK. It also brings Java 21 (`JAVA_HOME` = Android Studio's `jbr`
      folder if `java -version` shows something older).
- [ ] **Node 22** (https://nodejs.org, or `nvm install 22`).
- [ ] **Rust** (https://rustup.rs). `rust-toolchain.toml` picks the right version and
      the WebAssembly target by itself.
- [ ] **wasm-bindgen-cli**, the same version as the engine:
      `cargo install wasm-bindgen-cli --version 0.2.130 --locked`
- [ ] **jq** and **curl** (`brew install jq` / `sudo apt install jq curl`). Optional:
      **binaryen** (`wasm-opt`, a smaller engine).
- [ ] Check: `java -version` (21), `node -v` (22), `wasm-bindgen --version` (0.2.130),
      `echo $ANDROID_HOME` (the SDK folder; Android Studio → Settings → Android SDK shows
      it; add `export ANDROID_HOME=…` to your shell profile).

### Once: the upload key

- [ ] Create it outside the repository and keep the file and both passwords in your
      password manager. If you lose it, Play can reset it (Play App Signing), but it
      takes days.
      ```sh
      mkdir -p ~/keys
      keytool -genkeypair -v -keystore ~/keys/trainradar-upload.jks -alias upload \
        -keyalg RSA -keysize 4096 -validity 10000
      ```
- [ ] Never copy it into the repository (`*.jks` and `*.keystore` are ignored anyway).

### Every release

- [ ] Get the code: `git clone https://github.com/StructuralWizard/TrainRadar.git`
      (first time), then `git checkout main && git pull`.
- [ ] Raise the version in `app/android/app/build.gradle`: `versionCode` +1 (Play
      refuses a number it has seen) and `versionName` (e.g. `0.5.0`). Commit it in a PR,
      or tell Claude to.
- [ ] Build the app with the deployed data and the live feeds:
      ```sh
      LIVE_BASE=https://live.mytrainradar.com API_BASE=https://api.mytrainradar.com tools/build-app.sh
      ```
      It ends with "app/android ready".
- [ ] Build the bundle and sign it with the upload key:
      ```sh
      cd app/android
      ./gradlew bundleRelease
      jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
        -keystore ~/keys/trainradar-upload.jks \
        app/build/outputs/bundle/release/app-release.aab upload
      jarsigner -verify app/build/outputs/bundle/release/app-release.aab   # "jar verified."
      ```
- [ ] Play Console → TrainRadar → **Testing → Internal testing** → Create new release →
      upload `app-release.aab` → release notes (ES and EN) → Save → Review → Roll out.
- [ ] On your phone: open the internal testing link (Testers tab), install from Play,
      and check: the map opens, live trains move, favourites, location, and in ⓘ →
      TrainRadar Pro y ajustes the price shows; with a licence-tester account buy,
      restore and cancel Pro and a tip.
- [ ] Tag the release so the store version matches the code:
      `git tag v0.5.0 && git push origin v0.5.0` (or ask Claude to prepare it).

### Updates inside the app

The app checks Google Play each time it opens or comes back to the front
(`InAppUpdates.java`, Play's in-app updates library). A user only sees a
version their track has: testers get a test release first, everyone else
when it reaches production.

- **Flexible** (the default): Play asks once, the new version downloads in
  the background while the app keeps working, then a dialog offers
  "Reiniciar". If the user says no, it asks again after 3 days.
- **Immediate** (mandatory, for critical fixes): Play's full-screen prompt;
  the app can't be used until it's updated. Used when the release's
  *in-app update priority* is 4 or 5. Play Console's web pages can't set
  that priority: it's set when a release is sent through the Play
  Developer API (`inAppUpdatePriority` on the track release). Releases
  uploaded by hand are always flexible.

Nothing shows in debug builds, the emulator or sideloaded APKs: the check
only works for an app installed from Play. To try it, install an older
version from the testing track, publish a newer one there, then open the app
(Play may take a while to notice the new release).

### If something goes wrong

- "SDK location not found": set `ANDROID_HOME` (above) or create
  `app/android/local.properties` with `sdk.dir=/path/to/Android/sdk` (ignored by git).
- "Unsupported class file major version": Java isn't 21; point `JAVA_HOME` at Android
  Studio's `jbr`.
- `wasm-bindgen` version mismatch: install exactly 0.2.130 (above).
- Play says "version code already used": raise `versionCode` again.
- Products show no price in the app: the products must be **active** in Play Console and
  the app installed **from Play** (internal testing), not a sideloaded APK.

Later, with the maintainer's approval, the upload key can become a GitHub Actions secret
for a `release-android.yml` that runs on tags only (plan C, phase C6).

## Changing the app

- Web code: as usual in `web/`; then `tools/build-app.sh` (or the test build in
  `android.yml`) copies it into the app.
- Native settings: `app/capacitor.config.json`, `app/android/app/src/main/AndroidManifest.xml`.
- Plugins (`app/package.json`): App (back button, links), Preferences (favourites),
  Share, Status Bar, Splash Screen. Reached from `web/js/native.js` through Capacitor's
  bridge; the web falls back to the browser.
- Icons and splash screens are generated from `web/icons/`.
