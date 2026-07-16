# 28 — Model-Driven Tool Discovery and On-Demand Loading

Status: design accepted, implementation in progress (veryfront-studio#5916).

## Responsibility

Let an agent run discover authorized MCP capabilities and activate a small,
task-relevant subset mid-run, so the initial model request never has to carry
every tool schema and no tool silently disappears because of provider caps.

## Problem (current state)

`prepareHostedChatRuntimeToolAssembly` unions local, remote (MCP), and
provider-native tool names, sorts them alphabetically, and caps the list with
`selectProviderCompatibleToolNames` (OpenAI: `OPENAI_MAX_TOOLS = 128`). Local
tools are pinned via `requiredToolNames`; the remaining budget fills with
remote tools **in alphabetical order**. With ~253 discovered MCP tools, every
remote tool past the cut line vanishes deterministically — reads early in the
alphabet survive, later writes (`update_agent`) disappear. This produced the
partial-update incident in veryfront-studio#5906.

`docs/architecture/21-agent-tool-registration-current-state.md` already flags
the underlying gaps: tool filtering "should be a named policy, not a loose
string array", and list handling should be explicit and bounded.

## Design

Two new host tools, siblings of `load_skill` in ergonomics and authorization
posture:

### `search_tools` — metadata search, side-effect-free

- Input: `{ query?: string, names?: string[], limit?: number }`. `names` is an
  exact-name lookup; `query` is keyword search over name + description.
- Output per result: `{ name, description, source, state }` where `state` is
  `active | available | requires_grant`. **No input schemas** are returned.
- Search space: the run's *authorized* catalog only — the same
  project/integration gating as `filterProjectScopedRemoteToolDefinitions`.
  Hard-unauthorized tools are invisible; grant-recoverable tools surface as
  `requires_grant` so the model can tell the user what to connect instead of
  concluding the capability does not exist.

### `load_tools` — activation, capability change

- Input: `{ names: string[] }`. No prior `search_tools` call is required —
  when the model already knows the tool name (from the prompt, a skill
  procedure, or an earlier run) activation is a single round-trip.
- Validates every name against the authorized catalog. Unknown or
  unauthorized names fail the whole call with a per-name reason — no partial
  activation, mirroring the atomicity lesson of veryfront-studio#5906.
- **Refuse, never evict**: if activation would exceed the resolved provider
  budget (`getProviderToolProfile(model).maxTools` minus pinned tools), the
  call fails with the exact overflow count. Core/bound tools are never
  evictable; there is no LRU. Deterministic refusal is debuggable; silent
  eviction reintroduces the disappearing-tool bug class.
- On success the activated names join the run's activated set and the
  response instructs the model that the tools are callable from the next step.

## How activation reaches the model (per-step flow)

1. The activated set lives on the per-run runtime context — the same bag as
   `RuntimeLoadSkillToolContext.loadedSkillResponses` — never in
   `ProjectScopedRegistryManager` (that is project-scoped; activation is
   run-scoped by definition, which also satisfies the no-leak criterion).
2. `prepareHostedChildForkRuntimeStepMessages` already rebuilds instructions
   every step; `withRuntimeToolInventory` is idempotent by design. The step
   preparation reads `pinned ∪ activated` from the live run context instead of
   a fixed `forkToolNames`, so the next model step sees the refreshed
   inventory and the new tool schemas.
3. Assembly changes in `prepareHostedChatRuntimeToolAssembly`: remote names no
   longer flood the union. Initial inventory = local/configured tools +
   provider-native + `search_tools`/`load_tools` (added to the essential set
   in `runtime-essential-tools.ts`, so they are never truncated). The
   alphabetical `.sort()` before capping remains only as a stable tiebreak for
   already-selected names, never as a selection mechanism.

## Authorization: three independent gates

1. **Discovery** — `search_tools` searches only the authorized catalog.
2. **Activation** — `load_tools` re-validates names against the catalog.
3. **Execution** — unchanged: `prepareExecution` in
   `project-scoped-remote-tools.ts` re-checks allowance at call time. The
   activated set feeds `isRemoteToolNameAllowed`, so a tool that was never
   activated cannot execute even if a schema leaks into a request.

## Durability and resume

Activation is persisted as a `CUSTOM` conversation run event
(`encodeCustomDataEvent`) with payload `{ kind: "tools_activated", names }`
(and `tools_activation_rejected` with reasons for diagnostics). Resume replays
the event stream, so a resumed run rehydrates its activated set — resumption
never silently downgrades capability. Studio renders these events to explain
why a tool appeared or was refused.

## Out of scope (unchanged from the issue)

- Sending every MCP schema to every request.
- Replacing the curated static binding that mitigates #5906 today — it
  becomes the *initial* inventory rather than the *only* inventory.
- Bypassing agent, project, integration, or user capability rules.

## Risks

- The inventory system-message format is asserted verbatim in
  `tool-inventory.test.ts`; refresh semantics must not change the message
  contract without updating consumers.
- Dynamic input schemas (the `load_skill` enum-narrowing trick) can bloat if
  the catalog is huge; `load_tools` therefore validates server-side and keeps
  its schema static (`names: string[]`), unlike `load_skill`.
- Per-name failure reasons must not leak other tenants' tool existence: the
  unauthorized and nonexistent cases return the same `unknown_tool` reason.
