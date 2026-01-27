# 001 - Sandbox Config Execution

## Priority: P0 - SECURITY CRITICAL

## North Star
User config files cannot execute arbitrary code or access system resources.

## References
- Issue: [008.2-unsafe-config-execution.md](../008.2-unsafe-config-execution.md)
- RFC: [008.0-userland-config-rfc.md](../008.0-userland-config-rfc.md)

## Decision: JSON vs TS Config

| Approach | Pros | Cons |
|----------|------|------|
| **JSON only** | Zero code execution risk, simple parsing, fast | No computed values, no env vars, breaking change |
| **JSON + env vars** | Low risk, simple, supports secrets | Limited flexibility |
| **TS in sandbox** | Full flexibility, backward compatible | Complex, sandbox escape risk |

**Recommendation:** JSON with env var interpolation for production. TS sandbox for local dev.

```json
// veryfront.config.json
{
  "title": "My App",
  "api": {
    "baseUrl": "${VERYFRONT_API_URL}"
  }
}
```

## Checklist

### Option A: JSON Config (Recommended for Production)
- [ ] Support `veryfront.config.json` as primary format
- [ ] Add env var interpolation (`${VAR_NAME}` syntax)
- [ ] JSON schema for validation + IDE autocomplete
- [ ] Migration guide from .ts to .json
- [ ] Deprecation warning for .ts in production

### Option B: TS Sandbox (Fallback/Local Dev)
- [ ] Create Deno Worker sandbox with `{ permissions: "none" }`
- [ ] Add static analysis pre-check for I/O patterns (import "fs", fetch, etc.)
- [ ] Move config execution from `import()` to sandboxed worker
- [ ] Add timeout (5s) and memory limit to sandbox
- [ ] Return only serializable config object from sandbox
- [ ] Add error handling for sandbox failures

## Acceptance Criteria
- [ ] Config with `fetch()` call fails with clear error
- [ ] Config with `Deno.readFile()` fails with clear error
- [ ] Config with `process.env` access fails with clear error
- [ ] Valid config still loads correctly
- [ ] Config load time < 500ms for typical configs

## Quality Gates
- [ ] Security review of sandbox implementation
- [ ] No `import()` of user code outside sandbox
- [ ] All config paths use sandbox (virtual FS and local)
- [ ] Audit log when sandbox blocks dangerous operation

## Test Coverage
- [ ] Unit: Sandbox blocks network access
- [ ] Unit: Sandbox blocks file system access
- [ ] Unit: Sandbox blocks env var access
- [ ] Unit: Sandbox enforces timeout
- [ ] Unit: Valid config parses correctly
- [ ] Integration: Malicious config in virtual FS blocked
- [ ] Integration: Malicious config in local FS blocked
