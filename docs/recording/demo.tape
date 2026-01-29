# Veryfront Code TUI Demo
# Run with: vhs demo.tape

Output docs/recording/demo.gif

Set FontSize 28
Set Width 1920
Set Height 1600
Set Theme "Dracula"
Set Padding 20
Set TypingSpeed 75ms
Set Shell "bash"
Env PS1 "\[\033[38;2;252;143;93m\]> \[\033[0m\]"

# Clear npx cache first (hidden)
Hide
Type "rm -rf ~/.npm/_npx 2>/dev/null; clear"
Enter
Sleep 500ms
Show

# Start recording
Type "npx veryfront"
Sleep 500ms
Enter

# Confirm npx install prompt
Sleep 2s
Type "y"
Enter

# Wait for startup animation (spinning avatar + loading steps)
Sleep 6s

# Show the dashboard for a moment
Sleep 2s

# Navigate down to show interactivity
Down
Sleep 500ms
Down
Sleep 500ms
Down
Sleep 1s

# End
Sleep 1s
