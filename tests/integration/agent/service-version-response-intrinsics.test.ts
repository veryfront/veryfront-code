import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";

Deno.test("agent service version route ignores inherited response status and JSON hooks", async () => {
  const artifact = "20261007183045-a1b2c3d4e5f6";
  const originalStatus = Object.getOwnPropertyDescriptor(Object.prototype, "status");
  const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const originalJsonStringify = JSON.stringify;
  const originalResponse = globalThis.Response;
  Object.defineProperty(Object.prototype, "status", {
    value: 503,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(Object.prototype, "toJSON", {
    value() {
      return { artifact: "spoofed-by-inherited-to-json" };
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  JSON.stringify = (() => '{"artifact":"spoofed-by-replaced-stringify"}') as typeof JSON.stringify;
  globalThis.Response = (function ReplacedResponse() {
    throw new Error("replaced Response constructor reached");
  }) as unknown as typeof Response;
  try {
    const vulnerableResponse = originalResponse.json(
      { artifact },
      { headers: { "Cache-Control": "no-store" } },
    );
    assertEquals(vulnerableResponse.status, 503);
    assertEquals(await vulnerableResponse.json(), { artifact: "spoofed-by-inherited-to-json" });

    const routeSet = createHostedAgentServiceRouteSet<{ ok: true }>({
      tracker: createDetachedRunTracker(),
      deploymentArtifact: artifact,
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
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), { artifact });
  } finally {
    globalThis.Response = originalResponse;
    JSON.stringify = originalJsonStringify;
    if (originalToJson) {
      Object.defineProperty(Object.prototype, "toJSON", originalToJson);
    } else {
      Reflect.deleteProperty(Object.prototype, "toJSON");
    }
    if (originalStatus) {
      Object.defineProperty(Object.prototype, "status", originalStatus);
    } else {
      Reflect.deleteProperty(Object.prototype, "status");
    }
  }
});
