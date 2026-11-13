# Secure device pairing — step 18

This milestone adds the control-plane protocol and signed-in website screens.
The [Windows companion](../companion/windows/README.md) and capacity reporting
were added in step 19. Pairing does not grant file access.
Explicit demo mode continues to use separate sample pairing.

## Try the website

1. Start PostgreSQL, the backend and frontend as described in the READMEs.
2. Sign in with a verified account and open **My devices**.
3. Register a device, choose **View details**, then **Generate pairing code**.
4. The 12-character code is valid for fifteen minutes. Enter it in the Windows
   companion app. The browser keeps it in memory only; a reload cannot recover it.
5. Compare the six-digit number on both screens. Only approve when they match
   on your physical device. Candidate name/platform/version are self-reported,
   not attested identity. Reject an unexpected request.
6. Approval leaves the device unpaired until the companion exchanges its own
   claim token. Once exchanged, a valid device credential marks it **Paired**.
7. **Disconnect companion app** revokes access immediately and cancels pending
   pairing. Removing the registration also removes credentials. Neither deletes files.

Step 4 onward can also be exercised by an API client in local development or by
the isolated integration tests. The website
deliberately has no simulated claim or credential-exchange button for real devices.

## Owner API

All paths below start with `/api/v1/devices/:id`. They require the owner's user
`Authorization: Bearer <access token>`. Writes also require the exact configured
`Origin`. Cookie authentication and client-supplied owner IDs are not accepted.
Every route rejects query parameters and uses `Cache-Control: no-store`.

- `POST /pairing`, body `{}` → 201 `{ pairing, code }`. Returns the code once.
  Starting another session cancels the previous pending session. It leaves any
  existing device credential valid until the replacement is exchanged.
- `GET /pairing` → 200 `{ pairing: null | { id, state, expiresAt, claimId,
  comparisonCode, candidate } }`. Never returns the raw pairing or claim secret.
- `POST /pairing/:pairingId/approve`, body `{ "claimId": "<claimed UUID>" }`
  → 200 `{ pairing }`. Binds approval to that exact claimed app request.
- `POST /pairing/:pairingId/reject` or `/cancel`, body `{}` → 200 `{ pairing }`.
- `POST /disconnect`, body `{}` → 204. Repeated disconnects are safe.

Unknown and other owners' device/session identifiers return 404. Invalid input
returns sanitized 400; stale, expired or incompatible state returns 409; limits
return 429. Owner device limits remain 300 reads and 60 writes per IP/15 minutes.

## Companion API contract

These are custom Guardrail pairing endpoints, not an OAuth device grant.
They do not use the website refresh cookie or grant access to user account APIs.
Local development uses `http://localhost:4000`; production requires HTTPS.

1. `POST /api/v1/pairing/claim`, no authentication, JSON:

   ```json
   { "code": "ABCD-EFGH-JKLM", "appName": "Guardrail companion", "platform": "Windows", "appVersion": "0.1" }
   ```

   The code must be real and unexpired. One claimant wins. 201 response contains
   `pairingId`, `claimToken`, `comparisonCode`, `expiresAt`, `pollIntervalSeconds`.
   Show the comparison number to the person pairing. Keep the claim token private.
2. `GET /api/v1/pairing/status`, header `Authorization: Pairing <claimToken>`.
   Poll no faster than the returned five-second interval. Read `state` and expiry.
   Stop for `Expired`, `Cancelled`, `Rejected` or `Completed`. Status contains no
   owner profile, email, device credential or pairing code.
3. After `Approved`, `POST /api/v1/pairing/exchange`, same Pairing header, body `{}`.
   A successful 201 returns `deviceId`, `deviceToken`, `expiresAt`. Save the token
   in the operating system's secure credential store, never in logs or a URL.
4. `GET /api/v1/companion/me`, header `Authorization: Device <deviceToken>`.
   Returns safe device ID/name/type and credential expiry. No storage or file API
   is enabled. User Bearer JWTs cannot authenticate this endpoint, and device
   credentials cannot authenticate user endpoints.

Codes have 60 bits of random entropy and are stored as purpose-specific SHA-256
hashes. Claim and device tokens each contain 256 random bits; only purpose-specific
hashes are stored. The six-digit comparison number is a visual check, not a secret
that authorizes an exchange. No extra signing secret or environment setting is needed.

Exchange is atomic and one-time. Approval alone creates no device credential.
Concurrent exchanges produce exactly one credential. A successful replacement
exchange revokes the old credential in the same transaction. If an exchange
response is lost, its raw token cannot be recovered: restart pairing and approve
again. The website never receives the device token. User and device row locks
serialize claims, owner decisions, exchanges and disconnects.

Pairing expires after fifteen minutes without extending on claim/approval. Device
credentials expire after 30 days, after which the user must pair again; automatic
credential renewal and native secure storage are future companion work. **Paired**
means a current unrevoked credential exists, not that the device is online.
Heartbeat, folder permission grants, telemetry, storage scans and cleanup remain
separate milestones. Revoked/completed credential history is retained with its
registration; expired unused and cancelled/rejected sessions are pruned when a
new session starts. Removing a device or user cascades all its pairing data.

Claim guesses are limited to 20/IP/15 minutes, polls to 300, exchanges to 60 and
companion identity reads to 300. These in-memory limits are for this single-process
milestone. Before multi-instance deployment, configure a shared limiter and an
explicit trusted-proxy policy. Production companion endpoints reject insecure
requests: terminate TLS at Express or deliberately configure trusted TLS proxy
handling; do not blindly trust forwarded headers. Never log authorization headers,
request bodies or token-bearing URLs. Query-string tokens are not supported.

## Database and checks

The additive `20261110000100_add_device_pairing` migration adds
`device_pairing_sessions`, `device_credentials` and the `PairingState` enum.
It preserves existing registrations/users. Run from `backend`:

```cmd
npm run db:generate
npm run db:deploy
npm test
npm run test:registration
```

The database runner creates and removes its own randomly named local test
database and disables real SMTP. Pairing tests cover claims, ownership/origin,
hashes, mismatched approvals, concurrent exchanges, expiry, rejection/cancellation,
replacement, credential purpose separation, disconnect/removal and brute-force
limits. Browser fixtures test code loss on reload, explicit comparison approval,
pending versus paired status, disconnect, safe errors and uncertain writes.
