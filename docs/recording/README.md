# Recording the TUI Demo GIF

## Prerequisites

Install [vhs](https://github.com/charmbracelet/vhs):

```bash
brew install vhs
```

## Recording

```bash
# Clear npx cache to ensure latest version
rm -rf ~/.npm/_npx && npm cache clean --force

# Record the GIF
cd docs/recording
vhs demo.tape
```

This outputs `demo.gif` (1920×1600, ~400KB).

## Customization

Edit `demo.tape` to adjust:

- `Set FontSize` - Text size
- `Set Width/Height` - Viewport dimensions
- `Sleep` - Timing between actions
- `Type` - Commands to type
- `Down/Up` - Arrow key navigation

## Output

The GIF shows:
1. Orange `>` prompt
2. `npx veryfront` command
3. Startup animation with spinning avatar
4. Dashboard with project list
5. Navigation demo
