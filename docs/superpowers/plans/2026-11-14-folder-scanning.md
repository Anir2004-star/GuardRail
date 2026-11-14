# Selected-folder read-only scanning

Authorized scope: choose and confirm a local folder in the Windows companion;
scan file metadata with progress/cancellation, upload a bounded summary and the
20 largest relative paths, and review results in the owner-only device page.
No file-content reads, file changes, remote scan commands, or implicit scans.

1. Add background .NET scanner, PowerShell wrapper and isolated fixture tests.
   Skip linked/offline/hidden/system entries and common secret/dependency paths.
   Bound work to 100,000 entries, depth 64, ten minutes and safe integer totals.
2. Add a latest-per-device snapshot tied to the active credential, strict
   validation, authenticated companion POST and owner GET. Shared transaction
   locks, idempotent receipt, older-report rejection and sanitized errors.
3. Add folder picker, explicit metadata-upload confirmation, start/cancel and
   progress to the companion. Cancel/close/session loss discard unsent results.
4. Add owner-only device-page summary, type totals and largest-file table with
   account/token guards and periodic refresh. No absolute root or path links.
5. Run scanner fixtures, validation tests, isolated database tests including the
   native upload, browser display tests, lint, TypeScript and production build.

Metadata changes during traversal are not an atomic snapshot. Reparse checks
are best-effort against concurrent filesystem changes. Each scan requires local
selection/confirmation; it creates no reusable remote folder grant. Only the
latest active credential's latest bounded result is shown. Existing work stays.
