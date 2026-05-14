import { agUiSseEventTypes, type ParsedAgUiSseRun as ParsedRun } from "#veryfront/agent";
import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  containsSkillLoad,
  countStepStartedEvents,
  createLiveEvalCaseSupport,
  hasFinished,
  type LiveEvalCase,
  liveEvalRunnerInternals,
} from "./runner.ts";

function createRun(overrides: Partial<ParsedRun> = {}): ParsedRun {
  return {
    responseStatus: 200,
    events: [],
    eventTypes: [],
    toolStarts: [],
    toolArgs: [],
    text: "",
    runError: null,
    ...overrides,
  };
}

function createSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

function withFixedNow<T>(now: number, action: () => T): T {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return action();
  } finally {
    Date.now = originalNow;
  }
}

describe("agent testing live eval runner", () => {
  it("collects unique prepared artifact paths in sorted order", () => {
    assertEquals(
      liveEvalRunnerInternals.collectPreparedArtifactPaths({
        metadata: {
          summaryPath: "/tmp/b.txt",
          asset_path: "/tmp/a.txt",
          duplicatePath: "/tmp/b.txt",
          ignored: "noop",
        },
      }),
      ["/tmp/a.txt", "/tmp/b.txt"],
    );
  });

  it("detects finished runs without errors", () => {
    assertEquals(
      hasFinished(
        createRun({
          eventTypes: [agUiSseEventTypes.runStarted, agUiSseEventTypes.runFinished],
        }),
      ),
      true,
    );

    assertEquals(
      hasFinished(
        createRun({
          eventTypes: [agUiSseEventTypes.runStarted, agUiSseEventTypes.runFinished],
          runError: "boom",
        }),
      ),
      false,
    );
  });

  it("detects skill loads and step counts from parsed runs", () => {
    const run = createRun({
      eventTypes: [
        agUiSseEventTypes.stepStarted,
        agUiSseEventTypes.textMessageContent,
        agUiSseEventTypes.stepStarted,
      ],
      toolStarts: ["load_skill"],
      toolArgs: ['{"skillId":"plan"}'],
    });

    assertEquals(containsSkillLoad(run, "plan"), true);
    assertEquals(containsSkillLoad(run, "research"), false);
    assertEquals(countStepStartedEvents(run), 2);
  });

  it("builds run artifacts with truncated previews and an optional run id", () => {
    const run = createRun({
      toolStarts: ["load_skill", "invoke_agent"],
      toolArgs: ["x".repeat(700), "y".repeat(700)],
      text: "z".repeat(400),
    });

    const artifacts = liveEvalRunnerInternals.createLiveEvalRunArtifacts({
      run,
      runId: "run-123",
      traceSignature: "RunStarted > StepStarted",
    });

    assertEquals(artifacts, {
      runId: "run-123",
      traceSignature: "RunStarted > StepStarted",
      toolStarts: ["load_skill", "invoke_agent"],
      toolArgsPreview: `${"x".repeat(700)} | ${"y".repeat(297)}`,
      textPreview: "z".repeat(280),
    });
  });

  it("threads artifact context into passed and failed run results", () => {
    withFixedNow(2500, () => {
      const runArtifacts = {
        runId: "run-1",
        traceSignature: "RunStarted > RunFinished",
        toolStarts: ["load_skill"],
        toolArgsPreview: '{"skillId":"plan"}',
        textPreview: "done",
      };

      assertEquals(
        liveEvalRunnerInternals.createPassedRunEvalResult({
          details: "passed",
          context: {
            id: "case-1",
            label: "Case 1",
            runtime: "framework",
            startedAt: 1000,
            conversationId: "conv-1",
            artifactPaths: ["/tmp/eval.log"],
          },
          runArtifacts,
        }),
        {
          id: "case-1",
          label: "Case 1",
          runtime: "framework",
          status: "pass",
          details: "passed",
          durationMs: 1500,
          conversationId: "conv-1",
          runId: "run-1",
          artifactPaths: ["/tmp/eval.log"],
          traceSignature: "RunStarted > RunFinished",
          toolStarts: ["load_skill"],
          toolArgsPreview: '{"skillId":"plan"}',
          textPreview: "done",
        },
      );

      assertEquals(
        liveEvalRunnerInternals.createFailedRunEvalResult({
          details: "failed",
          context: {
            id: "case-2",
            label: "Case 2",
            runtime: "framework",
            startedAt: 1000,
          },
          runArtifacts,
        }),
        {
          id: "case-2",
          label: "Case 2",
          runtime: "framework",
          status: "fail",
          details: "failed",
          durationMs: 1500,
          runId: "run-1",
          traceSignature: "RunStarted > RunFinished",
          toolStarts: ["load_skill"],
          toolArgsPreview: '{"skillId":"plan"}',
          textPreview: "done",
        },
      );
    });
  });

  it("adds streaming progress details and omits empty text previews", () => {
    withFixedNow(3600, () => {
      assertEquals(
        liveEvalRunnerInternals.createStreamingFailureEvalResult({
          details: "timed out",
          context: {
            id: "case-3",
            label: "Case 3",
            runtime: "framework",
            startedAt: 1000,
            conversationId: "conv-3",
            artifactPaths: ["/tmp/trace.json"],
          },
          progress: {
            eventCount: 4,
            lastEventType: "tool-call-start",
            lastToolCallName: "search_docs",
            toolStarts: ["search_docs"],
            textLength: 0,
          },
        }),
        {
          id: "case-3",
          label: "Case 3",
          runtime: "framework",
          status: "fail",
          details:
            "timed out Progress: events=4 last=tool-call-start tool=search_docs tools=search_docs",
          durationMs: 2600,
          conversationId: "conv-3",
          artifactPaths: ["/tmp/trace.json"],
          toolStarts: ["search_docs"],
        },
      );
    });
  });

  it("runs a live eval case through the configured AG-UI endpoint", async () => {
    const requestedBodies: unknown[] = [];
    const support = createLiveEvalCaseSupport({
      endpoint: "https://agent.example.test/runs",
      authToken: "token-1",
      apiUrl: "https://api.example.test",
      projectId: "project-1",
      branchId: "branch-1",
      model: "model-1",
      requestTimeoutMs: 5_000,
      progressLogIntervalMs: 60_000,
      enableLlmJudge: false,
      log: () => {},
      fetch: async (_input, init) => {
        requestedBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return createSseResponse([
          'id: 1\nevent: RunStarted\ndata: {"runId":"run-1"}\n\n',
          'id: 2\nevent: ToolCallStart\ndata: {"toolCallName":"load_skill"}\n\n',
          'id: 3\nevent: ToolCallArgs\ndata: {"delta":"{\\"skillId\\":\\"plan\\"}"}\n\n',
          'id: 4\nevent: TextMessageContent\ndata: {"delta":"done"}\n\n',
          'id: 5\nevent: RunFinished\ndata: {"metadata":{"finishReason":"stop"}}\n\n',
        ]);
      },
    });
    const testCase: LiveEvalCase = {
      id: "case-1",
      label: "Case 1",
      prompt: "Do the task",
      requireProject: true,
      verify: (run) => run.text === "done" ? null : "missing text",
    };

    const result = await support.runEval(testCase, "framework");

    assertEquals(result.status, "pass");
    assertEquals(result.runId, "run-1");
    assertEquals(result.toolStarts, ["load_skill"]);
    assertMatch(result.details, /^OK: load_skill \| done/);
    assertEquals(requestedBodies.length, 1);
  });

  it("verifies project file contents through the configured project file reader", async () => {
    const support = createLiveEvalCaseSupport({
      endpoint: "https://agent.example.test/runs",
      authToken: "token-1",
      apiUrl: "https://api.example.test",
      projectId: "project-1",
      branchId: null,
      model: null,
      requestTimeoutMs: 5_000,
      progressLogIntervalMs: 60_000,
      enableLlmJudge: false,
      readProjectFile: async () => ({ path: "src/app.tsx", content: "export function App() {}" }),
    });

    assertEquals(
      await support.verifyFileExists({
        filePath: "src/app.tsx",
        requiredContent: ["function App"],
      }),
      null,
    );
    assertEquals(
      await support.verifyFileExists({ filePath: "src/app.tsx", requiredContent: ["missing"] }),
      "src/app.tsx: missing required content: missing. Got: export function App() {}",
    );
  });
});
