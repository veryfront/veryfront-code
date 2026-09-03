// This security boundary test intentionally mutates shared-realm prototypes,
// so it belongs in the semantic integration suite rather than a unit module.
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { createRunScopedProviderReplayCheckpointPersister } from "#veryfront/internal-agents/provider-replay-checkpoint-persister.ts";

const RUN_ID = "run_checkpoint_1";
const MESSAGE_ID = "10000000-1000-4000-8000-100000000001";
const testApply = Reflect.apply;

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

describe("run-scoped provider replay checkpoint intrinsic boundary", () => {
  it("keeps credential validation on captured intrinsics after project poisoning", async () => {
    const token = "writer-token-that-must-stay-private";
    const nativeTrim = String.prototype.trim;
    const nativeStringValueOf = String.prototype.valueOf;
    const nativeEncode = TextEncoder.prototype.encode;
    let observedTokenCalls = 0;

    try {
      String.prototype.trim = function () {
        const value = testApply(nativeStringValueOf, this, []) as string;
        if (value === token) observedTokenCalls++;
        return testApply(nativeTrim, this, []) as string;
      };
      TextEncoder.prototype.encode = (function (this: TextEncoder, value = "") {
        if (value === token) observedTokenCalls++;
        return testApply(nativeEncode, this, [value]) as Uint8Array;
      }) as typeof TextEncoder.prototype.encode;

      const persist = createRunScopedProviderReplayCheckpointPersister({
        apiUrl: "https://api.example.test",
        runId: RUN_ID,
        runEventAppendToken: token,
        fetch: () => Promise.resolve(Response.json({ appended_count: 1 })),
      });
      if (!persist) throw new Error("Expected a checkpoint persister");
      await persist(checkpoint());
    } finally {
      String.prototype.trim = nativeTrim;
      TextEncoder.prototype.encode = nativeEncode;
    }

    assertEquals(observedTokenCalls, 0);
  });

  it("never resolves an inherited descriptor accessor while reading own properties", async () => {
    const bodies: string[] = [];
    // Built before the shared prototype is poisoned so nothing inside the
    // poisoned window has to construct a Response.
    const acknowledged = Promise.resolve(new Response(null, { status: 200 }));
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (_input, init) => {
        bodies.push(String(init?.body));
        return acknowledged;
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    await persist(checkpoint());

    // `Object.getOwnPropertyDescriptor` returns an ordinary object whose
    // prototype project code shares, and a data descriptor owns no `get` or
    // `set` field. Reading those fields would therefore run this hook with the
    // descriptor as `this`, handing it the private provider block and a chance
    // to rewrite the value that lands in the privileged append.
    const observed: unknown[] = [];
    const inheritedAccessor: PropertyDescriptor = {
      configurable: true,
      get(this: Record<string, unknown>) {
        observed.push(this.value);
        this.value = "FORGED_BY_PROJECT_CODE";
        return undefined;
      },
    };
    let persistence: Promise<void> | undefined;
    Object.defineProperty(Object.prototype, "get", inheritedAccessor);
    Object.defineProperty(Object.prototype, "set", inheritedAccessor);
    try {
      // The append body is built synchronously, before the first `await`, so
      // the poisoned window stays inside this call.
      persistence = persist(checkpoint());
    } finally {
      delete (Object.prototype as { get?: unknown }).get;
      delete (Object.prototype as { set?: unknown }).set;
    }
    await persistence;

    assertEquals(observed.length, 0);
    assertEquals(bodies.length, 2);
    assertEquals(bodies[1], bodies[0]);
    assertEquals(bodies[1]?.includes("FORGED_BY_PROJECT_CODE"), false);
  });

  it("never iterates reflected keys through a shared Array prototype hook", async () => {
    const bodies: string[] = [];
    const acknowledged = Promise.resolve(new Response(null, { status: 200 }));
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: RUN_ID,
      runEventAppendToken: "<TOKEN>",
      fetch: (_input, init) => {
        bodies.push(String(init?.body));
        return acknowledged;
      },
    });
    if (!persist) throw new Error("Expected a checkpoint persister");

    await persist(checkpoint());

    // `Reflect.ownKeys` returns an ordinary array, so walking it with `for...of`
    // would resolve `Symbol.iterator` through the prototype project code shares.
    // This hook sees every private field name and yields nothing, which would
    // silently strip the checkpoint out of the privileged append.
    const observed: unknown[] = [];
    const nativeArrayIterator = Array.prototype[Symbol.iterator];
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function poisonedIterator(this: unknown[]) {
        observed.push(this);
        return nativeArrayIterator.call([]);
      },
    });
    let persistence: Promise<void> | undefined;
    try {
      persistence = persist(checkpoint());
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: nativeArrayIterator,
      });
    }
    await persistence;

    assertEquals(observed.length, 0);
    assertEquals(bodies.length, 2);
    assertEquals(bodies[1], bodies[0]);
    assertEquals(String(bodies[1]).includes(MESSAGE_ID), true);
  });
});
