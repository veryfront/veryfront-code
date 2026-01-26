#!/bin/sh
# Veryfront CLI Installer
#
# Usage:
#   curl -fsSL https://veryfront.com/install.sh | sh
#   curl -fsSL https://veryfront.com/install.sh | sh -s -- --version 0.0.75
#
# Options:
#   --version VERSION   Install a specific version (default: latest)
#   --dir DIR          Install to a custom directory (default: ~/.veryfront/bin)
#   --help             Show this help message

set -e

# Colors (if terminal supports it)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# Defaults
INSTALL_DIR="${HOME}/.veryfront/bin"
VERSION="latest"
REPO="veryfront/veryfront"

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --help)
      echo "Veryfront CLI Installer"
      echo ""
      echo "Usage:"
      echo "  curl -fsSL https://veryfront.com/install.sh | sh"
      echo "  curl -fsSL https://veryfront.com/install.sh | sh -s -- --version 0.0.75"
      echo ""
      echo "Options:"
      echo "  --version VERSION   Install a specific version (default: latest)"
      echo "  --dir DIR          Install to a custom directory (default: ~/.veryfront/bin)"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      # Handle positional argument as version for backwards compat
      if [ "$VERSION" = "latest" ] && [ -n "$1" ]; then
        VERSION="$1"
      fi
      shift
      ;;
  esac
done

# Detect platform
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)
      case "$ARCH" in
        x86_64)
          echo "linux-x64"
          ;;
        aarch64|arm64)
          echo "linux-arm64"
          ;;
        *)
          echo "Unsupported architecture: $ARCH" >&2
          exit 1
          ;;
      esac
      ;;
    Darwin)
      case "$ARCH" in
        x86_64)
          echo "macos-x64"
          ;;
        arm64)
          echo "macos-arm64"
          ;;
        *)
          echo "Unsupported architecture: $ARCH" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "Unsupported OS: $OS" >&2
      echo "For Windows, use: irm https://veryfront.com/install.ps1 | iex" >&2
      exit 1
      ;;
  esac
}

# Get latest version from GitHub
get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

# Download file
download() {
  URL="$1"
  DEST="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$DEST"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$DEST"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

main() {
  echo "${BLUE}Veryfront CLI Installer${NC}"
  echo ""

  # Detect platform
  PLATFORM=$(detect_platform)
  echo "  Platform: ${PLATFORM}"

  # Get version
  if [ "$VERSION" = "latest" ]; then
    echo "  Fetching latest version..."
    VERSION=$(get_latest_version)
    if [ -z "$VERSION" ]; then
      echo "${RED}Error: Failed to fetch latest version${NC}" >&2
      exit 1
    fi
  fi
  echo "  Version: ${VERSION}"

  # Build download URL
  BINARY_NAME="veryfront-${PLATFORM}"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}"

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  # Download binary
  BINARY_PATH="${INSTALL_DIR}/veryfront"
  echo ""
  echo "  Downloading ${DOWNLOAD_URL}..."
  download "$DOWNLOAD_URL" "$BINARY_PATH"

  # Make executable
  chmod +x "$BINARY_PATH"

  echo ""
  echo "${GREEN}Veryfront CLI installed successfully!${NC}"
  echo ""
  echo "  Binary: ${BINARY_PATH}"
  echo ""

  # Check if install dir is in PATH
  case ":$PATH:" in
    *":$INSTALL_DIR:"*)
      echo "Run ${BLUE}veryfront --help${NC} to get started."
      ;;
    *)
      echo "${YELLOW}Add Veryfront to your PATH:${NC}"
      echo ""
      # Detect shell
      SHELL_NAME=$(basename "$SHELL")
      case "$SHELL_NAME" in
        zsh)
          echo "  echo 'export PATH=\"\$HOME/.veryfront/bin:\$PATH\"' >> ~/.zshrc"
          echo "  source ~/.zshrc"
          ;;
        bash)
          if [ -f "$HOME/.bash_profile" ]; then
            echo "  echo 'export PATH=\"\$HOME/.veryfront/bin:\$PATH\"' >> ~/.bash_profile"
            echo "  source ~/.bash_profile"
          else
            echo "  echo 'export PATH=\"\$HOME/.veryfront/bin:\$PATH\"' >> ~/.bashrc"
            echo "  source ~/.bashrc"
          fi
          ;;
        fish)
          echo "  fish_add_path ~/.veryfront/bin"
          ;;
        *)
          echo "  export PATH=\"\$HOME/.veryfront/bin:\$PATH\""
          ;;
      esac
      echo ""
      echo "Or run directly: ${BLUE}${BINARY_PATH} --help${NC}"
      ;;
  esac
}

main
