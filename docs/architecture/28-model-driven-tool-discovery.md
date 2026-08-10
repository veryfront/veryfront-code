# Model-driven tool discovery and on-demand loading

Status: shipped. Implemented as deferred schema loading around `tool_search`.

## Responsibility

Let an agent run reach any authorized tool without carrying every tool schema in
the initial model request, and without a tool silently disappearing because of a
provider cap.

## Problem this solved

`prepareHostedChatRuntimeToolAssembly` used to union local, remote (MCP), and
provider-native tool names, sort them alphabetically, and cap the list with
`selectProviderCompatibleToolNames` (OpenAI: `OPENAI_MAX_TOOLS = 128`). Local
tools were pinned; the remaining budget filled with remote tools in
alphabetical order. With a catalog larger than the cap, every remote tool past
the cut line vanished deterministically: reads early in the alphabet survived,
later writes disappeared.

`docs/architecture/21-agent-tool-registration-current-state.md` records the
related registration-surface gaps.

## Design as shipped

One framework-owned model-facing tool, `tool_search`, plus a run-local exposure
state. There is no separate activation call: a search loads the matching schemas
for the next step.

The contract lives in `src/agent/runtime/tool-exposure.ts`.

### Loading mode

`prepareHostedChatRuntimeToolAssembly` resolves a `RuntimeToolLoadingMode` from
`input.allowedToolNames`: an explicit `null` (no binding) selects `deferred`, and
any set selects `eager`. The mode selection is a source excerpt, not a copyable
example. Read it in
[`chat-runtime-tool-assembly.ts`](../../src/agent/hosted/chat-runtime-tool-assembly.ts).

- **deferred**: the agent has no explicit `tools` binding. The model initially
  sees only `tool_search` plus the `load_skill` bootstrap tool when the run
  authorizes it. `form_input` remains authorized but deferred until a search
  loads it. Bootstrap tools are filtered against the authorized set, so a run
  that does not authorize `load_skill` exposes `tool_search` alone. That is why
  the measurement below reports one initially exposed tool. Its deterministic
  fixture authorizes exactly 64 generated tools and does not authorize
  `load_skill`.
- **eager**: the agent declares a binding. The bound set is exposed directly and
  `selectProviderCompatibleToolNames` still applies, so a binding larger than
  the provider cap is still truncated in alphabetical order after local tools
  are pinned. Bindings are normally well under the cap, but nothing enforces
  that. The guarantee below is specific to deferred mode.

### Why the cap no longer truncates

In deferred mode the authorization catalog is not passed through the provider
cap:

```ts
const availableToolNames = toolLoadingMode === "deferred"
  ? authorizedToolNames
  : selectProviderCompatibleToolNames(authorizedToolNames, { ... });
```

`compatibleRemoteToolNames` likewise keeps the full remote set in deferred mode.
The cap governs what is visible to the model on a given step, never what is
searchable or executable. Alphabetical position stops being a selection
mechanism.

### `tool_search`

- Schema-free results: `{ name, description, status: "available" | "loaded" }`.
  Input schemas are never returned by a search.
- Searches the run's authorized catalog only, under the same project and
  integration gating as the eager path.
- Deterministic, case-insensitive matching. Underscores are treated as spaces.
  Ranking: exact name, then name substring, then description substring.
- Bounded on every axis: query bytes, candidate count, per-schema depth, node
  count and byte size, and total loaded schema budget. See the `TOOL_SEARCH_*`
  constants in `tool-exposure.ts`.
- Matching schemas are loaded into `ToolExposureState.loadedToolNames` and are
  callable from the next model step.
- Configured provider-native tools supported by the selected model enter the
  authorized catalog as schema-free name and description records. A matching
  search attaches the provider's native schema on the next model step. The
  runtime never treats that record as a local executable tool.

## Authorization: two independent gates

1. **Discovery**: `tool_search` searches only the authorized catalog.
2. **Execution**: `prepareExecution` in
   `project-scoped-remote-tools.ts` re-checks remote allowance at call time via
   `isRemoteToolNameAllowed`. Provider-native exposure is intersected with the
   current configured provider tools and selected model support before each
   step. A schema reaching an earlier request is not sufficient to execute.

## Durability and resume

Exposure state is persisted as a private durable checkpoint event,
`AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT`, carrying a versioned
`ToolExposureCheckpoint`. `restoreToolExposureState` rehydrates it, so a resumed
run keeps the schemas it had already loaded instead of starting from an empty
set. Restoration returns exposure, not authorization: execution still re-checks
`isRemoteToolNameAllowed`, so a tool whose permissions changed between steps
becomes unavailable at call time even though its schema was restored.

The checkpoint is versioned: v1 names were lexicographically sorted, v2
preserves oldest-to-newest recency.

Exposure state is run-local by construction. `ToolExposureState` is created per
child run and lives outside any project-scoped registry, so a loaded set cannot
leak across runs.

## Measured effect

`docs/evidence/deferred-tool-discovery-hi-anthropic.json`, a committed live
measurement against a 64-tool fixture on Anthropic:

| Metric                 | Value                 |
| ---------------------- | --------------------- |
| authorized tools       | 64                    |
| initially exposed      | 1 (`tool_search`)     |
| baseline input tokens  | 5276                  |
| effective input tokens | 648                   |
| reduction              | 87.7% (threshold 60%) |

`scripts/verify-tool-search-live.ts` reproduces the measurement.

## Out of scope

- Sending every schema to every request.
- Bypassing agent, project, integration, or user capability rules.

## Notes for future work

- Deferred mode is conditional on the agent having no explicit binding. A bound
  agent whose binding exceeds the provider cap still takes the eager path.
- An earlier design proposed a separate `search_tools` and `load_tools` pair
  with its own activation events and per-run activated set. It was superseded by
  `tool_search`, and its unwired implementation has been removed. The public
  input fields that could still gate a catalog for an external caller
  (`activatedRemoteToolNames`, `toolDiscoveryContext`, `pinnedToolNames`,
  `getActivatedToolNames`) are retained and marked deprecated, because removing
  them would silently widen the catalog for callers that rely on them.
