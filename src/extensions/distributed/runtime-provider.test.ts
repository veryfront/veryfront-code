import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureDistributedCacheAdministration,
  captureDistributedRuntimeProvider,
  captureDistributedWorkflowWorkerEnvironment,
} from "./runtime-provider.ts";

function createProvider(workflowBackend: object = {}) {
  return {
    id: "test-distributed-provider",
    createCacheBackend: () => Promise.resolve({}),
    createRenderCacheStore: () => ({}),
    createWorkflowBackend: () => workflowBackend,
    getWorkflowWorkerEnvironment: () => ({}),
    createRateLimitStore: () => ({}),
    createAgentMemory: () => ({}),
    createEventPublisher: () => ({}),
    startRoutingInvalidationBus: () => Promise.resolve({}),
    getCacheAdministration: () => ({}),
  };
}

describe("distributed runtime provider boundary", () => {
  it("captures and freezes the complete callable surface", () => {
    const backend = {};
    const provider = createProvider(backend);
    const captured = captureDistributedRuntimeProvider(provider);
    provider.createWorkflowBackend = () => {
      throw new Error("mutated implementation must not run");
    };

    assertEquals(Object.isFrozen(captured), true);
    assertEquals(captured.id, "test-distributed-provider");
    assertStrictEquals(captured.createWorkflowBackend({}), backend);
  });

  it("rejects incomplete, surprising, and non-canonical provider objects", () => {
    const incomplete = createProvider();
    delete (incomplete as Partial<typeof incomplete>).createCacheBackend;
    assertThrows(
      () => captureDistributedRuntimeProvider(incomplete),
      TypeError,
      "createCacheBackend",
    );

    assertThrows(
      () => captureDistributedRuntimeProvider({ ...createProvider(), extra: true }),
      TypeError,
      "unexpected property",
    );
    assertThrows(
      () => captureDistributedRuntimeProvider({ ...createProvider(), id: " padded " }),
      TypeError,
      "bounded canonical string",
    );
  });

  it("does not invoke accessors while inspecting a provider", () => {
    let reads = 0;
    const provider = createProvider();
    Object.defineProperty(provider, "createCacheBackend", {
      enumerable: true,
      get() {
        reads++;
        return () => Promise.resolve({});
      },
    });

    assertThrows(
      () => captureDistributedRuntimeProvider(provider),
      TypeError,
      "enumerable own data property",
    );
    assertEquals(reads, 0);
  });

  it("captures cache administration without retaining mutable dispatch", async () => {
    const administration = {
      isConfigured: () => true,
      listKeys: () => Promise.resolve({ keys: ["vf:cache:render:project"], truncated: false }),
      deleteKeys: () => Promise.resolve(1),
    };
    const captured = captureDistributedCacheAdministration(administration);
    administration.listKeys = () => Promise.reject(new Error("mutated"));
    administration.deleteKeys = () => Promise.reject(new Error("mutated"));

    assertEquals(captured.isConfigured(), true);
    assertEquals(
      await captured.listKeys({ prefix: "vf:cache:render:", limit: 1 }),
      { keys: ["vf:cache:render:project"], truncated: false },
    );
    assertEquals(await captured.deleteKeys(["vf:cache:render:project"]), 1);
    assertThrows(
      () =>
        captureDistributedCacheAdministration({
          ...administration,
          unexpected: true,
        }),
      TypeError,
      "only isConfigured, listKeys, and deleteKeys",
    );
  });

  it("captures a bounded worker environment and reserves execution identity", () => {
    const environment = { DISTRIBUTED_STORE_URL: "protocol://store.internal" };
    const captured = captureDistributedWorkflowWorkerEnvironment(environment);
    environment.DISTRIBUTED_STORE_URL = "mutated";

    assertEquals(captured, { DISTRIBUTED_STORE_URL: "protocol://store.internal" });
    assertEquals(Object.isFrozen(captured), true);
    assertThrows(
      () => captureDistributedWorkflowWorkerEnvironment({ WORKFLOW_RUN_ID: "forged" }),
      TypeError,
      "cannot set WORKFLOW_RUN_ID",
    );
    assertThrows(
      () => captureDistributedWorkflowWorkerEnvironment({ PROVIDER_TOKEN: "bad\0value" }),
      TypeError,
      "NUL-free string",
    );
  });

  it("fails closed on out-of-scope cache administration results", async () => {
    const captured = captureDistributedCacheAdministration({
      isConfigured: () => true,
      listKeys: () => ({ keys: ["another:namespace:key"], truncated: false }),
      deleteKeys: () => 2,
    });

    await assertRejects(
      () => captured.listKeys({ prefix: "vf:cache:", limit: 1 }),
      TypeError,
      "outside the request",
    );
    await assertRejects(
      () => captured.deleteKeys(["vf:cache:key"]),
      TypeError,
      "invalid deletion count",
    );
    await assertRejects(
      () => captured.deleteKeys(["vf:cache:key", "vf:cache:key"]),
      TypeError,
      "duplicate keys",
    );
  });
});
