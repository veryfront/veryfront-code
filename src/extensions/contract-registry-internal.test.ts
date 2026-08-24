import "#veryfront/schemas/_test-setup.ts";
/**
 * Contract registry lifecycle-state tests.
 *
 * @module extensions/contract-registry-internal.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireContractLease,
  beginContractGeneration,
  commitContractGeneration,
  completeContractGenerationRetirement,
  drainContractGeneration,
  failContractGeneration,
  isContractGenerationDrained,
  registerUnmanagedContract,
  resetContractRegistry,
  runWithContractGenerationEpoch,
  runWithContractGenerationResolution,
  sealContractGeneration,
  stageContract,
  tryResolveRegisteredContract,
  trySnapshotContractForUse,
  trySnapshotGenerationOwnedContractForUse,
} from "./contract-registry-internal.ts";

const createObject = Object.create;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function installInheritedValue(name: string, value: unknown): PropertyDescriptor | undefined {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = true;
  return installInheritedDescriptor(name, descriptor);
}

function installInheritedDescriptor(
  name: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor | undefined {
  const previous = getOwnPropertyDescriptor(Object.prototype, name);
  defineProperty(Object.prototype, name, descriptor);
  return previous;
}

function restoreInheritedValue(
  name: string,
  previous: PropertyDescriptor | undefined,
): void {
  if (previous === undefined) {
    deleteProperty(Object.prototype, name);
    return;
  }
  defineProperty(Object.prototype, name, previous);
}

function createCommittedGeneration(
  name: string,
  implementation: unknown,
) {
  const generation = beginContractGeneration();
  stageContract(generation, name, implementation);
  commitContractGeneration(generation);
  return generation;
}

describe("contract registry lifecycle state", () => {
  afterEach(() => {
    resetContractRegistry();
  });

  it("distinguishes generation-owned snapshots from ownerless compatibility entries", () => {
    const ownerless = Object.freeze({ id: "ownerless" });
    registerUnmanagedContract("OwnedOnlyContract", ownerless);
    assertEquals(
      trySnapshotGenerationOwnedContractForUse("OwnedOnlyContract"),
      undefined,
    );

    const owned = Object.freeze({ id: "owned" });
    const generation = beginContractGeneration();
    stageContract(generation, "OwnedOnlyContract", owned);
    commitContractGeneration(generation);
    const snapshot = trySnapshotGenerationOwnedContractForUse<{ id: string }>(
      "OwnedOnlyContract",
    );

    assertEquals(snapshot?.implementation, owned);
    sealContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("ignores an inherited generation owner on unmanaged entries", () => {
    const unmanaged = Object.freeze({ id: "unmanaged" });
    const candidate = Object.freeze({ id: "candidate" });
    registerUnmanagedContract("InheritedOwnerUnmanaged", unmanaged);
    const generation = beginContractGeneration();
    stageContract(generation, "InheritedOwnerCandidate", candidate);

    const inheritedOwner = createObject(null) as { status: string };
    inheritedOwner.status = "retiring";
    const previous = installInheritedValue("generation", inheritedOwner);
    let failure: unknown;
    try {
      try {
        commitContractGeneration(generation);
      } catch (error) {
        failure = error;
      }
    } finally {
      restoreInheritedValue("generation", previous);
    }

    const published = tryResolveRegisteredContract("InheritedOwnerCandidate");
    assertEquals(failure, undefined);
    assertEquals(published, candidate);
    assertEquals(
      tryResolveRegisteredContract("InheritedOwnerUnmanaged"),
      unmanaged,
      "an ownerless compatibility entry must survive an unrelated generation commit",
    );
    assertEquals(
      trySnapshotGenerationOwnedContractForUse("InheritedOwnerUnmanaged"),
      undefined,
      "the committing generation must not adopt an ownerless entry through an inherited generation property",
    );
    sealContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("ignores an inherited candidate overlay during successful teardown", async () => {
    const owned = Object.freeze({ id: "owned" });
    const injected = Object.freeze({ id: "injected" });
    const generation = createCommittedGeneration(
      "InheritedOverlayContract",
      owned,
    );
    sealContractGeneration(generation);

    const inheritedOverlay = createObject(null) as {
      entries: Map<string, unknown>;
      entryOverlayShadows: Set<string>;
    };
    inheritedOverlay.entries = new Map([
      [
        "InheritedOverlayContract",
        Object.freeze({
          implementation: injected,
          generation: undefined,
        }),
      ],
    ]);
    inheritedOverlay.entryOverlayShadows = new Set();

    const previous = installInheritedValue("entryOverlay", inheritedOverlay);
    let observation: unknown;
    let operation: Promise<void> | undefined;
    try {
      operation = runWithContractGenerationEpoch(generation, () => {
        observation = tryResolveRegisteredContract(
          "InheritedOverlayContract",
        );
      });
    } finally {
      restoreInheritedValue("entryOverlay", previous);
    }
    await operation;
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);

    assertEquals(observation, owned);
  });

  it("does not let an inherited retirement promise bypass lease draining", async () => {
    const generation = createCommittedGeneration(
      "InheritedRetirementPromiseContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse(
      "InheritedRetirementPromiseContract",
    );
    if (snapshot === undefined) {
      throw new Error("Expected a contract snapshot");
    }
    const lease = acquireContractLease(snapshot.reference);
    let notificationCount = 0;
    lease.setRetirementHandler(() => {
      notificationCount += 1;
      lease.release();
    });
    sealContractGeneration(generation);

    const inheritedRetirement = Promise.resolve();
    const previous = installInheritedValue(
      "retirementPromise",
      inheritedRetirement,
    );
    let retirement: Promise<void>;
    try {
      retirement = drainContractGeneration(generation);
    } finally {
      restoreInheritedValue("retirementPromise", previous);
    }
    await retirement;

    // This is idempotent after a correct notification and releases the leaked
    // lease on the vulnerable implementation so the test can clean up.
    lease.release();
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);

    assertEquals(notificationCount, 1);
  });

  it("does not invoke an inherited retirement handler", async () => {
    const generation = createCommittedGeneration(
      "InheritedRetirementHandlerContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse(
      "InheritedRetirementHandlerContract",
    );
    if (snapshot === undefined) {
      throw new Error("Expected a contract snapshot");
    }
    const lease = acquireContractLease(snapshot.reference);
    let inheritedCalls = 0;
    sealContractGeneration(generation);

    const previous = installInheritedValue(
      "retirementHandler",
      () => {
        inheritedCalls += 1;
        lease.release();
      },
    );
    let retirement: Promise<void>;
    try {
      retirement = drainContractGeneration(generation);
      lease.release();
    } finally {
      restoreInheritedValue("retirementHandler", previous);
    }
    await retirement;
    completeContractGenerationRetirement(generation);

    assertEquals(inheritedCalls, 0);
  });

  it("does not invoke an inherited lease-drain settlement callback", async () => {
    const generation = createCommittedGeneration(
      "InheritedLeaseSettlementContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse(
      "InheritedLeaseSettlementContract",
    );
    if (snapshot === undefined) {
      throw new Error("Expected a contract snapshot");
    }
    const lease = acquireContractLease(snapshot.reference);
    let inheritedCalls = 0;

    const previous = installInheritedValue(
      "settleLeaseDrain",
      () => {
        inheritedCalls += 1;
      },
    );
    try {
      lease.release();
    } finally {
      restoreInheritedValue("settleLeaseDrain", previous);
    }
    sealContractGeneration(generation);
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);

    assertEquals(inheritedCalls, 0);
  });

  it("ignores inherited lifecycle accessors and non-writable fields", async () => {
    const generation = createCommittedGeneration(
      "InheritedLifecycleDescriptorContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse(
      "InheritedLifecycleDescriptorContract",
    );
    if (snapshot === undefined) {
      throw new Error("Expected a contract snapshot");
    }
    const lease = acquireContractLease(snapshot.reference);
    const intendedReason = Object.freeze({ id: "intended-reason" });
    const injectedReason = Object.freeze({ id: "injected-reason" });
    let reasonGetterCalls = 0;
    let reasonSetterCalls = 0;
    let receivedReason: unknown;

    const reasonDescriptor = createObject(null) as PropertyDescriptor;
    reasonDescriptor.configurable = true;
    reasonDescriptor.enumerable = false;
    reasonDescriptor.get = () => {
      reasonGetterCalls += 1;
      return injectedReason;
    };
    reasonDescriptor.set = () => {
      reasonSetterCalls += 1;
    };
    const handlerDescriptor = createObject(null) as PropertyDescriptor;
    handlerDescriptor.configurable = true;
    handlerDescriptor.enumerable = false;
    handlerDescriptor.value = undefined;
    handlerDescriptor.writable = false;

    const previousReason = installInheritedDescriptor(
      "retirementReason",
      reasonDescriptor,
    );
    const previousHandler = installInheritedDescriptor(
      "retirementHandler",
      handlerDescriptor,
    );
    let retirement: Promise<void>;
    try {
      lease.setRetirementHandler((reason) => {
        receivedReason = reason;
        lease.release();
      });
      sealContractGeneration(generation, intendedReason);
      retirement = drainContractGeneration(generation);
    } finally {
      restoreInheritedValue("retirementHandler", previousHandler);
      restoreInheritedValue("retirementReason", previousReason);
    }
    await retirement;
    completeContractGenerationRetirement(generation);

    assertEquals(reasonGetterCalls, 0);
    assertEquals(reasonSetterCalls, 0);
    assertEquals(receivedReason, intendedReason);
  });

  it("publishes one retirement promise before notifying re-entrant handlers", async () => {
    const generation = createCommittedGeneration(
      "ReentrantRetirementContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse(
      "ReentrantRetirementContract",
    );
    if (snapshot === undefined) {
      throw new Error("Expected a contract snapshot");
    }
    const firstLease = acquireContractLease(snapshot.reference);
    const secondLease = acquireContractLease(snapshot.reference);
    let firstNestedDrain: Promise<void> | undefined;
    let secondNestedDrain: Promise<void> | undefined;
    firstLease.setRetirementHandler(() => {
      firstNestedDrain = drainContractGeneration(generation);
      firstLease.release();
    });
    secondLease.setRetirementHandler(() => {
      secondNestedDrain = drainContractGeneration(generation);
      secondLease.release();
    });

    sealContractGeneration(generation);
    const outerDrain = drainContractGeneration(generation);
    await outerDrain;
    completeContractGenerationRetirement(generation);

    assertEquals(firstNestedDrain === outerDrain, true);
    assertEquals(secondNestedDrain === outerDrain, true);
  });

  it("rejects generation drain while a quarantined lease remains active", async () => {
    const generation = createCommittedGeneration(
      "QuarantinedLeaseContract",
      Object.freeze({ id: "owned" }),
    );
    const snapshot = trySnapshotContractForUse("QuarantinedLeaseContract");
    if (snapshot === undefined) throw new Error("Expected a contract snapshot");
    const lease = acquireContractLease(snapshot.reference);
    lease.setRetirementHandler(() => {});
    lease.quarantine();

    let drainFailure: unknown;
    try {
      await drainContractGeneration(generation);
    } catch (error) {
      drainFailure = error;
    }

    assertEquals(drainFailure instanceof Error, true);
    assertEquals(
      drainFailure instanceof Error ? drainFailure.message.includes("quarantined") : false,
      true,
    );
    assertEquals(isContractGenerationDrained(generation), false);
    lease.release();
    await drainContractGeneration(generation);
    completeContractGenerationRetirement(generation);
  });

  it("blocks stale teardown scopes from staging into a replacement generation", async () => {
    const staleGeneration = beginContractGeneration();
    sealContractGeneration(staleGeneration);
    resetContractRegistry();
    const currentGeneration = beginContractGeneration();
    const injected = Object.freeze({ id: "stale-injection" });
    let stageFailure: unknown;

    try {
      await runWithContractGenerationResolution(
        staleGeneration,
        () =>
          stageContract(
            currentGeneration,
            "StaleStagingContract",
            injected,
          ),
      );
    } catch (error) {
      stageFailure = error;
    }
    commitContractGeneration(currentGeneration);
    const published = tryResolveRegisteredContract("StaleStagingContract");

    assertEquals(stageFailure instanceof Error, true);
    assertEquals(
      stageFailure instanceof Error
        ? stageFailure.message.includes("during extension teardown")
        : false,
      true,
    );
    assertEquals(published, undefined);
  });

  it("refuses to publish over an active generation", () => {
    const first = Object.freeze({ id: "first" });
    const second = Object.freeze({ id: "second" });
    const activeGeneration = createCommittedGeneration("ActiveFencedContract", first);
    const candidate = beginContractGeneration();
    stageContract(candidate, "ActiveFencedContract", second);

    assertThrows(
      () => commitContractGeneration(candidate),
      Error,
      "before the active generation retires",
      "a candidate must not publish while another generation is still active",
    );
    assertEquals(
      tryResolveRegisteredContract("ActiveFencedContract"),
      first,
      "a fenced commit must leave the active generation's entries published",
    );

    failContractGeneration(candidate);
    sealContractGeneration(activeGeneration);
    completeContractGenerationRetirement(activeGeneration);
  });

  it("refuses to publish while a prior generation still owns published entries", () => {
    const retiring = Object.freeze({ id: "retiring" });
    const replacement = Object.freeze({ id: "replacement" });
    const retiringGeneration = createCommittedGeneration("OwnedFencedContract", retiring);
    sealContractGeneration(retiringGeneration);
    const candidate = beginContractGeneration();
    stageContract(candidate, "ReplacementFencedContract", replacement);

    assertThrows(
      () => commitContractGeneration(candidate),
      Error,
      "while a prior generation remains owned",
      "a candidate must not publish while a retiring generation still owns entries",
    );
    assertEquals(
      tryResolveRegisteredContract("ReplacementFencedContract"),
      undefined,
      "a fenced commit must publish none of its staged entries",
    );
    assertEquals(
      tryResolveRegisteredContract("OwnedFencedContract"),
      retiring,
      "a fenced commit must leave the retiring generation's entries untouched",
    );

    failContractGeneration(candidate);
    completeContractGenerationRetirement(retiringGeneration);
  });

  it("keeps contract absence fail-closed after a failed generation", () => {
    const generation = beginContractGeneration();
    failContractGeneration(generation);

    assertThrows(
      () => trySnapshotContractForUse("FailedGenerationContract"),
      Error,
      "unavailable because the previous generation failed",
      "a failed generation must stay fail-closed instead of reporting an absent registration",
    );

    const recovered = beginContractGeneration();
    stageContract(recovered, "RecoveredContract", Object.freeze({ id: "recovered" }));
    commitContractGeneration(recovered);

    assertEquals(
      trySnapshotContractForUse("UnrelatedContract"),
      undefined,
      "a successful commit must clear the fail-closed flag",
    );

    sealContractGeneration(recovered);
    completeContractGenerationRetirement(recovered);
  });
});
