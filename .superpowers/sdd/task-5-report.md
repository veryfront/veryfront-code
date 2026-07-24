## Task 5 report

Status: complete

Summary:

- Migrated runtime MCP source policy wrapping to `wrapRemoteToolSourceWithMcpPolicy`.
- Removed the runtime-local `isToolAllowed` and `filterToolDefinitions` duplicate helpers.
- Preserved exact denial details for HTTP MCP sources and source-id based injected/inherited sources.
- Kept auth resolution, bootstrap project binding, inherited source selection, credential binding, first-party source selection, and explicit opt-out logic unchanged.
- Updated denied policy execution assertions to use `assertRejects`, matching the shared wrapper execution contract.

Changed files:

- `src/agent/runtime/mcp-server-tool-sources.ts`
- `src/agent/runtime/mcp-server-tool-sources.test.ts`

Verification:

- `deno fmt --check src/agent/runtime/mcp-server-tool-sources.ts src/agent/runtime/mcp-server-tool-sources.test.ts .superpowers/sdd/task-5-report.md` passed.
- `deno lint src/agent/runtime/mcp-server-tool-sources.ts src/agent/runtime/mcp-server-tool-sources.test.ts` passed.
- `deno test --no-check --allow-all src/agent/runtime/mcp-server-tool-sources.test.ts src/agent/mcp-tool-policy.test.ts` passed: 27 tests, 10 steps.
- `git diff --check` passed.

Concerns:

- The shared remote wrapper rejects denied `executeTool` calls asynchronously. Runtime tests now assert rejected promises for policy-denied execution while preserving exact error detail checks and no-remote-call assertions.
