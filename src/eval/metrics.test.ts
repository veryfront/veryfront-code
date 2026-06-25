import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type EvalRecord, metrics } from "veryfront/eval";

function createRecord(overrides: Partial<EvalRecord> = {}): EvalRecord {
  return {
    id: "record-1",
    evalId: "eval:answers",
    exampleId: "q1",
    repetition: 1,
    input: "What is the capital of France?",
    output: { text: "Paris" },
    reference: "Paris",
    metadata: {},
    trace: { events: [], toolCalls: [] },
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, costUsd: 0.001 },
    durationMs: 42,
    completed: true,
    ...overrides,
  };
}

describe("eval/metrics", () => {
  it("evaluates deterministic answer metrics", async () => {
    const exact = metrics.answer.exactMatch().gate();
    const contains = metrics.answer.contains({ text: "Par" }).soft();
    const regex = metrics.answer.regex({ pattern: "^Par" }).gate();
    const jsonMatch = metrics.answer.jsonMatch({ expected: { city: "Paris" } }).gate();

    assertEquals(await exact.evaluate(createRecord()), {
      name: "answer.exactMatch",
      family: "answer",
      severity: "gate",
      score: 1,
      pass: true,
    });
    assertEquals((await contains.evaluate(createRecord())).pass, true);
    assertEquals((await regex.evaluate(createRecord())).pass, true);
    assertEquals(
      (await jsonMatch.evaluate(createRecord({ output: { json: { city: "Paris" } } }))).pass,
      true,
    );
  });

  it("evaluates agent and operations metrics", async () => {
    const noFailedTools = metrics.agent.noFailedTools().gate();
    const latency = metrics.ops.latency({ maxMs: 100 }).budget();
    const tokens = metrics.ops.tokens({ maxTotal: 20 }).budget();

    assertEquals((await noFailedTools.evaluate(createRecord())).pass, true);
    assertEquals(
      (await noFailedTools.evaluate(createRecord({
        trace: {
          events: [],
          toolCalls: [{ name: "search", status: "error", error: "timeout" }],
        },
      }))).pass,
      false,
    );
    assertEquals((await latency.evaluate(createRecord())).pass, true);
    assertEquals((await tokens.evaluate(createRecord())).pass, true);
  });

  it("evaluates agent tool behavior metrics", async () => {
    const record = createRecord({
      trace: {
        events: [],
        toolCalls: [
          {
            name: "orders_lookup",
            status: "ok",
            input: { orderId: "A1049", includeHistory: true },
            output: { status: "unverified" },
          },
          {
            name: "policy_lookup",
            status: "ok",
            input: { topic: "refunds" },
          },
        ],
      },
    });

    assertEquals(
      await metrics.agent.calledTool("orders_lookup", {
        input: { orderId: "A1049" },
        match: "partial",
      }).gate().evaluate(record),
      {
        name: "agent.calledTool",
        family: "agent",
        severity: "gate",
        score: 1,
        pass: true,
        evidence: {
          tool: "orders_lookup",
          calls: 1,
          expectedInput: { orderId: "A1049" },
          match: "partial",
        },
      },
    );
    assertEquals(
      await metrics.agent.notCalledTool("refunds_issue").gate().evaluate(record),
      {
        name: "agent.notCalledTool",
        family: "agent",
        severity: "gate",
        score: 1,
        pass: true,
        evidence: { tool: "refunds_issue", calls: 0 },
      },
    );
    assertEquals(
      await metrics.agent.toolCallCount("orders_lookup", { exact: 1 }).gate().evaluate(record),
      {
        name: "agent.toolCallCount",
        family: "agent",
        severity: "gate",
        score: 1,
        pass: true,
        evidence: { tool: "orders_lookup", calls: 1, expected: { exact: 1 } },
      },
    );
    assertEquals(
      await metrics.agent.calledTool("orders_lookup", {
        input: { orderId: "A1050" },
        match: "partial",
      }).gate().evaluate(record),
      {
        name: "agent.calledTool",
        family: "agent",
        severity: "gate",
        score: 0,
        pass: false,
        evidence: {
          tool: "orders_lookup",
          calls: 1,
          expectedInput: { orderId: "A1050" },
          match: "partial",
          actualInputs: [{ orderId: "A1049", includeHistory: true }],
        },
      },
    );
  });

  it("supports rubric-style judge metrics through an injected judge", async () => {
    const rubric = metrics.judge.rubric({
      rubric: "Answer must identify the correct city.",
      judge: async ({ output, reference }) => ({
        score: output.text === reference ? 0.95 : 0.1,
        pass: output.text === reference,
        explanation: "The answer names Paris.",
      }),
    }).gate({ min: 0.8 });

    assertEquals(await rubric.evaluate(createRecord()), {
      name: "judge.rubric",
      family: "judge",
      severity: "gate",
      score: 0.95,
      pass: true,
      explanation: "The answer names Paris.",
    });

    const belowThreshold = metrics.judge.rubric({
      rubric: "Answer must identify the correct city.",
      judge: async () => ({ score: 0.7 }),
    }).gate({ min: 0.8 });

    assertEquals((await belowThreshold.evaluate(createRecord())).pass, false);
  });
});
