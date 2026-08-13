# Android Play Store Checklist (PWA + TWA)

This project can be shipped to Google Play as a Trusted Web Activity (TWA), which is much simpler than maintaining a full native wrapper.

## 1) PWA readiness (done in this repo)

- Web manifest is present.
- Service worker is present.
- Install icons exist at 192x192 and 512x512.
- Site runs on HTTPS (GitHub Pages).

## 2) Generate Android package

Use PWABuilder with the live URL:

- https://www.pwabuilder.com/
- Enter: https://petrofang.github.io/52wav/
- Build for Android (Trusted Web Activity)
- Download Android Studio project or AAB

## 3) Set up Digital Asset Links

Before launch, publish a real file at:

- /.well-known/assetlinks.json

Use .well-known/assetlinks.json.template and replace:

- package_name
- Play App Signing SHA256 certificate fingerprint

## 4) Play Console requirements

- Upload signed AAB.
- Provide 512x512 app icon and feature graphic.
- Add privacy policy URL (use docs/privacy-policy.md content on a public URL).
- Complete Data safety form: declare no data collection if unchanged.
- Complete App content declarations.
- Target latest Play-required Android API level.
- Test on internal track before production.

## 5) Pre-release QA

- Verify offline launch behavior.
- Verify map links open correctly on Android.
- Verify no mixed-content or blocked HTTP resources.
- Verify app name, icon, and splash branding are correct.
