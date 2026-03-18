@echo off
echo Downloading latest rdss-folder-mapper for Windows...
certutil -urlcache -split -f "https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe" rdss-folder-mapper.exe
echo Downloaded successfully to rdss-folder-mapper.exe
