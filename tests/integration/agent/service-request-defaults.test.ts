import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { defineAgentService } from "#veryfront/agent/service/definition.ts";

const inheritedDefaultsError = "Cannot construct a request with inherited option defaults";

function restoreDescriptor(property: PropertyKey, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(Object.prototype, property, descriptor);
  else Reflect.deleteProperty(Object.prototype, property);
}

describe("agent service RequestInit defaults", () => {
  it("rejects Node's inherited defaults without invoking hostile accessors", async () => {
    const runtime = defineAgentService({
      serviceName: "request-init-defaults",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => new Response("clean"),
      }],
    });

    for (const field of ["method", "body", "headers"] as const) {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, field);
      let reads = 0;
      let writes = 0;
      let failure: unknown;
      let response: Response | undefined;
      Object.defineProperty(Object.prototype, field, {
        configurable: true,
        get() {
          reads++;
          if (field === "method") return "POST";
          if (field === "body") return "inherited body";
          return { "X-Inherited": "yes" };
        },
        set() {
          writes++;
        },
      });
      try {
        response = await runtime.request("/check", Object.create(null) as RequestInit);
      } catch (error) {
        failure = error;
      } finally {
        restoreDescriptor(field, original);
      }

      assertEquals(reads, 0, `${field} getter must not run`);
      assertEquals(writes, 0, `${field} setter must not run`);
      if (isNode) {
        assertEquals(failure instanceof TypeError, true, `${field} must fail explicitly`);
        assertEquals((failure as Error).message, inheritedDefaultsError);
        assertEquals(response, undefined);
      } else {
        assertEquals(failure, undefined);
        assertEquals(response?.status, 200);
        assertEquals(await response?.text(), "clean");
      }
    }
  });

  it("rejects writable ambient defaults and defaults installed by an option getter", async () => {
    const cleanResponse = new Response("clean");
    let handled = 0;
    const runtime = defineAgentService({
      serviceName: "ambient-defaults",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          handled++;
          return cleanResponse;
        },
      }],
    });
    const originals = ["method", "body", "headers"].map((field) =>
      Object.getOwnPropertyDescriptor(Object.prototype, field)
    );
    const pollute = () =>
      Object.defineProperties(Object.prototype, {
        method: { configurable: true, writable: true, value: "POST" },
        body: { configurable: true, writable: true, value: "synthetic-inherited-body" },
        headers: { configurable: true, writable: true, value: { "X-Inherited": "injected" } },
      });
    for (const reentrant of [false, true]) {
      const before = handled;
      let failure: unknown;
      if (!reentrant) pollute();
      try {
        await runtime.request(
          "/check",
          reentrant
            ? {
              get method() {
                pollute();
                return "GET";
              },
            }
            : undefined,
        );
      } catch (error) {
        failure = error;
      } finally {
        ["method", "body", "headers"].forEach((field, index) =>
          restoreDescriptor(field, originals[index])
        );
      }
      if (isNode) {
        assertEquals(failure instanceof TypeError, true);
        assertEquals((failure as Error).message, inheritedDefaultsError);
        assertEquals(handled, before);
      } else {
        assertEquals(failure, undefined);
        assertEquals(handled, before + 1);
      }
    }
  });

  it("preserves clean RequestInit values inherited from a custom prototype", async () => {
    const runtime = defineAgentService({
      serviceName: "request-init-custom-prototype",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/check",
        handler: async (request) =>
          Response.json({
            method: request.method,
            body: await request.text(),
            header: request.headers.get("X-Test"),
          }),
      }],
    });
    const init = Object.create({
      method: "POST",
      body: "clean body",
      headers: { "X-Test": "clean header" },
    }) as RequestInit;

    const response = await runtime.request("/check", init);

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      method: "POST",
      body: "clean body",
      header: "clean header",
    });
  });
});
