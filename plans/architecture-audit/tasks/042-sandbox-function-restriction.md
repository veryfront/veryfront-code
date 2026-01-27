# 042 - Sandbox Function() Restriction

## Priority: P0 - SECURITY

## North Star
Config/plugin code cannot escape Deno sandbox. No arbitrary code execution.

## References
- Issue: [016.3-sandbox-escape.md](../016.3-sandbox-escape.md)
- Related: [001-sandbox-config-execution.md](./001-sandbox-config-execution.md)

## The Problem

`new Function(code)` bypasses Deno's permission system, allowing config code full system access.

## Checklist
- [ ] Audit all `new Function()` usage
- [ ] Replace with subprocess/worker sandbox
- [ ] Add permission boundary tests
- [ ] Consider JSON config (Task 001) as alternative
- [ ] Document allowed config capabilities

## Acceptance Criteria
- [ ] Config code cannot access filesystem (without explicit permission)
- [ ] Config code cannot make network requests (without explicit permission)
- [ ] Config code cannot access environment variables

## Quality Gates
- [ ] Sandbox escape attempt test fails safely
- [ ] Legitimate config still works
- [ ] No performance regression > 100ms

## Test Coverage
- [ ] Unit: Sandbox blocks file access
- [ ] Unit: Sandbox blocks network access
- [ ] Unit: Sandbox blocks env access
- [ ] Integration: Config loads successfully in sandbox

## Notes

If Task 001 (JSON config) is implemented, this becomes lower priority but still needed for plugin system.
