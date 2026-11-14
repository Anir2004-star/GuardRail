# Selected-folder metadata scans — step 20

This milestone adds local folder selection and a cancellable read-only metadata
scan in the Windows companion. Results are visible only on the owner's device
page. It creates no remote folder access grant or cleanup capability.

## Use it

1. Keep PostgreSQL, the Express backend and website running.
2. Close/reopen the updated companion with `companion\windows\Start-Guardrail.cmd`.
   Existing saved pairing is reused; pair once if not already paired.
3. Scroll down in the companion to **Read-only folder scan → Select folder**.
4. Choose a small personal **local** folder. Check its full path shown locally.
5. Read and check the statement allowing the summary and largest-file metadata
   to be sent to your paired backend, then click **Scan and send metadata**.
6. Progress shows counted files, bytes and skipped entries. **Cancel scan** stops
   the worker and discards its result, even if computation just finished. No upload
   begins after cancellation. Once upload starts it cannot be recalled; check the
   website if a response is lost. Closing the app cancels any ongoing scan.
7. Open **My devices → View details → Folder scan results**. It refreshes every
   30 seconds while visible, or use **Refresh scan**. See counts, logical file size,
   type totals and the 20 largest relative file paths, sizes, types and modified times.

Capacity sharing is independent: scanning requires its own local confirmation.
The app never scans automatically after pairing, startup or an app-link activation.
Re-running a scan requires confirming metadata sharing again. A cancelled scan
leaves the last successfully uploaded result on the website unchanged.

## Boundaries and limitations

The scanner uses directory enumeration and filesystem metadata (`FileInfo.Length`
and `LastWriteTimeUtc`) on a background .NET task. It does not open file contents,
hash content, move, rename or delete user files. The selection is kept in memory,
not in a configuration file. The absolute root stays in the native window.

Only fixed local subfolders are accepted. Volume roots, UNC/network/removable
drives, Windows/Program Files/ProgramData, Guardrail credential folders, and roots
with linked ancestors are rejected. Reparse points/junctions/symlinks, hidden/system,
offline/cloud-only and inaccessible entries are skipped. OneDrive paths with
reparse-point ancestors may therefore be rejected; start with an ordinary local
folder outside OneDrive. Common secret/dependency names (`.git`, `.ssh`, `.aws`,
`.azure`, `.codex`, `.agents`, `.gnupg`, `node_modules`, `.env*`, certificate/private
key extensions) are skipped too. Filenames themselves can be private: the explicit
confirmation covers transmission to the already paired backend.

Work is capped at 100,000 visited entries, depth 64 and ten minutes; safe-integer
byte bounds, metadata path-length limits and a maximum 20 result/type groups keep
the upload bounded. Skips or limits are clearly shown as partial coverage. Empty
folders are valid. Reported logical sizes can double-count hard links and do not
represent actual physical disk allocation. Files may change during a scan. This
is not an atomic snapshot; reparse checks are best-effort against concurrent
filesystem changes and the scanner never elevates privileges to overcome access.
Long/unavailable paths are skipped. Cancellation is checked between filesystem
operations; an OS operation already in progress may take time to return.

## API and retention

`POST /api/v1/companion/folder-scans` uses `Authorization: Device <deviceToken>`.
Strict JSON contains `scanId`, `folderName` (basename only), `startedAt`,
`finishedAt`, `fileCount`, `totalBytes`, `skippedCount`, `limitReached`, `types`
and `largestFiles`. Each file includes only `relativePath`, `type`, `bytes` and
`modifiedAt`. No absolute root, user/device ID or credential is accepted in the body.
The response is `{ scanId, receivedAt }`. End time must be within five minutes of
server time; scan duration is bounded. Summary and file counts/sizes are validated,
as are relative paths (no drive/UNC prefix, traversal segments or control characters).

`GET /api/v1/devices/:id/folder-scan` requires the owner's user Bearer token and
returns `{ scan: null | reportWithReceivedAt }`. Foreign/unknown devices return the
same 404. Both APIs reject query parameters, return no-store responses and keep
existing Origin/TLS/authentication policy. Uploads are limited to 10/IP/15 minutes;
owner reads share the 300/IP/15-minute device-read limit. Production multi-instance
deployment still needs shared rate limiting and trusted TLS proxy configuration.

The additive `20261114000100_add_device_folder_scans` migration creates one
`device_folder_scans` row per device, tied to the credential that uploaded it.
Existing users/devices/pairings are preserved. New reports replace the old snapshot;
there is no unbounded file index/history. Exact retries of the current scan ID
return the original receipt. Changed payloads using that ID, or older/equal finish
times under another ID, return 409. Validation errors are sanitized 400s.

Owner/device transaction locks and a credential recheck serialize writes with
disconnect/replacement. Invalid, expired or revoked senders receive 401. Owner
reads hide snapshots from revoked/replaced credentials; device/account deletion
cascades them. Previously accepted snapshots may remain internally until replacement
or deletion. Failed or ambiguous uploads are never automatically replayed.

## Tests

From the repository root:

```cmd
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File companion/windows/tests/Test-Scan.ps1
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File companion/windows/Start-Guardrail.ps1 -SmokeTest
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

From `backend`: `npm run db:generate`, `npm run db:deploy`, `npm test`,
`npm run test:registration`. Scanner fixtures use uniquely named temporary folders,
a junction to another temporary fixture, excluded secret examples and cancelled
tokens. Cleanup deletes only known fixture files and empty directories. Personal
folders are never scanned by tests. The native HTTP test uploads a 12-byte sample
file, then confirms revocation rejects another upload. The database runner creates
and removes its own test database and disables real SMTP.
