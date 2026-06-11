$ErrorActionPreference = "Stop"

$repo = "eresearchqut/rdss-folder-mapper"
$base = "https://github.com/$repo/releases/latest/download"
$output = "rdss-folder-mapper.exe"

# Prefer a native arm64 build, fall back to the x64 binary if it is missing.
$arch = $env:PROCESSOR_ARCHITECTURE
$url = "$base/rdss-folder-mapper-win.exe"
if ($arch -eq "ARM64") {
    $armUrl = "$base/rdss-folder-mapper-win-arm64.exe"
    try {
        Invoke-WebRequest -Uri $armUrl -Method Head -UseBasicParsing | Out-Null
        $url = $armUrl
    } catch {
        Write-Host "Native arm64 build not found; using the x64 binary."
    }
}

Write-Host "Downloading latest rdss-folder-mapper for Windows ($arch)..."
Invoke-WebRequest -Uri $url -OutFile $output

Write-Host "Downloaded successfully to .\$output"

if ($PSCommandPath) {
    Remove-Item -Path $PSCommandPath -Force
}
