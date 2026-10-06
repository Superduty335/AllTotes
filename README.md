# AllTotes: Bin Finder

A phone app for keeping track of what's in your storage totes. Each tote gets a QR label. Scan the label to see photos of what's inside and a list of the items.

## What it does

- **Bins**: each one has a code (B001, B002, …), a name, and where it's kept.
- **Photos and items**: take photos of what goes in, and list items with quantities.
- **Labels**: print QR labels on Avery 5163 / 8163 sheets (2×4 in., 10 per page), or save one label as an image.
- **Scan**: point the camera at a label to open that bin. You can also take a photo of the label or type the code.
- **Search**: type an item ("extension cord") to find which bin it's in.
- **Backup**: save everything, photos included, to one file, and restore it on this phone or a new one.

Everything is stored on the phone (IndexedDB). There's no account and no server, and the app works offline after the first visit.

## Install it on your phone

The app is hosted on GitHub Pages at **https://superduty335.github.io/AllTotes/**.

- **iPhone**: open the link in Safari, tap Share, then **Add to Home Screen**.
- **Android**: open it in Chrome, tap ⋮, then **Install app**.

Use the app's own **Scan a label** button. On an iPhone, the regular Camera app opens links in Safari, and Safari keeps its data separate from the home-screen app, so scanning a label there shows an empty Safari copy.

## Turn on GitHub Pages (one time)

Repository **Settings → Pages → Build and deployment**: set Source to **Deploy from a branch**, choose **main** and **/ (root)**, then click Save. The site goes live a minute or two later.

## iPhone and Android apps

The same app is wrapped as native iPhone and Android apps in `ios/` and `android/` using Capacitor. GitHub Actions builds both on every push, and the Android run produces a test APK you can install. [APP_STORES.md](APP_STORES.md) covers the Play Store and App Store steps.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install |
| `vendor/qrcode.js` | QR code generator by Kazuhiko Arase (MIT) |
| `vendor/jsQR.js` | QR code reader by Cosmo Wolfe (Apache-2.0) |
| `vendor/jspdf.umd.min.js` | PDF writer by James Hall and yWorks (MIT), used for label sheets in the native apps |
| `fonts/` | Barlow Condensed and IBM Plex (SIL Open Font License) |
| `android/`, `ios/`, `capacitor.config.json`, `assets/` | Native app projects, config, and icon/splash sources |
| `scripts/build-web.mjs` | Copies the web app into `www/` for the native builds |

There's no build step. To try it locally, run `python3 -m http.server` in this folder and open http://localhost:8000. The camera only works on `localhost` or HTTPS.

When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.
