# Claude Code workflows

This module exposes provider-neutral Claude Code workflow tools, event
publishers, and workspace synchronization. Veryfront core does not import an
agent SDK. Execution is supplied through the `ClaudeCodeAgentRuntime` extension
contract.

## Activate the runtime

Install and explicitly activate the first-party Anthropic implementation:

```ts
import extClaudeCodeAgent from "@veryfront/ext-claude-code-agent";

export default {
  extensions: [extClaudeCodeAgent()],
};
```

Without a registered runtime, `executeAgent()` fails with a missing-extension
error that names the package to install. It does not substitute a mock result or
load an undeclared dependency from core.

The extension is privileged: it can read and write the selected workspace,
spawn Claude Code, read its environment, and access the network. Review that
boundary before enabling it in a deployment.

## Execute an agent

```ts
import { executeAgent } from "veryfront/workflow/claude-code";

const review = await executeAgent("Review src/auth for correctness", {
  mode: "analysis",
  cwd: "/absolute/path/to/project",
  maxTurns: 12,
});

if (!review.success) throw new Error(review.error);
```

Omitting `mode` selects read-only `analysis`. File edits and shell execution
require explicit `mode: "code"`. `bypassPermissions` is not exposed through the
tool schema; it can only be enabled in server-controlled `AgentConfig`.

The model is optional and is never hardcoded by core. When omitted, the runtime
provider selects its configured/default model. `onComplete` is awaited exactly
once after a runtime returns a valid result; callback failures are propagated.

Use `createAgent()` to snapshot reusable defaults:

```ts
import { createAgent } from "veryfront/workflow/claude-code";

const reviewer = createAgent({
  mode: "analysis",
  cwd: "/absolute/path/to/project",
  allowedTools: ["Read", "Grep", "Glob"],
});

const result = await reviewer("Check the workflow state transitions");
```

Per-call overrides cannot elevate a reusable agent into
`bypassPermissions`. They may explicitly disable a server-enabled bypass.

## Workflow tools

`claudeCodeTool` defaults to read-only analysis:

```ts
import { claudeCodeTool } from "veryfront/workflow/claude-code";

const result = await claudeCodeTool.execute({
  task: "Explain the retry policy",
  mode: "analysis",
  maxTurns: 10,
});
```

`createClaudeCodeTool()` creates a tool with validated defaults. The built-in
`codeReviewTool` is read-only; `bugFixTool`, `refactorTool`, and `docsTool`
explicitly opt into code mode because their stated purpose requires edits.
Writable `code` and `custom` executions never inherit the server process
directory. Compose a fixed host-admitted canonical absolute directory with
`createClaudeCodeTool({ cwd: "/absolute/workspace" })`, or pass an absolute
`cwd` in the host-owned tool execution context. Execution fails before the
runtime is invoked when neither boundary supplies one.

## Runtime contract

Extension authors can implement the stable core contract without importing the
Anthropic extension:

```ts
import {
  type ClaudeCodeAgentRuntime,
  ClaudeCodeAgentRuntimeName,
} from "veryfront/workflow/claude-code/runtime";

const runtime: ClaudeCodeAgentRuntime = {
  async execute(task, config) {
    // Delegate to a provider and return a validated ClaudeCodeResult shape.
    return {
      success: true,
      iterations: 1,
      response: `${config.mode}: ${task}`,
      filesModified: [],
      commandsExecuted: [],
      executionTime: 1,
    };
  },
};

ctx.provide(ClaudeCodeAgentRuntimeName, runtime);
```

An unsuccessful result must include an error. Core validates and snapshots
provider results rather than trusting malformed extension output.

## Events and bidirectional control

The module provides several independent event transports:

- `MemoryEventPublisher` for a single process or tests.
- `SSEEventPublisher` for a server-sent-event response.
- `CallbackEventPublisher` and `MultiEventPublisher` for composition.
- `createDistributedEventPublisher()` through the configured distributed
  runtime extension.
- `WebSocketPublisher` and `AgentController` for commands, approvals, input,
  cancellation, and keepalive traffic.

Always close publishers and unsubscribe handlers during request or worker
cleanup. WebSocket sends fail closed when the socket is unavailable; callers
must handle the resulting error instead of assuming delivery.

## Isolated workspace synchronization

`WorkspaceSync` materializes project files into an explicitly selected absolute
base directory. It has no ambient tenant or `/tmp` fallback.

```ts
import { withWorkspace } from "veryfront/workflow/claude-code";

const abortSignal = AbortSignal.timeout(60_000);

await withWorkspace(
  {
    baseDir: "/srv/veryfront/workspaces",
    runId: "run_123",
    source: {
      listAll: ({ maxFiles, abortSignal }) => projectFiles.listBounded({ maxFiles, abortSignal }),
      read: (path, { maxBytes, abortSignal }) =>
        projectFiles.readTextBounded(path, { maxBytes, abortSignal }),
    },
    exclude: ["node_modules/**", ".git/**"],
    maxFiles: 50_000,
    maxEntries: 100_000,
    maxTotalBytes: 64 * 1024 * 1024,
    abortSignal,
  },
  async (workspace) => {
    return await executeAgent("Review this project", {
      mode: "analysis",
      cwd: workspace.workspaceDir,
    });
  },
);
```

Initialization fails and cleans the partial workspace when listing or download
fails. Cleanup errors are propagated (and aggregated with operation failures)
so leaked workspaces are visible to operators.

Source paths are admitted into one `/project/path` form before filtering,
deduplication, reads, or writes. Traversal, NUL bytes, backslashes, dot
segments, repeated separators, non-NFC Unicode, Windows device names and
aliases, forbidden Windows component characters, trailing dots or spaces,
and alternate-data-stream syntax reject the entire snapshot. Exact canonical
duplicates reject before policy selection. Portable case or parent-file
collisions in the selected materialization set also reject before source reads.
Patterns support exact paths, `*.ext`, `prefix/**`, and `**/suffix` only;
unsupported glob forms reject configuration. Paths are limited to 4,096 UTF-8
bytes and 255 UTF-8 bytes per component. Run IDs use one 255-byte portable path
segment. The default ceilings are 50,000 listed files, 100,000
traversed filesystem entries, 10 MiB per file, and 64 MiB of aggregate UTF-8
content. `maxFiles`, `maxEntries`, `maxFileSize`, and `maxTotalBytes` select
deployment-specific positive safe-integer limits. The same ceilings protect
change detection after agent execution. The composed source receives the file
and byte limits before listing or reading and must enforce them before buffering
remote data. Its `listAll` and `read` operations must remain bound to the same
immutable source snapshot for one initialization; core cannot manufacture a
transaction across an integration's remote storage. `include` and `exclude`
apply in both directions: initialization omits matching source files, change
detection prunes excluded directories and ignores output files outside the
selected policy, and every filesystem entry that change detection actually
visits still consumes `maxEntries`. `abortSignal` is propagated to source and
persistence callbacks; integrations must observe it cooperatively. Use
`AbortSignal.timeout(...)` when the operation also needs a deadline.
`uploadChanges()` admits every changed path and settles the aggregate read
budget before invoking persistence callbacks. It verifies that detected file
checksums still match and that deletions remain absent before the first callback.
Compose `onUpload` for created or modified text files and `onDelete` for
deletions; a deletion without an `onDelete` handler is reported as unpersisted
rather than being presented as a successful upload. Persistence is sequential
and non-transactional. Each callback receives a frozen, detached `change` in
its context. The persistence integration must use `type`, `originalChecksum`,
and `newChecksum` to enforce an optimistic-concurrency precondition at its own
storage boundary, reject conflicts, and resolve only after the change commits.
Pass the unmodified output of `detectChanges()` to `uploadChanges()`. Runtime
admission validates paths, duplicates, limits, and file policy, but retains
compatibility with hand-built legacy changes whose checksum shape is
incomplete. Persistence integrations must reject an incomplete change context.
If cancellation is observed after one or more callbacks resolve but before the
next callback starts, `uploadChanges()` throws `WorkspaceUploadAbortError`
(whose error `name` is `AbortError`) with immutable `partialResult` and
`remainingChanges` snapshots. A cancellation triggered by the final resolved
callback still returns full success because no unsettled work remains. Retry
the reported remaining changes for cancellation. Items already listed in
`partialResult.failed` were attempted before cancellation and need separate
reconciliation against the original change list. Make callbacks idempotent.

The workspace directory is exclusively claimed, pinned by real path and native
file identity when available, and rechecked around filesystem operations.
File and persistence operations require a successfully initialized claim.
Cleanup is inert before a claim and after successful cleanup, so it cannot
recursively remove a later directory at the same path. Symlinked roots, parents,
and files are rejected, as are multiply hard-linked files on hosts that expose
link counts. Reads bind the opened handle back to the admitted pathname; writes
publish a completed private file by rename instead of truncating a pathname.

Deno does not currently expose directory-handle-relative no-follow mutation
APIs, so a process that can modify the workspace concurrently retains a narrow
race between the last parent identity check and the filesystem syscall. On a
filesystem that exposes neither stable device/inode identity nor an equivalent,
same-path directory replacement cannot be distinguished reliably. Keep the
admitted base directory writable only by the worker identity; this module does
not claim to be an OS sandbox.
