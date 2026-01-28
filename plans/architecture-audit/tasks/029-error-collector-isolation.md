# 029 - Error Collector Isolation

## Priority: P1 - SECURITY

## North Star
Error collector isolated per project. Errors not visible cross-project.

## References
- Issue: [010.2-global-error-collector.md](../010.2-global-error-collector.md)
- RFC: [010.0-error-handling-rfc.md](../010.0-error-handling-rfc.md)

## Checklist
- [ ] Replace global `ErrorCollector` singleton with per-project Map
- [ ] Key by projectId
- [ ] Add `getErrorCollector(projectId)` accessor
- [ ] Errors only visible to same project's MCP connection
- [ ] Clear errors on project reload
- [ ] Add error count limit per project (prevent memory growth)

## Acceptance Criteria
- [ ] Project A errors not visible to Project B MCP
- [ ] Error collector created lazily per project
- [ ] Errors cleared on project config reload
- [ ] Memory bounded by error count limit

## Quality Gates
- [ ] No global error collector singleton
- [ ] MCP tool validates projectId matches
- [ ] Security audit: cross-project error access impossible

## Test Coverage
- [ ] Unit: Errors isolated by project
- [ ] Unit: MCP returns only same-project errors
- [ ] Security: Cross-project error request fails
