# NLSpec: cli/sync/

## Purpose
Provides project discovery and file-ignore logic for the CLI sync subsystem. Project discovery authenticates with the remote API, fetches the user's project list, and exposes auth-status helpers. The ignore module supplies gitignore-style path matching and file-extension allow-listing, used by push/pull commands to determine which local files participate in sync.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `fetchRemoteProjects` | async function | Authenticates, then fetches the user's remote projects from the API. Returns `ProjectDiscoveryResult` with user, projects, and optional error. |
| `getCurrentUser` | async function | Returns the currently authenticated `UserInfo`, or `null` if unauthenticated or token invalid. |
| `isAuthenticated` | async function | Returns `true` when a valid token exists in the token store. |
| `ProjectDiscoveryResult` | type | `{ user: UserInfo \| null; projects: RemoteProject[]; error?: string }` |
| `RemoteProject` | type | `{ id: string; slug: string; name: string; description?: string; updatedAt?: string }` |
| `createIgnoreChecker` | function | Accepts an array of glob/path patterns and returns an `IgnoreChecker`. |
| `createDefaultIgnoreChecker` | function | Returns an `IgnoreChecker` pre-loaded with built-in default patterns (no `.vfignore` file). |
| `loadIgnorePatterns` | async function | Reads `.vfignore` from a project directory and merges custom patterns with the built-in defaults. |
| `IgnoreChecker` | type | `{ isIgnored(relativePath: string): boolean; isSupportedExtension(filename: string): boolean }` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `join` | `veryfront/platform/path` | Build `.vfignore` file path |
| `createFileSystem` | `veryfront/platform` | Read `.vfignore` from disk |
| `cliLogger` | `#cli/utils` | Debug logging for `.vfignore` read failures |
| `getApiUrl` | `../shared/constants.ts` | Resolve API base URL for project fetch |
| `readToken` | `../auth/token-store.ts` | Retrieve stored auth token |
| `validateToken`, `UserInfo` | `../auth/login.ts` | Validate token and get user info |

## Behaviors

### Behavior 1: Fetch remote projects
- **Given**: A CLI user may or may not be authenticated
- **When**: `fetchRemoteProjects()` is called
- **Then**:
  - If no token exists, returns `{ user: null, projects: [], error: "Not authenticated..." }`
  - If token is invalid/expired, returns `{ user: null, projects: [], error: "Session expired..." }`
  - If token is valid, fetches `GET {apiUrl}/projects` with Bearer auth
  - On success, returns `{ user, projects: data.data ?? [] }`
  - On HTTP error, returns `{ user, projects: [], error }` with the response text
  - On network error, returns `{ user, projects: [], error: "Network error: ..." }`
- **Edge cases**: `response.text()` failure during error handling is caught and falls back to `response.statusText`; `data.data` may be undefined (nullish coalesced to `[]`)

### Behavior 2: Check authentication status
- **Given**: A stored token may or may not exist
- **When**: `isAuthenticated()` is called
- **Then**: Returns `true` only if a token exists AND validates successfully
- **Edge cases**: Token present but expired returns `false`

### Behavior 3: Get current user
- **Given**: A stored token may or may not exist
- **When**: `getCurrentUser()` is called
- **Then**: Returns `UserInfo` if token is valid, `null` otherwise
- **Edge cases**: Same as `isAuthenticated` -- expired token returns `null`

### Behavior 4: Load ignore patterns
- **Given**: A project directory path
- **When**: `loadIgnorePatterns(projectPath)` is called
- **Then**: Returns default patterns merged with any custom patterns from `.vfignore`
- **Edge cases**: Missing `.vfignore` returns defaults only; unreadable `.vfignore` logs debug warning and returns defaults; blank lines and `#` comments in `.vfignore` are skipped

### Behavior 5: Ignore checking
- **Given**: A set of patterns (glob-style)
- **When**: `createIgnoreChecker(patterns)` is called
- **Then**: Returns an object whose `isIgnored(path)` tests the path against compiled regexes
  - Patterns ending with `/` match directory names (exact, not substring)
  - Patterns starting with `*` are anchored at the end (e.g., `*.log`)
  - Other patterns match anywhere in the path as a segment
  - Backslashes in paths are normalized to forward slashes
- **Edge cases**: `.env*` uses regex `*` (zero-or-more of preceding char) not glob `*`, so `.env*` matches `.env` and `.envvv` but not `.env.local` (documented in tests)

### Behavior 6: Extension allow-listing
- **Given**: A filename
- **When**: `isSupportedExtension(filename)` is called
- **Then**: Returns `true` if the file's extension (case-insensitive) is in the supported set (18 extensions: .ts, .tsx, .js, .jsx, .mjs, .cjs, .json, .css, .scss, .sass, .less, .html, .htm, .md, .mdx, .txt, .svg, .yaml, .yml, .toml)
- **Edge cases**: Files with no extension return `false`

## Constraints
- Public API signatures must not change
- No modifications outside `cli/sync/`

## Error Handling
- `fetchRemoteProjects`: all errors are caught and surfaced as `error` string in the return value -- never throws
- `loadIgnorePatterns`: filesystem errors are caught, debug-logged, and defaults are returned -- never throws
- `isAuthenticated` / `getCurrentUser`: delegate to `validateToken` which returns `null` on failure -- never throw

## Side Effects
- `loadIgnorePatterns` reads from the filesystem (`.vfignore`)
- `fetchRemoteProjects` makes an HTTP request to the remote API
- `isAuthenticated` / `getCurrentUser` read from the token store
- `loadIgnorePatterns` may log via `cliLogger.debug` on error

## Performance Constraints
- `createIgnoreChecker` compiles regexes once at construction; subsequent `isIgnored` calls are O(n) in the number of patterns

## Invariants
- `fetchRemoteProjects` never throws; all failure modes produce a result with an `error` field
- Default ignore patterns are always included in `loadIgnorePatterns` output (custom patterns append, never replace)
- `createDefaultIgnoreChecker()` is equivalent to `createIgnoreChecker(DEFAULT_IGNORE_PATTERNS)`
