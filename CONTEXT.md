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

`src/agent/runtime/agent-loop-skill-state.ts` (`AgentLoopSkillState`) is the
single owner of the request-scoped active-skill policy for one agent loop
attempt: which skill is active, what it permits, and how that changes when a
skill activates or a form input is submitted. Each loop owns its own instance.
`hydrate` builds it once per attempt from replay history, and the loop mutates
it in place as tool results arrive. It is never module-level and never shared
across concurrent runs. `executeAgentLoop` and `executeAgentLoopStreaming` in
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

## Tool Replay Reconciliation

The single owner of deciding which tool-call and tool-result occurrences in
UI-message replay history are authoritative for provider conversion:
`src/chat/tool-replay-reconciliation.ts`. Matching is by part **object
identity**, so one pass over history marks parts as matched, superseded,
batch-starting, or transient-but-preserved without mutating them. Provider
conversion and message preparation both consult this module rather than
re-deriving which occurrence wins.

## Message Part Interpretation

The single owner of interpreting one message part — tool, text, reasoning, or
file — into a normalized shape: `src/chat/message-part-parsing.ts`. Provider
conversion and Tool Replay Reconciliation both read parts through it, so a
change to how a part is recognized lands in one file.

## Stream Delivery

The separate agent-loop fan-out boundary that will route lifecycle frames to
live, durable, diagnostic, and usage Adapters (Phase 5, separately designed).
Through Gate 4, hosted durable and AG-UI production projections still consume
compatibility UI chunks, and production runs stay on stream protocol
version 1.

## Provider Message Conversion

The single owner of turning a chat's replay history into the ordered message
list a provider sees: `src/chat/provider-message-conversion.ts`. It asks Tool
Replay Reconciliation which tool occurrences are authoritative, maps each role's
parts into provider content, and settles into one `ProviderModelMessage[]`.
Message preparation and the compatibility layer are callers; neither re-derives
the mapping.

## Workflow Run Identity

A **run** is one backend-persisted execution record of a workflow definition, identified by
the ID `WorkflowHandle.runId` returns. It survives across processes, and it may be _executed_
more than once: a run that pauses at a wait node or a pending approval is resumed later as a
fresh execution of the same run. Composite nodes muddy the word: `parallel`, `branch`, `map`,
`loop`, and `subWorkflow` construct local `WorkflowRun`-shaped records while executing their
children. The `parallel`, `branch`, and `map` record IDs derive from the composite node ID;
`loop` record IDs derive from the node ID and iteration; `subWorkflow` record IDs add a
generated component. None of those local records are persisted or available for lookup. Only
the root persisted ID identifies a run outside the process, so callers, the backends, and
observability all key on it.
