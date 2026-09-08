import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { isIP } from "node:net";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";

const getIdentifierSchema = defineSchema((v) =>
  v.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
);
const getAllocationIdSchema = defineSchema((v) =>
  v.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
);
const getTimestampSchema = defineSchema((v) =>
  v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
);

/** Mirrors the operator's immutable release/source allocation contract. */
export const getHostedExecutorSourceSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({ type: v.literal("release"), releaseId: getIdentifierSchema() }).strict(),
    v.object({
      type: v.literal("environment"),
      environmentName: getIdentifierSchema(),
      releaseId: getIdentifierSchema(),
    }).strict(),
  ])
);

/** Trusted source owner, independent of the invocation's application project. */
export const getHostedExecutorOwnerSchema = defineSchema((v) =>
  v.discriminatedUnion("scopeKind", [
    v.object({ scopeKind: v.literal("global"), serviceName: v.string().min(1).max(128) }).strict(),
    v.object({ scopeKind: v.literal("project"), projectId: getIdentifierSchema() }).strict(),
  ])
);

/** The control plane injects authenticated brokerInstanceId; callers cannot submit it here. */
export const getHostedExecutorAllocationRequestSchema = defineSchema((v) =>
  v.object({
    allocationId: getAllocationIdSchema(),
    invocationId: getAllocationIdSchema(),
    owner: getHostedExecutorOwnerSchema(),
    source: getHostedExecutorSourceSchema(),
    requestedAt: getTimestampSchema(),
    prepareDeadlineAt: getTimestampSchema(),
    hardDeadlineAt: getTimestampSchema(),
  }).strict().refine((request) =>
    request.requestedAt < request.prepareDeadlineAt &&
    request.prepareDeadlineAt <= request.hardDeadlineAt
  )
);

export const getHostedExecutorBindingSchema = defineSchema((v) =>
  v.object({
    allocationId: getAllocationIdSchema(),
    generation: v.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    invocationId: getAllocationIdSchema(),
    brokerInstanceId: getIdentifierSchema(),
    owner: getHostedExecutorOwnerSchema(),
    source: getHostedExecutorSourceSchema(),
  }).strict()
);

export const getHostedExecutorImageSchema = defineSchema((v) =>
  v.string().max(512).regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/)
);
export const getHostedExecutorAllocationSchema = defineSchema((v) =>
  v.object({
    binding: getHostedExecutorBindingSchema(),
    phase: v.enum(["preparing", "ready", "terminating", "released"] as const),
    expiresAt: getTimestampSchema(),
    reason: v.enum(
      [
        "completed",
        "canceled",
        "expired",
        "preparation-timeout",
        "pod-terminated",
        "pod-lost",
        "policy-unavailable",
        "admission-rejected",
      ] as const,
    ).optional(),
    endpoint: v.object({
      address: v.string().max(45).refine((address) => isIP(address) !== 0),
      port: v.literal(8081),
      podUid: getIdentifierSchema(),
      nodeName: getIdentifierSchema(),
      image: getHostedExecutorImageSchema(),
      channelAuthenticated: v.literal(false),
    }).strict().optional(),
  }).strict().refine((view) =>
    (view.endpoint === undefined || view.phase === "ready") &&
    ((view.phase === "preparing" || view.phase === "ready")
      ? view.reason === undefined
      : view.reason !== undefined)
  )
);

const getAllocationBindingEnvelopeSchema = defineSchema((v) =>
  v.object({ binding: getHostedExecutorBindingSchema() }).passthrough()
);

export type HostedExecutorAllocationRequest = InferSchema<
  ReturnType<typeof getHostedExecutorAllocationRequestSchema>
>;
export type HostedExecutorOwner = InferSchema<ReturnType<typeof getHostedExecutorOwnerSchema>>;
export type HostedExecutorBinding = InferSchema<ReturnType<typeof getHostedExecutorBindingSchema>>;
export type HostedExecutorAllocation = InferSchema<
  ReturnType<typeof getHostedExecutorAllocationSchema>
>;

/** Fixed diagnostics keep allocator bodies and credentials out of session errors. */
export function parseHostedExecutorData<T>(schema: Schema<T>, value: unknown): T {
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    new TextEncoder().encode(privateJsonStringify(snapshot.value)).byteLength > 32 * 1024
  ) {
    throw new Error("Executor session invalid allocator data");
  }
  const parsed = schema.safeParse(snapshot.value);
  if (!parsed.success) throw new Error("Executor session invalid allocator data");
  return parsed.data;
}

/** Capture only an exact validated identity, even when the remaining view is invalid. */
export function readHostedExecutorBinding(value: unknown): HostedExecutorBinding {
  const { binding } = parseHostedExecutorData(getAllocationBindingEnvelopeSchema(), value);
  return Object.freeze({
    ...binding,
    owner: Object.freeze(binding.owner),
    source: Object.freeze(binding.source),
  });
}

export function sameHostedExecutorOwner(
  actual: HostedExecutorOwner,
  expected: HostedExecutorOwner,
): boolean {
  return actual.scopeKind === "global" && expected.scopeKind === "global"
    ? actual.serviceName === expected.serviceName
    : actual.scopeKind === "project" && expected.scopeKind === "project" &&
      actual.projectId === expected.projectId;
}

export function sameHostedExecutorBinding(
  actual: HostedExecutorBinding,
  expected: HostedExecutorBinding,
): boolean {
  return actual.allocationId === expected.allocationId &&
    actual.generation === expected.generation &&
    actual.invocationId === expected.invocationId &&
    actual.brokerInstanceId === expected.brokerInstanceId &&
    sameHostedExecutorOwner(actual.owner, expected.owner) &&
    verifyHostedRuntimeSourceBinding(expected.source, actual.source) === undefined;
}
