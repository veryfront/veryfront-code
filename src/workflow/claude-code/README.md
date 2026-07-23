# Claude Code workflow integration

This module runs the Claude Agent SDK from a Veryfront process and exposes the
integration as functions and workflow tools.

> Warning: Use this module only for trusted local execution. The SDK runs with
> the host process working directory, environment, credentials, and operating
> system permissions. `mode`, `tools`, `allowedTools`, and `cwd` configure SDK
> behavior. They do not provide a container, tenant boundary, filesystem
> sandbox, or network sandbox. Run untrusted or multi-tenant work in a separate
> isolated executor.

The module does not accept Claude credentials. The locally loaded Claude Agent
SDK uses the Claude Code authentication and environment available to the host
process.

## How-to guides

### Review a local project

Use `analysis` mode for a read-only review. Restrict the available SDK tools as
an additional policy layer.

```ts
import { executeAgent } from "veryfront/workflow/claude-code";

const result = await executeAgent(
  "Review the TypeScript source for correctness issues. Do not modify files.",
  {
    cwd: Deno.cwd(),
    mode: "analysis",
    tools: ["Read", "Grep", "Glob"],
    maxTurns: 10,
  },
);

if (!result.success) {
  throw new Error("Claude Code review failed");
}

console.log(result.response);
```

`executeAgent` resolves to a `ClaudeCodeResult` for SDK, stream, and
cancellation failures. Inspect `result.success` before using the response.

### Reuse trusted configuration

`createAgent` returns a function with preset configuration. Per-call overrides
can change normal options. They cannot change `bypassPermissions`; only the
trusted defaults passed to `createAgent` control that privilege.

```ts
import { createAgent } from "veryfront/workflow/claude-code";

const review = createAgent({
  cwd: Deno.cwd(),
  mode: "analysis",
  tools: ["Read", "Grep", "Glob"],
  maxTurns: 10,
});

const result = await review("Review src/config for invalid state handling");
if (!result.success) {
  throw new Error("Claude Code review failed");
}
```

### Add Claude Code to a workflow

Pass the exported tool object to a workflow step. A string ID works only when
the host has registered a tool under that ID.

```ts
import { step, workflow } from "veryfront/workflow";
import { codeReviewTool } from "veryfront/workflow/claude-code";

export const localReview = workflow({
  id: "local-review",
  steps: [
    step("review", {
      tool: codeReviewTool,
      input: {
        task: "Review src/config for correctness and security issues",
        files: ["src/config"],
      },
    }),
  ],
});
```

`codeReviewTool` enforces `analysis` mode. Its schema rejects an attempt to set
`mode` to `code` or `custom`.

### Configure available and auto-approved tools

`tools` and `allowedTools` have different SDK meanings:

- `tools` restricts which SDK tools are available to the agent.
- `allowedTools` selects available tools that can run without an interactive
  approval prompt.

Keep `allowedTools` equal to or narrower than `tools`.

```ts
import { createClaudeCodeTool } from "veryfront/workflow/claude-code";

export const readOnlyInspectionTool = createClaudeCodeTool({
  id: "local-read-only-inspection",
  defaultMode: "analysis",
  defaultMaxTurns: 8,
  tools: ["Read", "Grep", "Glob"],
  allowedTools: ["Read", "Grep", "Glob"],
  system: "Inspect the requested code and report evidence. Do not modify files.",
});
```

These options are trusted tool configuration. They are not accepted from the
tool input object.

### Cancel an execution

Pass an `AbortSignal` to `executeAgent`. Workflow tool execution automatically
forwards `ToolExecutionContext.abortSignal` to the SDK.

```ts
import { executeAgent } from "veryfront/workflow/claude-code";

const controller = new AbortController();
const execution = executeAgent("Inspect the current project", {
  cwd: Deno.cwd(),
  mode: "analysis",
  abortSignal: controller.signal,
});

controller.abort();
const result = await execution;
console.log(result.success);
```

### Observe completion

`onComplete` runs exactly once after the SDK execution boundary returns a
result. Execution awaits a synchronous or asynchronous observer. If the
observer throws or rejects, the integration logs a generic observer failure
and returns the original agent result unchanged.

```ts
import { executeAgent } from "veryfront/workflow/claude-code";

const result = await executeAgent("Inspect the current project", {
  cwd: Deno.cwd(),
  mode: "analysis",
  onComplete: async (completed) => {
    await Promise.resolve(completed.success);
  },
});

console.log(result.success);
```

## Reference

### Agent functions

#### `executeAgent(task, config?)`

Runs one SDK query and returns `Promise<ClaudeCodeResult>`.

#### `createAgent(defaults?)`

Returns `(task, overrides?) => Promise<ClaudeCodeResult>`. Per-call
`bypassPermissions` values are ignored. A trusted default value is preserved.

#### `AgentConfig`

| Field                   | Type                               | Behavior                                                                                                        |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `model`                 | `string`                           | SDK model ID. Omit it to use the SDK's configured default.                                                      |
| `mode`                  | `"code" \| "analysis" \| "custom"` | Maps to the SDK permission mode. Defaults to `code`.                                                            |
| `bypassPermissions`     | `boolean`                          | Exact `true` opts into SDK permission bypass and its required dangerous-skip flag. Keep this server-controlled. |
| `maxTurns`              | `number`                           | Integer from 1 through 100. Defaults to 20.                                                                     |
| `maxBudgetUsd`          | `number`                           | Positive finite SDK budget in USD when supplied.                                                                |
| `systemPrompt`          | `string`                           | Replaces the default Claude Code system prompt preset.                                                          |
| `cwd`                   | `string`                           | SDK working directory. Defaults to the process working directory.                                               |
| `tools`                 | `string[]`                         | SDK tools available to the agent.                                                                               |
| `allowedTools`          | `string[]`                         | Available tools that can run without an approval prompt.                                                        |
| `additionalDirectories` | `string[]`                         | Additional directories passed to the SDK.                                                                       |
| `abortSignal`           | `AbortSignal`                      | Cancels the SDK query through its `AbortController`.                                                            |
| `debug`                 | `boolean`                          | Enables metadata-only debug logs. Defaults to `false`.                                                          |
| `onComplete`            | callback                           | Awaited once after execution. Observer failures do not replace the result.                                      |

Permission mappings:

| Veryfront mode | SDK permission mode | Meaning                                                                                        |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `code`         | `acceptEdits`       | The SDK may perform coding work and automatically accept file edits.                           |
| `analysis`     | `plan`              | The SDK uses its read-only planning policy.                                                    |
| `custom`       | `default`           | The SDK uses its default permission behavior. Configure `tools` and `allowedTools` separately. |

An unknown runtime mode fails closed. `bypassPermissions` is not a tool-input
mode and requires an exact trusted `true` value.

### Agent result

`ClaudeCodeResult` contains:

| Field               | Meaning                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `success`           | Whether the SDK emitted a successful result message.                                                            |
| `iterations`        | SDK `num_turns`, or observed assistant turns if no result arrived.                                              |
| `response`          | Successful result text, or observed partial text when the stream ends early or fails.                           |
| `error`             | Bounded, sanitized failure detail or a generic SDK-result fallback.                                             |
| `executionTime`     | Elapsed time in milliseconds.                                                                                   |
| `filesTargeted`     | File paths observed in `Write` or `Edit` tool requests.                                                         |
| `commandsRequested` | Commands observed in `Bash` tool requests.                                                                      |
| `filesModified`     | Deprecated compatibility alias for `filesTargeted`. It does not prove a write completed.                        |
| `commandsExecuted`  | Deprecated compatibility alias for `commandsRequested`. It does not prove a command ran.                        |
| `changes`           | Optional file changes supplied by separate workspace synchronization code. `executeAgent` does not populate it. |

If the SDK stream ends without a result message, `success` is `false` and the
result preserves observed turns, partial text, requested commands, and targeted
files. The integration closes the SDK query before it resolves the result.

### Workflow tools

The module exports these tool values:

| Export           | Default mode | Default turns | Mode policy                              |
| ---------------- | ------------ | ------------- | ---------------------------------------- |
| `claudeCodeTool` | `code`       | 20            | Accepts `code`, `analysis`, or `custom`. |
| `codeReviewTool` | `analysis`   | 10            | Enforces `analysis`.                     |
| `bugFixTool`     | `code`       | 15            | Accepts any supported mode.              |
| `refactorTool`   | `code`       | 20            | Accepts any supported mode.              |
| `docsTool`       | `code`       | 10            | Accepts any supported mode.              |

`createClaudeCodeTool(options?)` creates another schema-backed Veryfront tool.
Its options are `id`, `description`, `defaultMode`, `defaultMaxTurns`, `system`,
`tools`, `allowedTools`, and `debug`. `defaultMaxTurns` must be an integer from
1 through 100.

Every Claude Code workflow tool uses one strict input schema:

| Input      | Type                      | Rules                                                                    |
| ---------- | ------------------------- | ------------------------------------------------------------------------ |
| `task`     | `string`                  | Required and non-empty.                                                  |
| `mode`     | supported mode            | Optional. Uses the tool default unless the tool enforces a mode.         |
| `maxTurns` | `number`                  | Optional integer from 1 through 100.                                     |
| `files`    | `string[]`                | Optional paths appended to the task prompt.                              |
| `context`  | `Record<string, unknown>` | Optional JSON-serializable context appended to the task prompt.          |
| `system`   | `string`                  | Optional per-execution system prompt. Overrides the configured `system`. |

Unknown input fields are rejected. The schema supplies defaults before calling
the SDK and publishes the same defaults and bounds as JSON Schema.

### Event transport exports

The module exports these standalone event transport values:

- `MemoryEventPublisher`
- `RedisEventPublisher`
- `SSEEventPublisher`
- `CallbackEventPublisher`
- `MultiEventPublisher`
- `createEventPublisher`
- `WebSocketPublisher`
- `createWebSocketHandler`
- `AgentController`

It also exports `RedisEventPublisherConfig`, `WebSocketPublisherConfig`, and
the event and command types listed by the package entrypoint.

These transports do not receive events from `executeAgent` automatically.
Callers must publish `ClaudeCodeEvent` values and connect command handling to
their own execution lifecycle.

### Workspace synchronization exports

The module exports `WorkspaceSync`, `createWorkspaceSync`, and `withWorkspace`,
plus `WorkspaceConfig`, `WorkspaceSyncResult`, `UploadResult`, and `FileChange`.
Workspace synchronization is separate from `executeAgent`. Callers must
initialize or wrap a workspace, pass its directory as `cwd`, detect changes,
and configure any upload behavior explicitly.

### Type exports

The package entrypoint exports the core `ClaudeCodeMode`, `ClaudeCodeResult`,
and `ClaudeCodeToolInput` types. It also exports the declared event,
publisher, client command, approval, cancellation, input, ping, pong, text,
thinking, tool-call, completion, and error types from `types.ts`.

## Operational limits

- The integration dynamically loads the pinned Claude Agent SDK dependency at
  execution time. Environments that cannot resolve the dependency return a
  failed result.
- The SDK receives the host working directory and inherits its process-level
  environment behavior. This integration does not scrub environment variables.
- The integration does not override the SDK session-persistence default.
- SDK permission modes and tool lists are application policy, not operating
  system isolation.
- `additionalDirectories` expands SDK access intent. It does not grant or
  revoke host filesystem permissions.
- Event publishers, WebSocket control, and workspace synchronization are
  separate primitives. `executeAgent` does not wire them together.
