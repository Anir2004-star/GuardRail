# Windows companion capacity reports — step 19

The [Windows companion](../companion/windows/README.md) uses the existing pairing
protocol and a separate opaque `Device` credential. The additive migration
`20261110000200_add_device_storage_reports` stores only the latest bounded snapshot
per device. Existing users, registrations and pairings are preserved.

## Native API

`POST /api/v1/companion/storage-reports`, header
`Authorization: Device <deviceToken>`, strict JSON:

```json
{
  "reportId": "7a761dfb-e56b-4bc6-b82d-4fd58e617346",
  "collectedAt": "2026-11-10T12:00:00.000Z",
  "volumes": [
    { "id": "C:\\", "totalBytes": 549755813888, "freeBytes": 137438953472 }
  ]
}
```

200 returns only `{ reportId, receivedAt }`. No browser/user cookie or user JWT
authenticates this endpoint. Credential lookup and verified-account access derive
the device/owner; body owner/device identifiers and extra fields are rejected.
It shares the companion transport policy: HTTPS in production, exact allowed
Origin if present, no query parameters, and no-store responses.

The API accepts 1–26 unique uppercase drive-letter roots, positive safe-integer
total bytes and free bytes in `[0, total]`; aggregate totals must also be safe
integers. The client collection timestamp must be within five minutes of the server.
The server derives used bytes, totals and receipt time. It does not attest that a
credential holder's measurements reflect the physical device.

Owner/device row locks are shared with pairing decisions, exchanges and disconnect.
A credential is rechecked for expiry/revocation inside the write transaction.
Replacement credentials cannot display the previous credential's snapshot. Exact
replays of the latest report return the original receipt without making stale data
look fresh. Reusing a report ID for changed data or sending an older/equal
collection time returns 409. A fresh snapshot overwrites the old one, so there is
no unbounded telemetry history. Duplicate-replay protection covers the latest
snapshot only; older reports are rejected by collection time.

400 errors are sanitized; invalid/expired/revoked credentials return 401. Reports
are limited to 60/IP/15 minutes independently of companion identity reads.
These single-process limits still need a shared store before scaling deployment.

`POST /api/v1/companion/disconnect`, same Device header, body `{}`, returns 204.
It revokes only that credential, with the same lock/recheck policy. An already
revoked credential returns 401; the app treats that as no longer authorized and
removes its own saved credential. Owner disconnect continues to revoke all device
credentials and pending pairings.

## Owner website

Owner-scoped device reads now include nullable `storage`:

- `collectedAt`, `receivedAt`, `totalBytes`, `usedBytes`, `freeBytes`;
- bounded `volumes` containing only letter root and total/used/free bytes.

Credential IDs, report IDs and hashes are omitted. Unpaired, expired and revoked
devices return `storage: null`; earlier data cannot be inherited by a replacement
app. Device/account deletion cascades snapshots. Revocation may retain the snapshot
internally until replacement or deletion, but owner reads hide it immediately.

The website refreshes signed-in lists/details every 30 seconds while visible.
Background refresh retains the current pairing panel and its code. A failed
background read leaves the last confirmed snapshot, whose displayed receipt time
keeps aging; three minutes without a report is marked stale. **Recent capacity
report** describes a receipt, not a claim that the device is currently online.
Foreground refresh and existing account/token guards still discard obsolete reads.
All capacity values are validated on the website too and remain out of browser
persistent storage. Explicit demo mode retains sample data.

## Verification

From `backend`: `npm run db:generate`, `npm run db:deploy`, `npm test`,
`npm run test:registration`. The runner creates and removes its own test database,
disables real SMTP, and includes a Windows-only native protocol/encryption test.
See the companion README for normal Windows-user DPAPI and UI smoke tests.

From the repository root: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run test:e2e`. Browser tests cover real-report rendering, stale reports,
disconnect clearing, background updates preserving the code, and impossible values.
