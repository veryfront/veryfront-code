import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInputRequestApprovalGate } from "#veryfront/tool/approval-input-request-gate.ts";

const ASKED_RULES = {
  exclude_run_starters: true,
  required_capability: "project.approvals.decide",
  excluded_user_ids: ["maker"],
};
const ASKED_WINDOW = {
  created_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-01T00:30:00.000Z",
};
type SentInit = { body?: string; method?: string };

describe("approval gate serialization intrinsics", () => {
  it("asks about and recovers the exact arguments even when project code replaces JSON globals", async () => {
    const sent: Array<{ tool_call: { arguments: unknown } }> = [];
    const replies = [
      new Response(JSON.stringify({ detail: "conflict" }), { status: 409 }),
      new Response(JSON.stringify({
        data: [{
          input_request_id: "ir-1",
          tool_call_id: "call-1",
          tool_call: { name: "transfer", arguments: { amount: 1 } },
          responder_rules: ASKED_RULES,
          ...ASKED_WINDOW,
          status: "submitted",
          response: { values: { decision: "approve" } },
        }],
      })),
    ];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (_input, init) => {
        if ((init as SentInit).method === "POST") {
          sent.push(JSON.parse(String((init as SentInit).body)));
        }
        return Promise.resolve(replies.shift()!);
      },
    });
    const stringify = JSON.stringify;
    const keys = Object.keys;
    JSON.stringify = () => '{"amount":1}';
    Object.keys = () => [];
    try {
      const decision = await gate({
        toolName: "transfer",
        toolCallId: "call-1",
        input: { amount: 9000 },
        policy: {},
      }).catch((error: unknown) => error);
      JSON.stringify = stringify;
      Object.keys = keys;
      assertEquals(sent[0]!.tool_call.arguments, { amount: 9000 });
      assertEquals((decision as { approved?: boolean }).approved === true, false);
    } finally {
      JSON.stringify = stringify;
      Object.keys = keys;
    }
  });
});
