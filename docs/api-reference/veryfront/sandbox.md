---
title: "veryfront/sandbox"
description: "Ephemeral compute environments for isolated execution."
order: 27
---

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
try {
  const result = await sandbox.executeCommand("echo hello");
  console.log(result.stdout); // "hello\n"
} finally {
  await sandbox.close();
}
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

Send a heartbeat to prevent idle timeout.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.close()`

Close the sandbox session. A successfully closed client cannot be reused.

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
| `apiUrl?` | `string` | Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL and is otherwise required. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L16) |
| `authToken?` | `string` | Veryfront auth token or API key. Defaults to request-scoped or host credentials. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L18) |
| `projectId?` | `string` | Optional project context for project-billed / project-scoped sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L20) |

### `ExecResult`

Result of a command execution: stdout, stderr, and exit code.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `stdout` | `string` | Text written to standard output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L26) |
| `stderr` | `string` | Text written to standard error, including execution error events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L28) |
| `exitCode` | `number` | Process exit code, or 1 when the stream did not report one. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L30) |

### `ExecStreamEvent`

Streaming event emitted during command execution.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `type` | `"stdout" \| "stderr" \| "exit" \| "error"` | Event kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L36) |
| `data?` | `string` | Text associated with an output or error event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L38) |
| `exitCode?` | `number` | Process exit code associated with an exit event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L40) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgentServiceSandboxClient` | Create agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L137) |
| `createAgentServiceSandboxTools` | Create agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L196) |
| `createProjectScopedExecOptions` | Options accepted by create project scoped exec. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L93) |
| `createSandboxShellTools` | Create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L389) |
| `normalizeBashToolSet` | Normalizes bash tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L327) |
| `renameSandboxFileTools` | Rename sandbox file tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts#L346) |
| `resolveDefaultSandboxRuntimeEndpoint` | Resolve a public Veryfront sandbox endpoint to its Kubernetes service when in-cluster. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L120) |
| `unwrapSandboxWorkingDirectoryCommand` | Unwrap sandbox working directory command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L83) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `LazySandbox` | Lazily provisions sandbox sessions and keeps them alive while in use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L142) |
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/sandbox.ts#L69) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentServiceSandboxBackgroundCommandClient` | Public API contract for agent service sandbox background command client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L35) |
| `AgentServiceSandboxClient` | Public API contract for agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L47) |
| `AgentServiceSandboxClientOptions` | Options accepted by agent service sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L64) |
| `AgentServiceSandboxToolsOptions` | Options accepted by agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L67) |
| `AgentServiceSandboxToolsResult` | Result returned from agent service sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L73) |
| `BackgroundCommand` | An async background command running in a sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L50) |
| `BackgroundCommandHeartbeatStatus` | Heartbeat health status for a background command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L47) |
| `BackgroundCommandOutput` | A background command with its captured output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L74) |
| `BackgroundCommandStatus` | Status of an async background command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L44) |
| `BashToolSandboxLike` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L81) |
| `CreateSandboxBashTool` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L98) |
| `CreateSandboxShellToolsInput` | Input payload for create sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L89) |
| `ExecOptions` | Options for command execution: working directory, timeout, environment variables, and optional project reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L2) |
| `ExecResult` | Result of a command execution: stdout, stderr, and exit code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L24) |
| `ExecStreamEvent` | Streaming event emitted during command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L34) |
| `HostedSandboxBackgroundCommandClient` | Public API contract for hosted sandbox background command client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L261) |
| `HostedSandboxClient` | Public API contract for hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L263) |
| `HostedSandboxClientOptions` | Options accepted by hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L265) |
| `HostedSandboxToolsOptions` | Options accepted by hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L267) |
| `HostedSandboxToolsResult` | Result returned from hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L269) |
| `LazySandboxOptions` | Options accepted by lazy sandbox. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts#L43) |
| `SandboxAttachment` | Known sandbox session connection details used to attach without a lookup round-trip. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L121) |
| `SandboxListOptions` | Options for listing sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L100) |
| `SandboxListResult` | Paginated result of sandbox sessions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L108) |
| `SandboxOptions` | Options for creating a sandbox session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L14) |
| `SandboxSession` | A sandbox session summary returned by list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts#L86) |
| `SandboxShellClient` | Public API contract for sandbox shell client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L81) |
| `SandboxShellToolAnnotations` | Behavioral hints exposed to MCP clients for a sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L36) |
| `SandboxShellToolDefinition` | Definition for sandbox shell tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L64) |
| `SandboxShellToolExecute` | Public API contract for sandbox shell tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L28) |
| `SandboxShellToolExecutionContext` | Execution context accepted by sandbox shell tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L20) |
| `SandboxShellToolJsonSchema` | JSON Schema object with typed common keywords and support for draft-specific or vendor-defined keywords. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L24) |
| `SandboxShellToolJsonSchemaTypeName` | Primitive type names accepted by JSON Schema's `type` keyword. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L11) |
| `SandboxShellToolMcpConfig` | MCP metadata accepted on a sandbox shell tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L48) |
| `SandboxShellToolSet` | Public API contract for sandbox shell tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L78) |
| `SandboxShellToolsProvider` | Public API contract for sandbox shell tools provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L98) |
| `SandboxShellToolType` | Tool type values accepted by sandbox shell tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts#L12) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `createHostedSandboxClient` | Create hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L272) |
| `createHostedSandboxTools` | Create hosted sandbox tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts#L275) |
