# Recording the TUI Demo GIF

Two recording methods are available: **asciinema** (recommended) and **VHS**.

## Method 1: asciinema (Recommended)

[asciinema](https://github.com/asciinema/asciinema) records terminal sessions to `.cast` files. [agg](https://github.com/asciinema/agg) converts them to GIF.

### Prerequisites

```bash
brew install asciinema agg
```

### Recording

```bash
# Clear npx cache to ensure latest version
rm -rf ~/.npm/_npx && npm cache clean --force

# Record the demo
cd docs/recording/asciinema
./record-asciinema.sh
```

This outputs `demo-asciinema.gif` (~200KB).

### Manual Recording

```bash
cd docs/recording/asciinema

# Record interactively
asciinema rec --cols 80 --rows 40 --idle-time-limit 3 demo.cast

# Convert to GIF
agg --theme dracula --font-size 24 demo.cast demo-asciinema.gif
```

### Customization

Edit `record-asciinema.sh` or use agg options:
- `--theme` - Color theme (dracula, monokai, etc.)
- `--font-size` - Text size in pixels
- `--speed` - Playback speed multiplier

---

## Method 2: VHS

[VHS](https://github.com/charmbracelet/vhs) records scripted terminal sessions.

### Prerequisites

```bash
brew install vhs
```

### Recording

```bash
# Clear npx cache to ensure latest version
rm -rf ~/.npm/_npx && npm cache clean --force

# Record the GIF
cd docs/recording/vhs
vhs demo.tape
```

This outputs `demo-vhs.gif` (~400KB).

### Customization

Edit `demo.tape` to adjust:
- `Set FontSize` - Text size
- `Set Width/Height` - Viewport dimensions
- `Sleep` - Timing between actions
- `Type` - Commands to type
- `Down/Up` - Arrow key navigation

---

## Directory Structure

```
docs/recording/
├── README.md
├── asciinema/
│   ├── demo-asciinema.gif   # Output GIF (~200KB)
│   ├── demo.cast            # Raw recording (asciicast v3)
│   ├── demo-runner.sh       # Script that runs during recording
│   └── record-asciinema.sh  # Main recording script
└── vhs/
    ├── demo-vhs.gif         # Output GIF (~400KB)
    └── demo.tape            # VHS script file
```

## Demo Contents

The GIFs show:
1. Orange `>` prompt
2. `npx veryfront` command
3. Startup animation with spinning avatar
4. Dashboard with loading steps
