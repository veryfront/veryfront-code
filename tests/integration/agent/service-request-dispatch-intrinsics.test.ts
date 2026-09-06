import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AgentServiceServerConfig,
  defineAgentService,
} from "#veryfront/agent/service/definition.ts";

const NativeRequest = Request;
const NativeHeaders = Headers;
const NativeURL = URL;
const ReflectApply = Reflect.apply;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(Response.prototype, "headers")!.get!;
const HeadersGet = Headers.prototype.get;
const HeadersSet = Headers.prototype.set;
const StringStartsWith = String.prototype.startsWith;
const TEST_ORIGIN = "https://studio.example.test";

type InstallProbe = (requests: Request[], leaks: string[], origins: string[]) => () => void;

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
  const origins = [TEST_ORIGIN];
  const runtime = defineAgentService({
    serviceName: "request-boundary-test",
    agents: {},
    defaultAgentId: "test",
    server: { cors: { origins, credentials: true } },
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
    {
      path: "/missing",
      method: "OPTIONS",
      status: 204,
      origin: "https://untrusted.example.test",
    },
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
  const restore = install(requests, leaks, origins);
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
  it("rejects inherited routes in a sparse host route table", async () => {
    const routes = new Array(1);
    const runtime = defineAgentService({
      serviceName: "sparse-routes",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({ routes });
    const request = new NativeRequest("https://agent.example.test/sparse", {
      headers: {
        "X-Veryfront-Run-Event-Token": "test-event-token",
        "X-Veryfront-Inference-Token": "test-inference-token",
      },
    });
    let leaked = false;
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() {
        return this === routes
          ? {
            method: "GET",
            path: "/sparse",
            handler(value: Request) {
              leaked = hasCredentials(value);
              return new Response("injected");
            },
          }
          : undefined;
      },
      set(value) {
        Object.defineProperty(this, "0", {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
    let response: Response;
    try {
      response = await runtime.fetch(request);
    } finally {
      if (original) Object.defineProperty(Array.prototype, "0", original);
      else Reflect.deleteProperty(Array.prototype, "0");
    }
    assertEquals(leaked, false);
    assertEquals(response.status, 404);
  });

  it("rejects an inherited wildcard in a sparse CORS allowlist", async () => {
    const origins = new Array<string>(1);
    const runtime = defineAgentService({
      serviceName: "sparse-cors",
      agents: {},
      defaultAgentId: "test",
      server: { cors: { origins, credentials: true } },
    }).createRuntime();
    const request = new NativeRequest("https://agent.example.test/readiness", {
      headers: { Origin: "https://untrusted.example.test" },
    });
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() {
        return this === origins ? "*" : undefined;
      },
      set(value) {
        Object.defineProperty(this, "0", {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
    let response: Response;
    try {
      response = await runtime.fetch(request);
    } finally {
      if (original) Object.defineProperty(Array.prototype, "0", original);
      else Reflect.deleteProperty(Array.prototype, "0");
    }
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), null);
  });

  it("preserves ordinary-object route params while bypassing inherited setters", async () => {
    const runtime = defineAgentService({
      serviceName: "params-compatibility",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/custom/:id",
        handler(_request, params) {
          assertStrictEquals(Object.getPrototypeOf(params), Object.prototype);
          assertStrictEquals(params.hasOwnProperty, Object.prototype.hasOwnProperty);
          assertEquals(Object.hasOwn(params, "id"), true);
          assertEquals(params.toString(), "[object Object]");
          return Response.json(params);
        },
      }],
    });
    const response = await runtime.request("/custom/item%20one");
    assertEquals(await response.json(), { id: "item one" });
  });

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
    await exerciseDispatch((_requests, leaks, origins) => {
      const original = Array.prototype.includes;
      Array.prototype.includes = function (searchElement, fromIndex) {
        if (this === origins) {
          leaks[leaks.length] = "CORS allowlist includes";
          return true;
        }
        return ReflectApply(original, this, [searchElement, fromIndex]);
      };
      return () => {
        Array.prototype.includes = original;
      };
    });
  });

  it("ignores inherited Web IDL init fields after project modules load", async () => {
    const runtime = defineAgentService({
      serviceName: "init-dictionary-boundary-test",
      agents: {},
      defaultAgentId: "test",
      server: { cors: { origins: [TEST_ORIGIN], credentials: true } },
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/inspect",
        handler: (request) =>
          Response.json({
            origin: request.headers.get("Origin"),
            runToken: request.headers.get("X-Veryfront-Run-Event-Token"),
          }),
      }],
    });
    const disallowed = new NativeRequest("https://agent.example.test/liveness", {
      headers: { Origin: "https://untrusted.example.test" },
    });
    const disallowedPreflight = new NativeRequest("https://agent.example.test/custom", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example.test",
        "Access-Control-Request-Method": "POST",
      },
    });
    const inheritedHeaders = {
      Origin: "https://untrusted.example.test",
      "X-Veryfront-Run-Event-Token": "inherited-token",
      "Access-Control-Allow-Origin": "https://untrusted.example.test",
      "Access-Control-Allow-Credentials": "true",
    };
    Object.defineProperties(Object.prototype, {
      headers: { configurable: true, value: inheritedHeaders },
      method: { configurable: true, value: "POST" },
      body: { configurable: true, value: "inherited-body" },
      statusText: { configurable: true, value: "Injected" },
    });

    let ordinary: Response;
    let preflight: Response;
    let helper: Response;
    let shuttingDown: Response;
    try {
      ordinary = await runtime.fetch(disallowed);
      preflight = await runtime.fetch(disallowedPreflight);
      helper = await runtime.request("/inspect", {});
      runtime.setShuttingDown();
      shuttingDown = await runtime.fetch(
        new NativeRequest("https://agent.example.test/readiness"),
      );
    } finally {
      runtime.setShuttingDown(false);
      for (const property of ["headers", "method", "body", "statusText"]) {
        Reflect.deleteProperty(Object.prototype, property);
      }
    }

    for (const response of [ordinary, preflight, shuttingDown]) {
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(response.headers.get("Access-Control-Allow-Credentials"), null);
    }
    assertEquals(ordinary.status, 200);
    assertEquals(preflight.status, 204);
    assertEquals(preflight.statusText, "");
    assertEquals(shuttingDown.status, 503);
    assertEquals(shuttingDown.statusText, "");
    assertEquals(helper.status, 200);
    assertEquals(await helper.json(), { origin: null, runToken: null });
  });

  it("snapshots only own CORS and runtime option fields", async () => {
    const corsRuntime = defineAgentService({
      serviceName: "cors-config-boundary-test",
      agents: {},
      defaultAgentId: "test",
      server: { cors: true },
    }).createRuntime();
    const allowed = new NativeRequest("https://agent.example.test/liveness", {
      headers: { Origin: "https://browser.example.test" },
    });
    const preflightRequest = new NativeRequest("https://agent.example.test/custom", {
      method: "OPTIONS",
      headers: {
        Origin: "https://browser.example.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    Object.defineProperties(Object.prototype, {
      cors: { configurable: true, value: true },
      credentials: { configurable: true, value: true },
      allowMethods: { configurable: true, value: ["DELETE"] },
      allowHeaders: { configurable: true, value: ["X-Inherited"] },
      maxAgeSeconds: { configurable: true, value: 999 },
      routes: {
        configurable: true,
        value: [{
          method: "GET",
          path: "/inherited",
          handler: () => new Response("inherited route"),
        }],
      },
    });

    let response: Response;
    let preflight: Response;
    let disabled: Response;
    let inheritedRoute: Response;
    try {
      response = await corsRuntime.fetch(allowed);
      preflight = await corsRuntime.fetch(preflightRequest);
      const disabledRuntime = defineAgentService({
        serviceName: "cors-disabled-boundary-test",
        agents: {},
        defaultAgentId: "test",
        server: {},
      }).createRuntime({});
      disabled = await disabledRuntime.fetch(allowed);
      inheritedRoute = await disabledRuntime.request("/inherited");
    } finally {
      for (
        const property of [
          "cors",
          "credentials",
          "allowMethods",
          "allowHeaders",
          "maxAgeSeconds",
          "routes",
        ]
      ) {
        Reflect.deleteProperty(Object.prototype, property);
      }
    }

    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), null);
    assertEquals(preflight.headers.get("Access-Control-Allow-Credentials"), null);
    assertEquals(
      preflight.headers.get("Access-Control-Allow-Methods"),
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    assertEquals(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type");
    assertEquals(preflight.headers.get("Access-Control-Max-Age"), null);
    assertEquals(disabled.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(inheritedRoute.status, 404);

    const inheritedCors = Object.create({ origins: [TEST_ORIGIN], credentials: true });
    const inheritedServer = Object.create({ cors: inheritedCors }) as AgentServiceServerConfig;
    const inheritedOptions = Object.create({
      routes: [{
        method: "GET",
        path: "/inherited",
        handler: () => new Response("inherited route"),
      }],
    });
    const compatibleRuntime = defineAgentService({
      serviceName: "inherited-options-compatibility-test",
      agents: {},
      defaultAgentId: "test",
      server: inheritedServer,
    }).createRuntime(inheritedOptions);
    const trusted = await compatibleRuntime.fetch(
      new NativeRequest("https://agent.example.test/liveness", {
        headers: { Origin: TEST_ORIGIN },
      }),
    );
    const untrusted = await compatibleRuntime.fetch(
      new NativeRequest("https://agent.example.test/liveness", {
        headers: { Origin: "https://untrusted.example.test" },
      }),
    );
    assertEquals(trusted.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
    assertEquals(trusted.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(untrusted.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals((await compatibleRuntime.request("/inherited")).status, 200);
  });

  it("ignores inherited descriptor metadata while reading trusted options", async () => {
    const leaks: string[] = [];
    const trustedRoutes = [{
      method: "POST" as const,
      path: "/custom",
      handler: () => new Response("trusted"),
    }];
    const injectedRoutes = [{
      method: "POST" as const,
      path: "/custom",
      handler: (request: Request) => {
        if (hasCredentials(request)) leaks[leaks.length] = "injected descriptor route";
        return new Response("injected");
      },
    }];
    const request = new NativeRequest("https://agent.example.test/custom", {
      method: "POST",
      headers: {
        "X-Veryfront-Run-Event-Token": "test-event-token",
        "X-Veryfront-Inference-Token": "test-inference-token",
      },
    });
    Object.defineProperties(Object.prototype, {
      get: {
        configurable: true,
        value: () => injectedRoutes,
      },
      value: {
        configurable: true,
        value: injectedRoutes,
      },
    });

    let response: Response;
    try {
      const runtime = defineAgentService({
        serviceName: "descriptor-boundary-test",
        agents: {},
        defaultAgentId: "test",
      }).createRuntime({ routes: trustedRoutes });
      response = await runtime.fetch(request);
    } finally {
      Reflect.deleteProperty(Object.prototype, "get");
      Reflect.deleteProperty(Object.prototype, "value");
    }

    assertEquals(leaks, []);
    assertEquals(await response.text(), "trusted");
  });

  it("keeps a replaced Response headers getter from injecting CORS headers", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = Object.getOwnPropertyDescriptor(Response.prototype, "headers")!;
      Object.defineProperty(Response.prototype, "headers", {
        ...original,
        get(this: Response) {
          leaks[leaks.length] = "Response headers";
          const headers = new NativeHeaders(ReflectApply(ResponseHeadersGet, this, []));
          ReflectApply(HeadersSet, headers, [
            "Access-Control-Allow-Origin",
            "https://untrusted.example.test",
          ]);
          ReflectApply(HeadersSet, headers, ["Access-Control-Allow-Credentials", "true"]);
          return headers;
        },
      });
      return () => Object.defineProperty(Response.prototype, "headers", original);
    });
  });

  it("keeps response construction out of a replaced Headers iterator", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
      const injected = new NativeHeaders({
        "Access-Control-Allow-Origin": "https://untrusted.example.test",
        "Access-Control-Allow-Credentials": "true",
      });
      Object.defineProperty(Headers.prototype, Symbol.iterator, {
        ...original,
        value(this: Headers) {
          leaks[leaks.length] = "Headers iterator";
          return ReflectApply(original.value, injected, []);
        },
      });
      return () => Object.defineProperty(Headers.prototype, Symbol.iterator, original);
    });
  });

  it("ignores an Object prototype iterator on custom-prototype header records", async () => {
    const runtime = defineAgentService({
      serviceName: "custom-header-record-boundary-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/headers",
        handler: (request) =>
          Response.json({ authorization: request.headers.get("Authorization") }),
      }],
    });
    const headers = Object.assign(Object.create({ marker: true }), {
      Authorization: "Bearer expected",
    }) as HeadersInit;
    const leaks: string[] = [];
    Object.defineProperty(Object.prototype, Symbol.iterator, {
      configurable: true,
      value(this: unknown) {
        if (this === headers) leaks[leaks.length] = "Object prototype iterator";
        return [["Authorization", "Bearer injected"]][Symbol.iterator]();
      },
    });

    let response: Response;
    try {
      response = await runtime.request("/headers", { headers });
    } finally {
      Reflect.deleteProperty(Object.prototype, Symbol.iterator);
    }

    assertEquals(leaks, []);
    assertEquals(await response.json(), { authorization: "Bearer expected" });
  });

  it("keeps credentialed host request headers out of a replaced Headers iterator", async () => {
    const runtime = defineAgentService({
      serviceName: "request-helper-boundary-test",
      agents: {},
      defaultAgentId: "test",
      server: { cors: { origins: [TEST_ORIGIN], credentials: true } },
    }).createRuntime();
    const headers = new NativeHeaders({
      Origin: TEST_ORIGIN,
      "X-Veryfront-Run-Event-Token": "test-event-token",
      "X-Veryfront-Inference-Token": "test-inference-token",
    });
    const original = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
    const leaks: string[] = [];
    Object.defineProperty(Headers.prototype, Symbol.iterator, {
      ...original,
      value(this: Headers) {
        if (this === headers && hasCredentialHeaders(this)) {
          leaks[leaks.length] = "host request headers";
        }
        return ReflectApply(original.value, this, []);
      },
    });

    let response: Response;
    try {
      response = await runtime.request("/readiness", { headers });
    } finally {
      Object.defineProperty(Headers.prototype, Symbol.iterator, original);
    }

    assertEquals(leaks, []);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), "true");
  });

  it("keeps credentialed known header containers out of replaced iterators", async () => {
    const runtime = defineAgentService({
      serviceName: "request-helper-header-container-boundary-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime();
    const pairs: [string, string][] = [
      ["Origin", TEST_ORIGIN],
      ["X-Veryfront-Run-Event-Token", "test-event-token"],
      ["X-Veryfront-Inference-Token", "test-inference-token"],
    ];
    const map = new Map(pairs);
    const set = new Set(pairs);
    const searchParams = new URLSearchParams(pairs);
    const arrayIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const mapIterator = Object.getOwnPropertyDescriptor(Map.prototype, Symbol.iterator)!;
    const setIterator = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator)!;
    const searchParamsIterator = Object.getOwnPropertyDescriptor(
      URLSearchParams.prototype,
      Symbol.iterator,
    )!;
    const leaks: string[] = [];
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...arrayIterator,
      value(this: unknown[]) {
        if (this === pairs) leaks[leaks.length] = "Array iterator";
        return ReflectApply(arrayIterator.value, this, []);
      },
    });
    Object.defineProperty(Map.prototype, Symbol.iterator, {
      ...mapIterator,
      value(this: Map<string, string>) {
        if (this === map) leaks[leaks.length] = "Map iterator";
        return ReflectApply(mapIterator.value, this, []);
      },
    });
    Object.defineProperty(Set.prototype, Symbol.iterator, {
      ...setIterator,
      value(this: Set<string[]>) {
        if (this === set) leaks[leaks.length] = "Set iterator";
        return ReflectApply(setIterator.value, this, []);
      },
    });
    Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, {
      ...searchParamsIterator,
      value(this: URLSearchParams) {
        if (this === searchParams) leaks[leaks.length] = "URLSearchParams iterator";
        return ReflectApply(searchParamsIterator.value, this, []);
      },
    });

    try {
      assertEquals((await runtime.request("/readiness", { headers: pairs })).status, 200);
      assertEquals(
        (await runtime.request("/readiness", { headers: map as unknown as HeadersInit })).status,
        200,
      );
      assertEquals(
        (await runtime.request("/readiness", { headers: set as unknown as HeadersInit })).status,
        200,
      );
      assertEquals(
        (await runtime.request("/readiness", {
          headers: searchParams as unknown as HeadersInit,
        })).status,
        200,
      );
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, arrayIterator);
      Object.defineProperty(Map.prototype, Symbol.iterator, mapIterator);
      Object.defineProperty(Set.prototype, Symbol.iterator, setIterator);
      Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, searchParamsIterator);
    }

    assertEquals(leaks, []);
  });

  it("preserves body content types while normalizing host request headers", async () => {
    const runtime = defineAgentService({
      serviceName: "request-helper-content-type-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/echo",
        handler: (request) => Response.json({ contentType: request.headers.get("Content-Type") }),
      }],
    });

    const textResponse = await runtime.request("/echo", {
      method: "POST",
      body: "hello",
      headers: new NativeHeaders(),
    });
    assertEquals(await textResponse.json(), { contentType: "text/plain;charset=UTF-8" });

    const form = new FormData();
    form.set("message", "hello");
    const formResponse = await runtime.request("/echo", {
      method: "POST",
      body: form,
      headers: new NativeHeaders(),
    });
    const formContentType = (await formResponse.json()).contentType as string;
    assertEquals(
      ReflectApply(StringStartsWith, formContentType, ["multipart/form-data; boundary="]),
      true,
    );

    const paramsResponse = await runtime.request("/echo", {
      method: "POST",
      body: new URLSearchParams({ message: "hello" }),
      headers: new NativeHeaders(),
    });
    assertEquals(await paramsResponse.json(), {
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    });

    const explicitResponse = await runtime.request("/echo", {
      method: "POST",
      body: "hello",
      headers: new NativeHeaders({ "Content-Type": "application/custom" }),
    });
    assertEquals(await explicitResponse.json(), { contentType: "application/custom" });
  });

  it("preserves a native Request used as RequestInit", async () => {
    const runtime = defineAgentService({
      serviceName: "request-as-init-compatibility-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/echo",
        handler: async (request) =>
          Response.json({
            method: request.method,
            body: await request.text(),
            contentType: request.headers.get("Content-Type"),
            custom: request.headers.get("X-Custom"),
          }),
      }],
    });
    const createInit = () =>
      new NativeRequest("https://source.example.test/original", {
        method: "POST",
        body: "hello",
        headers: { "X-Custom": "preserved" },
      });
    const expected = new NativeRequest("http://localhost/echo", createInit());
    const expectedSnapshot = {
      method: expected.method,
      body: await expected.text(),
      contentType: expected.headers.get("Content-Type"),
      custom: expected.headers.get("X-Custom"),
    };

    const response = await runtime.request("/echo", createInit());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), expectedSnapshot);
  });

  it("preserves RequestInit fields from a custom prototype", async () => {
    const runtime = defineAgentService({
      serviceName: "request-init-prototype-compatibility-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/echo",
        handler: async (request) =>
          Response.json({
            method: request.method,
            body: await request.text(),
            header: request.headers.get("X-Test"),
          }),
      }],
    });
    const createInit = (): RequestInit =>
      Object.create({
        method: "POST",
        body: "hello",
        headers: { "X-Test": "value" },
      }) as RequestInit;
    const expectedRequest = new NativeRequest("http://localhost/echo", createInit());
    const expected = {
      method: expectedRequest.method,
      body: await expectedRequest.text(),
      header: expectedRequest.headers.get("X-Test"),
    };

    const response = await runtime.request("/echo", createInit());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), expected);
  });

  it("matches native Request header normalization across supported header inputs", async () => {
    const runtime = defineAgentService({
      serviceName: "request-helper-header-matrix-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/headers",
        handler: (request) =>
          Response.json({
            entries: Array.from(request.headers.entries()),
            setCookie: request.headers.getSetCookie(),
          }),
      }],
    });
    const inheritedRecord = Object.assign(
      Object.create({ "X-Inherited": "excluded" }),
      { "X-Own": "included" },
    ) as HeadersInit;
    const factories: Array<() => HeadersInit> = [
      () => new NativeHeaders(),
      () => {
        const headers = new NativeHeaders();
        headers.append("Set-Cookie", "a=1");
        headers.append("Set-Cookie", "b=2");
        headers.append("X-Duplicate", "first");
        headers.append("X-Duplicate", "second");
        return headers;
      },
      () => [
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"],
        ["X-Duplicate", "first"],
        ["X-Duplicate", "second"],
      ],
      () => ({ "X-Record": "included" }),
      () => inheritedRecord,
      () => new Map([["X-Map", "included"]]) as unknown as HeadersInit,
      () => new Set<[string, string]>([["X-Set", "included"]]) as unknown as HeadersInit,
      () => new URLSearchParams({ "X-Search-Params": "included" }) as unknown as HeadersInit,
      () => ({
        *[Symbol.iterator]() {
          yield ["X-Custom-Iterable", "included"];
        },
      } as HeadersInit),
    ];

    for (let index = 0; index < factories.length; index++) {
      const expectedRequest = new NativeRequest("http://localhost/headers", {
        headers: factories[index]!(),
      });
      const expected = {
        entries: Array.from(expectedRequest.headers.entries()),
        setCookie: expectedRequest.headers.getSetCookie(),
      };
      const response = await runtime.request("/headers", { headers: factories[index]!() });
      assertEquals(await response.json(), expected);
    }
  });

  it("preserves structural responses with native, tuple, and record headers", async () => {
    const inheritedRecord = Object.assign(
      Object.create({ "X-Inherited": "excluded" }),
      { "Content-Type": "application/json", "X-Own": "included" },
    ) as HeadersInit;
    const headerFactories: Array<() => HeadersInit> = [
      () => {
        const headers = new NativeHeaders({ "Content-Type": "application/json" });
        headers.append("Set-Cookie", "a=1");
        headers.append("Set-Cookie", "b=2");
        headers.append("X-Duplicate", "first");
        headers.append("X-Duplicate", "second");
        return headers;
      },
      () => [
        ["Content-Type", "application/json"],
        ["Set-Cookie", "a=1"],
        ["Set-Cookie", "b=2"],
        ["X-Duplicate", "first"],
        ["X-Duplicate", "second"],
      ],
      () => ({ "Content-Type": "application/json" }),
      () => inheritedRecord,
      () => new Map([["Content-Type", "application/json"]]) as unknown as HeadersInit,
      () =>
        new Set<[string, string]>([["Content-Type", "application/json"]]) as unknown as HeadersInit,
      () => new URLSearchParams({ "Content-Type": "application/json" }) as unknown as HeadersInit,
      () => ({
        *[Symbol.iterator]() {
          yield ["Content-Type", "application/json"];
        },
      } as HeadersInit),
    ];

    for (let index = 0; index < headerFactories.length; index++) {
      const expected = new Response('{"error":"unauthorized"}', {
        status: 401,
        statusText: "Unauthorized",
        headers: headerFactories[index]!(),
      });
      const runtime = defineAgentService({
        serviceName: `response-like-boundary-test-${index}`,
        agents: {},
        defaultAgentId: "test",
        server: { cors: true },
      }).createRuntime({
        routes: [{
          method: "POST",
          path: "/auth",
          handler: () => ({
            status: 401,
            statusText: "Unauthorized",
            headers: headerFactories[index]!(),
            body: new Response('{"error":"unauthorized"}').body,
            bodyUsed: false,
            text: async () => "unauthorized",
            json: async () => ({ error: "unauthorized" }),
          } as Response),
        }],
      });

      const response = await runtime.request("/auth", {
        method: "POST",
        headers: { Origin: TEST_ORIGIN },
      });
      const expectedHeaders = new NativeHeaders(expected.headers);
      expectedHeaders.set("Access-Control-Allow-Origin", "*");
      expectedHeaders.append("Vary", "Origin");
      assertEquals(response.status, 401);
      assertEquals(response.statusText, "Unauthorized");
      assertEquals(
        Array.from(response.headers.entries()),
        Array.from(expectedHeaders.entries()),
      );
      assertEquals(response.headers.getSetCookie(), expected.headers.getSetCookie());
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
      assertEquals(await response.json(), { error: "unauthorized" });
    }
  });

  it("keeps route params out of replaced Object prototype setters", async () => {
    const runtime = defineAgentService({
      serviceName: "route-params-boundary-test",
      agents: {},
      defaultAgentId: "test",
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/custom/:reviewUniqueParam",
        handler: (_request, params) =>
          Response.json({
            value: params.reviewUniqueParam,
            own: Object.hasOwn(params, "reviewUniqueParam"),
          }),
      }],
    });
    let setterValue: string | undefined;
    Object.defineProperty(Object.prototype, "reviewUniqueParam", {
      configurable: true,
      get: () => "attacker-selected",
      set: (value: string) => {
        setterValue = value;
      },
    });

    let response: Response;
    try {
      response = await runtime.request("/custom/expected");
    } finally {
      Reflect.deleteProperty(Object.prototype, "reviewUniqueParam");
    }

    assertEquals(setterValue, undefined);
    assertEquals(await response.json(), { value: "expected", own: true });
  });

  for (const property of ["startsWith", "indexOf", "slice"] as const) {
    it(`keeps route matching on the captured String ${property} method`, async () => {
      await exerciseDispatch((_requests, leaks) => {
        const original = Object.getOwnPropertyDescriptor(String.prototype, property)!;
        Object.defineProperty(String.prototype, property, {
          ...original,
          value(this: string, ...args: unknown[]) {
            const value = String(this);
            if (ReflectApply(StringStartsWith, value, ["/"]) || value === ":id") {
              leaks[leaks.length] = property;
            }
            return ReflectApply(original.value, this, args);
          },
        });
        return () => Object.defineProperty(String.prototype, property, original);
      });
    });
  }

  it("keeps route parameter decoding on the captured decoder", async () => {
    await exerciseDispatch((_requests, leaks) => {
      const original = globalThis.decodeURIComponent;
      globalThis.decodeURIComponent = (value) => {
        if (value === "item%20one") leaks[leaks.length] = "decodeURIComponent";
        return original(value);
      };
      return () => {
        globalThis.decodeURIComponent = original;
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
