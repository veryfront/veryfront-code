---
title: "veryfront/sandbox"
description: "Ephemeral compute environments for isolated execution."
order: 28
---

## Import

```ts
import {
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createProjectScopedExecOptions,
  createSandboxShellTools,
  isSandboxOutputLimitError,
  normalizeBashToolSet,
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

### `Sandbox.create(options)`

Create a new sandbox session. Claims a warm pod or creates a new one.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.get(id, options)`

Reconnect to an existing sandbox session.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.attach(attachment)`

Attach to an already-known sandbox session and endpoint without a reconnect lookup.

**Returns:** `Sandbox`

### `Sandbox.list(options)`

List sandbox sessions with optional pagination.

**Returns:** <code>Promise&lt;SandboxListResult&gt;</code>

### `Sandbox.createLazy(options)`

Create a lazily-provisioned sandbox session with automatic heartbeats.

**Returns:** `LazySandbox`

### `sandbox.executeCommand(command, options)`

Execute a bash command in the sandbox and return buffered stdout/stderr plus the exit code.

**Returns:** <code>Promise&lt;ExecResult&gt;</code>

### `sandbox.executeStream(command, options)`

Execute a bash command in the sandbox and stream newline-delimited JSON (NDJSON) output events as they arrive.

**Returns:** <code>AsyncGenerator&lt;ExecStreamEvent&gt;</code>

### `sandbox.readFile(path)`

Read a file from the sandbox workspace.

**Returns:** <code>Promise&lt;string&gt;</code>

### `sandbox.writeFiles(files)`

Write one or more files to the sandbox workspace.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.startBackgroundCommand(command, options)`

Start an async background command in the sandbox.

**Returns:** <code>Promise&lt;BackgroundCommand&gt;</code>

### `sandbox.getBackgroundCommand(commandId)`

Get the status of an async background command.

**Returns:** <code>Promise&lt;BackgroundCommand&gt;</code>

### `sandbox.getBackgroundCommandOutput(commandId)`

Get the output of an async background command.

**Returns:** <code>Promise&lt;BackgroundCommandOutput&gt;</code>

### `sandbox.listBackgroundCommands()`

List all background commands in the sandbox.

**Returns:** <code>Promise&lt;BackgroundCommand[]&gt;</code>

### `sandbox.cancelBackgroundCommand(commandId)`

Cancel an async background command.

**Returns:** <code>Promise&lt;BackgroundCommand&gt;</code>

### `sandbox.heartbeat()`

Send a heartbeat to keep the sandbox session alive.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.close()`

Close the sandbox session and mark it for deletion.

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

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `apiUrl?` | `string` | Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL and otherwise fails closed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L22) |
| `authToken?` | `string` | Explicit Veryfront auth token or API key override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L24) |
| `projectId?` | `string` | Optional project context for project-billed / project-scoped sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L26) |
| `startupTimeoutMs?` | `number` | Maximum combined readiness time for each session provisioning attempt, in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L28) |
| `pollIntervalMs?` | `number` | Delay between session-readiness checks, in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L30) |
| `controlRequestTimeoutMs?` | `number` | Deadline for each control request and bounded response-body read, in milliseconds. For command streams it covers startup through response headers; stream duration remains governed by timeout_seconds. Zero disables the client deadline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L37) |

### `ExecResult`

Result of a command execution: stdout, stderr, and exit code.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `stdout` | `string` | Buffered standard output from command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L42) |
| `stderr` | `string` | Buffered standard error from command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L43) |
| `exitCode` | `number` | Process exit code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L44) |

### `ExecStreamEvent`

Streaming event emitted during command execution.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `type` | `"stdout" \| "stderr" \| "exit" \| "error"` | Event type (`stdout`, `stderr`, `exit`, `error`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L49) |
| `data?` | `string` | Chunk payload for stdout/stderr/error events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L50) |
| `exitCode?` | `number` | Exit code for `exit` events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L51) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgentServiceSandboxClient` | Create agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L155) |
| `createAgentServiceSandboxTools` | Create agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L202) |
| `createProjectScopedExecOptions` | Options accepted by create project scoped exec. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L69) |
| `createSandboxShellTools` | Create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L474) |
| `isSandboxOutputLimitError` | Whether buffered sandbox command collection exceeded its configured limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/request-payload.ts#L35) |
| `normalizeBashToolSet` | Normalizes bash tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L413) |
| `renameSandboxFileTools` | Rename sandbox file tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L436) |
| `resolveDefaultSandboxRuntimeEndpoint` | Resolves default sandbox runtime endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L124) |
| `unwrapSandboxWorkingDirectoryCommand` | Unwrap sandbox working directory command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L59) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `LazySandbox` | Lazily provisions sandbox sessions and keeps them alive while in use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L162) |
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/sandbox.ts#L76) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceSandboxBackgroundCommandClient` | Public API contract for agent service sandbox background command client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L25) |
| `AgentServiceSandboxClient` | Public API contract for agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L33) |
| `AgentServiceSandboxClientOptions` | Options accepted by agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L43) |
| `AgentServiceSandboxToolsOptions` | Options accepted by agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L46) |
| `AgentServiceSandboxToolsResult` | Result returned from agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L52) |
| `BackgroundCommand` | An async background command running in a sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L61) |
| `BackgroundCommandHeartbeatStatus` | Heartbeat health status for a background command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L58) |
| `BackgroundCommandOutput` | A background command with its captured output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L75) |
| `BackgroundCommandStatus` | Status of an async background command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L55) |
| `BashToolSandboxLike` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L30) |
| `CreateSandboxBashTool` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L47) |
| `ExecOptions` | Options for command execution: working directory, timeout, environment variables, and optional project reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L2) |
| `ExecResult` | Result of a command execution: stdout, stderr, and exit code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L41) |
| `ExecStreamEvent` | Streaming event emitted during command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L48) |
| `HostedSandboxBackgroundCommandClient` | Public API contract for hosted sandbox background command client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L243) |
| `HostedSandboxClient` | Public API contract for hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L245) |
| `HostedSandboxClientOptions` | Options accepted by hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L247) |
| `HostedSandboxToolsOptions` | Options accepted by hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L249) |
| `HostedSandboxToolsResult` | Result returned from hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L251) |
| `LazySandboxOptions` | Options accepted by lazy sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L48) |
| `SandboxAttachment` | Known sandbox session connection details used to attach without a lookup round-trip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L109) |
| `SandboxListOptions` | Options for listing sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L92) |
| `SandboxListResult` | Paginated result of sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L98) |
| `SandboxOptions` | Options for creating a sandbox session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L20) |
| `SandboxSession` | A sandbox session summary returned by list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L83) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L13) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L27) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `createHostedSandboxClient` | Create hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L254) |
| `createHostedSandboxTools` | Create hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L256) |
