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

## Agent Loop Skill State

The single owner of the request-scoped active-skill policy for one agent
loop attempt — which skill is active, what it permits, and how that changes
when a skill activates or a form input is submitted:
`src/agent/runtime/agent-loop-skill-state.ts` (`AgentLoopSkillState`). A
mutable class hydrated once per attempt from replay history, then mutated in
place as tool results arrive; never module-level or shared across
concurrent runs. `executeAgentLoop` and `executeAgentLoopStreaming` in
`src/agent/runtime/index.ts` each construct one instance and consult it
rather than maintaining their own copies of the same policy transitions, so
a skill-policy fix lands once instead of being hand-applied to both loops.

## Stream Lifecycle

The single owner of one provider stream attempt, from the first provider read
until completion, tool handoff, cancellation, or failure:
`src/agent/streaming/lifecycle/`. It decodes provider parts through a Provider
Adapter, reduces them into validated **semantic**, **telemetry**, and
**diagnostic** frames, owns monotonic provider-wait deadlines and status
cadence, and settles exactly one typed Stream Outcome per attempt. Telemetry
observes execution but never extends a semantic deadline. One agent run may
contain several provider attempts separated by local tool execution.

## Deploy Execution

The single owner of deploying a project, from source resolution to a
reachable environment: `cli/shared/deployment/deploy-project.ts`
(`DeployProject.execute`). One request carries the project directory,
optional explicit project slug, branch, environment, mode, and source kind
(ensure-pushed or already-pushed), and settles into one typed outcome, with
steps reported through an observer. The CLI deploy command and the MCP
deploy tool are presentation adapters over this module; the control plane
(HTTP in production, fake in tests) is its one seam. Success means the
deployment is verified **and** ready; no adapter skips or re-implements
verification, polling, or readiness waits.

## Project Resolution

The single owner of "which project does this directory target, and does it
exist on the control plane?": `cli/shared/project-resolution.ts`
(`resolveOrCreateProject`). One request carries the project directory, the
resolved config, the reference source, and whether the run may create or only
plan; it settles into one typed outcome — existing, created, or
planned-create. Push, deploy, up, demo, and the TUI are presentation adapters
over this module: they own their wording, spinners, and typed-error phrasing,
never the decision. There is exactly one persisted link format
(`.veryfront/project.json`), written only for references a directory owns
(inferred or local-link) and never on a dry run. The project client
(control plane over HTTP, CLI API client, fake in tests) is its one seam.

## Stream Delivery

The separate agent-loop fan-out boundary that will route lifecycle frames to
live, durable, diagnostic, and usage Adapters (Phase 5, separately designed).
Through Gate 4, hosted durable and AG-UI production projections still consume
compatibility UI chunks, and production runs stay on stream protocol
version 1.
