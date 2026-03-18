@echo off
echo Downloading rdss-folder-mapper for Windows...
curl -fsSL https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe -o "%USERPROFILE%\rdss-folder-mapper.exe"
echo Downloaded successfully to %USERPROFILE%\rdss-folder-mapper.exe
