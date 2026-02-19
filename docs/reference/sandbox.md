---
title: "veryfront/sandbox"
description: "Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments, and re-exports `createBashTool` for AI agent integration."
order: 20
---

# veryfront/sandbox

Sandbox module for ephemeral compute environments. Provides the `Sandbox` class for creating and interacting with isolated execution environments, and re-exports `createBashTool` for AI agent integration.

## Import

```ts
import { Sandbox } from "veryfront/sandbox";
```

## Examples

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create({ authToken: userJwt });
const result = await sandbox.executeCommand("echo hello");
console.log(result.stdout); // "hello\n"
await sandbox.close();
```

### With bash-tool for AI agents:

```ts
import { Sandbox, createBashTool } from "veryfront/sandbox";

const sandbox = await Sandbox.create({ authToken });
const { tools } = await createBashTool({ sandbox });
// Pass tools to agent...
```

## Exports

### Classes

| Name | Description |
|------|-------------|
| `Sandbox` | Client for isolated ephemeral compute environments with command execution and file I/O. |

### Types

| Name | Description |
|------|-------------|
| `ExecResult` | Result of a command execution: stdout, stderr, and exit code. |
| `ExecStreamEvent` | Streaming event emitted during command execution. |
| `SandboxOptions` | Options for creating a sandbox session. |
