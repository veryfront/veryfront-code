# NLSpec: cli/test-utils/

## Purpose

VCR (Video Cassette Recorder) test utility for CLI integration tests. In **record mode**
(`VCR=record`), it proxies API calls through a real `ApiClient`, captures every
request/response pair, and persists them as a JSON cassette file. In **playback mode**
(the default), it reads a previously recorded cassette and replays responses matched by
HTTP method and URL, eliminating the need for a live API during test runs. The module
also provides a convenience initializer (`initVCRTest`) that wires up config resolution
and client creation so individual test files only need a cassette name.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `createVCRClient` | `async function` | Creates a VCR-wrapped `ApiClient` that records or replays API interactions for a named cassette. Returns `{ client, save, projectSlug }`. |
| `isRecording` | `function` | Returns `true` when the environment's `vcr` field equals `"record"`. |
| `VCRTestContext` | `interface` | Shape returned by `initVCRTest`: `{ client: ApiClient; projectSlug: string; save: () => Promise<void> }`. |
| `initVCRTest` | `async function` | High-level initializer for integration tests. Resolves config, creates a real client (record mode only), and returns a `VCRTestContext`. |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `load` | `#std/dotenv.ts` | Load `.env.local` at module level so API credentials are available in record mode. |
| `cliLogger` | `#cli/utils` | Log cassette save path and entry count after recording. |
| `cwd` | `veryfront/platform` | Resolve the project directory for config resolution in record mode. |
| `createFileSystem` | `veryfront/platform` | Read/write cassette JSON files via the platform filesystem abstraction. |
| `EnvironmentConfig`, `getEnvironmentConfig` | `veryfront/config` | Determine `vcr` mode and `projectSlug` from environment. |
| `ApiClient` | `../shared/config.ts` | Type for the HTTP client interface that the VCR client implements. |
| `createApiClient`, `resolveConfig` | `../shared/config.ts` | Dynamic import (record mode only) to create a real API client from resolved config. |

## Behaviors

### Behavior 1: Playback mode — replay recorded responses

- **Given**: A cassette file exists at `cli/commands/fixtures/{cassetteName}.json`.
- **When**: `createVCRClient(cassetteName)` is called without `VCR=record`.
- **Then**: The returned `client` matches each API call by `(method, url)` against the cassette entries and returns the pre-recorded `response`. Each entry is consumed at most once (tracked by index).
- **Edge cases**: If no matching entry exists, throws `"No recorded response for: {METHOD} {url}"`.

### Behavior 2: Record mode — capture live responses

- **Given**: `env.vcr === "record"`, a `realClient` is provided, and `projectSlug` is specified.
- **When**: The returned `client` makes API calls.
- **Then**: Each call is forwarded to `realClient`, and the `{ method, url, body, response }` tuple is appended to the in-memory cassette.
- **Edge cases**: Throws if `realClient` is not provided. Throws if `projectSlug` is missing.

### Behavior 3: Saving a cassette

- **Given**: Recording mode produced at least one entry.
- **When**: `save()` is called.
- **Then**: The cassette is written as pretty-printed JSON to `cli/commands/fixtures/{cassetteName}.json`, creating the directory if needed. A log message reports the path and entry count.
- **Edge cases**: If not recording or entries are empty, `save()` is a no-op.

### Behavior 4: Legacy cassette format migration

- **Given**: A cassette file contains a bare JSON array (legacy format) instead of `{ meta, entries }`.
- **When**: `parseCassette` processes it.
- **Then**: It wraps the array into the `VCRCassette` shape, extracting `projectSlug` from the first entry's URL via regex `/projects/([^/]+)/`. Falls back to `"test-project"` if no match.

### Behavior 5: initVCRTest — high-level test setup

- **Given**: A test suite calls `initVCRTest(cassetteName)`.
- **When**: In playback mode, it loads the cassette and returns a `VCRTestContext`.
- **When**: In record mode, it dynamically imports `../shared/config.ts`, resolves config from `cwd()`, creates a real `ApiClient`, and returns a recording `VCRTestContext`.
- **Then**: The returned context provides `client`, `projectSlug`, and `save`.
- **Edge cases**: In record mode, throws if `VERYFRONT_PROJECT_SLUG` is not set in the environment.

### Behavior 6: Entry matching uses sequential consumption

- **Given**: A cassette has multiple entries with the same `(method, url)`.
- **When**: Successive calls match that signature.
- **Then**: Each call consumes the next unused entry in order (first-match-first-consumed via `usedIndices` set), allowing tests to make repeated calls to the same endpoint and get distinct responses.

## Constraints

- Cassette files live at `cli/commands/fixtures/` (relative to the module via `import.meta.url`).
- The `../shared/config.ts` module is only dynamically imported in record mode to avoid pulling in config/credential resolution during playback.

## Error Handling

| Condition | Error |
|-----------|-------|
| Playback mode, cassette file not found | `"Cassette not found: {path}\nRun with VCR=record to create it."` |
| Playback mode, no matching entry | `"No recorded response for: {METHOD} {url}"` |
| Record mode, no `realClient` | `"Real client required for VCR=record mode"` |
| Record mode, no `projectSlug` in `createVCRClient` | `"projectSlug required for VCR=record mode"` |
| Record mode, no `VERYFRONT_PROJECT_SLUG` in `initVCRTest` | `"VCR=record requires VERYFRONT_PROJECT_SLUG"` |

## Side Effects

- **Module-level**: On import, attempts to load `.env.local` via `dotenv.load()`. Failure is silently ignored (expected in playback mode).
- **`save()`**: Writes to the filesystem and logs via `cliLogger.info`.
- **Record mode in `initVCRTest`**: Dynamically imports `../shared/config.ts`.

## Performance Constraints

None significant. Cassette files are small JSON fixtures. Entry lookup is O(n) linear scan, which is adequate for typical test suites with tens of entries.

## Invariants

- In playback mode, the VCR client never makes real HTTP requests.
- In record mode, every API call through the VCR client is forwarded to the real client and captured.
- Each cassette entry is consumed at most once during playback (no duplicate matching).
- The `save()` function is idempotent in playback mode (always a no-op).
