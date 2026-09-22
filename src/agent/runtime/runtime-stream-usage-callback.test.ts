import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { AgentRuntime } from "./index.ts";
import type { RuntimeUsageTraceInput } from "./trace-usage.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

/**
 * Wiring coverage for veryfront/veryfront-issue-inbox#1500.
 *
 * A run that dies mid-stream never delivers a final response, so callers that
 * report spend cannot wait for `onFinish`. The streaming loop therefore hands
 * the running total to `onUsage` after every model call. This pins two things:
 * the callback fires per model call, and each delivery carries the run's
 * cumulative total rather than that step's delta.
 *
 * This is NOT coverage for "the final response carries multi-turn usage" — the
 * loop already returns its accumulated `totalUsage`, so such an assertion would
 * pass with the forwarding removed and would prove nothing.
 */

const echoTool = tool({
  id: "usage_probe_tool",
  description: "Succeeds without side effects",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ ok: true }),
});

describe("agent runtime stream usage forwarding (#1500)", () => {
  it("reports the cumulative run usage to onUsage after every model call", async () => {
    const model = scriptedModel([
      {
        parts: [
          {
            type: "tool-call",
            toolCallId: "usage-probe-1",
            toolName: "usage_probe_tool",
            input: {},
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              costCredits: 2,
            },
          },
        ],
      },
      {
        parts: [
          { type: "text-delta", text: "done" },
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 20,
              outputTokens: 5,
              totalTokens: 25,
              costCredits: 3,
            },
          },
        ],
      },
    ]);

    const runtime = new AgentRuntime(
      "usage-forwarding-runtime",
      {
        model: "veryfront-cloud/openai/usage-forwarding-model",
        system: "usage forwarding test",
        tools: { usage_probe_tool: echoTool },
        maxSteps: 3,
      },
      { resolveModelRuntime: () => model },
    );

    const seen: RuntimeUsageTraceInput[] = [];
    const stream = await runtime.stream(
      [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      undefined,
      {
        // The received reference is pushed unchanged: copying here would re-snapshot
        // the value and make the snapshot assertion below unfalsifiable.
        onUsage: (usage) => {
          seen.push(usage);
        },
      },
    );
    await Array.fromAsync(stream);

    assertEquals(model.callCount, 2);
    assertEquals(seen.length, 2);
    assertEquals(seen[0]?.costCredits, 2);
    assertEquals(seen[0]?.totalTokens, 15);
    // Cumulative, not the second step's delta of 3.
    assertEquals(seen[1]?.costCredits, 5);
    assertEquals(seen[1]?.totalTokens, 40);
    // Each delivery is a snapshot: the caller kept the object it was handed, so this
    // fails if the loop forwards its live running total instead of a copy.
    assertEquals(seen[0]?.costCredits, 2);
    assertEquals(seen[0]?.totalTokens, 15);
    assertEquals(seen[0] === seen[1], false);
  });
});
