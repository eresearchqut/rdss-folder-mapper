#!/bin/sh
set -e

REPO="eresearchqut/rdss-folder-mapper"
URL_BASE="https://github.com/$REPO/releases/latest/download"
OS=$(uname -s)

case "$OS" in
    Linux*)
        FILENAME="rdss-folder-mapper-linux"
        ;;
    Darwin*)
        FILENAME="rdss-folder-mapper-macos"
        ;;
    CYGWIN*|MINGW*|MSYS*)
        FILENAME="rdss-folder-mapper-win.exe"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

echo "Downloading latest rdss-folder-mapper for $OS..."
curl -fsSL "$URL_BASE/$FILENAME" -o rdss-folder-mapper
chmod +x rdss-folder-mapper

echo "Downloaded successfully to ./rdss-folder-mapper"