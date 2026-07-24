import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRouteRegistrySpanAttributes, RouteRegistry } from "./registry.ts";
import type { Handler, HandlerContext, HandlerResult } from "./types.ts";
import { CONFIG_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import { Response as NodeFetchResponse } from "npm:node-fetch@3.3.2";
import { Response as UndiciResponse } from "npm:undici@7.28.0";

function makeHandler(
  name: string,
  priority: number,
  result: HandlerResult = { continue: true },
  enabled?: (ctx: HandlerContext) => boolean,
): Handler {
  return {
    metadata: { name, priority, enabled },
    handle: () => Promise.resolve(result),
  };
}

function makeCtx(): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
  };
}

function makeReq(): Request {
  return new Request("http://localhost/test");
}

interface ResponseLikeOverrides {
  readonly type?: string;
  readonly statusText?: string;
  readonly headers?: Headers;
  readonly body?: Response["body"];
  readonly bodyUsed?: boolean;
}

class ResponseLikeView {
  readonly #response: Response;
  readonly #onClone: () => void;
  readonly #overrides: ResponseLikeOverrides;

  constructor(
    response: Response,
    onClone: () => void,
    overrides: ResponseLikeOverrides = {},
  ) {
    this.#response = response;
    this.#onClone = onClone;
    this.#overrides = overrides;
  }

  get type(): string {
    return this.#overrides.type ?? this.#response.type;
  }

  get status(): number {
    return this.#response.status;
  }

  get statusText(): string {
    return this.#overrides.statusText ?? this.#response.statusText;
  }

  get headers(): Headers {
    return this.#overrides.headers ?? this.#response.headers;
  }

  get body(): Response["body"] {
    return this.#overrides.body ?? this.#response.body;
  }

  get bodyUsed(): boolean {
    return this.#overrides.bodyUsed ?? this.#response.bodyUsed;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#response.arrayBuffer();
  }

  blob(): Promise<Blob> {
    return this.#response.blob();
  }

  clone(): ResponseLikeView {
    this.#onClone();
    return new ResponseLikeView(
      this.#response.clone(),
      this.#onClone,
      this.#overrides,
    );
  }

  formData(): Promise<FormData> {
    return this.#response.formData();
  }

  json(): Promise<unknown> {
    return this.#response.json();
  }

  text(): Promise<string> {
    return this.#response.text();
  }
}

Object.defineProperty(ResponseLikeView.prototype, Symbol.toStringTag, {
  configurable: true,
  value: "Response",
});

describe("routing/registry/RouteRegistry", () => {
  describe("register()", () => {
    it("should register a handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should sort handlers by priority after registration", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("low", 1000));
      registry.register(makeHandler("high", 100));
      registry.register(makeHandler("medium", 500));

      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["high", "medium", "low"]);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.register(makeHandler("test", 100));
      assertEquals(result, registry);
    });

    it("supports accessor-backed handlers allowed by the public Handler contract", async () => {
      const registry = new RouteRegistry();
      const metadata = { name: "accessor-handler", priority: 100 };
      let metadataReads = 0;
      let handleReads = 0;
      const handler: Handler = {
        get metadata() {
          metadataReads++;
          return metadata;
        },
        get handle() {
          handleReads++;
          return () => Promise.resolve({ response: new Response("accessor") });
        },
      };

      registry.register(handler);
      const response = await registry.execute(makeReq(), makeCtx());

      assertEquals(await response?.text(), "accessor");
      assertEquals(metadataReads, 4);
      assertEquals(handleReads, 2);
    });

    it("rejects non-finite priorities without partially registering handlers", () => {
      const registry = new RouteRegistry();

      for (const priority of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assertThrows(
          () => registry.register(makeHandler("invalid", priority)),
          TypeError,
          "finite number",
        );
      }

      assertEquals(registry.getHandlers(), []);
    });

    it("rejects incomplete runtime handler values with a stable TypeError", () => {
      const registry = new RouteRegistry();

      for (
        const handler of [
          null,
          {},
          { metadata: null, handle: () => Promise.resolve({ continue: true }) },
          {
            metadata: { name: "", priority: 100 },
            handle: () => Promise.resolve({ continue: true }),
          },
          { metadata: { name: "missing-handle", priority: 100 } },
          {
            metadata: { name: "invalid-enabled", priority: 100, enabled: true },
            handle: () => Promise.resolve({ continue: true }),
          },
        ]
      ) {
        assertThrows(
          () => registry.register(handler as Handler),
          TypeError,
          "Handler",
        );
      }

      assertEquals(registry.getHandlers(), []);
    });

    it("refreshes live priorities when a later handler is registered", async () => {
      const registry = new RouteRegistry();
      const first = makeHandler("first", 100, {
        response: new Response("first"),
      });
      const second = makeHandler("second", 200, {
        response: new Response("second"),
      });
      registry.registerAll([first, second]);

      let priorityReads = 0;
      Object.defineProperty(second.metadata, "priority", {
        configurable: true,
        get() {
          priorityReads++;
          return 50;
        },
      });
      registry.register(makeHandler("third", 300));

      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["second", "first", "third"],
      );
      assertEquals(priorityReads, 2);
      assertEquals(await (await registry.execute(makeReq(), makeCtx()))?.text(), "second");
      assertEquals(priorityReads, 2);
    });

    it("rejects an unstable priority after two bounded snapshot reads", () => {
      const registry = new RouteRegistry();
      let priorityReads = 0;
      const unstable = makeHandler("unstable", 100);
      Object.defineProperty(unstable.metadata, "priority", {
        configurable: true,
        get() {
          priorityReads++;
          return priorityReads % 2 === 1 ? 100 : 200;
        },
      });

      assertThrows(
        () => registry.register(unstable),
        TypeError,
        "remain stable",
      );
      assertEquals(priorityReads, 3);
      assertEquals(registry.getHandlers(), []);
    });

    it("rejects when an existing priority getter invalidates the incoming handler", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      registry.register(existing);
      const incoming = makeHandler("incoming", 200);
      Object.defineProperty(existing.metadata, "priority", {
        configurable: true,
        get() {
          incoming.metadata.priority = Number.NaN;
          return 100;
        },
      });

      assertThrows(
        () => registry.register(incoming),
        TypeError,
        "finite number",
      );
      assertEquals(registry.getHandlers(), [existing]);
      assertEquals(registry.has("incoming"), false);
      assertEquals(registry.getStats().handlersByPriority, { "100": 1 });
    });

    it("rejects reentrant registration without losing or partially adding handlers", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      registry.register(existing);
      const nested = makeHandler("nested", 50);
      const incoming = makeHandler("incoming", 200);
      Object.defineProperty(existing.metadata, "priority", {
        configurable: true,
        get() {
          registry.register(nested);
          return 100;
        },
      });

      assertThrows(
        () => registry.register(incoming),
        TypeError,
        "must not be reentrant",
      );
      assertEquals(registry.getHandlers(), [existing]);
      assertEquals(registry.has("existing"), true);
      assertEquals(registry.has("nested"), false);
      assertEquals(registry.has("incoming"), false);
      assertEquals(registry.getStats().handlersByPriority, { "100": 1 });

      Object.defineProperty(existing.metadata, "priority", {
        configurable: true,
        value: 100,
        writable: true,
      });
      registry.register(incoming);
      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["existing", "incoming"],
      );
    });

    it("rejects clear and remove while a priority snapshot is active", () => {
      const mutations = [
        (registry: RouteRegistry) => {
          registry.clear();
          throw new Error("clear unexpectedly returned");
        },
        (registry: RouteRegistry) => {
          registry.remove("existing");
        },
      ];

      for (const mutate of mutations) {
        const registry = new RouteRegistry();
        const existing = makeHandler("existing", 100);
        registry.register(existing);
        Object.defineProperty(existing.metadata, "priority", {
          configurable: true,
          get() {
            mutate(registry);
            return 100;
          },
        });

        assertThrows(
          () => registry.register(makeHandler("incoming", 200)),
          TypeError,
          "must not be reentrant",
        );
        assertEquals(registry.getHandlers(), [existing]);
        assertEquals(registry.has("existing"), true);
        assertEquals(registry.has("incoming"), false);
        assertEquals(registry.getStats().handlersByPriority, { "100": 1 });
      }
    });
  });

  describe("registerAll()", () => {
    it("should register multiple handlers", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("a", 100),
        makeHandler("b", 200),
        makeHandler("c", 300),
      ]);
      assertEquals(registry.getHandlers().length, 3);
    });

    it("should sort all handlers by priority", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("c", 300),
        makeHandler("a", 100),
        makeHandler("b", 200),
      ]);
      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["a", "b", "c"]);
    });

    it("keeps an empty batch as a no-op", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      registry.register(existing);
      Object.defineProperty(existing.metadata, "priority", {
        configurable: true,
        get() {
          throw new Error("an empty batch must not refresh existing handlers");
        },
      });

      assertEquals(registry.registerAll([]), registry);
      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["existing"],
      );
    });

    it("guards and snapshots batch length before validation", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 50);
      registry.register(existing);
      const destructiveLength = new Proxy([] as Handler[], {
        get(target, property, receiver) {
          if (property === "length") {
            registry.clear();
            throw new Error("batch length unexpectedly returned");
          }
          return Reflect.get(target, property, receiver);
        },
      });

      assertThrows(
        () => registry.registerAll(destructiveLength),
        TypeError,
        "must not be reentrant",
      );
      assertEquals(registry.getHandlers(), [existing]);

      const incoming = makeHandler("incoming", 100);
      let lengthReads = 0;
      const dynamicLength = new Proxy([incoming], {
        get(target, property, receiver) {
          if (property === "length") {
            lengthReads++;
            return lengthReads === 1 ? 1 : 1000;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      registry.registerAll(dynamicLength);
      assertEquals(lengthReads, 1);
      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["existing", "incoming"],
      );
    });

    it("validates the complete batch before changing the registry", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("existing", 50));

      assertThrows(
        () =>
          registry.registerAll([
            makeHandler("valid", 100),
            makeHandler("invalid", Number.NaN),
          ]),
        TypeError,
        "finite number",
      );

      assertEquals(registry.getHandlers().map((handler) => handler.metadata.name), ["existing"]);
    });

    it("rejects sparse batches without corrupting existing registrations", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 50);
      registry.register(existing);
      const sparseBatch = new Array<Handler>(1);

      assertThrows(
        () => registry.registerAll(sparseBatch),
        TypeError,
        "Handler must be a non-null object",
      );

      assertEquals(registry.getHandlers(), [existing]);
      assertEquals(registry.getStats(), {
        totalHandlers: 1,
        handlerNames: ["existing"],
        handlersByPriority: { "50": 1 },
      });
    });

    it("refreshes existing priorities before atomically adding a batch", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      registry.register(existing);
      existing.metadata.priority = 400;

      registry.registerAll([
        makeHandler("middle", 300),
        makeHandler("first", 200),
      ]);

      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["first", "middle", "existing"],
      );
    });

    it("leaves the registry unchanged when live-priority refresh fails", () => {
      const operations = [
        (registry: RouteRegistry) => registry.register(makeHandler("new", 300)),
        (registry: RouteRegistry) => registry.registerAll([makeHandler("new", 300)]),
      ];

      for (const registerLater of operations) {
        const registry = new RouteRegistry();
        const readable = makeHandler("readable", 100);
        const unreadable = makeHandler("unreadable", 200);
        registry.registerAll([readable, unreadable]);
        Object.defineProperty(unreadable.metadata, "priority", {
          configurable: true,
          get() {
            throw new Error("priority refresh failed");
          },
        });

        assertThrows(
          () => registerLater(registry),
          Error,
          "priority refresh failed",
        );
        assertEquals(
          registry.getHandlers().map((handler) => handler.metadata.name),
          ["readable", "unreadable"],
        );
        assertEquals(registry.has("new"), false);
      }
    });

    it("rejects cross-mutating batch priorities without partial registration", () => {
      const registry = new RouteRegistry();
      const retained = makeHandler("retained", 50);
      registry.register(retained);
      const first = makeHandler("first", 100);
      const second = makeHandler("second", 200);
      let firstPriority = 100;
      let firstReads = 0;
      let secondReads = 0;

      Object.defineProperty(first.metadata, "priority", {
        configurable: true,
        get() {
          firstReads++;
          return firstPriority;
        },
      });
      Object.defineProperty(second.metadata, "priority", {
        configurable: true,
        get() {
          secondReads++;
          firstPriority = firstPriority === 100 ? 400 : 100;
          return 200;
        },
      });

      assertThrows(
        () => registry.registerAll([first, second]),
        TypeError,
        "remain stable",
      );
      assertEquals(firstReads, 3);
      assertEquals(secondReads, 3);
      assertEquals(registry.getHandlers(), [retained]);
      assertEquals(registry.getStats(), {
        totalHandlers: 1,
        handlerNames: ["retained"],
        handlersByPriority: { "50": 1 },
      });
    });

    it("uses one stable batch snapshot for order, execution, and statistics", async () => {
      const registry = new RouteRegistry();
      const executionOrder: string[] = [];
      const makeTrackedHandler = (
        name: string,
        priority: number,
        result: HandlerResult,
      ): Handler => ({
        metadata: {
          name,
          get priority() {
            return priority;
          },
        },
        handle() {
          executionOrder.push(name);
          return Promise.resolve(result);
        },
      });
      const last = makeTrackedHandler("last", 300, { continue: true });
      const first = makeTrackedHandler("first", 100, { continue: true });
      const responder = makeTrackedHandler("responder", 200, {
        response: new Response("done"),
      });

      registry.registerAll([last, first, responder]);

      assertEquals(
        registry.getHandlers().map((handler) => handler.metadata.name),
        ["first", "responder", "last"],
      );
      assertEquals(await (await registry.execute(makeReq(), makeCtx()))?.text(), "done");
      assertEquals(executionOrder, ["first", "responder"]);
      assertEquals(registry.getStats(), {
        totalHandlers: 3,
        handlerNames: ["first", "responder", "last"],
        handlersByPriority: { "100": 1, "200": 1, "300": 1 },
      });
    });
  });

  describe("execute()", () => {
    it("adds trusted project identity to the routing span attributes", () => {
      const req = makeReq();
      const url = new URL(req.url);
      const attributes = buildRouteRegistrySpanAttributes(req, url, {
        ...makeCtx(),
        projectSlug: "investment-ops-agent",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        environmentName: "Production",
      });

      assertEquals(attributes["http.method"], "GET");
      assertEquals(attributes["http.path"], "/test");
      assertEquals(attributes["veryfront.project_slug"], "investment-ops-agent");
      assertEquals(attributes["project.slug"], "investment-ops-agent");
      assertEquals(attributes["veryfront.project_id"], "proj-123");
      assertEquals(attributes["project.id"], "proj-123");
      assertEquals(attributes["veryfront.environment"], "production");
      assertEquals(attributes["veryfront.environment_name"], "Production");
    });

    it("omits project attributes when no trusted project identity exists", () => {
      const req = makeReq();
      const url = new URL(req.url);
      const attributes = buildRouteRegistrySpanAttributes(req, url, makeCtx());

      assertEquals(attributes["http.method"], "GET");
      assertEquals(attributes["http.path"], "/test");
      assertEquals("veryfront.project_slug" in attributes, false);
      assertEquals("project.slug" in attributes, false);
      assertEquals("veryfront.project_id" in attributes, false);
      assertEquals("project.id" in attributes, false);
      assertEquals("veryfront.environment" in attributes, false);
      assertEquals("veryfront.environment_name" in attributes, false);
    });

    it("does not emit slug fallbacks as project id attributes", () => {
      const req = makeReq();
      const url = new URL(req.url);
      const attributes = buildRouteRegistrySpanAttributes(req, url, {
        ...makeCtx(),
        projectSlug: "ops-agent",
        enriched: {
          projectSlug: "ops-agent",
          projectId: "ops-agent",
        } as HandlerContext["enriched"],
      });

      assertEquals(attributes["veryfront.project_slug"], "ops-agent");
      assertEquals(attributes["project.slug"], "ops-agent");
      assertEquals("veryfront.project_id" in attributes, false);
      assertEquals("project.id" in attributes, false);
    });

    it("should return response from first matching handler", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("responder", 100, {
          response: new Response("ok", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
    });

    it("should skip handlers that return continue: true", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass-through", 100, { continue: true }));
      registry.register(
        makeHandler("responder", 200, {
          response: new Response("found", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
      assertEquals(await result?.text(), "found");
    });

    it("converts an invalid handler response value into an HTTP boundary response", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("invalid-response", 100, {
          response: { status: 200 } as Response,
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
    });

    it("rejects a Response.prototype lookalike even when response fields are shadowed", async () => {
      const source = new Response("forged", {
        status: 202,
        statusText: "Accepted",
        headers: { "x-forged": "true" },
      });
      const forged = Object.defineProperties(Object.create(Response.prototype), {
        status: { value: source.status },
        statusText: { value: source.statusText },
        headers: { value: source.headers },
        body: { value: source.body },
        bodyUsed: { value: source.bodyUsed },
        text: { value: source.text.bind(source) },
        arrayBuffer: { value: source.arrayBuffer.bind(source) },
      }) as Response;
      const registry = new RouteRegistry();
      registry.register(makeHandler("forged-response", 100, { response: forged }));

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
    });

    it("rejects an incomplete Response-like accessor implementation", async () => {
      const source = new Response("shape-only", {
        status: 202,
        statusText: "Accepted",
        headers: { "x-shape-only": "true" },
      });
      class ShapeOnlyResponse {
        get type(): ResponseType {
          return source.type;
        }

        get status(): number {
          return source.status;
        }

        get statusText(): string {
          return source.statusText;
        }

        get headers(): Headers {
          return source.headers;
        }

        get body(): Response["body"] {
          return source.body;
        }

        get bodyUsed(): boolean {
          return source.bodyUsed;
        }
      }
      Object.defineProperty(ShapeOnlyResponse.prototype, Symbol.toStringTag, {
        configurable: true,
        value: "Response",
      });

      const registry = new RouteRegistry();
      registry.register(
        makeHandler("shape-only-response", 100, {
          response: new ShapeOnlyResponse() as unknown as Response,
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
    });

    it("safely normalizes a separately implemented Response-like value without clone probes", async () => {
      const source = new Response("cross-context", {
        status: 202,
        statusText: "Accepted",
        headers: { "x-context": "foreign" },
      });
      let cloneCalls = 0;
      const crossContext = new ResponseLikeView(source, () => cloneCalls++);
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("cross-context", 100, {
          response: crossContext as unknown as Response,
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result === (crossContext as unknown as Response), false);
      assertEquals(result?.status, 202);
      assertEquals(result?.headers.get("x-context"), "foreign");
      assertEquals(await result?.text(), "cross-context");
      assertEquals(cloneCalls, 0);
    });

    it("preserves the current runtime's canonical Response.error()", async () => {
      const errorResponse = Response.error();
      const registry = new RouteRegistry();
      registry.register(makeHandler("current-error", 100, { response: errorResponse }));

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result, errorResponse);
      assertEquals(result?.status, 0);
      assertEquals(result?.type, "error");
      assertEquals(result?.statusText, "");
      assertEquals([...result!.headers], []);
      assertEquals(result?.body, null);
      assertEquals(result?.bodyUsed, false);
    });

    it("normalizes own state shadows on native error responses", async () => {
      const shadowedErrors = [
        Object.defineProperty(Response.error(), "type", {
          configurable: true,
          value: "opaque",
        }),
        Object.defineProperty(Response.error(), "statusText", {
          configurable: true,
          value: "Error",
        }),
        Object.defineProperty(Response.error(), "headers", {
          configurable: true,
          value: new Headers({ "x-invalid": "true" }),
        }),
      ];

      for (const [index, shadowedError] of shadowedErrors.entries()) {
        const registry = new RouteRegistry();
        registry.register(
          makeHandler(`shadowed-native-error-${index}`, 100, {
            response: shadowedError,
          }),
        );

        const result = await registry.execute(makeReq(), makeCtx());

        assertEquals(result instanceof Response, true);
        assertEquals(result === shadowedError, false);
        assertEquals(result?.status, 0);
        assertEquals(result?.type, "error");
        assertEquals(result?.statusText, "");
        assertEquals([...result!.headers], []);
        assertEquals(result?.body, null);
      }
    });

    it("normalizes shadowed native response fields from intrinsic state", async () => {
      const nativeResponse = new Response("native-body", {
        status: 200,
        statusText: "OK",
        headers: { "x-native": "true" },
      });
      Object.defineProperty(nativeResponse, "status", {
        configurable: true,
        get() {
          throw new Error("own status accessor must not cross the boundary");
        },
      });
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("shadowed-native-response", 100, {
          response: nativeResponse,
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result === nativeResponse, false);
      assertEquals(result?.status, 200);
      assertEquals(result?.statusText, "OK");
      assertEquals(result?.headers.get("x-native"), "true");
      assertEquals(await result?.text(), "native-body");
    });

    it("normalizes native state overrides inherited before Response.prototype", async () => {
      class ShadowedNativeResponse extends Response {}

      const subclassResponse = new ShadowedNativeResponse("subclass-body", {
        status: 201,
        statusText: "Created",
        headers: { "x-subclass": "true" },
      });
      Object.defineProperty(ShadowedNativeResponse.prototype, "status", {
        configurable: true,
        get() {
          throw new Error("subclass status must not cross the boundary");
        },
      });
      const subclassRegistry = new RouteRegistry();
      subclassRegistry.register(
        makeHandler("subclass-native-response", 100, {
          response: subclassResponse,
        }),
      );

      const subclassResult = await subclassRegistry.execute(makeReq(), makeCtx());

      assertEquals(subclassResult === subclassResponse, false);
      assertEquals(subclassResult?.status, 201);
      assertEquals(subclassResult?.statusText, "Created");
      assertEquals(subclassResult?.headers.get("x-subclass"), "true");
      assertEquals(await subclassResult?.text(), "subclass-body");

      const prototypeShadowedError = Response.error();
      const shadowPrototype = Object.create(Response.prototype);
      Object.defineProperties(shadowPrototype, {
        type: { configurable: true, value: "opaque" },
        status: { configurable: true, value: 299 },
        headers: {
          configurable: true,
          value: new Headers({ "x-prototype-shadow": "true" }),
        },
      });
      Object.setPrototypeOf(prototypeShadowedError, shadowPrototype);
      const errorRegistry = new RouteRegistry();
      errorRegistry.register(
        makeHandler("prototype-shadowed-error", 100, {
          response: prototypeShadowedError,
        }),
      );

      const errorResult = await errorRegistry.execute(makeReq(), makeCtx());

      assertEquals(errorResult === prototypeShadowedError, false);
      assertEquals(errorResult?.status, 0);
      assertEquals(errorResult?.type, "error");
      assertEquals([...errorResult!.headers], []);
    });

    it("normalizes locked Undici and node-fetch canonical error responses", async () => {
      const foreignErrors = [
        UndiciResponse.error(),
        NodeFetchResponse.error(),
      ];

      for (const [index, foreignError] of foreignErrors.entries()) {
        const registry = new RouteRegistry();
        registry.register(
          makeHandler(`foreign-error-${index}`, 100, {
            response: foreignError as unknown as Response,
          }),
        );

        const result = await registry.execute(makeReq(), makeCtx());

        assertEquals(result instanceof Response, true);
        assertEquals(result === (foreignError as unknown as Response), false);
        assertEquals(result?.status, 0);
        assertEquals(result?.type, "error");
        assertEquals(result?.statusText, "");
        assertEquals([...result!.headers], []);
        assertEquals(result?.body, null);
        assertEquals(result?.bodyUsed, false);
      }
    });

    it("rejects noncanonical status-0 Response-like values", async () => {
      const canonicalSource = Response.error();
      const body = new Response("not-an-error-body").body;
      const candidates: unknown[] = [
        new NodeFetchResponse(null, { status: 0 }),
        new ResponseLikeView(canonicalSource, () => {}, { type: "opaque" }),
        new ResponseLikeView(canonicalSource, () => {}, { type: "unknown" }),
        new ResponseLikeView(canonicalSource, () => {}, { statusText: "Error" }),
        new ResponseLikeView(canonicalSource, () => {}, {
          headers: new Headers({ "x-invalid": "true" }),
        }),
        new ResponseLikeView(canonicalSource, () => {}, { body }),
        new ResponseLikeView(canonicalSource, () => {}, { bodyUsed: true }),
      ];

      for (const [index, candidate] of candidates.entries()) {
        const registry = new RouteRegistry();
        registry.register(
          makeHandler(`noncanonical-error-${index}`, 100, {
            response: candidate as Response,
          }),
        );

        const result = await registry.execute(makeReq(), makeCtx());

        assertEquals(result?.status, 500);
        assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
      }
    });

    it("rejects consumed Responses inside the handler error boundary", async () => {
      const consumed = new Response("already-read");
      await consumed.text();
      const registry = new RouteRegistry();
      registry.register(makeHandler("consumed-response", 100, { response: consumed }));

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result instanceof Response, true);
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
    });

    it("short-circuits result processing after reading a valid response once", async () => {
      let responseReads = 0;
      let continueReads = 0;
      const result = Object.defineProperties({}, {
        response: {
          enumerable: true,
          get() {
            responseReads++;
            return new Response("accessor-response");
          },
        },
        continue: {
          enumerable: true,
          get() {
            continueReads++;
            throw new Error("continue must not be read after a response");
          },
        },
      }) as HandlerResult;
      const registry = new RouteRegistry();
      registry.register(makeHandler("accessor-result", 100, result));

      const response = await registry.execute(makeReq(), makeCtx());

      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "accessor-response");
      assertEquals(responseReads, 1);
      assertEquals(continueReads, 0);
    });

    it("reads a continue accessor exactly once when no response exists", async () => {
      let continueReads = 0;
      const result = Object.defineProperty({}, "continue", {
        enumerable: true,
        get() {
          continueReads++;
          return true;
        },
      }) as HandlerResult;
      const registry = new RouteRegistry();
      registry.register(makeHandler("accessor-result", 100, result));
      registry.register(
        makeHandler("responder", 200, {
          response: new Response("next"),
        }),
      );

      const response = await registry.execute(makeReq(), makeCtx());

      assertEquals(await response?.text(), "next");
      assertEquals(continueReads, 1);
    });

    it("contains throwing handler-result accessors inside the HTTP boundary", async () => {
      let responseReads = 0;
      const result = Object.defineProperty({}, "response", {
        enumerable: true,
        get() {
          responseReads++;
          throw new Error("result accessor failed");
        },
      }) as HandlerResult;
      const registry = new RouteRegistry();
      registry.register(makeHandler("throwing-accessor-result", 100, result));

      const response = await registry.execute(makeReq(), makeCtx());

      assertEquals(response?.status, 500);
      assertEquals(response?.headers.get("Content-Type"), "application/problem+json");
      assertEquals(responseReads, 1);
    });

    it("contains a throwing continue accessor inside the HTTP boundary", async () => {
      let continueReads = 0;
      const result = Object.defineProperty({}, "continue", {
        enumerable: true,
        get() {
          continueReads++;
          throw new Error("continue accessor failed");
        },
      }) as HandlerResult;
      const registry = new RouteRegistry();
      registry.register(makeHandler("throwing-continue-result", 100, result));

      const response = await registry.execute(makeReq(), makeCtx());

      assertEquals(response?.status, 500);
      assertEquals(response?.headers.get("Content-Type"), "application/problem+json");
      assertEquals(continueReads, 1);
    });

    it("should return null when no handler matches", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass", 100, { continue: true }));

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should stop chain when handler returns continue: false without response", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("stopper", 100, { continue: false }));
      registry.register(
        makeHandler("never-reached", 200, {
          response: new Response("should not see"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should skip disabled handlers", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler(
          "disabled",
          100,
          { response: new Response("disabled") },
          () => false,
        ),
      );
      registry.register(
        makeHandler("enabled", 200, {
          response: new Response("enabled"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(await result?.text(), "enabled");
    });

    it("uses live enabled and handle properties after registration", async () => {
      const registry = new RouteRegistry();
      const handler = makeHandler("live-handler", 100, {
        response: new Response("initial"),
      });
      registry.register(handler);

      handler.metadata.enabled = () => false;
      assertEquals(await registry.execute(makeReq(), makeCtx()), null);

      handler.metadata.enabled = () => true;
      handler.handle = () => Promise.resolve({ response: new Response("replacement") });
      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(await result?.text(), "replacement");
    });

    it("should return RFC 9457 error response when handler throws", async () => {
      const registry = new RouteRegistry();
      const errorHandler: Handler = {
        metadata: { name: "erroring", priority: 100 },
        handle: () => Promise.reject(new Error("handler error")),
      };

      registry.register(errorHandler);
      registry.register(
        makeHandler("fallback", 200, {
          response: new Response("fallback", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      // Should return error response, not continue to fallback handler
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");

      const body = await result?.json() as { type?: string; title?: string; category?: string };
      assertEquals(body.type?.includes("unknown-error"), true);
      assertEquals(body.category, "GENERAL");
    });

    it("preserves the HTTP error boundary for unreadable handler rejections", async () => {
      const unreadableError = new Proxy({}, {
        get() {
          throw new Error("handler rejection must not be inspected directly");
        },
        getPrototypeOf() {
          throw new Error("handler rejection prototype must not be inspected directly");
        },
      });
      const registry = new RouteRegistry();
      registry.register({
        metadata: { name: "hostile-error", priority: 100 },
        handle: () => Promise.reject(unreadableError),
      });

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
      const body = await result?.json() as { type?: string; category?: string };
      assertEquals(body.type?.includes("unknown-error"), true);
      assertEquals(body.category, "GENERAL");
    });

    it("contains unreadable live handler metadata with the registered name fallback", async () => {
      const registry = new RouteRegistry();
      const handler: Handler = {
        metadata: { name: "mutable-metadata", priority: 100 },
        handle: () => Promise.reject(new Error("registered handler failed")),
      };
      registry.register(handler);
      Object.defineProperty(handler, "metadata", {
        configurable: true,
        get() {
          throw new Error("mutated metadata must not escape the handler boundary");
        },
      });

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
    });

    it("should return RFC 9457 response with correct slug for VeryfrontError", async () => {
      const registry = new RouteRegistry();
      const errorHandler: Handler = {
        metadata: { name: "config-error", priority: 100 },
        handle: () => Promise.reject(CONFIG_NOT_FOUND.create({ detail: "Test config error" })),
      };

      registry.register(errorHandler);

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result?.status, 404);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");

      const body = await result?.json() as {
        type?: string;
        detail?: string;
        suggestion?: string;
        category?: string;
      };
      assertEquals(body.type?.includes("config-not-found"), true);
      assertEquals(body.category, "CONFIG");
      assertEquals(body.detail, "Test config error");
      assertEquals(body.suggestion?.includes("veryfront.config.ts"), true);
    });

    it("should return null on empty registry", async () => {
      const registry = new RouteRegistry();
      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });
  });

  describe("getHandlers()", () => {
    it("should return all registered handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      assertEquals(registry.getHandlers().length, 2);
    });

    it("should return empty array when no handlers registered", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("returns a frozen snapshot instead of the mutable registry storage", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("registered", 100));

      const handlers = registry.getHandlers();

      assertEquals(Object.isFrozen(handlers), true);
      assertThrows(() => (handlers as Handler[]).pop(), TypeError);
      assertEquals(registry.has("registered"), true);
      assertEquals(registry.getHandlers().length, 1);
    });
  });

  describe("clear()", () => {
    it("should remove all handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.clear();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.clear();
      assertEquals(result, registry);
    });
  });

  describe("remove()", () => {
    it("should remove handler by name", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.remove("a");
      assertEquals(registry.has("a"), false);
      assertEquals(registry.has("b"), true);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.remove("nonexistent");
      assertEquals(result, registry);
    });

    it("prevents registration reentered from a live-name getter", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      const nested = makeHandler("nested", 50);
      registry.register(existing);
      Object.defineProperty(existing.metadata, "name", {
        configurable: true,
        get() {
          registry.register(nested);
          return "existing";
        },
      });

      assertEquals(registry.remove("existing"), registry);
      assertEquals(registry.getHandlers(), []);
      assertEquals(registry.has("nested"), false);
    });
  });

  describe("has()", () => {
    it("should return true for existing handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should return false for non-existing handler", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.has("nonexistent"), false);
    });
  });

  describe("getStats()", () => {
    it("should return correct statistics", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 100));
      registry.register(makeHandler("c", 500));

      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 3);
      assertEquals(stats.handlerNames, ["a", "b", "c"]);
      assertEquals(stats.handlersByPriority["100"], 2);
      assertEquals(stats.handlersByPriority["500"], 1);
    });

    it("keeps names live while priorities follow the last coherent registration", () => {
      const registry = new RouteRegistry();
      const handler = makeHandler("before", 100);
      registry.register(handler);

      handler.metadata.name = "after";
      handler.metadata.priority = 500;

      assertEquals(registry.has("before"), false);
      assertEquals(registry.has("after"), true);
      assertEquals(registry.getStats(), {
        totalHandlers: 1,
        handlerNames: ["after"],
        handlersByPriority: { "100": 1 },
      });

      registry.register(makeHandler("refresh", 1000));
      assertEquals(registry.getStats(), {
        totalHandlers: 2,
        handlerNames: ["after", "refresh"],
        handlersByPriority: { "500": 1, "1000": 1 },
      });
      registry.remove("after");
      assertEquals(
        registry.getHandlers().map((registered) => registered.metadata.name),
        ["refresh"],
      );
    });

    it("derives a coherent result from one handler-array snapshot", () => {
      const registry = new RouteRegistry();
      const existing = makeHandler("existing", 100);
      const nested = makeHandler("nested", 200);
      registry.register(existing);
      let registeredNested = false;
      Object.defineProperty(existing.metadata, "name", {
        configurable: true,
        get() {
          if (!registeredNested) {
            registeredNested = true;
            registry.register(nested);
          }
          return "existing";
        },
      });

      assertEquals(registry.getStats(), {
        totalHandlers: 1,
        handlerNames: ["existing"],
        handlersByPriority: { "100": 1 },
      });
      assertEquals(registry.getHandlers().length, 2);
    });

    it("should return empty stats for empty registry", () => {
      const registry = new RouteRegistry();
      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 0);
      assertEquals(stats.handlerNames, []);
      assertEquals(stats.handlersByPriority, {});
    });
  });
});
