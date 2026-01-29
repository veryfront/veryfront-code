#!/bin/bash
# Demo runner script for asciinema recording
# Simulates typing and runs npx veryfront

# Set TERM for headless mode
export TERM=xterm-256color

# Orange prompt
PS1=$'\033[38;2;252;143;93m> \033[0m'
export PS1

# Function to simulate typing
type_slowly() {
    local text="$1"
    local delay="${2:-0.075}"
    for ((i=0; i<${#text}; i++)); do
        printf '%s' "${text:$i:1}"
        sleep "$delay"
    done
}

# Clear screen
clear

# Show prompt and type command
printf '%s' "$PS1"
type_slowly "npx veryfront"
sleep 0.5
echo ""

# Run the command (with auto-yes for npx)
yes | npx veryfront &
PID=$!

# Wait for TUI to fully load and show "running" state
sleep 25

# Show the running state for a moment
sleep 5

# Kill the TUI
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
