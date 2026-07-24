# MCP Tool policy Module design

## Outcome

Create one deep private Module for MCP Tool allow and deny policy, then route the existing hosted and runtime adapters through it without changing public behavior.

The Module target is `src/agent/mcp-tool-policy.ts`. It owns the policy predicate, list filtering, execution guard, live policy mutation behavior, and the exact permission failure construction for MCP Tool policy checks. Existing callers keep their public Interface and continue to compose project scoped Tool behavior, activation gates, access profiles, Studio project switching, and credential binding outside this Module.

## Current evidence

- `src/agent/types.ts` exports `AgentMcpToolPolicy` with `allow?: string[]`, `deny?: string[]`, and `approval?: "never"`.
- `src/agent/hosted/child-fork-tool-sources.ts` defines `isMcpToolAllowed`, `filterHostToolsByMcpPolicy`, and `filterToolDefinitionsByMcpPolicy`. It filters Studio host Tools and remote Tool definitions, then wraps host Tool execution to enforce live policy checks.
- `src/agent/hosted/project-remote-tool-source.ts` defines `isHostedMcpToolAllowed` and exports `createHostedMcpToolPolicySource`. It filters `RemoteToolSource.listTools()` and blocks `executeTool()` with `PERMISSION_DENIED.create({ detail: ... })`.
- `src/agent/runtime/mcp-server-tool-sources.ts` defines another `isToolAllowed`, `filterToolDefinitions`, and `createMcpToolPolicySource`. It also embeds the HTTP-server denial detail string in `createMcpServerToolSource`.
- `src/agent/hosted/project-remote-tool-source.ts` separately owns project scoped execution through `createHostedProjectRemoteToolSource(...)`. Its `activatedRemoteToolNames` Set is a live project activation gate, not MCP policy.
- `src/agent/hosted/child-fork-tool-sources.test.ts` locks API, generic, and Studio policy filtering plus live mutation of the Studio policy object after wrapping.
- `src/agent/hosted/project-remote-tool-source.test.ts` locks `activatedRemoteToolNames` as the live execution gate for project remote Tools.
- `src/agent/runtime/mcp-server-tool-sources.test.ts` locks runtime MCP server filtering, bearer auth, first-party project binding, and denied execution behavior.

## Proposed Module

`src/agent/mcp-tool-policy.ts`

```ts
import type { HostToolSet, RemoteToolSource } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "./types.ts";

export type McpToolPolicyGate = {
  allows(toolName: string): boolean;
  filterDefinitions<T extends { name: string }>(definitions: readonly T[]): T[];
  assertAllowed(toolName: string): void;
};

export function createMcpToolPolicyGate(
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string) => string },
): McpToolPolicyGate;

export function wrapRemoteToolSourceWithMcpPolicy(
  source: RemoteToolSource,
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string, sourceId: string) => string },
): RemoteToolSource;

export function wrapHostToolSetWithMcpPolicy(
  tools: HostToolSet,
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string) => string },
): HostToolSet;
```

The Module must use the existing `AgentMcpToolPolicy` Interface rather than declaring a competing policy type. `approval?: "never"` remains accepted compatibility data on the policy object. The allow and deny gate does not interpret `approval` because current policy checks do not interpret it.

The Module must read `policy.allow` and `policy.deny` on every check. It must not snapshot Sets or arrays because existing tests mutate policy objects after wrapping. Deny remains a hard ceiling. Allow remains a positive selection only when present. With no allow and no deny, adapters preserve source identity where current behavior does so.

## Ownership

The new Module owns:

- The allow and deny predicate.
- Filtering ordered lists of Tool definitions by name.
- Wrapping `RemoteToolSource` execution with a permission guard.
- Wrapping `HostToolSet` execution with a permission guard while preserving Tool definition fields.
- Canonical permission errors for policy denial, with caller-supplied detail builders for existing exact messages.

The Module does not own:

- Project scoped Tool hydration or `project_reference` replacement.
- `activatedRemoteToolNames` execution gating.
- The `approval` field on `AgentMcpToolPolicy`.
- Veryfront API Tool access profile filtering.
- Remote MCP transport construction, auth headers, bearer token binding, or project credential binding.
- Studio MCP creation, project switch confirmation, or child fork Tool assembly.
- Runtime `tools` boolean resolution and inherited source selection.

## Interfaces and adapters

`createMcpToolPolicyGate(policy)` is the small Interface for semantics. It keeps policy Depth by hiding the precedence rules and live mutation behavior.

`wrapRemoteToolSourceWithMcpPolicy(...)` is the Adapter for remote MCP sources. It returns the original source when policy has neither `allow` nor `deny` to preserve current identity behavior. When policy is non-empty, it filters `listTools()` and blocks `executeTool()`.

`wrapHostToolSetWithMcpPolicy(...)` is the Adapter for materialized host Tools. It filters the visible Tool set and guards each wrapped `execute` function. It must preserve existing Tool ordering from `Object.entries()` and keep non-executable Tool definitions unchanged except for filtered visibility.

Existing named helpers stay as compatibility shims:

- `createHostedMcpToolPolicySource(source, policy)` in `src/agent/hosted/project-remote-tool-source.ts` delegates to `wrapRemoteToolSourceWithMcpPolicy(...)` with detail `Tool "<name>" is not allowed for this MCP server`.
- Runtime private `createMcpToolPolicySource(...)` in `src/agent/runtime/mcp-server-tool-sources.ts` delegates with detail `Tool "<name>" is not allowed for MCP server "<source.id>"`.
- Runtime HTTP server wrapping in `createMcpServerToolSource(...)` delegates with detail `Tool "<name>" is not allowed for MCP server "<server.id>"`.
- Child fork policy filtering in `src/agent/hosted/child-fork-tool-sources.ts` delegates host Tool wrapping and definition filtering to the Module. The API access profile filter still runs before policy filtering as it does today.

## Invariants

- Deny wins over allow.
- If `allow` exists, only listed Tool names pass unless denied.
- If `allow` is absent, all Tool names pass unless denied.
- Empty policy preserves current behavior.
- Policy reads are live. Mutating the same policy object after wrapping changes future list and execution results.
- `approval` on `AgentMcpToolPolicy` remains valid input and does not change allow or deny behavior.
- Denied execution throws `PERMISSION_DENIED.create({ detail: ... })` and preserves existing detail strings at each caller.
- List filtering preserves the original order of allowed Tool definitions.
- Project activation remains distinct from MCP policy. `activatedRemoteToolNames` continues to decide project remote Tool listing and execution after policy wrapping.
- Public exports and signatures do not change.

## Risks

- Wrapping order can change behavior if policy is applied before project scoped catalogs in paths that depend on source identity or context. Keep the hosted project source order as `policySource -> createHostedProjectRemoteToolSource(...)`, matching current behavior.
- The runtime path has two exact denial message forms. Preserve them through Adapter detail options rather than standardizing text.
- Host Tool wrappers must keep live policy mutation. Avoid converting policy arrays to Sets unless done per check or behind a live reader.
- Empty-policy identity preservation may be relied on by tests even if not documented. Preserve it for remote source wrappers and avoid wrapping host Tools when no policy exists.
- Future work may assign meaning to `approval`. This refactor must not preclude that, but it must not implement approval behavior.

## Rollback

Rollback is clean: remove `src/agent/mcp-tool-policy.ts`, restore the three local policy helpers in the touched callers, and revert the new focused tests. Because this is a private Module, no public migration is required.
