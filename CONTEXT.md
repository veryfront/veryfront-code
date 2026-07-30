# Domain Glossary

Terms with a specific meaning in this codebase. Architecture reviews and
refactors should use these names; sharpen or extend this file as concepts
crystallize.

## Stream Outcome

How a provider stream ended, interpreted in exactly one place:
`src/agent/streaming/stream-outcome.ts`. Covers extracting an error message
from whatever a provider throws, recognizing the late "body read" failure
(which counts as completion when output already streamed), classifying finish
reasons as completed steps, and mapping thrown errors to known terminal
provider errors. The agent **runtime** layer starts streams and the **hosted**
layer finishes them; both consult this module rather than re-deriving the
interpretation, so provider behavior changes land in one file.

## Stream Lifecycle

The single owner of one provider stream attempt, from the first provider read
until completion, tool handoff, cancellation, or failure:
`src/agent/streaming/lifecycle/`. It decodes provider parts through a Provider
Adapter, reduces them into validated **semantic**, **telemetry**, and
**diagnostic** frames, owns monotonic provider-wait deadlines and status
cadence, and settles exactly one typed Stream Outcome per attempt. Telemetry
observes execution but never extends a semantic deadline. One agent run may
contain several provider attempts separated by local tool execution.

## Stream Delivery

The separate agent-loop fan-out boundary that will route lifecycle frames to
live, durable, diagnostic, and usage Adapters (Phase 5, separately designed).
Through Gate 4, hosted durable and AG-UI production projections still consume
compatibility UI chunks, and production runs stay on stream protocol
version 1.
