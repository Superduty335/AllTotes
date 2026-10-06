# Getting Bin Finder into the app stores

The iPhone and Android apps wrap the same web app (`index.html`, `app.js`, …) with [Capacitor](https://capacitorjs.com). GitHub builds both on every push. These are the steps only the account owner can do.

## Android (Google Play)

**Try it on your phone now.** On an Android phone, open https://github.com/Superduty335/AllTotes/releases/latest/download/bin-finder.apk, then open the downloaded file and allow installing apps from your browser when asked. Every push to main updates that link. This test version is separate from the Play Store one.

**Publish on Google Play:**

1. Create a Google Play developer account at https://play.google.com/console ($25, one time). New personal accounts must run a closed test with at least 12 testers for 14 days before going public.
2. Create an *upload key* (one time, on any computer with Java):
   ```
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Keep `upload.jks` and its passwords somewhere safe, and never commit them.
3. In GitHub, go to **Settings → Secrets and variables → Actions** and add these:
   - `ANDROID_KEYSTORE_BASE64`: the output of `base64 -w0 upload.jks` (on a Mac, `base64 -i upload.jks`)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`: `upload`
   - `ANDROID_KEY_PASSWORD`
4. Run **Actions → Android app → Run workflow**. It now also produces `bin-finder-play-store-aab`. Upload that `.aab` in Play Console under a testing track, then production.
5. Play Console asks for a privacy policy URL. Bin Finder collects nothing: the data stays on the phone and there's no account or server. A short page saying that is enough.

Each run's build number is used as the version code, so every upload is accepted as newer.

## iPhone (App Store)

1. Join the Apple Developer Program at https://developer.apple.com/programs ($99 a year).
2. In App Store Connect, create an app with the bundle ID `com.alltotes.binfinder`.
3. Signing and uploading needs either a Mac with Xcode (`npm ci && npm run ios`, then Product → Archive → Distribute) or App Store Connect API keys added as GitHub secrets so a workflow can sign and upload to TestFlight. Once the Apple account exists, Claude can add that workflow.

GitHub already builds the iPhone app for the simulator on every push (**Actions → iPhone app**), which confirms it compiles.

## Before the first release

- **App ID**: `com.alltotes.binfinder`, set in `capacitor.config.json`, `android/app/build.gradle` and the Xcode project. It can't be changed after the first store upload, so change it now if you want a different one.
- **Store listing**: you'll need screenshots, a short description and a category (Productivity, or Lifestyle).

## Working on the app

```
npm ci
npm run sync      # copy the web app into the native projects
npm run android   # open in Android Studio
npm run ios       # open in Xcode (Mac only)
```

When you change the web app, bump `CACHE` in `sw.js` so the web version updates for people who installed it from the browser.
