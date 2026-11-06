import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "./factory.ts";
import type { ToolApprovalDecision, ToolApprovalRequest } from "./approval.ts";
import { createInputRequestApprovalGate } from "./approval-input-request-gate.ts";

/** What the gate sends: a plain body string and header record. */
type SentInit = { body?: string; method?: string; headers?: Record<string, string> };

function transferTool(executed: unknown[]) {
  return tool({
    id: "transfer",
    description: "Move money",
    approval: { stepUpSeconds: 300 },
    inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
    execute: (input) => {
      executed.push(input);
      return { ok: true };
    },
  });
}

describe("tool approval", () => {
  it("fails closed when the host has no approval channel", async () => {
    const executed: unknown[] = [];
    await assertRejects(
      () => transferTool(executed).execute({ amount: 5 }, {}),
      Error,
      "requires approval",
    );
    assertEquals(executed, []);
  });

  it("runs only after a checker approves the exact arguments", async () => {
    const executed: unknown[] = [];
    const asked: ToolApprovalRequest[] = [];
    const result = await transferTool(executed).execute({ amount: 25000 }, {
      toolCallId: "call-1",
      requestToolApproval: (request) => {
        asked.push(request);
        return Promise.resolve({ approved: true, outcome: "approved" });
      },
    });
    assertEquals(result, { ok: true });
    assertEquals(executed, [{ amount: 25000 }]);
    assertEquals(asked, [{
      toolName: "transfer",
      toolCallId: "call-1",
      input: { amount: 25000 },
      policy: { stepUpSeconds: 300 },
    }]);
  });

  it("returns the refusal and never runs a denied call", async () => {
    const executed: unknown[] = [];
    const result = await transferTool(executed).execute({ amount: 25000 }, {
      requestToolApproval: () =>
        Promise.resolve<ToolApprovalDecision>({
          approved: false,
          outcome: "denied",
          checker: { type: "user", id: "carol" },
          comment: "Invoice not verified",
        }),
    });
    assertEquals(executed, []);
    assertEquals((result as unknown as { status: string }).status, "not_approved");
    assertEquals((result as unknown as { comment: string }).comment, "Invoice not verified");
  });

  it("tells the model why the call did not run, in words it can relay", async () => {
    const message = async (decision: ToolApprovalDecision) => {
      const result = await transferTool([]).execute({ amount: 1 }, {
        requestToolApproval: () => Promise.resolve(decision),
      });
      return (result as unknown as { message: string }).message;
    };
    assertEquals(
      await message({ approved: false, outcome: "denied", comment: "Invoice not verified" }),
      'The approver denied the transfer call: "Invoice not verified". It did not run.',
    );
    assertEquals(
      await message({ approved: false, outcome: "denied" }),
      "The approver denied the transfer call. It did not run.",
    );
    assertEquals(
      await message({ approved: false, outcome: "expired" }),
      "Nobody approved the transfer call in time. It did not run.",
    );
    assertEquals(
      await message({ approved: false, outcome: "withdrawn" }),
      "The transfer call was withdrawn before approval. It did not run.",
    );
  });

  it("treats an inconsistent decision as a denial", async () => {
    const executed: unknown[] = [];
    await transferTool(executed).execute({ amount: 1 }, {
      requestToolApproval: () => Promise.resolve({ approved: true, outcome: "expired" }),
    });
    assertEquals(executed, []);
  });

  it("rejects an approval policy it does not understand", () => {
    assertThrows(
      () =>
        tool({
          id: "bad",
          description: "Bad",
          approval: { stepUp: 300 } as never,
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
      Error,
      "unknown key",
    );
  });
});

describe("createInputRequestApprovalGate", () => {
  it("asks for a decision form someone other than the run's starter answers, and maps it", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const responses = [
      { input_request_id: "ir-1", status: "open" },
      { input_request_id: "ir-1", status: "open" },
      {
        input_request_id: "ir-1",
        status: "submitted",
        response: {
          values: { decision: "deny", comment: " no " },
          actor: { type: "user", id: "carol" },
        },
      },
    ];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test/",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (input, init) => {
        calls.push({
          url: String(input),
          body: (init as SentInit)?.body ? JSON.parse(String((init as SentInit).body)) : undefined,
        });
        return Promise.resolve(new Response(JSON.stringify(responses.shift())));
      },
    });
    const decision = await gate({
      toolName: "transfer",
      toolCallId: "call-1",
      input: { amount: 9 },
      policy: {},
    });
    assertEquals(decision, {
      approved: false,
      outcome: "denied",
      approvalId: "ir-1",
      checker: { type: "user", id: "carol" },
      comment: "no",
    });
    assertEquals(calls[0]!.url, "http://api.test/runs/run-1/input-requests");
    const { expires_at, fields, ...body } = calls[0]!.body as Record<string, unknown>;
    assertEquals(body, {
      title: "Approve transfer",
      requested_responder_type: "human",
      tool_call_id: "call-1",
      responder_rules: {
        exclude_run_starters: true,
        required_capability: "project.approvals.decide",
      },
      tool_call: { name: "transfer", arguments: { amount: 9 } },
      delivery: "none",
    });
    assertEquals((fields as Array<{ name: string }>).map((field) => field.name), [
      "decision",
      "comment",
    ]);
    const expiresIn = Date.parse(String(expires_at)) - Date.now();
    assertEquals(expiresIn > 29 * 60_000 && expiresIn <= 30 * 60_000, true);
    assertEquals(calls.slice(1).map((call) => call.url), [
      "http://api.test/input-requests/ir-1",
      "http://api.test/input-requests/ir-1",
    ]);
  });

  it("withdraws the pending approval with an idempotency key when the run is cancelled", async () => {
    const calls: Array<{ url: string; method?: string; headers: Record<string, string> }> = [];
    const controller = new AbortController();
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (input, init) => {
        calls.push({
          url: String(input),
          method: (init as SentInit)?.method,
          headers: (init as SentInit).headers ?? {},
        });
        if (calls.length === 2) controller.abort(new Error("run cancelled"));
        return Promise.resolve(
          new Response(JSON.stringify({ input_request_id: "ir-1", status: "open" })),
        );
      },
    });
    await assertRejects(
      () => gate({ toolName: "transfer", input: { amount: 9 }, policy: {} }, controller.signal),
      Error,
      "run cancelled",
    );
    const cancel = calls.at(-1)!;
    assertEquals([cancel.url, cancel.method], [
      "http://api.test/input-requests/ir-1/cancel",
      "POST",
    ]);
    assertEquals(typeof cancel.headers["Idempotency-Key"], "string");
  });
});
