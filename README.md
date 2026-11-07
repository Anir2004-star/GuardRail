# Guardrail

Guardrail is an assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.

## Current milestone

The repository contains a complete frontend demo:

- responsive public landing page;
- signup connected to the real Express registration API;
- sign-in and email password recovery connected to the Express API;
- application shell with desktop and mobile navigation;
- storage usage overview backed by Recharts;
- search, sorting, filters, item previews, folder organization, and item protection;
- Gmail and Drive connection previews and cancellable sample scans;
- smartphone, tablet, and laptop registration, including Apple and other brands, with editable sample capacities and device dashboards;
- 70% / 90% device alert examples, protection rules, and warm-light / charcoal appearance preferences;
- item-level recommendation review, explicit approval, separate execution, activity, and restore views;
- notifications with read states, editable profile and preferences, help, and public information pages;
- visible approval and revalidation language throughout the cleanup workflow;
- sync-status popover and responsive dashboard states.

All provider content is sample data. Demo workspace changes persist in local browser storage. Signup creates a real PostgreSQL user through the Express API; signup data and passwords are not saved in browser storage. Passwords are sent to the backend and stored only as bcrypt hashes. Signup does not log the user in. Sign-in authenticates a registered account; the access token and safe profile stay in memory, while the backend sets an HttpOnly refresh cookie. Password recovery sends one-use reset links through SMTP; local Mailpit captures development email. The assistant is a scripted guide. Demo approval and execution operate only on sample items; provider APIs are not connected. Cloud totals are derived from the sample index, including mock Trash. Account-wide allowance is unavailable because managed Gmail and Drive content is not necessarily the whole shared account usage. Device capacities are independent; the sample laptop has 512 GB. Device registration grants no file access. Real measurements require a companion app later. The versioned mock service is in `lib/demo-service.ts`; this revised scope resets older demo snapshots when they are first opened.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the landing page or `http://localhost:3000/app/dashboard` for the application.

## Real signup

First complete the database, migration and private environment setup in
[`backend/README.md`](backend/README.md). Keep Docker Desktop running and start
the Express backend in its own terminal:

```cmd
cd backend
npm run dev
```

Run the frontend's `npm run dev` in a separate terminal at the repository root,
then visit `http://localhost:3000/signup`. The default API address is
`http://localhost:4000`. To change it, put the following public setting in the
root `.env.local` (not `backend/.env`):

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4000
```

The committed root `.env.example` shows this setting. Never put signing secrets
or database credentials in a NEXT_PUBLIC variable. Restart the frontend after an
environment change; production builds bake the API address in at build time.

Use `localhost` consistently. The browser's Origin must exactly match the
backend's FRONTEND_ORIGIN (normally `http://localhost:3000`), including its port.
For deployed use, configure HTTPS for both services.

Signup sends only the three names, normalized email and unchanged password.
Confirm password and the privacy checkbox are checked on screen. A pending
request disables submission; field errors, duplicates, rate limiting and network
errors are shown without exposing server details. Success clears both password
inputs and offers a sign-in link, without issuing a token or navigating to the
demo dashboard. Sign in separately at `/login`.

## Real sign-in (step 8)

Start PostgreSQL, the backend and the frontend using the setup above, register
an account, then visit `http://localhost:3000/login`. Use its exact password,
including spaces and case. Login normalizes email but leaves passwords unchanged;
it does not reapply signup's password composition rules.

`lib/login-api.ts` sends only email and password to POST /api/v1/auth/login with
credentials: include, no-store caching, rejected redirects and a 15-second timeout.
It checks the success response shape, selects safe user fields and maps 400, 401,
403, 429, server errors and connection failures to local messages. Raw backend
errors, passwords and tokens are never displayed or logged. The API base URL is
the same NEXT_PUBLIC_API_URL used for signup. FRONTEND_ORIGIN must exactly match
the frontend address; use localhost consistently for both services.

`components/auth-screen.tsx` replaces demo sign-in with this request. Submission
is disabled while pending; failures stay on the form and allow retry. Success
clears the password field, saves the validated session in `components/auth-store.ts`
and uses client navigation to replace the page with /app/dashboard. The Zustand
auth store has no persistence or devtools middleware: passwords and access tokens
are never written to localStorage/sessionStorage or demo settings. The backend
refresh token is stored only in its HttpOnly cookie; frontend code cannot read it.

The sidebar shows the returned account name and labels storage content/actions
as samples. Demo profile settings still edit only the sample profile. The registered
account menu includes real Sign out (step 11 below). Choosing the demo only clears
frontend identity and disables restoration; it is not server-side revocation.

The backend exposes POST /api/v1/auth/refresh with token rotation and reuse
detection (step 9; see backend/README.md). Step 10 below connects restoration and
renewal. Step 12 adds protected account requests and workspace guards. Sample
workspace access now requires an explicit demo choice. Real provider data remains pending.

## Session restoration and renewal (step 10)

`components/session-manager.tsx` is mounted once in the root layout. Opening or
reloading a workspace page restores the session using the HttpOnly cookie. Public
login/signup/recovery pages do not automatically attempt restoration. Active
sessions renew 30 seconds before their access token expires; foreground, visibility
and pageshow events recheck deadlines after background throttling or sleep. Session
state is still held only in memory. Tokens are not placed in browser storage.

`lib/refresh-api.ts` posts to /api/v1/auth/refresh with credentials: include,
no-store caching, rejected redirects and a 15-second timeout. It sends no password,
access token or token body. Validated success responses update the same safe profile
and in-memory access-token store as login. 401 clears identity and asks for sign-in
when a previously known session expired; anonymous workspace visits go to sign-in.

`lib/session-coordinator.ts` shares one in-flight refresh promise per tab and uses
a named Web Lock to serialize both login and refresh across same-origin tabs.
BroadcastChannel distributes new access sessions in memory. Messages are validated
and accepted only for the current operation revision; late results cannot undo an
explicit decision to leave the session. Tabs may sequentially refresh the updated
cookie if they miss a broadcast; they never refresh the same cookie concurrently.
Lock acquisition is bounded to 20 seconds. HTTPS (or localhost) and Web Locks are
required for automatic renewal; unsupported coordination disables renewal safely.

The localStorage key `guardrail.auth.coordination.v1` contains ONLY an operation
revision, coordination status and a fixed reason code. It never stores tokens,
passwords, cookies, emails or profiles. A pending marker is written before network
dispatch. If a tab closes or loses the response, later tabs/reloads cannot safely
know whether the token was consumed: they pause instead of replaying it. This
metadata deliberately survives reloads. Blocked coordination storage also prevents
automatic refresh; it does not silently switch to uncoordinated requests.

Network/timeout, malformed response, 403, 429 and server failures pause renewal
without an automatic retry loop. A still-valid access session remains available
until its deadline, then its identity is cleared. A visible notice asks for fresh
sign-in; successful sign-in resets the pause. Focus events, reloads and other tabs
cannot bypass it. No automatic recovery is promised after an ambiguous response.

These are frontend coordination controls. Step 12 adds server authentication and
workspace guards; provider data remains a separate milestone.

## Real logout (step 11)

Open the profile menu and choose **Sign out**. `logoutClientSession` in
`lib/session-coordinator.ts` immediately clears in-memory identity across tabs and
invalidates late login/refresh results. It then waits for the shared cookie lock,
so an in-flight refresh's replacement cookie arrives before the logout request.
A login queued before logout cannot silently sign the user back in. A later
explicit sign-in can establish a new session normally.

`lib/logout-api.ts` posts to /api/v1/auth/logout with credentials: include, no body,
no access token, no-store caching, rejected redirects and a 15-second timeout.
The backend revokes that cookie's family and clears the cookie on HTTP 204.
All open workspace tabs return to /login, stop renewal, and remain signed out
after reload. The non-secret coordination marker records the signed-out state.
Demo sample settings/items are not deleted. Separate device/login families are
not revoked by this current-session logout.

Network, 403, 429 and server errors still clear frontend identity and stop renewal,
but are not reported as confirmed server logout. A visible **Retry logout** button
persists across reloads. Retries are explicit, serialized and safe to repeat;
no retry loop runs automatically. An interrupted logout also offers this recovery.
The backend preserves the cookie on internal failure so a retry can identify and
revoke the same family. Signing in again does not claim an earlier failed logout
was confirmed.

Logout revokes refresh sessions and discards frontend access tokens. Already issued
access JWTs copied elsewhere still expire normally (up to the configured access
lifetime); instantaneous access-token revocation is not implemented. Step 12 below
adds protected API middleware and workspace guards.

## Protected account access and workspace guard (step 12)

`GET /api/v1/auth/me` requires a single Authorization: Bearer header. The backend
verifies the JWT and checks that its subject still identifies an existing account.
It returns only the current safe database profile, with Cache-Control: no-store.
Cookies, body/query user IDs and demo markers cannot authenticate this endpoint.
Missing, malformed, duplicate, expired, forged or deleted-account credentials get
generic 401 responses. Database availability failures remain generic 500 responses.

`lib/authenticated-api.ts` provides GET-only authenticated requests to fixed paths
on NEXT_PUBLIC_API_URL. It reads access tokens from memory, omits cookies, rejects
redirects, disables caching, and deduplicates in-flight reads. When a token expires
or a read receives 401, renewal uses the existing coordinator. Each read retries
at most once with a replacement token; another 401 clears the rejected session.
Network/server failures show a service error, not a password error. No private
request is sent in demo mode or without a usable token.

`components/workspace-guard.tsx` wraps the workspace layout. It waits for restoration
and verifies /auth/me before rendering the shell and workspace. It rechecks on
token or route changes, uses the verified database profile, and ignores results
from a superseded session. Anonymous users return to /login. Service failures
block the workspace and offer a retry while a usable session remains; ambiguous
refresh failures still require fresh sign-in. Expiry removes stale access sessions
even if a renewal is still in progress.

Choose **Explore without signing in** or a clearly labeled public demo link to
enter sample mode. `components/demo-link.tsx` records that explicit choice; generic
Get started/Start organizing links go to signup. Leaving the demo clears this
choice. The demo flag only controls sample UI and never grants backend access.
Tests of sample features opt into demo mode explicitly.

The Next.js workspace still contains statically generated SAMPLE content. Its
client guard is a display/navigation control, not a server authorization boundary.
All future private data reads and mutations must use protected backend endpoints
with their own ownership/permission checks. This milestone protects /auth/me; it
does not add provider/file APIs or immediate revocation of copied access JWTs.

## Password recovery (step 13)

Forgot password now sends a reset email through SMTP. Local development uses
Mailpit, which catches email on your computer instead of sending it to a real inbox.

1. In a terminal inside `backend`, run
   `docker compose --env-file .env.postgres --profile mail up -d`.
2. For a fresh checkout, run `npm run db:generate` and `npm run db:deploy` there.
   The additive password-reset migration has already been applied on this machine.
3. Start the backend with `npm run dev` from `backend`, and the frontend with
   `npm run dev` from the project root, in separate terminals.
4. Visit `http://localhost:3000/forgot-password` and enter a registered email.
5. Open `http://localhost:8025`, open the captured email, and follow its reset link.
6. Choose a new password with at least 8 characters, uppercase, lowercase, a
   number and a special character (maximum 72 UTF-8 bytes). Then sign in separately.

The link expires after 30 minutes and works once. Requesting a replacement after
the 60-second resend cooldown invalidates older links. The reset secret is hashed
in PostgreSQL; the email link carries it in a fragment that the reset page removes
from the address bar. It is never placed in browser storage. A successful reset
revokes all refresh sessions and clears the current browser session across tabs.
Copied access JWTs retain their normal expiry; immediate JWT revocation is not added.

For delivery to real inboxes, configure the backend SMTP settings described in
`backend/.env.example` and `backend/README.md`. Mailpit does not deliver externally.
The bounded email queue runs in memory; pending jobs can be lost on a process crash.

`tests/password-recovery.spec.ts` checks both forms, secret handling, errors and
cross-tab session clearing with controlled API responses. Backend tests use actual
SMTP captured locally and a disposable PostgreSQL database, with no external email.

## Google sign-in (step 14)

Login and signup now offer **Continue with Google**. Google signup creates an
account and signs in. Google login requires a previously
registered or linked Google identity; it never creates accounts implicitly.
Existing password accounts use **Link existing account with Google** on the login
page, enter their existing Guardrail password, and choose the matching Google
account. Matching email alone never links an account.

### Configure your Google client

1. Open the [Google Auth Platform Clients page](https://console.cloud.google.com/auth/clients).
   Select or create a project, then complete its Branding and Audience settings.
   For a personal app, choose External; add your own email under test users when
   the consent configuration is in Testing.
2. Create an OAuth client with application type **Web application**.
3. Add authorized JavaScript origins `http://localhost` and
   `http://localhost:3000`. Add your HTTPS frontend origin for deployment.
   No redirect URI is required for this JavaScript popup callback flow.
4. Copy the client ID ending in `.apps.googleusercontent.com` into `backend/.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-real-web-client-id.apps.googleusercontent.com
   ```

   Replace the entire sample value with Google's actual ID. No Google client
   secret is needed. The backend supplies the public ID to the browser, so there
   is no second frontend environment setting to keep in sync.
5. From `backend`, run `npm run db:generate` and `npm run db:deploy` on a fresh
   checkout. This machine's migration has already been applied. Restart the backend
   and frontend, then test signup on `/signup` and later login on `/login`.

Until the client ID is configured, the Google option shows a safe availability
message and email/password authentication remains usable. Browser tests use a
controlled Google SDK and backend responses; they do not authenticate a real
Google account. A real popup smoke test still requires your configured client ID.

Google identity is stored by its stable subject, with no Google access/refresh
tokens or Gmail/Drive permissions. New Google-only accounts require a verified
Google-hosted Gmail/Workspace email. For Google accounts using other email
providers, register with any valid email/password first, then link with the
existing password. Google profile names can be absent and remain nullable.

The backend checks signature, audience, issuer, expiry, verified email and a
single-use browser-bound nonce. A five-minute HttpOnly challenge cookie and
database record prevent replay; starting another Google flow in a second tab
replaces that browser's challenge, so finish one Google popup at a time. Guardrail
sessions reuse the existing in-memory access-token and HttpOnly refresh-cookie
system. Raw Google credentials and passwords are never stored in browser storage.

See Google's [setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
and [server verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm audit
npm run test:e2e
```

Browser tests use the production build on port 3100. After installing dependencies, run `npx playwright install chromium` once, then `npm run build` before `npm run test:e2e`.

Signup browser tests intercept the API with controlled responses, so they do not
create development accounts or require a running backend. They verify the request
fields, loading/error/success states, cleared passwords and unchanged browser
storage. The backend's `npm run test:registration` separately tests the connected
API and PostgreSQL using an isolated temporary database.

`tests/login.spec.ts` similarly uses controlled API responses to check exact
password handling, normalized email, pending/error/retry states, credentialed
cookie requests, safe response validation, dashboard identity, unchanged secret
storage and safe handling of an invalid refresh session after a full reload. These browser tests
do not create accounts in the development database.

`tests/session.spec.ts` uses controlled rotating cookies and a simulated browser
clock to cover reload restoration, early renewal, simultaneous tabs, lost responses,
cross-tab expiry, pause persistence, interrupted requests, unsupported locking,
late-response cancellation and recovery through fresh sign-in. Backend rotation
and database concurrency remain covered by the separate backend integration suite.
It also tests cross-tab logout, cookie removal, refresh/logout ordering, and explicit
retry after logout network/server/origin/rate-limit failures.
`tests/auth-guard.spec.ts` covers guarded loading, bearer-only account reads,
renewal after a rejected token, deleted-account behavior, service-error retry,
late responses, public pages and explicit demo isolation. The backend's isolated
integration suite checks actual JWT/account validation against PostgreSQL.

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
