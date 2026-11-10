#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\Guardrail.Core.ps1"
$script:count = 0
function Assert([bool]$Value, [string]$Message) { if (!$Value) { throw $Message }; $script:count++ }
function Reject([scriptblock]$Action) { $failed = $false; try { & $Action | Out-Null } catch { $failed = $true }; Assert $failed 'Expected safe rejection.' }
function New-TestToken {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return 'gr_device_' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
$directory = Join-Path $PSScriptRoot ('..\.test-output\core-' + [Guid]::NewGuid().ToString('N'))
$client = $null
try {
    Assert ((ConvertTo-GuardrailOrigin ' http://localhost:4000/ ') -ceq 'http://localhost:4000') 'Local origin normalization failed.'
    Assert ((ConvertTo-GuardrailOrigin 'https://api.example.org/') -ceq 'https://api.example.org') 'HTTPS origin rejected.'
    foreach ($bad in @('http://remote.example.org', 'https://name:secret@example.org', 'https://example.org/path', 'https://example.org?token=secret', 'https://example.org/#secret', 'file:///C:/test', 'http://127.0.0.1.evil.example')) { Reject { ConvertTo-GuardrailOrigin $bad } }
    $token = New-TestToken
    Assert (Test-GuardrailToken $token Device) 'Canonical device token rejected.'
    Assert (!(Test-GuardrailToken $token Pairing)) 'Device token accepted as a claim.'
    Assert (!(Test-GuardrailToken ('gr_device_' + ('A' * 42) + 'B') Device)) 'Noncanonical token accepted.'
    $credential = [pscustomobject]@{ version = 1; origin = 'http://localhost:4000'; deviceId = [Guid]::NewGuid().ToString(); deviceToken = $token; expiresAt = [DateTime]::UtcNow.AddDays(1).ToString('o') }
    Save-GuardrailCredential $credential $directory
    $path = Join-Path $directory 'credential.bin'
    Assert (![Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($path)).Contains($token)) 'Credential file contained plaintext.'
    $loaded = Read-GuardrailCredential $directory
    Assert ($loaded.deviceToken -ceq $token -and $loaded.origin -ceq $credential.origin) 'DPAPI roundtrip failed.'
    $acl = (Get-Item -LiteralPath $directory).GetAccessControl()
    Assert $acl.AreAccessRulesProtected 'Credential directory inherited permissions.'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Assert (@($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -ne $sid }).Count -eq 0) 'Credential directory grants another account access.'
    $credential.deviceToken = New-TestToken
    Save-GuardrailCredential $credential $directory
    Assert ((Read-GuardrailCredential $directory).deviceToken -ceq $credential.deviceToken) 'Atomic replacement failed.'
    $credential.expiresAt = [DateTime]::UtcNow.AddMinutes(-1).ToString('o')
    Reject { Save-GuardrailCredential $credential $directory }
    [IO.File]::WriteAllBytes($path, [byte[]]@(1, 2, 3))
    Reject { Read-GuardrailCredential $directory }
    Remove-GuardrailCredential $directory
    Assert ($null -eq (Read-GuardrailCredential $directory)) 'Removed credential was still readable.'
    $report = Get-GuardrailCapacityReport
    Assert ($report.volumes.Count -ge 1 -and $report.volumes.Count -le 26) 'No fixed volumes found.'
    Assert (@($report.Keys | Sort-Object) -join ',' -ceq 'collectedAt,reportId,volumes') 'Unexpected report fields.'
    foreach ($volume in $report.volumes) {
        Assert ($volume.id -cmatch '^[A-Z]:\\$' -and $volume.totalBytes -gt 0 -and $volume.freeBytes -ge 0 -and $volume.freeBytes -le $volume.totalBytes) 'Invalid fixed volume.'
        Assert ((@($volume.Keys | Sort-Object) -join ',') -ceq 'freeBytes,id,totalBytes') 'Report included extra disk information.'
    }
    $client = New-GuardrailHttpClient
    Reject { Start-GuardrailRequest $client 'http://localhost:4000' '/api/v1/auth/me' GET $null Device $token }
    Reject { Start-GuardrailRequest $client 'http://localhost:4000' '/api/v1/companion/me?token=secret' GET $null Device $token }
    Reject { Start-GuardrailRequest $client 'http://localhost:4000' '/api/v1/companion/me' GET $null Pairing $token }
    Reject { Start-GuardrailRequest $client 'http://localhost:4000' '/api/v1/pairing/claim' POST @{} Device $token }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..') -Filter '*.ps1') {
        $tokens = $null; $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
        Assert ($errors.Count -eq 0) ('PowerShell parse failed for ' + $file.Name)
    }
    Write-Output ('PASS: ' + $script:count + ' companion checks (origins, token isolation, DPAPI, ACL, atomic replacement, corruption, capacity and request restrictions).')
} finally {
    if ($client) { $client.Dispose() }
    Remove-GuardrailCredential $directory
    # This unique test directory only; no recursive deletion and no user settings.
    if ([IO.Directory]::Exists($directory)) { [IO.Directory]::Delete($directory, $false) }
}
