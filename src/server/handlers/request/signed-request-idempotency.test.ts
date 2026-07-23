import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type SignedRequestExecutionResult,
  SignedRequestIdempotencyStore,
  type SignedRequestIdentity,
} from "./signed-request-idempotency.ts";

function identity(overrides: Partial<SignedRequestIdentity> = {}): SignedRequestIdentity {
  return {
    scope: "test-endpoint",
    audience: "demo-project",
    projectId: "proj-1",
    subject: "request-1",
    fingerprint: "body-hash-1",
    expiresAtMs: 60_000,
    ...overrides,
  };
}

function result(body: string, cache = true): SignedRequestExecutionResult {
  return { response: { status: 200, body }, cache };
}

describe("SignedRequestIdempotencyStore", () => {
  it("coalesces in-flight work and caches the completed response", async () => {
    const store = new SignedRequestIdempotencyStore({ now: () => 0 });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = async () => {
      calls += 1;
      await gate;
      return result('{"ok":true}');
    };

    const first = store.execute(identity(), operation);
    const second = store.execute(identity(), operation);
    release();

    assertEquals(await first, {
      kind: "response",
      response: { status: 200, body: '{"ok":true}' },
      replayed: false,
    });
    assertEquals(await second, {
      kind: "response",
      response: { status: 200, body: '{"ok":true}' },
      replayed: true,
    });
    assertEquals(await store.execute(identity(), operation), {
      kind: "response",
      response: { status: 200, body: '{"ok":true}' },
      replayed: true,
    });
    assertEquals(calls, 1);
  });

  it("rejects the same operation identity with a different body fingerprint", async () => {
    const store = new SignedRequestIdempotencyStore({ now: () => 0 });
    let calls = 0;
    await store.execute(identity(), async () => {
      calls += 1;
      return result("first");
    });

    assertEquals(
      await store.execute(identity({ fingerprint: "body-hash-2" }), async () => {
        calls += 1;
        return result("second");
      }),
      { kind: "conflict" },
    );
    assertEquals(calls, 1);
  });

  it("allows identical retryable failures to run again without allowing body changes", async () => {
    const store = new SignedRequestIdempotencyStore({ now: () => 0 });
    let calls = 0;
    const operation = async () => {
      calls += 1;
      return result(`retry-${calls}`, false);
    };

    assertEquals((await store.execute(identity(), operation)).kind, "response");
    assertEquals((await store.execute(identity(), operation)).kind, "response");
    assertEquals(calls, 2);
    assertEquals(
      await store.execute(identity({ fingerprint: "body-hash-2" }), operation),
      { kind: "conflict" },
    );
  });

  it("releases unexpected failures for an identical retry but preserves fingerprint binding", async () => {
    const store = new SignedRequestIdempotencyStore({ now: () => 0 });
    let calls = 0;
    await assertRejects(
      () =>
        store.execute(identity(), async () => {
          calls += 1;
          throw new Error("execution failed before a response was available");
        }),
      Error,
      "execution failed",
    );

    assertEquals(
      (await store.execute(identity(), async () => {
        calls += 1;
        return result("recovered");
      })).kind,
      "response",
    );
    assertEquals(
      await store.execute(identity({ fingerprint: "body-hash-2" }), async () => {
        calls += 1;
        return result("conflicting");
      }),
      { kind: "conflict" },
    );
    assertEquals(calls, 2);
  });

  it("fails closed at identity capacity and admits work after retention expires", async () => {
    let now = 0;
    const store = new SignedRequestIdempotencyStore({
      maxEntries: 1,
      retentionMs: 10,
      now: () => now,
    });
    await store.execute(identity({ expiresAtMs: 1 }), async () => result("first"));

    assertEquals(
      await store.execute(
        identity({ subject: "request-2", expiresAtMs: 1 }),
        async () => result("second"),
      ),
      { kind: "saturated" },
    );

    now = 11;
    assertEquals(
      (await store.execute(
        identity({ subject: "request-2", expiresAtMs: 12 }),
        async () => result("second"),
      )).kind,
      "response",
    );
  });

  it("keeps replay protection when cached response storage is exhausted", async () => {
    const store = new SignedRequestIdempotencyStore({
      maxCachedResponseBytes: 4,
      now: () => 0,
    });
    let calls = 0;
    await store.execute(identity(), async () => {
      calls += 1;
      return result("response-too-large");
    });

    assertEquals(
      await store.execute(identity(), async () => {
        calls += 1;
        return result("duplicate");
      }),
      { kind: "replay-unavailable" },
    );
    assertEquals(calls, 1);
    assertEquals(store.cachedResponseBytes, 0);
  });
});
