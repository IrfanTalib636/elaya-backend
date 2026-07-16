# Well-known files for mobile App Links / Universal Links

These files must be publicly reachable over **HTTPS** on your **link domain**
(the same host used in customer reset e-mails), e.g. `https://app.elaya.ch`.

## Option A — Served by this API (recommended for a single VPS)

Point `app.elaya.ch` to the same Express server and set in `.env`:

```env
APP_LINKS_DOMAIN=app.elaya.ch
IOS_TEAM_ID=YOUR_APPLE_TEAM_ID
IOS_BUNDLE_ID=com.elayaMobile.app
ANDROID_PACKAGE_NAME=com.elayaMobile.app
ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:CC:...
APP_CUSTOMER_RESET_URL=https://app.elaya.ch/reset-password
```

The server exposes:

- `GET /.well-known/apple-app-site-association`
- `GET /.well-known/assetlinks.json`

## Option B — Static files on CDN / nginx (separate from API)

If the link domain is **not** this Node process, copy the templates below to your
web server (no redirects, `Content-Type: application/json`).

Replace placeholders before deploying.

### `apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "YOUR_IOS_TEAM_ID.com.elayaMobile.app",
        "paths": ["/reset-password", "/reset-password/*"]
      }
    ]
  }
}
```

### `assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.elayaMobile.app",
      "sha256_cert_fingerprints": [
        "YOUR_ANDROID_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

## Getting the Android SHA-256 fingerprint

```bash
# Release / upload keystore
keytool -list -v -keystore your-release.keystore -alias your-alias

# Debug keystore (local testing only)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Add **both** debug and release fingerprints during development if you test App Links on debug builds.

## iOS Team ID

Apple Developer → Membership → **Team ID** (10-character string).

## Verify

- iOS: [Apple App Search API Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/)
- Android: `adb shell am start -a android.intent.action.VIEW -d "https://app.elaya.ch/reset-password?token=test"`

Universal links require a **development build** or **production build** — they do **not** work in Expo Go.
