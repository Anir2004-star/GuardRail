# Guardrail Windows Companion — step 19

A first native Windows desktop window, built with Windows PowerShell 5.1 and
WinForms. It runs directly from this repository, without another desktop framework,
administrator access, an installer or a background service. It is source-based,
not a packaged/signed `.exe` release. Do not run it as administrator.

## Start and pair — one step at a time

**Automatic opening from the website:** Run `Start-Guardrail.cmd` once after
getting this update. It registers `guardrail-companion://open` for your current
Windows account, then starts the companion. After that, clicking **Generate
pairing code** or **Generate a new code** on the website attempts to open the app
two seconds after the code is generated. The existing window is restored if the
updated app is already running. Close/reopen any older version once after updating.

Chrome/Edge may ask to open the app, or require a fresh click. Accept the normal
browser confirmation if you want to open it; the website also provides **Open
Guardrail Companion** as a fallback. Browser safety prompts are not bypassed.
The site cannot reliably tell whether the app is installed, so the message says
it will *try* to open. On non-Windows devices, use a paired Windows device instead.

The link only opens the window. No pairing code, account token, backend address or
command is included in the URI. You still paste the code and explicitly approve
the matching comparison number. It does not turn capacity sharing on automatically.

Registration uses only `HKCU\Software\Classes\guardrail-companion`, needs no
administrator rights and does not change browser policies, execution policies,
firewall rules or automatic startup. The handler invokes one fixed quoted script
and ignores incoming URI arguments. Unrelated handlers are not overwritten. After
moving the repository, run the launcher again to update its installed path.
See [Windows URI activation](https://learn.microsoft.com/en-us/windows/apps/develop/launch/handle-uri-activation).

To register links without starting the app, run from the repository root:

```cmd
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File companion/windows/Register-Guardrail.ps1
```

To remove only the app-link registration, add `-Unregister` to that command.
This preserves your saved pairing and files. `-Inspect` prints the fixed command
without changing the registry. `tests/Test-Protocol.ps1` verifies the command and
activation signal without modifying the real registration.

1. Keep Docker Desktop/PostgreSQL running. In a terminal inside `backend`, run
   `npm run dev` if your backend is not already running.
2. In a separate terminal at the repository root, run `npm run dev` if the website
   is not already running. Open `http://localhost:3000` and sign in.
3. Open **My devices**, register your Windows laptop if needed, then choose
   **View details → Generate pairing code**. Codes last fifteen minutes.
4. Open this folder in File Explorer:

   ```text
   C:\Users\ACER\OneDrive\Desktop\GuardRail\companion\windows
   ```

   Double-click **Start-Guardrail.cmd**. Or run this from the repository terminal:

   ```cmd
   companion\windows\Start-Guardrail.cmd
   ```

5. In the companion window, leave **Backend address** as `http://localhost:4000`
   for your current local setup. Enter the website's code and click
   **Connect using code**. This is the Express API address, not the Next.js address.
6. Compare the six-digit number shown in both the app and website. On the website,
   check **The numbers match on my device**, then click **Approve pairing**.
7. Keep the companion open until it says it is paired. It collects the credential
   once and saves it using Windows encryption. You never copy a device token.
   The app then automatically detects and syncs the manufacturer, model and Windows
   version, even when capacity sharing is off. These fields appear on the website
   within 30 seconds. Your chosen device name is preserved. Existing pairings also
   sync details when reopened with this updated app; no registration is repeated.
8. In the app, enable **Share fixed-drive capacity every minute while this window
   is open**. Sharing is off initially and after every restart. The app sends its
   first capacity report when you enable it. **Send capacity now** sends another.
9. Return to the website. Cards and device details refresh within 30 seconds.
   Details show each reported drive letter, total/used/free capacity, and the last
   server receipt time. Reports older than three minutes are marked stale.
10. Close the companion to stop all requests. Reopen it to load encrypted pairing
    and check access. Enable sharing again if desired. No auto-start task is added.

If local PowerShell scripts are blocked by an organization policy, follow your
administrator's policy. The launcher uses process-only `RemoteSigned`; it does
not change the machine/user execution policy or download executable code.

## Disconnect and recovery

- **Disconnect this app** asks for confirmation, revokes its credential on the
  backend, then removes its saved credential. It affects only this app's credential.
- Website **Disconnect companion app** revokes the device's credentials and
  cancels pending pairing. Reporting and identity requests then return 401. The
  app clears the revoked local credential on its next check (at most one minute).
- Removing a device/account cascades credentials and its latest capacity report.
- A network/server failure keeps saved pairing. A report failure is not retried
  as the same mutation; the next minute collects a fresh snapshot. A lost claim or
  exchange response requires a new code and owner approval; exchange is never
  automatically replayed. If you close the app during exchange, check/revoke the
  website's old pairing before starting again.
- An expired/unreadable saved file offers **Forget saved pairing**. This removes
  only the local file; revoke any old app from the website too. A failed local
  deletion is reported, and the app does not pretend the credential was removed.
- Device credentials expire after 30 days and require pairing again. There is no
  separate native login, user JWT or user refresh cookie in this app.
- Report validation failures can mean an incorrect Windows clock. Enable normal
  Windows date/time synchronization and retry. Capacity timestamps must be within
  five minutes of the backend. Excessive manual requests can trigger IP limits;
  stop sharing and wait before retrying.

## Credential protection and networking

The entire record (origin, device ID, token, expiry) is encrypted with Windows
DPAPI `CurrentUser` and atomically stored at:

```text
%LOCALAPPDATA%\Guardrail\Companion\credential.bin
```

The directory grants only the current Windows account access. There is no
plaintext token file, repository secret, token URL, credential command-line
argument, browser storage, cookie jar or token log. DPAPI protects data for the
Windows account; other programs running as that same account can also use its
DPAPI access. See [Microsoft's ProtectedData documentation](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.protect).

The credential is bound to the stored backend origin. Redirects and cookies are
disabled. HTTP is permitted only for exact local loopback names/addresses;
other origins require HTTPS with normal certificate validation. Authentication
headers are restricted to the companion/pairing API paths. Network work uses
asynchronous HTTP tasks checked by the UI timer, with a 15-second timeout and
64 KiB response limit. Polling waits five seconds, backs off on errors, and stops
when pairing expires. Only one instance per Windows user is allowed.

## What is reported

Device brand/model are read from `Win32_ComputerSystem.Manufacturer`/`Model`, and
Windows edition/version from `Win32_OperatingSystem.Caption`/`Version`. Detection
runs off the UI thread after backend identity validation, once per app launch.
Failed detection or sync retries automatically, with backoff for rate limits.
Missing/OEM placeholder values are omitted so they cannot erase known details.
The app never queries or sends computer/user names, serials, product IDs or MAC
addresses. These are companion-reported values, not independently attested hardware
identity. See [Microsoft's system information guide](https://learn.microsoft.com/en-us/powershell/scripting/samples/collecting-information-about-computers).

Only ready fixed logical volumes with drive letters are queried through .NET
`DriveInfo`: drive letter, total bytes, and `TotalFreeSpace` bytes. Used bytes are
derived on the backend as `total - free`. This is volume free space, not
`AvailableFreeSpace`, which can be affected by user quotas. Reports omit machine
names, serial numbers, volume labels, folders, file paths, filenames and contents.
Network/removable drives and inaccessible/unready volumes are excluded. Totals
cover the reported letters, not all physical installed capacity; hidden partitions,
aliases and quotas can make hardware totals or user-available capacity differ.
See [Microsoft's DriveInfo reference](https://learn.microsoft.com/en-us/dotnet/api/system.io.driveinfo).

Cleanup, remote folder grants/commands, a system tray,
automatic startup, an installer and automatic credential renewal are outside this
milestone. There is no API or app operation for deleting device files.

## Selected-folder scans

The companion now supports **Select folder → confirm metadata sharing → Scan and
send metadata**, with progress and cancellation. Scroll down in its window to find
these controls. See [the complete folder-scanning guide](../../backend/FOLDER_SCANS.md)
for steps, exclusions, limitations, privacy and tests. Choose an ordinary local
folder for the first scan; linked/cloud-only and system locations are excluded.

## Tests

From the repository root on Windows, using the normal signed-in Windows account:

```cmd
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File companion/windows/tests/Test-Core.ps1
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File companion/windows/Start-Guardrail.ps1 -SmokeTest
```

The core tests use uniquely named `.test-output` directories inside this folder,
never your real saved pairing. They verify DPAPI encryption/decryption, directory
permissions, atomic replacement, expiry/corruption, safe origins, token purpose,
fixed-volume collection and allowed request paths. The smoke test constructs the
actual native controls without loading real credentials or sending requests.

From `backend`, `npm run test:registration` includes a Windows-only real companion
protocol test. It launches the same core client against an isolated test database,
claims a code, compares/approves it, exchanges and encrypts a real credential, reads
actual fixed-volume capacity, posts it, then confirms that website revocation
rejects both identity and reports. Configuration arrives over stdin. The harness
logs no credentials and deletes only its own encrypted test file/directory. It
does not open a visible app, modify your saved pairing or send real email.
