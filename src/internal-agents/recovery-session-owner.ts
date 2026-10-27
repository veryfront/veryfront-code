import { mapPrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import { DurableRunHome } from "./durable-run-home.ts";
import {
  getRecoveryGenerationSchema,
  getRecoveryOwnershipReceiptSchema,
  type RecoveryAdmission,
  type RecoveryOwnershipReceipt,
} from "./recovery-admission-schema.ts";

import {
  parseRecoverySnapshot,
  type RecoverySnapshot,
  validateRecoverySnapshotForRestore,
} from "./recovery-snapshot.ts";

const DateNow = Date.now;
const monotonicNow = performance.now.bind(performance);

const getStoredOwnerSchema = defineSchema((v) =>
  v.object({
    kind: v.literal("managed-recovery-owner"),
    generation: getRecoveryGenerationSchema(),
    ownerInstance: v.string().uuid(),
  }).strict()
);
const sameGeneration = (
  first: RecoveryAdmission["generation"],
  second: RecoveryAdmission["generation"],
) =>
  first.workerId === second.workerId && first.dispatchNonce === second.dispatchNonce &&
  first.transportRecoveryAttempt === second.transportRecoveryAttempt;

/**
 * Framework-only composition boundary. The validator must perform authenticated API I/O;
 * signed dispatch and disk state alone never establish live ownership.
 */
export class RecoverySessionOwner {
  private previousGenerations: RecoveryAdmission["generation"][] = [];
  private executionRequired = false;
  private executionHome: DurableRunHome | undefined;
  private constructor(
    private readonly admission: RecoveryAdmission,
    private readonly validateCurrentOwnership: () => Promise<unknown>,
  ) {}

  static async acquire(input: {
    claims: VerifiedControlPlaneRequestClaims;
    directory: string;
    validateCurrentOwnership: () => Promise<unknown>;
    awaitRetiredPreviousOwner: (
      previous: RecoveryAdmission["generation"],
    ) => Promise<void>;
  }): Promise<RecoverySessionOwner> {
    const admission = getVerifiedControlPlaneRecoveryAdmission(input.claims);
    if (!admission) throw new Error("Managed recovery admission is unavailable");
    const owner = new RecoverySessionOwner(admission, input.validateCurrentOwnership);
    await owner.assertCurrentOwnership();
    const home = await DurableRunHome.open({
      directory: input.directory,
      identity: admission.identity,
    });
    owner.executionHome = home;
    const records = await home.read();
    const predecessors = mapPrivateArray(
      records,
      (record) => getStoredOwnerSchema().parse(record.value),
    );
    owner.previousGenerations = mapPrivateArray(predecessors, (record) => record.generation);
    const stored = predecessors[predecessors.length - 1];
    if (stored) {
      // API pre-stream redispatch issues a fresh nonce without necessarily increasing
      // transportRecoveryAttempt. Only its live full-generation receipt permits replacement.
      if (
        admission.generation.transportRecoveryAttempt <
          stored.generation.transportRecoveryAttempt ||
        sameGeneration(admission.generation, stored.generation)
      ) throw new Error("Managed recovery generation cannot replace this owner");
    }
    // A unique instance makes duplicate concurrent admissions conflict at immutable publication.
    await home.append({
      sequence: records.length + 1,
      value: {
        kind: "managed-recovery-owner",
        generation: admission.generation,
        ownerInstance: randomUUID(),
      },
    });
    await owner.assertCurrentOwnership();
    // Retirement targets only predecessor generations observed before this exclusive admission.
    // A concurrent duplicate cannot retire an owner admitted after that observation.
    // Failed admissions may have left earlier owners unretired. Every targeted join
    // must be idempotent, and none of those obligations disappears on a crash.
    for (let index = 0; index < predecessors.length; index++) {
      const predecessor = predecessors[index]!;
      await input.awaitRetiredPreviousOwner(predecessor.generation);
      await owner.assertCurrentOwnership();
    }
    const receipt = await owner.assertCurrentOwnership();
    // Acquisition can fail before the first acknowledged runtime append. A fresh
    // generation fences late predecessor writes; its live receipt, read after
    // retirement, distinguishes published execution from an acquisition record.
    owner.executionRequired = receipt.acknowledgedExternalSequence > 0;
    // Dispatch expiry bounds admission only. Continuing work requires live paired
    // credentials at the API, whose receipt budget is clipped to their expiry.
    if (admission.expiresAt <= DateNow() / 1000) {
      throw new Error("Managed recovery admission expired before acquisition completed");
    }
    return owner;
  }

  assertAdmittedClaims(claims: VerifiedControlPlaneRequestClaims): void {
    if (getVerifiedControlPlaneRecoveryAdmission(claims) !== this.admission) {
      throw new Error("Recovery owner belongs to a different verified dispatch");
    }
  }

  get requiresRestoredSnapshot(): boolean {
    return this.executionRequired;
  }

  async assertExecutionBinding(requestHash: string): Promise<void> {
    if (!this.executionHome) throw new Error("Recovery execution storage is unavailable");
    await this.assertCurrentOwnership();
    await this.executionHome.assertExecutionBinding(requestHash, this.executionRequired);
    await this.assertCurrentOwnership();
  }

  /** Validate a journal occupant without treating its older cursor as a restore point. */
  async validatePredecessorSnapshot(value: unknown): Promise<RecoverySnapshot> {
    const snapshot = parseRecoverySnapshot(value);
    if (
      !somePrivateArray(
        this.previousGenerations,
        (generation) => sameGeneration(generation, snapshot.binding.generation),
      )
    ) throw new Error("Recovery snapshot is not from an admitted predecessor");
    const receipt = await this.assertCurrentOwnership();
    if (
      snapshot.acknowledgedEventId > receipt.acknowledgedEventId ||
      snapshot.acknowledgedExternalSequence > receipt.acknowledgedExternalSequence
    ) {
      throw new Error("Recovery snapshot cursor is not acknowledged by current ownership");
    }
    if (
      !isDeepStrictEqual(snapshot.binding.identity, this.admission.identity) ||
      !isDeepStrictEqual(snapshot.binding.sourceBinding, this.admission.sourceBinding)
    ) {
      throw new Error("Recovery predecessor journal binding is foreign");
    }
    return snapshot;
  }

  /** Disk snapshots are data; only this privately admitted owner supplies the expected binding. */
  async validateRestoredSnapshot(value: unknown): Promise<RecoverySnapshot> {
    const snapshot = await this.validatePredecessorSnapshot(value);
    if (snapshot.acknowledgedExternalSequence < this.admission.acknowledgedExternalSequence) {
      throw new Error("Recovery snapshot cursor is not acknowledged by current ownership");
    }
    return validateRecoverySnapshotForRestore(snapshot, {
      identity: this.admission.identity,
      sourceBinding: this.admission.sourceBinding,
      generation: snapshot.binding.generation,
    });
  }

  /** Validate immediately before restore or an effect; never cache a JWT as lease authority. */
  async assertCurrentOwnership(): Promise<RecoveryOwnershipReceipt> {
    // Network time consumes the lease budget; response arrival cannot restart it.
    const requestStarted = monotonicNow();
    const receipt = getRecoveryOwnershipReceiptSchema().parse(
      await this.validateCurrentOwnership(),
    );
    const identity = this.admission.identity;
    if (
      receipt.identity.projectId !== identity.projectId ||
      receipt.identity.canonicalRunId !== identity.canonicalRunId ||
      receipt.identity.publicRunId !== identity.publicRunId ||
      receipt.identity.agentId !== identity.agentId ||
      receipt.identity.threadId !== identity.threadId ||
      !sameGeneration(receipt.generation, this.admission.generation) ||
      receipt.acknowledgedExternalSequence < this.admission.acknowledgedExternalSequence ||
      monotonicNow() - requestStarted >= receipt.leaseRemainingMs
    ) throw new Error("Managed recovery ownership is no longer current");
    return receipt;
  }
}
