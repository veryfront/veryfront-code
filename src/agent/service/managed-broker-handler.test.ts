import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "../hosted/managed-executor-broker.ts";
import { createManagedBrokerHandler } from "./managed-broker-handler.ts";
import { ExecutorAgentError } from "../hosted/executor-agent-schema.ts";
import { resolveConversationHostedStreamErrorState } from "../conversation/hosted-terminal.ts";
import { agUiSseEventTypes, parseAgUiSseResponse } from "../ag-ui/sse-parser.ts";

const projectId = "00000000-0000-4000-8000-000000000005";
const userId = "00000000-0000-4000-8000-000000000006";
const path = "/api/control-plane/runs/run-1/stream";

async function request(signal?: AbortSignal) {
  const body = JSON.stringify({
    run: {
      agentServiceId: "service-1",
      agentId: "builder",
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "run-1",
      messageId: "00000000-0000-4000-8000-000000000002",
      inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
      requestedByUserId: userId,
      project: { projectId, projectSlug: "demo-project", runtimeTargetKind: "main_branch" },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: { type: "release", releaseId: "release-1" },
    credentials: { authToken: "api-token", inferenceAuthToken: "inference-token" },
  });
  const signed = await createControlPlaneSignature(body, {
    audience: "demo-project",
    projectId,
    requestId: "run-1",
    requestPath: path,
  });
  return {
    publicKeyPem: signed.publicKeyPem,
    request: new Request(`https://broker.test${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer broker-token",
        "x-veryfront-control-plane-jws": signed.jws,
        "x-veryfront-run-event-token": "event-token",
      },
      body,
      signal,
    }),
  };
}

function runtimeFixture(
  streamFailure = false,
  terminalChunk?: "error" | "coded-error" | "finish-error",
  finishWithUsage?: true,
) {
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const acceptKinds: string[] = [];
  const closeReasons: string[] = [];
  let streamCalls = 0;
  const runtime: ManagedExecutorRuntime = {
    definition: { id: "builder", name: "Builder", description: "Builds", instructions: "Work" },
    modelId: "veryfront-cloud/openai/synthetic",
    runtimeKind: "framework",
    accepted: false,
    settled: settled.promise,
    runOwned: (operation) => operation(),
    accept(ownership) {
      acceptKinds.push(ownership.kind);
      Object.defineProperty(runtime, "accepted", { value: true });
    },
    close(reason = "canceled") {
      closeReasons.push(reason);
      settled.resolve();
      return Promise.resolve({ reason, release: "released" });
    },
    agent: {
      async stream() {
        streamCalls++;
        return {
          steps: Promise.resolve([]),
          toUIMessageStream(streamOptions = {}) {
            return (async function* () {
              await release.promise;
              if (streamFailure) throw new Error("synthetic stream failure");
              if (terminalChunk === "error") {
                yield { type: "error", errorText: "ordinary stream error" } as const;
                return;
              }
              if (terminalChunk === "coded-error") {
                yield {
                  type: "error",
                  errorText: "INSUFFICIENT_CREDITS",
                  code: "INSUFFICIENT_CREDITS",
                } as const;
                return;
              }
              if (terminalChunk === "finish-error") {
                yield { type: "finish", finishReason: "error" } as const;
                return;
              }
              if (finishWithUsage) {
                const part = {
                  type: "finish" as const,
                  finishReason: "stop" as const,
                  totalUsage: {
                    inputTokens: 12,
                    outputTokens: 7,
                    usageCaptureStatus: "complete" as const,
                  },
                };
                yield { type: "text-delta", id: "assistant-message", delta: "done" } as const;
                yield {
                  type: "finish",
                  finishReason: "stop",
                  messageMetadata: streamOptions.messageMetadata?.({ part }),
                } as const;
                return;
              }
              yield { type: "start", messageId: "assistant-message" } as const;
            })();
          },
        };
      },
    },
  };
  return {
    runtime,
    release: release.resolve,
    acceptKinds,
    closeReasons,
    get streamCalls() {
      return streamCalls;
    },
  };
}

async function handler(
  mode: "detached" | "sse",
  options: {
    signal?: AbortSignal;
    failStart?: boolean;
    admitBeforeFailure?: boolean;
    waitForPrepare?: boolean;
    waitForAuthorization?: boolean;
    throwingObserver?: boolean;
    streamFailure?: boolean;
    terminalChunk?: "error" | "coded-error" | "finish-error";
    finishWithUsage?: true;
    missingOutput?: boolean;
    waitForOutput?: boolean;
    startError?: Error;
  } = {},
) {
  const first = await request(options.signal);
  const fixture = runtimeFixture(
    options.streamFailure,
    options.terminalChunk,
    options.finishWithUsage,
  );
  let prepareCalls = 0;
  let brokerStarts = 0;
  let cleanupCalls = 0;
  const outputChunks: string[] = [];
  const outputFinishes: boolean[] = [];
  const outputFinishErrors: unknown[] = [];
  const outputFinishMetadata: unknown[] = [];
  const outputRelease = Promise.withResolvers<void>();
  let prepareSignal: AbortSignal | undefined;
  const prepareEntered = Promise.withResolvers<void>();
  const prepareRelease = Promise.withResolvers<void>();
  const authorizationEntered = Promise.withResolvers<void>();
  const authorizationRelease = Promise.withResolvers<void>();
  const admitted = Promise.withResolvers<void>();
  const executionController = new AbortController();
  const managed = createManagedBrokerHandler({
    responseMode: mode,
    broker: {
      start: (start, lifecycle) => {
        brokerStarts++;
        prepareSignal = start.session.preparationSignal;
        if (options.admitBeforeFailure) lifecycle?.onAdmitted?.(admitted.promise);
        return options.failStart
          ? Promise.reject(options.startError ?? new Error("synthetic start failure"))
          : Promise.resolve(fixture.runtime);
      },
    },
    resolveIngressOptions: () => ({
      publicKeyPem: first.publicKeyPem,
      audience: "demo-project",
      projectId,
      expectedSurface: "studio",
      boundSource: { type: "release", releaseId: "release-1" },
      expectedOwner: { scopeKind: "project", projectId },
      authorizeScope: async () => {
        authorizationEntered.resolve();
        if (options.waitForAuthorization) await authorizationRelease.promise;
        return { userId };
      },
    }),
    prepare: async ({ signal }) => {
      prepareCalls++;
      prepareSignal = signal;
      prepareEntered.resolve();
      if (options.waitForPrepare) await prepareRelease.promise;
      return {
        start: { session: {} } as ManagedExecutorStartInput,
        messages: [],
        executionSignal: executionController.signal,
        output: options.missingOutput ? undefined : {
          async write(chunk: { type: string }) {
            outputChunks.push(chunk.type);
          },
          async finish(outcome: { completed: boolean; error?: unknown; metadata?: unknown }) {
            outputFinishes.push(outcome.completed);
            outputFinishErrors.push(outcome.error);
            outputFinishMetadata.push(outcome.metadata);
            if (options.waitForOutput) await outputRelease.promise;
          },
        },
        cleanup: async () => {
          cleanupCalls++;
        },
      };
    },
    onExecutionError: options.throwingObserver
      ? () => {
        throw new Error("observer");
      }
      : undefined,
  });
  return {
    first,
    fixture,
    managed,
    admitted: admitted.resolve,
    prepareEntered: prepareEntered.promise,
    releasePrepare: prepareRelease.resolve,
    authorizationEntered: authorizationEntered.promise,
    releaseAuthorization: authorizationRelease.resolve,
    outputChunks,
    outputFinishes,
    outputFinishErrors,
    outputFinishMetadata,
    releaseOutput: outputRelease.resolve,
    abortExecution: () => executionController.abort(),
    get prepareCalls() {
      return prepareCalls;
    },
    get brokerStarts() {
      return brokerStarts;
    },
    get cleanupCalls() {
      return cleanupCalls;
    },
    get prepareSignal() {
      return prepareSignal;
    },
  };
}

describe("managed broker handler", () => {
  it("preserves typed executor failure statuses on both response modes", async () => {
    for (const mode of ["detached", "sse"] as const) {
      const f = await handler(mode, {
        failStart: true,
        startError: new ExecutorAgentError("INSUFFICIENT_CREDITS"),
      });
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 402);
      assertEquals(await response.json(), { errorCode: "INSUFFICIENT_CREDITS" });
      await f.managed.close();
    }
  });
  it("requires a durable output writer before allocating a detached run", async () => {
    const f = await handler("detached", { missingOutput: true });
    try {
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 500);
      assertEquals(f.brokerStarts, 0);
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("persists detached output and retains retirement until the final write settles", async () => {
    const f = await handler("detached", { waitForOutput: true });
    try {
      assertEquals((await f.managed.handle(f.first.request)).status, 202);
      f.fixture.release();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(f.outputChunks, ["start"]);
      assertEquals(f.outputFinishes, [true]);
      assertEquals(f.fixture.closeReasons, []);
      assertEquals(f.managed.active, 1);
    } finally {
      f.releaseOutput();
      f.fixture.release();
      await f.managed.close();
    }
    assertEquals(f.cleanupCalls, 1);
  });
  it("preserves detached finish usage metadata for durable finalization", async () => {
    const f = await handler("detached", { finishWithUsage: true });
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.outputFinishMetadata, [{
      modelId: "veryfront-cloud/openai/synthetic",
      usage: { inputTokens: 12, outputTokens: 7 },
      usageCaptureStatus: "complete",
    }]);
  });
  it("transfers detached ownership before 202 and prevents duplicate allocation", async () => {
    const f = await handler("detached");
    const duplicateRequest = f.first.request.clone();
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 202);
    assertEquals(await response.json(), { accepted: true, duplicate: false });
    assertEquals(f.fixture.acceptKinds, ["execution"]);
    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(await duplicate.json(), { accepted: true, duplicate: true });
    assertEquals(f.prepareCalls, 1);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["completed"]);
  });

  it("does not acknowledge a duplicate while the original run is still pending admission", async () => {
    const f = await handler("detached", { waitForPrepare: true, failStart: true });
    const duplicateRequest = f.first.request.clone();
    const original = f.managed.handle(f.first.request);
    await f.prepareEntered;

    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(duplicate.status, 409);
    assertEquals(await duplicate.json(), { errorCode: "BROKER_RUN_PENDING" });
    assertEquals(f.prepareCalls, 1);

    f.releasePrepare();
    assertEquals((await original).status, 500);
    assertEquals(f.managed.active, 0);
    await f.managed.close();
  });

  it("marks ordinary error chunks and error finish reasons as failed durable output", async () => {
    for (const terminalChunk of ["error", "finish-error"] as const) {
      const f = await handler("detached", { terminalChunk });
      assertEquals((await f.managed.handle(f.first.request)).status, 202);
      f.fixture.release();
      await f.managed.close();

      assertEquals(f.outputFinishes, [false], terminalChunk);
      assertEquals(f.outputFinishErrors[0] instanceof Error, true, terminalChunk);
      assertEquals(f.outputChunks, [terminalChunk === "error" ? "error" : "finish"]);
      assertEquals(f.fixture.closeReasons, ["canceled"], terminalChunk);
    }
  });

  it("preserves a validated executor error chunk through durable terminal classification", async () => {
    const f = await handler("detached", { terminalChunk: "coded-error" });
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.fixture.release();
    await f.managed.close();

    assertEquals(resolveConversationHostedStreamErrorState(f.outputFinishErrors[0]), {
      status: "failed",
      terminalErrorCode: "INSUFFICIENT_CREDITS",
      terminalErrorMessage: "Insufficient AI credits",
    });
  });

  it("finalizes an aborted detached execution as cancelled instead of failed", async () => {
    const f = await handler("detached");
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.abortExecution();
    f.fixture.release();
    await f.managed.close();

    assertEquals(f.outputFinishes, [false]);
    assertEquals(f.outputFinishErrors, [undefined]);
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });

  it("preserves request-owned SSE and releases only after response completion", async () => {
    const f = await handler("sse");
    const duplicateRequest = f.first.request.clone();
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertEquals(f.fixture.acceptKinds, ["request"]);
    assertEquals(f.managed.active, 1);
    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(duplicate.status, 409);
    assertEquals(f.prepareCalls, 1);
    f.fixture.release();
    await response.text();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["completed"]);
    assertEquals(f.managed.active, 0);
  });

  it("preserves finish usage metadata in the SSE RunFinished event", async () => {
    const f = await handler("sse", { finishWithUsage: true });
    const response = await f.managed.handle(f.first.request);
    f.fixture.release();
    const parsed = await parseAgUiSseResponse(response);
    await f.managed.close();
    const finished = parsed.events.find((event) => event.type === agUiSseEventTypes.runFinished);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;

    assertEquals({
      inputTokens: metadata?.inputTokens,
      outputTokens: metadata?.outputTokens,
      totalTokens: metadata?.totalTokens,
      usageCaptureStatus: metadata?.usageCaptureStatus,
      finishReason: metadata?.finishReason,
    }, {
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      usageCaptureStatus: "complete",
      finishReason: "stop",
    });
  });

  it("releases failed setup reservations and maps the error without diagnostics", async () => {
    const f = await handler("detached", { failStart: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { errorCode: "BROKER_EXECUTION_SETUP_FAILED" });
    assertEquals(f.managed.active, 0);
    assertEquals(f.cleanupCalls, 1);
  });

  it("retains admitted setup failure and cleanup until actual session settlement", async () => {
    const f = await handler("detached", { failStart: true, admitBeforeFailure: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 500);
    assertEquals(f.managed.active, 1);
    assertEquals(f.cleanupCalls, 0);
    f.admitted();
    await f.managed.close();
    assertEquals(f.cleanupCalls, 1);
    assertEquals(f.managed.active, 0);
  });

  it("does not admit a prepared run after handler closure during preparation", async () => {
    const f = await handler("detached", { waitForPrepare: true });
    const response = f.managed.handle(f.first.request);
    await f.prepareEntered;
    const closing = f.managed.close();
    assertEquals(f.prepareSignal?.aborted, true);
    f.releasePrepare();
    assertEquals((await response).status, 503);
    await closing;
    assertEquals(f.brokerStarts, 0);
    assertEquals(f.cleanupCalls, 1);
  });

  it("does not admit a late authorization result after handler closure", async () => {
    const f = await handler("detached", { waitForAuthorization: true });
    const response = f.managed.handle(f.first.request);
    await f.authorizationEntered;
    await f.managed.close();
    f.releaseAuthorization();
    assertEquals((await response).status, 503);
    assertEquals(f.prepareCalls, 0);
    assertEquals(f.brokerStarts, 0);
  });

  it("closes request-owned SSE as cancelled after request abort", async () => {
    const controller = new AbortController();
    const f = await handler("sse", { signal: controller.signal });
    const response = await f.managed.handle(f.first.request);
    controller.abort();
    f.fixture.release();
    await response.text();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });

  it("cancels and retires request-owned SSE when the response body is canceled", async () => {
    const f = await handler("sse");
    const response = await f.managed.handle(f.first.request);
    let closing: Promise<void> | undefined;
    try {
      await response.body?.cancel("client stopped reading");
      closing = f.managed.close();
      const timeout = Promise.withResolvers<false>();
      const timeoutId = setTimeout(() => timeout.resolve(false), 25);
      const retired = await Promise.race([closing.then(() => true), timeout.promise]);
      clearTimeout(timeoutId);
      assertEquals(retired, true);
      assertEquals(f.fixture.closeReasons, ["canceled"]);
      assertEquals(f.managed.active, 0);
      assertEquals(f.cleanupCalls, 1);
    } finally {
      f.fixture.release();
      await closing;
    }
  });

  it("shields throwing detached execution observers", async () => {
    const f = await handler("detached", { streamFailure: true, throwingObserver: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 202);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });
});
