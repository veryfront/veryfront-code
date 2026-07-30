import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import { MemoryBackend } from "./memory.ts";
import {
  createDistributedWorkflowBackend,
  createDistributedWorkflowWorkerResources,
} from "./distributed.ts";
import type { WorkflowBackend } from "./types.ts";

function createProvider(
  backend: unknown,
  environment: () => Record<string, string>,
): DistributedRuntimeProvider {
  const unavailable = () => {
    throw new Error("not used by this test");
  };
  return {
    id: "test-workflow-provider",
    createCacheBackend: unavailable,
    createRenderCacheStore: unavailable,
    createWorkflowBackend: () => backend,
    getWorkflowWorkerEnvironment: environment,
    createRateLimitStore: unavailable,
    createAgentMemory: unavailable,
    createEventPublisher: unavailable,
    startRoutingInvalidationBus: unavailable,
    getCacheAdministration: unavailable,
  } as unknown as DistributedRuntimeProvider;
}

async function withProvider(
  provider: DistributedRuntimeProvider,
  run: () => Promise<void>,
): Promise<void> {
  const previous = tryResolve<DistributedRuntimeProvider>(DistributedRuntimeProviderName);
  register(DistributedRuntimeProviderName, provider);
  try {
    await run();
  } finally {
    unregister(DistributedRuntimeProviderName);
    if (previous !== undefined) register(DistributedRuntimeProviderName, previous);
  }
}

describe("distributed workflow worker resources", () => {
  it("rejects incomplete mandatory and optional backend contracts at the extension boundary", async () => {
    await withProvider(createProvider({}, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "missing required method createRun",
      );
      return Promise.resolve();
    });

    const missingApprovalLookup = new MemoryBackend();
    Object.defineProperty(missingApprovalLookup, "getApproval", { value: undefined });
    await withProvider(createProvider(missingApprovalLookup, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "missing required method getApproval",
      );
      return Promise.resolve();
    });

    const partialLockBackend = new MemoryBackend();
    Object.defineProperty(partialLockBackend, "extendLock", { value: undefined });
    await withProvider(createProvider(partialLockBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "optional capability must implement all of acquireLock, extendLock, releaseLock, updateRunIfStatusAndLock",
      );
      return Promise.resolve();
    });

    const nonCallableBackend = new MemoryBackend();
    Object.defineProperty(nonCallableBackend, "getRun", { value: null });
    await withProvider(createProvider(nonCallableBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "method getRun must be a non-Proxy function",
      );
      return Promise.resolve();
    });
  });

  it("rejects hostile backend surfaces without invoking Proxy or accessor hooks", async () => {
    let proxyTrapCalls = 0;
    const proxyHandler: ProxyHandler<object> = {
      get() {
        proxyTrapCalls++;
        throw new Error("backend get trap must not run");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls++;
        throw new Error("backend descriptor trap must not run");
      },
      getPrototypeOf() {
        proxyTrapCalls++;
        throw new Error("backend prototype trap must not run");
      },
      ownKeys() {
        proxyTrapCalls++;
        throw new Error("backend ownKeys trap must not run");
      },
    };
    const proxiedBackend = new Proxy(new MemoryBackend(), proxyHandler);
    await withProvider(createProvider(proxiedBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "invalid workflow backend",
      );
      return Promise.resolve();
    });

    const proxiedPrototype = new Proxy(MemoryBackend.prototype, proxyHandler);
    const inheritedProxyBackend = Object.create(proxiedPrototype) as WorkflowBackend;
    await withProvider(createProvider(inheritedProxyBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "prototypes must not be Proxies",
      );
      return Promise.resolve();
    });
    assertEquals(proxyTrapCalls, 0);

    let ownGetterCalls = 0;
    const accessorBackend = new MemoryBackend();
    Object.defineProperty(accessorBackend, "getRun", {
      get() {
        ownGetterCalls++;
        throw new Error("backend getter must not run");
      },
    });
    await withProvider(createProvider(accessorBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "property getRun must be a data property",
      );
      return Promise.resolve();
    });
    assertEquals(ownGetterCalls, 0);

    let inheritedGetterCalls = 0;
    const accessorPrototype = Object.create(MemoryBackend.prototype) as object;
    Object.defineProperty(accessorPrototype, "getRun", {
      get() {
        inheritedGetterCalls++;
        throw new Error("inherited backend getter must not run");
      },
    });
    const inheritedAccessorBackend = Object.create(accessorPrototype) as WorkflowBackend;
    await withProvider(createProvider(inheritedAccessorBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "property getRun must be a data property",
      );
      return Promise.resolve();
    });
    assertEquals(inheritedGetterCalls, 0);

    const inheritedStateBackend = Object.create(new MemoryBackend()) as WorkflowBackend;
    await withProvider(createProvider(inheritedStateBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "contains unexpected property runs",
      );
      return Promise.resolve();
    });

    let unknownGetterCalls = 0;
    const unknownAccessorBackend = new MemoryBackend();
    Object.defineProperty(unknownAccessorBackend, "unexpected", {
      enumerable: true,
      get() {
        unknownGetterCalls++;
        throw new Error("unknown getter must not run");
      },
    });
    await withProvider(createProvider(unknownAccessorBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "property unexpected must be a data property",
      );
      return Promise.resolve();
    });
    assertEquals(unknownGetterCalls, 0);

    let methodProxyTrapCalls = 0;
    const proxiedMethodBackend = new MemoryBackend();
    Object.defineProperty(proxiedMethodBackend, "getRun", {
      value: new Proxy(proxiedMethodBackend.getRun, {
        apply() {
          methodProxyTrapCalls++;
          throw new Error("method apply trap must not run");
        },
        get() {
          methodProxyTrapCalls++;
          throw new Error("method get trap must not run");
        },
      }),
    });
    await withProvider(createProvider(proxiedMethodBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "method getRun must be a non-Proxy function",
      );
      return Promise.resolve();
    });
    assertEquals(methodProxyTrapCalls, 0);

    const unknownCallableBackend = new MemoryBackend() as MemoryBackend & {
      unexpected: () => void;
    };
    unknownCallableBackend.unexpected = () => {};
    await withProvider(createProvider(unknownCallableBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "contains unexpected property unexpected",
      );
      return Promise.resolve();
    });
  });

  it("bounds backend surface size and prototype depth", async () => {
    const oversizedBackend = new MemoryBackend() as MemoryBackend & Record<string, unknown>;
    for (let index = 0; index < 300; index++) {
      oversizedBackend[`opaque-${index}`] = index;
    }
    await withProvider(createProvider(oversizedBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "surface cannot contain more than",
      );
      return Promise.resolve();
    });

    let prototype: object = MemoryBackend.prototype;
    for (let depth = 0; depth < 20; depth++) prototype = Object.create(prototype) as object;
    const deepBackend = Object.create(prototype) as WorkflowBackend;
    await withProvider(createProvider(deepBackend, () => ({})), () => {
      assertThrows(
        () => createDistributedWorkflowBackend({}),
        TypeError,
        "prototype chain cannot exceed",
      );
      return Promise.resolve();
    });
  });

  it("returns a frozen stable facade with methods bound to the admitted backend", async () => {
    let originalHealthCalls = 0;
    let replacementHealthCalls = 0;
    const backend = new (class extends MemoryBackend {})();
    const backendPrototype = Object.getPrototypeOf(backend) as object;
    Object.defineProperty(backendPrototype, "healthCheck", {
      configurable: true,
      value: function (this: unknown): Promise<boolean> {
        assertStrictEquals(this, backend);
        originalHealthCalls++;
        return Promise.resolve(true);
      },
    });

    await withProvider(createProvider(backend, () => ({})), async () => {
      const captured = createDistributedWorkflowBackend({});
      const capturedGetRun = captured.getRun;
      const capturedHealthCheck = captured.healthCheck;

      backend.getRun = () => Promise.reject(new Error("replacement getRun must not run"));
      Object.defineProperty(backendPrototype, "healthCheck", {
        configurable: true,
        value: () => {
          replacementHealthCalls++;
          return Promise.resolve(false);
        },
      });

      assertEquals(captured === backend, false);
      assertEquals(Object.getPrototypeOf(captured), null);
      assertEquals(Object.isFrozen(captured), true);
      assertStrictEquals(captured.getRun, capturedGetRun);
      assertStrictEquals(captured.healthCheck, capturedHealthCheck);
      assertEquals(await captured.getRun("missing"), null);
      assertEquals(await captured.healthCheck!(), true);
      assertEquals(originalHealthCalls, 1);
      assertEquals(replacementHealthCalls, 0);
      await captured.destroy();
    });
  });

  it("captures provider environment without retaining mutable dispatch", async () => {
    const backend = new MemoryBackend();
    const source = { DISTRIBUTED_STORE_URL: "protocol://store.internal" };
    await withProvider(createProvider(backend, () => source), async () => {
      const resources = await createDistributedWorkflowWorkerResources({ debug: true });
      source.DISTRIBUTED_STORE_URL = "mutated";

      assertEquals(resources.backend === backend, false);
      assertEquals(Object.isFrozen(resources.backend), true);
      assertEquals(resources.environment, {
        DISTRIBUTED_STORE_URL: "protocol://store.internal",
      });
      assertEquals(Object.isFrozen(resources), true);
      assertEquals(Object.isFrozen(resources.environment), true);
      await resources.backend.destroy();
    });
  });

  it("destroys a constructed backend when worker environment validation fails", async () => {
    const backend = new MemoryBackend();
    let destroyCalls = 0;
    let replacementDestroyCalls = 0;
    backend.destroy = () => {
      destroyCalls++;
      return Promise.resolve();
    };

    await withProvider(
      createProvider(backend, () => {
        backend.destroy = () => {
          replacementDestroyCalls++;
          return Promise.resolve();
        };
        return { WORKFLOW_RUN_ID: "forged" };
      }),
      async () => {
        await assertRejects(
          () => createDistributedWorkflowWorkerResources({}),
          TypeError,
          "cannot set WORKFLOW_RUN_ID",
        );
      },
    );
    assertEquals(destroyCalls, 1);
    assertEquals(replacementDestroyCalls, 0);
  });
});
