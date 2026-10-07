import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";

Deno.test("agent service version route ignores inherited response status", async () => {
  const originalStatus = Object.getOwnPropertyDescriptor(Object.prototype, "status");
  Object.defineProperty(Object.prototype, "status", {
    value: 503,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  try {
    const vulnerableResponse = Response.json(
      { artifact: "20261007183045-a1b2c3d4e5f6" },
      { headers: { "Cache-Control": "no-store" } },
    );
    assertEquals(vulnerableResponse.status, 503);

    const routeSet = createHostedAgentServiceRouteSet<{ ok: true }>({
      tracker: createDetachedRunTracker(),
      deploymentArtifact: "20261007183045-a1b2c3d4e5f6",
      authenticateRequest: async () => ({ authToken: "token", userId: "user-1" }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunCancellationToken: async () => true,
      verifyRunEventAppendToken: async () => false,
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
      resolveRuntimeOwnerInvokeUrl: async () => null,
    });
    const versionRoute = routeSet.routes.find((route) => route.path === "/version");
    assertExists(versionRoute);

    const response = await versionRoute.handler(
      new Request("https://agent.example.test/version"),
      {},
    );

    assertEquals(response.status, 200);
    assertEquals(response.statusText, "");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(await response.json(), { artifact: "20261007183045-a1b2c3d4e5f6" });
  } finally {
    if (originalStatus) {
      Object.defineProperty(Object.prototype, "status", originalStatus);
    } else {
      Reflect.deleteProperty(Object.prototype, "status");
    }
  }
});
