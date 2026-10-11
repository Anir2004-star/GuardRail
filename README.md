# Guardrail

Guardrail is an assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.

## Current milestone

The repository contains a complete frontend demo:

- responsive public landing page;
- sign-in, signup, and password reset preview forms;
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

All provider content is sample data. Demo changes persist in local browser storage and are reflected across the frontend. Authentication forms do not create or authenticate real accounts, passwords are never stored, and reset requests do not send email. The assistant is a scripted guide. Demo approval and execution operate only on sample items; no provider APIs or backend services are called. Cloud totals are derived from the sample index, including mock Trash. Account-wide allowance is unavailable because managed Gmail and Drive content is not necessarily the whole shared account usage. Device capacities are independent; the sample laptop has 512 GB. Registration grants no file access. Real measurements require a companion app later. The versioned mock service is in `lib/demo-service.ts`; this revised scope resets older demo snapshots when they are first opened.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the landing page or `http://localhost:3000/app/dashboard` for the application.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm audit
npm run test:e2e
```

Browser tests use the production build on port 3100. After installing dependencies, run `npx playwright install chromium` once, then `npm run build` before `npm run test:e2e`.

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
