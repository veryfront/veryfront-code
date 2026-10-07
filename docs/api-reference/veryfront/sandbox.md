---
title: "veryfront/sandbox"
description: "Isolated workspaces for commands and files."
order: 33
---

## Import

```ts
import {
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createSandboxShellTools,
  normalizeBashToolSet,
  renameSandboxFileTools,
  resolveDefaultSandboxRuntimeEndpoint,
} from "veryfront/sandbox";
```

## Examples

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();
const result = await sandbox.runCommand("echo hello");
console.log(result.stdout); // "hello\n"
await sandbox.close();
```

## API

### `Sandbox.create()`

Create an isolated sandbox workspace.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.get(id, )`

Reconnect to an existing sandbox session.

**Returns:** <code>Promise&lt;Sandbox&gt;</code>

### `Sandbox.attach(attachment)`

Attach to an existing sandbox. Closing detaches; use delete() to remove it.

**Returns:** `Sandbox`

### `Sandbox.capabilities()`

Get sandbox capabilities, limits and defaults for the current caller.

**Returns:** <code>Promise&lt;SandboxCapabilities&gt;</code>

### `sandbox.checkHealth()`

Check runtime health without recording activity.

**Returns:** <code>Promise&lt;SandboxRuntimeCheck&gt;</code>

### `sandbox.checkReadiness()`

Check command readiness without recording activity.

**Returns:** <code>Promise&lt;SandboxRuntimeCheck&gt;</code>

### `sandbox.getEnvironment()`

Get environment variable names with redacted values.

**Returns:** <code>Promise&lt;SandboxEnvironment&gt;</code>

### `sandbox.listFiles()`

Read one directory page. Supply pageInfo.next as cursor for another page.

**Returns:** <code>Promise&lt;SandboxFileListResult&gt;</code>

### `sandbox.updateLifetime(input)`

Update cleanup policy without changing access or storage.

**Returns:** <code>Promise&lt;SandboxDetails&gt;</code>

### `Sandbox.list()`

List sandboxes with optional pagination.

**Returns:** <code>Promise&lt;SandboxListResult&gt;</code>

### `Sandbox.createLazy()`

Create a client that provisions its sandbox when first used.

**Returns:** `LazySandbox`

### `sandbox.runCommand(command, options)`

Execute a bash command in the sandbox and return buffered stdout/stderr plus the exit code.

**Returns:** <code>Promise&lt;CommandResult&gt;</code>

### `sandbox.streamCommand(command, options)`

Execute a bash command in the sandbox and stream newline-delimited JSON (NDJSON) output events as they arrive.

**Returns:** <code>AsyncGenerator&lt;CommandStreamEvent&gt;</code>

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

Record activity for idle cleanup. Fixed expiry does not change.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.close()`

Close the client. Existing and persistent sandboxes remain; temporary sandboxes created by this client are deleted.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.delete()`

Delete the sandbox and its workspace files.

**Returns:** <code>Promise&lt;void&gt;</code>

### `sandbox.id`

Get the sandbox ID.

**Returns:** `string`

### `sandbox.url`

Get the sandbox endpoint URL.

**Returns:** `string`

## Type Reference

### `SandboxOptions`

Options for creating a sandbox.

| Property            | Type                  | Description                                                                                 | Source                                                                               |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apiUrl?`           | `string`              | Base URL of the Veryfront API. Defaults to VERYFRONT_API_URL, then the Veryfront Cloud API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `authToken?`        | `string`              | Explicit Veryfront auth token or API key override.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `projectReference?` | `string`              | Project UUID or slug used for billing.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `accessScope?`      | `SandboxAccessScope`  | Project access or creator-only access. Defaults to project.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `ttlMode?`          | `SandboxLifetimeMode` | Cleanup policy. Defaults to default.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `ttlHours?`         | `number`              | Required only for duration cleanup.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `environmentId?`    | `string`              | Environment whose variables are copied once.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |

### `CommandResult`

Result of a command execution: stdout, stderr, and exit code.

| Property   | Type     | Description                                      | Source                                                                               |
| ---------- | -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `stdout`   | `string` | Buffered standard output from command execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `stderr`   | `string` | Buffered standard error from command execution.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `exitCode` | `number` | Process exit code.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |

### `CommandStreamEvent`

Streaming event emitted during command execution.

| Property    | Type                                        | Description                                       | Source                                                                               |
| ----------- | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `type`      | `"stdout" \| "stderr" \| "exit" \| "error"` | Event type (`stdout`, `stderr`, `exit`, `error`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `data?`     | `string`                                    | Chunk payload for stdout/stderr/error events.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |
| `exitCode?` | `number`                                    | Exit code for `exit` events.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts) |

## Exports

### Functions

| Name                                   | Description                                | Source                                                                                             |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `createAgentServiceSandboxClient`      | Create agent service sandbox client.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts) |
| `createAgentServiceSandboxTools`       | Create agent service sandbox tools.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts) |
| `createSandboxShellTools`              | Create sandbox shell tools.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts)         |
| `normalizeBashToolSet`                 | Normalizes bash tool set.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts)         |
| `renameSandboxFileTools`               | Rename sandbox file tools.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/shell-tools.ts)         |
| `resolveDefaultSandboxRuntimeEndpoint` | Resolves default sandbox runtime endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts)        |
| `unwrapSandboxWorkingDirectoryCommand` | Unwrap sandbox working directory command.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts) |

### Classes

| Name          | Description                                                                             | Source                                                                                      |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `LazySandbox` | Provisions a sandbox when first used and records activity while the client is active.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts) |
| `Sandbox`     | Client for isolated ephemeral compute environments with command execution and file I/O. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/sandbox.ts)      |

### Types

| Name                                         | Description                                                                           | Source                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `AgentServiceSandboxBackgroundCommandClient` | Public API contract for agent service sandbox background command client.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `AgentServiceSandboxClient`                  | Public API contract for agent service sandbox client.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `AgentServiceSandboxClientOptions`           | Options accepted by agent service sandbox client.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `AgentServiceSandboxToolsOptions`            | Options accepted by agent service sandbox tools.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `AgentServiceSandboxToolsResult`             | Result returned from agent service sandbox tools.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `BackgroundCommand`                          | An async background command running in a sandbox.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `BackgroundCommandHeartbeatStatus`           | Heartbeat health status for a background command.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `BackgroundCommandOutput`                    | A background command with its captured output.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `BackgroundCommandStatus`                    | Status of an async background command.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `BashToolSandboxLike`                        | Public API contract for sandbox shell client.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `CommandOptions`                             | Options for command execution: working directory, timeout, environment variables.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `CommandResult`                              | Result of a command execution: stdout, stderr, and exit code.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `CommandStreamEvent`                         | Streaming event emitted during command execution.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `CreateSandboxBashTool`                      | Public API contract for sandbox shell tools provider.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `HostedSandboxBackgroundCommandClient`       | Public API contract for hosted sandbox background command client.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `HostedSandboxClient`                        | Public API contract for hosted sandbox client.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `HostedSandboxClientOptions`                 | Options accepted by hosted sandbox client.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `HostedSandboxToolsOptions`                  | Options accepted by hosted sandbox tools.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `HostedSandboxToolsResult`                   | Result returned from hosted sandbox tools.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts)    |
| `LazySandboxOptions`                         | Options accepted by lazy sandbox.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/lazy-sandbox.ts)           |
| `SandboxAccessScope`                         | Sandbox access, storage and lifetime policies.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxAttachment`                          | Known sandbox connection details used to attach without a lookup round-trip.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxCapabilities`                        | Sandbox creation capabilities, limits and defaults for the current caller.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxClientOptions`                       |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxDetails`                             | A sandbox summary returned by list.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxEnvironment`                         | Snapshot of environment variable names with redacted values.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxFileEntry`                           | Directory entry metadata, without file contents.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxFileListOptions`                     | Directory listing options.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxFileListResult`                      | One directory page. Follow pageInfo.next to request another page.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxLifetimeInput`                       | Sandbox cleanup policy. Duration requires hours; other policies accept no duration.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxLifetimeMode`                        |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxListOptions`                         | Options for listing sandboxes.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxListResult`                          | Paginated result of sandboxes.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxOptions`                             | Options for creating a sandbox.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxRuntimeCheck`                        | Runtime health or readiness result. A false check is a result, not a transport error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxShellToolDefinition`                 | Definition for sandbox shell tool.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxShellToolSet`                        | Public API contract for sandbox shell tool set.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/sandbox/shell-tools.ts) |
| `SandboxStatus`                              | Observed sandbox runtime state.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |
| `SandboxWorkspaceStorage`                    |                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/types.ts)                  |

### Constants

| Name                        | Description                   | Source                                                                                             |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `createHostedSandboxClient` | Create hosted sandbox client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts) |
| `createHostedSandboxTools`  | Create hosted sandbox tools.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/sandbox/agent-service-tools.ts) |
