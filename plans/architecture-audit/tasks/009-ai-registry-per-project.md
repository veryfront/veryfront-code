# 009 - AI Registry Per-Project Isolation

## Priority: P1 - SECURITY

## North Star
AI tools, prompts, workflows, agents registered by one project are invisible to others.

## References
- Issue: [002.5-ai-registry-leakage.md](../002.5-ai-registry-leakage.md)
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)

## Checklist
- [ ] Replace global `toolRegistry` with per-project Map
- [ ] Replace global `promptRegistry` with per-project Map
- [ ] Replace global `workflowRegistry` with per-project Map
- [ ] Replace global `agentRegistry` with per-project Map
- [ ] Replace global `resourceRegistry` with per-project Map
- [ ] Key by projectId, create on first access
- [ ] Add `getRegistry(projectId)` accessor pattern

## Acceptance Criteria
- [ ] Project A's custom tool not visible to Project B
- [ ] Project A's prompts not accessible by Project B
- [ ] Registry created lazily per project
- [ ] CLI tools (no project) use separate global registry

## Quality Gates
- [ ] No `globalThis[REGISTRY_KEY]` patterns
- [ ] All registry access goes through projectId-scoped accessor
- [ ] Security audit: cross-project registry access impossible

## Test Coverage
- [ ] Unit: Tool registered in Project A not in Project B
- [ ] Unit: Same tool name, different projects, independent
- [ ] Integration: MCP server tools isolated per project
- [ ] Security: Attempt cross-project tool access fails
