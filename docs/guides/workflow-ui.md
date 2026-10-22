---
title: "Show workflow progress in React"
description: "Expose authenticated workflow routes and display run status, approvals, and events in React."
order: 61
---

Connect a React dashboard to a running workflow so users can follow its steps and approvals.

## Prerequisites

- A working workflow from [Workflows](./workflows.md).
- One shared workflow client exported from `lib/workflows.ts`, using a backend that all relevant requests can access.
- A server-side session implementation for authorizing the routes.

The examples use the `content-pipeline` workflow from the workflow guide. If yours has a different ID, change `workflowId` to match the registered definition.

## React hooks

Track workflow progress from the client when your app exposes workflow API
routes that match the hook's `apiBase`:

```tsx
"use client";
import { useWorkflow, useWorkflowStart } from "veryfront/workflow";

export default function PipelineDashboard() {
  const { start, lastRunId } = useWorkflowStart({
    workflowId: "content-pipeline",
    apiBase: "/api/workflows",
  });

  return (
    <div>
      <button onClick={() => start({ topic: "AI agents" })}>
        Run workflow
      </button>
      {lastRunId ? <WorkflowStatus runId={lastRunId} /> : null}
    </div>
  );
}

function WorkflowStatus({ runId }: { runId: string }) {
  const { status, nodeStates } = useWorkflow({ runId });

  return (
    <div>
      <p>Status: {status}</p>
      {Object.entries(nodeStates).map(([id, state]) => <div key={id}>{id}: {state.status}</div>)}
    </div>
  );
}
```

`useWorkflowStart` posts to `${apiBase}/${workflowId}/start`. `useWorkflow`
subscribes to `${apiBase}/runs/${runId}` and keeps `status` and `nodeStates` in
sync with the server's run state.

### Serve the hook routes

Nothing serves those paths by default. Mount `createWorkflowHandler` on a
catch-all route to answer all of them at once:

Before mounting this route, provide `lib/auth.ts` through your application's
server-side authentication layer. Its `getSession(request)` function must verify
a signed, HttpOnly, same-origin session cookie and return
`Promise<{ user: { id: string } } | null>`. Do not decode an unsigned cookie or
accept a browser-supplied user ID header as authentication.

```ts theme={null}
// app/api/workflows/[...path]/route.ts
import { createWorkflowHandler } from "veryfront/workflow";
import { getSession } from "../../../../lib/auth.ts";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows, {
  authorize: async (request) => (await getSession(request))?.user.id ?? null,
});
```

Pass the same client the rest of the app starts workflows with. A client created
inside the route file would carry its own in-memory backend and would not see
those runs.

The `authorize` callback must validate the request with your server-side session
implementation and return the authenticated user's stable ID. It can also deny
access to individual routes. Returning `null` denies the request. Veryfront uses
the returned ID for approval decisions and does not trust the approver name in
the browser request. Non-canonical route encodings are rejected before this
callback runs, so route-specific policies cannot authorize a different path
from the operation the handler dispatches.

The built-in handler does not apply per-run ownership filtering. Only authorize
an identity when it can read every run summary visible to the supplied client.
The approval-by-ID route returns the approval payload, so the identity must also
be allowed to read and decide those approvals. Use separate clients or separate
route authorization when users have different run visibility.

The handler covers every path the hooks call:

| Method        | Path                                   | Hook               |
| ------------- | -------------------------------------- | ------------------ |
| `POST`        | `/{workflowId}/start`                  | `useWorkflowStart` |
| `GET`         | `/runs`                                | `useWorkflowList`  |
| `GET`         | `/runs/{runId}`                        | `useWorkflow`      |
| `GET`         | `/runs/{runId}/events`                 | SSE clients        |
| `POST`        | `/runs/{runId}/cancel`                 | `useWorkflow`      |
| `POST`        | `/runs/{runId}/retry`                  | `useWorkflow`      |
| `GET`, `POST` | `/runs/{runId}/approvals/{approvalId}` | `useApproval`      |

Mounting somewhere else means telling both sides. Pass `basePath` to the handler
and the matching `apiBase` to every hook.

### Understand run summaries

`GET /runs`, `GET /runs/{runId}`, and the first SSE `snapshot` frame return the
same `WorkflowRunSummary` shape. The built-in handler constructs this response
from an allowlist:

```ts
type WorkflowStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface WorkflowNodeStateSummary {
  nodeId: string;
  status: NodeStatus;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface WorkflowApprovalSummary {
  id: string;
  nodeId: string;
  status: "pending";
  message: string;
  requestedAt: string;
  expiresAt?: string;
}

interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  version?: string;
  status: WorkflowStatus;
  currentNodes: string[];
  nodeStates: Record<string, WorkflowNodeStateSummary>;
  pendingApprovals: WorkflowApprovalSummary[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: { message: string; nodeId?: string };
}
```

The summary omits run input, output, context, checkpoints, source integration
policy, node input and output, approval payload and decision metadata, and
framework runtime metadata. The dedicated approval-by-ID route remains the
explicit way for `useApproval` to fetch an approval payload.

Errors and approval request messages remain visible because the hooks and SSE
events use them for operations. Do not place secrets, tokens, customer payloads,
or private model output in developer-authored errors or approval messages. The
summary is data-minimized, not guaranteed secret-free.

`WorkflowClient` remains a trusted server-side API and returns the durable full
run state. Do not serialize its run values directly to a browser. If existing
browser code reads `run.input`, `run.output`, `run.context`, node payloads, or
approval payloads from `useWorkflow`, `useWorkflowList`, or the built-in run
routes, move that read to a separately authorized server endpoint. Select only
the fields the application needs. Use `useApproval` for approval payloads.

### Call the hooks across origins

For browser mutations with cookie sessions, use a same-origin proxy and a relative
`apiBase`. The workflow hooks attach the CSRF token only to same-origin requests.
Cross-origin cookies and CORS headers alone do not satisfy the CSRF check, so a
cross-origin start, cancel, or approval request can still receive `403`.

A dedicated cross-origin API may use bearer authentication and a narrowly scoped
CSRF exclusion only when the route authenticates and authorizes every request
independently and never accepts cookie-based authentication. Keep CSRF protection
on browser session routes; see [CSRF requests](./csrf-requests.md).

A cross-origin `apiBase` needs CORS on both the preflight and the actual
response. Configure the global policy with only the application origins you
control and every request header the hooks send:

```ts theme={null}
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  security: {
    cors: {
      origin: "https://app.example.com",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-CSRF-Token"],
      credentials: true,
    },
  },
});
```

`createWorkflowHandler` owns `GET` and `POST`. Export those handlers normally;
Veryfront uses `security.cors` for automatic preflight and for the actual
responses:

```ts theme={null}
// app/api/workflows/[...path]/route.ts
import { createWorkflowHandler } from "veryfront/workflow";
import { getSession } from "../../../../lib/auth.ts";
import { workflows } from "../../../../lib/workflows.ts";

const handlers = createWorkflowHandler(workflows, {
  authorize: async (request) => (await getSession(request))?.user.id ?? null,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
```

Do not wrap these API route responses in a route-local CORS helper. The API
router replaces policy-owned CORS headers with the validated global policy.

Pass an authorization header through the hook `headers` option when the
workflow origin uses bearer authentication. Set `credentials: "include"` only
for a credentialed cookie session; that mode requires the exact-origin
`Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials: true`
settings shown above. The global preflight policy must allow `Content-Type`,
`Authorization`, and any configured CSRF header the client sends.

### Stream run events

Use the SSE route when a dashboard, operator, or CI client needs durable progress
without polling the run endpoint:

```ts
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function observeWorkflowRun(
  runId: string,
  options: { withCredentials?: boolean } = {},
): EventSource {
  const events = new EventSource(
    `/api/workflows/runs/${encodeURIComponent(runId)}/events`,
    { withCredentials: options.withCredentials ?? false },
  );

  events.addEventListener("snapshot", (message) => {
    const run = JSON.parse((message as MessageEvent).data);
    console.log(run.status, run.nodeStates);
    if (TERMINAL_RUN_STATUSES.has(run.status)) events.close();
  });

  for (
    const name of [
      "step.started",
      "step.completed",
      "step.failed",
      "step.skipped",
      "run.status",
      "approval.pending",
    ]
  ) {
    events.addEventListener(name, (message) => {
      const event = JSON.parse((message as MessageEvent).data);
      console.log(name, event);
      if (event.type === "run.status" && TERMINAL_RUN_STATUSES.has(event.status)) {
        events.close();
      }
    });
  }

  events.addEventListener("error", (event) => {
    if (event instanceof MessageEvent) {
      console.error(JSON.parse(event.data));
      events.close();
    }
  });

  return events;
}
```

This native `EventSource` example assumes the handler authorizes a same-origin
cookie session, which the browser sends automatically. For a cross-origin
cookie session, call `observeWorkflowRun(runId, { withCredentials: true })` and
allow credentialed CORS on the workflow origin. Native `EventSource` cannot set
an `Authorization` header. Bearer-token clients must use a fetch-based SSE
client and pass the same authorization header used by the workflow hooks.

The first frame is normally `snapshot`, using the same run summary as
`GET /runs/{runId}`. When the stored run cannot be serialized, the stream opens
with a single `error` frame instead and closes; reconnecting re-reads the same
stored run, so that error is marked not retryable. Later frames use these
shapes:

| Event              | Data                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| `step.started`     | `{ type: "step.started", runId, nodeId, attempt }`                              |
| `step.completed`   | `{ type: "step.completed", runId, nodeId, attempt }`                            |
| `step.failed`      | `{ type: "step.failed", runId, nodeId, attempt, error? }`                       |
| `step.skipped`     | `{ type: "step.skipped", runId, nodeId }`                                       |
| `run.status`       | `{ type: "run.status", runId, status, error? }`                                 |
| `approval.pending` | `{ type: "approval.pending", runId, approvalId, nodeId, message? }`             |
| `error`            | `{ code: "workflow_observation_failed", message, retryable: true }`             |
| `error`            | `{ code: "workflow_snapshot_serialization_failed", message, retryable: false }` |

A run that parks on `waitForApproval` reports `run.status` with `waiting`
first, then `approval.pending` once the approval is persisted. The event names
the blocking approval directly, so a subscriber can render or decide it without
fetching the run's approvals and racing the approval write. Approval payloads
are not part of the stream; fetch the approval by id when the decision needs
them.

Top-level sequential nodes persist `running` before their side effect starts and
persist their settled state before dependents execute. Parallel nodes start as a
batch and settle after the batch joins. Top-level composites report their own
boundaries; synthetic child graphs do not replace the durable root state.

The same boundaries keep `currentNodes` on the run current. While a run is
`running` it names the batch in flight, so a run that stops making progress
shows which step it is on from its persisted state alone. While the run is
`waiting` it names the node the run is parked on, which can be a child of a
composite. It is empty once the run completes. A failed run keeps the nodes in
its terminal batch that failed or were still running. A cancelled run keeps the
last recorded value, so both terminal states still name where execution stopped.

A terminal snapshot closes immediately. A terminal `run.status` frame is the last
transition frame. Cancelling the response or aborting the request releases the
backend observation. An observation failure sends the sanitized `error` frame and
then closes.

The handler admits at most 64 active event streams by default, and at most 8
streams for one authorized identity. These limits are local to the handler
instance. Configure them when mounting the handler if the deployment needs a
different budget:

```ts
export const { GET, POST } = createWorkflowHandler(workflows, {
  authorize: async (request) => (await getSession(request))?.user.id ?? null,
  maxEventStreams: 64,
  maxEventStreamsPerIdentity: 8,
});
```

When either limit is reached, the endpoint returns `429` with a JSON `message`
before opening a backend observation. Treat this as a transient admission
failure and retry with backoff after an existing stream closes. In a deployment
with multiple handler processes, each process enforces its own limits.

Native `EventSource` reconnects automatically when a transport disconnects or a
successful SSE response reaches EOF. The helper calls `close()` for terminal runs
to avoid reconnecting to an already-finished run. A transport failure dispatches
a plain `Event`, which keeps the native reconnect behavior. The server's named
`error` frame dispatches a `MessageEvent`; the helper closes it so the caller can
decide when to retry from a fresh snapshot.

A new connection receives a fresh snapshot and future transitions. It does not
replay transitions that are already represented by that snapshot. A missing run
returns 404. A custom backend that does not implement atomic run observation
returns 501.


## Verify it worked

Mount the handler, render the dashboard, and select **Run Pipeline**. Confirm the run status reaches `completed` and individual node states update. A `401` means authorization failed; a `404` can mean a missing route or a client using a different backend. Check both before changing the UI.

## Related

- [Workflow API](../api-reference/veryfront/workflow.md): Hook and handler options.
