import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createManagedBrokerHandler,
  createManagedDurableBrokerHandler,
} from "#veryfront/agent/service/managed-broker.ts";
import {
  activateHostedAgentPauseCapability,
  inheritHostedAgentPauseCapability,
} from "#veryfront/agent/hosted/manual-pause-credential.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "#veryfront/agent/hosted/managed-executor-broker.ts";
import { managedStart } from "../../fixtures/managed-executor-start.ts";
import {
  options as signedOptions,
  signedRequest,
} from "#veryfront/agent/service/broker-ingress.test-helpers.ts";

for (const mode of ["durable", "signed"] as const) {
  it(`settles the managed ${mode} factory capability after normal session closure`, async () => {
    const session = new AbortController();
    const execution = new AbortController();
    const settled = Promise.withResolvers<void>();
    let capability: ReturnType<typeof activateHostedAgentPauseCapability>;
    let receipts = 0;
    let flushed = false;
    let cleaned = false;
    await withMockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.settled) {
        receipts++;
        assertEquals(session.signal.aborted, true);
        assertEquals(execution.signal.aborted, false);
        assertEquals(flushed && cleaned, true);
      } else {
        assertEquals(body.settlement_required, true);
      }
      return Response.json({ stop: true });
    }, async () => {
      const runtime: ManagedExecutorRuntime = {
        definition: { id: "builder", name: "Builder", description: "Test", instructions: "Test" },
        modelId: "veryfront-cloud/openai/synthetic",
        runtimeKind: "framework",
        accepted: false,
        settled: settled.promise,
        runOwned: (operation) => operation(),
        accept() {},
        close(reason = "canceled") {
          session.abort();
          settled.resolve();
          return Promise.resolve({ reason, release: "released" });
        },
        agent: {
          async stream() {
            if (!capability) throw new Error("Missing admitted pause capability");
            await capability.acknowledge({
              version: 1,
              nextStep: 0,
              messages: [],
              toolCalls: [],
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              latestAssistantText: "",
              completed: false,
              recoveredEmptyResponse: false,
              recoveredInterruptedLocalToolBatch: false,
            });
            capability.persisted?.(true);
            return {
              steps: Promise.resolve([]),
              toUIMessageStream: () =>
                (async function* () {
                  yield { type: "start", messageId: "assistant-message" } as const;
                })(),
            };
          },
        },
      };
      const common = {
        broker: {
          start: async (input: ManagedExecutorStartInput) => {
            capability = activateHostedAgentPauseCapability(input, session.signal);
            inheritHostedAgentPauseCapability(runtime, input);
            return runtime;
          },
        },
        prepare: async () => ({
          start: managedStart({ agentId: "builder" }),
          messages: [],
          executionSignal: execution.signal,
          output: {
            write: async () => {},
            finish: async () => {
              flushed = true;
            },
          },
          cleanup: async () => {
            cleaned = true;
          },
        }),
      };
      const signed = await signedRequest();
      signed.request.headers.set("x-veryfront-run-stop-token", "test-stop");
      const managed = mode === "signed"
        ? createManagedBrokerHandler({
          ...common,
          responseMode: "detached",
          resolveIngressOptions: () => signedOptions(signed.publicKeyPem),
        })
        : createManagedDurableBrokerHandler({
          ...common,
          owner: { scopeKind: "global", serviceName: "test-service" },
          ingress: {
            authenticate: async () => ({
              userId: "00000000-0000-4000-8000-000000000006",
              authToken: "test-auth",
            }),
            verifyProjectAccess: async () => ({ success: true }),
            verifyRunEventAppendToken: async () => true,
          },
        });
      try {
        const response = await managed.handle(
          mode === "signed" ? signed.request : new Request("https://broker.test/api/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-run-event-token": "test-events",
              "x-veryfront-run-stop-token": "test-stop",
            },
            body: JSON.stringify({
              messages: [],
              context: {
                projectId: "00000000-0000-4000-8000-000000000005",
                branchId: "branch-1",
                conversationId: "00000000-0000-4000-8000-000000000001",
              },
              durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
            }),
          }),
        );
        assertEquals(response.status, 202);
        await managed.close();
        assertEquals(receipts, 1);
        assertEquals(managed.active, 0);
      } finally {
        await managed.close();
      }
    });
  });
}
