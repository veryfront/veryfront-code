# NLSpec: src/sandbox/

## Purpose
Client SDK for ephemeral compute environments (sandboxes). Provides the `Sandbox` class for creating, reconnecting to, and interacting with isolated execution environments via the Veryfront API. Used by AI agent tool loops for bash command execution.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `Sandbox` | class | Client for ephemeral compute sandboxes with command execution and file I/O |
| `SandboxOptions` | interface | Options for creating/reconnecting: `apiUrl?` and `authToken` |
| `ExecResult` | interface | Buffered command result: `stdout`, `stderr`, `exitCode` |
| `ExecStreamEvent` | interface | Streaming event: `type` (stdout/stderr/exit/error), `data?`, `exitCode?` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| None | — | Self-contained; uses only Web APIs (fetch, TextDecoder, ReadableStream) |

## Behaviors

### Behavior 1: Create a new sandbox session
- **Given**: Valid `SandboxOptions` with `authToken` (and optional `apiUrl`)
- **When**: `Sandbox.create(options)` is called
- **Then**: POSTs to `{apiUrl}/sandbox-sessions`, returns a `Sandbox` instance
- **Edge cases**:
  - If `apiUrl` is not provided, resolves from `VERYFRONT_API_URL` env (Deno or Node), falls back to `https://api.veryfront.com`
  - If response is not ok, throws `Error` with status and response text
  - If sandbox status is not "running", polls `waitForReady` until running or timeout

### Behavior 2: Reconnect to existing sandbox
- **Given**: A session `id` and valid `SandboxOptions`
- **When**: `Sandbox.get(id, options)` is called
- **Then**: GETs `{apiUrl}/sandbox-sessions/{id}`, returns a `Sandbox` instance with the endpoint
- **Edge cases**:
  - Same `apiUrl` resolution as `create()`
  - If response is not ok, throws `Error` with status and response text

### Behavior 3: Wait for sandbox to become ready
- **Given**: A sandbox session that is not yet "running"
- **When**: `waitForReady()` polls the session status
- **Then**: Resolves when status becomes "running"
- **Edge cases**:
  - Polls every 2s (default `pollIntervalMs`)
  - Times out after 60s (default `maxWaitMs`) with "did not become ready" error
  - Throws immediately if status is "error" or "deleting"

### Behavior 4: Execute command (buffered)
- **Given**: A connected `Sandbox` instance
- **When**: `sandbox.executeCommand(command)` is called
- **Then**: Streams execution via `executeStream()`, buffers stdout/stderr/exitCode, returns `ExecResult`
- **Edge cases**:
  - Default `exitCode` is 1 if no exit event received
  - `event.data` may be undefined (uses `?? ""`)

### Behavior 5: Execute command (streaming)
- **Given**: A connected `Sandbox` instance
- **When**: `sandbox.executeStream(command)` is called
- **Then**: POSTs to `{endpoint}/exec`, yields NDJSON-parsed `ExecStreamEvent` objects
- **Edge cases**:
  - Handles partial lines across chunks via buffer
  - Empty/whitespace-only lines are skipped
  - Remaining buffer after stream ends is parsed and yielded
  - Throws on non-ok response

### Behavior 6: Read file from sandbox
- **Given**: A connected `Sandbox` instance
- **When**: `sandbox.readFile(path)` is called
- **Then**: GETs `{endpoint}/file?path={encoded_path}`, returns file content as text
- **Edge cases**: Throws on non-ok response

### Behavior 7: Write files to sandbox
- **Given**: A connected `Sandbox` instance and an array of `{path, content}` objects
- **When**: `sandbox.writeFiles(files)` is called
- **Then**: POSTs to `{endpoint}/files` with JSON body, resolves on success
- **Edge cases**: Throws on non-ok response

### Behavior 8: Heartbeat
- **Given**: A connected `Sandbox` instance
- **When**: `sandbox.heartbeat()` is called
- **Then**: POSTs to `{apiUrl}/sandbox-sessions/{sessionId}/heartbeat`

### Behavior 9: Close sandbox
- **Given**: A connected `Sandbox` instance
- **When**: `sandbox.close()` is called
- **Then**: DELETEs `{apiUrl}/sandbox-sessions/{sessionId}`

### Behavior 10: Accessors
- `sandbox.id` returns the session ID
- `sandbox.url` returns the sandbox endpoint URL

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/sandbox/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno task verify:quick && deno test --no-check --allow-all src/sandbox/

## Error Handling
- All HTTP methods throw `Error` with status code and response text on non-ok responses
- `waitForReady` throws on timeout (60s default) or terminal statuses ("error", "deleting")

## Side Effects
- Network: Makes HTTP requests to the Veryfront API and sandbox endpoints
- Environment: Reads `VERYFRONT_API_URL` from Deno.env or process.env

## Performance Constraints
- `waitForReady` polls every 2s with 60s max — callers must tolerate this latency
- `executeStream` processes NDJSON line-by-line — memory usage proportional to largest single line, not total output

## Invariants
- `Sandbox` instances can only be created via `Sandbox.create()` or `Sandbox.get()` (private constructor)
- All API calls include `Authorization: Bearer {authToken}` header
- `apiUrl` resolution order: explicit option > env var > `https://api.veryfront.com`
