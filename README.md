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
as samples. Demo profile settings still edit only the sample profile. Returning
to sign in or choosing the demo clears memory; neither action revokes the refresh
session or removes its cookie. Real logout is a later milestone.

The backend now exposes POST /api/v1/auth/refresh with token rotation and reuse
detection (step 9; see backend/README.md). Frontend token renewal, cookie-based
session restoration, protected API calls and route guards remain pending. A full reload clears frontend authentication state even
though the refresh cookie may remain; it shows the demo identity again. Direct
access to the sample dashboard is still available. The stored expiresAt records
the access-token deadline for future authenticated requests; this milestone does
not refresh an expired token or fetch real storage data.

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
storage and loss of in-memory identity after a full reload. These browser tests
do not create accounts in the development database.

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
