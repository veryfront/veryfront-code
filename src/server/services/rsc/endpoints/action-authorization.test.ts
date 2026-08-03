import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  type RscActionAuthorizationProvider,
  RscActionAuthorizationProviderName,
} from "#veryfront/extensions/auth/index.ts";
import {
  beginContractGeneration,
  commitContractGeneration,
  completeContractGenerationRetirement,
  drainContractGeneration,
  resetContractRegistry,
  sealContractGeneration,
  stageContract,
} from "#veryfront/extensions/contract-registry-internal.ts";
import { register } from "#veryfront/extensions/contracts.ts";
import {
  type ActionModuleLoader,
  handleActionRequest,
  handleActionRequestWithAuthorizationProvider,
  handleActionRequestWithRegisteredAuthorizationForTesting,
} from "./action-handler.ts";

const actionPath = "/virtual/project/app/actions/save.ts";

function createAdapter(counters: { stats: number; reads: number }): RuntimeAdapter {
  return {
    id: "rsc-authorization-test",
    name: "rsc-authorization-test",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: (path: string) => {
        counters.reads++;
        return path === actionPath
          ? Promise.resolve("export default async function save() {}")
          : Promise.reject(new Deno.errors.NotFound("not found"));
      },
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: (path: string) => {
        counters.stats++;
        return path === actionPath
          ? Promise.resolve({
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            size: 1,
            mtime: null,
            atime: null,
            birthtime: null,
            dev: null,
            ino: null,
            mode: null,
            nlink: null,
            uid: null,
            gid: null,
            rdev: null,
            blksize: null,
            blocks: null,
          })
          : Promise.reject(new Deno.errors.NotFound("not found"));
      },
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as never),
  } as unknown as RuntimeAdapter;
}

function request(args: unknown[] = []): Request {
  return new Request("https://example.test/_veryfront/rsc/action", {
    method: "POST",
    headers: {
      authorization: "Bearer request-token",
      cookie: "session=application-cookie",
      "content-type": "application/json",
      "proxy-authorization": "Basic infrastructure-proxy-token",
      "x-forwarded-host": "internal-proxy.example",
      "x-project-id": "infrastructure-project",
      "x-token": "platform-service-token",
      "x-veryfront-control-plane-jws": "signed-control-plane-request",
    },
    body: JSON.stringify({ id: "save", args }),
  });
}

function params(counters: { stats: number; reads: number }, args: unknown[] = []) {
  return {
    req: request(args),
    projectDir: "/virtual/project",
    projectId: "project-id",
    projectSlug: "project-slug",
    contentSourceId: "release:one",
    releaseId: "release-one",
    branch: "preview-branch",
    isLocalProject: false,
    adapter: createAdapter(counters),
    config: { react: { version: "19.2.4" } },
    mode: "production" as const,
  };
}

const moduleLoader: ActionModuleLoader = () =>
  Promise.resolve({
    default: async (value: unknown) => value,
  });

describe("RSC action authorization provider", () => {
  afterEach(() => {
    resetContractRegistry();
  });

  it("fails closed before action lookup when no provider is available", async () => {
    const counters = { stats: 0, reads: 0 };
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      undefined,
      moduleLoader,
    );

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(await response.json(), {
      ok: false,
      error: "action authorization unavailable",
    });
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("rejects non-finite nested arguments before provider or action admission", async () => {
    const counters = { stats: 0, reads: 0 };
    let providerCalls = 0;
    const actionParams = params(counters);
    actionParams.req = new Request("https://example.test/_veryfront/rsc/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"save","args":[1e400]}',
    });

    const response = await handleActionRequestWithAuthorizationProvider(
      actionParams,
      {
        authorize: () => {
          providerCalls++;
          return true;
        },
      },
      moduleLoader,
    );

    assertEquals(response.status, 400);
    assertEquals(providerCalls, 0);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("rejects ownerless public registrations instead of granting an unleased bypass", async () => {
    const counters = { stats: 0, reads: 0 };
    register(RscActionAuthorizationProviderName, { authorize: () => true });

    const response = await handleActionRequest(params(counters));

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("returns 403 before action lookup when authorization is denied", async () => {
    const counters = { stats: 0, reads: 0 };
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      { authorize: () => false },
      moduleLoader,
    );

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(await response.json(), { ok: false, error: "unauthorized" });
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("passes detached action input and project identity to the provider", async () => {
    const counters = { stats: 0, reads: 0 };
    const original = { role: "user" };
    let observedHasBody = true;
    let observedAuthorization: string | undefined;
    let observedHeaders: Readonly<Record<string, string | undefined>> | undefined;
    let observedProject: unknown;
    let observedSameSignal = true;
    let providerMutationSucceeded = true;
    const actionParams = params(counters, [original]);
    const originalSignal = actionParams.req.signal;
    const provider: RscActionAuthorizationProvider = {
      authorize(providerRequest, context) {
        observedHasBody = Object.hasOwn(providerRequest, "body");
        observedAuthorization = providerRequest.headers.authorization;
        observedHeaders = providerRequest.headers;
        observedSameSignal = providerRequest.signal === originalSignal;
        observedProject = {
          projectId: context.projectId,
          projectSlug: context.projectSlug,
          contentSourceId: context.contentSourceId,
          releaseId: context.releaseId,
          branch: context.branch,
          isLocalProject: context.isLocalProject,
          mode: context.mode,
        };
        providerMutationSucceeded = Reflect.set(
          context.args[0] as object,
          "role",
          "admin",
        );
        return true;
      },
    };

    const response = await handleActionRequestWithAuthorizationProvider(
      actionParams,
      provider,
      moduleLoader,
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(await response.json(), { ok: true, result: original });
    assertEquals(observedHasBody, false);
    assertEquals(observedAuthorization, "Bearer request-token");
    assertEquals(observedHeaders, {
      authorization: "Bearer request-token",
      "content-type": "application/json",
      cookie: "session=application-cookie",
    });
    assertEquals(observedSameSignal, false);
    assertEquals(providerMutationSucceeded, false);
    assertEquals(observedProject, {
      projectId: "project-id",
      projectSlug: "project-slug",
      contentSourceId: "release:one",
      releaseId: "release-one",
      branch: "preview-branch",
      isLocalProject: false,
      mode: "production",
    });
  });

  it("uses captured request and snapshot primordials after shared-realm poisoning", async () => {
    const counters = { stats: 0, reads: 0 };
    const original = { role: "user" };
    const actionParams = params(counters, [original]);
    const globals = [
      [globalThis, "Request"],
      [globalThis, "Headers"],
      [globalThis, "WeakSet"],
      [Object, "freeze"],
    ] as const;
    const descriptors = globals.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key));
    let response: Response | undefined;
    try {
      Object.defineProperty(globalThis, "Request", {
        configurable: true,
        value: class PoisonedRequest {
          constructor() {
            throw new Error("live Request constructor used");
          }
        },
        writable: true,
      });
      Object.defineProperty(globalThis, "Headers", {
        configurable: true,
        value: class PoisonedHeaders {
          constructor() {
            throw new Error("live Headers constructor used");
          }
        },
        writable: true,
      });
      Object.defineProperty(globalThis, "WeakSet", {
        configurable: true,
        value: class PoisonedWeakSet {
          constructor() {
            throw new Error("live WeakSet constructor used");
          }
        },
        writable: true,
      });
      Object.defineProperty(Object, "freeze", {
        configurable: true,
        value: <T>(value: T): T => value,
        writable: true,
      });

      response = await handleActionRequestWithAuthorizationProvider(
        actionParams,
        {
          authorize: (_request, context) => {
            Reflect.set(context.args[0] as object, "role", "admin");
            return true;
          },
        } satisfies RscActionAuthorizationProvider,
        moduleLoader,
      );
    } finally {
      globals.forEach(([owner, key], index) => {
        const descriptor = descriptors[index];
        if (descriptor !== undefined) Object.defineProperty(owner, key, descriptor);
      });
    }

    assertEquals(response?.status, 200);
    assertEquals(await response?.json(), { ok: true, result: original });
  });

  it("copies authentic request headers without live getters or iterators", async () => {
    const counters = { stats: 0, reads: 0 };
    const actionParams = params(counters);
    const attackerHeaders = new Headers({
      authorization: "Bearer admin",
      "content-type": "application/json",
    });
    const headersDescriptor = Object.getOwnPropertyDescriptor(
      Request.prototype,
      "headers",
    );
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Headers.prototype,
      Symbol.iterator,
    );
    const getDescriptor = Object.getOwnPropertyDescriptor(
      Headers.prototype,
      "get",
    );
    let response: Response | undefined;
    try {
      Object.defineProperty(Request.prototype, "headers", {
        configurable: true,
        get: () => attackerHeaders,
      });
      Object.defineProperty(Headers.prototype, Symbol.iterator, {
        configurable: true,
        value: function* () {
          yield ["authorization", "Bearer admin"];
        },
        writable: true,
      });
      Object.defineProperty(Headers.prototype, "get", {
        configurable: true,
        value: (name: string) => name.toLowerCase() === "authorization" ? "Bearer admin" : null,
        writable: true,
      });

      response = await handleActionRequestWithAuthorizationProvider(
        actionParams,
        {
          authorize: (providerRequest) => providerRequest.headers.authorization === "Bearer admin",
        } satisfies RscActionAuthorizationProvider,
        moduleLoader,
      );
    } finally {
      if (headersDescriptor !== undefined) {
        Object.defineProperty(Request.prototype, "headers", headersDescriptor);
      }
      if (iteratorDescriptor !== undefined) {
        Object.defineProperty(Headers.prototype, Symbol.iterator, iteratorDescriptor);
      }
      if (getDescriptor !== undefined) {
        Object.defineProperty(Headers.prototype, "get", getDescriptor);
      }
    }

    assertEquals(response?.status, 403);
  });

  it("emits a denial after the provider poisons live response primordials", async () => {
    const counters = { stats: 0, reads: 0 };
    const targets = [
      [globalThis, "Response"],
      [globalThis, "Headers"],
      [JSON, "stringify"],
      [Response.prototype, "headers"],
      [Headers.prototype, "get"],
      [Headers.prototype, "set"],
      [String.prototype, "split"],
      [String.prototype, "trim"],
      [String.prototype, "toLowerCase"],
    ] as const;
    const descriptors = targets.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key));
    let response: Response | undefined;
    try {
      response = await handleActionRequestWithAuthorizationProvider(
        params(counters),
        {
          authorize: () => {
            for (const [owner, key] of targets) {
              Object.defineProperty(owner, key, {
                configurable: true,
                value: () => {
                  throw new Error(`live ${String(key)} used`);
                },
                writable: true,
              });
            }
            return false;
          },
        },
        moduleLoader,
      );
    } finally {
      targets.forEach(([owner, key], index) => {
        const descriptor = descriptors[index];
        if (descriptor !== undefined) Object.defineProperty(owner, key, descriptor);
      });
    }

    assertEquals(response?.status, 403);
    assertEquals(await response?.json(), { ok: false, error: "unauthorized" });
  });

  it("shadows inherited project identity with own undefined fields", async () => {
    const counters = { stats: 0, reads: 0 };
    const originalProjectId = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "projectId",
    );
    let response: Response | undefined;
    Object.defineProperty(Object.prototype, "projectId", {
      configurable: true,
      value: "admin-project",
    });
    try {
      response = await handleActionRequestWithAuthorizationProvider(
        { ...params(counters), projectId: undefined },
        {
          authorize: (_request, context) => context.projectId === "admin-project",
        } satisfies RscActionAuthorizationProvider,
        moduleLoader,
      );
    } finally {
      if (originalProjectId === undefined) {
        Reflect.deleteProperty(Object.prototype, "projectId");
      } else {
        Object.defineProperty(Object.prototype, "projectId", originalProjectId);
      }
    }

    assertEquals(response?.status, 403);
  });

  it("does not turn inherited nested argument fields into authorization data", async () => {
    const counters = { stats: 0, reads: 0 };
    const originalRole = Object.getOwnPropertyDescriptor(Object.prototype, "role");
    Object.defineProperty(Object.prototype, "role", {
      configurable: true,
      value: "admin",
    });
    let response: Response | undefined;
    try {
      response = await handleActionRequestWithAuthorizationProvider(
        params(counters, [{}]),
        {
          authorize: (_request, context) =>
            (context.args[0] as { readonly role?: string }).role === "admin",
        } satisfies RscActionAuthorizationProvider,
        moduleLoader,
      );
    } finally {
      if (originalRole === undefined) Reflect.deleteProperty(Object.prototype, "role");
      else Object.defineProperty(Object.prototype, "role", originalRole);
    }

    assertEquals(response?.status, 403);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("does not consult a poisoned ArrayIteratorPrototype during provider iteration", async () => {
    const counters = { stats: 0, reads: 0 };
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters, [{ role: "user" }]),
      {
        authorize: (_request, context) => {
          const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
          const originalNext = Object.getOwnPropertyDescriptor(iteratorPrototype, "next")!;
          const nativeNext = originalNext.value as () => IteratorResult<unknown>;
          Object.defineProperty(iteratorPrototype, "next", {
            ...originalNext,
            value(this: object) {
              const result = Reflect.apply(nativeNext, this, []) as IteratorResult<unknown>;
              if (
                !result.done && typeof result.value === "object" && result.value !== null &&
                (result.value as { role?: string }).role === "user"
              ) {
                return { done: false, value: { role: "admin" } };
              }
              return result;
            },
          });
          try {
            for (const arg of context.args) {
              if ((arg as { readonly role?: string }).role === "admin") return true;
            }
            return false;
          } finally {
            Object.defineProperty(iteratorPrototype, "next", originalNext);
          }
        },
      } satisfies RscActionAuthorizationProvider,
      moduleLoader,
    );

    assertEquals(response.status, 403);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("does not pass inherited request fields into the invoked action", async () => {
    const counters = { stats: 0, reads: 0 };
    const originalRole = Object.getOwnPropertyDescriptor(Object.prototype, "role");
    Object.defineProperty(Object.prototype, "role", {
      configurable: true,
      value: "admin",
    });
    let response: Response | undefined;
    try {
      response = await handleActionRequestWithAuthorizationProvider(
        params(counters, [{}]),
        { authorize: () => true },
        () =>
          Promise.resolve({
            default: async (value: unknown) =>
              (value as { readonly role?: string }).role === "admin",
          }),
      );
    } finally {
      if (originalRole === undefined) Reflect.deleteProperty(Object.prototype, "role");
      else Object.defineProperty(Object.prototype, "role", originalRole);
    }

    assertEquals(response?.status, 200);
    assertEquals(await response?.json(), { ok: true, result: false });
  });

  it("fails closed on non-boolean provider results", async () => {
    const counters = { stats: 0, reads: 0 };
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      { authorize: () => "allow" as unknown as boolean },
      moduleLoader,
    );

    assertEquals(response.status, 503);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("fails closed when the provider rejects", async () => {
    const counters = { stats: 0, reads: 0 };
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      { authorize: () => Promise.reject(new Error("provider unavailable")) },
      moduleLoader,
    );

    assertEquals(response.status, 503);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("observes provider promises without invoking a configurable constructor hook", async () => {
    const counters = { stats: 0, reads: 0 };
    const decision = Promise.resolve(true);
    let constructorGetterCalls = 0;
    Object.defineProperty(decision, "constructor", {
      configurable: true,
      get() {
        constructorGetterCalls++;
        throw new Error("constructor hook invoked");
      },
    });

    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      { authorize: () => decision },
      moduleLoader,
    );

    assertEquals(response.status, 200);
    assertEquals(constructorGetterCalls, 0);
  });

  it("accepts a frozen native provider promise and releases its generation lease", async () => {
    const counters = { stats: 0, reads: 0 };
    const decision = Object.freeze(Promise.resolve(true));
    const generation = beginContractGeneration();
    stageContract(generation, RscActionAuthorizationProviderName, {
      authorize: () => decision,
    });
    commitContractGeneration(generation);

    const response = await handleActionRequestWithRegisteredAuthorizationForTesting(
      params(counters),
      { timeoutMs: 1_000, terminationGraceMs: 100 },
      moduleLoader,
    );

    assertEquals(response.status, 200);
    sealContractGeneration(generation);
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("fails closed without invoking an unshadowable promise constructor hook", async () => {
    const counters = { stats: 0, reads: 0 };
    const decision = Promise.resolve(true);
    let constructorGetterCalls = 0;
    Object.defineProperty(decision, "constructor", {
      configurable: false,
      get() {
        constructorGetterCalls++;
        throw new Error("constructor hook invoked");
      },
    });

    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      { authorize: () => decision },
      moduleLoader,
    );

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(constructorGetterCalls, 0);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("holds the generation lease until an in-flight authorization settles", async () => {
    const counters = { stats: 0, reads: 0 };
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settleDecision: ((decision: boolean) => void) | undefined;
    const decision = new Promise<boolean>((resolve) => {
      settleDecision = resolve;
    });
    let authorizationSignal: AbortSignal | undefined;
    const generation = beginContractGeneration();
    stageContract(
      generation,
      RscActionAuthorizationProviderName,
      {
        authorize: (request) => {
          authorizationSignal = request.signal;
          markStarted?.();
          return decision;
        },
      } satisfies RscActionAuthorizationProvider,
    );
    commitContractGeneration(generation);

    const responsePromise = handleActionRequest(params(counters));
    await started;
    sealContractGeneration(generation);
    let drainSettled = false;
    const drainPromise = drainContractGeneration(generation).then(() => {
      drainSettled = true;
    });
    await Promise.resolve();
    assertEquals(drainSettled, false);
    assertEquals(authorizationSignal?.aborted, true);

    settleDecision?.(false);
    const response = await responsePromise;
    assertEquals(response.status, 503);
    await drainPromise;
    assertEquals(drainSettled, true);
    completeContractGenerationRetirement(generation);
  });

  it("aborts a cooperative provider at the authorization deadline", async () => {
    const counters = { stats: 0, reads: 0 };
    let authorizationSignal: AbortSignal | undefined;
    const response = await handleActionRequestWithAuthorizationProvider(
      params(counters),
      {
        authorize: (request) => {
          authorizationSignal = request.signal;
          return new Promise<boolean>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("authorization cancelled")),
              { once: true },
            );
          });
        },
      } satisfies RscActionAuthorizationProvider,
      moduleLoader,
      { timeoutMs: 5, terminationGraceMs: 100 },
    );

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(authorizationSignal?.aborted, true);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("propagates source request cancellation to the provider signal", async () => {
    const counters = { stats: 0, reads: 0 };
    const sourceController = new AbortController();
    const actionParams = params(counters);
    actionParams.req = new Request("https://example.test/_veryfront/rsc/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "save", args: [] }),
      signal: sourceController.signal,
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let authorizationSignal: AbortSignal | undefined;

    const responsePromise = handleActionRequestWithAuthorizationProvider(
      actionParams,
      {
        authorize: (request) => {
          authorizationSignal = request.signal;
          markStarted?.();
          return new Promise<boolean>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("source request cancelled")),
              { once: true },
            );
          });
        },
      } satisfies RscActionAuthorizationProvider,
      moduleLoader,
      { timeoutMs: 1_000, terminationGraceMs: 100 },
    );
    await started;
    sourceController.abort(new Error("client disconnected"));
    const response = await responsePromise;

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(authorizationSignal?.aborted, true);
    assertEquals(counters, { stats: 0, reads: 0 });
  });

  it("quarantines a generation when a provider ignores cancellation grace", async () => {
    const counters = { stats: 0, reads: 0 };
    const generation = beginContractGeneration();
    stageContract(generation, RscActionAuthorizationProviderName, {
      authorize: () => new Promise<boolean>(() => {}),
    });
    commitContractGeneration(generation);

    const response = await handleActionRequestWithRegisteredAuthorizationForTesting(
      params(counters),
      { timeoutMs: 5, terminationGraceMs: 5 },
      moduleLoader,
    );

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(counters, { stats: 0, reads: 0 });
    await assertRejects(
      () => drainContractGeneration(generation),
      Error,
      "quarantined",
    );
  });

  it("releases a quarantined lease when the provider settles after grace", async () => {
    const counters = { stats: 0, reads: 0 };
    let settleDecision: ((value: boolean) => void) | undefined;
    const decision = new Promise<boolean>((resolve) => {
      settleDecision = resolve;
    });
    const generation = beginContractGeneration();
    stageContract(generation, RscActionAuthorizationProviderName, {
      authorize: () => decision,
    });
    commitContractGeneration(generation);

    const response = await handleActionRequestWithRegisteredAuthorizationForTesting(
      params(counters),
      { timeoutMs: 5, terminationGraceMs: 5 },
      moduleLoader,
    );
    assertEquals(response.status, 503);
    await assertRejects(
      () => drainContractGeneration(generation),
      Error,
      "quarantined",
    );

    settleDecision?.(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("rejects new authorization admission after its generation is sealed", async () => {
    const counters = { stats: 0, reads: 0 };
    const generation = beginContractGeneration();
    stageContract(generation, RscActionAuthorizationProviderName, {
      authorize: () => true,
    });
    commitContractGeneration(generation);
    sealContractGeneration(generation);

    const response = await handleActionRequest(params(counters));

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(counters, { stats: 0, reads: 0 });
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("quarantines a generation when its provider promise cannot be observed safely", async () => {
    const counters = { stats: 0, reads: 0 };
    const decision = Promise.resolve(true);
    let constructorGetterCalls = 0;
    Object.defineProperty(decision, "constructor", {
      configurable: false,
      get() {
        constructorGetterCalls++;
        throw new Error("constructor hook invoked");
      },
    });
    const generation = beginContractGeneration();
    stageContract(generation, RscActionAuthorizationProviderName, {
      authorize: () => decision,
    });
    commitContractGeneration(generation);

    const response = await handleActionRequest(params(counters));

    assertEquals(response.status, 503);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(constructorGetterCalls, 0);
    assertEquals(counters, { stats: 0, reads: 0 });
    await assertRejects(
      () => drainContractGeneration(generation),
      Error,
      "quarantined",
    );
  });
});
