# Model-driven tool discovery and on-demand loading

Status: shipped. Implemented as deferred schema loading around `veryfront__tool_search`.

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

One framework-owned model-facing tool, `veryfront__tool_search`, plus a run-local exposure
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
  sees only `veryfront__tool_search` plus the `veryfront__load_skill` bootstrap tool when the run
  authorizes it. `veryfront__form_input` remains authorized but deferred until a search
  loads it. Trusted framework loaders publish one canonical schema; legacy
  selectors are resolved internally and never create a second model-facing
  alias. The runtime identifies the loader by framework provenance, so a
  project tool with a colliding logical name is never bootstrapped. Explicit
  bootstrap overrides and eager bindings retain their declared tools.
  Bootstrap tools remain constrained by the authorized set. The measurement
  below authorizes exactly 64 generated project tools and no skill loader,
  so its initial catalog contains only `veryfront__tool_search`.
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

### `veryfront__tool_search`

Provide exactly one of four mode fields. Every argument is a top-level string or
integer:

- `{"schema":"veryfront__get_agent"}` returns the exact input schema and declared output
  schema of one authorized executable tool and loads it for the next model step.
  The output schema is `null` when the source did not declare one. Use it when the exact
  name is known. The name never matches by substring. Provider-native tools have
  no inspectable schema, so load them with `query`.
- `{"search":"create agent"}` ranks up to five tools by a short capability
  phrase. It returns metadata only and does not load schemas or change exposure.
- `{"inventory":"all","limit":10}` browses executable tool metadata without
  loading schemas or changing exposure. `inventory` is `all` for every authorized
  tool or `platform` for Veryfront platform tools only, excluding integration and
  project tools. Results distinguish `available` and `deferred` tools. Page sizes
  range from 1 to 20, default 10. Descriptions are previews of at most 240
  characters plus an ellipsis. Inventory does not inspect parameter schemas. The
  inventory-only fields `domain` and `resource` match one exact
  `discovery.domain` or `discovery.resource` value and apply before pagination.
  An unknown value returns `invalidFilter` with the advertised values and a
  `restartInput` that browses without filters.

  Pass `nextPageInput` unchanged to browse the next page. A null `nextPageInput`
  means the inventory is complete. `nextCursor` remains for compatibility.
- `{"query":"veryfront__get_agent"}` searches and loads matching authorized executable
  tools. Their input schemas become visible on the next model step.

The `veryfront__tool_search` parameter schema declares no root `oneOf`, `anyOf`, or `allOf`
because some providers reject root combinators. It also has no nested argument
objects: under fine-grained tool streaming, models emitted invalid JSON for
nested mode objects. The runtime rejects calls that provide zero or several mode
fields with an error naming the fields received. It also rejects `domain`,
`resource`, `cursor`, or `limit` without `inventory`.

Inventory and search contain only this run's provider-visible authorized tools,
not project tool definitions. They preserve provider-hidden tool filtering and
execution permissions. A search miss directs the model to browse instead of
repeatedly guessing resource display names. If the catalog changes and a cursor
is outside the current inventory, restart without a cursor.

Tool sources can attach navigation metadata as `discovery`:
`{ version: 1, type: "platform" | "integration", domain?, resource?, subgroup?, operation? }`.
Remote MCP servers advertise it in a tool's `_meta["veryfront/tool-discovery"]`.
Each string is at most 128 characters. Invalid metadata is ignored. Discovery
metadata is navigation only and never grants execution permission.

For queries with three or more terms, a candidate supported only by parameter
descriptions must match at least half the terms. One incidental field description
does not identify a capability. Name and tool-description matches retain their
existing ranking, including integration catalog navigation.

### Bounded reference results

Agents can enable `toolResultContext` to replace oversized tool results with a
preview and a run-local retrieval reference. The runtime exposes `veryfront__get_tool_result`
only after a stored reference exists. Reads use bounded sections; events and
persisted history retain the original result. JSON results can be narrowed with an
RFC 6901 `pointer`, and `view: "structure"` lists one level of child pointer
tokens and types without values. A section's `nextCursor` continues the same
`ref`, `view`, and `pointer` selection.

Root skill instructions remain inline. Advertised reference-file results from
`veryfront__load_skill` follows the configured limits instead of
bypassing them. Loading a reference still requires the parent skill and its
authorized reference path. Result retrieval does not widen file access.

- Schema-free results: `{ name, description, status: "available" | "loaded" }`.
  Input schemas are never returned by a search.
- Searches the run's authorized catalog only, under the same project and
  integration gating as the eager path.
- Deterministic, case-insensitive matching. Underscores are treated as spaces.
  A literal exact name loads only that authorized tool. Capability phrases retain
  broad matching ranked by name, then description and parameter descriptions.
  An already-visible tool wins when it matches more strongly. Equally relevant
  deferred tools still load, so a visible catalog reader does not hide actions.
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

1. **Discovery**: `veryfront__tool_search` searches only the authorized catalog.
2. **Execution**: `prepareExecution` in
   `project-scoped-remote-tools.ts` re-checks remote allowance at call time via
   `isRemoteToolNameAllowed`. Provider-native exposure is intersected with the
   current configured provider tools and selected model support before each
   step. A schema reaching an earlier request is not sufficient to execute.

## Durability and resume

Exposure state is persisted as a private durable checkpoint event,
`AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED`, carrying a versioned
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
measurement against a 64-tool fixture on Anthropic before the canonical-name migration.
The recorded discovery name was `tool_search`; the current public name is
`veryfront__tool_search`. These token counts are historical, not a measurement
of the renamed catalog:

| Metric                 | Value                        |
| ---------------------- | ---------------------------- |
| authorized tools       | 64                           |
| initially exposed      | 1 (historical `tool_search`) |
| baseline input tokens  | 5276                         |
| effective input tokens | 648                          |
| reduction              | 87.7% (threshold 60%)        |

`scripts/verify-tool-search-live.ts` runs the same comparison with the current
canonical tool names. A new capture is required to report current token counts.

## Out of scope

- Sending every schema to every request.
- Bypassing agent, project, integration, or user capability rules.

## Notes for future work

- Deferred mode is conditional on the agent having no explicit binding. A bound
  agent whose binding exceeds the provider cap still takes the eager path.
- An earlier design proposed a separate `search_tools` and `load_tools` pair
  with its own activation events and per-run activated set. It was superseded by
  `veryfront__tool_search`, and its unwired implementation has been removed. The public
  input fields that could still gate a catalog for an external caller
  (`activatedRemoteToolNames`, `toolDiscoveryContext`, `pinnedToolNames`,
  `getActivatedToolNames`) are retained and marked deprecated, because removing
  them would silently widen the catalog for callers that rely on them.

The skill loader keeps its provider schema stable across load states. A repeated
skill body request returns a compact already-loaded marker, including when the
skill has references. The runtime validates skill IDs and authorizes reference
paths before reading files. Repeated body requests do not read or resend the body.
