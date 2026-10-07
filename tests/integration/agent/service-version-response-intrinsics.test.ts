import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
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

Deno.test("agent service version route fails closed for inherited response option accessors", () => {
  const fields = ["headers", "status", "statusText"] as const;
  const originals = fields.map((field) =>
    [
      field,
      Object.getOwnPropertyDescriptor(Object.prototype, field),
    ] as const
  );
  let accessorCalls = 0;
  for (const field of fields) {
    Object.defineProperty(Object.prototype, field, {
      get() {
        accessorCalls += 1;
        return undefined;
      },
      set() {
        accessorCalls += 1;
      },
      configurable: true,
    });
  }
  try {
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

    assertThrows(
      () => versionRoute.handler(new Request("https://agent.example.test/version"), {}),
      TypeError,
      "Cannot construct a response with inherited option accessors",
    );
    assertEquals(accessorCalls, 0);
  } finally {
    for (const [field, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(Object.prototype, field, descriptor);
      } else {
        Reflect.deleteProperty(Object.prototype, field);
      }
    }
  }
});

Deno.test("agent service version route ignores inherited header iterators", async () => {
  const artifact = "20261007183045-a1b2c3d4e5f6";
  const originalObjectIterator = Object.getOwnPropertyDescriptor(Object.prototype, Symbol.iterator);
  const originalHeadersIterator = Object.getOwnPropertyDescriptor(
    Headers.prototype,
    Symbol.iterator,
  );
  let iteratorCalls = 0;
  const poisonedIterator = function* () {
    iteratorCalls += 1;
    yield ["Cache-Control", "max-age=999"];
  };
  Object.defineProperty(Object.prototype, Symbol.iterator, {
    value: poisonedIterator,
    configurable: true,
  });
  Object.defineProperty(Headers.prototype, Symbol.iterator, {
    value: poisonedIterator,
    configurable: true,
  });
  try {
    const vulnerableResponse = new Response(
      JSON.stringify({ artifact }),
      {
        status: 200,
        statusText: "",
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        },
      },
    );
    assertEquals(vulnerableResponse.headers.get("Cache-Control"), "max-age=999");
    assertEquals(vulnerableResponse.headers.get("Content-Type"), "text/plain;charset=UTF-8");

    const vulnerableHeaders = new Headers();
    vulnerableHeaders.set("Cache-Control", "no-store");
    vulnerableHeaders.set("Content-Type", "application/json");
    const vulnerableHeadersResponse = new Response(
      JSON.stringify({ artifact }),
      {
        status: 200,
        statusText: "",
        headers: vulnerableHeaders,
      },
    );
    assertEquals(vulnerableHeadersResponse.headers.get("Cache-Control"), "max-age=999");
    assertEquals(vulnerableHeadersResponse.headers.get("Content-Type"), "text/plain;charset=UTF-8");

    iteratorCalls = 0;
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
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), { artifact });
    assertEquals(iteratorCalls, 0);
  } finally {
    if (originalHeadersIterator) {
      Object.defineProperty(Headers.prototype, Symbol.iterator, originalHeadersIterator);
    } else {
      Reflect.deleteProperty(Headers.prototype, Symbol.iterator);
    }
    if (originalObjectIterator) {
      Object.defineProperty(Object.prototype, Symbol.iterator, originalObjectIterator);
    } else {
      Reflect.deleteProperty(Object.prototype, Symbol.iterator);
    }
  }
});
