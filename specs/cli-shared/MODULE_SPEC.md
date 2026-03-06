# cli/shared — Behavioral NLSpec

Core types, constants, argument parsing, configuration resolution, server
startup wrappers, and project slug utilities shared across all CLI commands.

## Files

| File               | Role                                                        |
| ------------------ | ----------------------------------------------------------- |
| `types.ts`         | `ParsedArgs` interface, `ServerMode` Zod enum               |
| `args.ts`          | Arg extraction, typed arg parser factory, raw CLI parser     |
| `constants.ts`     | Numeric defaults, timeouts, file/dir names, `getApiUrl`     |
| `config.ts`        | Config file reading, config resolution, API client factory   |
| `handler-utils.ts` | `handleProjectDirCommand` — boilerplate for dir commands     |
| `slug.ts`          | `randomSuffix` — random alphanumeric string generator        |
| `reserve-slug.ts`  | Project slug reservation against the Veryfront API           |
| `server-startup.ts`| Thin wrappers starting dev / proxy / production servers      |

## types.ts

### ServerModeSchema / ServerMode

- A Zod enum of `"combined" | "proxy" | "production"`.
- Used to validate the `--mode` / `-m` CLI flag.

### ParsedArgs

- Represents the raw output of CLI argument parsing.
- `_` holds positional arguments as `(string | number)[]`.
- `__explicit` tracks which keys were explicitly provided by the user.
- Contains typed optional fields for common flags: `port`, `help`, `version`,
  `quiet`, `verbose`, `color`, `no-color`, `force`, `strict`, `template`,
  `json`, `with` (string array), `mode`.
- Short aliases (`p`, `h`, `v`, `q`, `f`, `s`, `t`, `j`, `w`, `m`) mirror
  their long-form counterparts.
- Index signature `[key: string]: unknown` allows arbitrary extra flags.

## args.ts

### ArgSpec / ArgMap

- `ArgSpec` describes a single CLI option: its lookup `keys`, a `type`
  (`"string" | "boolean" | "number" | "array"`), and an optional `positional`
  index.
- `ArgMap<T>` maps Zod schema field names to `ArgSpec`s.

### coerceValue (private)

- Converts a raw value to the target type.
- `"boolean"` — `Boolean(value)`.
- `"number"` — passthrough if already number, otherwise `parseInt(value, 10)`.
- `"array"` — if already array, maps to strings; if string, splits on commas
  and trims; if truthy scalar, wraps in single-element array; otherwise empty
  array.
- `"string"` — `String(value)`.

### extractArg

- Looks up a value from `ParsedArgs` by trying each key in `spec.keys` in
  order; returns first match after coercion.
- Falls back to `positional` index in `args._` (offset by +1 because `_[0]`
  is the command name).
- Returns `undefined` if nothing matches.

### extractArgs

- Iterates an `ArgMap`, calls `extractArg` for each spec, collects non-
  undefined results into a plain object.

### createArgParser

- Factory that combines `extractArgs` with a Zod schema's `safeParse`.
- Returns a function `(args: ParsedArgs) => SafeParseReturnType<unknown, T>`.

### parseArgsOrThrow

- Calls a parser function; if `success` is false, throws an `Error` with
  `"Invalid {commandName} arguments: {zodMessage}"`.

### CommonArgs

- Reusable `ArgSpec` constants: `force`, `dryRun`, `branch`, `env`,
  `projectDir`, `projectSlug`, `quiet`, `releaseName`, `into`, `release`,
  `output`.

### parseCliArgs

- Low-level argv parser (replaces minimist dependency).
- Handles `--key value`, `--key=value`, `-k value`, boolean flags (no
  following value).
- Resolves short aliases to long names via a fixed alias map.
- `ARRAY_FLAGS` set (`"with"`) causes repeated flags to accumulate into an
  array rather than overwrite.
- Numeric-looking string values are auto-converted to numbers.
- Populates `__explicit` with every key that was explicitly set.

## constants.ts

### Port defaults

- `DEFAULT_DEV_PORT` = 3000
- `DEFAULT_PROXY_PORT` = 8080
- `DEFAULT_MCP_PORT` = 9999
- `DEFAULT_CALLBACK_PORT` = 9876
- `MAX_PORT_ATTEMPTS` = 100

### API URLs

- `DEFAULT_API_URL` = `"https://api.veryfront.com"`
- `DEFAULT_LOCAL_API_URL` = `"https://api.veryfront.com"` (same value as
  `DEFAULT_API_URL`)

### getApiUrl

- Returns `env.apiUrl` if set, otherwise `DEFAULT_API_URL`.
- Accepts an optional `EnvironmentConfig`; defaults to
  `getEnvironmentConfig()`.

### Timeouts

- `DEFAULT_LOGIN_TIMEOUT_MS` = 120,000 (2 minutes)
- `SHUTDOWN_TIMEOUT_MS` = 3,000
- `REQUEST_TIMEOUT_MS` = 3,000

### Token / config paths

- `CONFIG_DIR_NAME` = `"veryfront"`
- `TOKEN_FILE_NAME` = `"token"`
- `TOKEN_FILE_PERMISSIONS` = `0o600` (owner read/write)

## config.ts

### VeryfrontConfigSchema / VeryfrontConfig

- Optional fields: `projectSlug`, `projects` (string array), `apiToken`,
  `apiUrl`.

### ResolvedConfigSchema / ResolvedConfig

- Required fields: `apiUrl`, `apiToken`, `projectSlug`.

### readConfigFile

- Tries `veryfront.config.ts`, then `veryfront.config.js` (dynamic import),
  extracting `projectSlug` from default export.
- Falls back to `veryfront.json` (parsed with `VeryfrontConfigSchema`).
- Returns `null` if nothing found or parseable.

### writeProjectSlug

- Reads existing `veryfront.json`, merges in the new `projectSlug`, writes
  back with 2-space indent + trailing newline.

### slugify (private)

- Replaces any non-alphanumeric/hyphen character with a hyphen.

### inferProjectSlug (private)

- Reads `package.json` name (strips org scope), slugifies it.
- Falls back to slugified directory name.

### resolveConfigBase (private)

- Resolves `apiUrl` from env > config file > `DEFAULT_API_URL`.
- Resolves `apiToken` from env > config file > token store > interactive
  login (if `interactive` is true).
- Resolves `projectSlug` from env > config file > inferred slug.
- Throws descriptive errors if token or slug cannot be determined.

### resolveConfig / resolveConfigWithAuth

- `resolveConfig` — non-interactive config resolution.
- `resolveConfigWithAuth` — same but prompts for login if no token found.
- Both created via `createConfigResolver` (private), which delegates to
  `resolveConfigByMode` (private).

### ApiClient interface

- Methods: `get`, `post`, `put`, `patch`, `delete` — all generic over
  response type `<T>`.
- `get` accepts optional query params.

### ApiErrorSchema / ApiError

- Shape: `{ error: string, message?: string, code?: string }`.

### createApiClient

- Builds an `ApiClient` from a `ResolvedConfig`.
- Sends JSON with `Authorization: Bearer` header.
- On non-OK responses, attempts to parse `ApiErrorSchema` for a better error
  message; throws `Error`.
- Returns `undefined as T` for 204 No Content.

## handler-utils.ts

### handleProjectDirCommand

- Generic helper for commands that accept a `projectDir` arg.
- Shows the CLI logo, parses args with `parseArgsOrThrow`, defaults
  `projectDir` to `cwd()`, then invokes the command function.

## slug.ts

### randomSuffix

- Generates a random lowercase alphanumeric string of length `len`
  (default 6).
- Uses `Math.random()` (not cryptographically secure).

## reserve-slug.ts

### getApiUrl (private, module-local)

- Duplicates the logic in `constants.ts`: returns `env.apiUrl ??
  "https://api.veryfront.com"`.

### slugToName (private)

- Converts a slug like `"my-project"` to `"My Project"` using
  `capitalizeSeparatedWords`.

### reserveProjectSlug

- Attempts to create a project via POST to `/projects`.
- On 409 (slug taken), appends a `randomSuffix()` and retries, up to
  `MAX_SLUG_ATTEMPTS` (10) times.
- Returns `{ slug, projectId, created: true }` on success.

### tryCreateProject (private)

- Single attempt to POST a project. Returns a discriminated result with
  `success`, `projectId`, `isSlugTaken`, `error`.

### isSlugAvailable

- HEAD request to `/projects/{slug}`. Returns `true` if 404, `false`
  otherwise. Swallows network errors (returns `true`).

## server-startup.ts

### startCliProxyModeServer

- Sets `PROXY_MODE=1` and `NODE_ENV=development` (if not already set).
- Builds `DiscoveryOptions` from env vars and options.
- Delegates to `startProductionServer`.

### startCliDevServer

- Thin wrapper around `startDevServer` from `veryfront/server`.
- Passes through port, projectDir, HMR options, signal.

### startCliProductionServer

- Thin wrapper around `startProductionServer`.
- Resolves the runtime adapter if not provided.

## Public API surface (exports consumed outside cli/shared/)

From `types.ts`: `ParsedArgs`, `ServerMode`, `ServerModeSchema`
From `args.ts`: `createArgParser`, `parseArgsOrThrow`, `CommonArgs`,
  `parseCliArgs`, `ArgSpec`, `extractArg`, `extractArgs`
From `constants.ts`: all exported constants and `getApiUrl`
From `config.ts`: `resolveConfig`, `resolveConfigWithAuth`, `readConfigFile`,
  `writeProjectSlug`, `createApiClient`, `ApiClient`, `ApiError`,
  `VeryfrontConfig`, `ResolvedConfig`, schemas
From `handler-utils.ts`: `handleProjectDirCommand`
From `slug.ts`: `randomSuffix`
From `reserve-slug.ts`: `reserveProjectSlug`, `isSlugAvailable`,
  `ReserveResult`
From `server-startup.ts`: `startCliProxyModeServer`, `startCliDevServer`,
  `startCliProductionServer`, and their option interfaces
