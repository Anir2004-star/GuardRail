#requires -Version 5.1
[CmdletBinding()]
param([switch]$Inspect, [switch]$Unregister)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Guardrail.Protocol.ps1"
$registryPath = 'Software\Classes\guardrail-companion'
$ownerMarker = 'GuardrailCompanion/v1'
$command = Get-GuardrailProtocolCommand
if ($Inspect) {
    [pscustomobject]@{ Scheme = 'guardrail-companion'; Command = $command; RegistryPath = 'HKCU:\' + $registryPath }
    return
}
$existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath)
try {
    if ($existing -and $existing.GetValue('GuardrailOwner') -cne $ownerMarker) { throw 'This URL scheme is already owned by another application. Registration was not changed.' }
    if ($Unregister -and $existing) {
        $existingCommand = $existing.OpenSubKey('shell\open\command')
        try { if (!$existingCommand -or $existingCommand.GetValue('') -cne $command) { throw 'This registration belongs to another companion location. It was not removed.' } }
        finally { if ($existingCommand) { $existingCommand.Dispose() } }
    }
} finally { if ($existing) { $existing.Dispose() } }
if ($Unregister) {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registryPath, $false)
    Write-Output 'Guardrail app-link registration removed. Pairing and device files were not changed.'
    return
}
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
try {
    $key.SetValue('', 'URL:Guardrail Companion')
    $key.SetValue('URL Protocol', '')
    $key.SetValue('GuardrailOwner', $ownerMarker)
    $commandKey = $key.CreateSubKey('shell\open\command')
    try { $commandKey.SetValue('', $command) } finally { $commandKey.Dispose() }
} finally { $key.Dispose() }
Write-Output 'Registered Guardrail Companion app links for this Windows account. The browser may ask you to confirm opening the app.'
