# Hosted lifecycle reference

This example shows the intended Phase 1 integration shape for a host that wants
to connect a framework agent run to an external conversations/control-plane API.

The framework owns the orchestration loop through `runHostedLifecycle(...)`.
The host still owns:

- auth and project access
- external run creation / lookup / append / finalize / cancel
- mirroring policy and retry behavior
- transcript persistence policy
- forwarded config extraction
- runtime-native message bridging

See `index.ts` for a minimal adapter composition sketch.
