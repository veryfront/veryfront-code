## Task 4 report: hosted MCP policy shim

Status: complete

Changed files:

- `src/agent/hosted/project-remote-tool-source.ts`

Implementation:

- Replaced the hosted-specific MCP tool policy implementation with `wrapRemoteToolSourceWithMcpPolicy(...)`.
- Preserved the exported `createHostedMcpToolPolicySource(source, policy)` signature.
- Preserved the hosted denial detail: `Tool "<toolName>" is not allowed for this MCP server`.
- Left `createHostedProjectRemoteToolSourceFromConfig(...)` wrapping the raw source before project-scoped source creation.
- Left `activatedRemoteToolNames` project gate logic unchanged.

Verification:

- `deno test --no-check --allow-all src/agent/hosted/project-remote-tool-source.test.ts src/agent/mcp-tool-policy.test.ts` - passed, 27 tests, 10 steps.
- `deno fmt --check src/agent/hosted/project-remote-tool-source.ts` - passed, checked 1 file.

Self-review:

- Confirmed `isHostedMcpToolAllowed(...)` was removed.
- Confirmed `PERMISSION_DENIED` remains imported because the file still uses it for explicit Studio MCP rejection.
- Confirmed no test update was required because existing hosted project remote and shared Module policy tests cover the compatibility behavior.

Concerns:

- None.
