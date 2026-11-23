# Android security checklist (OWASP MASVS v2 / MASTG)

Status key: **Built** = control is in the code/config. **To test** = must be verified on a real build and device
(MobSF static scan + manual MASTG tests). Nothing here has been tested on a device yet.

| MASVS area | Control in this app | Where | Status |
|---|---|---|---|
| STORAGE-1 | Refresh token in `expo-secure-store` (Android Keystore-backed, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); access token only in memory | `apps/mobile/src/lib/session.ts` | Built / To test |
| STORAGE-2 | Android auto-backup disabled (`allowBackup: false`); SecureStore backup rules configured | `app.config.ts` | Built / To test |
| STORAGE-2 | Downloaded PDFs saved to private cache, deleted after 2 min and on logout/start-up | `src/lib/files.ts` | Built / To test |
| STORAGE-2 | No `console.log` of customer data or tokens; API client never logs bodies | whole app | Built (code review) |
| CRYPTO-1 | No hardcoded keys; API URL and EAS project id come from build-time env | `app.config.ts`, `eas.json` | Built |
| AUTH-1 | Server-side auth on every endpoint; app only hides UI it can't use | backend `deps.py` | Built + tested (pytest) |
| AUTH-2 | Biometric unlock (`expo-local-authentication`) after background/restart; opt-in | `src/lib/auth.tsx`, `LockScreen.tsx` | Built / To test |
| AUTH-3 | Idle logout after 30 min; lock after 5 min in background; refresh-token rotation with reuse detection | `src/lib/auth.tsx`, backend `auth.py` | Built / backend tested |
| NETWORK-1 | HTTPS enforced: release builds refuse non-https API URL; cleartext traffic only allowed in the dev variant | `app.config.ts`, `src/lib/config.ts` | Built / To test |
| NETWORK-2 | Certificate validation by Android default trust store. **Certificate pinning not implemented** (see report, F-07) | — | Gap (accepted, Medium) |
| PLATFORM-1 | Minimal permissions; audio, location, storage, contacts, overlay explicitly blocked | `app.config.ts` | Built / To test (check merged manifest) |
| PLATFORM-2 | No WebView used | — | Built |
| PLATFORM-1 | Deep links (`skjbess://`) open screens only; they never carry tokens and every screen re-checks auth on the API | `_layout.tsx` | Built / To test |
| PLATFORM-1 | Exported components: only the launcher activity should be exported | generated manifest | To test (MobSF) |
| PLATFORM-3 | Screenshot/screen-recording blocked on customer, project, bill, proposal and calculator screens (`FLAG_SECURE`) | `usePreventScreenCapture` | Built / To test |
| PLATFORM-3 | Push notifications carry only a generic title; details load after login; lock-screen visibility PRIVATE | backend `notify.py`, `push.ts` | Built |
| CODE-1/2 | Release builds use R8 minification and resource shrinking | `expo-build-properties` | Built / To test |
| CODE-3 | Dependencies scanned (`npm audit`); 3 Moderate build-tool findings accepted (F-06) | `security/` | Done |
| RESILIENCE-1 | Rooted-device detection: **not implemented**. Risk assessed in report (F-08) | — | Gap (accepted, Low) |
| RESILIENCE | Reverse engineering: JS is compiled to Hermes bytecode; no secrets in the bundle. Business rules and pricing live on the server | — | Built |

## Manual MASTG tests to run on the preview APK
1. `adb shell run-as com.skjenergy.bess ls -R` (debuggable builds only) / backup extraction: confirm no tokens or PDFs in plain files.
2. Proxy through Burp/mitmproxy with a user-installed CA: the release build must refuse to connect.
3. `adb shell dumpsys package com.skjenergy.bess`: confirm requested permissions and that only the launcher activity is exported.
4. Try screenshots on the proposal and bill screens: must be blocked.
5. Background the app >5 min with biometrics on: must show the lock screen; force-stop and reopen: must require biometrics.
6. Revoke the session from the web Security page: the app must sign out on its next request.
7. `adb logcat` during login, bill upload and proposal download: no tokens, emails or customer data.
8. Open `skjbess://customer/<id-you-cannot-access>` while logged in as Read-only: must show "Not found".
