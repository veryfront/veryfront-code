#!/bin/bash
# Asciinema recording script for Veryfront TUI demo
# Records using demo-runner.sh, converts to GIF with agg

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAST_FILE="$SCRIPT_DIR/demo.cast"
GIF_FILE="$SCRIPT_DIR/demo-asciinema.gif"

# Check dependencies
command -v asciinema >/dev/null 2>&1 || { echo "asciinema required: brew install asciinema"; exit 1; }
command -v agg >/dev/null 2>&1 || { echo "agg required: brew install agg"; exit 1; }

# Clean up npx cache for fresh install prompt
rm -rf ~/.npm/_npx 2>/dev/null || true

echo "Recording asciinema demo..."

# Record with specific terminal size using runner script
asciinema rec \
  --window-size 80x40 \
  --idle-time-limit 3 \
  --overwrite \
  --command "$SCRIPT_DIR/demo-runner.sh" \
  "$CAST_FILE"

echo ""
echo "Recording complete: $CAST_FILE"
echo ""
echo "Converting to GIF..."

# Convert to GIF with settings similar to VHS output
agg \
  --theme dracula \
  --font-size 24 \
  --speed 1 \
  "$CAST_FILE" \
  "$GIF_FILE"

echo "GIF generated: $GIF_FILE"
ls -lh "$GIF_FILE"
