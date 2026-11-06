import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "./factory.ts";
import type { ToolApprovalDecision, ToolApprovalRequest } from "./approval.ts";
import { createInputRequestApprovalGate } from "./approval-input-request-gate.ts";
import { createToolsFromHostDefinitions } from "./host-tools.ts";
import { traceHostTools } from "./tracing.ts";

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
    // The model sees the outcome and the note, never who decided.
    assertEquals(result, {
      status: "not_approved",
      outcome: "denied",
      tool: "transfer",
      comment: "Invoice not verified",
      message: 'The approver denied the transfer call: "Invoice not verified". It did not run.',
    });
  });

  it("runs the arguments the checker approved, even if the caller changes its object meanwhile", async () => {
    const executed: unknown[] = [];
    const input = { amount: 10 };
    const rawSchemaTool = tool({
      id: "transfer",
      description: "Move money",
      approval: {},
      inputSchema: {
        type: "object",
        properties: { amount: { type: "number" } },
        required: ["amount"],
      },
      execute: (args) => {
        executed.push(args);
        return { ok: true };
      },
    });
    await rawSchemaTool.execute(input, {
      requestToolApproval: (request) => {
        input.amount = 99_999;
        assertEquals(request.input, { amount: 10 });
        return Promise.resolve({ approved: true, outcome: "approved" });
      },
    });
    assertEquals(executed, [{ amount: 10 }]);
  });

  it("asks under the id discovery registered an id-less tool with", async () => {
    const asked: string[] = [];
    const inferred = tool({
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      execute: () => ({ ok: true }),
    });
    const registered = { ...inferred, id: "transfer-funds" };
    await registered.execute({ amount: 1 }, {
      requestToolApproval: (request) => {
        asked.push(request.toolName);
        return Promise.resolve({ approved: true, outcome: "approved" });
      },
    });
    assertEquals(asked, ["transfer-funds"]);
  });

  it("asks under the name a host materialized an id-less tool with", async () => {
    const asked: string[] = [];
    const inferred = tool({
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      execute: () => ({ ok: true }),
    });
    const { transfer } = createToolsFromHostDefinitions({ transfer: inferred });
    await transfer!.execute({ amount: 1 }, {
      requestToolApproval: (request) => {
        asked.push(request.toolName);
        return Promise.resolve({ approved: true, outcome: "approved" });
      },
    });
    assertEquals(asked, ["transfer"]);
  });

  it("asks under the exposed name when the host traces the tool first", async () => {
    const asked: string[] = [];
    const inferred = tool({
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      execute: () => ({ ok: true }),
    });
    const traced = traceHostTools({ transfer: inferred }, { trace: (_name, run) => run() });
    const { transfer } = createToolsFromHostDefinitions(traced);
    await transfer!.execute({ amount: 1 }, {
      requestToolApproval: (request) => {
        asked.push(request.toolName);
        return Promise.resolve({ approved: true, outcome: "approved" });
      },
    });
    assertEquals(asked, ["transfer"]);
  });

  it("lets a refusal through the tool's own output validator", async () => {
    const gated = tool({
      id: "transfer",
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      outputSchema: defineSchema((v) => v.object({ ok: v.boolean() }))(),
      execute: () => ({ ok: true }),
    });
    const refusal = await gated.execute({ amount: 1 }, {
      requestToolApproval: () => Promise.resolve({ approved: false, outcome: "denied" }),
    });
    assertEquals(gated.outputSchema!.safeParse(refusal), { success: true, data: refusal });
    assertEquals(gated.outputSchema!.safeParse({ ok: true }).success, true);
    assertEquals(gated.outputSchema!.safeParse({ ok: "yes" }).success, false);
  });

  it("widens a raw JSON output contract instead of wrapping it in a native validator", () => {
    const contract = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };
    const gated = tool({
      id: "transfer",
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      outputSchema: contract as never,
      execute: () => ({ ok: true }),
    });
    assertEquals(typeof (gated.outputSchema as { safeParse?: unknown }).safeParse, "undefined");
    assertEquals(gated.outputSchema as unknown, gated.outputSchemaJson);
    assertEquals((gated.outputSchemaJson as { anyOf?: unknown[] }).anyOf?.[0], contract);
  });

  it("declares a refusal as a valid output, keeping an object contract an object", () => {
    const gated = tool({
      id: "transfer",
      description: "Move money",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      outputSchema: defineSchema((v) => v.object({ ok: v.boolean() }))(),
      execute: () => ({ ok: true }),
    });
    const declared = gated.outputSchemaJson as { type?: string; anyOf?: Array<{ type?: string }> };
    assertEquals(declared.type, "object");
    assertEquals(declared.anyOf?.length, 2);
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
    const refusal = await transferTool(executed).execute({ amount: 1 }, {
      requestToolApproval: () => Promise.resolve({ approved: false, outcome: "approved" }),
    }) as unknown as { outcome: string; message: string };
    assertEquals([refusal.outcome, refusal.message], [
      "denied",
      "The approver denied the transfer call. It did not run.",
    ]);
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

  it("keys the request by run and tool call, so a retry replays the committed one", async () => {
    const keys: string[] = [];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (_input, init) => {
        keys.push((init as SentInit).headers?.["Idempotency-Key"] ?? "");
        return Promise.resolve(
          new Response(JSON.stringify({ input_request_id: "ir-1", status: "expired" })),
        );
      },
    });
    const ask = () => gate({ toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} });
    await ask();
    await ask();
    assertEquals(keys.length, 2);
    assertEquals(keys[0], keys[1]);
  });

  it("waits on the request an earlier attempt opened for the same call", async () => {
    const urls: string[] = [];
    const replies = [
      new Response(JSON.stringify({ detail: "Idempotency key reused" }), { status: 422 }),
      new Response(JSON.stringify({
        data: [{
          input_request_id: "ir-1",
          tool_call_id: "call-1",
          tool_call: { name: "transfer", arguments: { to: "acme", amount: 9 } },
          status: "open",
        }],
      })),
      new Response(JSON.stringify({
        input_request_id: "ir-1",
        status: "submitted",
        response: { values: { decision: "approve" } },
      })),
    ];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (input) => {
        urls.push(String(input));
        return Promise.resolve(replies.shift()!);
      },
    });
    const decision = await gate({
      toolName: "transfer",
      toolCallId: "call-1",
      input: { amount: 9, to: "acme" },
      policy: {},
    });
    assertEquals(decision.outcome, "approved");
    assertEquals(urls, [
      "http://api.test/runs/run-1/input-requests",
      "http://api.test/runs/run-1/input-requests?limit=100",
      "http://api.test/input-requests/ir-1",
    ]);
  });

  it("returns the decision of an earlier request that was answered before the retry", async () => {
    const urls: string[] = [];
    const replies = [
      new Response(JSON.stringify({ detail: "conflict" }), { status: 409 }),
      new Response(JSON.stringify({
        data: [],
        page_info: { next: "page 2" },
      })),
      new Response(JSON.stringify({
        data: [{
          input_request_id: "ir-1",
          tool_call_id: "call-1",
          tool_call: { name: "transfer", arguments: { amount: 9 } },
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
      fetch: (input) => {
        urls.push(String(input));
        return Promise.resolve(replies.shift()!);
      },
    });
    const decision = await gate({
      toolName: "transfer",
      toolCallId: "call-1",
      input: { amount: 9 },
      policy: {},
    });
    assertEquals(decision.outcome, "approved");
    assertEquals(
      urls.at(-1),
      "http://api.test/runs/run-1/input-requests?limit=100&cursor=page%202",
    );
  });

  it("keeps polling through transient failures", async () => {
    const replies: Array<() => Promise<Response>> = [
      () =>
        Promise.resolve(new Response(JSON.stringify({ input_request_id: "ir-1", status: "open" }))),
      () => Promise.resolve(new Response("{}", { status: 503 })),
      () => Promise.reject(new TypeError("connection reset")),
      () =>
        Promise.resolve(
          new Response(JSON.stringify({
            input_request_id: "ir-1",
            status: "submitted",
            response: { values: { decision: "approve" } },
          })),
        ),
    ];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: () => replies.shift()!(),
    });
    const decision = await gate({ toolName: "transfer", input: {}, policy: {} });
    assertEquals(decision.outcome, "approved");
  });

  it("stops waiting as expired when polls time out past the request's expiry", async () => {
    let created = false;
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      requestTimeoutMs: 5,
      fetch: (_input, init) => {
        if (!created) {
          created = true;
          return Promise.resolve(
            new Response(JSON.stringify({
              input_request_id: "ir-1",
              status: "open",
              expires_at: new Date(Date.now() - 120_000).toISOString(),
            })),
          );
        }
        // A server that accepts the connection and never answers.
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
        );
      },
    });
    const decision = await gate({ toolName: "transfer", input: {}, policy: {} });
    assertEquals(decision, { approved: false, outcome: "expired", approvalId: "ir-1" });
  });

  it("never adopts an earlier request that asked about other arguments", async () => {
    const replies = [
      new Response(JSON.stringify({ detail: "conflict" }), { status: 409 }),
      new Response(JSON.stringify({
        data: [{
          input_request_id: "ir-1",
          tool_call_id: "call-1",
          tool_call: { name: "transfer", arguments: { amount: 1 } },
          status: "open",
        }],
      })),
    ];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: () => Promise.resolve(replies.shift()!),
    });
    await assertRejects(
      () => gate({ toolName: "transfer", toolCallId: "call-1", input: { amount: 9 }, policy: {} }),
      Error,
      "HTTP 409",
    );
  });

  it("rejects a polling interval or timeout that would not wait", () => {
    for (const ms of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const name of ["pollIntervalMs", "requestTimeoutMs"] as const) {
        assertThrows(
          () =>
            createInputRequestApprovalGate({
              apiUrl: "http://api.test",
              authToken: "maker-token",
              runId: "run-1",
              [name]: ms,
            }),
          Error,
          name,
        );
      }
    }
  });
});
