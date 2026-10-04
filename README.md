# Guardrail

Guardrail is an AI-assisted, human-approved storage organizer. It helps people understand and clean up content across providers without allowing AI to perform destructive actions on its own.

## Current milestone

The repository contains the first runnable product surface:

- responsive public landing page;
- sign-in screen;
- authenticated application shell with desktop and mobile navigation;
- storage usage overview backed by Recharts;
- realistic recommendation and activity views;
- visible approval and revalidation language throughout the cleanup workflow;
- sync-status popover and responsive dashboard states.

All data is currently seeded presentation data. Provider OAuth, persistent storage, analysis jobs, and action execution are intentionally not simulated as real operations yet.

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
```

## Safety invariant

The backend implementation must preserve this state transition:

`proposed → awaiting approval → approved → revalidated → executing → completed | partial | failed | uncertain`

An execution request must reference a valid, unexpired approval created for the exact item set and exact proposed operations. Any change to the items, operation, provider state, or relevant policy invalidates the approval. AI output may create proposals; it must never create approvals or call provider mutation APIs directly.

## Recommended next slice

Build the Express control plane around a mock provider first: proposal records, item-level approvals, single-use approval tokens, immutable audit events, and a worker that refuses unapproved or stale actions. This lets the safety model be tested before connecting Gmail or Google Drive credentials.
