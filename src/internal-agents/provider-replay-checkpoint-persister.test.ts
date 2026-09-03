import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProviderReplayCheckpointEvent,
  parseProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";
import {
  MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH,
  MAX_PROVIDER_REPLAY_RAW_METADATA_NODES,
} from "#veryfront/agent/runtime/provider-replay-limits.ts";
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

/** Build a chain of `levels` nested objects, deepest last. */
function nestedChain(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = {};
  for (let index = 0; index < levels; index += 1) node = { nested: node };
  return node;
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

  it("persists every nesting depth the parse-back layer accepts", async () => {
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    // The persister must not be stricter than the snapshot validator behind
    // `parseProviderReplayCheckpointEvent`: a checkpoint that loads back
    // successfully has to survive its own next append, or continuation breaks.
    let deepestAccepted = -1;
    let shallowestRejected = -1;
    for (
      let levels = MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH - 10;
      levels <= MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH + 2;
      levels += 1
    ) {
      const nested = checkpoint();
      nested.providerBlocks[0]!.block = {
        type: "thinking",
        thinking: "",
        signature: "<REDACTED>",
        metadata: nestedChain(levels),
      };
      try {
        parseProviderReplayCheckpointEvent(createProviderReplayCheckpointEvent(nested));
      } catch {
        if (shallowestRejected < 0) shallowestRejected = levels;
        continue;
      }
      // Must not throw: the parse-back layer just accepted this checkpoint.
      await persist(nested);
      deepestAccepted = levels;
    }

    // The scanned range has to straddle the boundary the validator enforces,
    // so the deepest persisted checkpoint above sits exactly on it.
    assertEquals(shallowestRejected, deepestAccepted + 1);
  });

  it("reproduces the omissions JSON.stringify makes from own data properties alone", async () => {
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

    const sparse = [1, 2, 3];
    delete sparse[1];
    const block: Record<string, unknown> = {
      type: "thinking",
      nothing: null,
      dropped: undefined,
      callable: () => "unreachable",
      symbolValue: Symbol("value"),
      entries: [1, undefined, 3],
      holes: sparse,
    };
    Object.defineProperty(block, "notEnumerable", {
      configurable: true,
      enumerable: false,
      value: "hidden",
      writable: true,
    });
    Object.defineProperty(block, Symbol("private-field"), {
      configurable: true,
      enumerable: true,
      value: "symbol-keyed",
      writable: true,
    });
    const source = checkpoint();
    source.providerBlocks[0]!.block = block;

    await persist(source);

    // Rebuilding the body out of detached containers has to stay byte-identical
    // to what `JSON.stringify` would have produced for the same event.
    assertEquals(
      capturedBody,
      JSON.stringify({ events: [createProviderReplayCheckpointEvent(source)] }),
    );
  });

  it("fails closed on values and shapes the append body cannot represent", async () => {
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    const withBigint = checkpoint();
    withBigint.providerBlocks[0]!.block = { type: "thinking", counter: 1n };
    await assertRejects(() => persist(withBigint), VeryfrontError, "non-serializable value");

    const tooDeep = checkpoint();
    tooDeep.providerBlocks[0]!.block = {
      type: "thinking",
      metadata: nestedChain(MAX_PROVIDER_REPLAY_RAW_METADATA_DEPTH + 2),
    };
    await assertRejects(() => persist(tooDeep), VeryfrontError, "serializable depth bound");

    const tooManyNodes = checkpoint();
    const nodes: Record<string, unknown>[] = [];
    for (let index = 0; index <= MAX_PROVIDER_REPLAY_RAW_METADATA_NODES; index += 1) {
      nodes.push({});
    }
    tooManyNodes.providerBlocks[0]!.block = { type: "thinking", metadata: nodes };
    await assertRejects(() => persist(tooManyNodes), VeryfrontError, "serializable node bound");
  });

  it("keeps a throwing member of the checkpoint inside the opaque error boundary", async () => {
    let requests = 0;
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: () => {
        requests += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    // Copying the checkpoint reflects over its members, so a Proxy trap
    // supplied by project code runs during serialization and can throw a value
    // it controls. That value must not reach run error handling.
    const hostile = checkpoint();
    hostile.providerBlocks[0]!.block = {
      type: "thinking",
      metadata: new Proxy({}, {
        ownKeys() {
          throw new Error("PROXY_TRAP_LEAK signature=<REDACTED>");
        },
      }),
    };

    const error = await assertRejects(
      () => persist(hostile),
      VeryfrontError,
      "checkpoint is not serializable",
    );
    assertEquals(String(error).includes("PROXY_TRAP_LEAK"), false);
    assertEquals(requests, 0);
  });

  it("rejects a cancelled run before the append is prepared", async () => {
    let requests = 0;
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: () => {
        requests += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    const reason = new DOMException("run cancelled", "AbortError");
    let caught: unknown;
    try {
      await persist(checkpoint(), AbortSignal.abort(reason));
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, reason);
    assertEquals(requests, 0);
  });

  it("times out a stalled append without leaking the transport error", async () => {
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      timeoutMs: 1,
      fetch: (input, init) => {
        const signal = new Request(input, init).signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    await assertRejects(() => persist(checkpoint()), VeryfrontError, "persistence timed out");
  });

  it("reports an opaque failure when the transport itself throws", async () => {
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: () => Promise.reject(new TypeError("connect ECONNREFUSED 10.0.0.1:443")),
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    const error = await assertRejects(
      () => persist(checkpoint()),
      VeryfrontError,
      "checkpoint append failed",
    );
    assertEquals(String(error).includes("10.0.0.1"), false);
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
