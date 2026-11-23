# Android builds (APK for testing, signed AAB for production)

Builds use **EAS Build** (Expo's cloud build service), so no Android Studio or Java is needed on your PC.
SKJ needs a free Expo account owned by the company (not a personal account).

## One-time setup
```powershell
cd apps\mobile
npx eas-cli@latest login
npx eas-cli@latest init          # creates the EAS project; copy the project ID it prints
```
Set `EAS_PROJECT_ID` as an EAS environment variable (needed for push notifications), and change the URLs in
`eas.json` (`preview` = staging API, `production` = live API). Both must be `https://`; the build fails otherwise.

## Test APK (internal distribution)
```powershell
npm run build:apk
```
EAS prints a download link/QR code. Share it only with testers; install by allowing "unknown sources" on test
phones, or use a mobile-device-management tool.

## Production AAB (signed)
```powershell
npm run build:aab
```
* On the first production build, let EAS **generate the upload keystore** and keep it in EAS's encrypted credential
  storage. Download a backup (`npx eas-cli@latest credentials`) and store it in SKJ's vault. Losing it means you can't
  update the app.
* Distribution options (no public Play Store listing needed):
  1. **Managed Google Play (private app)** through SKJ's Android Enterprise / Intune — recommended.
  2. **Play Console internal testing track** restricted to SKJ email addresses (`npx eas-cli@latest submit`).
  3. MDM sideload of the APK from the `preview` profile.

## Development build (for developers)
```powershell
npx eas-cli@latest build --profile development --platform android
npx expo start --dev-client
```
The development build allows plain HTTP only so it can reach a local API at `http://10.0.2.2:8000` from the
emulator. Preview and production builds block cleartext traffic.

## Before each release
Run the MobSF scan and the manual checks in `security/android-masvs-checklist.md` against the preview APK.
