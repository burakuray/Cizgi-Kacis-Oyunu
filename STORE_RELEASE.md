# Çizgi Kaçış — mobile store release

This app already uses Expo and React Native, so it does **not** need to be wrapped in Capacitor. Use Expo Application Services (EAS) to build signed Android and iOS binaries.

## Identifiers to confirm before first release

The current app config uses:
- Android application ID: `com.burakuray.cizgikacis`
- iOS bundle ID: `com.burakuray.cizgikacis`

Confirm that these identifiers are available and that you control them before creating the store records. Once published, avoid changing them. The app display name is **Çizgi Kaçış**.

## Build from this monorepo

Run commands from the repository root unless noted. The app workspace is `artifacts/cizgi-kacis`.

1. Install dependencies using the repository's prescribed pnpm setup.
2. Authenticate with Expo: `pnpm dlx eas-cli login`
3. Initialize/link the EAS project from the app directory: `cd artifacts/cizgi-kacis && pnpm dlx eas-cli init`
4. Build Android for store distribution: `pnpm dlx eas-cli build --platform android --profile production`
5. Build iOS for store distribution: `pnpm dlx eas-cli build --platform ios --profile production`
6. Test preview builds on real devices before submitting. An Android preview APK can be installed directly; iOS device distribution needs the relevant Apple signing setup.

The first EAS setup may add a project ID to the Expo config. Keep that ID in the repository after initialization. EAS cloud builds require an Expo account; Apple distribution requires an Apple Developer membership and signing credentials.

## Store submission

### Google Play

1. Create the app in Google Play Console.
2. Complete store listing, content rating, Data safety, app access, ads declaration, target audience, and privacy-policy fields that apply.
3. Configure a Google Play service-account key in EAS Submit credentials; never commit the JSON key to Git.
4. Build an Android App Bundle (AAB), then upload to the **internal testing** track first.
5. Verify the test release on physical devices and complete any testing requirement shown by Play Console before production rollout.

### Apple App Store

1. Enroll in the Apple Developer Program and create the app record in App Store Connect using the bundle ID above.
2. Complete app privacy details, age rating, screenshots, description, support URL, and privacy-policy URL.
3. Build and submit an iOS archive with EAS. It will appear in App Store Connect/TestFlight after processing.
4. Test with TestFlight, then select the build and submit it for App Review. Uploading a build does not publish it automatically.

After store records and credentials are configured, submit with:
- `pnpm dlx eas-cli submit --platform android --profile production`
- `pnpm dlx eas-cli submit --platform ios --profile production`

The iOS submission profile may require your App Store Connect app ID (ASC App ID); add it to `eas.json` once the app record exists.

## Advertising revenue (AdMob)

**Ads are not yet integrated.** Do not declare the app as ad-supported or release it with production ad placements until the ad SDK, consent flow, and privacy disclosures are implemented and tested.

Recommended integration plan:
1. Create an AdMob account and register separate Android and iOS app entries. Obtain the AdMob **App IDs** and banner/interstitial/rewarded **Ad Unit IDs**.
2. Choose placements that do not interrupt aiming or active gameplay. Prefer a banner on non-gameplay/menu screens and, if desired, an optional rewarded ad for a clear player benefit (for example, an extra revive). Avoid forced ads after every shot or accidental-tap placements.
3. Add a React Native Google Mobile Ads package compatible with this project's Expo SDK, configure its Expo config plugin, and create development builds. Native ad SDKs cannot be validated in Expo Go alone.
4. Use Google's official **test ad unit IDs** during development. Never click your own live ads. Switch to your own IDs only after testing and policy review.
5. Implement the applicable consent/privacy flow (including Google's UMP SDK where required), handle Apple's App Tracking Transparency only if tracking is used, and make sure the privacy policy accurately describes ad SDK data collection and sharing.
6. Update Google Play Data safety, the Play Console ads declaration, and Apple's App Privacy disclosures to match the actual SDK behavior. Complete any required child-directed/age-targeting settings carefully.
7. Verify ads are not shown in a way that blocks controls, misleads users, or causes accidental clicks. Re-test offline behavior and gameplay with ad loading failures.

Do not put ad IDs, service-account JSON files, Apple API keys, or other secrets into Git. Public ad unit IDs are not secrets in the same sense as credentials, but keep environment-specific IDs configurable and make sure production builds use the correct ones.

## Pre-release checklist

- [ ] Confirm Android package and iOS bundle identifiers are yours and available.
- [ ] Confirm icon and launch/splash presentation on Android and iOS.
- [ ] Test gesture controls, sound, haptics, safe areas, different screen sizes, app background/resume, and offline behavior on real devices.
- [ ] Run gameplay tests and TypeScript checks from the app workspace.
- [ ] Integrate and test ads/consent before describing the released app as ad-supported.
- [ ] Publish a public privacy policy and support/contact page.
- [ ] Prepare store screenshots, descriptions, age rating, content rating, privacy/data declarations, and release notes.
- [ ] Submit to internal testing/TestFlight before production.
