# Runtime boundaries

This page lists high-risk runtime boundaries and the verification expected when
changing them.

## Provider and model resolution

Source areas:

- [`src/provider/`](../../src/provider/)
- [`src/agent/runtime/model-resolution.ts`](../../src/agent/runtime/model-resolution.ts)
- [`src/embedding/model-resolution.ts`](../../src/embedding/model-resolution.ts)

Verify model defaults, provider-specific request construction, streaming,
embedding model resolution, and sanitized errors.

## Module loading and discovery

Source areas:

- [`src/modules/`](../../src/modules/)
- [`src/discovery/`](../../src/discovery/)
- [`src/server/handlers/request/module/`](../../src/server/handlers/request/module/)

Verify app-router and pages-router imports, generated module handlers, virtual
filesystem behavior, and discovery fixture coverage.

## AG-UI and hosted run state

Source areas:

- [`src/agent/ag-ui/`](../../src/agent/ag-ui/)
- [`src/agent/hosted/`](../../src/agent/hosted/)
- [`src/agent/conversation/`](../../src/agent/conversation/)

Verify chunk encoding, finalization, resume, cancellation, durable mirrors, and
child-run snapshots.

## AI primitives and skills

Source areas:

- [`src/tool/`](../../src/tool/)
- [`src/prompt/`](../../src/prompt/)
- [`src/resource/`](../../src/resource/)
- [`src/skill/`](../../src/skill/)

Verify primitive factories, schema conversion, registry scoping, tool execution,
remote tool materialization, skill metadata parsing, allowed-tool filtering,
path safety, and skill script execution.

## Rendering and RSC

Source areas:

- [`src/rendering/`](../../src/rendering/)
- [`src/server/services/rsc/`](../../src/server/services/rsc/)
- [`src/server/services/rendering/`](../../src/server/services/rendering/)

Verify page resolution, layout ordering, RSC endpoint behavior, SSR responses,
and error fallback output.

## Workflow execution

Source areas:

- [`src/workflow/dsl/`](../../src/workflow/dsl/)
- [`src/workflow/executor/`](../../src/workflow/executor/)
- [`src/workflow/backends/`](../../src/workflow/backends/)
- [`src/workflow/worker/`](../../src/workflow/worker/)

Verify graph validation, step ordering, approvals, checkpointing, and worker
execution profiles.

## Jobs and tasks

Source areas:

- [`src/jobs/`](../../src/jobs/)
- [`src/task/`](../../src/task/)

Verify jobs client request shape, job and cron schemas, project scoping, task
discovery, task context construction, and env allowlisting.

## OAuth and integrations

Source areas:

- [`src/oauth/`](../../src/oauth/)
- [`src/integrations/`](../../src/integrations/)

Verify OAuth user binding, one-shot state consumption, token-store keying,
connector schemas, request-scoped remote tool visibility, and remote tool result
normalization.

## Sandbox sessions

Source areas:

- [`src/sandbox/`](../../src/sandbox/)

Verify sandbox credential resolution, session creation, attach and reconnect
paths, lazy provisioning, command streaming, command jobs, heartbeats, file
operations, and agent-facing shell tool schemas.

## Change standard

- Update the focused architecture page for the boundary you changed.
- Update guides or reference docs when public behavior changes.
- Run focused tests for the touched runtime area.
- Broaden to full docs validation when docs, generated references, or public
  exports change.
