# 034 - Config Schema Validation

## Priority: P2 - CORRECTNESS

## North Star
Config schema matches runtime behavior. All valid configs accepted, invalid rejected.

## References
- Issues: [007.1](../007.1-router-format-mismatch.md), [007.2](../007.2-cors-schema-runtime-mismatch.md), [007.3](../007.3-default-config-shared-reference.md), [007.4](../007.4-layout-tristate-inconsistency.md), [007.5](../007.5-cache-enabled-type-confusion.md), [007.6](../007.6-security-config-cors-default-mutation.md), [008.5](../008.5-config-schema-validation-gaps.md)
- RFC: [007.0-config-normalization-rfc.md](../007.0-config-normalization-rfc.md)

## Checklist
- [ ] Fix router format: accept both `"app"` and `"app-router"`
- [ ] Fix CORS schema: accept `string | string[] | Function`
- [ ] Freeze DEFAULT_CONFIG (no mutation)
- [ ] Normalize layout tristate at load time
- [ ] Clarify cache enabled vs type semantics
- [ ] Remove security config mutation (`??=`)
- [ ] Reject unknown keys (not just warn)

## Acceptance Criteria
- [ ] Schema matches actual runtime types
- [ ] Valid CORS array config accepted
- [ ] DEFAULT_CONFIG immutable
- [ ] Unknown keys rejected with clear error

## Quality Gates
- [ ] Schema generated from TypeScript types
- [ ] Schema tests for all edge cases
- [ ] No config mutation after validation

## Test Coverage
- [ ] Unit: Router format normalization
- [ ] Unit: CORS array accepted
- [ ] Unit: Unknown keys rejected
- [ ] Unit: DEFAULT_CONFIG frozen
