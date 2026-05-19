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
| `createAgentServiceSandboxClient` | Create agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L92) |
| `createAgentServiceSandboxTools` | Create agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L145) |
| `createProjectScopedExecOptions` | Options accepted by create project scoped exec. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L60) |
| `createSandboxShellTools` | Create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L206) |
| `normalizeBashToolSet` | Normalizes bash tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L161) |
| `renameSandboxFileTools` | Rename sandbox file tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L170) |
| `resolveDefaultSandboxRuntimeEndpoint` | Resolves default sandbox runtime endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L54) |
| `unwrapSandboxWorkingDirectoryCommand` | Unwrap sandbox working directory command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L50) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `LazySandbox` | Lazily provisions sandbox sessions and keeps them alive while in use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L76) |
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/sandbox.ts#L46) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceSandboxClient` | Public API contract for agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L24) |
| `AgentServiceSandboxClientOptions` | Options accepted by agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L34) |
| `AgentServiceSandboxJobClient` | Public API contract for agent service sandbox job client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L16) |
| `AgentServiceSandboxToolsOptions` | Options accepted by agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L37) |
| `AgentServiceSandboxToolsResult` | Result returned from agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L43) |
| `BashToolSandboxLike` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L29) |
| `CommandJob` | An async command job running in a sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L43) |
| `CommandJobHeartbeatStatus` | Heartbeat health status for a command job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L40) |
| `CommandJobOutput` | A command job with its captured output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L57) |
| `CommandJobStatus` | Status of an async command job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L37) |
| `CreateSandboxBashTool` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L46) |
| `ExecOptions` | Options for command execution: working directory, timeout, environment variables, and optional project reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L1) |
| `ExecResult` | Result of a command execution: stdout, stderr, and exit code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L23) |
| `ExecStreamEvent` | Streaming event emitted during command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L30) |
| `HostedSandboxClient` | Public API contract for hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L188) |
| `HostedSandboxClientOptions` | Options accepted by hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L190) |
| `HostedSandboxJobClient` | Public API contract for hosted sandbox job client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L186) |
| `HostedSandboxToolsOptions` | Options accepted by hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L192) |
| `HostedSandboxToolsResult` | Result returned from hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L194) |
| `LazySandboxOptions` | Options accepted by lazy sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L14) |
| `SandboxAttachment` | Known sandbox session connection details used to attach without a lookup round-trip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L91) |
| `SandboxListOptions` | Options for listing sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L74) |
| `SandboxListResult` | Paginated result of sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L80) |
| `SandboxOptions` | Options for creating a sandbox session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L13) |
| `SandboxSession` | A sandbox session summary returned by list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L65) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L26) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `createHostedSandboxClient` | Create hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L197) |
| `createHostedSandboxTools` | Create hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L199) |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Run isolated commands from agent tools/workflows
- [`veryfront/mcp`](./mcp.md): Expose sandbox-backed operations over MCP

User guides:

- [sandbox](../../guides/sandbox.md): Run code in isolated sandbox environments

Architecture:

- [17-sandbox-runtime](../../architecture/17-sandbox-runtime.md): Sandbox runtime architecture
