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
  GREEN='\033[32m'
  DIM='\033[2m'
  NC='\033[0m'
else
  ORANGE=''
  GREEN=''
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

# GNU wget refuses a redirect to http with --https-only; BusyBox wget does not
# know the flag and would abort under `set -e`. Probe once and reuse the answer.
WGET_HTTPS_ONLY=""
if command -v wget >/dev/null 2>&1; then
  if wget --help 2>&1 | grep -q -- "--https-only"; then
    WGET_HTTPS_ONLY="--https-only"
  fi
fi

# Get latest version from GitHub
get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget ${WGET_HTTPS_ONLY} -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/'
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

# Download file silently
# Download file silently
# Hash a file with whichever SHA-256 tool the platform ships.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

# Verify a staged download against the release's published SHA256SUMS.
#
# Fails closed: an unverified binary is not installed. Releases published before
# the manifest existed have no SHA256SUMS asset, so pinning to one of those needs
# the escape hatch, which has to be set deliberately.
verify_checksum() {
  FILE="$1"
  NAME="$2"
  VER="$3"
  WORK="$4"

  if [ "${VERYFRONT_INSTALL_SKIP_CHECKSUM:-}" = "1" ]; then
    printf "\r${ORANGE}Skipping checksum verification (VERYFRONT_INSTALL_SKIP_CHECKSUM=1)${NC}\n"
    return 0
  fi

  SUMS_URL="https://github.com/${REPO}/releases/download/v${VER}/SHA256SUMS"
  SUMS_FILE="${WORK}/SHA256SUMS"

  if ! download "$SUMS_URL" "$SUMS_FILE" 2>/dev/null; then
    printf "\r%s\n" "Install failed: no SHA256SUMS published for v${VER}." >&2
    echo "  The binary was downloaded but not installed, because it could not be verified." >&2
    echo "  Releases published before checksums existed have no manifest." >&2
    echo "  To install anyway, re-run with VERYFRONT_INSTALL_SKIP_CHECKSUM=1." >&2
    exit 1
  fi

  EXPECTED=$(awk -v want="$NAME" '$2 == want || $2 == "*" want { print $1; exit }' "$SUMS_FILE")
  if [ -z "$EXPECTED" ]; then
    printf "\r%s\n" "Install failed: ${NAME} is not listed in SHA256SUMS for v${VER}." >&2
    exit 1
  fi

  ACTUAL=$(sha256_of "$FILE") || {
    printf "\r%s\n" "Install failed: no sha256sum or shasum available to verify the download." >&2
    exit 1
  }

  if [ "$ACTUAL" != "$EXPECTED" ]; then
    printf "\r%s\n" "Install failed: checksum mismatch for ${NAME}." >&2
    echo "  expected ${EXPECTED}" >&2
    echo "  actual   ${ACTUAL}" >&2
    echo "  The download was discarded and nothing was installed." >&2
    exit 1
  fi
}

download() {
  URL="$1"
  DEST="$2"

  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL "$URL" -o "$DEST"
  elif command -v wget >/dev/null 2>&1; then
    wget ${WGET_HTTPS_ONLY} -q "$URL" -O "$DEST"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

main() {
  echo ""
  echo "Setting up Veryfront..."
  echo ""

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

  BINARY_PATH="${INSTALL_DIR}/veryfront"

  # Download to a staging file first: a binary is only moved into place after its
  # checksum matches, so a truncated or tampered download never becomes the
  # installed executable.
  STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/veryfront-install.XXXXXX") || {
    echo "Error: could not create a temporary directory" >&2
    exit 1
  }
  trap 'rm -rf "$STAGING_DIR"' EXIT INT TERM
  STAGED_BINARY="${STAGING_DIR}/${BINARY_NAME}"

  # Download with spinner
  printf "${ORANGE}Installing Veryfront v%s...${NC}" "$VERSION"
  download "$DOWNLOAD_URL" "$STAGED_BINARY" &
  PID=$!
  SPINNER='|/-\'
  i=0
  while kill -0 $PID 2>/dev/null; do
    i=$(( (i + 1) % 4 ))
    printf "\r${ORANGE}Installing Veryfront v%s...${NC} %s" "$VERSION" "$(echo "$SPINNER" | cut -c$((i + 1)))"
    sleep 1
  done

  wait $PID
  if [ $? -ne 0 ]; then
    printf "\r${ORANGE}Install failed${NC}                              \n"
    exit 1
  fi

  verify_checksum "$STAGED_BINARY" "$BINARY_NAME" "$VERSION" "$STAGING_DIR"

  chmod +x "$STAGED_BINARY"
  mv -f "$STAGED_BINARY" "$BINARY_PATH"

  # Add to PATH if not already there
  NEEDS_SOURCE=""
  case ":$PATH:" in
    *":$INSTALL_DIR:"*)
      # Already in PATH
      ;;
    *)
      NEEDS_SOURCE="yes"
      # Add to shell profile
      SHELL_NAME=$(basename "$SHELL")
      case "$SHELL_NAME" in
        zsh)
          PROFILE="$HOME/.zshrc"
          PROFILE_SHORT="~/.zshrc"
          ;;
        bash)
          if [ -f "$HOME/.bash_profile" ]; then
            PROFILE="$HOME/.bash_profile"
            PROFILE_SHORT="~/.bash_profile"
          else
            PROFILE="$HOME/.bashrc"
            PROFILE_SHORT="~/.bashrc"
          fi
          ;;
        fish)
          # Fish uses a different mechanism
          fish -c "fish_add_path ~/.veryfront/bin" 2>/dev/null || true
          NEEDS_SOURCE=""
          ;;
        *)
          PROFILE="$HOME/.profile"
          PROFILE_SHORT="~/.profile"
          ;;
      esac

      # Add PATH export if not already in profile
      if [ -n "$PROFILE" ] && ! grep -q "/.veryfront/bin" "$PROFILE" 2>/dev/null; then
        echo 'export PATH="$HOME/.veryfront/bin:$PATH"' >> "$PROFILE"
      fi
      ;;
  esac

  # Success output
  printf "\rSetting up Veryfront... done!                       \n"
  echo ""
  echo "Version: ${VERSION}"
  echo "Location: ~/.veryfront/bin/veryfront"
  echo ""
  if [ -n "$NEEDS_SOURCE" ]; then
    echo "Next: source ${PROFILE_SHORT} && veryfront"
  else
    echo "Next: Run ${ORANGE}veryfront${NC} to get started"
  fi
  echo ""
}

main
