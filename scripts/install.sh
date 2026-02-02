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
  ORANGE='\033[38;2;252;143;93m'
  DIM='\033[2m'
  NC='\033[0m'
else
  ORANGE=''
  DIM=''
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

# Download file silently
# Download file silently
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
  # Detect platform
  PLATFORM=$(detect_platform)

  # Get version
  if [ "$VERSION" = "latest" ]; then
    VERSION=$(get_latest_version)
    if [ -z "$VERSION" ]; then
      echo "error: failed to fetch latest version" >&2
      exit 1
    fi
  fi

  # Build download URL
  BINARY_NAME="veryfront-${PLATFORM}"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}"

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  # Download binary
  BINARY_PATH="${INSTALL_DIR}/veryfront"

  printf "Downloading ${ORANGE}veryfront${NC} v%s " "$VERSION"

  # Download with spinner
  download "$DOWNLOAD_URL" "$BINARY_PATH" &
  PID=$!
  SPINNER="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  i=0
  while kill -0 $PID 2>/dev/null; do
    i=$(( (i + 1) % 10 ))
    printf "\rDownloading ${ORANGE}veryfront${NC} v%s ${ORANGE}%s${NC}" "$VERSION" "$(echo "$SPINNER" | cut -c$((i+1)))"
    sleep 0.1
  done

  wait $PID
  if [ $? -ne 0 ]; then
    printf "\rDownload failed                              \n"
    exit 1
  fi

  chmod +x "$BINARY_PATH"
  printf "\rInstalled ${ORANGE}veryfront${NC} v%s                      \n" "$VERSION"

  # Check if install dir is in PATH
  case ":$PATH:" in
    *":$INSTALL_DIR:"*)
      echo ""
      echo "Get started:"
      echo "  ${ORANGE}veryfront${NC}"
      echo ""
      ;;
    *)
      SHELL_NAME=$(basename "$SHELL")
      case "$SHELL_NAME" in
        zsh)
          PROFILE=".zshrc"
          ;;
        bash)
          if [ -f "$HOME/.bash_profile" ]; then
            PROFILE=".bash_profile"
          else
            PROFILE=".bashrc"
          fi
          ;;
        fish)
          echo ""
          echo "Next steps:"
          echo "1. fish_add_path ~/.veryfront/bin"
          echo "2. ${ORANGE}veryfront${NC}"
          echo ""
          return
          ;;
        *)
          PROFILE=".profile"
          ;;
      esac
      echo ""
      echo "Next steps:"
      echo "1. echo 'export PATH=\"\$HOME/.veryfront/bin:\$PATH\"' >> ~/${PROFILE}"
      echo "2. source ~/${PROFILE}"
      echo "3. ${ORANGE}veryfront${NC}"
      echo ""
      ;;
  esac
}

main
