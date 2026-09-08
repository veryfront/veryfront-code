import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineAgentService } from "#veryfront/agent/service/definition.ts";

describe("agent service credential header boundary", () => {
  it("never passes header credentials through replaceable native callback dispatch", async () => {
    const canary = "synthetic-inference-canary";
    const headers = new Headers({ "X-Veryfront-Inference-Token": canary });
    const response = new Response(null);
    let handled = false;
    const runtime = defineAgentService({
      serviceName: "header-boundary",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          handled = true;
          return response;
        },
      }],
    });
    const original = Function.prototype.call;
    const apply = Reflect.apply;
    let observations = 0;
    let failure: unknown;
    Function.prototype.call = new Proxy(original, {
      apply(target, receiver, args) {
        if (args[1] === canary) observations++;
        return apply(target, receiver, args);
      },
    });
    try {
      await runtime.request("/check", { headers });
    } catch (error) {
      failure = error;
    } finally {
      Function.prototype.call = original;
    }
    assertEquals(observations, 0);
    // A compromised native operation may reject, but may never dispatch an
    // unauthenticated or incomplete substitute request to the host handler.
    if (failure) {
      assertEquals(failure instanceof TypeError, true);
      assertEquals(handled, false);
    } else {
      assertEquals(handled, true);
    }
  });

  it("rejects replaced native header iterators before exposing values", async () => {
    const canary = "synthetic-iterator-canary";
    const headers = new Headers({ "X-Veryfront-Inference-Token": canary });
    const response = new Response(null);
    let handled = false;
    const runtime = defineAgentService({
      serviceName: "iterator-boundary",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          handled = true;
          return response;
        },
      }],
    });
    const prototype = Object.getPrototypeOf(headers.entries());
    const original = Object.getOwnPropertyDescriptor(prototype, "next")!;
    const apply = Reflect.apply;
    let observations = 0;
    let failure: unknown;
    Object.defineProperty(prototype, "next", {
      ...original,
      value: function (this: unknown) {
        const result = apply(original.value, this, []);
        if (result.value?.[1] === canary) observations++;
        return result;
      },
    });
    try {
      await runtime.request("/check", { headers });
    } catch (error) {
      failure = error;
    } finally {
      Object.defineProperty(prototype, "next", original);
    }
    assertEquals(observations, 0);
    if (failure) {
      assertEquals(failure instanceof TypeError, true);
      assertEquals(handled, false);
    } else {
      assertEquals(handled, true);
    }
  });

  it("does not invoke accessors on the checked native callback and iterator protocol", async () => {
    const headers = new Headers({ "X-Veryfront-Inference-Token": "synthetic-accessor-canary" });
    const response = new Response(null);
    let handled = 0;
    const runtime = defineAgentService({
      serviceName: "native-accessors",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          handled++;
          return response;
        },
      }],
    });
    const iteratorPrototype = Object.getPrototypeOf(headers.entries());
    const targets: [object, PropertyKey][] = [
      [Function.prototype, "call"],
      [Headers.prototype, Symbol.iterator],
      [iteratorPrototype, "next"],
      [iteratorPrototype, Symbol.iterator],
      [Object.getPrototypeOf(iteratorPrototype), Symbol.iterator],
    ];
    for (const [target, property] of targets) {
      const original = Object.getOwnPropertyDescriptor(target, property);
      const before = handled;
      let reads = 0;
      let failure: unknown;
      Object.defineProperty(target, property, {
        configurable: true,
        get() {
          reads++;
          return original?.value;
        },
      });
      try {
        await runtime.request("/check", { headers });
      } catch (error) {
        failure = error;
      } finally {
        if (original) Object.defineProperty(target, property, original);
        else Reflect.deleteProperty(target, property);
      }
      if (isNode) {
        assertEquals(reads, 0);
        assertEquals(failure instanceof TypeError, true);
        assertEquals(handled, before);
      }
    }
  });

  it("rechecks native processing after framework option and header getters", async () => {
    const canary = "synthetic-option-canary";
    const headers = new Headers({ "X-Veryfront-Inference-Token": canary });
    const response = new Response(null);
    let handled = 0;
    const runtime = defineAgentService({
      serviceName: "reentrant-options",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          handled++;
          return response;
        },
      }],
    });
    const original = Function.prototype.call;
    const apply = Reflect.apply;
    let observations = 0;
    const replace = () => {
      Function.prototype.call = new Proxy(original, {
        apply(target, receiver, args) {
          if (args[1] === canary) observations++;
          return apply(target, receiver, args);
        },
      });
    };
    for (
      const init of [
        {
          get headers() {
            replace();
            return headers;
          },
        },
        {
          headers: {
            get "X-Veryfront-Inference-Token"() {
              replace();
              return canary;
            },
          },
        },
      ]
    ) {
      const before = handled;
      let failure: unknown;
      try {
        await runtime.request("/check", init);
      } catch (error) {
        failure = error;
      } finally {
        Function.prototype.call = original;
      }
      assertEquals(observations, 0);
      if (isNode) {
        assertEquals(failure instanceof TypeError, true);
        assertEquals(
          (failure as Error).message,
          "Cannot process headers with modified native callback dispatch",
        );
        assertEquals(handled, before);
      } else {
        assertEquals(failure, undefined);
        assertEquals(handled, before + 1);
      }
    }
  });

  it("does not enumerate an existing request merely to supply defaults", async () => {
    const canary = "synthetic-original-request-canary";
    const input = new Request("http://localhost/check", {
      headers: { "X-Veryfront-Inference-Token": canary },
    });
    const response = new Response(null);
    const runtime = defineAgentService({
      serviceName: "original-request",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({ routes: [{ method: "GET", path: "/check", handler: () => response }] });
    const prototype = Object.getPrototypeOf(new Headers().entries());
    const original = Object.getOwnPropertyDescriptor(prototype, "next")!;
    const apply = Reflect.apply;
    let observations = 0;
    let failure: unknown;
    Object.defineProperty(prototype, "next", {
      ...original,
      value: function (this: unknown) {
        const result = apply(original.value, this, []);
        if (result.value?.[1] === canary) observations++;
        return result;
      },
    });
    try {
      // The no-init path can forward the original native request unchanged.
      assertStrictEquals(await runtime.request(input), response);
      await runtime.request(input, {});
    } catch (error) {
      failure = error;
    } finally {
      Object.defineProperty(prototype, "next", original);
    }
    assertEquals(observations, 0);
    if (failure) assertEquals(failure instanceof TypeError, true);
  });

  it("preserves native method, headers, body, content type, and body transfer", async () => {
    let sourceStateAtDispatch: unknown;
    const runtime = defineAgentService({
      serviceName: "request-compatibility",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/check",
        handler: async (request) => {
          sourceStateAtDispatch = { used: input.bodyUsed, locked: input.body?.locked };
          return Response.json({
            method: request.method,
            header: request.headers.get("X-Host"),
            contentType: request.headers.get("Content-Type"),
            keepalive: request.keepalive ?? null,
            mode: request.mode ?? null,
            body: await request.text(),
          });
        },
      }],
    });
    const createInput = () =>
      new Request("http://localhost/check", {
        method: "POST",
        headers: { "X-Host": "synthetic-header" },
        body: "synthetic-body",
        keepalive: true,
        mode: "no-cors",
      });
    const expectedSource = createInput();
    const expected = new Request(expectedSource, {});
    const expectedSourceState = {
      used: expectedSource.bodyUsed,
      locked: expectedSource.body?.locked,
    };
    const input = createInput();
    const response = await runtime.request(input, {});
    assertEquals(await response.json(), {
      method: expected.method,
      header: expected.headers.get("X-Host"),
      contentType: expected.headers.get("Content-Type"),
      keepalive: expected.keepalive ?? null,
      mode: expected.mode ?? null,
      body: await expected.text(),
    });
    assertEquals(sourceStateAtDispatch, expectedSourceState);
  });

  it("propagates host error identity and rejects invalid request input", async () => {
    const failure = new Error("synthetic host failure");
    const runtime = defineAgentService({
      serviceName: "request-errors",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/check",
        handler: () => {
          throw failure;
        },
      }],
    });
    await assertRejects(
      async () => {
        try {
          await runtime.request("/check");
        } catch (error) {
          assertStrictEquals(error, failure);
          throw error;
        }
      },
      Error,
      "synthetic host failure",
    );
    const invalidBody = { method: "GET", body: "invalid" };
    let nativeBodyError: unknown;
    try {
      new Request("http://localhost/missing", invalidBody);
    } catch (error) {
      nativeBodyError = error;
    }
    if (nativeBodyError) {
      assertThrows(() => runtime.request("/missing", invalidBody), TypeError);
    } else {
      // Retain the runtime's native acceptance policy (Bun accepts GET bodies).
      await (await runtime.request("/missing", invalidBody)).body?.cancel();
    }
    assertThrows(
      () => runtime.request("/check", { headers: { "invalid\nname": "value" } }),
      TypeError,
    );
  });
});
