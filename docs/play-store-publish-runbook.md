# Play Store Publish Runbook (PWA + TWA)

This runbook is for publishing 52 With a View to Google Play using a Trusted Web Activity generated from the live PWA.

## 1) Confirm production URL and PWA assets

- URL: https://petrofang.github.io/52wav/
- Confirm these load without errors:
  - /manifest.webmanifest
  - /sw.js
  - /privacy-policy.html

## 2) Generate Android package from PWABuilder

1. Open https://www.pwabuilder.com/
2. Enter: https://petrofang.github.io/52wav/
3. Choose Android (Trusted Web Activity)
4. Download Android Studio project or AAB output

## 3) Create app in Play Console

1. Open Google Play Console
2. Create new app
3. Set default language, app name, app/game type, free/paid
4. Complete app access and ads declarations

## 4) Internal testing first

1. Create an Internal testing release
2. Upload the generated AAB
3. Add test users
4. Install from Play test link and validate launch, offline behavior, and map links

## 5) Add Digital Asset Links

1. In Play Console, get Play App Signing SHA-256 certificate fingerprint
2. Copy .well-known/assetlinks.json.template to .well-known/assetlinks.json
3. Replace values:
   - package_name
   - sha256_cert_fingerprints
4. Commit and push; verify it is publicly reachable at:
   - https://petrofang.github.io/52wav/.well-known/assetlinks.json

## 6) Complete store listing and policy fields

- App icon: use 512x512 icon from assets/icons/icon-512.png
- Feature graphic and phone screenshots
- Privacy policy URL:
  - https://petrofang.github.io/52wav/privacy-policy.html
- Data safety form (no collection if unchanged)
- App content declarations

## 7) Production rollout

1. Create Production release
2. Attach approved AAB
3. Submit for review
4. Start with staged rollout (for example 10% -> 50% -> 100%)

## 8) Maintenance

- Any web changes deploy through GitHub Pages.
- If domain/package/signing certificate changes, update assetlinks.json.
