import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineAgentService } from "#veryfront/agent/service/definition.ts";

const NativeRequest = Request;
const NativeURL = URL;
const ReflectApply = Reflect.apply;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
const HeadersGet = Headers.prototype.get;
const TEST_ORIGIN = "https://studio.example.test";

type InstallProbe = (requests: Request[], leaks: string[]) => () => void;

function hasCredentials(value: unknown): boolean {
  try {
    const headers = ReflectApply(RequestHeadersGet, value, []);
    return hasCredentialHeaders(headers);
  } catch {
    return false;
  }
}

function hasCredentialHeaders(value: unknown): boolean {
  return ReflectApply(HeadersGet, value, ["X-Veryfront-Run-Event-Token"]) === "test-event-token" &&
    ReflectApply(HeadersGet, value, ["X-Veryfront-Inference-Token"]) === "test-inference-token";
}

async function exerciseDispatch(install: InstallProbe): Promise<void> {
  const dispatched: Request[] = [];
  const runtime = defineAgentService({
    serviceName: "request-boundary-test",
    agents: {},
    defaultAgentId: "test",
    server: { cors: { origins: [TEST_ORIGIN], credentials: true } },
  }).createRuntime({
    routes: [{
      method: "POST",
      path: "/custom/:id",
      handler(request, params) {
        dispatched.push(request);
        return Response.json(params);
      },
    }],
  });
  const cases: Array<{ path: string; method: string; status: number; origin?: string }> = [
    { path: "/readiness", method: "GET", status: 200 },
    { path: "/liveness", method: "GET", status: 200 },
    { path: "/custom/item%20one?ignored=yes", method: "POST", status: 200 },
    { path: "/missing", method: "GET", status: 404 },
    { path: "/custom/item", method: "GET", status: 404 },
    { path: "/custom/item", method: "OPTIONS", status: 204 },
    { path: "/missing", method: "GET", status: 404, origin: "https://untrusted.example.test" },
  ];
  const requests = cases.map(({ path, method, origin = TEST_ORIGIN }) =>
    new NativeRequest(`https://agent.example.test${path}`, {
      method,
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
        "X-Veryfront-Run-Event-Token": "test-event-token",
        "X-Veryfront-Inference-Token": "test-inference-token",
      },
    })
  );
  const leaks: string[] = [];
  const restore = install(requests, leaks);
  const responses: Response[] = [];
  try {
    for (const request of requests) responses.push(await runtime.fetch(request));
    // The host helper must preserve an existing Request without exposing it to
    // a replaced constructor or consulting its own/prototype accessors.
    responses.push(await runtime.request(requests[0]!));
    responses.push(await runtime.request(requests[0]!, { method: "GET" }));
    runtime.setShuttingDown();
    responses.push(await runtime.fetch(requests[0]!));
  } finally {
    restore();
  }

  assertEquals(leaks, [], "dispatch must not pass ingress credentials to replaced intrinsics");
  assertEquals(responses.map((response) => response.status), [
    ...cases.map((c) => c.status),
    200,
    200,
    503,
  ]);
  assertEquals(dispatched.length, 1);
  assertStrictEquals(dispatched[0], requests[2], "the trusted route receives the original Request");
  assertEquals(await responses[2]!.json(), { id: "item one" });
  for (let index = 0; index < responses.length; index++) {
    const response = responses[index]!;
    const allowed = !cases[index]?.origin || cases[index]?.origin === TEST_ORIGIN;
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), allowed ? TEST_ORIGIN : null);
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), allowed ? "true" : null);
  }
  assertEquals(
    responses[5]!.headers.get("Access-Control-Allow-Headers"),
    "Content-Type,Authorization",
  );
}

describe("agent service request dispatch intrinsics", () => {
  it("ignores replaced string splitting and filtering during route selection", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = String.prototype.split;
      String.prototype.split = new Proxy(original, {
        apply(target, receiver, args) {
          if (receiver === "/custom/:id") {
            leaks.push("route path split");
            return ["missing"];
          }
          return ReflectApply(target, receiver, args);
        },
      });
      return () => {
        String.prototype.split = original;
      };
    });
  });

  it("keeps a replaced membership check from admitting an untrusted CORS origin", async () => {
    await exerciseDispatch(() => {
      const original = Array.prototype.includes;
      Array.prototype.includes = () => true;
      return () => {
        Array.prototype.includes = original;
      };
    });
  });

  it("keeps CORS response headers out of replaced header writers", async () => {
    await exerciseDispatch(() => {
      const original = Headers.prototype.set;
      Headers.prototype.set = function (name, value) {
        return ReflectApply(original, this, [
          name,
          name === "Access-Control-Allow-Origin" ? "https://untrusted.example.test" : value,
        ]);
      };
      return () => {
        Headers.prototype.set = original;
      };
    });
  });

  it("never exposes trusted routes to a replaced array iterator", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        ...original,
        value(this: unknown[]) {
          const first = this[0];
          if (typeof first === "object" && first !== null && "handler" in first) {
            // A project can recognize the host route table and supply its own
            // handler, bypassing the trusted handler's authentication entirely.
            return ReflectApply(original.value, [{
              method: "POST",
              path: "/custom/:id",
              handler(request: Request) {
                if (hasCredentials(request)) leaks.push("injected route handler");
                return new Response("injected");
              },
            }], []);
          }
          return ReflectApply(original.value, this, []);
        },
      });
      return () => Object.defineProperty(Array.prototype, Symbol.iterator, original);
    });
  });

  it("does not consult a replaced array entries method when matching routes", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = Object.getOwnPropertyDescriptor(Array.prototype, "entries")!;
      Object.defineProperty(Array.prototype, "entries", {
        ...original,
        value(this: unknown[]) {
          if (this[0] === "custom") leaks.push("route path entries");
          return ReflectApply(original.value, this, []);
        },
      });
      return () => Object.defineProperty(Array.prototype, "entries", original);
    });
  });

  for (const property of ["method", "url", "headers"] as const) {
    it(`keeps credentials out of a replaced Request ${property} getter`, async () => {
      await exerciseDispatch((_requests, leaks) => {
        const original = Object.getOwnPropertyDescriptor(NativeRequest.prototype, property)!;
        Object.defineProperty(NativeRequest.prototype, property, {
          ...original,
          get(this: Request) {
            if (hasCredentials(this)) leaks.push(property);
            return ReflectApply(original.get!, this, []);
          },
        });
        return () => Object.defineProperty(NativeRequest.prototype, property, original);
      });
    });
  }

  for (const property of ["get", "has"] as const) {
    it(`keeps credentials out of a replaced Headers ${property} method`, async () => {
      await exerciseDispatch((_requests, leaks) => {
        const original = Object.getOwnPropertyDescriptor(Headers.prototype, property)!;
        Object.defineProperty(Headers.prototype, property, {
          ...original,
          value(this: Headers, name: string) {
            if (hasCredentialHeaders(this)) leaks.push(property);
            return ReflectApply(original.value, this, [name]);
          },
        });
        return () => Object.defineProperty(Headers.prototype, property, original);
      });
    });
  }

  it("ignores accessors shadowed on individual ingress requests", async () => {
    await exerciseDispatch((requests, leaks) => {
      for (const request of requests) {
        for (const property of ["method", "url", "headers"] as const) {
          const original = Object.getOwnPropertyDescriptor(NativeRequest.prototype, property)!;
          Object.defineProperty(request, property, {
            configurable: true,
            get() {
              leaks.push(property);
              return ReflectApply(original.get!, request, []);
            },
          });
        }
      }
      return () => {
        for (const request of requests) {
          for (const property of ["method", "url", "headers"]) {
            Reflect.deleteProperty(request, property);
          }
        }
      };
    });
  });

  it("keeps dispatch on captured URL and Request constructors", async () => {
    await exerciseDispatch((_requests, leaks) => {
      globalThis.URL = new Proxy(NativeURL, {
        construct(target, args) {
          leaks.push("URL constructor");
          return Reflect.construct(target, args);
        },
      });
      globalThis.Request = new Proxy(NativeRequest, {
        construct(target, args) {
          if (hasCredentials(args[0])) leaks.push("Request constructor");
          return Reflect.construct(target, args);
        },
      });
      return () => {
        globalThis.URL = NativeURL;
        globalThis.Request = NativeRequest;
      };
    });
  });

  it("does not let a replaced URL pathname getter change route selection", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")!;
      Object.defineProperty(NativeURL.prototype, "pathname", {
        ...original,
        get() {
          leaks.push("URL pathname");
          return "/missing";
        },
      });
      return () => Object.defineProperty(NativeURL.prototype, "pathname", original);
    });
  });

  it("keeps credential-bearing receivers out of a replaced Reflect.apply", async () => {
    await exerciseDispatch((_requests, leaks) => {
      Reflect.apply = new Proxy(ReflectApply, {
        apply(target, _receiver, args) {
          if (hasCredentials(args[1])) leaks.push("Reflect.apply receiver");
          return ReflectApply(target, Reflect, args);
        },
      });
      return () => {
        Reflect.apply = ReflectApply;
      };
    });
  });
});
