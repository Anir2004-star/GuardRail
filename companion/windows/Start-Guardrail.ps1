#requires -Version 5.1
[CmdletBinding()]
param([switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Guardrail.Core.ps1"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# A per-user mutex prevents two instances racing a one-time credential exchange.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = New-Object Threading.Mutex($false, ('Local\GuardrailCompanion-' + $sid))
$ownsMutex = $false
try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
if (!$ownsMutex) {
    [void][Windows.Forms.MessageBox]::Show('Guardrail Companion is already running.', 'Guardrail')
    $mutex.Dispose(); exit
}

$script:session = $null
$script:claim = $null
$script:pending = $null
$script:origin = 'http://localhost:4000'
$script:nextPoll = [DateTime]::MaxValue
$script:nextReport = [DateTime]::MaxValue
$script:nextCheck = [DateTime]::MaxValue
$script:exchangeAttempted = $false
$script:closing = $false
$client = New-GuardrailHttpClient

$form = New-Object Windows.Forms.Form
$form.Text = 'Guardrail Companion'
$form.ClientSize = New-Object Drawing.Size(620, 680)
$form.MinimumSize = New-Object Drawing.Size(640, 720)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::FromArgb(250, 248, 252)
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$layout = New-Object Windows.Forms.FlowLayoutPanel
$layout.Dock = 'Fill'; $layout.FlowDirection = 'TopDown'; $layout.WrapContents = $false; $layout.AutoScroll = $true
$layout.Padding = New-Object Windows.Forms.Padding(24)
$form.Controls.Add($layout)
function Add-Text([string]$Text, [int]$Height = 40, [int]$Size = 10) {
    $control = New-Object Windows.Forms.Label
    $control.Text = $Text; $control.Size = New-Object Drawing.Size(550, $Height)
    $control.Font = New-Object Drawing.Font('Segoe UI', $Size)
    $control.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
    $layout.Controls.Add($control); return $control
}
function Add-Button([string]$Text) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $Text; $button.Size = New-Object Drawing.Size(550, 40)
    $button.Margin = New-Object Windows.Forms.Padding(0, 2, 0, 10)
    $button.BackColor = [Drawing.Color]::FromArgb(86, 43, 103); $button.ForeColor = [Drawing.Color]::White
    $button.FlatStyle = 'Flat'; $layout.Controls.Add($button); return $button
}
[void](Add-Text 'GUARDRAIL' 35 17)
[void](Add-Text 'Connect this Windows device' 36 19)
[void](Add-Text 'Generate a code in My devices > View details on the website, then enter it below. Compare the numbers before approving.' 50)
[void](Add-Text 'Backend address' 22)
$address = New-Object Windows.Forms.TextBox
$address.Text = $script:origin; $address.Width = 550; $layout.Controls.Add($address)
[void](Add-Text 'Pairing code' 22)
$codeInput = New-Object Windows.Forms.TextBox
$codeInput.Width = 550; $codeInput.MaxLength = 14; $codeInput.CharacterCasing = 'Upper'; $layout.Controls.Add($codeInput)
$pairButton = Add-Button 'Connect using code'
$form.AcceptButton = $pairButton
$comparison = Add-Text '' 46 23
$status = Add-Text 'Not paired.' 65
$share = New-Object Windows.Forms.CheckBox
$share.Text = 'Share fixed-drive capacity every minute while this window is open'
$share.Size = New-Object Drawing.Size(550, 44); $share.Enabled = $false; $layout.Controls.Add($share)
$sendButton = Add-Button 'Send capacity now'; $sendButton.Enabled = $false
$disconnectButton = Add-Button 'Disconnect this app'; $disconnectButton.Enabled = $false
$forgetButton = Add-Button 'Forget saved pairing'; $forgetButton.Visible = $false
$preview = Add-Text 'Reports contain drive letters and total/free byte counts only. No filenames or file contents are read. Closing this window stops reporting.' 80

function Show-Status([string]$Text) { $status.Text = $Text }
function Update-Controls {
    $hasSession = $null -ne $script:session
    $busy = $null -ne $script:pending
    $address.Enabled = !$hasSession -and !$script:claim -and !$busy
    $codeInput.Enabled = !$hasSession -and !$script:claim -and !$busy
    $pairButton.Enabled = !$hasSession -and !$script:claim -and !$busy -and !$forgetButton.Visible
    $share.Enabled = $hasSession -and !$busy
    $sendButton.Enabled = $hasSession -and $share.Checked -and !$busy
    $disconnectButton.Enabled = $hasSession -and !$busy
}
function Forget-Session {
    Remove-GuardrailCredential
    $script:session = $null; $script:claim = $null; $share.Checked = $false
    $script:nextReport = [DateTime]::MaxValue; $script:nextCheck = [DateTime]::MaxValue
    $comparison.Text = ''; $forgetButton.Visible = $false
}
function Reset-Claim([string]$Message) {
    $script:claim = $null; $script:nextPoll = [DateTime]::MaxValue
    $comparison.Text = ''; $codeInput.Text = ''; Show-Status $Message
}
function Begin-Request([string]$Kind, [string]$Path, [string]$Method, $Body = $null, [string]$Scheme = '', [string]$Token = '') {
    if ($script:pending) { return }
    try {
        $script:pending = Start-GuardrailRequest $client $script:origin $Path $Method $Body $Scheme $Token
        $script:pending.Kind = $Kind
    } catch { Show-Status 'Could not start the request. Check the backend address and connection.' }
    Update-Controls
}
function Send-Capacity {
    if (!$script:session -or !$share.Checked -or $script:pending) { return }
    $script:nextReport = [DateTime]::UtcNow.AddSeconds(60)
    try {
        $report = Get-GuardrailCapacityReport
        $preview.Text = 'Reporting ready fixed volumes: ' + (($report.volumes | ForEach-Object { $_.id + '  ' + [Math]::Round($_.freeBytes / 1GB, 1) + ' GiB free / ' + [Math]::Round($_.totalBytes / 1GB, 1) + ' GiB' }) -join '; ')
        Begin-Request 'report' '/api/v1/companion/storage-reports' 'POST' $report 'Device' $script:session.deviceToken
        if ($script:pending) { $script:pending.ReportId = $report.reportId }
    } catch { Show-Status 'Capacity could not be read. Check that a fixed drive is ready, then try again.' }
}
function Handle-Result($Operation, $Result) {
    $kind = $Operation.Kind; $http = $Result.Status; $data = $Result.Data
    if ($http -eq 401 -and $kind -in @('check', 'report', 'disconnect')) {
        Forget-Session; Show-Status 'Pairing expired or was revoked. Generate a new code on the website to reconnect.'; return
    }
    if ($http -lt 200 -or $http -ge 300) {
        if ($kind -eq 'exchange') {
            Reset-Claim 'Credential collection could not be confirmed. Do not retry it. Generate a new code and approve again; revoke the old app from the website if needed.'
        } elseif ($kind -eq 'claim') {
            Reset-Claim 'Could not claim that code. Check the backend and code, or generate a new code. Too many attempts may require waiting 15 minutes.'
        } elseif ($kind -eq 'poll') {
            if ($http -eq 401) { Reset-Claim 'This pairing request is no longer valid. Generate a new code.' }
            else { $script:nextPoll = [DateTime]::UtcNow.AddSeconds($(if ($http -eq 429) { 60 } else { 10 })); Show-Status 'Pairing status is temporarily unavailable. Waiting to check again.' }
        } elseif ($kind -eq 'disconnect') {
            Show-Status 'Could not confirm disconnection. Retry, or disconnect this device from the website. Saved pairing has been kept.'
        } else {
            Show-Status $(if ($http -eq 400) { 'Report rejected. Check Windows date/time, then try again.' } elseif ($http -eq 429) { 'Request limit reached. Pause sharing and try again later.' } elseif ($http -eq 403) { 'Account access is unavailable. Check the account on the website.' } else { 'Backend unavailable. Pairing is kept; the next scheduled check will retry.' })
            if ($http -in @(403, 429)) { $share.Checked = $false; $script:nextCheck = [DateTime]::UtcNow.AddMinutes(1) }
        }
        return
    }
    switch ($kind) {
        'claim' {
            $id = [Guid]::Empty
            if ($http -ne 201 -or !$data -or !(Test-GuardrailToken $data.claimToken Pairing) -or $data.comparisonCode -cnotmatch '^\d{6}$' -or ![Guid]::TryParse($data.pairingId, [ref]$id) -or [DateTimeOffset]::Parse($data.expiresAt).UtcDateTime -le [DateTime]::UtcNow -or $data.pollIntervalSeconds -ne 5) { Reset-Claim 'Unexpected pairing response. Generate a new code.'; return }
            $script:claim = $data; $script:exchangeAttempted = $false; $codeInput.Text = ''
            $comparison.Text = 'Compare: ' + $data.comparisonCode
            $script:nextPoll = [DateTime]::UtcNow.AddSeconds(5)
            Show-Status 'Check this same number on the website. Approve there only when the numbers match.'
        }
        'poll' {
            if (!$data -or $data.state -notin @('Claimed', 'Approved', 'Cancelled', 'Rejected', 'Expired', 'Completed') -or $data.comparisonCode -cne $script:claim.comparisonCode) { Reset-Claim 'Unexpected pairing status. Generate a new code.'; return }
            if ($data.state -eq 'Approved' -and !$script:exchangeAttempted) {
                $script:exchangeAttempted = $true; $script:nextPoll = [DateTime]::MaxValue
                Show-Status 'Approved. Collecting the device credential once...'
                Begin-Request 'exchange' '/api/v1/pairing/exchange' 'POST' @{} 'Pairing' $script:claim.claimToken
            } elseif ($data.state -ne 'Claimed') { Reset-Claim ('Pairing ' + $data.state.ToLowerInvariant() + '. Generate a new code to reconnect.') }
        }
        'exchange' {
            $credential = [pscustomobject]@{ version = 1; origin = $script:origin; deviceId = $data.deviceId; deviceToken = $data.deviceToken; expiresAt = $data.expiresAt }
            if ($http -ne 201 -or !(Test-GuardrailCredential $credential)) { Reset-Claim 'Unexpected credential response. Generate a new pairing code.'; return }
            try { Save-GuardrailCredential $credential }
            catch { Reset-Claim 'Windows could not save encrypted pairing. Disconnect this app on the website, then generate a new code and pair again.'; return }
            $script:session = $credential; $script:claim = $null; $comparison.Text = ''
            $script:nextCheck = [DateTime]::UtcNow
            Show-Status 'Paired securely. Enable capacity sharing below when you are ready.'
        }
        'check' {
            if (!$data -or $data.device.id -cne $script:session.deviceId -or $data.device.name.Length -gt 60) { Show-Status 'Unexpected device response. Reporting is paused.'; $share.Checked = $false; return }
            Show-Status ('Paired to ' + $data.device.name + '. Backend reached at ' + [DateTime]::Now.ToString('HH:mm:ss') + '. Credential expires ' + [DateTimeOffset]::Parse($script:session.expiresAt).ToLocalTime().ToString('g') + '.')
        }
        'report' {
            if (!$data -or $data.reportId -cne $Operation.ReportId -or [DateTimeOffset]::Parse($data.receivedAt).UtcDateTime -gt [DateTime]::UtcNow.AddMinutes(5)) { Show-Status 'Capacity report response could not be confirmed. Check the website before trying again.'; return }
            Show-Status ('Capacity report accepted at ' + [DateTimeOffset]::Parse($data.receivedAt).ToLocalTime().ToString('T') + '. The website updates within 30 seconds.')
        }
        'disconnect' { Forget-Session; Show-Status 'Disconnected. The backend credential was revoked and saved pairing removed.' }
    }
}

$pairButton.Add_Click({
    try {
        $script:origin = ConvertTo-GuardrailOrigin $address.Text
        $code = $codeInput.Text.Trim().Replace('-', '')
        if ($code -cnotmatch '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$') { Show-Status 'Enter the 12-character pairing code from the website.'; return }
        Show-Status 'Requesting pairing...'
        Begin-Request 'claim' '/api/v1/pairing/claim' 'POST' @{ code = $code; appName = 'Guardrail Windows Companion'; platform = 'Windows'; appVersion = '0.1.0' }
    } catch { Show-Status 'Use an HTTPS backend address or http://localhost:4000. Do not include a path, query or credentials.' }
})
$share.Add_CheckedChanged({ if ($share.Checked) { $script:nextReport = [DateTime]::UtcNow } else { $script:nextReport = [DateTime]::MaxValue } })
$sendButton.Add_Click({ Send-Capacity })
$disconnectButton.Add_Click({
    if ([Windows.Forms.MessageBox]::Show('Revoke this companion app credential and remove saved pairing?', 'Disconnect Guardrail', 'YesNo', 'Question') -eq 'Yes') {
        $share.Checked = $false
        Begin-Request 'disconnect' '/api/v1/companion/disconnect' 'POST' @{} 'Device' $script:session.deviceToken
    }
})
$forgetButton.Add_Click({
    try { Forget-Session; Show-Status 'Saved pairing removed. Revoke the old app on the website, then generate a new code.'; Update-Controls }
    catch { Show-Status 'Could not remove saved pairing. Close the app and check the companion settings folder.' }
})
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
    try {
        if ($script:pending -and $script:pending.Task.IsCompleted) {
            $operation = $script:pending; $script:pending = $null
            $result = Complete-GuardrailRequest $operation
            Handle-Result $operation $result
            Update-Controls
        }
        if ($script:pending -or $script:closing) { return }
        $now = [DateTime]::UtcNow
        if ($script:claim) {
            if ($now -ge [DateTimeOffset]::Parse($script:claim.expiresAt).UtcDateTime) { Reset-Claim 'Pairing expired. Generate a new code on the website.'; Update-Controls }
            elseif ($now -ge $script:nextPoll) { $script:nextPoll = $now.AddSeconds(5); Begin-Request 'poll' '/api/v1/pairing/status' 'GET' $null 'Pairing' $script:claim.claimToken }
        } elseif ($script:session) {
            if ($now -ge [DateTimeOffset]::Parse($script:session.expiresAt).UtcDateTime) { Forget-Session; Show-Status 'Pairing expired. Generate a new code to reconnect.'; Update-Controls }
            elseif ($share.Checked -and $now -ge $script:nextReport) { Send-Capacity }
            elseif ($now -ge $script:nextCheck) { $script:nextCheck = $now.AddSeconds(60); Begin-Request 'check' '/api/v1/companion/me' 'GET' $null 'Device' $script:session.deviceToken }
        }
    } catch {
        $share.Checked = $false
        if ($script:claim) { Reset-Claim 'Pairing could not be completed safely. Generate a new code and approve again.' }
        Show-Status 'The operation could not be completed safely. Sharing is paused. Check pairing on the website before retrying.'
        Update-Controls
    }
})
$form.Add_FormClosing({ $script:closing = $true; $timer.Stop(); $client.CancelPendingRequests() })
try {
    if (!$SmokeTest) {
        try {
            $script:session = Read-GuardrailCredential
            if ($script:session) { $script:origin = $script:session.origin; $address.Text = $script:origin; $script:nextCheck = [DateTime]::UtcNow; Show-Status 'Saved pairing loaded. Checking with the backend...' }
        } catch { $forgetButton.Visible = $true; Show-Status 'Saved pairing cannot be opened or has expired. Forget it here, revoke the old app on the website, then pair again.' }
    }
    Update-Controls
    if ($SmokeTest) { Write-Output 'PASS: native window and controls constructed without loading credentials or sending requests.' }
    else { $timer.Start(); [void]$form.ShowDialog() }
} finally {
    $timer.Stop(); $timer.Dispose(); $client.Dispose(); $form.Dispose()
    $script:session = $null; $script:claim = $null
    if ($ownsMutex) { $mutex.ReleaseMutex() }; $mutex.Dispose()
}
