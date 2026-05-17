import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRequestAuthCache } from "./request-auth-cache.ts";

describe("agent/request-auth-cache", () => {
  it("caches successful auth results by Request identity", async () => {
    let calls = 0;
    const request = new Request("https://agent.test/api/ag-ui");
    const cache = createRequestAuthCache({
      authenticate: () => {
        calls += 1;
        return { authToken: "token-1", userId: "user-1" };
      },
    });

    const first = await cache.authenticate(request);
    const second = await cache.authenticate(request);

    assertStrictEquals(first, second);
    assertEquals(calls, 1);
    assertEquals(first, { authToken: "token-1", userId: "user-1" });
  });

  it("does not cache Response failures by default", async () => {
    let calls = 0;
    const request = new Request("https://agent.test/api/ag-ui");
    const cache = createRequestAuthCache({
      authenticate: () => {
        calls += 1;
        return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 });
      },
    });

    const first = await cache.authenticate(request);
    const second = await cache.authenticate(request);

    assertEquals(first instanceof Response ? first.status : 0, 401);
    assertEquals(second instanceof Response ? second.status : 0, 401);
    assertEquals(calls, 2);
  });

  it("caches only results accepted by the host predicate", async () => {
    let calls = 0;
    const request = new Request("https://agent.test/api/ag-ui");
    const cache = createRequestAuthCache({
      authenticate: () => {
        calls += 1;
        return { authToken: `token-${calls}`, userId: "user-1" };
      },
      shouldCache: (result) => !(result instanceof Response) && result.authToken === "token-2",
    });

    const first = await cache.authenticate(request);
    const second = await cache.authenticate(request);
    const third = await cache.authenticate(request);

    assertEquals(first, { authToken: "token-1", userId: "user-1" });
    assertStrictEquals(second, third);
    assertEquals(second, { authToken: "token-2", userId: "user-1" });
    assertEquals(calls, 2);
  });
});
