import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "#std/assert";
import { MemoryTokenStore } from "./memory.ts";
import type { OAuthTokens, StoredOAuthState } from "../types.ts";

function tokens(accessToken: string, extra: Partial<OAuthTokens> = {}): OAuthTokens {
  return { accessToken, ...extra };
}

function oauthState(userId: string, createdAt = Date.now()): StoredOAuthState {
  return {
    userId,
    serviceId: "svc",
    codeVerifier: "v".repeat(64),
    redirectUri: "https://app.test/api/auth/svc/callback",
    scopes: ["read"],
    createdAt,
  };
}

Deno.test("MemoryTokenStore stores and retrieves tokens per (serviceId, userId)", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "alice", tokens("a-token"));
  await store.setTokens("svc", "bob", tokens("b-token"));

  assertEquals((await store.getTokens("svc", "alice"))?.accessToken, "a-token");
  assertEquals((await store.getTokens("svc", "bob"))?.accessToken, "b-token");
  assertEquals(await store.getTokens("svc", "carol"), null);
});

Deno.test("MemoryTokenStore clears a single user's tokens", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "alice", tokens("a-token"));
  await store.clearTokens("svc", "alice");
  assertEquals(await store.getTokens("svc", "alice"), null);
});

Deno.test("MemoryTokenStore isConnected: fresh, expired-without-refresh, expired-with-refresh", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "fresh", tokens("t", { expiresAt: Date.now() + 60_000 }));
  await store.setTokens("svc", "stale", tokens("t", { expiresAt: Date.now() - 1 }));
  await store.setTokens(
    "svc",
    "refreshable",
    tokens("t", { expiresAt: Date.now() - 1, refreshToken: "r" }),
  );

  assertEquals(store.isConnected("svc", "fresh"), true);
  assertEquals(store.isConnected("svc", "stale"), false);
  assertEquals(store.isConnected("svc", "refreshable"), true);
  assertEquals(store.isConnected("svc", "unknown"), false);
});

Deno.test("MemoryTokenStore consumeState is one-shot and rejects unknown", async () => {
  const store = new MemoryTokenStore();
  const meta = oauthState("alice");
  await store.setState("state-1", meta);

  assertEquals((await store.consumeState("state-1"))?.userId, "alice");
  // One-shot: second read returns null.
  assertEquals(await store.consumeState("state-1"), null);
  assertEquals(await store.consumeState("never-set"), null);
});

Deno.test("MemoryTokenStore bounds OAuth states via oldest-entry eviction", async () => {
  const store = new MemoryTokenStore("default", { maxStateEntries: 2 });

  await store.setState("state-1", oauthState("u1"));
  await store.setState("state-2", oauthState("u2"));
  await store.setState("state-3", oauthState("u3"));

  assertEquals(await store.consumeState("state-1"), null);
  assertEquals((await store.consumeState("state-2"))?.userId, "u2");
  assertEquals((await store.consumeState("state-3"))?.userId, "u3");
});

Deno.test("MemoryTokenStore scopes keys by projectId", async () => {
  const a = new MemoryTokenStore("project-a");
  const b = new MemoryTokenStore("project-b");
  await a.setTokens("svc", "alice", tokens("a-token"));
  // A different store instance for a different project never sees it.
  assertEquals(await b.getTokens("svc", "alice"), null);
  assertEquals(a.getConnectedServices(), ["svc:alice"]);
});

Deno.test("MemoryTokenStore bounds the token map via LRU eviction (#1989)", async () => {
  const store = new MemoryTokenStore("default", { maxEntries: 3 });

  for (const user of ["u1", "u2", "u3"]) {
    await store.setTokens("svc", user, tokens(`${user}-token`));
  }
  // Touch u1 so it becomes most-recently-used; u2 is now the LRU slot.
  await store.getTokens("svc", "u1");

  // Inserting a 4th slot evicts the least-recently-used (u2), not u1.
  await store.setTokens("svc", "u4", tokens("u4-token"));

  assertEquals(await store.getTokens("svc", "u2"), null);
  assertEquals((await store.getTokens("svc", "u1"))?.accessToken, "u1-token");
  assertEquals((await store.getTokens("svc", "u4"))?.accessToken, "u4-token");
  // Never exceeds the cap.
  assertEquals(store.getConnectedServices().length, 3);
});

Deno.test("MemoryTokenStore clearAll empties tokens and states", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "alice", tokens("a-token"));
  await store.setState("s", oauthState("alice"));
  store.clearAll();
  assertEquals(await store.getTokens("svc", "alice"), null);
  assertEquals(await store.consumeState("s"), null);
  assertEquals(store.getConnectedServices().length, 0);
});

Deno.test("MemoryTokenStore warns once when persisting tokens in production (#1989)", async () => {
  const prevNodeEnv = Deno.env.get("NODE_ENV");
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    Deno.env.set("NODE_ENV", "production");
    const store = new MemoryTokenStore();
    await store.setTokens("svc", "alice", tokens("a-token"));
    await store.setTokens("svc", "bob", tokens("b-token"));

    const matched = warnings.filter((w) => w.includes("MemoryTokenStore"));
    // Warned exactly once despite two writes.
    assertEquals(matched.length, 1);
  } finally {
    console.warn = originalWarn;
    if (prevNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", prevNodeEnv);
  }
});

Deno.test("MemoryTokenStore encodes tuple keys without delimiter collisions", async () => {
  const store = new MemoryTokenStore("project");
  await store.setTokens("service:a", "user", tokens("first"));
  await store.setTokens("service", "a:user", tokens("second"));

  assertEquals((await store.getTokens("service:a", "user"))?.accessToken, "first");
  assertEquals((await store.getTokens("service", "a:user"))?.accessToken, "second");
  assertEquals(store.getConnectedServices().sort(), ["service%3Aa:user", "service:a%3Auser"]);
});

Deno.test("MemoryTokenStore detaches stored and returned token objects", async () => {
  const store = new MemoryTokenStore();
  const input = tokens("original", { refreshToken: "refresh" });
  await store.setTokens("svc", "alice", input);
  input.accessToken = "mutated-input";

  const firstRead = await store.getTokens("svc", "alice");
  assertEquals(firstRead?.accessToken, "original");
  if (firstRead) firstRead.accessToken = "mutated-output";

  assertEquals((await store.getTokens("svc", "alice"))?.accessToken, "original");
});

Deno.test("MemoryTokenStore conditionally replaces only the observed token revision", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "alice", tokens("original", { refreshToken: "refresh" }));
  const snapshot = await store.getTokenSnapshot("svc", "alice");
  if (!snapshot) throw new Error("expected a token snapshot");

  const replacement = tokens("replacement");
  assertEquals(
    await store.compareAndSetTokens("svc", "alice", snapshot.revision, replacement),
    true,
  );
  replacement.accessToken = "mutated-input";

  assertEquals((await store.getTokens("svc", "alice"))?.accessToken, "replacement");
  assertEquals(
    await store.compareAndSetTokens("svc", "alice", snapshot.revision, tokens("stale")),
    false,
  );
  assertEquals((await store.getTokens("svc", "alice"))?.accessToken, "replacement");
});

Deno.test("MemoryTokenStore revisions prevent ABA after disconnect and reauthorization", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens("svc", "alice", tokens("same-token"));
  const first = await store.getTokenSnapshot("svc", "alice");
  if (!first) throw new Error("expected the first token snapshot");

  await store.clearTokens("svc", "alice");
  await store.setTokens("svc", "alice", tokens("same-token"));
  const second = await store.getTokenSnapshot("svc", "alice");
  if (!second) throw new Error("expected the second token snapshot");

  assertNotEquals(second.revision, first.revision);
  assertEquals(
    await store.compareAndSetTokens("svc", "alice", first.revision, tokens("stale-refresh")),
    false,
  );
  assertEquals((await store.getTokens("svc", "alice"))?.accessToken, "same-token");
});

Deno.test("MemoryTokenStore serializes refresh work per token slot", async () => {
  const store = new MemoryTokenStore();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = store.withTokenRefreshLock("svc", "alice", async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  await Promise.resolve();
  const second = store.withTokenRefreshLock("svc", "alice", async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await Promise.resolve();

  assertEquals(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assertEquals(events, ["first:start", "first:end", "second:start", "second:end"]);
});

Deno.test("MemoryTokenStore releases a refresh lock after operation rejection", async () => {
  const store = new MemoryTokenStore();
  await assertRejects(
    () =>
      store.withTokenRefreshLock("svc", "alice", () => Promise.reject(new Error("refresh failed"))),
    Error,
    "refresh failed",
  );

  assertEquals(
    await store.withTokenRefreshLock("svc", "alice", () => Promise.resolve("recovered")),
    "recovered",
  );
});

Deno.test("MemoryTokenStore permits refresh work for different slots concurrently", async () => {
  const store = new MemoryTokenStore();
  let releaseAlice!: () => void;
  const aliceGate = new Promise<void>((resolve) => {
    releaseAlice = resolve;
  });
  let bobStarted = false;

  const alice = store.withTokenRefreshLock("svc", "alice", () => aliceGate);
  await Promise.resolve();
  const bob = store.withTokenRefreshLock("svc", "bob", () => {
    bobStarted = true;
    return Promise.resolve();
  });
  await bob;
  assertEquals(bobStarted, true);
  releaseAlice();
  await alice;
});

Deno.test("MemoryTokenStore rejects malformed and accessor-backed token rows", async () => {
  const store = new MemoryTokenStore();
  for (
    const malformed of [
      { accessToken: "   " },
      { accessToken: "token", refreshToken: "" },
      { accessToken: "token", expiresAt: Number.NaN },
      { accessToken: "token", expiresAt: Number.POSITIVE_INFINITY },
    ]
  ) {
    await assertRejects(
      () => store.setTokens("svc", "alice", malformed as OAuthTokens),
      TypeError,
      "Invalid OAuth token row",
    );
  }

  let getterCalls = 0;
  const accessorBacked = Object.defineProperty({}, "accessToken", {
    enumerable: true,
    get() {
      getterCalls++;
      return "token";
    },
  });
  await assertRejects(
    () => store.setTokens("svc", "alice", accessorBacked as OAuthTokens),
    TypeError,
    "Invalid OAuth token row",
  );
  assertEquals(getterCalls, 0);
});

Deno.test("MemoryTokenStore rejects token fields that exceed storage bounds", async () => {
  const store = new MemoryTokenStore();
  await assertRejects(
    () => store.setTokens("github", "alice", { accessToken: "x".repeat(65_537) }),
    TypeError,
    "Invalid OAuth token row",
  );
});

Deno.test("MemoryTokenStore detaches state metadata from callers", async () => {
  const store = new MemoryTokenStore();
  const meta: StoredOAuthState = {
    ...oauthState("alice"),
    metadata: { nested: { value: "original" } },
  };
  await store.setState("state", meta);
  meta.userId = "mallory";
  meta.scopes?.push("write");
  (meta.metadata!.nested as { value: string }).value = "mutated";

  const consumed = await store.consumeState("state");
  assertEquals(consumed?.userId, "alice");
  assertEquals(consumed?.scopes, ["read"]);
  assertEquals(consumed?.metadata, { nested: { value: "original" } });
});

Deno.test("MemoryTokenStore rejects duplicate live state values", async () => {
  const store = new MemoryTokenStore();
  await store.setState("duplicate", oauthState("alice"));

  await assertRejects(
    () => store.setState("duplicate", oauthState("bob")),
    Error,
    "already exists",
  );
  assertEquals((await store.consumeState("duplicate"))?.userId, "alice");
});

Deno.test("MemoryTokenStore rejects invalid capacity options", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(
      () => new MemoryTokenStore("project", { maxStateEntries: value }),
      RangeError,
      "maxStateEntries",
    );
  }
  for (const value of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10 * 60_000 + 1]) {
    assertThrows(
      () => new MemoryTokenStore("project", { stateTtlMs: value }),
      RangeError,
      "stateTtlMs",
    );
  }
});

Deno.test("MemoryTokenStore rejects invalid state rows before insertion", async () => {
  const store = new MemoryTokenStore();
  for (
    const [state, value] of [
      ["future", oauthState("alice", Date.now() + 5 * 60_000)],
      ["nan", oauthState("alice", Number.NaN)],
      ["blank-user", { ...oauthState("alice"), userId: " " }],
      ["bad-verifier", { ...oauthState("alice"), codeVerifier: "short" }],
      ["bad-scope", { ...oauthState("alice"), scopes: ["read write"] }],
    ] as const
  ) {
    await assertRejects(
      () => store.setState(state, value as StoredOAuthState),
      TypeError,
      "Invalid OAuth state row",
    );
  }
});

Deno.test("MemoryTokenStore invalid state cannot evict a live transaction", async () => {
  const store = new MemoryTokenStore("default", { maxStateEntries: 1 });
  await store.setState("live", oauthState("alice"));
  await assertRejects(
    () => store.setState("invalid", oauthState("mallory", Number.NaN)),
    TypeError,
  );

  assertEquals((await store.consumeState("live"))?.userId, "alice");
});

Deno.test("MemoryTokenStore rejects non-canonical key identifiers", async () => {
  const store = new MemoryTokenStore();
  for (
    const [serviceId, userId] of [[" svc", "alice"], ["svc", " alice "]] as const
  ) {
    await assertRejects(
      () => store.setTokens(serviceId, userId, tokens("token")),
      RangeError,
      "trimmed",
    );
  }
  assertThrows(() => new MemoryTokenStore(" project "), RangeError, "trimmed");
});
