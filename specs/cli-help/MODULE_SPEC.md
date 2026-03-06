# NLSpec: cli/help/

## Purpose
Renders CLI help output for the `veryfront` command-line tool. Provides the main help screen (command listing, global options, quick start), per-command help screens (usage, options, examples, notes, tips), an ASCII logo banner, and a central registry of all command definitions.

## Public API

### Exports (from index.ts)
| Export | Type | Source | Description |
|--------|------|--------|-------------|
| `showMainHelp` | `() => void` | main-help.ts | Prints the full main help screen to stdout |
| `showCommandHelp` | `(command: string) => void` | command-help.ts | Prints help for a specific command; falls back to main help if unknown |
| `showAsciiLogo` | `() => void` | logo.ts | Prints a minimal ASCII logo banner to stdout |
| `COMMANDS` | `CommandRegistry` | command-definitions.ts | Record mapping command names to their `CommandHelp` definitions |
| `CommandHelp` | type | types.ts | Shape of a command's help entry (name, description, usage, options?, examples?, notes?) |
| `CommandOption` | type | types.ts | Shape of a single CLI flag (flag, description, default?) |
| `CommandRegistry` | type | types.ts | `Record<string, CommandHelp>` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `VERSION` | `#cli/utils` | Shown in the header alongside the logo |
| `bold`, `brand`, `dim`, `muted`, `shouldUseColor`, `error` | `../ui/colors.ts` | ANSI color formatting |
| `cyan`, `green`, `yellow` | `#cli/ui` | Color formatting in tips |
| `AGENT_FACE` | `../ui/dot-matrix.ts` | Dot-matrix data for the mini logo in the header |
| 26 command-help imports | `../commands/*/command-help.ts` | Individual `CommandHelp` definitions aggregated into the registry |

## Behaviors

### Behavior 1: Main help screen (`showMainHelp`)
- **Given**: The user runs `veryfront` or `veryfront --help`
- **When**: `showMainHelp()` is called
- **Then**: Prints to stdout in order: header (mini logo + version + tagline), usage line, all commands (padded/aligned), global options (-h/--help, -v/--version), quick-start guide, MCP agent info, and learn-more links
- **Formatting**: Command names are brand-colored and right-padded to the longest name; descriptions are muted

### Behavior 2: Per-command help screen (`showCommandHelp`)
- **Given**: The user runs `veryfront <command> --help`
- **When**: `showCommandHelp(command)` is called with a known command
- **Then**: Prints: command header ("veryfront <name>"), muted description, usage line, options section (if any, with flag padding and optional defaults), examples section (if any, with `$` prefix), notes section (if any, with blank-line passthrough), and contextual tips (if any)
- **Edge case (unknown command)**: Prints an error marker and the unknown command name, then falls back to `showMainHelp()`

### Behavior 3: ASCII logo banner (`showAsciiLogo`)
- **Given**: A caller wants a decorative banner
- **When**: `showAsciiLogo()` is called
- **Then**: Prints a horizontal-rule-framed banner containing "veryfront" and "React meta-framework"

### Behavior 4: Command registry (`COMMANDS`)
- **Invariant**: Every key in `COMMANDS` equals the `.name` property of its value
- **Invariant**: Every entry has `name`, `description`, `usage`; `options` and `examples` are present on all current commands (though typed as optional)
- **Source**: Each `CommandHelp` is defined in its own `../commands/<cmd>/command-help.ts` and imported into `command-definitions.ts`

### Behavior 5: Contextual tips (`getCommandTips`)
- **Given**: `showCommandHelp` finishes rendering a command
- **When**: `getCommandTips(command)` is called
- **Then**: Returns tip text for `dev`, `build`, or `init`; returns `undefined` for all other commands
- **Tip content**: `dev` tips mention HMR, MCP port 9999, Ctrl+C; `build` tips mention analyze-chunks, --dry-run, veryfront serve; `init` tips list available templates

### Behavior 6: Header formatting (`formatHeader`)
- **Given**: `showMainHelp` needs the top-of-screen header
- **When**: `formatHeader()` is called
- **Then**: Returns a multi-line string with the dot-matrix mini logo on the left and version/tagline text on the right, joined row-by-row with a fallback for mismatched heights

### Behavior 7: Formatter utilities
- `formatCommandName(name, pad)` -- brand-colors and right-pads to `pad + 2`
- `formatDescription(desc)` -- muted-colors the text
- `formatUsage(usage)` -- bold "Usage:" prefix
- `formatOption(opt, pad)` -- indented flag (padded) + muted description + optional dim default
- `formatOptionFlag(flag, pad)` -- right-pads flag to `pad + 2`
- `formatExample(example)` -- indented with dim `$` prefix
- `formatSectionHeader(title)` -- bold with colon suffix
- `formatCommandHeader(name)` -- newline + indented bold brand "veryfront <name>"
- `formatAsciiLogo()` -- horizontal-rule banner string
- `calculateMaxLength(items)` -- max `.length` across an array of `{ length: number }`
- `formatCommandList(commands)` -- maps commands to padded, colored lines

## Constraints
- All output goes to stdout via `console.log`
- Color output respects `shouldUseColor()` (only in `renderMiniLogo`)
- No async operations; all functions are synchronous

## Error Handling
- `showCommandHelp` handles unknown commands by printing an error and delegating to `showMainHelp`
- `calculateMaxLength` will throw if given an empty array (spread into `Math.max`)

## Side Effects
- All `show*` functions write to stdout via `console.log`
- No file I/O, no network, no state mutation

## Performance Constraints
- None significant; all operations are small string concatenations

## Invariants
- Public API signatures must not change
- `COMMANDS` keys must match their value's `.name` field
- The module must not import from outside `cli/` (apart from test utilities)
