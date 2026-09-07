import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineAgentService } from "#veryfront/agent/service/definition.ts";

const allowedOrigin = "https://studio.example.test";
const deniedOrigin = "https://untrusted.example.test";

describe("agent service native response init", () => {
  it("propagates host errors and rejects malformed headers without a success fallback", async () => {
    const failure = new Error("synthetic host failure");
    const runtime = defineAgentService({
      serviceName: "failures",
      agents: {},
      defaultAgentId: "test",
      server: { cors: true },
    }).createRuntime({
      routes: [{
        path: "/fail",
        method: "GET",
        handler: () => {
          throw failure;
        },
      }, {
        path: "/invalid-status",
        method: "GET",
        handler: () => ({ body: null, headers: {}, status: 99, statusText: "" } as Response),
      }, {
        path: "/invalid-status-text",
        method: "GET",
        handler:
          () => ({ body: null, headers: {}, status: 200, statusText: "invalid\ntext" } as Response),
      }],
    });
    await assertRejects(
      () =>
        runtime.request("/fail").catch((error: unknown) => {
          assertStrictEquals(error, failure);
          throw error;
        }),
      Error,
      "synthetic host failure",
    );
    assertThrows(
      () => runtime.request("/fail", { headers: { "invalid\nname": "value" } }),
      TypeError,
    );
    await assertRejects(() => runtime.request("/invalid-status"), RangeError);
    let nativeStatusTextError: unknown;
    let nativeStatusText: string | undefined;
    try {
      nativeStatusText = new Response(null, { statusText: "invalid\ntext" }).statusText;
    } catch (error) {
      nativeStatusTextError = error;
    }
    // Bun currently accepts this status text; retain each runtime's native
    // validation outcome rather than adding a silent framework normalization.
    if (nativeStatusTextError) {
      await assertRejects(() => runtime.request("/invalid-status-text"), TypeError);
    } else {
      assertEquals((await runtime.request("/invalid-status-text")).statusText, nativeStatusText);
    }
  });

  it("does not inherit response headers or status text from Object.prototype", async () => {
    const hostResponse = new Response("synthetic-response-canary", {
      headers: { "X-Host": "keep" },
    });
    const ordinary = defineAgentService({
      serviceName: "plain",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime();
    const cors = defineAgentService({
      serviceName: "cors",
      agents: {},
      defaultAgentId: "test",
      server: { cors: { origins: [allowedOrigin], credentials: true } },
    }).createRuntime({
      routes: [{ path: "/custom", method: "GET", handler: () => hostResponse }],
    });
    const requests = ["/liveness", "/readiness", "/missing", "/custom"].map((path) =>
      new Request(`https://agent.example.test${path}`, { headers: { Origin: deniedOrigin } })
    );
    const preflight = new Request("https://agent.example.test/custom", {
      method: "OPTIONS",
      headers: { Origin: deniedOrigin, "Access-Control-Request-Method": "GET" },
    });
    const responses: Response[] = [];
    const headersDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "headers");
    const statusDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "statusText");
    Object.defineProperties(Object.prototype, {
      headers: {
        configurable: true,
        writable: true,
        value: {
          "Access-Control-Allow-Origin": deniedOrigin,
          "Access-Control-Allow-Credentials": "true",
        },
      },
      statusText: { configurable: true, writable: true, value: "Injected" },
    });
    try {
      responses.push(await ordinary.fetch(requests[0]!));
      for (const request of requests) responses.push(await cors.fetch(request));
      responses.push(await cors.fetch(preflight));
      cors.setShuttingDown();
      responses.push(await cors.fetch(requests[1]!));
    } finally {
      if (headersDescriptor) Object.defineProperty(Object.prototype, "headers", headersDescriptor);
      else Reflect.deleteProperty(Object.prototype, "headers");
      if (statusDescriptor) Object.defineProperty(Object.prototype, "statusText", statusDescriptor);
      else Reflect.deleteProperty(Object.prototype, "statusText");
    }

    assertEquals(responses.map((response) => response.status), [200, 200, 200, 404, 200, 204, 503]);
    assertEquals(await responses[4]!.text(), "synthetic-response-canary");
    assertEquals(responses[4]!.headers.get("X-Host"), "keep");
    for (const response of responses) {
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(response.headers.get("Access-Control-Allow-Credentials"), null);
      assertEquals(response.statusText, "");
      if (!response.bodyUsed) await response.body?.cancel();
    }
  });
});
