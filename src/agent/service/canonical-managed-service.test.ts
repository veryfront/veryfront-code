import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  readIngressCredential,
  sealIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import { createCanonicalManagedBrokerService } from "./canonical-managed-service.ts";
import { managedStart } from "../../../tests/fixtures/managed-executor-start.ts";
import {
  invocation,
  options,
  projectId,
  signedRequest,
  userId,
} from "./broker-ingress.test-helpers.ts";
import type { ManagedExecutorRuntime } from "../hosted/managed-executor-broker.ts";
import type { ExecutorToolCapability } from "../hosted/executor-tool-bridge.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";

const canonicalId = "30000000-3000-4000-8000-300000000001";
const sourceId = "00000000-0000-4000-8000-000000000099";

// Synthetic executor and API transports exercise the real canonical adapter,
// persistence and run owner. Real executor-session behavior is tested separately.
async function fixture(
  mode: "cancel" | "resume" | "api-tools" = "cancel",
  holdCleanup = false,
  prepareFailure?: { value: unknown },
  negotiate = true,
) {
  const base = invocation();
  const body = invocation({
    run: {
      ...base.run,
      eventCursor: {
        canonicalRunId: canonicalId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
      },
      project: { ...base.run.project, runtimeTargetBranchName: "main" },
    },
    sourceProject: {
      projectId: sourceId,
      projectSlug: "private-source",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
      runtimeTargetEnvironmentName: "Production",
    },
    agentEntrypoint: { path: "agents/selected.ts" },
    ...(mode === "api-tools"
      ? { tools: [{ name: "review_claim", parameters: { type: "object" } }] }
      : {}),
    credentials: {
      authToken: "api-auth-token",
      sourceAuthToken: "source-read-token",
      inferenceAuthToken: "inference-token",
    },
  });
  if (negotiate) {
    Object.assign(body, {
      projectEventPersistence: {
        mode: "runtime-owned-v1",
        canonicalRunId: canonicalId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
      },
      platformToolDependencies: [],
    });
  }
  const signed = await signedRequest(body, { projectId: sourceId, audience: "private-source" });
  const terminal = `header.${
    btoa(
      JSON.stringify({
        runId: "run-1",
        canonicalRunId: canonicalId,
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        dispatchNonce: "33333333-3333-4333-8333-333333333333",
      }),
    )
  }.signature`;
  signed.request.headers.set("x-veryfront-run-terminal-token", terminal);
  const entered = Promise.withResolvers<void>(),
    cleanupEntered = Promise.withResolvers<void>(),
    cleanupRelease = Promise.withResolvers<void>();
  const finalizations: string[] = [], resumed: AgUiResumeValue[] = [];
  const executionController = new AbortController();
  const runtimeController = new AbortController();
  let prepared = 0, started = 0, cleaned = 0, cursor = 0;
  let signal: AbortSignal | undefined;
  let apiTools: ExecutorToolCapability | undefined;
  let wait: ((toolCallId: string) => Promise<AgUiResumeValue>) | undefined;
  const service = createCanonicalManagedBrokerService({
    responseMode: "sse",
    apiUrl: "https://api.example.test",
    resolveProvider: () => "openai",
    auth: {
      async authenticateRequest(request) {
        assertEquals(request.headers.get("authorization"), null);
        const value = readIngressCredential(request, "authorization");
        return value === "Bearer control-token"
          ? { userId: "controller", authToken: "control-token" }
          : Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 });
      },
      verifyRunCancellationToken: async (input) =>
        input.token === "control-token" && input.runId === "run-1",
      verifyRunResumeToken: async (input) =>
        input.token === "control-token" && input.runId === "run-1",
    },
    resolveIngressOptions: () => ({
      ...options(signed.publicKeyPem),
      projectId: sourceId,
      audience: "private-source",
      expectedOwner: { scopeKind: "project", projectId: sourceId },
    }),
    fetch: async (request, init) => {
      const r = new Request(request, init), url = new URL(r.url);
      assertEquals(
        r.headers.get("authorization"),
        url.pathname.endsWith("/events") ? "Bearer run-event-token" : "Bearer api-auth-token",
      );
      if (url.pathname.endsWith("/runtime/admission")) {
        assertEquals(r.headers.get("x-veryfront-run-terminal-token"), terminal);
        assertEquals(await r.json(), { latest_event_id: 0, latest_external_event_sequence: 0 });
        return Response.json({
          version: 1,
          accepted: true,
          identity: {
            project_id: projectId,
            canonical_run_id: canonicalId,
            public_run_id: base.run.runId,
          },
          generation: {
            worker_id: "worker",
            dispatch_nonce: "33333333-3333-4333-8333-333333333333",
            transport_recovery_attempt: 0,
          },
          lease_remaining_ms: 1000,
          acknowledged_event_id: 0,
          acknowledged_external_sequence: 0,
        });
      }
      if (r.method === "GET") return Response.json({ id: canonicalId, status: "running" });
      if (url.pathname.endsWith("/events")) {
        const value = await r.json();
        cursor += value.events.length;
        return Response.json({
          run_id: canonicalId,
          latest_event_id: cursor,
          latest_external_event_sequence: 0,
          appended_count: value.events.length,
        });
      }
      assertEquals(r.headers.get("x-veryfront-run-terminal-token"), terminal);
      const status = url.pathname.endsWith("/cancel") ? "cancelled" : (await r.json()).status;
      finalizations.push(status);
      return Response.json({ id: canonicalId, status });
    },
    async prepareExecutor(input) {
      prepared++;
      signal = input.signal;
      wait = input.waitForToolResult;
      apiTools = input.apiTools;
      if (prepareFailure) throw prepareFailure.value;
      const start = managedStart({ agentId: "builder" });
      start.trustedRuntime = {
        projectToolNames: [],
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      };
      start.installation.owner = { scopeKind: "project", projectId: sourceId };
      start.installation.agentEntrypoint = { path: "agents/selected.ts" };
      start.installation.grant.execution = {
        kind: "canonical",
        providerReplay: "disabled",
        projectId,
        conversationId: base.run.conversationId,
        runId: "run-1",
        messageId: base.run.messageId,
        userId,
        projectSlug: "demo-project",
      };
      return {
        start,
        messages: [],
        executionSignal: executionController.signal,
        async cleanup() {
          cleaned++;
          cleanupEntered.resolve();
          if (holdCleanup) await cleanupRelease.promise;
        },
      };
    },
    broker: {
      async start(input) {
        started++;
        if (mode === "api-tools") {
          assertEquals(
            input.tools.sources.size,
            0,
            "Providing a capability must not grant tools automatically",
          );
        }
        input.bindSessionOwnedWork!((operation) => operation());
        const settled = Promise.withResolvers<void>();
        let sourceEnded = false, closeRequested = false;
        const runtime: ManagedExecutorRuntime = {
          definition: { id: "builder", name: "Builder", description: "", instructions: "Work" },
          modelId: input.installation.grant.defaultModelId,
          runtimeKind: "framework",
          accepted: false,
          signal: AbortSignal.any([input.session.preparationSignal!, runtimeController.signal]),
          settled: settled.promise,
          runOwned: (operation) => operation(),
          accept() {
            Object.defineProperty(runtime, "accepted", { value: true });
          },
          close(reason = "canceled") {
            closeRequested = true;
            runtimeController.abort();
            if (sourceEnded) settled.resolve();
            return Promise.resolve({ reason, release: "released" });
          },
          agent: {
            async stream() {
              return {
                steps: Promise.resolve([]),
                toUIMessageStream() {
                  return (async function* () {
                    try {
                      yield { type: "start", messageId: base.run.messageId } as const;
                      if (mode === "resume" || mode === "api-tools") {
                        const result = mode === "api-tools"
                          ? apiTools!.source.executeTool("review_claim", {}, {
                            ...apiTools!.context,
                            toolCallId: "tool_1",
                          })
                            .then((result) => ({ result, isError: false }))
                          : wait!("tool_1");
                        entered.resolve();
                        resumed.push(await result);
                        yield { type: "text-start", id: "text" } as const;
                        yield { type: "text-delta", id: "text", delta: "Approved" } as const;
                        yield { type: "text-end", id: "text" } as const;
                        yield { type: "finish", finishReason: "stop" } as const;
                      } else {
                        entered.resolve();
                        if (!runtime.signal.aborted) {
                          await new Promise<void>((resolve) =>
                            runtime.signal.addEventListener("abort", () => resolve(), {
                              once: true,
                            })
                          );
                        }
                        throw new DOMException("Execution canceled", "AbortError");
                      }
                    } finally {
                      sourceEnded = true;
                      if (closeRequested) settled.resolve();
                    }
                  })();
                },
              };
            },
          },
        };
        return runtime;
      },
    },
  });
  async function control(operation: "cancel" | "resume", value: unknown, target = "run-1") {
    const request = sealIngressCredentials(
      new Request(
        `https://broker.test/api/control-plane/runs/${target}${
          operation === "resume" ? "/resume" : ""
        }`,
        {
          method: operation === "resume" ? "POST" : "DELETE",
          headers: { authorization: "Bearer control-token", "content-type": "application/json" },
          body: JSON.stringify(value),
        },
      ),
    );
    return service[operation].handle(request, { runId: target });
  }
  return {
    service,
    entered: entered.promise,
    cleanupEntered: cleanupEntered.promise,
    release: () => cleanupRelease.resolve(),
    finalizations,
    resumed,
    control,
    start: (requestSignal?: AbortSignal) =>
      service.handle(
        sealIngressCredentials(
          new Request(signed.request.clone(), {
            ...(requestSignal ? { signal: requestSignal } : {}),
          }),
        ),
      ),
    abortExecution: () => executionController.abort(),
    abortRuntime: () => runtimeController.abort(),
    get signal() {
      return signal;
    },
    get prepared() {
      return prepared;
    },
    get started() {
      return started;
    },
    get cleaned() {
      return cleaned;
    },
    lateWait: () => wait!("late_tool"),
    get apiTools() {
      return apiTools!;
    },
  };
}

describe("canonical managed service ownership", () => {
  it("binds API-declared tools to the same authenticated resume owner and retires the capability", async () => {
    const f = await fixture("api-tools", true);
    let reading: Promise<string> | undefined;
    try {
      const response = await f.start();
      assertEquals(response.status, 200);
      reading = response.text();
      await f.entered;
      assertEquals(f.apiTools.context.projectId, projectId);
      assertEquals([...f.apiTools.allowedToolNames], ["review_claim"]);
      const result = { type: "tool_result", toolCallId: "tool_1", result: { approved: true } };
      assertEquals((await f.control("resume", result, "run_foreign")).status, 403);
      assertEquals((await f.control("resume", result)).status, 200);
      await f.cleanupEntered;
      f.release();
      assert((await reading).includes("event: RunFinished"));
      assertEquals(f.resumed, [{ result: { approved: true }, isError: false }]);
      await assertRejects(
        () => f.apiTools.source.listTools(f.apiTools.context),
        Error,
        "ownership has ended",
      );
      await assertRejects(() =>
        f.apiTools.source.executeTool("review_claim", {}, {
          ...f.apiTools.context,
          toolCallId: "late",
        })
      );
    } finally {
      f.release();
      await f.service.close();
      await reading;
    }
  });

  for (const cancellation of ["request", "execution", "runtime", "body"] as const) {
    it(`retires a pending host-tool wait on ${cancellation} cancellation`, async () => {
      const f = await fixture("resume");
      const requestController = new AbortController();
      let reading: Promise<unknown> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await f.start(requestController.signal);
        assertEquals(response.status, 200);
        if (cancellation !== "body") reading = response.text();
        await f.entered;
        assertEquals(f.service.active, 1);
        if (cancellation === "request") requestController.abort();
        else if (cancellation === "execution") f.abortExecution();
        else if (cancellation === "runtime") f.abortRuntime();
        else reading = response.body!.cancel();
        await Promise.race([
          reading,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Tool wait retained canceled execution")),
              1000,
            );
          }),
        ]);
        assertEquals(f.service.active, 0);
        assertEquals(f.cleaned, 1);
        assertEquals(f.resumed, []);
      } finally {
        clearTimeout(timer);
        f.release();
        await f.service.close();
        await reading?.catch(() => {});
      }
    });
  }

  it("refuses an unnegotiated API invocation before policy preparation or allocation", async () => {
    const f = await fixture("cancel", false, undefined, false);
    try {
      assertEquals((await f.start()).status, 503);
      assertEquals(f.prepared, 0);
      assertEquals(f.started, 0);
    } finally {
      await f.service.close();
    }
  });

  it("cancels the admitted run and confirms stopped only after cleanup settles", async () => {
    const f = await fixture("cancel", true);
    let reading: Promise<string> | undefined;
    try {
      const response = await f.start();
      assertEquals(response.status, 200);
      reading = response.text();
      await f.entered;
      const foreign = await f.control("cancel", {}, "run_foreign");
      assertEquals(foreign.status, 403);
      assertEquals(f.signal?.aborted, false);
      const cancel = await f.control("cancel", { confirmStopped: true });
      assertEquals(cancel.status, 202);
      assertEquals(await cancel.json(), { accepted: true, stopped: false });
      assertEquals(f.signal?.aborted, true);
      await f.cleanupEntered;
      assertEquals(f.service.active, 1);
      f.release();
      await reading;
      const stopped = await f.control("cancel", { confirmStopped: true });
      assertEquals(stopped.status, 200);
      assertEquals(await stopped.json(), { accepted: true, stopped: true });
      assertEquals(f.finalizations, []);
      assertEquals(f.cleaned, 1);
    } finally {
      f.release();
      await f.service.close();
      await reading;
    }
  });
  for (const value of [new Error("Synthetic policy failure"), undefined]) {
    it(`retires ownership after a preparation rejection (${value === undefined ? "undefined" : "error"})`, async () => {
      const f = await fixture("cancel", false, { value });
      try {
        const response = await f.start();
        assertEquals(response.status, 500);
        assertEquals(f.started, 0);
        assertEquals(f.service.active, 0);
        const stopped = await f.control("cancel", { confirmStopped: true });
        assertEquals(stopped.status, 200);
        assertEquals(await stopped.json(), { accepted: true, stopped: true });
      } finally {
        await f.service.close();
      }
      assertEquals((await f.control("cancel", {})).status, 503);
    });
  }
  it("retains a pre-start cancellation so a delayed valid invocation cannot allocate", async () => {
    const f = await fixture();
    try {
      await f.control("cancel", {});
      const response = await f.start();
      assertEquals(response.status, 409);
      assertEquals(f.prepared, 0);
      assertEquals(f.started, 0);
    } finally {
      await f.service.close();
    }
  });
  it("resumes the same owner, preserves duplicate/conflict semantics and retires its host callback", async () => {
    const f = await fixture("resume", true);
    let reading: Promise<string> | undefined;
    const result = { type: "tool_result", toolCallId: "tool_1", result: { approved: true } };
    try {
      const response = await f.start();
      assertEquals(response.status, 200);
      reading = response.text();
      await f.entered;
      assertEquals((await f.control("resume", result, "run_foreign")).status, 403);
      assertEquals((await f.control("resume", result)).status, 200);
      await f.cleanupEntered;
      assertEquals((await f.control("resume", result)).status, 200);
      assertEquals(
        (await f.control("resume", { ...result, result: { approved: false } })).status,
        409,
      );
      f.release();
      const wire = await reading;
      assert(wire.includes("event: RunFinished"));
      assertEquals(f.resumed, [{ result: { approved: true }, isError: false }]);
      assertEquals(f.finalizations, []);
      assertThrows(() => f.lateWait(), Error, "ownership has ended");
    } finally {
      f.release();
      await f.service.close();
      await reading;
    }
  });
});
