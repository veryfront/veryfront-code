# MCP Tool Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MCP Tool allow and deny policy into one private Module while preserving all current hosted and runtime behavior.

**Architecture:** Add `src/agent/mcp-tool-policy.ts` as the single policy Module. Keep existing hosted and runtime entrypoints as adapters and compatibility shims. Keep project activation, API access profiles, transport setup, auth, and `AgentMcpToolPolicy.approval` outside the allow and deny gate.

**Tech Stack:** Deno, TypeScript, Veryfront internal imports, `PERMISSION_DENIED`, `AgentMcpToolPolicy`, `RemoteToolSource`, `HostToolSet`, colocated Deno tests.

## Global Constraints

- Preserve public API compatibility.
- Use `AgentMcpToolPolicy` from `src/agent/types.ts`; do not create a competing public policy type.
- Accept `approval?: "never"` on the policy object and do not interpret it in the allow and deny gate.
- Keep `activatedRemoteToolNames` as a separate project activation gate.
- Preserve current Tool ordering, allow and deny precedence, empty policy behavior, live policy mutation, exact denial details, and public exports.
- Use `PERMISSION_DENIED.create({ detail: ... })` for denied policy execution.
- Add no dependencies.
- Use `apply_patch` for edits.

---

## File structure

- Create: `src/agent/mcp-tool-policy.ts`
  - Owns allow and deny semantics, definition filtering, remote source wrapping, host Tool wrapping, and denial error construction.
- Create: `src/agent/mcp-tool-policy.test.ts`
  - Locks the private Module contract directly before adapter refactors.
- Modify: `src/agent/hosted/child-fork-tool-sources.ts`
  - Removes local policy predicate and host Tool policy wrapper.
  - Delegates Studio host Tool wrapping and remote definition filtering to `src/agent/mcp-tool-policy.ts`.
- Modify: `src/agent/hosted/project-remote-tool-source.ts`
  - Keeps `createHostedMcpToolPolicySource(...)` as a compatibility shim.
  - Delegates remote source policy wrapping to `src/agent/mcp-tool-policy.ts`.
- Modify: `src/agent/runtime/mcp-server-tool-sources.ts`
  - Removes duplicate runtime predicate and wrapper logic.
  - Delegates HTTP, injected, constrained, inherited, and first-party source policy wrapping to `src/agent/mcp-tool-policy.ts`.

## Baseline

- [ ] **Step 1: Run focused baseline tests before edits**

```bash
deno test --no-check --allow-all src/agent/hosted/child-fork-tool-sources.test.ts src/agent/hosted/project-remote-tool-source.test.ts src/agent/runtime/mcp-server-tool-sources.test.ts
```

Expected: PASS on the baseline branch. If this fails, stop implementation and record the unrelated baseline failure before editing source.

## Task 1: Lock the shared Module contract

**Files:**

- Create: `src/agent/mcp-tool-policy.test.ts`

**Interfaces:**

- Consumes: `AgentMcpToolPolicy` from `src/agent/types.ts`, `RemoteToolSource` and `HostToolSet` from `#veryfront/tool`.
- Produces: Test coverage for `createMcpToolPolicyGate(...)`, `wrapRemoteToolSourceWithMcpPolicy(...)`, and `wrapHostToolSetWithMcpPolicy(...)`.

- [ ] **Step 1: Write the failing Module tests**

Create `src/agent/mcp-tool-policy.test.ts` with tests for:

- `createMcpToolPolicyGate(undefined)` allows all names.
- Deny wins over allow.
- Allow filters definition order without sorting.
- `approval: "never"` does not affect allow and deny behavior.
- Mutating the same policy object after gate creation changes `allows(...)`, `filterDefinitions(...)`, and `assertAllowed(...)`.
- `wrapRemoteToolSourceWithMcpPolicy(...)` returns the same source for empty policy.
- Wrapped remote `listTools()` filters dynamically.
- Wrapped remote `executeTool()` blocks denied names before calling the source.
- `wrapHostToolSetWithMcpPolicy(...)` filters visible Tools and blocks execution if policy later changes after wrapping.
- A detail builder preserves exact caller-provided denial text.

- [ ] **Step 2: Run the red test**

```bash
deno test --no-check --allow-all src/agent/mcp-tool-policy.test.ts
```

Expected: FAIL because `src/agent/mcp-tool-policy.ts` does not exist.

## Task 2: Implement the shared Module

**Files:**

- Create: `src/agent/mcp-tool-policy.ts`
- Test: `src/agent/mcp-tool-policy.test.ts`

**Interfaces:**

- Consumes: `AgentMcpToolPolicy`, `HostToolSet`, `RemoteToolSource`, `PERMISSION_DENIED`.
- Produces:

```ts
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

- [ ] **Step 1: Add minimal implementation**

Implementation requirements:

- Import `PERMISSION_DENIED` from `#veryfront/errors`.
- Import `HostToolSet` and `RemoteToolSource` as types from `#veryfront/tool`.
- Import `AgentMcpToolPolicy` as a type from `./types.ts`.
- Treat policy as empty only when both `policy?.allow` and `policy?.deny` are absent.
- Read `policy.allow` and `policy.deny` inside each check.
- Ignore `policy.approval`.
- Use `Object.entries(tools)` to preserve host Tool ordering.
- Preserve each host Tool definition with object spread and replace only `execute` when it exists.
- Call the original host `execute(toolInput, execOptions)` unchanged.
- Call the original remote `source.listTools(context)` and `source.executeTool(toolName, args, context)` unchanged.
- Throw `PERMISSION_DENIED.create({ detail: detailString })` for denied execution.

- [ ] **Step 2: Run the Module test**

```bash
deno test --no-check --allow-all src/agent/mcp-tool-policy.test.ts
```

Expected: PASS.

## Task 3: Refactor hosted child fork policy call sites

**Files:**

- Modify: `src/agent/hosted/child-fork-tool-sources.ts`
- Test: `src/agent/hosted/child-fork-tool-sources.test.ts`

**Interfaces:**

- Consumes: `createMcpToolPolicyGate(...)` and `wrapHostToolSetWithMcpPolicy(...)` from `../mcp-tool-policy.ts`.
- Produces: Existing `prepareDefaultHostedChildForkToolSources(...)` behavior with shared policy semantics.

- [ ] **Step 1: Replace local host and definition filtering**

Implementation requirements:

- Remove `isMcpToolAllowed(...)`.
- Remove `filterHostToolsByMcpPolicy(...)`.
- Remove `filterToolDefinitionsByMcpPolicy(...)`.
- Remove the direct `PERMISSION_DENIED` import if no longer used.
- Keep `AGENT_ERROR` import unchanged.
- Import `createMcpToolPolicyGate` and `wrapHostToolSetWithMcpPolicy` from `../mcp-tool-policy.ts`.
- For Studio host Tools, call:

```ts
const policyTools = wrapHostToolSetWithMcpPolicy(studioTools.tools, server.toolPolicy, {
  deniedDetail: (toolName) => `Tool "${toolName}" is not allowed for this MCP server`,
});
```

- For remote definitions, keep API access profile filtering first, then call:

```ts
const definitions = createMcpToolPolicyGate(server.toolPolicy).filterDefinitions(
  accessFilteredDefinitions,
);
```

- Do not change `createHostedMcpToolPolicySource(...)` usage in this task.

- [ ] **Step 2: Run hosted child fork tests**

```bash
deno test --no-check --allow-all src/agent/hosted/child-fork-tool-sources.test.ts src/agent/mcp-tool-policy.test.ts
```

Expected: PASS.

## Task 4: Refactor hosted project remote policy shim

**Files:**

- Modify: `src/agent/hosted/project-remote-tool-source.ts`
- Test: `src/agent/hosted/project-remote-tool-source.test.ts`

**Interfaces:**

- Consumes: `wrapRemoteToolSourceWithMcpPolicy(...)` from `../mcp-tool-policy.ts`.
- Produces: Existing `createHostedMcpToolPolicySource(...)` export as a compatibility shim.

- [ ] **Step 1: Replace hosted remote policy implementation**

Implementation requirements:

- Remove `isHostedMcpToolAllowed(...)`.
- Remove the direct `PERMISSION_DENIED` import only if no other code in the file uses it.
- Keep `createHostedMcpToolPolicySource(source, policy)` exported with the same signature.
- Implement the shim as:

```ts
return wrapRemoteToolSourceWithMcpPolicy(source, policy, {
  deniedDetail: (toolName) => `Tool "${toolName}" is not allowed for this MCP server`,
});
```

- Keep `createHostedProjectRemoteToolSourceFromConfig(...)` wrapping the raw source before project scoped source creation.
- Do not change `activatedRemoteToolNames` logic.

- [ ] **Step 2: Run hosted project remote tests**

```bash
deno test --no-check --allow-all src/agent/hosted/project-remote-tool-source.test.ts src/agent/mcp-tool-policy.test.ts
```

Expected: PASS.

## Task 5: Refactor runtime MCP source policy

**Files:**

- Modify: `src/agent/runtime/mcp-server-tool-sources.ts`
- Test: `src/agent/runtime/mcp-server-tool-sources.test.ts`

**Interfaces:**

- Consumes: `wrapRemoteToolSourceWithMcpPolicy(...)` from `../mcp-tool-policy.ts`.
- Produces: Existing runtime MCP source behavior with shared policy semantics.

- [ ] **Step 1: Replace runtime duplicate policy code**

Implementation requirements:

- Remove `isToolAllowed(...)`.
- Remove `filterToolDefinitions(...)`.
- Replace the private `createMcpToolPolicySource(...)` body with delegation to `wrapRemoteToolSourceWithMcpPolicy(...)`.
- For the private source-id based wrapper, preserve this detail:

```ts
`Tool "${toolName}" is not allowed for MCP server "${sourceId}"`;
```

- For HTTP server wrapping in `createMcpServerToolSource(...)`, preserve this detail:

```ts
`Tool "${toolName}" is not allowed for MCP server "${server.id}"`;
```

- Keep auth resolution, bootstrap project binding, inherited source selection, credential binding, and first-party source selection untouched.

- [ ] **Step 2: Run runtime MCP source tests**

```bash
deno test --no-check --allow-all src/agent/runtime/mcp-server-tool-sources.test.ts src/agent/mcp-tool-policy.test.ts
```

Expected: PASS.

## Task 6: Compatibility regression pass

**Files:**

- Validate all files touched by Tasks 1 through 5.

- [ ] **Step 1: Run the focused policy suite**

```bash
deno test --no-check --allow-all src/agent/mcp-tool-policy.test.ts src/agent/hosted/child-fork-tool-sources.test.ts src/agent/hosted/project-remote-tool-source.test.ts src/agent/runtime/mcp-server-tool-sources.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent Tool and remote MCP tests**

```bash
deno test --no-check --allow-all src/tool/project-scoped-remote-tools.test.ts src/tool/remote-mcp.test.ts src/agent/runtime/tool-discovery-execution-gate.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the broad unit suite**

```bash
deno test --no-check --allow-all --parallel '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

Expected: PASS. If broad tests expose unrelated failures, keep focused passing evidence and record exact unrelated failures for root triage.

- [ ] **Step 4: Run diff hygiene**

```bash
git diff --check
```

Expected: no output and exit code `0`.

## Review checklist

- [ ] No public export map or import map changes were made.
- [ ] No public copy changed.
- [ ] No dependency changes were made.
- [ ] `AgentMcpToolPolicy` remains the policy type and `approval` remains accepted but uninterpreted.
- [ ] Denied execution still blocks before source execution, proven by call counters in tests.
- [ ] Host Tool live policy mutation remains covered by the Studio test and new Module test.
- [ ] Project activation live mutation remains covered in `src/agent/hosted/project-remote-tool-source.test.ts`.
- [ ] Empty-policy identity is preserved for remote source wrappers.

## Handoff notes

- Implement in this MCP policy worktree only.
- Keep the main checkout untouched.
- Use `apply_patch` for edits.
- Do not delete caller tests until the new Module tests and caller compatibility tests both pass.
- If cleanup removes duplicate tests, delete only policy-only duplication and keep adapter tests that prove ordering, identity, and exact errors.
