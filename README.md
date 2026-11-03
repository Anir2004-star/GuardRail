# Guardrail

Guardrail is an assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.

## Current milestone

The repository contains a complete frontend demo:

- responsive public landing page;
- signup connected to the real Express registration API;
- sign-in connected to the real Express login API, plus a password reset preview;
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

All provider content is sample data. Demo workspace changes persist in local browser storage. Signup creates a real PostgreSQL user through the Express API; signup data and passwords are not saved in browser storage. Passwords are sent to the backend and stored only as bcrypt hashes. Signup does not log the user in. Sign-in authenticates a registered account; the access token and safe profile stay in memory, while the backend sets an HttpOnly refresh cookie. Password recovery remains a preview and sends no email. The assistant is a scripted guide. Demo approval and execution operate only on sample items; provider APIs are not connected. Cloud totals are derived from the sample index, including mock Trash. Account-wide allowance is unavailable because managed Gmail and Drive content is not necessarily the whole shared account usage. Device capacities are independent; the sample laptop has 512 GB. Device registration grants no file access. Real measurements require a companion app later. The versioned mock service is in `lib/demo-service.ts`; this revised scope resets older demo snapshots when they are first opened.

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
renewal. Protected API calls, route guards and real storage data remain pending;
direct access to the sample dashboard is still available.

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
when a previously known session expired; a fresh anonymous visit stays a demo.

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

These are frontend coordination controls, not server authorization. Protected
routes/API middleware and provider data remain separate milestones.

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
lifetime); instantaneous access-token revocation is not implemented. Protected API
middleware and route guards remain the next milestone.

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

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
