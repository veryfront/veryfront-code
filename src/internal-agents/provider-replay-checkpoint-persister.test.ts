import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createRunScopedProviderReplayCheckpointPersister } from "./provider-replay-checkpoint-persister.ts";

const RUN_ID = "run_checkpoint_1";
const MESSAGE_ID = "10000000-1000-4000-8000-100000000001";

function checkpoint(): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: MESSAGE_ID,
    provider: "anthropic",
    providerBlocks: [{
      type: "provider-block",
      provider: "anthropic",
      block: { type: "thinking", thinking: "", signature: "<REDACTED>" },
    }],
    providerBlockPositions: [0],
    providerMessageBlockCounts: [1],
    totalPartCount: 1,
  };
}

describe("run-scoped provider replay checkpoint persistence", () => {
  it("keeps persistence pending until the exact-run append is acknowledged", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    let acknowledge: ((response: Response) => void) | undefined;
    const responseGate = new Promise<Response>((resolve) => {
      acknowledge = resolve;
    });
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test/api",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return responseGate;
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    let settled = false;
    const persistence = persist(checkpoint()).then(() => {
      settled = true;
    });
    await Promise.resolve();

    assertEquals(settled, false);
    assertEquals(capturedUrl, `https://api.example.test/api/runs/${RUN_ID}/events`);
    assertEquals(capturedInit?.method, "POST");
    assertEquals(new Headers(capturedInit?.headers).get("Authorization"), "Bearer <TOKEN>");
    const body = JSON.parse(String(capturedInit?.body)) as {
      events: Array<Record<string, unknown>>;
    };
    assertEquals(body.events[0]?.type, "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT");
    assertEquals(body.events[0]?.messageId, MESSAGE_ID);

    acknowledge?.(Response.json({ appended_count: 1 }));
    await persistence;
    assertEquals(settled, true);
  });

  it("fails closed without exposing private response data or the credential", async () => {
    const token = "private-test-token-that-must-not-appear";
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: token,
      fetch: () => Promise.resolve(new Response("private response", { status: 503 })),
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    const error = await assertRejects(
      () => persist(checkpoint()),
      VeryfrontError,
      "status 503",
    );
    assertInstanceOf(error, VeryfrontError);
    assertStringIncludes(error.slug, "durable-run-event-persistence-failed");
    assertEquals(String(error).includes(token), false);
    assertEquals(String(error).includes("private response"), false);
  });

  it("aborts an in-flight append when the run is cancelled", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (input, init) => {
        requestSignal = new Request(input, init).signal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
            once: true,
          });
        });
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");
    const controller = new AbortController();
    const reason = new DOMException("run cancelled", "AbortError");

    const persistence = persist(checkpoint(), controller.signal);
    await Promise.resolve();
    controller.abort(reason);

    let caught: unknown;
    try {
      await persistence;
    } catch (error) {
      caught = error;
    }
    assertEquals(caught, reason);
    assertEquals(requestSignal?.aborted, true);
  });

  it("never resolves an inherited toJSON hook while building the append body", async () => {
    const bodies: string[] = [];
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (_input, init) => {
        bodies.push(String(init?.body));
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    await persist(checkpoint());

    // Project code shares this realm after discovery, so it can reach the
    // prototype chain of every object the checkpoint carries. JSON.stringify
    // looks `toJSON` up dynamically along that chain, which would both hand
    // the private replay state to the hook and let it replace the bytes
    // appended under the run event token.
    const observed: unknown[] = [];
    const poisonedPrototype = {
      toJSON(this: unknown) {
        observed.push(this);
        return { type: "FORGED_BY_PROJECT_CODE" };
      },
    };
    const poisoned = checkpoint();
    Object.setPrototypeOf(poisoned.providerBlocks, poisonedPrototype);
    Object.setPrototypeOf(poisoned.providerBlockPositions, poisonedPrototype);
    Object.setPrototypeOf(poisoned.providerBlocks[0]!, poisonedPrototype);
    Object.setPrototypeOf(poisoned.providerBlocks[0]!.block, poisonedPrototype);
    await persist(poisoned);

    assertEquals(observed.length, 0);
    assertEquals(bodies.length, 2);
    assertEquals(bodies[1], bodies[0]);
    assertEquals(bodies[1]?.includes("FORGED_BY_PROJECT_CODE"), false);
    const body = JSON.parse(String(bodies[1])) as {
      events: Array<Record<string, unknown>>;
    };
    assertEquals(body.events[0]?.type, "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT");
    assertEquals(body.events[0]?.messageId, MESSAGE_ID);
  });

  it("never invokes a getter reachable from the checkpoint while serializing", async () => {
    let getterCalls = 0;
    const poisonedCheckpoint = checkpoint();
    Object.defineProperty(poisonedCheckpoint.providerBlocks[0]!.block, "signature", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return "<LEAKED>";
      },
    });

    let capturedBody: string | undefined;
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (_input, init) => {
        capturedBody = String(init?.body);
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    await persist(poisonedCheckpoint);

    assertEquals(getterCalls, 0);
    assertEquals(String(capturedBody).includes("<LEAKED>"), false);
  });

  it("does not create a writer for a missing or malformed credential", () => {
    for (const runEventAppendToken of [null, " token-with-whitespace "]) {
      assertEquals(
        createRunScopedProviderReplayCheckpointPersister({
          apiUrl: "https://api.example.test",
          runId: RUN_ID,
          runEventAppendToken,
        }),
        undefined,
      );
    }
  });
});
