import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { MemoryTokenStore } from "./memory.ts";
import type { OAuthTokens, StoredOAuthState } from "../types.ts";

function tokens(accessToken: string, extra: Partial<OAuthTokens> = {}): OAuthTokens {
  return { accessToken, ...extra };
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

Deno.test("MemoryTokenStore consumeState is one-shot and rejects expired/unknown", async () => {
  const store = new MemoryTokenStore();
  const meta: StoredOAuthState = { userId: "alice", serviceId: "svc", createdAt: Date.now() };
  await store.setState("state-1", meta);

  assertEquals((await store.consumeState("state-1"))?.userId, "alice");
  // One-shot: second read returns null.
  assertEquals(await store.consumeState("state-1"), null);
  assertEquals(await store.consumeState("never-set"), null);

  // Expired state (createdAt older than the 10-minute window) is rejected.
  await store.setState("old", {
    userId: "x",
    serviceId: "svc",
    createdAt: Date.now() - 11 * 60_000,
  });
  assertEquals(await store.consumeState("old"), null);
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
  await store.setState("s", { userId: "alice", serviceId: "svc", createdAt: Date.now() });
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
