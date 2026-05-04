# Phase 2 framework attach seam

This framework slice exposes a public sandbox attach/reconnect seam so the hosted runtime can stop using a local private-constructor bridge.

## Add now
- a public `Sandbox.attach(...)` factory that accepts an already-known endpoint/session/auth/api tuple
- coverage proving attached clients reuse the known endpoint/session without a lookup round-trip
- reference docs for the new seam

## Unlocks next
- delete `src/tools/sandbox/frameworkSandboxBridge.ts` in veryfront-agent
- remove one more local transport adapter file from the hosted runtime
