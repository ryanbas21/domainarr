#!/bin/sh
# Domainarr installer
# Usage: curl -fsSL https://raw.githubusercontent.com/ryanbas21/domainarr/main/install.sh | sh

set -e

REPO="ryanbas21/domainarr"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="domainarr"

# Detect OS and architecture
detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux)  OS="linux" ;;
        Darwin) OS="macos" ;;
        MINGW*|MSYS*|CYGWIN*) OS="win" ;;
        *)
            echo "Error: Unsupported operating system: $OS"
            exit 1
            ;;
    esac

    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            echo "Error: Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    PLATFORM="${OS}-${ARCH}"
}

# Get latest release version
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" |
        grep '"tag_name":' |
        sed -E 's/.*"([^"]+)".*/\1/'
}

# Download and install
install() {
    detect_platform

    echo "Detected platform: $PLATFORM"

    VERSION=$(get_latest_version)
    if [ -z "$VERSION" ]; then
        echo "Error: Could not determine latest version"
        exit 1
    fi

    echo "Installing domainarr $VERSION..."

    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/domainarr-${PLATFORM}"

    if [ "$OS" = "win" ]; then
        DOWNLOAD_URL="${DOWNLOAD_URL}.exe"
        BINARY_NAME="domainarr.exe"
    fi

    TEMP_FILE=$(mktemp)

    echo "Downloading from $DOWNLOAD_URL..."
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"; then
        echo "Error: Failed to download binary"
        rm -f "$TEMP_FILE"
        exit 1
    fi

    chmod +x "$TEMP_FILE"

    # Check if we need sudo
    if [ -w "$INSTALL_DIR" ]; then
        mv "$TEMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        echo "Installing to $INSTALL_DIR (requires sudo)..."
        sudo mv "$TEMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    echo ""
    echo "✓ domainarr $VERSION installed to ${INSTALL_DIR}/${BINARY_NAME}"
    echo ""
    echo "Run 'domainarr --help' to get started"
}

install
