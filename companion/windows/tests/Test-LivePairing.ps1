# Isolated database integration harness. Configuration comes through stdin, never CLI secrets.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\Guardrail.Core.ps1"
$directory = Join-Path $PSScriptRoot ('..\.test-output\live-' + [Guid]::NewGuid().ToString('N'))
$client = New-GuardrailHttpClient
function Request([string]$Path, [string]$Method, $Body, [string]$Scheme = '', [string]$Token = '') {
    $pending = Start-GuardrailRequest $client $config.origin $Path $Method $Body $Scheme $Token
    [void]$pending.Task.Wait(20000)
    return Complete-GuardrailRequest $pending
}
try {
    $config = [Console]::ReadLine() | ConvertFrom-Json
    $originUri = New-Object Uri($config.origin)
    if ($originUri.Host -cne '127.0.0.1' -or $originUri.Port -le 0) { throw 'Test requires loopback' }
    $result = Request '/api/v1/pairing/claim' POST @{ code = $config.code; appName = 'Guardrail Windows Companion'; platform = 'Windows'; appVersion = '0.1.0' }
    if ($result.Status -ne 201) { throw 'Claim failed' }
    $claim = $result.Data
    [Console]::WriteLine((@{ stage = 'claimed'; comparisonCode = $claim.comparisonCode } | ConvertTo-Json -Compress))
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Seconds 5
        $result = Request '/api/v1/pairing/status' GET $null Pairing $claim.claimToken
        if ($result.Status -ne 200 -or $result.Data.comparisonCode -cne $claim.comparisonCode) { throw 'Status failed' }
    } while ($result.Data.state -ne 'Approved' -and [DateTime]::UtcNow -lt $deadline)
    if ($result.Data.state -ne 'Approved') { throw 'Approval timed out' }
    $result = Request '/api/v1/pairing/exchange' POST @{} Pairing $claim.claimToken
    if ($result.Status -ne 201) { throw 'Exchange failed' }
    $credential = [pscustomobject]@{ version = 1; origin = $config.origin; deviceId = $result.Data.deviceId; deviceToken = $result.Data.deviceToken; expiresAt = $result.Data.expiresAt }
    Save-GuardrailCredential $credential $directory
    $credential = Read-GuardrailCredential $directory
    $result = Request '/api/v1/companion/me' GET $null Device $credential.deviceToken
    if ($result.Status -ne 200 -or $result.Data.device.id -cne $credential.deviceId) { throw 'Identity failed' }
    $profile = Get-GuardrailDeviceProfile
    $result = Request '/api/v1/companion/device-details' POST $profile Device $credential.deviceToken
    if ($result.Status -ne 200 -or $result.Data.deviceId -cne $credential.deviceId -or $result.Data.synced -ne $true) { throw 'Device details sync failed' }
    [Console]::WriteLine('{"stage":"profile-synced"}')
    $report = Get-GuardrailCapacityReport
    $result = Request '/api/v1/companion/storage-reports' POST $report Device $credential.deviceToken
    if ($result.Status -ne 200 -or $result.Data.reportId -cne $report.reportId) { throw 'Report failed' }
    [Console]::WriteLine((@{ stage = 'reported'; reportId = $report.reportId } | ConvertTo-Json -Compress))
    if ([Console]::ReadLine() -cne 'revoked') { throw 'Expected revocation signal' }
    $result = Request '/api/v1/companion/me' GET $null Device $credential.deviceToken
    if ($result.Status -ne 401) { throw 'Revoked identity accepted' }
    $result = Request '/api/v1/companion/device-details' POST $profile Device $credential.deviceToken
    if ($result.Status -ne 401) { throw 'Revoked device details accepted' }
    $result = Request '/api/v1/companion/storage-reports' POST (Get-GuardrailCapacityReport) Device $credential.deviceToken
    if ($result.Status -ne 401) { throw 'Revoked report accepted' }
    [Console]::WriteLine('{"stage":"complete"}')
} catch {
    [Console]::Error.WriteLine('Companion integration failed; credentials were not logged.')
    exit 1
} finally {
    $client.Dispose()
    Remove-GuardrailCredential $directory
    if ([IO.Directory]::Exists($directory)) { [IO.Directory]::Delete($directory, $false) }
}
