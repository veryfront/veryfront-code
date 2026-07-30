import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";
import { MemoryBackend } from "./memory.ts";
import { createDistributedWorkflowWorkerResources } from "./distributed.ts";

function createProvider(
  backend: MemoryBackend,
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
  it("captures provider environment without retaining mutable dispatch", async () => {
    const backend = new MemoryBackend();
    const source = { DISTRIBUTED_STORE_URL: "protocol://store.internal" };
    await withProvider(createProvider(backend, () => source), async () => {
      const resources = await createDistributedWorkflowWorkerResources({ debug: true });
      source.DISTRIBUTED_STORE_URL = "mutated";

      assertStrictEquals(resources.backend, backend);
      assertEquals(resources.environment, {
        DISTRIBUTED_STORE_URL: "protocol://store.internal",
      });
      assertEquals(Object.isFrozen(resources), true);
      assertEquals(Object.isFrozen(resources.environment), true);
      await backend.destroy();
    });
  });

  it("destroys a constructed backend when worker environment validation fails", async () => {
    const backend = new MemoryBackend();
    let destroyCalls = 0;
    backend.destroy = () => {
      destroyCalls++;
      return Promise.resolve();
    };

    await withProvider(
      createProvider(backend, () => ({ WORKFLOW_RUN_ID: "forged" })),
      async () => {
        await assertRejects(
          () => createDistributedWorkflowWorkerResources({}),
          TypeError,
          "cannot set WORKFLOW_RUN_ID",
        );
      },
    );
    assertEquals(destroyCalls, 1);
  });
});
