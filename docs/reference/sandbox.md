---
title: "veryfront/sandbox"
description: "Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments."
order: 20
---

# veryfront/sandbox

Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments through sandbox session APIs.

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

### `Sandbox.createLazy(options?)`

Create a lazily-provisioned sandbox client that only claims a session on first use, sends an initial heartbeat before marking the session ready, pauses background heartbeats while async command jobs are active, and keeps the session alive until `close()`.

**Returns:** <code>LazySandbox</code>

### `sandbox.executeCommand(command, options?)`

Execute a bash command in the sandbox and return buffered result.

**Returns:** <code>Promise&lt;ExecResult&gt;</code>

### `sandbox.executeStream(command, options?)`

Execute a bash command with streaming output (NDJSON).

**Returns:** <code>AsyncGenerator&lt;ExecStreamEvent&gt;</code>

### `sandbox.readFile(path)`

Read a file from the sandbox workspace.

**Returns:** <code>Promise&lt;string&gt;</code>

### `sandbox.writeFiles(files)`

Write files to the sandbox workspace.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.startCommandJob(command, options?)`

Start an async command job in the sandbox.

**Returns:** <code>Promise&lt;CommandJob&gt;</code>

### `sandbox.getCommandJob(jobId)`

Get the status of an async command job.

**Returns:** <code>Promise&lt;CommandJob&gt;</code>

### `sandbox.getCommandJobOutput(jobId)`

Get captured output for an async command job.

**Returns:** <code>Promise&lt;CommandJobOutput&gt;</code>

### `sandbox.listCommandJobs()`

List async command jobs for the current sandbox session.

**Returns:** <code>Promise&lt;CommandJob[]&gt;</code>

### `sandbox.cancelCommandJob(jobId)`

Cancel an async command job.

**Returns:** <code>Promise&lt;CommandJob&gt;</code>

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
| `projectId?` | `string` | Optional project context for project-scoped or project-billed sandbox sessions.                                     |

### `LazySandboxOptions`

Options for a lazily-provisioned sandbox session.

| Property               | Type                                | Description                                                                              |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `apiUrl?`              | `string`                            | Base URL of the Veryfront API.                                                           |
| `authToken?`           | `string`                            | Explicit Veryfront auth token or API key override.                                       |
| `projectId?`           | `string`                            | Initial project-scoped billing or isolation context.                                     |
| `getProjectId?`        | `() => string \| null \| undefined` | Deferred resolver used at first provision time, on later project-context sync checks, and as the default `projectReference` for lazy exec/job calls when callers do not override it. |
| `startupTimeoutMs?`    | `number`                            | Maximum time to wait for pending sessions to become ready. Defaults to 180000.           |
| `pollIntervalMs?`      | `number`                            | Poll interval while waiting for readiness. Defaults to 2000.                             |
| `heartbeatIntervalMs?` | `number`                            | Background heartbeat interval for active sessions. Defaults to 30000.                    |
| `heartbeatGraceMs?`    | `number`                            | Minimum gap between non-forced heartbeats. Defaults to 5000.                             |

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

### `CommandJob`

Status of an async command job.

| Property                | Type                                                 | Description                            |
| ----------------------- | ---------------------------------------------------- | -------------------------------------- |
| `id`                    | `string`                                             | Job identifier.                        |
| `status`                | `"running" \| "completed" \| "failed" \| "canceled"` | Current job status.                    |
| `exitCode`              | `number \| null`                                     | Exit code when available.              |
| `signal`                | `string \| null`                                     | Termination signal when present.       |
| `startedAt`             | `string`                                             | Job start timestamp.                   |
| `finishedAt`            | `string \| null`                                     | Job completion timestamp.              |
| `heartbeatStatus`       | `"disabled" \| "healthy" \| "degraded"`              | Heartbeat health state.                |
| `lastHeartbeatAt`       | `string \| null`                                     | Last heartbeat timestamp.              |
| `lastHeartbeatError`    | `string \| null`                                     | Last heartbeat error, if any.          |
| `heartbeatFailureCount` | `number`                                             | Number of heartbeat failures recorded. |

### `CommandJobOutput`

Command job with captured stdout/stderr.

| Property          | Type      | Description                   |
| ----------------- | --------- | ----------------------------- |
| `stdout`          | `string`  | Captured standard output.     |
| `stderr`          | `string`  | Captured standard error.      |
| `stdoutTruncated` | `boolean` | Whether stdout was truncated. |
| `stderrTruncated` | `boolean` | Whether stderr was truncated. |

## Exports

### Classes

| Name          | Description                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| `LazySandbox` | Lazily provisions sandbox sessions and keeps them heartbeating while active.            |
| `Sandbox`     | Client for isolated ephemeral compute environments with command execution and file I/O. |

### Types

| Name                 | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `CommandJob`         | Status of an async command job.                               |
| `CommandJobOutput`   | Async command job with captured output.                       |
| `ExecResult`         | Result of a command execution: stdout, stderr, and exit code. |
| `ExecStreamEvent`    | Streaming event emitted during command execution.             |
| `LazySandboxOptions` | Options for lazily-provisioned sandbox sessions.              |
| `SandboxOptions`     | Options for creating a sandbox session.                       |

## Related

- [`veryfront/agent`](./agent.md) — Run isolated commands from agent tools/workflows
- [`veryfront/mcp`](./mcp.md) — Expose sandbox-backed operations over MCP
