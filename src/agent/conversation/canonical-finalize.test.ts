import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { finalizeConversationAgentRun } from "./durable.ts";

const canonical = "11111111-1111-4111-8111-111111111111";
const token = `header.${
  btoa(
    JSON.stringify({
      runId: "run-original",
      canonicalRunId: canonical,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation-one",
    }),
  )
}.signature`;
const base = {
  authToken: "run-invocation",
  apiUrl: "https://api.example.test",
  conversationId: "conversation",
  runId: "run-original",
  status: "completed" as const,
  provider: "provider",
  model: "model",
};

describe("canonical runtime finalization", () => {
  it("routes by the existing terminal capability while forwarding it unchanged", async () => {
    const calls: Request[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request);
      return Promise.resolve(Response.json({ id: canonical, status: "completed" }));
    };
    await finalizeConversationAgentRun({
      ...base,
      terminalAuthToken: token,
      output: { result: "done" },
      fetch,
    });
    assertEquals(calls[0].url, `https://api.example.test/runs/${canonical}/finalize`);
    assertEquals(calls[0].headers.get("X-Veryfront-Run-Terminal-Token"), token);
    assertEquals(calls[0].headers.get("Authorization"), "Bearer run-invocation");
    assertEquals(calls[0].headers.has("Idempotency-Key"), true);
    assertEquals(await calls[0].json(), { status: "completed", output: { result: "done" } });
  });
  it("fails closed without the exact run's terminal capability", async () => {
    const fetch = () => {
      throw new Error("must not send");
    };
    await assertRejects(
      () => finalizeConversationAgentRun({ ...base, fetch }),
      Error,
      "terminal authority",
    );
    await assertRejects(
      () =>
        finalizeConversationAgentRun({
          ...base,
          runId: "other-run",
          terminalAuthToken: token,
          fetch,
        }),
      Error,
      "terminal authority",
    );
  });
});

import {
  bindHostedTerminalRun,
  hostedTerminalRunFinalizer,
  registerHostedTerminalCredential,
} from "../hosted/terminal-credential.ts";
import type { ParsedHostedChatRequest } from "../hosted/chat-request-parser.ts";

it("retains terminal authority privately across the trusted root descriptor only", async () => {
  const request = {
    projectId: "project",
    durableRootRun: { runId: base.runId },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, token);
  const run = { runId: base.runId };
  let calls = 0;
  bindHostedTerminalRun(request, run, {
    apiUrl: base.apiUrl,
    fetch: (_input, init) => {
      calls++;
      assertEquals(new Headers(init?.headers).get("X-Veryfront-Run-Terminal-Token"), token);
      return Promise.resolve(Response.json({ id: canonical, status: "completed" }));
    },
  });
  assertEquals(JSON.stringify(run), JSON.stringify({ runId: base.runId }));
  assertEquals(hostedTerminalRunFinalizer({ runId: base.runId }), undefined);
  const finalize = hostedTerminalRunFinalizer(run)!;
  await finalize({
    ...base,
    apiUrl: "https://attacker.example",
    fetch: () => {
      throw new Error("must not use caller transport");
    },
  });
  assertEquals(calls, 1);
  await assertRejects(
    async () => await finalize({ ...base, runId: "foreign" }),
    Error,
    "terminal authority",
  );
});
