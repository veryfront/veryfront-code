import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  buildProviderError,
  requestJson,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  datasets,
  EVAL_REPORT_SCHEMA_VERSION,
  evalAgent,
  evalDataset,
  type EvalMetric,
  type EvalRecord,
  evalTool,
  metrics,
  runEval,
} from "veryfront/eval";
import { createEvalReportExporterRegistry } from "veryfront/extensions/eval";
import {
  _resetShimForTests,
  type MetricsAPI,
  setGlobalActiveSpanAccessor,
  setGlobalMetricsAPI,
  type Span,
} from "../observability/tracing/api-shim.ts";
import { metrics as runtimeMetrics } from "#veryfront/metrics";
import { createOutboundFetchBoundary } from "#veryfront/security/http/outbound-fetch.ts";

async function createGatewayCreditDenial(): Promise<Error> {
  const error = await buildProviderError(
    "anthropic",
    new Response(
      JSON.stringify({
        slug: "insufficient-credits",
        error: "AI credit limit exceeded",
        suggestion: "Purchase additional credits or upgrade your subscription plan.",
        balance: 0,
        required: 0.25,
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    ),
  );
  error.message = `veryfront-cloud request failed: ${error.message}`;
  return error;
}

function createUnprintableThrownValue(): object {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  return revocable.proxy;
}

/** A guarded fetch whose DNS answers every host with `addresses`. */
function blockingGuardedFetch(baseUrl: string, addresses: string[]): typeof fetch {
  return createOutboundFetchBoundary({
    fetch: () => Promise.resolve(Response.json({ ok: true })),
    pinnedFetch: () => Promise.resolve(Response.json({ ok: true })),
    resolveHost: () => Promise.resolve(addresses),
  }).createOriginBoundFetch(baseUrl);
}

/** A model request whose provider transport the egress guard blocks. */
function blockedModelRequest(): Promise<unknown> {
  const apiBaseUrl = getVeryfrontCloudBootstrap().apiBaseUrl.replace(/\/+$/, "");
  const apiOrigin = new URL(apiBaseUrl).origin;
  return requestJson({
    url: `${apiBaseUrl}/ai/gateway/openai/v1/responses`,
    fetchImpl: blockingGuardedFetch(apiOrigin, ["10.255.128.3"]),
    init: { method: "POST", body: "{}" },
    providerLabel: "veryfront-cloud",
    providerKind: "openai",
  });
}

describe("eval/runner", () => {
  afterEach(() => {
    _resetShimForTests();
    runtimeMetrics.__resetForTests();
  });

  it("runs an agent eval and summarizes metric results", async () => {
    const definition = evalAgent({
      id: "eval:capital-answer",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "France capital?", reference: "Paris" },
        { id: "q2", input: "Germany capital?", reference: "Berlin" },
      ]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async ({ example }) => ({ text: example.reference as string }),
      },
    });

    assertEquals(report.kind, "eval-report");
    assertEquals(report.schemaVersion, EVAL_REPORT_SCHEMA_VERSION);
    assertEquals(report.definitionId, "eval:capital-answer");
    assertEquals(report.target, "agent:researcher");
    assertEquals(report.dataset?.kind, "inline");
    assertEquals(report.dataset?.examples, 2);
    assertEquals(report.dataset?.hash.startsWith("sha256:"), true);
    assertEquals(report.summary.records, 2);
    assertEquals(report.summary.passed, 2);
    assertEquals(report.summary.failed, 0);
    assertEquals(report.summary.passRate, 1);
    assertEquals(report.summary.metrics, [
      {
        name: "answer.exactMatch",
        family: "answer",
        severity: "gate",
        passed: 2,
        failed: 0,
        skipped: 0,
        passRate: 1,
        label: "Answer matched the reference exactly",
      },
    ]);
  });

  it("grades a dataset eval's stored value without executing a target", async () => {
    const captured: EvalRecord[] = [];
    const capture: EvalMetric = {
      name: "capture",
      family: "check",
      severity: "soft",
      evaluate(record) {
        captured.push(record);
        return { name: "capture", family: "check", severity: "soft", pass: true };
      },
      gate: () => capture,
      soft: () => capture,
      budget: () => capture,
    };
    const definition = evalDataset({
      id: "eval:standing-text",
      dataset: datasets.inline([
        {
          id: "case-1",
          input: "Standing answer.",
          reference: "pass",
          metadata: { label: "good" },
        },
      ]),
      metrics: [capture],
      repetitions: 2,
    });

    const report = await runEval(definition, {
      adapters: {
        agent: () => {
          throw new Error("agent adapter must not run for dataset evals");
        },
        tool: () => {
          throw new Error("tool adapter must not run for dataset evals");
        },
      },
    });

    assertEquals(report.targetKind, "dataset");
    assertEquals(report.target, "eval:standing-text");
    assertEquals(report.summary.records, 2);
    assertEquals(report.summary.passed, 2);
    assertEquals(report.summary.failed, 0);
    assertEquals(captured.length, 2);
    for (const record of report.records) {
      assertEquals(record.output, "Standing answer.");
      assertEquals(record.input, "Standing answer.");
      assertEquals(record.reference, "pass");
      assertEquals(record.metadata, { label: "good" });
      assertEquals(record.completed, true);
      assertEquals(record.error, undefined);
      assertEquals(record.trace, { events: [], toolCalls: [] });
      assertEquals(record.usage, {});
      assertEquals(Object.hasOwn(record, "executionInput"), false);
    }
  });

  it("fails a record on a blown budget metric but not on a soft metric", async () => {
    const definition = evalAgent({
      id: "eval:budget-severity",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "over-budget", input: "France capital?", reference: "Paris" },
        { id: "soft-only", input: "Germany capital?", reference: "Berlin" },
      ]),
      metrics: [
        metrics.ops.cost({ maxUsd: 0.0001 }).budget(),
        metrics.answer.exactMatch().soft(),
      ],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async ({ example }) => ({
          text: "Wrong answer.",
          usage: { costUsd: example.id === "over-budget" ? 0.5 : 0 },
        }),
      },
    });

    const overBudget = report.records.find((record) => record.exampleId === "over-budget");
    const softOnly = report.records.find((record) => record.exampleId === "soft-only");
    assertExists(overBudget);
    assertExists(softOnly);
    assertEquals(report.summary.failed, 1, "a failing budget metric fails the run");
    assertEquals(
      overBudget.completed,
      false,
      "a failing budget metric marks the record incomplete",
    );
    assertEquals(
      softOnly.completed,
      true,
      "a failing soft metric leaves the record complete",
    );
  });

  it("matches an agent's strict JSON text as structured output", async () => {
    const definition = evalAgent({
      id: "eval:structured-answer",
      target: "agent:orchestrator",
      dataset: datasets.inline([{
        id: "run-1",
        input: "Report terminal counts",
        reference: { claimed_elsewhere: 2, failed: 0, succeeded: 1 },
      }]),
      metrics: [metrics.answer.jsonMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({
          text: '{"succeeded":1,"claimed_elsewhere":2,"failed":0}',
        }),
      },
    });

    assertEquals(report.summary.passed, 1);
    assertEquals(report.summary.failed, 0);
    assertEquals(report.summary.metrics[0]?.name, "answer.jsonMatch");
  });

  it("records check assertions alongside metric results", async () => {
    const definition = evalAgent({
      id: "eval:check-api",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      check(ctx) {
        ctx.expect.completed().gate();
        ctx.expect.outputContains("Paris").gate();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(record.checks?.map((check) => check.name), [
      "expect.completed",
      "expect.outputContains",
    ]);
    assertEquals(report.summary.passed, 1);
  });

  it("records agent tool behavior checks", async () => {
    const definition = evalAgent({
      id: "eval:tool-checks",
      target: "agent:support",
      dataset: datasets.inline([{ id: "refund", input: "Process refund A1049" }]),
      check(ctx) {
        ctx.expect.calledTool("orders_lookup", {
          input: { orderId: "A1049" },
          match: "partial",
        }).gate();
        ctx.expect.notCalledTool("refunds_issue").gate();
        ctx.expect.toolCallCount("orders_lookup", { exact: 1 }).gate();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({
          text: "I need to verify eligibility before issuing a refund.",
          trace: {
            toolCalls: [
              {
                name: "orders_lookup",
                status: "ok",
                input: { orderId: "A1049", includeHistory: true },
              },
              { name: "policy_lookup", status: "ok", input: { topic: "refunds" } },
            ],
          },
        }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(record.checks?.map((check) => check.name), [
      "expect.calledTool",
      "expect.notCalledTool",
      "expect.toolCallCount",
    ]);
    assertEquals(record.checks?.map((check) => check.pass), [true, true, true]);
    assertEquals(report.summary.passed, 1);
  });

  it("runs a realistic RAG eval with retrieval, groundedness, citations, and report summaries", async () => {
    const definition = evalAgent({
      id: "eval:support-rag",
      name: "Support RAG answer quality",
      target: "agent:support",
      dataset: datasets.inline([
        {
          id: "billing-credit-expiry",
          input: {
            question:
              "A customer says their credits disappeared after the billing cycle. What should support check first?",
          },
          reference:
            "Check the billing ledger, credit grant, expiration policy, and recent usage before changing the account.",
          metadata: {
            expectedKnowledge: [
              "knowledge/billing/credits.md",
              "knowledge/support/playbooks/billing-ledger.md",
            ],
          },
        },
      ]),
      metrics: [
        metrics.agent.calledTool("search_knowledge").gate(),
        metrics.agent.noFailedTools().gate(),
        metrics.knowledge.recallAtK({ k: 3 }).gate({ min: 1 }),
        metrics.knowledge.precisionAtK({ k: 3 }).soft({ min: 0.6 }),
        metrics.knowledge.citationPrecision().gate({ min: 1 }),
        metrics.knowledge.citationRecall().gate({ min: 1 }),
        metrics.answer.groundedness({
          judge: async ({ evidence, output, sources }) => {
            const joinedEvidence = evidence.join("\n");
            const pass = String(output.text).includes("billing ledger") &&
              joinedEvidence.includes("expiration policy") &&
              sources.includes("knowledge/billing/credits.md");
            return {
              score: pass ? 0.92 : 0.1,
              pass,
              explanation: "The answer is supported by retrieved billing knowledge.",
            };
          },
        }).gate({ min: 0.8 }),
      ],
      check(ctx) {
        ctx.expect.completed().gate();
        ctx.expect.outputContains("billing ledger").gate();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({
          text:
            "Check the billing ledger, credit grant, expiration policy, and recent usage before changing the account. [credits] [ledger]",
          retrievedContext: [
            {
              source: "knowledge/billing/credits.md",
              content:
                "Credit grants can expire by expiration policy and should be checked against the usage ledger.",
            },
            {
              source: "knowledge/support/playbooks/billing-ledger.md",
              content: "Support must review the billing ledger before changing a customer account.",
            },
            {
              source: "knowledge/unrelated.md",
              content: "General account settings.",
            },
          ],
          citations: [
            { source: "knowledge/billing/credits.md", text: "[credits]" },
            { source: "knowledge/support/playbooks/billing-ledger.md", text: "[ledger]" },
          ],
          trace: {
            toolCalls: [
              {
                name: "search_knowledge",
                status: "ok",
                input: { query: "billing credit expiry ledger" },
                output: {
                  data: [
                    {
                      path: "knowledge/billing/credits.md",
                      content:
                        "Credit grants can expire by expiration policy and should be checked against the usage ledger.",
                    },
                    {
                      path: "knowledge/support/playbooks/billing-ledger.md",
                      content:
                        "Support must review the billing ledger before changing a customer account.",
                    },
                    {
                      path: "knowledge/unrelated.md",
                      content: "General account settings.",
                    },
                  ],
                },
              },
            ],
          },
          usage: { inputTokens: 800, outputTokens: 120, totalTokens: 920 },
          durationMs: 840,
        }),
      },
    });

    assertEquals(report.summary.records, 1);
    assertEquals(report.summary.passed, 1);
    assertEquals(report.summary.failed, 0);
    assertEquals(report.records[0]?.retrievedContext?.length, 3);
    assertEquals(report.records[0]?.citations?.map((citation) => citation.source), [
      "knowledge/billing/credits.md",
      "knowledge/support/playbooks/billing-ledger.md",
    ]);
    assertEquals(
      report.records[0]?.metrics?.map((metric) => ({
        name: metric.name,
        score: metric.score,
        pass: metric.pass,
      })),
      [
        { name: "agent.calledTool", score: 1, pass: true },
        { name: "agent.noFailedTools", score: 1, pass: true },
        { name: "knowledge.recallAtK", score: 1, pass: true },
        { name: "knowledge.precisionAtK", score: 2 / 3, pass: true },
        { name: "knowledge.citationPrecision", score: 1, pass: true },
        { name: "knowledge.citationRecall", score: 1, pass: true },
        { name: "answer.groundedness", score: 0.92, pass: true },
      ],
    );
    assertEquals(report.summary.metrics.map((metric) => metric.name), [
      "agent.calledTool",
      "agent.noFailedTools",
      "knowledge.recallAtK",
      "knowledge.precisionAtK",
      "knowledge.citationPrecision",
      "knowledge.citationRecall",
      "answer.groundedness",
      "expect.completed",
      "expect.outputContains",
    ]);
  });

  it("runs a tool eval and records the direct tool call trace", async () => {
    const definition = evalTool({
      id: "eval:lookup-tool",
      target: "tool:lookup_order",
      dataset: datasets.inline([
        {
          id: "order-1",
          input: { orderId: "A1049", prompt: "Find order A1049" },
          reference: { status: "shipped" },
        },
      ]),
      input: (example) => ({ orderId: (example.input as { orderId: string }).orderId }),
      metrics: [
        metrics.agent.calledTool("lookup_order", {
          input: { orderId: "A1049" },
          match: "partial",
        }).gate(),
        metrics.answer.jsonMatch({ expected: { status: "shipped" } }).gate(),
      ],
    });

    const report = await runEval(definition, {
      adapters: {
        tool: async ({ input }) => ({
          output: { status: input === undefined ? "missing" : "shipped" },
          toolCallId: "eval-lookup-tool-order-1",
          durationMs: 12,
          usage: { totalTokens: 0, costUsd: 0 },
        }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(report.targetKind, "tool");
    assertEquals(report.target, "tool:lookup_order");
    assertEquals(report.summary.records, 1);
    assertEquals(report.summary.passed, 1);
    assertEquals(record.input, { orderId: "A1049", prompt: "Find order A1049" });
    assertEquals(record.executionInput, { orderId: "A1049" });
    assertEquals(record.output, { status: "shipped" });
    assertEquals(record.trace.toolCalls, [
      {
        id: "eval-lookup-tool-order-1",
        name: "lookup_order",
        status: "ok",
        input: { orderId: "A1049" },
        output: { status: "shipped" },
        metadata: { durationMs: 12 },
      },
    ]);
  });

  it("keeps direct tool string outputs as JSON string values", async () => {
    const definition = evalTool({
      id: "eval:string-tool",
      target: "tool:string_value",
      dataset: datasets.inline([{
        id: "string-1",
        input: null,
        reference: "not-json",
      }]),
      metrics: [metrics.answer.jsonMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        tool: async () => ({ output: "not-json" }),
      },
    });

    assertEquals(report.summary.passed, 1);
    assertEquals(report.summary.failed, 0);
  });

  it("preserves mapped undefined tool input in direct tool traces", async () => {
    const definition = evalTool({
      id: "eval:lookup-tool-empty-input",
      target: "tool:lookup_order",
      dataset: datasets.inline([
        {
          id: "order-1",
          input: { orderId: "A1049" },
        },
      ]),
      input: () => undefined,
      metrics: [
        metrics.agent.calledTool("lookup_order", {
          input: undefined,
          match: "exact",
        }).gate(),
      ],
    });

    const report = await runEval(definition, {
      adapters: {
        tool: async ({ input }) => ({
          output: { sawUndefinedInput: input === undefined },
        }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(report.summary.passed, 1);
    assertEquals(record.output, { sawUndefinedInput: true });
    assertEquals(Object.hasOwn(record, "executionInput"), true);
    assertEquals(record.executionInput, undefined);
    assertEquals(record.trace.toolCalls[0]?.input, undefined);
  });

  it("does not synthesize a direct tool call when tool input mapping fails", async () => {
    const definition = evalTool({
      id: "eval:lookup-tool-input-error",
      target: "tool:lookup_order",
      dataset: datasets.inline([{ id: "order-1", input: { orderId: "A1049" } }]),
      input: () => {
        throw new Error("Invalid order fixture");
      },
      metrics: [metrics.agent.calledTool("lookup_order").gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        tool: async () => ({
          output: { status: "should-not-run" },
        }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(report.summary.passed, 0);
    assertEquals(record.completed, false);
    assertEquals(record.error, "Invalid order fixture");
    assertEquals(record.trace.toolCalls, []);
  });

  it("counts adapter errors as failed records even without metrics", async () => {
    const definition = evalAgent({
      id: "eval:adapter-error",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => {
          throw new Error("AG-UI request failed");
        },
      },
    });

    assertEquals(report.summary.records, 1);
    assertEquals(report.summary.passed, 0);
    assertEquals(report.summary.failed, 1);
    assertEquals(report.summary.passRate, 0);
    assertEquals(report.records[0]?.completed, false);
    assertEquals(report.records[0]?.error, "AG-UI request failed");
  });

  it("stops at the first model access denial instead of grading empty output", async () => {
    let adapterCalls = 0;
    let checkCalls = 0;
    const definition = evalAgent({
      id: "eval:no-model-access",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
        { id: "q3", input: "Third" },
      ]),
      check({ record }) {
        checkCalls += 1;
        JSON.parse(String(record.output ?? ""));
      },
    });
    const denial = await createGatewayCreditDenial();

    const error = (await assertRejects(
      () =>
        runEval(definition, {
          adapters: {
            agent: async () => {
              adapterCalls += 1;
              throw denial;
            },
          },
        }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-access-denied");
    assertEquals(
      error.detail,
      'Eval "eval:no-model-access" stopped at its first refused model request: AI credit limit exceeded: 0.25 credits required, 0 available. Purchase additional credits or upgrade your subscription plan.',
    );
    assertEquals(adapterCalls, 1);
    assertEquals(checkCalls, 0);
  });

  it("stops at the first gateway project-required rejection", async () => {
    let adapterCalls = 0;
    const definition = evalAgent({
      id: "eval:no-project",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
      ]),
    });

    const error = (await assertRejects(
      () =>
        runEval(definition, {
          adapters: {
            agent: async () => {
              adapterCalls += 1;
              return await requestJson({
                url: `${
                  new URL(getVeryfrontCloudBootstrap().apiBaseUrl).origin
                }/ai/gateway/anthropic/v1/messages`,
                fetchImpl: () =>
                  Promise.resolve(
                    new Response(
                      JSON.stringify({
                        error: "A project is required to use Veryfront-managed AI inference",
                        code: "gateway_project_required",
                      }),
                      { status: 400, headers: { "Content-Type": "application/json" } },
                    ),
                  ),
                init: { method: "POST", body: "{}" },
                providerLabel: "veryfront-cloud",
                providerKind: "anthropic",
              }) as never;
            },
          },
        }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-project-required");
    assertEquals(adapterCalls, 1);
  });

  it("stops at the first Veryfront Cloud credential rejection", async () => {
    let adapterCalls = 0;
    const definition = evalAgent({
      id: "eval:rejected-credential",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
      ]),
    });

    const error = (await assertRejects(
      () =>
        runEval(definition, {
          adapters: {
            agent: async () => {
              adapterCalls += 1;
              return await requestJson({
                url: `${
                  new URL(getVeryfrontCloudBootstrap().apiBaseUrl).origin
                }/ai/gateway/anthropic/v1/messages`,
                fetchImpl: () =>
                  Promise.resolve(new Response('{"error":"Unauthorized"}', { status: 401 })),
                init: { method: "POST", body: "{}" },
                providerLabel: "veryfront-cloud",
                providerKind: "anthropic",
              }) as never;
            },
          },
        }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-unauthorized");
    assertEquals(adapterCalls, 1);
  });

  it("stops at the first model request the egress guard blocks", async () => {
    let adapterCalls = 0;
    const definition = evalAgent({
      id: "eval:blocked-endpoint",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
      ]),
    });

    const error = (await assertRejects(
      () =>
        runEval(definition, {
          adapters: {
            agent: async () => {
              adapterCalls += 1;
              return await blockedModelRequest() as never;
            },
          },
        }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-egress-blocked");
    assertEquals(
      error.detail,
      'Eval "eval:blocked-endpoint" stopped at its first refused model request: Veryfront blocked the request to the configured Veryfront API because its host resolves to a private network address',
    );
    assertEquals(adapterCalls, 1);
  });

  it("keeps a tool eval that calls a blocked private endpoint as a record failure", async () => {
    let adapterCalls = 0;
    const definition = evalTool({
      id: "eval:tool-private-endpoint",
      target: "tool:lookup",
      dataset: datasets.inline([
        { id: "q1", input: { q: "First" } },
        { id: "q2", input: { q: "Second" } },
      ]),
    });
    const blockedFetch = blockingGuardedFetch("https://internal.example", ["10.0.0.8"]);

    const report = await runEval(definition, {
      adapters: {
        tool: async () => {
          adapterCalls += 1;
          await blockedFetch("https://internal.example/lookup");
          return { output: "unreachable" };
        },
      },
    });

    assertEquals(adapterCalls, 2);
    assertEquals(report.records.map((record) => record.completed), [false, false]);
  });

  it("stops when an eval check is refused model access", async () => {
    let checkCalls = 0;
    const definition = evalAgent({
      id: "eval:check-blocked-endpoint",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
      ]),
      check: async () => {
        checkCalls += 1;
        await blockedModelRequest();
      },
    });

    const error = (await assertRejects(
      () => runEval(definition, { adapters: { agent: async () => ({ text: "Paris" }) } }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-egress-blocked");
    assertEquals(checkCalls, 1);
  });

  it("reports progress for every record in dataset order", async () => {
    const definition = evalAgent({
      id: "eval:progress",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "First" },
        { id: "q2", input: "Second" },
      ]),
      metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
    });
    const events: string[] = [];

    await runEval(definition, {
      adapters: { agent: async ({ example }) => example.id === "q1" ? "Paris" : "Lyon" },
      onProgress: (event) => {
        events.push(
          event.type === "eval-started"
            ? `${event.type} ${event.evalId} total=${event.total}`
            : event.type === "record-started"
            ? `${event.type} ${event.recordId} ${event.index + 1}/${event.total}`
            : `${event.type} ${event.recordId} completed=${event.completed}`,
        );
        throw new Error("a failing progress listener must not affect the run");
      },
    });

    assertEquals(events, [
      "eval-started eval:progress total=2",
      "record-started q1:1 1/2",
      "record-finished q1:1 completed=true",
      "record-started q2:1 2/2",
      "record-finished q2:1 completed=false",
    ]);
  });

  it("runs records concurrently up to the limit and keeps report order", async () => {
    const definition = evalAgent({
      id: "eval:concurrent",
      target: "agent:researcher",
      dataset: datasets.inline(
        ["q1", "q2", "q3", "q4", "q5"].map((id) => ({ id, input: id })),
      ),
    });
    const releases = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const started: string[] = [];

    const run = runEval(definition, {
      concurrency: 2,
      adapters: {
        agent: async ({ example }) => {
          active += 1;
          peak = Math.max(peak, active);
          started.push(example.id);
          await new Promise<void>((resolve) => releases.set(example.id, resolve));
          active -= 1;
          return example.id;
        },
      },
    });

    const releaseWhenStarted = async (id: string): Promise<void> => {
      while (!releases.has(id)) await new Promise((resolve) => setTimeout(resolve, 0));
      releases.get(id)!();
    };
    // Finish records out of dataset order to prove the report does not follow completion order.
    await releaseWhenStarted("q2");
    await releaseWhenStarted("q3");
    await releaseWhenStarted("q1");
    await releaseWhenStarted("q5");
    await releaseWhenStarted("q4");
    const report = await run;

    assertEquals(peak, 2);
    assertEquals(started, ["q1", "q2", "q3", "q4", "q5"]);
    assertEquals(report.records.map((record) => record.exampleId), ["q1", "q2", "q3", "q4", "q5"]);
  });

  it("starts no new records after a model access denial when running concurrently", async () => {
    const definition = evalAgent({
      id: "eval:concurrent-denial",
      target: "agent:researcher",
      dataset: datasets.inline(
        ["q1", "q2", "q3", "q4"].map((id) => ({ id, input: id })),
      ),
    });
    const denial = await createGatewayCreditDenial();
    const calls: string[] = [];

    const error = (await assertRejects(
      () =>
        runEval(definition, {
          concurrency: 2,
          adapters: {
            agent: async ({ example }) => {
              calls.push(example.id);
              if (example.id === "q1") throw denial;
              return "ok";
            },
          },
        }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-access-denied");
    assertEquals(calls, ["q1", "q2"]);
  });

  it("rejects a concurrency that is not a positive integer", async () => {
    const definition = evalAgent({
      id: "eval:bad-concurrency",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "First" }]),
    });

    for (const concurrency of [0, 1.5, Number.NaN]) {
      const error = await assertRejects(
        () => runEval(definition, { concurrency, adapters: { agent: async () => "ok" } }),
      ) as Error;
      assertEquals(error.message.includes("Eval concurrency must be a positive integer"), true);
    }
  });

  it("stops when a judge metric is refused model access", async () => {
    const denial = await createGatewayCreditDenial();
    const judge = metrics.answer.exactMatch().gate();
    judge.evaluate = () => Promise.reject(denial);
    const definition = evalAgent({
      id: "eval:judge-no-model-access",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "First", reference: "Paris" }]),
      metrics: [judge],
    });

    const error = (await assertRejects(
      () => runEval(definition, { adapters: { agent: async () => ({ text: "Paris" }) } }),
      VeryfrontError,
    )) as VeryfrontError;

    assertEquals(error.slug, "eval-model-access-denied");
  });

  it("attributes a check that throws on a failed target output to the target failure", async () => {
    const definition = evalAgent({
      id: "eval:check-after-target-failure",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "First" }]),
      check({ record }) {
        // A fixed message keeps the assertion independent of each engine's
        // JSON.parse wording.
        if (!(record.output as { text?: string } | undefined)?.text) {
          throw new Error("output is not valid JSON");
        }
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => {
          throw new Error("upstream unavailable");
        },
      },
    });

    assertEquals(
      report.records[0]?.error,
      "upstream unavailable; Eval check could not evaluate the failed target output: output is not valid JSON",
    );
  });

  it("contains hostile adapter throws as structured record failures", async () => {
    const definition = evalAgent({
      id: "eval:hostile-adapter-error",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => {
          throw createUnprintableThrownValue();
        },
      },
    });

    assertEquals(report.records[0]?.completed, false);
    assertEquals(report.records[0]?.error, "[unprintable thrown value]");
  });

  it("contains hostile metric and check throws as structured evaluation failures", async () => {
    const hostileMetric = metrics.answer.exactMatch().gate();
    hostileMetric.evaluate = () => {
      throw createUnprintableThrownValue();
    };
    const definition = evalAgent({
      id: "eval:hostile-evaluation-errors",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [hostileMetric],
      check() {
        throw createUnprintableThrownValue();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
    });

    assertEquals(report.records[0]?.completed, false);
    assertEquals(
      report.records[0]?.error,
      "Metric evaluation failed: [unprintable thrown value]; Eval check failed: [unprintable thrown value]",
    );
  });

  it("normalizes revoked trace arrays into structured adapter failures", async () => {
    const definition = evalAgent({
      id: "eval:revoked-trace",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });
    const revokedEvents = Proxy.revocable([], {});
    revokedEvents.revoke();

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({
          text: "Paris",
          trace: { events: revokedEvents.proxy },
        }),
      },
    });

    assertEquals(report.records[0]?.completed, false);
    assertEquals(report.records[0]?.error, "Eval adapter trace events must be an array");
  });

  it("emits eval result and duration metrics through the runtime metrics API", async () => {
    const counterCalls: unknown[] = [];
    const histogramCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram(name: string) {
            return {
              record(value: number, attributes?: Record<string, unknown>) {
                histogramCalls.push({ name, value, attributes });
              },
            };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    const definition = evalAgent({
      id: "metrics-smoke-runtime",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "France capital?", reference: "Paris" },
      ]),
      metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris", durationMs: 1558 }),
      },
    });

    assertEquals(counterCalls, [
      {
        name: "vf_eval_result_total",
        value: 1,
        attributes: {
          eval_id: "metrics-smoke-runtime",
          target_kind: "agent",
          metric: "answer.contains",
          family: "answer",
          severity: "gate",
          outcome: "pass",
        },
      },
    ]);
    assertEquals(histogramCalls, [
      {
        name: "vf_eval_duration_ms",
        value: 1558,
        attributes: {
          eval_id: "metrics-smoke-runtime",
          target_kind: "agent",
          metric: "duration",
          outcome: "pass",
        },
      },
    ]);
  });

  it("exports completed reports through selected eval report exporters", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedReports: unknown[] = [];

    registry.register({
      id: "capture",
      export(report, context) {
        exportedReports.push({ report, context });
        return {
          externalRunId: "capture-run-1",
          url: "https://evals.example.test/runs/capture-run-1",
        };
      },
    });

    const definition = evalAgent({
      id: "eval:export",
      target: "agent:researcher",
      dataset: datasets.inline([
        {
          id: "q1",
          input: { prompt: "France capital?", secret: "private" },
          reference: "Paris",
          metadata: { dataset: "smoke", tenantId: "tenant-private" },
        },
      ]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture", "missing"],
        context: {
          projectReference: "docs-agent",
          sourcePath: "evals/export.eval.ts",
          redaction: { metadataAllowlist: ["dataset"] },
        },
      },
    });

    assertEquals(report.exports, [
      {
        exporterId: "capture",
        ok: true,
        receipt: {
          externalRunId: "capture-run-1",
          url: "https://evals.example.test/runs/capture-run-1",
        },
      },
      {
        exporterId: "missing",
        ok: false,
        error: 'No EvalReportExporter registered for "missing".',
      },
    ]);
    assertEquals(exportedReports.length, 1);
    const exported = exportedReports[0] as {
      report: { records: Array<{ input: unknown; reference?: unknown; metadata: unknown }> };
      context: unknown;
    };
    assertEquals(exported.report.records[0]?.input, "[redacted]");
    assertEquals(exported.report.records[0]?.reference, "[redacted]");
    assertEquals(exported.report.records[0]?.metadata, { dataset: "smoke" });
    assertEquals(exported.context, {
      projectReference: "docs-agent",
      sourcePath: "evals/export.eval.ts",
      redaction: { metadataAllowlist: ["dataset"] },
    });
  });

  it("contains hostile exporter registry throws as structured export failures", async () => {
    const registry = createEvalReportExporterRegistry();
    registry.get = () => {
      throw createUnprintableThrownValue();
    };
    const definition = evalAgent({
      id: "eval:hostile-exporter-error",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["hostile"],
      },
    });

    assertEquals(report.exports, [{
      exporterId: "hostile",
      ok: false,
      error: "[unprintable thrown value]",
    }]);
  });

  it("adds the active runtime trace context to eval report exports", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    setGlobalActiveSpanAccessor({
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: "trace-1234567890abcdef1234567890abcdef",
          spanId: "span-1234567890",
          traceFlags: 1,
        }),
      } as Span),
      getSpan: () => undefined,
    });

    const definition = evalAgent({
      id: "eval:trace-export",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture"],
        context: {
          projectReference: "docs-agent",
        },
      },
    });

    assertEquals(exportedContexts, [
      {
        projectReference: "docs-agent",
        trace: {
          traceId: "trace-1234567890abcdef1234567890abcdef",
          spanId: "span-1234567890",
        },
      },
    ]);
  });

  it("suppresses an inactive all-zero span context from eval report exports", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    setGlobalActiveSpanAccessor({
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 0,
        }),
      } as Span),
      getSpan: () => undefined,
    });

    const definition = evalAgent({
      id: "eval:inactive-trace-export",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture"],
        context: {
          projectReference: "docs-agent",
        },
      },
    });

    assertEquals(
      exportedContexts,
      [{ projectReference: "docs-agent" }],
      "an all-zero span context is not exported as a trace",
    );
  });

  it("preserves explicit eval report export trace context", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    setGlobalActiveSpanAccessor({
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: "active-trace",
          spanId: "active-span",
          traceFlags: 1,
        }),
      } as Span),
      getSpan: () => undefined,
    });

    const definition = evalAgent({
      id: "eval:explicit-trace-export",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture"],
        context: {
          trace: {
            traceId: "explicit-trace",
            spanId: "explicit-span",
            parentSpanId: "explicit-parent",
          },
        },
      },
    });

    assertEquals(exportedContexts, [
      {
        trace: {
          traceId: "explicit-trace",
          spanId: "explicit-span",
          parentSpanId: "explicit-parent",
        },
      },
    ]);
  });
});
