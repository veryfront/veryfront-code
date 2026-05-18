---
title: "veryfront/sandbox"
description: "Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments."
order: 23
---

# veryfront/sandbox

Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments.

## Import

```ts
import {
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createProjectScopedExecOptions,
  createSandboxShellTools,
  normalizeBashToolSet,
  renameSandboxFileTools,
} from "veryfront/sandbox";
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

### `Sandbox.create()`

Create a new sandbox session. Claims a warm pod or creates a new one.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.get(id, )`

Reconnect to an existing sandbox session.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.attach(attachment)`

Attach to an already-known sandbox session and endpoint without a reconnect lookup.

**Returns:** `Sandbox`

### `Sandbox.list()`

List sandbox sessions with optional pagination.

**Returns:** <code>Promise&lt;SandboxListResult&gt;</code>

### `Sandbox.createLazy()`

Create a lazily-provisioned sandbox session with automatic heartbeats.

**Returns:** `LazySandbox`

### `sandbox.executeCommand(command, options)`

Execute a bash command in the sandbox and return buffered result.

**Returns:** <code>Promise&lt;ExecResult&gt;</code>

### `sandbox.executeStream(command, options)`

Execute a bash command with streaming output (NDJSON).

**Returns:** <code>AsyncGenerator&lt;ExecStreamEvent&gt;</code>

### `sandbox.readFile(path)`

Read a file from the sandbox workspace.

**Returns:** <code>Promise&lt;string&gt;</code>

### `sandbox.writeFiles(files)`

Write files to the sandbox workspace.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.startCommandJob(command, options)`

Start an async command job in the sandbox.

**Returns:** <code>Promise&lt;CommandJob&gt;</code>

### `sandbox.getCommandJob(jobId)`

Get the status of an async command job.

**Returns:** <code>Promise&lt;CommandJob&gt;</code>

### `sandbox.getCommandJobOutput(jobId)`

Get the output of an async command job.

**Returns:** <code>Promise&lt;CommandJobOutput&gt;</code>

### `sandbox.listCommandJobs()`

List all command jobs in the sandbox.

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

| Property | Type | Description |
|----------|------|-------------|
| `apiUrl?` | `string` | Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL, then the Veryfront Cloud API. |
| `authToken?` | `string` | Explicit Veryfront auth token or API key override. |
| `projectId?` | `string` | Optional project context for project-billed / project-scoped sandbox sessions. |

### `ExecResult`

Result of a command execution: stdout, stderr, and exit code.

| Property | Type | Description |
|----------|------|-------------|
| `stdout` | `string` | Buffered standard output from command execution. |
| `stderr` | `string` | Buffered standard error from command execution. |
| `exitCode` | `number` | Process exit code. |

### `ExecStreamEvent`

Streaming event emitted during command execution.

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"stdout" \| "stderr" \| "exit" \| "error"` | Event type (`stdout`, `stderr`, `exit`, `error`). |
| `data?` | `string` | Chunk payload for stdout/stderr/error events. |
| `exitCode?` | `number` | Exit code for `exit` events. |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgentServiceSandboxClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L84) |
| `createAgentServiceSandboxTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L136) |
| `createProjectScopedExecOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L53) |
| `createSandboxShellTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L203) |
| `normalizeBashToolSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L160) |
| `renameSandboxFileTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L168) |
| `resolveDefaultSandboxRuntimeEndpoint` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L52) |
| `unwrapSandboxWorkingDirectoryCommand` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L44) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `LazySandbox` | Lazily provisions sandbox sessions and keeps them alive while in use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L74) |
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/sandbox.ts#L46) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceSandboxClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L22) |
| `AgentServiceSandboxClientOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L31) |
| `AgentServiceSandboxJobClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L15) |
| `AgentServiceSandboxToolsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L33) |
| `AgentServiceSandboxToolsResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L38) |
| `BashToolSandboxLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L24) |
| `CommandJob` | An async command job running in a sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L43) |
| `CommandJobHeartbeatStatus` | Heartbeat health status for a command job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L40) |
| `CommandJobOutput` | A command job with its captured output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L57) |
| `CommandJobStatus` | Status of an async command job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L37) |
| `CreateSandboxBashTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L39) |
| `ExecOptions` | Options for command execution: working directory, timeout, environment variables, and optional project reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L1) |
| `ExecResult` | Result of a command execution: stdout, stderr, and exit code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L23) |
| `ExecStreamEvent` | Streaming event emitted during command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L30) |
| `HostedSandboxClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L177) |
| `HostedSandboxClientOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L178) |
| `HostedSandboxJobClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L176) |
| `HostedSandboxToolsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L179) |
| `HostedSandboxToolsResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L180) |
| `LazySandboxOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L13) |
| `SandboxAttachment` | Known sandbox session connection details used to attach without a lookup round-trip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L91) |
| `SandboxListOptions` | Options for listing sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L74) |
| `SandboxListResult` | Paginated result of sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L80) |
| `SandboxOptions` | Options for creating a sandbox session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L13) |
| `SandboxSession` | A sandbox session summary returned by list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L65) |
| `SandboxShellToolDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L9) |
| `SandboxShellToolSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L22) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `createHostedSandboxClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L182) |
| `createHostedSandboxTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L183) |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Run isolated commands from agent tools/workflows
- [`veryfront/mcp`](./mcp.md): Expose sandbox-backed operations over MCP

User guides:

- [sandbox](../../guides/sandbox.md): Run code in isolated sandbox environments

Architecture:

- [17-sandbox-runtime](../../architecture/17-sandbox-runtime.md): Sandbox runtime architecture
