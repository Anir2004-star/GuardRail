Set-StrictMode -Version Latest
if (!('GuardrailScanning.ScanJob' -as [type])) { Add-Type -Path "$PSScriptRoot\FolderScanner.cs" }
function Start-GuardrailFolderScan([string]$Path, [Threading.CancellationTokenSource]$Cancellation = $null) {
    return New-Object GuardrailScanning.ScanJob($Path, $Cancellation)
}
function ConvertTo-GuardrailScanReport($Result) {
    return [ordered]@{
        scanId = $Result.ScanId; folderName = $Result.FolderName
        startedAt = $Result.StartedAt; finishedAt = $Result.FinishedAt
        fileCount = $Result.FileCount; totalBytes = $Result.TotalBytes; skippedCount = $Result.SkippedCount; limitReached = $Result.LimitReached
        types = @($Result.Types | ForEach-Object { [ordered]@{ type = $_.Type; count = $_.Count; bytes = $_.Bytes } })
        largestFiles = @($Result.LargestFiles | ForEach-Object { [ordered]@{ relativePath = $_.RelativePath; type = $_.Type; bytes = $_.Bytes; modifiedAt = $_.ModifiedAt } })
    }
}
