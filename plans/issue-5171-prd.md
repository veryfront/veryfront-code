# Issue 5171: service process attribution

## Outcome

An authenticated accepted legacy or native service invocation reports the actual receiving process. Separate replicas and restarted processes have distinct IDs. Route factories in one process share an ID. Existing owner URL and acceptance semantics remain compatible.

## Implementation

1. Add process-scoped runtime identity with environment name override and hostname fallback.
2. Decorate accepted responses on both invocation routes, even when the owner URL is unavailable.
3. Reuse existing authentication; never derive identity from incoming headers.

## Verification

At the existing service route seam, verify both launch paths, identity consistency across route factories, rejected requests, owner URL failure, and forged incoming identity. Test name validation and separate-process IDs at the identity helper seam. Run focused tests, type checks, formatting and lint. API issue 6591 owns fenced persistence; no registration, storage, routing or auth redesign is included here.
