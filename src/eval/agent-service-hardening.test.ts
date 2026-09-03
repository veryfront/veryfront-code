import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, runEval } from "veryfront/eval";
import {
  buildAgentServiceEvalRequestBody,
  buildLiveEvalCaseMetadata,
  buildLiveEvalRequestBody,
  buildRuntimePerformanceSummary,
  createAgentServiceEvalAdapter,
  createDurableRunCanaryApiClient,
  createDurableRunCanaryRunner,
  createDurableRunTokenGrowthCanaryCase,
  createLiveEvalApiClient,
  createLiveEvalCaseSupport,
  createPlainTextPdf,
  type DurableRunCanaryApiClient,
  type DurableRunCanaryRunSummary,
  type LiveEvalCase,
  resolveAgentServiceEvalEnvironment,
  resolveDurableRunCanaryEnvironment,
  resolveLiveEvalEnvironment,
  resolveLiveEvalRequestedCaseIds,
  runLiveEvalCli,
  selectLiveEvalCases,
  stringifyUnknown,
  waitForOpenLiveEvalInputRequest,
} from "veryfront/eval/agent-service";

function createSseResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
): Response {
  return new Response(
    events.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join(
      "",
    ),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function createCompletedSseResponse(): Response {
  return createSseResponse([
    { event: "RunStarted", data: { runId: "run_123" } },
    { event: "RunFinished", data: { runId: "run_123" } },
  ]);
}

function createLiveCase(id: string): LiveEvalCase {
  return {
    id,
    label: id,
    verify: () => null,
  };
}

function createLiveSupport(
  overrides: Partial<Parameters<typeof createLiveEvalCaseSupport>[0]> = {},
) {
  return createLiveEvalCaseSupport({
    endpoint: "http://127.0.0.1:4311/api/ag-ui",
    authToken: "token",
    apiUrl: "https://api.example.test",
    projectId: null,
    branchId: null,
    model: null,
    requestTimeoutMs: 1_000,
    progressLogIntervalMs: 60_000,
    enableLlmJudge: false,
    log: () => {},
    fetch: async () => createCompletedSseResponse(),
    ...overrides,
  });
}

function createRunSummary(
  conversationId: string,
  runId: string,
): DurableRunCanaryRunSummary {
  return {
    runId,
    conversationId,
    messageId: "22222222-2222-4222-8222-222222222222",
    agentId: "veryfront",
    status: "completed",
    latestEventId: 1,
    latestExternalEventSequence: null,
    waitingToolCallId: null,
    waitingToolName: null,
    terminalErrorCode: null,
    terminalErrorMessage: null,
    startedAt: "2026-07-25T10:00:00.000Z",
    finishedAt: "2026-07-25T10:00:01.000Z",
  };
}

function createCompletedDurableRunCanaryApiClient(
  conversationId: string,
  options: { startError?: Error } = {},
): DurableRunCanaryApiClient {
  return {
    createDurableRootRun: async () => {},
    getRunSummary: async ({ runId }) => createRunSummary(conversationId, runId),
    listMessagesForCanary: async () => [],
    sendUserMessageForCanary: async () => ({
      id: "33333333-3333-4333-8333-333333333333",
      role: "user",
      parts: [],
    }),
    startDurableRun: async () => {
      if (options.startError) {
        throw options.startError;
      }
    },
  };
}

const NODE_TIMER_EARLY_FIRE_MS = 1;

describe("eval/agent-service hardening", () => {
  it("does not let explicit case ids bypass write authorization", () => {
    const readCase = createLiveCase("read");
    const writeCase = createLiveCase("write");
    const experimentalCase = createLiveCase("experimental");

    const selected = selectLiveEvalCases({
      allCases: [readCase, writeCase],
      readOnlyCases: [readCase],
      writeCases: [writeCase],
      experimentalWriteCases: [],
      requestedCaseIds: new Set(["write"]),
      runWriteEvals: false,
      runExperimentalWriteEvals: false,
    });

    assertEquals(selected, []);

    const withWriteEvals = selectLiveEvalCases({
      allCases: [readCase, writeCase, experimentalCase],
      readOnlyCases: [readCase],
      writeCases: [writeCase],
      experimentalWriteCases: [experimentalCase],
      requestedCaseIds: new Set(),
      runWriteEvals: true,
      runExperimentalWriteEvals: false,
    });

    assertEquals(
      withWriteEvals.map((testCase) => testCase.id),
      ["read", "write"],
      "experimental write cases stay out unless AG_UI_EVAL_EXPERIMENTAL is set",
    );

    const withExperimentalWriteEvals = selectLiveEvalCases({
      allCases: [readCase, writeCase, experimentalCase],
      readOnlyCases: [readCase],
      writeCases: [writeCase],
      experimentalWriteCases: [experimentalCase],
      requestedCaseIds: new Set(),
      runWriteEvals: true,
      runExperimentalWriteEvals: true,
    });

    assertEquals(
      withExperimentalWriteEvals.map((testCase) => testCase.id),
      ["read", "write", "experimental"],
      "experimental write cases run only when both flags are set",
    );
  });

  it("rejects explicitly requested write cases when the CLI write gate is disabled", async () => {
    const errors: string[] = [];
    const exitCode = await runLiveEvalCli({
      env: {
        VERYFRONT_TOKEN: "token",
        VERYFRONT_API_URL: "https://api.example.test",
        AG_UI_EVAL_CASES: "write",
      },
      caseSets: {},
      createCases: () => ({
        readOnlyCases: [],
        writeCases: [createLiveCase("write")],
        experimentalWriteCases: [],
      }),
      log: () => {},
      error: (message) => errors.push(message),
    });

    assertEquals(exitCode, 1);
    assertEquals(errors.length, 1);
    assertStringIncludes(errors[0] ?? "", "not enabled by the write-eval flags");
  });

  it("checks auth and numeric CLI configuration before constructing cases", async () => {
    let createdCases = false;
    const missingAuthExitCode = await runLiveEvalCli({
      env: {},
      caseSets: {},
      createCases: () => {
        createdCases = true;
        return {
          readOnlyCases: [],
          writeCases: [],
          experimentalWriteCases: [],
        };
      },
      log: () => {},
      error: () => {},
    });
    assertEquals(missingAuthExitCode, 1);
    assertEquals(createdCases, false);

    const errors: string[] = [];
    const invalidTimeoutExitCode = await runLiveEvalCli({
      env: {
        VERYFRONT_TOKEN: "token",
        AG_UI_EVAL_TIMEOUT_MS: "NaN",
      },
      caseSets: {},
      createCases: () => {
        createdCases = true;
        return {
          readOnlyCases: [],
          writeCases: [],
          experimentalWriteCases: [],
        };
      },
      log: () => {},
      error: (message) => errors.push(message),
    });
    assertEquals(invalidTimeoutExitCode, 1);
    assertEquals(createdCases, false);
    assertStringIncludes(errors[0] ?? "", "AG_UI_EVAL_TIMEOUT_MS");

    const experimentalWithoutWriteExitCode = await runLiveEvalCli({
      env: {
        VERYFRONT_TOKEN: "token",
        AG_UI_EVAL_EXPERIMENTAL: "1",
      },
      caseSets: {},
      createCases: () => {
        createdCases = true;
        return {
          readOnlyCases: [],
          writeCases: [],
          experimentalWriteCases: [],
        };
      },
      log: () => {},
      error: (message) => errors.push(message),
    });
    assertEquals(experimentalWithoutWriteExitCode, 1);
    assertEquals(createdCases, false);
    assertStringIncludes(errors.at(-1) ?? "", "requires AG_UI_EVAL_WRITE=1");

    const paddedCaseExitCode = await runLiveEvalCli({
      env: {
        VERYFRONT_TOKEN: "token",
      },
      caseSets: {},
      createCases: () => ({
        readOnlyCases: [createLiveCase(" padded ")],
        writeCases: [],
        experimentalWriteCases: [],
      }),
      log: () => {},
      error: (message) => errors.push(message),
    });
    assertEquals(paddedCaseExitCode, 1);
    assertStringIncludes(errors.at(-1) ?? "", "surrounding whitespace");
  });

  it("forwards maxSteps without clearing allowed tools and protects the case id", () => {
    const liveBody = buildLiveEvalRequestBody({
      testCaseId: "case-1",
      prompt: "Run",
      metadata: { evalCase: "spoofed" },
      projectId: null,
      maxSteps: 3,
    });
    assertEquals(liveBody.state.evalCase, "case-1");
    assertEquals(liveBody.forwardedProps, {
      veryfront: {
        runtimeOverrides: { maxSteps: 3 },
      },
    });

    const adapterBody = buildAgentServiceEvalRequestBody({
      exampleId: "case-2",
      input: { prompt: "Run", metadata: { evalCase: "spoofed" } },
      maxSteps: 2,
    });
    assertEquals(adapterBody.state.evalCase, "case-2");
    assertEquals(adapterBody.forwardedProps, {
      veryfront: {
        runtimeOverrides: { maxSteps: 2 },
      },
    });

    const forcedBody = buildAgentServiceEvalRequestBody({
      exampleId: "case-3",
      input: "Run",
      forceRuntimeOverrides: true,
    });
    assertEquals(forcedBody.forwardedProps, {
      veryfront: {
        runtimeOverrides: { allowedTools: [] },
      },
    });

    const prototypeMetadata = JSON.parse('{"__proto__":"preserved"}') as Record<string, string>;
    const prototypeBody = buildLiveEvalRequestBody({
      testCaseId: "case-4",
      prompt: "Run",
      metadata: prototypeMetadata,
      projectId: null,
    });
    assertEquals(Object.hasOwn(prototypeBody.state, "__proto__"), true);
    assertEquals(prototypeBody.state.__proto__, "preserved");
  });

  it("keeps eval example data from re-enabling explicitly disabled request scope", () => {
    const scopedExample = {
      prompt: "Run",
      projectId: "project_attacker",
      conversationId: "conversation_attacker",
      branchId: "branch_attacker",
      model: "provider/attacker",
    };

    const disabledBody = buildAgentServiceEvalRequestBody({
      exampleId: "case-1",
      input: scopedExample,
      projectId: null,
      conversationId: null,
      branchId: null,
      model: null,
    });
    assertEquals(disabledBody.forwardedProps, undefined);

    const omittedBody = buildAgentServiceEvalRequestBody({
      exampleId: "case-2",
      input: scopedExample,
    });
    assertEquals(omittedBody.forwardedProps, {
      veryfront: {
        projectId: "project_attacker",
        conversationId: "conversation_attacker",
        branchId: "branch_attacker",
        model: "provider/attacker",
      },
    });
  });

  it("does not let eval data restore project scope disabled in the adapter config", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const adapter = createAgentServiceEvalAdapter({
      endpoint: "http://127.0.0.1:4311/api/ag-ui",
      authToken: "token",
      projectId: null,
      conversationId: null,
      branchId: null,
      model: null,
      fetch: async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return createCompletedSseResponse();
      },
    });

    const report = await runEval(
      evalAgent({
        id: "eval:unscoped",
        target: "agent:veryfront",
        dataset: datasets.inline([
          {
            id: "smoke",
            input: {
              prompt: "List files",
              projectId: "project_attacker",
              conversationId: "conversation_attacker",
              branchId: "branch_attacker",
              model: "provider/attacker",
            },
          },
        ]),
      }),
      {
        adapters: { agent: adapter },
        now: () => new Date("2026-06-20T10:00:00.000Z"),
      },
    );

    assertEquals(report.records[0]?.completed, true);
    assertEquals(requestBodies[0]?.forwardedProps, undefined);
  });

  it("contains async verifier failures and always runs lifecycle cleanup", async () => {
    const lifecycle: string[] = [];
    const { runEval } = createLiveSupport();
    const result = await runEval({
      id: "async-verifier",
      label: "Async verifier",
      prepare: async () => ({
        startSidecar: async () => {
          lifecycle.push("sidecar:start");
          return async () => {
            lifecycle.push("sidecar:stop");
          };
        },
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
      }),
      verify: async () => {
        throw new Error("verification exploded");
      },
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "verification exploded");
    assertEquals(lifecycle, ["sidecar:start", "sidecar:stop", "prepared:cleanup"]);

    const invalidVerifierResult = await runEval({
      id: "invalid-verifier",
      label: "Invalid verifier",
      verify: (() => undefined) as unknown as LiveEvalCase["verify"],
    }, "framework");
    assertEquals(invalidVerifierResult.status, "fail");
    assertStringIncludes(invalidVerifierResult.details, "must return null");
  });

  it("cleans prepared input without starting a sidecar for malformed custom bodies", async () => {
    const lifecycle: string[] = [];
    const { runEval } = createLiveSupport();
    const result = await runEval({
      id: "malformed-body",
      label: "Malformed body",
      prepare: async () => ({
        metadata: { customBody: "{" },
        startSidecar: async () => {
          lifecycle.push("sidecar:start");
        },
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
      }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "JSON");
    assertEquals(lifecycle, ["prepared:cleanup"]);
  });

  it("turns cleanup failures into a failed live-eval record", async () => {
    const lifecycle: string[] = [];
    const { runEval } = createLiveSupport();
    const result = await runEval({
      id: "cleanup-failure",
      label: "Cleanup failure",
      prepare: async () => ({
        startSidecar: async () => async () => {
          lifecycle.push("sidecar");
          throw new Error("sidecar cleanup exploded");
        },
        cleanup: async () => {
          lifecycle.push("prepared");
          throw new Error("prepared cleanup exploded");
        },
      }),
      verify: () => null,
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "sidecar cleanup exploded");
    assertStringIncludes(result.details, "prepared cleanup exploded");
    assertEquals(lifecycle, ["sidecar", "prepared"]);
  });

  it("contains hostile live verifier failures without bypassing cleanup", async () => {
    const lifecycle: string[] = [];
    const { runEval } = createLiveSupport();
    const result = await runEval({
      id: "hostile-verifier",
      label: "Hostile verifier",
      prepare: async () => ({
        startSidecar: async () => async () => {
          lifecycle.push("sidecar");
        },
        cleanup: async () => {
          lifecycle.push("prepared");
        },
      }),
      verify: () => {
        throw Object.create(null);
      },
    }, "framework");

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "{}");
    assertEquals(lifecycle, ["sidecar", "prepared"]);
  });

  it("fails project-file verification when verification support is unavailable", async () => {
    const { verifyFileExists } = createLiveSupport();

    assertStringIncludes(
      await verifyFileExists({ filePath: "report.md" }) ?? "",
      "requires project scope",
    );
  });

  it("encodes live API identifiers and preserves bounded structured errors", async () => {
    const requestedUrls: string[] = [];
    const client = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      projectId: "project/one",
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return new Response("x".repeat(10_000), { status: 503 });
      },
    });

    const error = await assertRejects(
      () =>
        client.deleteConversation({
          conversationId: "conversation/one?admin=true",
          requestTimeoutMs: 1_000,
        }),
      Error,
      "Failed to delete eval conversation",
    ) as Error & { status?: number };

    assertEquals(error.status, 503);
    assertEquals(
      new URL(requestedUrls[0] ?? "").pathname,
      "/conversations/conversation%2Fone%3Fadmin%3Dtrue",
    );
    assertStringIncludes(error.message, "…[truncated]");
    assertEquals(error.message.length < 4_500, true);
  });

  it("rejects invalid upload sizes before issuing a request", async () => {
    let fetched = false;
    const client = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      projectId: "project_123",
      fetch: async () => {
        fetched = true;
        return new Response(null, { status: 500 });
      },
    });

    await assertRejects(
      () =>
        client.createProjectUploadFixture({
          filePath: "fixture.txt",
          contentType: "text/plain",
          body: "fixture",
          size: -1,
          requestTimeoutMs: 1_000,
        }),
      Error,
      "size",
    );
    assertEquals(fetched, false);
  });

  it("sets Node-compatible duplex mode for streamed project uploads", async () => {
    let uploadDuplex: string | undefined;
    const client = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      projectId: "project_123",
      fetch: async (_input, init) => {
        if (init?.method === "POST") {
          return Response.json({
            file_upload_url: "https://upload.example.test/fixture",
          });
        }
        if (init?.method === "PUT") {
          uploadDuplex = (init as RequestInit & { duplex?: string }).duplex;
          return new Response(null, { status: 204 });
        }
        return Response.json({ data: [{ path: "fixture.txt" }] });
      },
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("fixture"));
        controller.close();
      },
    });

    await client.createProjectUploadFixture({
      filePath: "fixture.txt",
      contentType: "text/plain",
      body,
      size: 7,
      requestTimeoutMs: 1_000,
      pollIntervalMs: 0,
      maxAttempts: 1,
    });

    assertEquals(uploadDuplex, "half");
  });

  it("rejects non-finite live input-response numbers before fetching", async () => {
    let fetched = false;
    const client = createLiveEvalApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      projectId: null,
      fetch: async () => {
        fetched = true;
        return new Response(null, { status: 204 });
      },
    });

    await assertRejects(
      () =>
        client.submitInputResponse({
          conversationId: "conversation_123",
          inputRequestId: "input_123",
          values: { score: Number.NaN },
          requestTimeoutMs: 1_000,
        }),
      Error,
      "score",
    );
    assertEquals(fetched, false);
  });

  it("normalizes an in-flight input-request deadline to the eval timeout error", async () => {
    const error = await assertRejects(
      () =>
        waitForOpenLiveEvalInputRequest(
          {
            apiUrl: "https://api.example.test",
            authToken: "token",
            projectId: null,
            fetch: async (_input, init) =>
              await new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                if (!signal) {
                  reject(new Error("missing signal"));
                  return;
                }
                const rejectForAbort = () => reject(signal.reason);
                if (signal.aborted) rejectForAbort();
                else signal.addEventListener("abort", rejectForAbort, { once: true });
              }),
          },
          {
            conversationId: "conversation_123",
            abortSignal: new AbortController().signal,
            requestTimeoutMs: 1_000,
            timeoutMs: 20,
            pollIntervalMs: 1,
          },
        ),
      Error,
      "Timed out while waiting",
    ) as Error & { status?: number };

    assertEquals(error.status, 408);
  });

  it("uses structured 404 status and encoded ids in the durable API client", async () => {
    const requestedUrls: string[] = [];
    const client = createDurableRunCanaryApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      agentId: "veryfront",
      projectId: null,
      requestTimeoutMs: 1_000,
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return new Response("not found", { status: 404 });
      },
    });

    const error = await assertRejects(
      () =>
        client.getRunSummary({
          conversationId: "conversation/one",
          runId: "run?one",
        }),
      Error,
      "404",
    ) as Error & { status?: number };

    assertEquals(error.status, 404);
    assertEquals(
      new URL(requestedUrls[0] ?? "").pathname,
      "/conversations/conversation%2Fone/runs/run%3Fone",
    );
  });

  it("accepts bodyless successful durable run mutations", async () => {
    const client = createDurableRunCanaryApiClient({
      apiUrl: "https://api.example.test",
      authToken: "token",
      agentId: "veryfront",
      projectId: null,
      requestTimeoutMs: 1_000,
      fetch: async () => new Response(null, { status: 204 }),
    });

    await client.createDurableRootRun({
      conversationId: "conversation_123",
      runId: "run_123",
    });
    await client.startDurableRun({
      conversationId: "conversation_123",
      messageId: "message_123",
      prompt: "Run the canary",
      runId: "run_123",
      userMessageId: "user_message_123",
    });
  });

  it("contains durable prepare and sidecar-cleanup failures as results", async () => {
    const unusedApiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async () => {
        throw new Error("unexpected");
      },
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => {
        throw new Error("unexpected");
      },
      startDurableRun: async () => {},
    };
    const config = {
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: false,
      projectId: null,
      requestTimeoutMs: 1_000,
    };
    const runner = createDurableRunCanaryRunner(config, unusedApiClient);
    const prepareFailure = await runner.runCase({
      id: "prepare",
      label: "Prepare",
      prepare: async () => {
        throw new Error("prepare exploded");
      },
    });
    assertEquals(prepareFailure.status, "fail");
    assertEquals(prepareFailure.conversationId, "unknown");
    assertStringIncludes(prepareFailure.details, "prepare exploded");

    const conversationId = "11111111-1111-4111-8111-111111111111";
    const completedApiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async ({ runId }) => createRunSummary(conversationId, runId),
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async () => {},
    };
    const cleanupOrder: string[] = [];
    const cleanupRunner = createDurableRunCanaryRunner(config, completedApiClient);
    const cleanupFailure = await cleanupRunner.runCase({
      id: "sidecar",
      label: "Sidecar",
      prepare: async () => ({
        cleanup: async () => {
          cleanupOrder.push("prepared");
        },
        conversationId,
        prompt: "run",
        title: "Sidecar",
        startSidecar: async () => async () => {
          cleanupOrder.push("sidecar");
          throw new Error("sidecar cleanup exploded");
        },
        validate: () => {},
      }),
    });
    assertEquals(cleanupFailure.status, "fail");
    assertStringIncludes(cleanupFailure.details, "sidecar cleanup exploded");
    assertEquals(cleanupOrder, ["sidecar", "prepared"]);
  });

  it("cleans prepared durable resources exactly once after validation fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "validation-failure-cleanup",
      label: "Validation failure cleanup",
      prepare: async () => ({
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
        conversationId,
        prompt: "run",
        title: "Validation failure cleanup",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
        },
        validate: () => {
          throw new Error("validation exploded");
        },
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "validation exploded");
    assertEquals(lifecycle, ["sidecar:stop", "prepared:cleanup"]);
  });

  it("cleans prepared durable resources exactly once after execution fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const runner = createDurableRunCanaryRunner(
      {
        agentId: "veryfront",
        apiUrl: "https://api.example.test",
        authToken: "token",
        keepSuccessfulEvidence: true,
        projectId: null,
        requestTimeoutMs: 1_000,
      },
      createCompletedDurableRunCanaryApiClient(conversationId, {
        startError: new Error("start exploded"),
      }),
    );

    const result = await runner.runCase({
      id: "execution-failure-cleanup",
      label: "Execution failure cleanup",
      prepare: async () => ({
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
        conversationId,
        prompt: "run",
        title: "Execution failure cleanup",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
        },
        validate: () => {
          throw new Error("validation must not run");
        },
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "start exploded");
    assertEquals(lifecycle, ["sidecar:stop", "prepared:cleanup"]);
  });

  it("cleans prepared durable resources exactly once when sidecar startup fails", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    let cleanupCalls = 0;
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "sidecar-start-failure-cleanup",
      label: "Sidecar start failure cleanup",
      prepare: async () => ({
        cleanup: async () => {
          cleanupCalls += 1;
        },
        conversationId,
        prompt: "run",
        title: "Sidecar start failure cleanup",
        startSidecar: async () => {
          throw new Error("sidecar startup exploded");
        },
        validate: () => {
          throw new Error("validation must not run");
        },
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "sidecar startup exploded");
    assertEquals(cleanupCalls, 1);
  });

  it("reports cleanup failure after sidecar stop without losing the primary failure", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "cleanup-failure-reporting",
      label: "Cleanup failure reporting",
      prepare: async () => ({
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
          throw new Error("cleanup exploded");
        },
        conversationId,
        prompt: "run",
        title: "Cleanup failure reporting",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
          throw new Error("sidecar stop exploded");
        },
        validate: () => {
          throw new Error("validation exploded");
        },
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "validation exploded");
    assertStringIncludes(result.details, "Sidecar cleanup failed: sidecar stop exploded");
    assertStringIncludes(result.details, "Prepared input cleanup failed: cleanup exploded");
    assertEquals(
      result.details.indexOf("validation exploded") <
        result.details.indexOf("Sidecar cleanup failed: sidecar stop exploded"),
      true,
    );
    assertEquals(
      result.details.indexOf("Sidecar cleanup failed: sidecar stop exploded") <
        result.details.indexOf("Prepared input cleanup failed: cleanup exploded"),
      true,
    );
    assertEquals(lifecycle, ["sidecar:stop", "prepared:cleanup"]);
  });

  it("cleans prepared resources when sidecar stop turns a successful run into a failure", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "sidecar-stop-failure-cleanup",
      label: "Sidecar stop failure cleanup",
      prepare: async () => ({
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
        conversationId,
        prompt: "run",
        title: "Sidecar stop failure cleanup",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
          throw new Error("sidecar stop exploded");
        },
        validate: () => {},
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "Sidecar cleanup failed: sidecar stop exploded");
    assertEquals(lifecycle, ["sidecar:stop", "prepared:cleanup"]);
  });

  it("keeps successful durable evidence while still stopping the sidecar", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "keep-successful-evidence",
      label: "Keep successful evidence",
      prepare: async () => ({
        cleanup: async () => {
          lifecycle.push("prepared:cleanup");
        },
        conversationId,
        prompt: "run",
        title: "Keep successful evidence",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
        },
        validate: () => {},
      }),
    });

    assertEquals(result.status, "pass");
    assertEquals(lifecycle, ["sidecar:stop"]);
  });

  it("cleans successful durable evidence when evidence retention is disabled", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    let cleanupRunId: string | undefined;
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: false,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, createCompletedDurableRunCanaryApiClient(conversationId));

    const result = await runner.runCase({
      id: "clean-successful-evidence",
      label: "Clean successful evidence",
      prepare: async () => ({
        cleanup: async (input) => {
          cleanupRunId = input?.runId;
          lifecycle.push("prepared:cleanup");
        },
        conversationId,
        prompt: "run",
        title: "Clean successful evidence",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
        },
        validate: () => {},
      }),
    });

    assertEquals(
      result.status,
      "pass",
      "a successful canary still passes when evidence is not kept",
    );
    assertEquals(
      lifecycle,
      ["sidecar:stop", "prepared:cleanup"],
      "successful runs clean prepared evidence after stopping the sidecar",
    );
    assertEquals(cleanupRunId, result.runId, "cleanup receives the terminal run id");
  });

  it("retains durable run identity and cleanup when a hostile value is thrown", async () => {
    const hostileThrownValue = new Proxy(Object.create(null), {
      get: () => {
        throw new Error("get trap");
      },
      getPrototypeOf: () => {
        throw new Error("prototype trap");
      },
      ownKeys: () => {
        throw new Error("keys trap");
      },
    });
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const lifecycle: string[] = [];
    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async () => {
        throw hostileThrownValue;
      },
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async () => {},
    };
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: false,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, apiClient);

    const result = await runner.runCase({
      id: "hostile-error",
      label: "Hostile error",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "run",
        title: "Hostile error",
        startSidecar: async () => async () => {
          lifecycle.push("sidecar:stop");
        },
        validate: () => {},
      }),
    });

    assertEquals(result.status, "fail");
    assertEquals(result.details, "[unprintable thrown value]");
    assertEquals(result.runId.startsWith("run_"), true);
    assertEquals(lifecycle, ["sidecar:stop"]);
    assertEquals(stringifyUnknown(hostileThrownValue), "[unprintable thrown value]");
  });

  it("bounds durable terminal polling by the configured deadline", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const requestTimeoutMs = 150;
    let summaryCalls = 0;
    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async ({ runId }) => {
        summaryCalls += 1;
        if (summaryCalls === 1) {
          return {
            ...createRunSummary(conversationId, runId),
            status: "running",
            finishedAt: null,
          };
        }
        return await new Promise<DurableRunCanaryRunSummary>(() => {});
      },
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async () => {},
    };
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: false,
      projectId: null,
      requestTimeoutMs,
    }, apiClient);
    const result = await runner.runCase({
      id: "deadline",
      label: "Deadline",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "run",
        title: "Deadline",
        validate: () => {},
      }),
    });

    assertEquals(result.status, "fail");
    assertStringIncludes(result.details, "terminal state");
    assertEquals(result.runId.startsWith("run_"), true);
    assertEquals(
      summaryCalls,
      2,
      "the canary polls once for running state and once for the deadline-bounded pending request",
    );
    assertEquals(
      result.durationMs >= requestTimeoutMs - NODE_TIMER_EARLY_FIRE_MS,
      true,
      `the canary waits out the configured terminal-poll deadline, took ${result.durationMs}ms`,
    );
  });

  it("accepts structured statusCode 404 from injected durable clients", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    let summaryCalls = 0;
    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async ({ runId }) => {
        summaryCalls += 1;
        if (summaryCalls === 1) {
          throw Object.assign(new Error("not found"), { statusCode: 404 });
        }
        return createRunSummary(conversationId, runId);
      },
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async () => {},
    };
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, apiClient);

    const result = await runner.runCase({
      id: "status-code",
      label: "Status code",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "run",
        title: "Status code",
        validate: () => {},
      }),
    });

    assertEquals(result.status, "pass");
    assertEquals(summaryCalls, 3);
  });

  it("accepts plain Error 404 responses from injected durable clients", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    let summaryCalls = 0;
    const apiClient: DurableRunCanaryApiClient = {
      createDurableRootRun: async () => {},
      getRunSummary: async ({ runId }) => {
        summaryCalls += 1;
        if (summaryCalls === 1) {
          throw new Error("HTTP 404: run not found");
        }
        return createRunSummary(conversationId, runId);
      },
      listMessagesForCanary: async () => [],
      sendUserMessageForCanary: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        parts: [],
      }),
      startDurableRun: async () => {},
    };
    const runner = createDurableRunCanaryRunner({
      agentId: "veryfront",
      apiUrl: "https://api.example.test",
      authToken: "token",
      keepSuccessfulEvidence: true,
      projectId: null,
      requestTimeoutMs: 1_000,
    }, apiClient);

    const result = await runner.runCase({
      id: "plain-error-404",
      label: "Plain Error 404",
      prepare: async () => ({
        cleanup: async () => {},
        conversationId,
        prompt: "run",
        title: "Plain Error 404",
        validate: () => {},
      }),
    });

    assertEquals(result.status, "pass");
    assertEquals(summaryCalls, 3);
  });

  it("rejects malformed configuration and invalid performance samples", () => {
    assertThrows(
      () =>
        createLiveEvalCaseSupport({
          endpoint: "http://127.0.0.1:4311/api/ag-ui",
          authToken: "",
          apiUrl: "https://api.example.test",
          projectId: null,
          branchId: null,
          model: null,
          requestTimeoutMs: 1_000,
          progressLogIntervalMs: 1_000,
          enableLlmJudge: false,
        }),
      Error,
      "auth token",
    );
    assertThrows(
      () =>
        createLiveEvalApiClient({
          apiUrl: "https://api.example.test",
          authToken: "token",
          projectId: " ",
        }),
      Error,
      "project id",
    );
    assertThrows(
      () =>
        createAgentServiceEvalAdapter({
          authToken: "token",
          endpoint: "/api/ag-ui",
          requestTimeoutMs: 2_147_483_648,
          fetch: async () => createCompletedSseResponse(),
        }),
      Error,
      "at most 2147483647",
    );
    assertEquals(
      typeof createAgentServiceEvalAdapter({
        authToken: "token",
        endpoint: "/api/ag-ui",
        fetch: async () => createCompletedSseResponse(),
      }),
      "function",
    );
    assertEquals(
      resolveAgentServiceEvalEnvironment({ VERYFRONT_API_URL: " " }).apiUrl,
      "https://api.veryfront.com",
    );
    assertEquals(
      resolveLiveEvalEnvironment({ VERYFRONT_API_URL: " " }).apiUrl,
      "https://api.veryfront.com",
    );
    assertEquals(
      resolveDurableRunCanaryEnvironment({ VERYFRONT_API_URL: " " }).apiUrl,
      "https://api.veryfront.com",
    );
    assertThrows(
      () => buildRuntimePerformanceSummary([{ runtime: "framework", durationMs: Number.NaN }]),
      Error,
      "durationMs",
    );
    assertThrows(
      () =>
        buildRuntimePerformanceSummary([
          { runtime: "unsupported" as "framework", durationMs: 1 },
        ]),
      Error,
      "unsupported runtime",
    );
    assertThrows(
      () =>
        resolveDurableRunCanaryEnvironment({
          DURABLE_CANARY_TIMEOUT_MS: "-1",
        }),
      Error,
      "DURABLE_CANARY_TIMEOUT_MS",
    );
    assertThrows(
      () => createDurableRunTokenGrowthCanaryCase({ marker: "unsafe\nmarker" }),
      Error,
      "marker",
    );
    assertThrows(
      () =>
        buildLiveEvalCaseMetadata({
          caseId: "case",
          surface: "read-only",
          requireProject: false,
          areaTagRules: [{ tag: "invalid" }],
        }),
      Error,
      "matcher",
    );
    assertThrows(
      () =>
        resolveLiveEvalRequestedCaseIds({
          caseSets: {},
          requestedCaseIds: new Set(),
          requestedCaseSetId: "__proto__",
        }),
      Error,
      "Unknown AG_UI_EVAL_CASE_SET",
    );
    assertEquals(stringifyUnknown(undefined), "undefined");
  });

  it("neutralizes PDF literal control-character injection", () => {
    const pdf = createPlainTextPdf(["hello)\nET\n(world"]).toString("utf8");

    assertStringIncludes(pdf, "(hello\\) ET \\(world) Tj");
    assertEquals(pdf.includes("(hello\\)\nET\n\\(world) Tj"), false);
  });
});
