import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";

import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { AgentStreamHandler } from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import {
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext,
} from "#veryfront/server/handlers/request/agent-stream.handler.test-helpers.ts";
import {
  createAgent,
  createControlPlaneSignature,
  encodeDataStreamEvent,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { getActiveRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { getRuntimeObservationWriterScope } from "#veryfront/runtime/runtime-observation-carrier.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";

const projectId = "10000000-1000-4000-8000-100000000005";
const canonicalRunId = "22222222-2222-4222-8222-222222222222";

for (const testCase of ["valid", "missing-token", "managed-recovery"]) {
  const withToken = testCase !== "missing-token";
  const accepted = testCase === "valid";
  Deno.test(`validates signed project event persistence (${testCase})`, async () => {
    let discoveryCalls = 0;
    let scope: unknown;
    const writes: { headers: Headers; body: Record<string, unknown>; url: string }[] = [];
    let latestEventId = 7;
    let latestExternalSequence = 3;
    const childCase = Deno.env.get("VF_PROJECT_WRITER_CASE");
    if (childCase !== undefined && childCase !== testCase) return;
    const body = Deno.env.get("VF_PROJECT_WRITER_BODY") ?? createAgentStreamRequestBody({
      ...(testCase === "managed-recovery"
        ? {
          project: { projectId, sourceTargetEnvironmentId: "33333333-3333-4333-8333-333333333333" },
          agentSource: { type: "release", releaseId: "44444444-4444-4444-8444-444444444444" },
          credentials: { authToken: "invocation-token" },
          managedRecoveryAdmission: {
            version: 1,
            identity: {
              projectId,
              canonicalRunId,
              publicRunId: "run_1",
              agentId: "assistant-1",
              threadId: "10000000-1000-4000-8000-100000000001",
              sourceHash: "a".repeat(64),
            },
            generation: {
              workerId: "worker-1",
              dispatchNonce: "66666666-6666-4666-8666-666666666666",
              transportRecoveryAttempt: 0,
            },
            acknowledgedExternalSequence: 0,
            leaseRemainingMs: 10000,
            sourceBinding: {
              projectId,
              environmentId: "33333333-3333-4333-8333-333333333333",
              releaseId: "44444444-4444-4444-8444-444444444444",
            },
            eventPersistence: "runtime-owned-v1",
            expiresAt: Math.floor(Date.now() / 1000) + 30,
          },
        }
        : {}),
      platformToolDependencies: [],
      projectEventPersistence: {
        mode: "runtime-owned-v1",
        canonicalRunId,
        latestEventId: 7,
        latestExternalEventSequence: 3,
      },
    });
    const signed = childCase === undefined
      ? await createControlPlaneSignature(body, {
        requestId: "run_1",
        projectId,
        audience: "test-project",
      })
      : {
        jws: Deno.env.get("VF_PROJECT_WRITER_JWS")!,
        publicKeyPem: Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY")!,
      };
    const { jws, publicKeyPem } = signed;
    if (childCase === undefined) {
      const coverageDir = Deno.env.get("DENO_COVERAGE_DIR");
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          "--no-check",
          "--allow-all",
          "--config",
          "deno.json",
          ...(coverageDir ? [`--coverage=${coverageDir}`, "--coverage-raw-data-only"] : []),
          new URL(import.meta.url).pathname,
        ],
        env: {
          DENO_TESTING: "0",
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://8.8.8.8",
          VERYFRONT_API_BASE_URL: "https://8.8.8.8",
          CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: publicKeyPem,
          VF_PROJECT_WRITER_CASE: testCase,
          VF_PROJECT_WRITER_BODY: body,
          VF_PROJECT_WRITER_JWS: jws,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.code,
        0,
        new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr),
      );
      return;
    }
    const handler = new AgentStreamHandler({
      loadAgentSourceEnvironment: () => Promise.resolve({}),
      ensureProjectDiscovery: () => {
        discoveryCalls++;
        return Promise.resolve(createEmptyDiscoveryResult());
      },
      getAgent: () => createAgent("assistant-1"),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: () => {
          scope = getRuntimeObservationWriterScope(getActiveRunEventSink()!);
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "answer" }));
                controller.enqueue(
                  encodeDataStreamEvent({ type: "text-delta", id: "answer", delta: "Done" }),
                );
                controller.enqueue(new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "text-end", id: "answer" })}`,
                ));
                controller.close();
              },
            }),
          );
        },
      }),
    });
    await withMockFetch((url, init) => {
      const observed = observeFetchRequestInit(init);
      const request = JSON.parse(String(observed.body));
      if (!request.events) {
        return Promise.resolve(
          Response.json({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }),
        );
      }
      writes.push({ headers: new Headers(observed.headers), body: request, url: String(url) });
      latestEventId += request.events.length;
      latestExternalSequence += request.events.length;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            latest_event_id: latestEventId,
            latest_external_event_sequence: latestExternalSequence,
            appended_count: request.events.length,
            run: {
              run_id: "run_1",
              conversation_id: "10000000-1000-4000-8000-100000000001",
              latest_event_id: latestEventId,
              latest_external_event_sequence: latestExternalSequence,
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }, async () => {
      const result = await handler.handle(
        sealIngressCredentials(
          new Request("https://example.com/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              "x-veryfront-control-plane-jws": jws,
              "x-veryfront-run-terminal-token": "terminal-token",
              ...(withToken ? { "x-veryfront-run-event-token": "writer-only-token" } : {}),
            },
            body,
          }),
        ),
        {
          ...createSourceCapableAgentStreamContext(publicKeyPem),
          projectId,
          projectSlug: "test-project",
        },
      );
      assertExists(result.response);
      assertEquals(result.response.status, accepted ? 200 : 500);
      const output = await result.response.text();
      if (accepted) assertStringIncludes(output, "Done", JSON.stringify(writes));
    });
    assertEquals(discoveryCalls, accepted ? 1 : 0);
    if (accepted) {
      assertEquals(scope, { runId: "run_1", canonicalRunId, projectId });
      assertEquals(writes.length > 0, true);
      assertEquals(
        writes.every((write) => write.headers.get("authorization") === "Bearer writer-only-token"),
        true,
      );
      assertEquals(writes.every((write) => write.url.includes(canonicalRunId)), true);
      assertEquals(writes[0]!.body.expected_previous_external_event_sequence, 3);
      assertEquals(
        writes.flatMap((write) => write.body.events as Array<{ type?: string }>).some((event) =>
          event.type === "TEXT_MESSAGE_END"
        ),
        true,
      );
    } else assertEquals(writes, []);
  });
}
