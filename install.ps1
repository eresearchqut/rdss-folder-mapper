$ErrorActionPreference = "Stop"

$repo = "eresearchqut/rdss-folder-mapper"
$url = "https://github.com/$repo/releases/latest/download/rdss-folder-mapper-win.exe"
$output = "rdss-folder-mapper.exe"

Write-Host "Downloading latest rdss-folder-mapper for Windows..."
Invoke-WebRequest -Uri $url -OutFile $output

Write-Host "Downloaded successfully to .\$output"
