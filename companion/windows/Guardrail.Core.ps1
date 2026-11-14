# Windows PowerShell 5.1 / .NET Framework. No third-party modules or administrator rights.
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Security

function ConvertTo-GuardrailOrigin([string]$Value) {
    $uri = $null
    if (![Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$uri) -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or
        ($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.Host -in @('localhost', '127.0.0.1', '[::1]')))) {
        throw 'Use an HTTPS backend origin, or http://localhost:4000 for local testing. Do not include a path, credentials or query.'
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Test-GuardrailToken([string]$Token, [ValidateSet('Pairing', 'Device')][string]$Scheme) {
    $prefix = if ($Scheme -eq 'Device') { 'gr_device_' } else { 'gr_pair_' }
    if ($Token -cnotmatch ('^' + $prefix + '[A-Za-z0-9_-]{43}$')) { return $false }
    $suffix = $Token.Substring($prefix.Length)
    try {
        $bytes = [Convert]::FromBase64String($suffix.Replace('-', '+').Replace('_', '/') + '=')
        return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') -ceq $suffix
    } catch { return $false }
}

function Get-GuardrailStoreDirectory {
    return [IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Guardrail', 'Companion')
}

function Test-GuardrailCredential($Value) {
    try {
        $id = [Guid]::Empty
        return $null -ne $Value -and $Value.version -eq 1 -and
            (ConvertTo-GuardrailOrigin $Value.origin) -ceq $Value.origin -and
            [Guid]::TryParse($Value.deviceId, [ref]$id) -and $id -ne [Guid]::Empty -and
            (Test-GuardrailToken $Value.deviceToken Device) -and
            [DateTimeOffset]::Parse($Value.expiresAt).UtcDateTime -gt [DateTime]::UtcNow
    } catch { return $false }
}

function Save-GuardrailCredential($Value, [string]$Directory = (Get-GuardrailStoreDirectory)) {
    if (!(Test-GuardrailCredential $Value)) { throw 'The pairing response was invalid or expired. Pair again.' }
    $temporary = $null
    $plain = $null
    $stage = 'private directory'
    try {
        $directoryInfo = [IO.Directory]::CreateDirectory($Directory)
        if ($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe store' }
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $security = New-Object Security.AccessControl.DirectorySecurity
        $security.SetOwner($sid)
        $security.SetAccessRuleProtection($true, $false)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $security.AddAccessRule($rule)
        $directoryInfo.SetAccessControl($security)
        $path = [IO.Path]::Combine($directoryInfo.FullName, 'credential.bin')
        if ([IO.File]::Exists($path) -and ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe store' }
        $stage = 'encryption'
        $plain = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 4 -Compress))
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $stage = 'atomic write'
        $temporary = [IO.Path]::Combine($directoryInfo.FullName, ([Guid]::NewGuid().ToString('N') + '.tmp'))
        $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($encrypted, 0, $encrypted.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, [NullString]::Value) } else { [IO.File]::Move($temporary, $path) }
    } catch {
        Write-Verbose ('Secure storage failed during ' + $stage + ' (' + $_.Exception.GetBaseException().GetType().Name + ').')
        throw 'Could not securely save pairing. Disconnect this device on the website, then pair again.'
    }
    finally {
        if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
        if ($temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Read-GuardrailCredential([string]$Directory = (Get-GuardrailStoreDirectory)) {
    $path = [IO.Path]::Combine($Directory, 'credential.bin')
    if (![IO.File]::Exists($path)) { return $null }
    $plain = $null
    try {
        if (([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) -or (Get-Item -LiteralPath $path).Length -gt 16384) { throw 'Unsafe store' }
        $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $value = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
        if (!(Test-GuardrailCredential $value)) { throw 'Invalid saved credential' }
        return $value
    } catch { throw 'Saved pairing could not be opened or has expired. Forget it here and pair again; revoke the old pairing on the website.' }
    finally { if ($plain) { [Array]::Clear($plain, 0, $plain.Length) } }
}

function Remove-GuardrailCredential([string]$Directory = (Get-GuardrailStoreDirectory)) {
    try { [IO.File]::Delete([IO.Path]::Combine($Directory, 'credential.bin')) }
    catch { throw 'Could not remove saved pairing. Close the app and remove credential.bin from the companion settings folder.' }
}

function Get-GuardrailDeviceProfile {
    $profile = @{}
    # Explicit property selection excludes computer/user names, serials and product IDs.
    try {
        $system = Get-CimInstance -ClassName Win32_ComputerSystem -Property Manufacturer,Model -OperationTimeoutSec 5 -ErrorAction Stop
        foreach ($field in @(@('brand', $system.Manufacturer), @('model', $system.Model))) {
            $value = ([string]$field[1] -replace '[\x00-\x1f\x7f]', '').Trim()
            if ($value -and $value -notmatch '^(Unknown|Default string|System manufacturer|System product name|To be filled by O\.?E\.?M\.?)$') {
                $profile[$field[0]] = $value.Substring(0, [Math]::Min(80, $value.Length))
            }
        }
    } catch { }
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption,Version -OperationTimeoutSec 5 -ErrorAction Stop
        $value = (([string]$os.Caption + ' ' + [string]$os.Version) -replace '[\x00-\x1f\x7f]', '').Trim()
        if ($value) { $profile.os = $value.Substring(0, [Math]::Min(80, $value.Length)) }
    } catch { }
    if (!$profile.Count) { throw 'Windows device details are unavailable. Pairing remains valid; detection can retry later.' }
    return $profile
}

function Start-GuardrailProfileDetection {
    # Run CIM queries off the WinForms thread so a slow provider cannot freeze the window.
    $worker = [PowerShell]::Create()
    [void]$worker.AddScript("function Get-GuardrailDeviceProfile { ${function:Get-GuardrailDeviceProfile} }; Get-GuardrailDeviceProfile")
    try { return @{ Worker = $worker; Task = $worker.BeginInvoke() } }
    catch { $worker.Dispose(); throw 'Could not start device detection.' }
}

function Get-GuardrailCapacityReport {
    $volumes = @()
    foreach ($drive in [IO.DriveInfo]::GetDrives()) {
        if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.Name -cnotmatch '^[A-Z]:\\$') { continue }
        try {
            if (!$drive.IsReady) { continue }
            $total = $drive.TotalSize
            $free = $drive.TotalFreeSpace
            if ($total -le 0 -or $free -lt 0 -or $free -gt $total) { continue }
            $volumes += [ordered]@{ id = $drive.Name; totalBytes = $total; freeBytes = $free }
        } catch { continue }
    }
    if (!$volumes.Count) { throw 'No ready fixed-drive capacity could be read. Unlock or reconnect your drive and try again.' }
    return [ordered]@{ reportId = [Guid]::NewGuid().ToString(); collectedAt = [DateTime]::UtcNow.ToString('o'); volumes = $volumes }
}

function New-GuardrailHttpClient {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    $handler.UseDefaultCredentials = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $client.MaxResponseContentBufferSize = 65536
    return $client
}

function Start-GuardrailRequest($Client, [string]$Origin, [string]$Path, [ValidateSet('GET', 'POST')][string]$Method, $Body = $null, [string]$Scheme = '', [string]$Token = '') {
    $originValue = ConvertTo-GuardrailOrigin $Origin
    $allowed = @{ '/api/v1/pairing/claim' = 'POST'; '/api/v1/pairing/status' = 'GET'; '/api/v1/pairing/exchange' = 'POST'; '/api/v1/companion/me' = 'GET'; '/api/v1/companion/device-details' = 'POST'; '/api/v1/companion/storage-reports' = 'POST'; '/api/v1/companion/folder-scans' = 'POST'; '/api/v1/companion/disconnect' = 'POST' }
    if (!$allowed.ContainsKey($Path) -or $allowed[$Path] -cne $Method) { throw 'Unsupported companion request.' }
    $expected = if ($Path -like '/api/v1/companion/*') { 'Device' } elseif ($Path -ne '/api/v1/pairing/claim') { 'Pairing' } else { '' }
    if ($expected -and ($Scheme -cne $expected -or !(Test-GuardrailToken $Token $expected))) { throw 'Invalid companion credential. Pair again.' }
    if (!$expected -and ($Token -or $Scheme)) { throw 'Claims must not send an existing credential.' }
    $request = New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod($Method)), ($originValue + $Path))
    if ($expected) { $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue($Scheme, $Token) }
    if ($null -ne $Body) { $request.Content = New-Object Net.Http.StringContent(($Body | ConvertTo-Json -Depth 8 -Compress), [Text.Encoding]::UTF8, 'application/json') }
    try { return @{ Task = $Client.SendAsync($request); Request = $request } }
    catch { $request.Dispose(); throw 'Could not reach the backend. Check the address and connection.' }
}

function Complete-GuardrailRequest($Pending) {
    $response = $null
    try {
        $response = $Pending.Task.GetAwaiter().GetResult()
        $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $data = $null
        if ($json) { try { $data = $json | ConvertFrom-Json } catch { } }
        return @{ Status = [int]$response.StatusCode; Data = $data }
    } catch { return @{ Status = 0; Data = $null } }
    finally { if ($response) { $response.Dispose() }; $Pending.Request.Dispose() }
}
