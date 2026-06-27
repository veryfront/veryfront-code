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

  it("evaluates operation cost budgets with billed gateway cost when present", async () => {
    const cost = metrics.ops.cost({ maxUsd: 0.05 }).budget();

    assertEquals(
      await cost.evaluate(createRecord({
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          totalTokens: 16,
          costUsd: 0.01,
          providerCostUsd: 0.01,
          veryfrontChargeUsd: 0.01,
          veryfrontBilledUsd: 0.1,
          costSource: "gateway",
        },
      })),
      {
        name: "ops.cost",
        family: "ops",
        severity: "budget",
        score: 0,
        pass: false,
        evidence: {
          costUsd: 0.1,
          maxUsd: 0.05,
          costSource: "gateway",
        },
      },
    );
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

  it("evaluates knowledge retrieval metrics from search_knowledge traces", async () => {
    const record = createRecord({
      trace: {
        events: [],
        toolCalls: [
          {
            name: "search_knowledge",
            status: "ok",
            output: {
              data: [
                {
                  path: "knowledge/login-troubleshooting.md",
                  frontmatter: [{ key: "title", value: "Login troubleshooting" }],
                },
                {
                  path: "knowledge/deployment-incident-triage.md",
                  frontmatter: [{ key: "title", value: "Deployment incident triage" }],
                },
                {
                  path: "knowledge/billing-escalation.md",
                  frontmatter: [{ key: "title", value: "Billing escalation" }],
                },
              ],
            },
          },
        ],
      },
    });

    assertEquals(
      await metrics.knowledge.recallAtK({
        k: 2,
        expected: [
          "knowledge/login-troubleshooting.md",
          "knowledge/billing-escalation.md",
        ],
      }).gate({ min: 0.5 }).evaluate(record),
      {
        name: "knowledge.recallAtK",
        family: "knowledge",
        severity: "gate",
        score: 0.5,
        pass: true,
        evidence: {
          tool: "search_knowledge",
          k: 2,
          retrieved: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
          ],
          expected: [
            "knowledge/login-troubleshooting.md",
            "knowledge/billing-escalation.md",
          ],
          found: ["knowledge/login-troubleshooting.md"],
          foundCount: 1,
          expectedCount: 2,
        },
      },
    );

    assertEquals(
      await metrics.knowledge.precisionAtK({
        k: 2,
        expected: [
          "knowledge/login-troubleshooting.md",
          "knowledge/billing-escalation.md",
        ],
      }).gate({ min: 0.5 }).evaluate(record),
      {
        name: "knowledge.precisionAtK",
        family: "knowledge",
        severity: "gate",
        score: 0.5,
        pass: true,
        evidence: {
          tool: "search_knowledge",
          k: 2,
          retrieved: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
          ],
          expected: [
            "knowledge/login-troubleshooting.md",
            "knowledge/billing-escalation.md",
          ],
          relevant: ["knowledge/login-troubleshooting.md"],
          relevantCount: 1,
          retrievedCount: 2,
        },
      },
    );

    assertEquals(
      await metrics.knowledge.mrr({
        expected: ["knowledge/billing-escalation.md"],
      }).gate({ min: 0.3 }).evaluate(record),
      {
        name: "knowledge.mrr",
        family: "knowledge",
        severity: "gate",
        score: 1 / 3,
        pass: true,
        evidence: {
          tool: "search_knowledge",
          k: 3,
          retrieved: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
            "knowledge/billing-escalation.md",
          ],
          expected: ["knowledge/billing-escalation.md"],
          rank: 3,
          match: "knowledge/billing-escalation.md",
        },
      },
    );
  });

  it("can read expected knowledge sources from record metadata", async () => {
    const record = createRecord({
      metadata: {
        expectedKnowledge: [
          "knowledge/login-troubleshooting.md",
          "knowledge/deployment-incident-triage.md",
        ],
      },
      trace: {
        events: [],
        toolCalls: [
          {
            name: "search_knowledge",
            status: "ok",
            output: {
              data: [
                { path: "knowledge/login-troubleshooting.md" },
                { path: "knowledge/deployment-incident-triage.md" },
              ],
            },
          },
        ],
      },
    });

    assertEquals(
      await metrics.knowledge.recallAtK({ k: 2 }).gate().evaluate(record),
      {
        name: "knowledge.recallAtK",
        family: "knowledge",
        severity: "gate",
        score: 1,
        pass: true,
        evidence: {
          tool: "search_knowledge",
          k: 2,
          retrieved: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
          ],
          expected: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
          ],
          expectedFrom: "metadata.expectedKnowledge",
          found: [
            "knowledge/login-troubleshooting.md",
            "knowledge/deployment-incident-triage.md",
          ],
          foundCount: 2,
          expectedCount: 2,
        },
      },
    );
  });

  it("evaluates answer groundedness with retrieved knowledge evidence", async () => {
    const groundedness = metrics.answer.groundedness({
      judge: async ({ evidence, output }) => ({
        score: evidence.some((entry) => entry.includes("identity provider metadata")) &&
            String(output.text).includes("SSO metadata")
          ? 0.9
          : 0.2,
        explanation: "Answer is supported by the retrieved SSO runbook.",
      }),
    }).gate({ min: 0.8 });

    assertEquals(
      await groundedness.evaluate(createRecord({
        output: { text: "Ask whether SSO metadata or group mapping changed recently." },
        trace: {
          events: [],
          toolCalls: [
            {
              name: "search_knowledge",
              status: "ok",
              output: {
                data: [
                  {
                    path: "knowledge/login-troubleshooting.md",
                    content:
                      "If SSO changed recently, ask whether the identity provider metadata, callback URL, or user group mapping changed.",
                  },
                ],
              },
            },
          ],
        },
      })),
      {
        name: "answer.groundedness",
        family: "answer",
        severity: "gate",
        score: 0.9,
        pass: true,
        explanation: "Answer is supported by the retrieved SSO runbook.",
        evidence: {
          tool: "search_knowledge",
          evidenceCount: 1,
          sources: ["knowledge/login-troubleshooting.md"],
        },
      },
    );
  });

  it("uses compact search_knowledge results as groundedness evidence", async () => {
    const groundedness = metrics.answer.groundedness({
      judge: async ({ evidence, output, sources }) => {
        const joinedEvidence = evidence.join("\n");
        const pass = joinedEvidence.includes("identity provider metadata") &&
          joinedEvidence.includes("callback URL") &&
          String(output.text).includes("SSO metadata") &&
          sources.includes("knowledge/login-troubleshooting.md");

        return {
          score: pass ? 0.95 : 0.1,
          pass,
          explanation: "Compact knowledge result contains enough support for the answer.",
        };
      },
    }).gate({ min: 0.8 });

    assertEquals(
      await groundedness.evaluate(createRecord({
        output: { text: "Ask whether the SSO metadata or callback URL changed recently." },
        trace: {
          events: [],
          toolCalls: [
            {
              name: "search_knowledge",
              status: "ok",
              output: {
                data: [
                  {
                    path: "knowledge/login-troubleshooting.md",
                    matched_fields: [
                      "identity provider metadata",
                      "callback URL",
                    ],
                    frontmatter: {
                      title: "Login troubleshooting",
                      summary: "Check SSO metadata, callback URL, and group mapping changes.",
                    },
                  },
                ],
              },
            },
          ],
        },
      })),
      {
        name: "answer.groundedness",
        family: "answer",
        severity: "gate",
        score: 0.95,
        pass: true,
        explanation: "Compact knowledge result contains enough support for the answer.",
        evidence: {
          tool: "search_knowledge",
          evidenceCount: 2,
          sources: ["knowledge/login-troubleshooting.md"],
        },
      },
    );
  });
});
