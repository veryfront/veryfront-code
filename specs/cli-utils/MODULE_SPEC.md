# cli/utils — Behavioral NLSpec

## Overview

Shared utility module for the Veryfront CLI. Provides logging, user prompts,
terminal UI, file system helpers, string transformations, package manager
detection, git initialization, environment variable prompting, and project ID
generation. The barrel export (`cli/utils/index.ts`) is aliased as `#cli/utils`
in the import map and re-exported from `cli/index.ts`.

---

## Files and Responsibilities

### index.ts (barrel / core utilities)

**Exports:** `cliLogger`, `VERSION`, `DEFAULT_DEV_SERVER_PORT`, `formatBytes`,
`isTTY`, `showLogo`, `logSuccess`, `logError`, `logWarning`, `logInfo`,
`registerTerminationSignals`, `setVerboseMode`, `setQuietMode`, `isVerbose`,
`isQuiet`, `promptUser`, `promptPassword`, `confirmPrompt`, `exitProcess`

#### cliLogger

- Object with `debug`, `info`, `warn`, `error`, `child`, `component` methods.
- `debug` only emits when verbose mode is enabled OR `VERYFRONT_DEBUG=1`.
- `child()` and `component()` return the same logger instance (no-op for CLI).

#### VERSION

- Read from `deno.json` at import time. Falls back to `"0.0.0"` if not a string.

#### DEFAULT_DEV_SERVER_PORT

- Re-export of `DEFAULT_DEV_PORT` from `cli/shared/constants.ts`.

#### formatBytes(bytes: number): string

- Converts a byte count to a human-readable string.
- Uses absolute value of input (negative bytes formatted as positive).
- Sub-1024 values display as `"N Bytes"`.
- Scales through KB, MB, GB, TB. Caps at TB for values exceeding TB range.
- Rounds to at most 2 decimal places; omits trailing `.0`.

#### isTTY(): boolean

- Delegates to platform `isStdoutTTY()`.

#### showLogo(): void

- Prints a branded logo with version.
- When color is disabled, prints a plain-text variant.

#### logSuccess / logError / logWarning / logInfo

- Print a single message line with a prefixed icon.
- `logError` writes to stderr. `logWarning` writes to stderr. Others write to
  stdout.

#### registerTerminationSignals(handler)

- Registers handler for both SIGINT and SIGTERM.
- If the handler returns a promise and it rejects, logs the error and exits
  with code 1.
- If the handler throws synchronously, logs and exits with code 1.

#### setVerboseMode / setQuietMode / isVerbose / isQuiet

- Mutually exclusive: enabling verbose disables quiet and vice versa.
- Module-level boolean flags.

#### promptUser(message): Promise<string>

- Wraps platform `promptSync`. Returns trimmed input or `""` on null.

#### promptPassword(message): string

- Synchronous, byte-by-byte raw-mode input.
- Echoes `*` for each printable ASCII character.
- Supports backspace. Ctrl-C exits with code 130.
- Returns collected characters joined as a string.

#### confirmPrompt(message, defaultValue?): Promise<boolean>

- Returns `defaultValue` (default `false`) when not a TTY.
- Shows `[Y/n]` or `[y/N]` hint based on default.
- Accepts `"y"` / `"yes"` (case-insensitive) as true; everything else as false.

#### exitProcess(code): void

- Delegates to platform `exit`.

---

### fs.ts (file system helpers)

**Exports:** `getFs`, `ensureDir`, `directoryExists`, `fileExists`

#### getFs(): FileSystem

- Lazily creates and caches a single `FileSystem` instance via
  `createFileSystem()`.

#### ensureDir(path): Promise<void>

- Creates directory recursively. Swallows `EEXIST` errors.

#### directoryExists(path): Promise<boolean>

- Stats the path, returns `stat.isDirectory`. Returns false on any error.

#### fileExists(path): Promise<boolean>

- Delegates to `fs.exists(path)`.

---

### string.ts (string transformations)

**Exports:** `toSlug`, `toComponentName`, `formatError`

#### toSlug(name): string

- Replaces whitespace with hyphens.
- Strips characters not matching `[a-zA-Z0-9_\-[\]/]`.
- Collapses consecutive slashes.
- Preserves case.

#### toComponentName(slug): string

- Takes the last path segment (after final `/`).
- Splits on non-word characters, PascalCases each word.
- Empty segments are filtered out.

#### formatError(error: unknown): string

- Returns `error.message` for Error instances, `String(error)` otherwise.

---

### project.ts (project ID generation)

**Exports:** `generateDefaultProjectId`

#### generateDefaultProjectId(projectDir): string

- Extracts the basename of the directory path.
- Replaces non-`[a-zA-Z0-9-_]` chars with hyphens, lowercases.
- Prefixes with `"local-"`.

---

### terminal-select.ts (interactive terminal UI)

**Exports:** `SelectOption` (type), `select`, `multiSelect`, `textInput`

#### select(question, options, defaultIndex?): Promise<string | null>

- Single-select with arrow key navigation.
- Returns the selected option's `value`, or `null` on Escape.
- Hides/shows cursor during interaction.
- Clears rendered options after selection.

#### multiSelect(question, options, preselected?): Promise<string[]>

- Multi-select with arrow keys + Space to toggle.
- Returns array of selected values. Returns `[]` on Escape.
- Supports preselected values.

#### textInput(question, defaultValue?): Promise<string | null>

- Inline text editor with cursor movement (left/right), backspace, printable
  char insertion.
- Returns the typed value on Enter, `null` on Escape.

#### Internal: readKeypress, readKeypressDeno, readKeypressNode, parseKeySequence

- Cross-platform raw stdin reading.
- Deno path: uses `getStdinReader()` stream.
- Node path: uses `process.stdin` events.
- `parseKeySequence` maps raw bytes to named keys: `"up"`, `"down"`, `"left"`,
  `"right"`, `"enter"`, `"space"`, `"escape"`, `"backspace"`, `"ctrl-c"`,
  `"char:X"`, `"unknown"`.

---

### package-manager.ts (package manager detection and commands)

**Exports:** `PackageManager` (type), `detectFromUserAgent`,
`detectPackageManager`, `getInstallCommand`, `getRunCommand`, `getDlxCommand`,
`installDependencies`

#### PackageManager type

- Union: `"npm" | "yarn" | "pnpm" | "bun" | "deno"`.

#### detectFromUserAgent(): PackageManager | undefined

- Reads `npm_config_user_agent` env var.
- Matches prefix to determine package manager.

#### detectPackageManager(projectDir, preference?): Promise<PackageManager>

- Priority: explicit preference > user agent > lockfile in dir > lockfile in
  parent dir > `"npm"` default.
- Lockfile priority order: bun.lockb > deno.lock > pnpm-lock.yaml > yarn.lock
  > package-lock.json.

#### getInstallCommand(pm): string

- Returns the install command string for each PM.

#### getRunCommand(pm, script): string

- Returns the run-script command. npm needs `"run"` keyword; others do not.

#### getDlxCommand(pm): string

- Returns the one-off execution command (npx/dlx/bunx/dx).

#### installDependencies(projectDir, options?): Promise<boolean>

- Detects PM, runs install command, returns success/failure.
- Supports `silent` and `packageManager` options.
- Uses shell on Windows for `.cmd` files.

---

### git.ts (git initialization)

**Exports:** `initializeGitRepo`

#### initializeGitRepo(projectDir, projectName): Promise<boolean>

- Runs `git init`, `git add -A`, `git commit -m "Initial commit: {name}"
  --no-gpg-sign`.
- Returns `false` on any step failure. Uses `capture: true` to suppress output.

---

### env-prompt.ts (environment variable prompting)

**Exports:** `EnvPromptOptions` (type), `EnvPromptResult` (type),
`promptForEnvVars`, `generateGitignoreContent`

#### promptForEnvVars(envVars, options?): Promise<EnvPromptResult>

- Prompts user for each env var value during project scaffolding.
- Skips prompting in CI, Deno test env, or when `skipPrompt` is true.
- Supports prefilled values from config file.
- Sensitive values use `promptPassword` and are masked in logs.
- Returns `.env` content, `.env.example` content, and values map.
- Shows summary: all configured / some skipped / all skipped.

#### generateGitignoreContent(existingContent?): string

- Without existing content: generates a full `.gitignore` with standard
  sections (Dependencies, Environment files, Build output, Local AI model
  cache, IDE).
- With existing content containing `.env`: returns as-is.
- With existing content missing `.env`: appends environment file entries.

---

## Test Coverage

| File                       | Test File                       | Coverage Notes                           |
| -------------------------- | ------------------------------- | ---------------------------------------- |
| index.ts                   | index.test.ts                   | formatBytes, log*, showLogo, promptUser  |
| project.ts                 | project.test.ts                 | generateDefaultProjectId fully covered   |
| terminal-select.ts         | terminal-select.test.ts         | Documentation-only tests (no stdin mock) |
| package-manager.ts         | package-manager.test.ts         | All pure functions + lockfile detection  |
| env-prompt.ts              | env-prompt.test.ts              | generateGitignoreContent only            |
| fs.ts                      | (none)                          |                                          |
| string.ts                  | (none)                          |                                          |
| git.ts                     | (none)                          |                                          |

## Public API Surface

The barrel `index.ts` is the primary public API (`#cli/utils`). Other files are
imported directly by path from specific consumers:

- `fs.ts` — used by `cli/mcp/tools/helpers.ts`, `cli/commands/generate/`
- `string.ts` — used by `cli/mcp/tools/helpers.ts`, `cli/app/actions.ts`,
  `cli/commands/generate/`, `cli/commands/doctor/`
- `project.ts` — used by `cli/commands/serve/`, `cli/commands/start/`
- `terminal-select.ts` — used by `cli/commands/generate/`,
  `cli/commands/init/`
- `package-manager.ts` — used by `cli/commands/init/`
- `env-prompt.ts` — used by `cli/commands/init/`
- `git.ts` — not directly imported outside the module (only via `#cli/utils`
  consumers that import `initializeGitRepo` from elsewhere, or directly)
