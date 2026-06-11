#!/bin/sh
set -e

REPO="eresearchqut/rdss-folder-mapper"
URL_BASE="https://github.com/$REPO/releases/latest/download"
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
    Linux*)
        BASE="rdss-folder-mapper-linux"
        EXT=""
        ;;
    Darwin*)
        BASE="rdss-folder-mapper-macos"
        EXT=""
        ;;
    CYGWIN*|MINGW*|MSYS*)
        BASE="rdss-folder-mapper-win"
        EXT=".exe"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

# Prefer a native arm64 build, fall back to the x64 binary if it is missing.
case "$ARCH" in
    arm64|aarch64)
        if curl -fsSL -I -o /dev/null "$URL_BASE/${BASE}-arm64${EXT}" 2>/dev/null; then
            FILENAME="${BASE}-arm64${EXT}"
        else
            FILENAME="${BASE}${EXT}"
        fi
        ;;
    *)
        FILENAME="${BASE}${EXT}"
        ;;
esac

echo "Downloading latest rdss-folder-mapper ($FILENAME) for $OS/$ARCH..."
curl -fsSL "$URL_BASE/$FILENAME" -o rdss-folder-mapper
chmod +x rdss-folder-mapper

echo "Downloaded successfully to ./rdss-folder-mapper"
