$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\Guardrail.Scan.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ('GuardrailScanTest-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $root 'nested'))
$outside = Join-Path ([IO.Path]::GetTempPath()) ('GuardrailScanOutside-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($outside)
try {
    # Pure path-policy regression: never enumerate actual credential or system folders.
    $protected = [GuardrailScanning.ScanJob].GetMethod('ProtectedPath', [Reflection.BindingFlags]'NonPublic,Static')
    $credentialsPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Guardrail\Companion\credential.bin'
    foreach ($candidate in @($credentialsPath, (Join-Path $env:SystemRoot 'example.txt'))) {
        if (!$protected.Invoke($null, [object[]]@([string]$candidate))) { throw 'Protected traversal path accepted' }
    }
    if ($protected.Invoke($null, [object[]]@([string]$root))) { throw 'Personal test fixture classified as protected' }
    [IO.File]::WriteAllBytes((Join-Path $root 'small.txt'), (New-Object byte[] 10))
    [IO.File]::WriteAllBytes((Join-Path $root 'nested\large.bin'), (New-Object byte[] 100))
    [IO.File]::WriteAllText((Join-Path $root '.env'), 'PRIVATE_SECRET')
    [IO.File]::WriteAllBytes((Join-Path $outside 'outside.txt'), (New-Object byte[] 999))
    [void](New-Item -ItemType Junction -Path (Join-Path $root 'linked') -Target $outside)
    $job = Start-GuardrailFolderScan $root
    try {
        if (!$job.Completion.Wait(15000)) { throw 'Scan timed out' }
        $report = ConvertTo-GuardrailScanReport ($job.Completion.GetAwaiter().GetResult())
        if ($report.fileCount -ne 2 -or $report.totalBytes -ne 110 -or $report.largestFiles[0].relativePath -cne 'nested/large.bin') { throw 'Incorrect scan summary' }
        $json = $report | ConvertTo-Json -Depth 8
        if ($json.Contains('PRIVATE_SECRET') -or $json.Contains($root) -or $json.Contains('.env') -or $json.Contains('outside.txt')) { throw 'Scan included credentials, linked entries or absolute root path' }
        if ([IO.File]::ReadAllText((Join-Path $root '.env')) -cne 'PRIVATE_SECRET') { throw 'Scan modified a file' }
    } finally { $job.Dispose() }
    $cancelled = New-Object Threading.CancellationTokenSource
    $cancelled.Cancel()
    $job = Start-GuardrailFolderScan $root $cancelled
    try { $failed = $false; try { [void]$job.Completion.GetAwaiter().GetResult() } catch { $failed = $true }; if (!$failed) { throw 'Cancelled scan completed' } }
    finally { $job.Dispose(); $cancelled.Dispose() }
    foreach ($bad in @('C:\', '\\server\share', $env:SystemRoot)) {
        $failed = $false; try { Start-GuardrailFolderScan $bad | Out-Null } catch { $failed = $true }; if (!$failed) { throw 'Unsafe root accepted' }
    }
    foreach ($name in @('.env.private', 'credentials.key', '.ssh')) {
        $excludedRoot = Join-Path $root $name
        [void][IO.Directory]::CreateDirectory((Join-Path $excludedRoot 'child'))
        try {
            foreach ($selected in @($excludedRoot, (Join-Path $excludedRoot 'child'))) {
                $failed = $false
                try { [void][GuardrailScanning.ScanJob]::ValidateRoot($selected) } catch { $failed = $true }
                if (!$failed) { throw 'Direct selection bypassed an excluded ancestor' }
            }
        } finally {
            [IO.Directory]::Delete((Join-Path $excludedRoot 'child'), $false)
            [IO.Directory]::Delete($excludedRoot, $false)
        }
    }
    $many = Join-Path $root 'many'
    [void][IO.Directory]::CreateDirectory($many)
    for ($index = 0; $index -lt 25; $index++) { [IO.File]::WriteAllBytes((Join-Path $many ("sample.$index")), (New-Object byte[] ($index + 1))) }
    $job = Start-GuardrailFolderScan $many
    try {
        [void]$job.Completion.Wait(15000); $report = ConvertTo-GuardrailScanReport ($job.Completion.GetAwaiter().GetResult())
        if ($report.fileCount -ne 25 -or $report.totalBytes -ne 325 -or $report.largestFiles.Count -ne 20 -or $report.types.Count -gt 20) { throw 'Scan result caps or summary totals failed' }
    } finally { $job.Dispose() }
    Write-Output 'PASS: nested metadata totals, largest files, excluded secrets/junctions, unchanged files, cancellation, root restrictions and bounded results.'
} finally {
    # Explicit known fixture files and empty directories only; no recursive deletion.
    foreach ($file in @('small.txt','nested\large.bin','.env')) { [IO.File]::Delete((Join-Path $root $file)) }
    if ([IO.Directory]::Exists((Join-Path $root 'linked'))) { [IO.Directory]::Delete((Join-Path $root 'linked'), $false) }
    if ([IO.Directory]::Exists((Join-Path $root 'many'))) {
        for ($index = 0; $index -lt 25; $index++) { [IO.File]::Delete((Join-Path $root ("many\sample.$index"))) }
        [IO.Directory]::Delete((Join-Path $root 'many'), $false)
    }
    [IO.File]::Delete((Join-Path $outside 'outside.txt')); [IO.Directory]::Delete($outside, $false)
    [IO.Directory]::Delete((Join-Path $root 'nested'), $false)
    [IO.Directory]::Delete($root, $false)
}
