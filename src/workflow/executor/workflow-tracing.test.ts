import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { DAGExecutor } from "./dag/index.ts";
import { map, parallel, step, subWorkflow, workflow } from "../dsl/index.ts";
import { StepExecutor } from "./step-executor.ts";
import { WorkflowExecutor } from "./workflow-executor.ts";
import type { WorkflowNode, WorkflowRun } from "../types.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import * as otelApi from "npm:@opentelemetry/api@1.9.1";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.9.0";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  SpanStatusCode,
} from "#veryfront/observability/tracing/api-shim.ts";

/**
 * Mirrors `wireTracingShim` in server bootstrap: the real OpenTelemetry API, a real
 * AsyncLocalStorage context manager, and a real tracer provider. Anything less cannot
 * observe parentage, because parentage only exists once a context manager is installed.
 */
function installRealTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  otelApi.context.setGlobalContextManager(contextManager);
  setGlobalTracerProvider(provider as never);
  setGlobalActiveSpanAccessor(otelApi.trace as never);
  setGlobalContextAccessor(otelApi.context as never);
  return {
    exporter,
    provider,
    async dispose() {
      _resetShimForTests();
      contextManager.disable();
      otelApi.context.disable();
      await provider.shutdown();
    },
  };
}

function parentIdOf(span: ReadableSpan): string | undefined {
  const withContext = span as unknown as { parentSpanContext?: { spanId?: string } };
  return withContext.parentSpanContext?.spanId ??
    (span as unknown as { parentSpanId?: string }).parentSpanId;
}

function byName(spans: readonly ReadableSpan[], name: string): ReadableSpan | undefined {
  return spans.find((candidate) => candidate.name === name);
}

function assertSpanDoesNotContain(spans: readonly ReadableSpan[], value: string): void {
  for (const span of spans) {
    assertEquals(
      (span.status.message ?? "").includes(value),
      false,
      `${span.name} leaked sensitive text into its span status`,
    );
    for (const event of span.events) {
      for (const attributeValue of Object.values(event.attributes ?? {})) {
        assertEquals(
          String(attributeValue).includes(value),
          false,
          `${span.name} leaked sensitive text into the ${event.name} event`,
        );
      }
    }
  }
}

function createTool(id: string, execute: () => unknown | Promise<unknown>): Tool {
  return {
    id,
    type: "function",
    description: `Test tool ${id}`,
    inputSchema: defineSchema((v) => v.object({}).passthrough())(),
    execute: () => Promise.resolve(execute()),
  };
}

describe("workflow/executor tracing", () => {
  it("nests a span opened inside a step under that step's node span, and the node under the run", async () => {
    const tracing = installRealTracing();
    try {
      // Opened inside the step body — this stands in for an agent span, which is the
      // whole point of the request: agent work must nest under the node that ran it.
      const { withSpan } = await import("#veryfront/observability/tracing/otlp-setup.ts");

      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "traced-workflow",
          steps: [
            step("greet", {
              tool: createTool("greet", async () => {
                await withSpan("agent.generate", async () => ({ ok: true }));
                return { greeted: true };
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("traced-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const runSpan = byName(spans, "workflow.run");
      const nodeSpan = byName(spans, "workflow.node greet");
      const innerSpan = byName(spans, "agent.generate");

      assertExists(runSpan, "expected a workflow.run span");
      assertExists(nodeSpan, "expected a workflow.node greet span");
      assertExists(innerSpan, "expected the span opened inside the step");

      assertEquals(parentIdOf(innerSpan), nodeSpan.spanContext().spanId);
      assertEquals(parentIdOf(nodeSpan), runSpan.spanContext().spanId);
      // Root here only because this test starts the run with no ambient span. See the
      // ambient-caller test below for the general case.
      assertEquals(parentIdOf(runSpan), undefined);

      for (const span of [runSpan, nodeSpan, innerSpan]) {
        assertEquals(span.spanContext().traceId, runSpan.spanContext().traceId);
      }

      assertEquals(runSpan.attributes["workflow.id"], "traced-workflow");
      assertExists(runSpan.attributes["workflow.run_id"]);
      assertEquals(
        nodeSpan.attributes["workflow.run_id"],
        runSpan.attributes["workflow.run_id"],
      );
      assertEquals(nodeSpan.attributes["workflow.node.id"], "greet");
      assertEquals(nodeSpan.attributes["workflow.node.type"], "step");
    } finally {
      await tracing.dispose();
    }
  });

  it("emits a node span for composite node types and keeps the root run id on every span", async () => {
    const tracing = installRealTracing();
    try {
      const inner = workflow({
        id: "inner-workflow",
        steps: [step("inner_step", { tool: createTool("inner_step", () => ({ ok: true })) })],
      }).definition;

      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "composite-workflow",
          steps: [
            parallel("fan", [
              step("left", { tool: createTool("left", () => ({ side: "left" })) }),
              step("right", { tool: createTool("right", () => ({ side: "right" })) }),
            ]),
            map("each", {
              items: ["a", "b"],
              processor: step("item", { tool: createTool("item", () => ({ seen: true })) }),
            }),
            subWorkflow("nested", { workflow: inner }),
          ],
        }).definition,
      );

      const handle = await executor.start("composite-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const runSpan = byName(spans, "workflow.run");
      assertExists(runSpan);
      const rootRunId = runSpan.attributes["workflow.run_id"];
      assertExists(rootRunId);

      for (const name of ["workflow.node fan", "workflow.node each", "workflow.node nested"]) {
        assertExists(byName(spans, name), `expected span ${name}`);
      }

      const nodeSpans = spans.filter((span) => span.name.startsWith("workflow.node "));
      // Every node span, including those beneath a sub-workflow's synthetic run record,
      // must correlate to the root run id — the only id a caller can look up.
      for (const span of nodeSpans) {
        assertEquals(
          span.attributes["workflow.run_id"],
          rootRunId,
          `${span.name} carried the wrong run id`,
        );
      }

      const nested = byName(spans, "workflow.node nested");
      assertExists(nested);
      assertEquals(nested.attributes["workflow.sub_workflow_id"], "inner-workflow");
      assertExists(nested.attributes["workflow.sub_run_id"]);
      // The synthetic sub-run id must never masquerade as the run id.
      assertEquals(nested.attributes["workflow.sub_run_id"] === rootRunId, false);
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps DAG child trace run id separate from the lifecycle hook run id", async () => {
    const tracing = installRealTracing();
    try {
      const hookRunIds: Array<string | undefined> = [];
      const dag = new DAGExecutor({
        stepExecutor: new StepExecutor({
          toolRegistry: {
            get: () => createTool("child", () => ({ ok: true })),
          },
          onStepStart: (_nodeId, _input, runId) => hookRunIds.push(runId),
        }),
      });
      const nodes: WorkflowNode[] = [step("child", { tool: "child" })];
      const syntheticRun: WorkflowRun = {
        id: "synthetic-child-run",
        workflowId: "trace-run-id-regression",
        status: "running",
        input: {},
        context: { input: {} },
        nodeStates: {},
        currentNodes: [],
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      };

      await (dag as unknown as {
        executeUnwrapped(
          nodes: WorkflowNode[],
          run: WorkflowRun,
          scope: {
            rootRunId: string;
            executionRunId: string;
            resumingWait: boolean;
            ownership?: unknown;
          },
          startFromNode?: string,
          abortSignal?: AbortSignal,
        ): Promise<unknown>;
      }).executeUnwrapped(nodes, syntheticRun, {
        rootRunId: "durable-root-run",
        executionRunId: "durable-hook-run",
        resumingWait: false,
      });
      await tracing.provider.forceFlush();

      const nodeSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node child");
      assertExists(nodeSpan);
      assertEquals(nodeSpan.attributes["workflow.run_id"], "durable-root-run");
      assertEquals(hookRunIds, ["durable-hook-run"]);
    } finally {
      await tracing.dispose();
    }
  });

  it("records a retry as a span event so a failed attempt is never hidden inside one span", async () => {
    const tracing = installRealTracing();
    try {
      let attempts = 0;
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "retrying-workflow",
          steps: [
            step("flaky", {
              retry: { maxAttempts: 2, backoff: "fixed", initialDelay: 1 },
              tool: createTool("flaky", () => {
                attempts += 1;
                if (attempts === 1) throw new Error("ECONNRESET");
                return { ok: true };
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("retrying-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const nodeSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node flaky");
      assertExists(nodeSpan);
      assertEquals(nodeSpan.attributes["workflow.node.attempts"], 2);

      const retryEvent = nodeSpan.events.find((event) => event.name === "workflow.node.retry");
      assertExists(retryEvent, "expected a workflow.node.retry event");
      assertEquals(retryEvent.attributes?.["workflow.node.attempt"], 1);
      assertEquals(retryEvent.attributes?.["workflow.node.error_type"], "Error");
    } finally {
      await tracing.dispose();
    }
  });

  it("does not export raw retry error messages or secrets", async () => {
    const tracing = installRealTracing();
    try {
      let attempts = 0;
      const secret = "sk-customer-secret-value";
      const rawMessage = `ECONNRESET while using ${secret}`;
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "retry-secret-workflow",
          steps: [
            step("flaky", {
              retry: { maxAttempts: 2, backoff: "fixed", initialDelay: 1 },
              tool: createTool("flaky", () => {
                attempts += 1;
                if (attempts === 1) throw new Error(rawMessage);
                return { ok: true };
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("retry-secret-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const nodeSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node flaky");
      assertExists(nodeSpan);
      const retryEvent = nodeSpan.events.find((event) => event.name === "workflow.node.retry");
      assertExists(retryEvent);
      assertEquals(retryEvent.attributes?.["workflow.node.error"], undefined);

      for (const value of Object.values(retryEvent.attributes ?? {})) {
        assertEquals(
          String(value).includes(rawMessage),
          false,
          "retry event exported the raw error message",
        );
        assertEquals(
          String(value).includes(secret),
          false,
          "retry event exported a customer secret",
        );
      }
    } finally {
      await tracing.dispose();
    }
  });

  it("flags a skipped node and emits nothing for a node replayed from completed state", async () => {
    const tracing = installRealTracing();
    try {
      const backend = new MemoryBackend();
      const executor = new WorkflowExecutor({ backend, enableLocking: false });
      executor.register(
        workflow({
          id: "skip-workflow",
          steps: [
            step("already_done", {
              tool: createTool("already_done", () => ({ ran: true })),
            }),
            step("skipped", {
              skip: () => true,
              tool: createTool("skipped", () => ({ ran: true })),
            }),
          ],
        }).definition,
      );

      const run: WorkflowRun = {
        id: "run-skip-workflow",
        workflowId: "skip-workflow",
        status: "running",
        input: {},
        nodeStates: {
          already_done: {
            nodeId: "already_done",
            status: "completed",
            output: { ran: true },
            attempt: 1,
          },
        },
        currentNodes: [],
        context: { input: {} },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      };
      await backend.createRun(run);
      await executor.resume(run.id);
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      assertEquals(
        byName(spans, "workflow.node already_done"),
        undefined,
        "a replayed node did no work, so it must emit no span",
      );

      const skipped = byName(spans, "workflow.node skipped");
      assertExists(skipped);
      assertEquals(skipped.attributes["workflow.node.skipped"], true);
    } finally {
      await tracing.dispose();
    }
  });

  it("never puts resolved step input or output on a span", async () => {
    const tracing = installRealTracing();
    try {
      const secret = "sk-customer-secret-value";
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "payload-workflow",
          steps: [
            step("handle", {
              input: { apiKey: secret },
              tool: createTool("handle", () => ({ echoed: secret })),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("payload-workflow", { apiKey: secret });
      await handle.settled();
      await tracing.provider.forceFlush();

      for (const span of tracing.exporter.getFinishedSpans()) {
        for (const value of Object.values(span.attributes)) {
          assertEquals(
            String(value).includes(secret),
            false,
            `${span.name} leaked step payload into a span attribute`,
          );
        }
        // Retry events carry an error message, the one free-form string this adds.
        for (const event of span.events) {
          for (const value of Object.values(event.attributes ?? {})) {
            assertEquals(
              String(value).includes(secret),
              false,
              `${span.name} leaked step payload into the ${event.name} event`,
            );
          }
        }
      }
    } finally {
      await tracing.dispose();
    }
  });

  it("runs unchanged and emits nothing when no tracing extension is wired", async () => {
    const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
    executor.register(
      workflow({
        id: "untraced-workflow",
        steps: [step("plain", { tool: createTool("plain", () => ({ ok: true })) })],
      }).definition,
    );

    const handle = await executor.start("untraced-workflow", {});
    await handle.settled();
    const result = await handle.status();
    assertEquals(result.status, "completed");
    // No provider is installed, so there is nothing to export and nothing to assert
    // against beyond the run behaving exactly as it did before instrumentation.
    assertEquals(result.output !== undefined, true);
  });

  it("imports the same withSpan the agent runtime uses", async () => {
    // Two different `withSpan` functions are exported from the observability layer. The
    // agent runtime uses the OTLP-setup one; if workflow code drifts to the other, spans
    // still appear but agent work stops nesting under its node — the exact bug this
    // module exists to fix, and one no span-count assertion would catch.
    const agentSource = await Deno.readTextFile(
      new URL("../../agent/runtime/index.ts", import.meta.url),
    );
    assertEquals(
      agentSource.includes('from "#veryfront/observability/tracing/otlp-setup.ts"'),
      true,
      "agent runtime no longer imports withSpan from otlp-setup; revisit workflow tracing",
    );

    for (const relative of ["./dag/index.ts", "./workflow-executor.ts", "./step-executor.ts"]) {
      const source = await Deno.readTextFile(new URL(relative, import.meta.url));
      const importsTracing =
        /import\s*\{[^}]*\}\s*from\s*"#veryfront\/observability\/tracing\/otlp-setup\.ts"/
          .test(source);
      assertEquals(
        importsTracing,
        true,
        `${relative} must trace through otlp-setup so agent spans nest under workflow nodes`,
      );
    }
  });

  it("marks a failed node and its run as errored on the span", async () => {
    const tracing = installRealTracing();
    try {
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "failing-workflow",
          steps: [
            step("boom", {
              tool: createTool("boom", () => {
                throw new Error("kaboom-detail");
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("failing-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const nodeSpan = byName(spans, "workflow.node boom");
      const runSpan = byName(spans, "workflow.run");
      assertExists(nodeSpan);
      assertExists(runSpan);

      // A node fails by RETURNING a failed state, so withSpan's catch never runs. Without
      // an explicit status these spans stay UNSET and no backend can surface the failure.
      assertEquals(nodeSpan.attributes["workflow.node.status"], "failed");
      assertEquals(nodeSpan.status.code, SpanStatusCode.ERROR);
      assertEquals(runSpan.status.code, SpanStatusCode.ERROR);
    } finally {
      await tracing.dispose();
    }
  });

  it("marks returned failed composite node and workflow outcomes as errored on spans", async () => {
    const tracing = installRealTracing();
    try {
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "returned-composite-failure-workflow",
          steps: [
            map("each", {
              items: ["only"],
              processor: step("item", {
                tool: createTool("item", () => {
                  throw new Error("returned-composite-detail");
                }),
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("returned-composite-failure-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const mapSpan = byName(spans, "workflow.node each");
      const runSpan = byName(spans, "workflow.run");
      assertExists(mapSpan);
      assertExists(runSpan);
      assertEquals(mapSpan.attributes["workflow.node.status"], "failed");
      assertEquals(mapSpan.status.code, SpanStatusCode.ERROR);
      assertEquals(runSpan.status.code, SpanStatusCode.ERROR);
    } finally {
      await tracing.dispose();
    }
  });

  it("records retry telemetry for composite nodes, not only steps", async () => {
    const tracing = installRealTracing();
    try {
      let attempts = 0;
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "composite-retry-workflow",
          steps: [
            map("each", {
              items: ["only"],
              retry: { maxAttempts: 2, backoff: "fixed", initialDelay: 1 },
              processor: step("item", {
                tool: createTool("item", () => {
                  attempts += 1;
                  if (attempts === 1) throw new Error("ECONNRESET");
                  return { ok: true };
                }),
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("composite-retry-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const mapSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node each");
      assertExists(mapSpan);
      assertEquals(mapSpan.attributes["workflow.node.attempts"], 2);

      const retryEvent = mapSpan.events.find((event) => event.name === "workflow.node.retry");
      assertExists(retryEvent, "composite retries must be recorded, not only step retries");
      assertEquals(retryEvent.attributes?.["workflow.node.attempt"], 1);
      assertEquals(retryEvent.attributes?.["workflow.node.error"], undefined);
      assertEquals(retryEvent.attributes?.["workflow.node.error_type"], "Error");
    } finally {
      await tracing.dispose();
    }
  });

  it("records the exact composite retry delay that was slept", async () => {
    const tracing = installRealTracing();
    const originalRandom = Math.random;
    try {
      Math.random = () => 1;
      let attempts = 0;
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "composite-retry-delay-workflow",
          steps: [
            map("each", {
              items: ["only"],
              retry: { maxAttempts: 2, backoff: "fixed", initialDelay: 20 },
              processor: step("item", {
                tool: createTool("item", () => {
                  attempts += 1;
                  if (attempts === 1) throw new Error("ECONNRESET");
                  return { ok: true };
                }),
              }),
            }),
          ],
        }).definition,
      );

      const start = Date.now();
      const handle = await executor.start("composite-retry-delay-workflow", {});
      await handle.settled();
      const elapsed = Date.now() - start;
      await tracing.provider.forceFlush();

      const mapSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node each");
      assertExists(mapSpan);
      const retryEvent = mapSpan.events.find((event) => event.name === "workflow.node.retry");
      assertExists(retryEvent, "composite retries must record their sleep delay");
      assertEquals(retryEvent.attributes?.["workflow.node.retry_delay_ms"], 22);
      assertEquals(elapsed >= 22, true);
    } finally {
      Math.random = originalRandom;
      await tracing.dispose();
    }
  });

  it("parents the run span to an ambient caller span when one is active", async () => {
    const tracing = installRealTracing();
    try {
      const { withSpan } = await import("#veryfront/observability/tracing/otlp-setup.ts");
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "ambient-workflow",
          steps: [step("only", { tool: createTool("only", () => ({ ok: true })) })],
        }).definition,
      );

      await withSpan("http.request", async () => {
        const handle = await executor.start("ambient-workflow", {});
        await handle.settled();
      });
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const caller = byName(spans, "http.request");
      const runSpan = byName(spans, "workflow.run");
      assertExists(caller);
      assertExists(runSpan);

      // The run span is a trace ROOT only when nothing traces the caller. Started from a
      // traced request it joins that trace instead, which is why `workflow.run_id` and not
      // trace identity is what correlates a run.
      assertEquals(parentIdOf(runSpan), caller.spanContext().spanId);
    } finally {
      await tracing.dispose();
    }
  });

  it("records the retry delay it actually slept, not a fresh jitter draw", async () => {
    const tracing = installRealTracing();
    // calculateRetryDelay applies +/-10% jitter from Math.random, so drawing it twice --
    // once to sleep, once to report -- yields a number that was never slept. Forcing the
    // draws to alternate makes a second draw produce a different, detectable value.
    const realRandom = Math.random;
    const draws = [0, 1, 0, 1];
    let index = 0;
    Math.random = () => draws[index++ % draws.length]!;
    try {
      let attempts = 0;
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "jitter-workflow",
          steps: [
            map("each", {
              items: ["x"],
              retry: { maxAttempts: 2, backoff: "fixed", initialDelay: 100 },
              processor: step("item", {
                tool: createTool("item", () => {
                  attempts += 1;
                  if (attempts === 1) throw new Error("ECONNRESET");
                  return { ok: true };
                }),
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("jitter-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const mapSpan = byName(tracing.exporter.getFinishedSpans(), "workflow.node each");
      assertExists(mapSpan);
      const retryEvent = mapSpan.events.find((event) => event.name === "workflow.node.retry");
      assertExists(retryEvent);
      // First draw (0) gives floor(100 - 10) = 90. A second draw (1) would give 110.
      assertEquals(retryEvent.attributes?.["workflow.node.retry_delay_ms"], 90);
    } finally {
      Math.random = realRandom;
      await tracing.dispose();
    }
  });

  it("reports a run failure normally even when the thrown error resists inspection", async () => {
    const tracing = installRealTracing();
    try {
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "hostile-error-workflow",
          steps: [
            step("hostile", {
              tool: createTool("hostile", () => {
                // Telemetry reads properties off whatever the caller threw. This pins
                // the end-to-end property that such an error still produces a normal
                // failed run. Note sanitizeErrorForTelemetry is itself defensive -- no
                // input was found that makes it throw -- so this covers the path, not
                // the guard inside it.
                const error = new Error("outer");
                Object.defineProperty(error, "message", {
                  get() {
                    throw new Error("message accessor exploded");
                  },
                });
                Object.defineProperty(error, "stack", {
                  get() {
                    throw new Error("stack accessor exploded");
                  },
                });
                throw error;
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("hostile-error-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      // The run still reaches a normal terminal state rather than the telemetry path
      // throwing past the executor.
      const run = await handle.status();
      assertEquals(run.status, "failed");
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps escaped node callback errors off the node span", async () => {
    const tracing = installRealTracing();
    try {
      const personal = "skip-secret@example.com";
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "leaky-skip-error-workflow",
          steps: [
            step("guarded", {
              skip: () => {
                throw new Error(`skip failed for ${personal}`);
              },
              tool: createTool("guarded", () => ({ ok: true })),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("leaky-skip-error-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const nodeSpan = byName(spans, "workflow.node guarded");
      assertExists(nodeSpan);
      assertEquals(nodeSpan.status.code, SpanStatusCode.ERROR);
      assertSpanDoesNotContain(spans, personal);
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps rethrown run failures and raw network codes off the run span", async () => {
    const tracing = installRealTracing();
    try {
      const personal = "run-secret@example.com";
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "leaky-run-error-workflow",
          steps: () => {
            const error = new Error("completion failed");
            (error as { code?: string }).code = `ECONNRESET:${personal}`;
            throw error;
          },
        }).definition,
      );

      const handle = await executor.start("leaky-run-error-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const runSpan = byName(spans, "workflow.run");
      assertExists(runSpan);
      assertEquals(runSpan.status.code, SpanStatusCode.ERROR);
      assertEquals(runSpan.status.message, "ECONNRESET");
      assertSpanDoesNotContain(spans, personal);
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps a thrown error's message off the span status and recorded exception", async () => {
    const tracing = installRealTracing();
    try {
      // The attribute sanitiser is key-name driven: it redacts key-shaped tokens but
      // passes ordinary prose through. A live OTLP export showed a customer email
      // reaching the wire via status.message and exception.message on both the node and
      // run spans, which span-attribute assertions alone never covered.
      const personal = "bob@example.com";
      const executor = new WorkflowExecutor({ backend: new MemoryBackend(), enableLocking: false });
      executor.register(
        workflow({
          id: "leaky-error-workflow",
          steps: [
            step("publish", {
              tool: createTool("publish", () => {
                throw new Error(`publish failed for account ${personal}`);
              }),
            }),
          ],
        }).definition,
      );

      const handle = await executor.start("leaky-error-workflow", {});
      await handle.settled();
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      const nodeSpan = byName(spans, "workflow.node publish");
      const runSpan = byName(spans, "workflow.run");
      assertExists(nodeSpan);
      assertExists(runSpan);

      // Still visible to errored-span queries.
      assertEquals(nodeSpan.status.code, SpanStatusCode.ERROR);
      assertEquals(runSpan.status.code, SpanStatusCode.ERROR);

      assertSpanDoesNotContain(spans, personal);
    } finally {
      await tracing.dispose();
    }
  });
});
