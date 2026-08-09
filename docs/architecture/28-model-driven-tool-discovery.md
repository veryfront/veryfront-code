# 28 — Model-Driven Tool Discovery and On-Demand Loading

Status: shipped. Implemented as deferred schema loading around `tool_search`.

## Responsibility

Let an agent run reach any authorized tool without carrying every tool schema in
the initial model request, and without a tool silently disappearing because of a
provider cap.

## Problem this solved

`prepareHostedChatRuntimeToolAssembly` used to union local, remote (MCP), and
provider-native tool names, sort them alphabetically, and cap the list with
`selectProviderCompatibleToolNames` (OpenAI: `OPENAI_MAX_TOOLS = 128`). Local
tools were pinned; the remaining budget filled with remote tools **in
alphabetical order**. With a catalog larger than the cap, every remote tool past
the cut line vanished deterministically — reads early in the alphabet survived,
later writes disappeared.

`docs/architecture/21-agent-tool-registration-current-state.md` records the
related registration-surface gaps.

## Design as shipped

One framework-owned model-facing tool, `tool_search`, plus a run-local exposure
state. There is no separate activation call: a search loads the matching schemas
for the next step.

The contract lives in `src/agent/runtime/tool-exposure.ts`.

### Loading mode

`prepareHostedChatRuntimeToolAssembly` resolves a `RuntimeToolLoadingMode`:

```ts
const toolLoadingMode: RuntimeToolLoadingMode = input.allowedToolNames === null
  ? "deferred"
  : "eager";
```

- **deferred** — the agent has no explicit `tools` binding. The model initially
  sees only the bootstrap tools (`form_input`, `load_skill`) plus `tool_search`.
- **eager** — the agent declares a binding. The bound set is exposed directly and
  `selectProviderCompatibleToolNames` still applies. A binding is small by
  construction and is honoured before the cut.

### Why the cap no longer truncates

In deferred mode the authorization catalog is **not** passed through the provider
cap:

```ts
const availableToolNames = toolLoadingMode === "deferred"
  ? authorizedToolNames
  : selectProviderCompatibleToolNames(authorizedToolNames, { ... });
```

`compatibleRemoteToolNames` likewise keeps the full remote set in deferred mode.
The cap governs what is *visible* to the model on a given step, never what is
searchable or executable. Alphabetical position stops being a selection
mechanism.

### `tool_search`

- Schema-free results: `{ name, description, status: "available" | "loaded" }`.
  Input schemas are never returned by a search.
- Searches the run's authorized catalog only, under the same project and
  integration gating as the eager path.
- Deterministic, case-insensitive matching. Underscores are treated as spaces.
  Ranking: exact name, then name substring, then description substring.
- Bounded on every axis — query bytes, candidate count, per-schema depth, node
  count and byte size, and total loaded schema budget. See the
  `TOOL_SEARCH_*` constants in `tool-exposure.ts`.
- Matching schemas are loaded into `ToolExposureState.loadedToolNames` and are
  callable from the next model step.

## Authorization: two independent gates

1. **Discovery** — `tool_search` searches only the authorized catalog.
2. **Execution** — unchanged. `prepareExecution` in
   `project-scoped-remote-tools.ts` re-checks allowance at call time via
   `isRemoteToolNameAllowed`, so a schema reaching a request is not sufficient
   to execute.

## Durability and resume

Exposure state is persisted as a private durable checkpoint event,
`AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT`, carrying a versioned
`ToolExposureCheckpoint`. `restoreToolExposureState` rehydrates it, so a resumed
run keeps the tools it had already loaded and never silently downgrades
capability mid-conversation.

The checkpoint is versioned: v1 names were lexicographically sorted, v2
preserves oldest-to-newest recency.

Exposure state is run-local by construction — `ToolExposureState` is created per
child run and lives outside any project-scoped registry, so a loaded set cannot
leak across runs.

## Measured effect

`docs/evidence/deferred-tool-discovery-hi-anthropic.json`, a committed live
measurement against a 64-tool fixture on Anthropic:

| | value |
| --- | --- |
| authorized tools | 64 |
| initially exposed | 1 (`tool_search`) |
| baseline input tokens | 5276 |
| effective input tokens | 648 |
| reduction | 87.7% (threshold 60%) |

`scripts/verify-tool-search-live.ts` reproduces the measurement.

## Out of scope

- Sending every schema to every request.
- Bypassing agent, project, integration, or user capability rules.

## Notes for future work

- Deferred mode is conditional on the agent having no explicit binding. A bound
  agent whose binding exceeds the provider cap still takes the eager path.
- An earlier design in this document proposed a separate `search_tools` /
  `load_tools` pair with its own activation events and per-run activated set.
  It was superseded by `tool_search` and its unwired code has been removed.
