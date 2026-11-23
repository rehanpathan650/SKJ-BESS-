# UI and scalability upgrade: report

Date: 22 November 2026. Scope: website (`apps/web`), Android app (`apps/mobile`), backend (`apps/api`), shared code
(`packages/shared`). All existing features, permissions and security controls were kept; none were weakened.

## 1. Design system (shared by web and Android)

`packages/shared/src/design.ts` is the single source of truth. The website turns it into CSS variables
(`apps/web/src/theme.ts`); the Android app reads it directly.

| Token | Choice | Why |
|---|---|---|
| Identity | Deep green "ink" sidebar/header, cool grey-green page, SKJ green brand, amber reserved for charge/attention | Clean-energy, industrial; avoids generic SaaS looks |
| Signature element | Battery **state-of-charge meter** (segmented cells) for progress, completion and the sign-in panel | One memorable element tied to the product (BESS) |
| Type | IBM Plex Sans, self-hosted (no Google request), tabular numbers | Engineering feel, very legible figures |
| Chart colours | 3 series colours validated for colour-blind separation, contrast and lightness, separately for light and dark | Charts readable by everyone, in both themes |
| Motion | 140–400 ms, one easing curve; off when the OS asks for reduced motion | Subtle, never in the way |

## 2. Before / after by screen

| Screen | Before | After (web and Android) |
|---|---|---|
| Sign-in | Single card | Split layout: ink panel with the charge meter and a plain-language description; form on the right (web). Android uses the new components. |
| App shell | Light sidebar, text-symbol icons on Android | Ink sidebar with icons and counts (web); ink header + icon tab bar with badges (Android); light/dark/system switch (web) |
| Dashboard | KPI tiles + simple bar lists | **Quick actions** (add customer, size a battery, approve proposals, approve users, with counts); clickable KPIs that open filtered lists; **Pipeline by month** chart (new vs won, 12 months); projects by stage (click → filtered list); my projects with charge meters; largest opportunities |
| Projects list | Fixed 300 rows | Paged (load more / endless scroll), filters kept in the URL (bookmarkable), charge-meter progress |
| Proposals list | Filter in page state | Filter in the URL, so dashboard shortcuts open it pre-filtered |
| Customers | Separate "New customer" step | Opens straight into the form from the dashboard shortcut (`?new=1`) |
| Calculator results | One hand-drawn bar strip | **Savings by year** (time-of-day vs demand-charge) and **Payback curve** (cumulative cash from the investment, crossing zero at payback), year table; layout adapts to the space (container query) |
| Loading | "Loading…" text / spinner | Skeletons shaped like the content (no layout jump) |
| Empty states | Plain text | Icon + an instruction saying what to do |
| Tabs, modals, errors | Static | Animated tab underline, modal entrance, Escape closes modals, errors fade in |
| Tables | Numbers could wrap | Numbers never wrap, sentence-case headers, row hover |
| Accessibility | Partial | Visible focus ring, 44 dp touch targets, labelled icon buttons, screen-reader summaries and data tables for every chart, `prefers-reduced-motion` respected |

The other pages (customer, project, bill review, proposal, admin, security) use the same components, so they
picked up the new look without changes to their logic.

## 3. Libraries added

| Library | Where | Why |
|---|---|---|
| framer-motion 12.43 | Web | Page/tab/modal/list animations; global reduced-motion switch |
| lucide-react | Web | Consistent icon set (tree-shaken, only used icons ship) |
| @fontsource/ibm-plex-sans | Web | Self-hosted font files (CSP allows only `self`) |
| react-native-reanimated 4 + worklets | Android | Press feedback, entrances, skeleton shimmer on the UI thread |
| react-native-svg | Android | Charts |
| @expo-google-fonts/ibm-plex-sans + expo-font | Android | Same font as the web |
| @expo/vector-icons (Feather) | Android | Tab and list icons |
| @playwright/test | Web (dev) | End-to-end tests, run in the installed Microsoft Edge |
| boto3 | API | S3-compatible file storage (optional) |
| sentry-sdk | API | Optional error tracking with personal data stripped |

No chart library was added: the charts are ~200 lines of SVG on shared geometry, so web and Android match and the
web chart code is 2 KB gzipped.

## 4. Scalability

See `docs/architecture.md` → *Scaling* and *Monitoring* for the full picture. In short:

* **Backend:** 15 new indexes (migration `0003`), paging with hard caps on every list, eager loading (no N+1),
  connection pooling, database-side dashboard aggregates, 20-second per-user dashboard cache (Redis when configured)
  that is invalidated on every change, stateless API servers, multiple workers safely sharing the job queue,
  S3-compatible storage, readiness check, Prometheus metrics, JSON logs, optional Sentry.
* **Web:** each page is its own lazy-loaded file (app code 12.5 KB gzipped; libraries cached separately), 30-second data
  reuse between pages.
* **Android:** virtualized lists with endless scrolling, offline viewing of already-opened screens (memory only).

### Measurements

Dashboard query cost on the same 2,400-project database, old code vs new (`loadtest/dashboard_compare.py`):

| View | Old | New | |
|---|---|---|---|
| Management (all 2,400 projects) | 420 ms | 34 ms | **12.5× faster** |
| Sales (own 60 projects) | 15 ms | 10 ms | 1.4× faster |

API load test, 40 simultaneous users for 30 s, laptop + SQLite + 2 API processes (`loadtest/loadtest.py`):

| | Before | After |
|---|---|---|
| Throughput | 70 req/s | 74 req/s |
| 95th percentile | 1,634 ms | 1,396 ms |
| Median | 157 ms | 413 ms |
| Errors | 0 | 2 dropped connections |

Read this table with care: on a single laptop with SQLite (one writer at a time) and only two processes, the test
measures queueing on that machine, and results varied noticeably between runs. Single requests take 4–26 ms. A
meaningful load test needs the PostgreSQL staging copy (Docker), which is blocked until the C: drive has 10–15 GB free.

## 5. Bugs found and fixed along the way

* **Lost audit entries and slow uploads on SQLite (pre-existing).** Audit events written mid-request waited on the
  request's own uncommitted transaction; on SQLite the wait timed out and the entry was dropped (bill uploads,
  sign-up, login, refresh, change password, public proposal downloads, flagged bills in the worker). Audit entries are
  now written right after the endpoint finishes. Bill upload went from 33 s to well under 1 s, and the backend suite
  runs twice as fast. Regression test added. PostgreSQL production was not affected.
* **Dashboard month chart hid quiet months.** The API now always returns all 12 months.
* **Page transition mounted the next page twice** (introduced during this work, caught by the end-to-end tests): typed
  form input could be lost. Fixed by using entrance-only transitions.

## 6. Feature status, web and Android

Legend: **E2E** = automated Playwright test in Edge against a real API; **API** = backend pytest suite (52 tests);
**Build** = typecheck + full Android bundle; **Manual** = checked by hand in the browser.
Android was **not run on a phone or emulator** in this round: its column relies on typecheck + bundle and on the
shared API tests. Use the checklist in section 7.

| Feature | Web | Android | How tested | Result |
|---|---|---|---|---|
| Sign-up → verify email → pending → admin approves with role → login | ✓ | ✓ | E2E (web), API | Pass (web, API); Android not tested on device |
| Login, generic errors, lockout | ✓ | ✓ | API, E2E login in every test | Pass |
| MFA login (wrong code refused, right code accepted) | ✓ | ✓ | E2E, API | Pass |
| MFA setup / turn off from profile | ✓ | ✓ | API (mfa required for admins) | Setup screens **not tested** end to end |
| Forgot / reset password | ✓ | ✓ (request) | E2E, API | Pass |
| Change password | ✓ | ✓ | E2E | Pass |
| Logout, revoke another device's session | ✓ | ✓ | E2E, API | Pass |
| Session expiry / refresh rotation / reuse detection | ✓ | ✓ | API | Pass (not tested in a browser) |
| Biometric lock | n/a | ✓ | none | **Not tested** |
| Customers: search, create, edit, notes | ✓ | ✓ | E2E | Pass |
| Customers: team assign / remove | ✓ | ✓ | E2E (management), API | Pass |
| Customers: delete (Super Admin only) | ✓ | ✓ | E2E (sales has no button; admin deletes) | Pass |
| Users only see their own customers | ✓ | ✓ | E2E (second sales user refused), API (IDOR) | Pass |
| Projects: create with engineer, stage update, list filters, paging | ✓ | ✓ | E2E, API | Pass |
| Progress updates | ✓ | ✓ | API | Pass (slider not clicked in E2E) |
| Bill upload: CSV | ✓ | ✓ | E2E, API | Pass |
| Bill upload: PDF, photos, Excel, camera | ✓ | ✓ | API (file validation) | Camera/photo picker **not tested** |
| Malware scan and quarantine | ✓ | ✓ | API (infected file quarantined) | Pass; ClamAV itself not running locally |
| Extraction, review and correction, confirm | ✓ | ✓ | E2E (CSV, AI off), API (AI output validation) | Pass; real AI extraction **not tested** (no key in tests) |
| View original, re-extract, delete bill | ✓ | ✓ | none | **Not tested** |
| Bill analysis | ✓ | ✓ | API (full workflow) | Pass (API only) |
| **Quotation from a bill: upload, check values, size options, BOQ, payment schedule, EMI schedule, savings, layout drawing, PDF** | ✓ | ✓ | API (9 tests incl. both real MSEDCL bills, EMI vs bank formula, PDF content), manual browser run with a real bill | Pass (web, API); Android typecheck + build only |
| Single-login mode (no sign-up, no approval chain) | ✓ | ✓ | API tests, manual browser run | Pass (web, API) |
| Automatic estimate after upload (size, investment, saving, payback; labelled unconfirmed until reviewed; margin only for permitted roles) | ✓ | ✓ | E2E (bill and project pages), API (4 tests) | Pass (web, API); Android typecheck + build only |
| Calculator preview, save configuration | ✓ | ✓ | E2E, API | Pass |
| Compare configurations | ✓ | ✗ (web only) | none | **Not tested** |
| Engineer validation (and can't validate own) | ✓ | ✓ | E2E, API | Pass |
| Confidential pricing only for permitted roles | ✓ | ✓ | E2E (sales hidden, finance shown), API | Pass |
| Proposals: generate PDF, submit, approve | ✓ | ✓ | E2E, API | Pass |
| Proposals: return for changes, declined, revisions | ✓ | ✓ | API (full workflow) | Pass (API only) |
| Proposals: mark sent, customer accepted | ✓ | ✓ | E2E | Pass |
| Proposals: preview, download PDF | ✓ | ✓ | E2E (download) | Pass; in-page preview not checked |
| Share link create / revoke | ✓ | ✓ | E2E | Pass |
| Notifications (in-app), mark all read | ✓ | ✓ | E2E | Pass |
| Push notifications | n/a | ✓ | none | **Not tested** (needs a real build) |
| Dashboard KPIs and charts | ✓ | ✓ | E2E (every role), API, Manual | Pass |
| Admin: users (approve, disable, enable) | ✓ | ✓ | E2E, API | Pass |
| Admin: users (reject, unlock, reset MFA) | ✓ | ✓ | API (partly) | UI **not tested** |
| Admin: roles (custom role create/delete) | ✓ | ✓ | E2E, API | Pass |
| Admin: pricing assumptions (Finance) | ✓ | ✓ | E2E | Pass |
| Security dashboard, audit log, login activity, sessions | ✓ | ✓ | E2E, API | Pass |
| Audit integrity verification | ✓ | ✓ | E2E, API (tamper detection) | Pass |
| Every role sees only its menu items | ✓ | ✓ | E2E for all 7 roles | Pass |
| Light/dark mode, phone width with no sideways scroll | ✓ | ✓ (system) | E2E, Manual | Pass |

## 7. Android checklist (please run on your phone)

Restart the **Mobile app (Expo Go)** task, reopen Expo Go, then:

1. App opens with the dark-green header and the IBM Plex font; tab bar shows icons (activity, briefcase, battery,
   file, menu).
2. **Dashboard:** greeting and date; quick actions; KPI tiles; *Pipeline by month* chart; tap a column and its values
   appear underneath; *My projects* shows battery meters.
3. **Pull to refresh** on the dashboard and the customer list.
4. **Customers → a customer → Projects → a project:** stage buttons, progress, engineer choice.
5. **More → Projects:** scroll to the bottom; more projects load automatically (needs 50+ projects).
6. **Calculator:** calculate; *Savings by year* and *Payback* charts appear; tap a point on the payback line.
7. **Buttons** shrink slightly when pressed; cards slide in gently. Then turn on Android *Settings → Accessibility →
   Remove animations*, reopen the app: no animations.
8. **Dark mode:** switch the phone to dark mode, check the dashboard and a chart.
9. **Offline:** open a customer, turn on airplane mode, go back and reopen it: it still shows. Log out: data is gone.
10. **Upload a bill with the camera**, review it, confirm values.
11. Generate and **share a proposal PDF**; **biometric lock** after 5 minutes in the background.

## 8. Not done / known limits

* **Phone storage for offline use was deliberately not added.** Writing customer data to the phone needs encrypted
  storage to meet the security policy; offline viewing is in memory for the session. Ask if you want encrypted
  on-device storage.
* **Android was not run on a device or emulator** in this round (section 7).
* **Load testing on PostgreSQL/staging** is pending free disk space for Docker.
* Web E2E tests run with AI extraction and ClamAV switched off (both have API tests).
* The Android bundle grew from 3.0 MB to 4.3 MB (animation, SVG and font libraries).

## 9. How to run the checks

```powershell
cd apps\api; .\.venv\Scripts\python.exe -m pytest -q                       # backend, 52 tests
npm --workspace apps/web run e2e                                            # website end to end, 30 tests (Edge)
cd apps\api; .\.venv\Scripts\python.exe loadtest\loadtest.py seed           # load-test data
cd apps\api; .\.venv\Scripts\python.exe loadtest\dashboard_compare.py       # old vs new dashboard
```
