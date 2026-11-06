import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInputRequestApprovalGate } from "#veryfront/tool/approval-input-request-gate.ts";
import { snapshotToolApprovalPolicy } from "#veryfront/tool/approval.ts";

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

  it("freezes a policy even when project code replaces Object.freeze", () => {
    const freeze = Object.freeze;
    Object.freeze = (<T>(value: T) => value) as typeof Object.freeze;
    let policy: { stepUpSeconds?: number } | undefined;
    try {
      policy = snapshotToolApprovalPolicy({ stepUpSeconds: 300 }, "transfer");
    } finally {
      Object.freeze = freeze;
    }
    assertEquals(Object.isFrozen(policy), true);
  });

  it("never adopts a longer-lived request or a colliding id when project code replaces Date and String methods", async () => {
    const sent: Array<{ tool_call_id: string }> = [];
    const replies = [
      new Response(JSON.stringify({ input_request_id: "ir-0", status: "expired" })),
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
    const parse = Date.parse;
    const startsWith = String.prototype.startsWith;
    Date.parse = () => 0;
    String.prototype.startsWith = () => false;
    try {
      await gate({ toolName: "transfer", toolCallId: "approval-native", input: {}, policy: {} });
      const decision = await gate({
        toolName: "transfer",
        toolCallId: "call-1",
        input: { amount: 1 },
        policy: { expiresInSeconds: 60 },
      }).catch((error: unknown) => error);
      Date.parse = parse;
      String.prototype.startsWith = startsWith;
      assertEquals(sent[0]!.tool_call_id === "approval-native", false);
      assertEquals((decision as { approved?: boolean }).approved === true, false);
    } finally {
      Date.parse = parse;
      String.prototype.startsWith = startsWith;
    }
  });
  it("asks with the real expiry and request timeout when project code replaces Date, AbortSignal and timers", async () => {
    const sent: Array<{ expires_at: string }> = [];
    let timedOut = false;
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      requestTimeoutMs: 5,
      fetch: (_input, init) => {
        sent.push(JSON.parse(String((init as SentInit).body)));
        // The first answer never arrives; asked again, the request has expired.
        if (timedOut) {
          return Promise.resolve(
            new Response(JSON.stringify({ input_request_id: "ir-1", status: "expired" })),
          );
        }
        const signal = (init as { signal: AbortSignal }).signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            timedOut = true;
            reject(signal.reason);
          });
        });
      },
    });
    const toISOString = Date.prototype.toISOString;
    const timeout = AbortSignal.timeout;
    const setTimer = globalThis.setTimeout;
    Date.prototype.toISOString = () => "2999-01-01T00:00:00.000Z";
    AbortSignal.timeout = () => new AbortController().signal;
    globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
    try {
      await gate({ toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} })
        .catch(() => undefined);
    } finally {
      Date.prototype.toISOString = toISOString;
      AbortSignal.timeout = timeout;
      globalThis.setTimeout = setTimer;
    }
    assertEquals(sent[0]!.expires_at === "2999-01-01T00:00:00.000Z", false);
    assertEquals(timedOut, true);
  });
  it("polls the request it opened even when project code replaces encodeURIComponent", async () => {
    const polled: string[] = [];
    const gate = createInputRequestApprovalGate({
      apiUrl: "http://api.test",
      authToken: "maker-token",
      runId: "run-1",
      pollIntervalMs: 1,
      fetch: (input, init) => {
        if ((init as SentInit).method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ input_request_id: "ir-1", status: "open" })),
          );
        }
        polled.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ input_request_id: "ir-1", status: "expired" })),
        );
      },
    });
    const encode = globalThis.encodeURIComponent;
    globalThis.encodeURIComponent = () => "ir-approved-elsewhere";
    try {
      await gate({ toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} });
    } finally {
      globalThis.encodeURIComponent = encode;
    }
    assertEquals(polled, ["http://api.test/input-requests/ir-1"]);
  });
});
