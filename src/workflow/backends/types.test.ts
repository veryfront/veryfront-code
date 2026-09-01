import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { BackendConfig, RedisBackendConfig } from "#veryfront/workflow";
import {
  hasEventWaitSupport,
  hasTerminalRunRetentionSupport,
  type WorkflowBackend,
} from "./types.ts";
import { MemoryBackend } from "./memory.ts";

describe("workflow backend public config types", () => {
  it("retains defaultTtl as a deprecated public BackendConfig no-op", () => {
    const backendConfig = {
      defaultTtl: 30,
    } satisfies BackendConfig;
    const redisConfig = {
      defaultTtl: 30,
      runTtl: 60,
    } satisfies RedisBackendConfig;

    assertEquals(backendConfig.defaultTtl, 30);
    assertEquals(redisConfig.defaultTtl, 30);
  });
});

describe("hasEventWaitSupport", () => {
  it("accepts a backend that implements the whole durable event-wait group", () => {
    assertEquals(
      hasEventWaitSupport(new MemoryBackend()),
      true,
      "the built-in memory backend implements durable event waits",
    );
  });

  it("rejects a backend missing any one method of the group", () => {
    for (
      const missing of [
        "savePendingEventWait",
        "getPendingEventWaits",
        "listPendingEventWaits",
        "resolvePendingEventWait",
        "restorePendingEventWait",
        "listTimedEventWaitClaims",
        "reserveTimedEventWaitClaim",
        "finalizeTimedEventWaitClaim",
        "appendRunEvent",
        "removeRunEvent",
        "peekRunEvent",
        "takeRunEvent",
        "claimRunEventForWait",
        "listRunEventDeliveryClaims",
        "reserveRunEventDeliveryClaim",
        "restoreRunEvent",
        "restoreRunEventDelivery",
        "finalizeRunEventDelivery",
        "hasRunEventDeliveryReceipt",
        "updateRunIfStatus",
      ] as const
    ) {
      const partial = new MemoryBackend() as unknown as Record<string, unknown>;
      partial[missing] = undefined;
      assertEquals(
        hasEventWaitSupport(partial as unknown as WorkflowBackend),
        false,
        `a backend without ${missing} cannot wake a parked run and must not claim support`,
      );
    }
  });

  it("requires atomic key-merge run patches", () => {
    const replacementBackend = new MemoryBackend() as unknown as Record<string, unknown>;
    replacementBackend["supportsRunPatchKeyMerge"] = false;
    assertEquals(
      hasEventWaitSupport(replacementBackend as unknown as WorkflowBackend),
      false,
      "replacement-map updates cannot safely merge concurrent durable event outcomes",
    );
  });

  it("requires renewable distributed locking for cross-instance resumes", () => {
    for (const missing of ["acquireLock", "releaseLock", "extendLock"] as const) {
      const unserialized = new MemoryBackend() as unknown as Record<string, unknown>;
      unserialized[missing] = undefined;
      assertEquals(
        hasEventWaitSupport(unserialized as unknown as WorkflowBackend),
        false,
        `a backend without ${missing} cannot serialize concurrent event resumes`,
      );
    }
  });

  it("requires the worker-owned save when the backend supports execution ownership", () => {
    // A worker-capable backend assigns every run a workerId, and persisting a
    // wait for an owned run goes through the owner-fenced append. Without it,
    // every createEventWait would throw after this guard reported support.
    const ownershipWithoutOwnedSave = new MemoryBackend() as unknown as Record<string, unknown>;
    ownershipWithoutOwnedSave["savePendingEventWaitIfStatusAndWorker"] = undefined;
    assertEquals(
      hasEventWaitSupport(ownershipWithoutOwnedSave as unknown as WorkflowBackend),
      false,
      "a worker-capable backend without the owner-fenced wait append would park " +
        "runs whose waits can never be persisted",
    );

    // The executor ownership gate intentionally needs fewer methods than a
    // full queue worker. Event support must use that exact gate or a custom
    // direct executor can assign workerId without requiring the fenced append.
    const directExecutor = new MemoryBackend() as unknown as Record<string, unknown>;
    directExecutor["savePendingEventWaitIfStatusAndWorker"] = undefined;
    for (
      const workerOnlyMethod of [
        "enqueue",
        "dequeue",
        "acknowledge",
        "findStalledRuns",
        "claimStalledRun",
      ]
    ) {
      directExecutor[workerOnlyMethod] = undefined;
    }
    assertEquals(
      hasEventWaitSupport(directExecutor as unknown as WorkflowBackend),
      false,
      "execution ownership without the fenced wait append is unsupported even without a queue",
    );

    // A locked backend with no execution ownership at all never assigns a
    // workerId, so the plain append suffices and the owned variant stays
    // optional.
    const ownerless = new MemoryBackend() as unknown as Record<string, unknown>;
    ownerless["savePendingEventWaitIfStatusAndWorker"] = undefined;
    for (
      const workerMethod of [
        "enqueue",
        "dequeue",
        "acknowledge",
        "findStalledRuns",
        "claimStalledRun",
        "updateRunIfStatusAndWorker",
        "saveCheckpointIfStatusAndWorker",
        "savePendingApprovalIfStatusAndWorker",
      ]
    ) {
      ownerless[workerMethod] = undefined;
    }
    assertEquals(
      hasEventWaitSupport(ownerless as unknown as WorkflowBackend),
      true,
      "an ownerless backend persists waits through the plain append and may " +
        "omit the owner-fenced variant",
    );
  });
});

describe("hasTerminalRunRetentionSupport", () => {
  it("requires the atomic terminal deletion capability", () => {
    const backend = new MemoryBackend();
    assertEquals(hasTerminalRunRetentionSupport(backend), true);

    Object.defineProperty(backend, "deleteTerminalRunIfUnchanged", { value: undefined });
    assertEquals(hasTerminalRunRetentionSupport(backend), false);
  });
});
