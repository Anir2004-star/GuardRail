Set-StrictMode -Version Latest

function Get-GuardrailProtocolCommand([string]$ScriptPath = (Join-Path $PSScriptRoot 'Start-Guardrail.ps1')) {
    $scriptFile = Get-Item -LiteralPath $ScriptPath -ErrorAction Stop
    if ($scriptFile.PSIsContainer -or $scriptFile.Extension -ine '.ps1' -or $scriptFile.FullName.Contains('"')) { throw 'Use the installed companion script.' }
    $executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    # Deliberately ignore the incoming URI. It is never passed to a shell/script.
    # The protocol can only open the app, not supply credentials or execute commands.
    return '"' + $executable + '" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $scriptFile.FullName + '"'
}
