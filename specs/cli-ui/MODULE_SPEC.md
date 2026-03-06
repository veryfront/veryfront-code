# cli/ui Module -- Behavioral NLSpec

## Purpose

Terminal UI toolkit for the Veryfront CLI. Provides ANSI escape codes, color theming with graceful degradation, layout primitives, progress indicators, animated text, dot-matrix logo rendering, keyboard input handling, and higher-level components (banner, table, multi-select, shortcuts). All code is runtime-agnostic (Deno, Node.js, Bun) via `veryfront/platform` abstractions.

---

## Sub-modules

### ansi.ts -- ANSI Escape Code Primitives

- Exports raw constants: `ESC`, `CSI`, `RESET`.
- `cursor` object: `hide`, `show`, `save`, `restore` (string constants); `moveTo(row, col)`, `up(n)`, `down(n)`, `right(n)`, `left(n)` (functions returning strings).
- `screen` object: `clear`, `clearLine`, `clearLineEnd`, `clearDown`, `clearUp`, `altOn`, `altOff`, `clearLineReturn`.
- `style` object: `bold`, `dim`, `italic`, `underline`, `blink`, `inverse`, `hidden`, `strikethrough`.
- Color code generators: `fgRgb(r,g,b)`, `bgRgb(r,g,b)`, `fg256(n)`, `bg256(n)`, `fg16(n)`, `bg16(n)`.
- `ANSI_REGEX`: global regex matching `\x1b[...m` sequences.
- `stripAnsi(text)`: removes all ANSI codes from a string.
- `SPINNER_FRAMES`: 10-element braille spinner array.
- `getSpinnerFrame(index)`: returns the frame at `index % 10`.

### colors.ts -- Color Theming with Level Detection

- `ColorLevel`: `"truecolor" | "256" | "16" | "none"`.
- `getColorLevel()` / `shouldUseColor()`: detect terminal color support from env vars (`FORCE_COLOR`, `NO_COLOR`, `TERM`, `COLORTERM`, `TERM_PROGRAM`) and TTY status.
- Cached color level with env-key invalidation; `resetColorCache()` clears it.
- `setColorOverride(bool | undefined)`: CLI `--color`/`--no-color` flag support.
- `setTestColorLevel(level | null)`: override for tests.
- `color(text, hex)` / `bgColor(text, hex)`: apply hex color with automatic level degradation (truecolor -> 256 -> 16 -> none).
- Semantic color functions (curried): `brand`, `brandBg`, `success`, `error`, `warning`, `muted`, `cyan`.
- Aliases: `green = success`, `yellow = warning`, `red = error`.
- Style functions: `bold`, `dim`, `italic`, `underline`.
- Compound: `brandBold`, `successBold`, `errorBold`.
- `shimmer(text, frame, waveWidth)`: animated wave-of-brightness effect across text.
- Re-exports `RESET` as `reset`.

### constants.ts -- UI Timing and Layout Constants

- Re-exports `DEFAULT_DEV_PORT`, `DEFAULT_PROXY_PORT`, `SHUTDOWN_TIMEOUT_MS` from `cli/shared/constants`.
- Timing: `SPINNER_INTERVAL_MS` (80), `RENDER_INTERVAL_MS` (100), `TYPEWRITER_CHAR_DELAY_MS` (30), `TYPEWRITER_WORD_DELAY_MS` (100).
- Layout: `DEFAULT_PADDING_X` (2), `DEFAULT_PADDING_Y` (1), `DEFAULT_PROGRESS_BAR_WIDTH` (20), `DEFAULT_TERMINAL_WIDTH` (80), `DEFAULT_TERMINAL_HEIGHT` (24).
- Duration thresholds: `DURATION_SECONDS_THRESHOLD_MS` (1000), `DURATION_MINUTES_THRESHOLD_MS` (60000).

### layout.ts -- Terminal-Aware Layout Primitives

- `getTerminalWidth()` / `getTerminalHeight()`: delegates to platform `getTerminalSize()`.
- `isTTY()`: delegates to platform `isStdoutTTY()`.
- `visibleLength(text)`: string length excluding ANSI codes.
- `truncate(text, maxWidth, ellipsis)`: ANSI-aware truncation preserving escape sequences, appends ellipsis + RESET.
- `pad(text, width, align)`: delegates to shared `box.pad()`. Supports `"left" | "center" | "right"`.
- `wrap(text, maxWidth)`: word-boundary wrapping into string array; returns `[text]` if `maxWidth <= 0`.
- `repeat(char, count)`: safe `.repeat()` that returns `""` for count <= 0.
- `lines(text)`: splits on `\n`.
- `maxLineWidth(lines)`: max `visibleLength` across lines; returns 0 for empty array.
- Re-exports `stripAnsi` from `ansi.ts`.

### keyboard.ts -- Keyboard Input Handler

- `KeyboardHandler` interface: `start()`, `stop()`.
- `KeyboardOptions`: callbacks for keys `o`, `c`, `q`, `a`, `s`, `l`, `p`, `u`, number keys 1-9, and Ctrl+C.
- `createKeyboardHandler(options)`: returns noop handler if not TTY; otherwise creates a platform handler that sets raw mode, reads stdin byte-by-byte, dispatches to callbacks, and restores terminal on stop.

### progress.ts -- Spinners, Steps, Progress Bars

- `StepStatus`: `"pending" | "active" | "completed" | "error"`.
- `Step` interface: `label`, `status`, optional `duration` (ms).
- `formatStep(step, spinnerFrame)`: renders one step line with icon (checkmark/cross/spinner/circle) and optional duration.
- `renderSteps(steps, spinnerFrame)`: joins formatted steps with 2-space indent.
- `formatDuration(ms)`: `"Nms"` / `"N.Ns"` / `"Nm Ns"`.
- `progressBar(current, total, options)`: renders `[fill░░░] percent current/total` with configurable width, label, showPercent.
- `xOfY(current, total, label?)`: simple `"current / total"` or `"label: current / total"`.
- `createSpinner(text)` -> `SpinnerController`: animated spinner that writes to stdout; non-TTY falls back to static lines. Methods: `update(text)`, `success(text?)`, `error(text?)`, `stop()`.
- `createNoopSpinner()`: silent spinner for non-interactive contexts.
- `inlineSpinner(text, frame)`: returns a single spinner-line string without side effects.
- `TaskList` class: manages ordered tasks with `add(label)`, `start(index)`, `complete(index)`, `fail(index)`, `render()`, `startAnimation(onFrame)`, `stopAnimation()`.

### animated-text.ts -- Typewriter Effects

- `TypewriterOptions`: `charDelay`, `wordDelay`, `mode ("char"|"word")`, `hideCursor`.
- `typeText(text, options)`: async char-by-char or word-by-word output with configurable delays; hides/shows cursor.
- `typeLine(text, options)`: `typeText` + newline.
- `typeCommand(command, options)`: prefixes with `$ ` in brand color, uses 50ms default char delay.
- `HIDE_CURSOR` / `SHOW_CURSOR`: re-exported cursor constants for backward compatibility.

### dot-matrix.ts -- 7x7 Dot Matrix Logo

- `AGENT_FACE`: 7x7 binary grid of the Veryfront logo.
- `V_LOGO_POSITIONS`: 16 `[row, col]` tuples for the lit dots.
- `DotMatrixOptions`: `litChar`, `offChar`, `litColor`, `offColor`, `spacing`, `prefix`, `compact`.
- `renderDotMatrix(pattern, options)`: renders any binary grid to multiline string.
- `generateSpinnerFrame(frameIndex, tailLength)` / `generateSpinnerFrames(tailLength)`: create spinner animation frames from V_LOGO_POSITIONS.
- `getAgentFace(options)`: renders the static face.
- `getAgentFaceWithText(textLines, options)`: face with text lines side-by-side.
- `getSpinningAgentFace(textLines, frame, options)`: face with angular brightness animation.
- `AnimatedDotMatrix` class: stateful wrapper managing spinner intervals. Methods: `render()`, `renderWithText(lines)`, `getHeight()`, `startSpinner(onFrame)`, `startSpinnerWithText(lines, onFrame)`, `spinRounds(n, onFrame)`, `spinRoundsWithText(n, lines, onFrame)`, `stopSpinner()`, `stop()`, `reset()`, `setPattern(pattern)`, `spinning` getter.
- `agentSays(message, options)`: shorthand for face-with-text.
- `getInlineFace()`: returns a single-line braille-style face string.

### tui.ts -- Full-Screen TUI

- `TuiConfig`: `title`, `subtitle`, `showLogs`.
- `TuiState`: `status`, `statusType`, `steps[]`, `currentStep`, `info{}`, `logs[]`, `logsExpanded`, `logScroll`.
- `createTui(config)`: enters alt screen, hides cursor, starts spinner. Returns controller with: `setInfo`, `setSteps`, `completeStep`, `setStatus`, `addLog`, `toggleLogs`, `scrollLogs`, `cleanup`, `render`.
- `Tui` type: `ReturnType<typeof createTui>`.
- `interceptConsole(tui)`: redirects `console.log/error/warn/info` to `tui.addLog()`; returns restore function.
- `handleInput(tui, opts)`: reads stdin in raw mode; dispatches Ctrl+C to `onExit`, Enter to `onEnter`, `l/L` to toggleLogs, arrow/j/k to scrollLogs.

### box.ts -- Re-export

- Re-exports everything from `veryfront/utils/box` (shared box-drawing utility).

### components/banner.ts -- Banner Components

- `BannerInfo`: key-value record for display info.
- `BannerOptions`: `title`, `subtitle`, `info`, `style`, `minWidth`, `showLogo`.
- `banner(options)`: renders boxed banner with optional dot-matrix logo.
- `inlineBanner(options)`: renders unboxed banner with logo.
- `errorBanner(message, suggestion?)`: red-bordered error box.
- `successBanner(message, info?)`: green-bordered success box.

### components/table.ts -- Table Rendering

- `TableColumn`: `header`, `key`, `align`, `minWidth`, `maxWidth`.
- `TableOptions`: `columns`, `showHeader`, `border`, `indent`, `separator`.
- `table(rows, options)`: renders tabular data with optional borders and headers.
- `keyValueList(items, options)`: definition-list style rendering with optional status icons.
- `checkList(items, options)`: pass/fail/warn/skip checklist rendering.

### components/multi-select.ts -- Interactive Multi-Select

- `MultiSelectOption<T>`: `label`, `value`, `description`, `selected`.
- `MultiSelectConfig`: `title`, `subtitle`, `hint`, styling callbacks.
- `multiSelect(options, config)`: async interactive picker. Returns selected values or null on cancel. Supports space-toggle, enter-confirm, a-all, n-none, q-cancel, arrow/j/k navigation.

### components/shortcuts.ts -- Shortcut Display

- `Shortcut`: `{ key, label }`.
- `shortcuts(items)`: inline shortcut bar.
- `DEV_SHORTCUTS`: default dev shortcuts (o/c/q).
- `devShortcuts()`: renders `DEV_SHORTCUTS`.
- `shortcutsBlock(items, header)`: multi-line block display.

### index.ts -- Barrel Export

- Re-exports: `colors`, `layout`, `progress`, `dot-matrix`, `animated-text`, `tui`, `components/index`.
- Does NOT re-export: `ansi`, `constants`, `keyboard` (internal-use, imported directly by consumers that need them).

---

## Invariants

1. All color functions return the original text unmodified when `ColorLevel` is `"none"`.
2. `visibleLength(colorFn(text)) === text.length` for any color function and plain-text input.
3. `truncate(text, n)` guarantees `visibleLength(result) <= n` for `n >= ellipsis.length`.
4. `wrap(text, n)` never produces a line with `visibleLength > n` unless a single word exceeds `n`.
5. Spinner/animation intervals are always cleaned up by their corresponding stop methods.
6. `createKeyboardHandler` is safe to call in non-TTY environments (returns noop).
7. `createSpinner` degrades gracefully in non-TTY environments (static output).
8. The TUI always restores the terminal (alt screen off, cursor shown) on `cleanup()`.
9. `multiSelect` returns the initial selection (no interaction) in non-TTY environments.
10. Color level detection is deterministic given the same env vars and TTY status.
