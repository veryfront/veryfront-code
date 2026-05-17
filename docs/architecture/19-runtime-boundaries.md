# Runtime boundaries

This page lists high-risk runtime boundaries and the verification expected when
changing them.

## Provider and model resolution

Source areas:

- `src/provider/`
- `src/agent/runtime/model-resolution.ts`
- `src/embedding/model-resolution.ts`

Verify model defaults, provider-specific request construction, streaming,
embedding model resolution, and sanitized errors.

## Module loading and discovery

Source areas:

- `src/modules/`
- `src/discovery/`
- `src/server/handlers/request/module/`

Verify app-router and pages-router imports, generated module handlers, virtual
filesystem behavior, and discovery fixture coverage.

## AG-UI and hosted run state

Source areas:

- `src/agent/ag-ui/`
- `src/agent/hosted/`
- `src/agent/conversation/`

Verify chunk encoding, finalization, resume, cancellation, durable mirrors, and
child-run snapshots.

## Rendering and RSC

Source areas:

- `src/rendering/`
- `src/server/services/rsc/`
- `src/server/services/rendering/`

Verify page resolution, layout ordering, RSC endpoint behavior, SSR responses,
and error fallback output.

## Workflow execution

Source areas:

- `src/workflow/dsl/`
- `src/workflow/executor/`
- `src/workflow/backends/`
- `src/workflow/worker/`

Verify graph validation, step ordering, approvals, checkpointing, and worker
execution profiles.

## Change standard

- Update the focused architecture page for the boundary you changed.
- Update guides or reference docs when public behavior changes.
- Run focused tests for the touched runtime area.
- Broaden to full docs validation when docs, generated references, or public
  exports change.
