---
title: "Connect a runtime"
description: "Connect a local or self-hosted Veryfront agent runtime to a project and inspect its runs."
order: 59
---

Connect a developer-owned Veryfront runtime to a project with the external
worker client. Registration binds the worker to the project. The API admits
the run, and a worker claim provides the authority to append events and finish
that run. The client keeps those credentials private.

This guide runs one Veryfront agent from a route served by `veryfront dev`.
The same route works on a self-hosted Veryfront server. The runtime initiates
outbound requests, so a local runtime does not need a public tunnel. For a
push service with a public endpoint and an immutable deployment source, use
[Agent service runtime](./agent-service-runtime.md).

## Prerequisites

- A Veryfront project with `veryfront` installed.
- A token with project editor access (to create the conversation and root run)
  and `project.runtime.manage` permission (to register and manage the worker).
- An inference provider configured for the local runtime. See
  [Providers](./providers.md).
- The project UUID. Keep the API token on the server.
- The framework default CSRF names: cookie `__Host-vf_csrf` and header
  `x-csrf-token`. The curl commands below require those defaults; projects with
  custom CSRF names must adapt the cookie lookup and header to their configuration.

Set these values in your project environment:

```bash
export VERYFRONT_API_URL="https://api.example.com"
export VERYFRONT_API_TOKEN="<TOKEN>"
export VERYFRONT_PROJECT_ID="<PROJECT_ID>"
```

Use the API origin for your deployment without an `/api` suffix. Do not put
these credentials in browser code, event payloads, or source control.

## Add the runtime route

Create `app/api/runtime/route.ts`:

```ts
import {
  agent,
  ConversationRunEventEncoder,
  createExternalAgentWorkerClient,
} from "veryfront/agent";
import { getEnv } from "veryfront/platform";

const assistant = agent({
  id: "runtime-assistant",
  system: "Reply with one short greeting.",
  tools: {},
  skills: [],
  maxSteps: 1,
});

export async function POST(request: Request): Promise<Response> {
  const apiUrl = getEnv("VERYFRONT_API_URL")?.replace(/\/$/, "");
  const token = getEnv("VERYFRONT_API_TOKEN");
  const projectId = getEnv("VERYFRONT_PROJECT_ID");
  if (!apiUrl || !token || !projectId) {
    return Response.json({ error: "Missing runtime connection settings" }, { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  async function api<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        ...extraHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Runtime API request failed: ${response.status}`);
    return await response.json() as T;
  }

  const client = createExternalAgentWorkerClient({ apiUrl, authToken: token });
  // Each demonstration gets its own worker so another process cannot claim it.
  const workerKey = `runtime-demo:${crypto.randomUUID()}`;
  const worker = await client.registerWorker({
    projectReference: projectId,
    implementationKind: "veryfront-local",
    implementationDisplayName: "Veryfront local runtime",
    workerKey,
    displayName: "Runtime connection demo",
  });
  await client.heartbeatWorker(worker.id);

  const conversation = await api<{ id: string }>("/conversations", {
    project_reference: projectId,
    title: "Runtime connection demo",
  });
  const prompt = "Say hello to the teammate inspecting this run.";
  const admissionKey = crypto.randomUUID();
  const accepted = await api<{ id: string }>("/runs", {
    project_id: projectId,
    conversation_id: conversation.id,
    title: "Runtime connection demo",
    target: { type: "agent", id: assistant.id },
    input: prompt,
    config: {
      agent_admission: {
        mode: "worker",
        implementation_kind: "veryfront-local",
        worker_key: workerKey,
      },
    },
  }, { "Idempotency-Key": admissionKey });
  const run = await client.claimRun({ workerId: worker.id, leaseDurationSeconds: 60 });
  if (!run) {
    return Response.json({
      error: "The admitted run is not currently claimable; inspect it before resuming this worker",
      worker_id: worker.id,
      run_id: accepted.id,
      conversation_id: conversation.id,
    }, { status: 502 });
  }

  let output: string;
  try {
    // This bounded, one-step demonstration finishes before the 60-second lease.
    const result = await assistant.generate({
      input: prompt,
      abortSignal: AbortSignal.timeout(20_000),
    });
    output = result.text;
    const messageId = run.message_id;
    const encoder = new ConversationRunEventEncoder();
    const events = [
      ...encoder.encode({ type: "start", messageId }),
      ...encoder.encode({ type: "text-start", id: messageId }),
      ...encoder.encode({ type: "text-delta", id: messageId, delta: result.text }),
      ...encoder.encode({ type: "text-end", id: messageId }),
    ];
    await client.appendRunEvents({
      conversationId: run.conversation_id,
      runId: run.run_id,
      events,
      expectedPreviousExternalEventSequence: run.latest_external_event_sequence,
    });
  } catch {
    await client.completeRun({
      runId: run.run_id,
      status: "failed",
      terminalErrorCode: "RUNTIME_DEMO_FAILED",
      terminalErrorMessage: "The runtime connection demo failed",
    });
    return Response.json({ error: "Runtime demo failed", run_id: accepted.id }, {
      status: 502,
    });
  }

  // Keep completion outside the generation/event failure handler: never change
  // an ambiguous completed outcome to failed. Read the canonical run instead.
  const identities = {
    worker_id: worker.id,
    run_id: accepted.id,
    conversation_id: conversation.id,
  };
  try {
    await client.completeRun({ runId: run.run_id, status: "completed", output });
  } catch {
    return Response.json({ ...identities, error: "Read the run to confirm completion" }, {
      status: 502,
    });
  }
  return Response.json(identities);
}
```

The route requires the project credential before it registers a worker or
creates a run. Use this route as an operator-only demonstration. A deployed
application should use its own operator authorization instead of sharing the
project credential with browser users.

The example records the final text with the existing framework event encoder.
It does not stream intermediate tool calls or reasoning. Event appends do not
complete the run: `completeRun` performs the terminal operation using the
claim's separate terminal credential. See the
[`veryfront/agent` API reference](../api-reference/veryfront/agent.md).

The canonical request selects an agent with `target` and records its prompt as
`input`. `config.agent_admission` selects the conversation-owned worker path.
Use the registered worker's implementation kind and worker key. A bare
`execution.runtime` override is not supported by this admission path.

## Start and execute the runtime

1. Start the local runtime:

   ```bash
   veryfront dev
   ```

2. In another terminal with `VERYFRONT_API_TOKEN` set, execute the agent:

   ```bash
   RUNTIME_URL=http://localhost:3000
   RUNTIME_COOKIE_JAR=$(mktemp)
   curl --fail-with-body --silent --show-error \
     -H "Accept: text/html" -c "$RUNTIME_COOKIE_JAR" "$RUNTIME_URL/" > /dev/null
   RUNTIME_CSRF_TOKEN=$(awk '$6 == "__Host-vf_csrf" { print $7 }' "$RUNTIME_COOKIE_JAR")
   curl --fail-with-body --silent --show-error \
     -X POST "$RUNTIME_URL/api/runtime" \
     -b "$RUNTIME_COOKIE_JAR" \
     -H "x-csrf-token: $RUNTIME_CSRF_TOKEN" \
     -H "Authorization: Bearer $VERYFRONT_API_TOKEN"
   rm "$RUNTIME_COOKIE_JAR"
   ```

   Veryfront checks CSRF in local development. The initial GET obtains the
   runtime cookie; the POST sends its matching `x-csrf-token` header.

   The response contains `worker_id`, `conversation_id`, and the canonical `run_id`. It contains no
   worker token or run credential. Keep the returned run ID for verification.

For a self-hosted runtime, build and start the same project with the normal
Veryfront production commands and call its authenticated `/api/runtime` route.
Use HTTPS for a remote runtime. The runtime still connects outbound to the
project's API origin.

## Verify it worked

1. Read the run independently. Set `RUN_ID` to the returned run ID:

   ```bash
   curl --fail-with-body --silent --show-error \
     "$VERYFRONT_API_URL/runs/$RUN_ID" \
     -H "Authorization: Bearer $VERYFRONT_API_TOKEN"
   ```

   Verify `status` is `completed`, `conversation_id` matches the returned conversation, and
   `output` is the agent's greeting.

2. Read its stored events:

   ```bash
   curl --fail-with-body --silent --show-error \
     "$VERYFRONT_API_URL/runs/$RUN_ID/events" \
     -H "Authorization: Bearer $VERYFRONT_API_TOKEN"
   ```

   Verify the assistant message start, content, and end events are present.
   The content matches the run output. The API assigns durable event IDs.

3. Open the same project in Studio. Open its Runs panel and select the returned
   run. Verify the completed status, output, and recorded message events.

See [Runs](./runs.md) for additional read and inspection operations.

## Operate a long-running worker

The demonstration claims and executes one short run per request. A persistent
worker must heartbeat its registration, claim only its implementation and
worker key, and call `renewLease` before the active lease expires. The client
replaces its private run credentials when renewal returns fresh authority.
Stop execution when renewal returns `null`, cancellation is reported, or
ownership cannot be confirmed. Pass an abort signal to your agent.

Never reuse a claim after lease loss or use the project token to replace a
missing event or terminal credential. Do not retry user execution after an
ambiguous terminal response without an idempotency strategy. Retire demo
workers through `DELETE /agent-workers/workers/<WORKER_ID>` when finished.
