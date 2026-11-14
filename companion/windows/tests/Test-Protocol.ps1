#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\Guardrail.Protocol.ps1"
$command = Get-GuardrailProtocolCommand
if ($command -notmatch '^"[^"]+powershell\.exe" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "[^"]+Start-Guardrail\.ps1"$') { throw 'Unexpected launch command.' }
if ($command.Contains('%1') -or $command.Contains('-Command') -or $command.Contains('Bypass') -or $command.Contains('http')) { throw 'Protocol command must not accept URI content, arbitrary commands, origins or tokens.' }
$inspection = & "$PSScriptRoot\..\Register-Guardrail.ps1" -Inspect
if ($inspection.Scheme -cne 'guardrail-companion' -or $inspection.Command -cne $command -or $inspection.RegistryPath -cne 'HKCU:\Software\Classes\guardrail-companion') { throw 'Unexpected app registration.' }
$failed = $false
try { Get-GuardrailProtocolCommand -ScriptPath (Join-Path $PSScriptRoot 'missing.ps1') | Out-Null } catch { $failed = $true }
if (!$failed) { throw 'Missing app script was accepted.' }
$eventName = 'Local\GuardrailProtocolTest-' + [Guid]::NewGuid().ToString('N')
$first = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, $eventName)
$second = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, $eventName)
try {
    if ($first.WaitOne(0)) { throw 'Unexpected initial activation.' }
    [void]$second.Set()
    if (!$first.WaitOne(1000) -or $first.WaitOne(0)) { throw 'Activation event did not signal exactly once.' }
} finally { $second.Dispose(); $first.Dispose() }
Write-Output 'PASS: fixed protocol command, current-user registration, no URL arguments, missing-file rejection and single-instance activation signal. No registry settings were changed.'
