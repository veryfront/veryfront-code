import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { getDurableRunIdentitySchema } from "./durable-run-home-schema.ts";

export const MAX_RECOVERY_LEASE_MS = 300_000;
export const getRecoveryGenerationSchema = defineSchema((v) =>
  v.object({
    workerId: v.string().min(1).max(256),
    dispatchNonce: v.string().uuid(),
    transportRecoveryAttempt: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict()
);
export const getRecoverySourceBindingSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().uuid(),
    environmentId: v.string().uuid(),
    releaseId: v.string().uuid(),
  }).strict()
);
export const getRecoveryAdmissionSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    identity: getDurableRunIdentitySchema(),
    generation: getRecoveryGenerationSchema(),
    eventPersistence: v.literal("runtime-owned-v1"),
    acknowledgedExternalSequence: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    leaseRemainingMs: v.number().int().min(1).max(MAX_RECOVERY_LEASE_MS),
    sourceBinding: getRecoverySourceBindingSchema(),
    expiresAt: v.number().int().min(1),
  }).strict()
);
export const getRecoveryOwnershipReceiptSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    identity: v.object({
      projectId: v.string().uuid(),
      canonicalRunId: v.string().uuid(),
      publicRunId: v.string().min(1).max(256),
      agentId: v.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
      threadId: v.string().uuid(),
    }).strict(),
    generation: getRecoveryGenerationSchema(),
    acknowledgedEventId: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    acknowledgedExternalSequence: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    leaseRemainingMs: v.number().int().min(1).max(MAX_RECOVERY_LEASE_MS),
  }).strict()
);
export type RecoveryAdmission = InferSchema<ReturnType<typeof getRecoveryAdmissionSchema>>;
export type RecoveryOwnershipReceipt = InferSchema<
  ReturnType<typeof getRecoveryOwnershipReceiptSchema>
>;
