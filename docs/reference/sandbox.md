---
title: "veryfront/sandbox"
description: "Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments."
order: 20
---

# veryfront/sandbox

Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments.

## Import

```ts
import { Sandbox } from "veryfront/sandbox";
```

## Examples

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();
const result = await sandbox.executeCommand("echo hello");
console.log(result.stdout); // "hello\n"
await sandbox.close();
```

## API

### `Sandbox.create(options?)`

Create a new sandbox session. Claims a warm pod or creates a new one.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.get(id, options?)`

Reconnect to an existing sandbox session.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `sandbox.executeCommand(command)`

Execute a bash command in the sandbox and return buffered result.

**Returns:** <code>Promise&lt;ExecResult&gt;</code>

### `sandbox.executeStream(command)`

Execute a bash command with streaming output (NDJSON).

**Returns:** <code>AsyncGenerator&lt;ExecStreamEvent&gt;</code>

### `sandbox.readFile(path)`

Read a file from the sandbox workspace.

**Returns:** <code>Promise&lt;string&gt;</code>

### `sandbox.writeFiles(files)`

Write files to the sandbox workspace.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.heartbeat()`

Send a heartbeat to prevent idle timeout.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.close()`

Close the sandbox session and mark for deletion.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.id`

Get the session ID.

**Returns:** `string`

### `sandbox.url`

Get the sandbox endpoint URL.

**Returns:** `string`

## Type Reference

### `SandboxOptions`

Options for creating a sandbox session.

| Property     | Type     | Description                                                                                                         |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `apiUrl?`    | `string` | Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL env.                                                   |
| `authToken?` | `string` | Explicit Veryfront auth token or API key override. Defaults to request-scoped credentials or `VERYFRONT_API_TOKEN`. |

### `ExecResult`

Result of a command execution: stdout, stderr, and exit code.

| Property   | Type     | Description                                      |
| ---------- | -------- | ------------------------------------------------ |
| `stdout`   | `string` | Buffered standard output from command execution. |
| `stderr`   | `string` | Buffered standard error from command execution.  |
| `exitCode` | `number` | Process exit code.                               |

### `ExecStreamEvent`

Streaming event emitted during command execution.

| Property    | Type                                        | Description                                       |
| ----------- | ------------------------------------------- | ------------------------------------------------- |
| `type`      | `"stdout" \| "stderr" \| "exit" \| "error"` | Event type (`stdout`, `stderr`, `exit`, `error`). |
| `data?`     | `string`                                    | Chunk payload for stdout/stderr/error events.     |
| `exitCode?` | `number`                                    | Exit code for `exit` events.                      |

## Exports

### Classes

| Name      | Description                                                                             |
| --------- | --------------------------------------------------------------------------------------- |
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. |

### Types

| Name              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `ExecResult`      | Result of a command execution: stdout, stderr, and exit code. |
| `ExecStreamEvent` | Streaming event emitted during command execution.             |
| `SandboxOptions`  | Options for creating a sandbox session.                       |

## Related

- [`veryfront/agent`](./agent.md) — Run isolated commands from agent tools/workflows
- [`veryfront/mcp`](./mcp.md) — Expose sandbox-backed operations over MCP
