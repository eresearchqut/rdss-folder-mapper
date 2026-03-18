@echo off
set REPO=eresearchqut/rdss-folder-mapper
set URL=https://github.com/%REPO%/releases/latest/download/rdss-folder-mapper-win.exe
set OUTPUT=rdss-folder-mapper.exe

echo Downloading latest rdss-folder-mapper for Windows...
curl -fsSL "%URL%" -o "%OUTPUT%"

echo Downloaded successfully to .\%OUTPUT%
