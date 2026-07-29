# Issue 326 PRD: Preserve Tool Result Ordering During Suppressed-Call Recovery

## Problem

When a streamed step mixes unavailable and valid tool calls, the runtime places
suppressed-call recovery guidance before results from the valid calls. Anthropic
rejects the next request because the continuation no longer pairs assistant
tool uses with immediately following tool results.

## Desired Behavior

For every continuing stream step:

1. persist the assistant message;
2. execute or collect every valid tool result;
3. append suppressed-call recovery guidance, when needed;
4. invoke the model again.

A step containing only suppressed unavailable calls must continue to recover
with the same guidance as today.

## Implementation Plan

1. Add an integration-style runtime regression at the public streaming seam.
2. Prove the regression fails because the retry prompt ends in
   `assistant → user → tool`.
3. Defer appending the recovery user message until after valid result
   persistence.
4. Prove the regression and the existing suppressed-only recovery test pass.
5. Run formatting, linting, type checking, and the relevant runtime test suite.

## Acceptance Criteria

- A mixed step with one suppressed call and two valid parallel calls reaches a
  second model invocation.
- The retry prompt ends in `assistant → tool → user`.
- The tool message contains results for both valid calls.
- The final user message contains the unavailable-tool recovery guidance.
- Existing suppressed-only recovery behavior remains unchanged.
- No provider-specific ordering repair or new dependency is introduced.

## Test Plan

### RED

Add one streaming runtime test that emits:

- one call to an unavailable tool;
- one call to a first configured tool;
- one call to a second configured tool; and
- a `tool-calls` finish reason.

Assert the second provider prompt has the expected role suffix and content.

### GREEN

Move only the recovery-message append point. Do not change suppression,
execution, conversion, or retry policy.

### Verification

- Focused new regression test.
- Existing suppressed unavailable-tool recovery test.
- Runtime refresh test file.
- Formatter check for changed files.
- Repository lint and type-check commands applicable to the changed source.

## Out of Scope

- Tool availability policy changes.
- Generic retries for provider HTTP 400 responses.
- Integration-specific behavior.
- Broad message-converter refactors.
- Changes to durable event schemas or provider error reporting.
