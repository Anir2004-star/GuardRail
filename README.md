# Guardrail

Guardrail is an assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.

## Current milestone

The repository contains a complete frontend demo:

- responsive public landing page;
- signup connected to the real Express registration API;
- sign-in and password reset preview forms;
- authenticated application shell with desktop and mobile navigation;
- storage usage overview backed by Recharts;
- search, sorting, filters, item previews, folder organization, and item protection;
- Gmail and Drive connection previews and cancellable sample scans;
- smartphone, tablet, and laptop registration, including Apple and other brands, with editable sample capacities and device dashboards;
- 70% / 90% device alert examples, protection rules, and warm-light / charcoal appearance preferences;
- item-level recommendation review, explicit approval, separate execution, activity, and restore views;
- notifications with read states, editable profile and preferences, help, and public information pages;
- visible approval and revalidation language throughout the cleanup workflow;
- sync-status popover and responsive dashboard states.

All provider content is sample data. Demo workspace changes persist in local browser storage. Signup creates a real PostgreSQL user through the Express API; signup data and passwords are not saved in browser storage. Passwords are sent to the backend and stored only as bcrypt hashes. Signup does not log the user in. Sign-in and password recovery remain explicitly labelled demos, and reset requests do not send email. The assistant is a scripted guide. Demo approval and execution operate only on sample items; provider APIs are not connected. Cloud totals are derived from the sample index, including mock Trash. Account-wide allowance is unavailable because managed Gmail and Drive content is not necessarily the whole shared account usage. Device capacities are independent; the sample laptop has 512 GB. Device registration grants no file access. Real measurements require a companion app later. The versioned mock service is in `lib/demo-service.ts`; this revised scope resets older demo snapshots when they are first opened.

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
demo dashboard. Real sign-in must still be implemented.

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

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
