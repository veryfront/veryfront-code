import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { MemoryBackend } from "../backends/memory.ts";
import { map, parallel, step, subWorkflow, workflow } from "../dsl/index.ts";
import { WorkflowExecutor } from "./workflow-executor.ts";
import type { WorkflowRun } from "../types.ts";
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
      assertEquals(retryEvent.attributes?.["workflow.node.error"], "ECONNRESET");
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
      assertEquals(
        source.includes('from "#veryfront/observability/tracing/otlp-setup.ts"'),
        true,
        `${relative} must trace through otlp-setup so agent spans nest under workflow nodes`,
      );
    }
  });
});
