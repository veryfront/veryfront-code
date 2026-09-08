import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { defineError, snapshotVeryfrontError, VeryfrontError } from "#veryfront/errors/types.ts";
import { getRuntimeAgentMarkdownDefinitionSchema } from "#veryfront/agent/runtime/agent-definition.ts";
import { executorAgentJson } from "./executor-agent-schema.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";

const objectCreate = Object.create;
const objectKeys = Object.keys;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const arrayIsArray = Array.isArray;

function snapshotDiscoveryRecords(
  value: unknown,
  budget = { remaining: 100_000 },
  depth = 0,
): unknown {
  if (--budget.remaining < 0 || depth > 64) throw new Error("Invalid discovery data");
  if (value === null || typeof value !== "object") return value;
  const array = arrayIsArray(value);
  if (array && value.length > 100_000) throw new Error("Invalid discovery data");
  const result = array ? [] : objectCreate(null);
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !objectHasOwn(descriptor, "value")) {
      throw new Error("Invalid discovery accessor");
    }
    defineOwnDataProperty(
      result,
      key,
      snapshotDiscoveryRecords(descriptor.value, budget, depth + 1),
      {
        enumerable: true,
        configurable: true,
        writable: true,
      },
    );
  }
  if (array) result.length = value.length;
  return result;
}

export const EXECUTOR_DISCOVERY_MAX_AGENTS = 256;
export const EXECUTOR_DISCOVERY_MAX_DEFINITION_BYTES = 64 * 1024;
const statuses = {
  EXECUTOR_DISCOVERY_INVALID_INPUT: 400,
  EXECUTOR_DISCOVERY_BINDING_MISMATCH: 403,
  EXECUTOR_DISCOVERY_INVALID_OUTPUT: 502,
  EXECUTOR_DISCOVERY_FAILED: 500,
  EXECUTOR_DISCOVERY_CLEANUP_FAILED: 500,
  EXECUTOR_DISCOVERY_BUSY: 409,
  EXECUTOR_DISCOVERY_NOT_READY: 409,
  EXECUTOR_DISCOVERY_CLOSED: 410,
  CONFIG_INVALID: 400,
  AGENT_NOT_FOUND: 404,
  ABORTED: 499,
} as const;
type FailureCode = keyof typeof statuses;

/** @internal Fixed registry-backed errors contain no source paths or project diagnostics. */
export class ExecutorDiscoveryError extends VeryfrontError {
  constructor(readonly code: FailureCode) {
    super(
      code,
      defineError({
        slug: code.toLowerCase().replaceAll("_", "-"),
        category: "AGENT",
        title: code,
        status: statuses[code],
      }),
    );
  }
}

export function discoveryFailureCode(error: unknown): FailureCode {
  if (error instanceof ExecutorDiscoveryError) return error.code;
  const slug = snapshotVeryfrontError(error)?.slug;
  if (
    slug === "config-invalid" || slug === "config-validation-failed" ||
    slug === "config-parse-error"
  ) return "CONFIG_INVALID";
  if (slug === "agent-not-found") return "AGENT_NOT_FOUND";
  return "EXECUTOR_DISCOVERY_FAILED";
}

export const getExecutorDiscoveryIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).refine((id) =>
    id.trim() === id && !hasControlCharacters(id) && isWellFormedUtf16(id)
  )
);
export const getExecutorDiscoverySourceSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({ type: v.literal("release"), releaseId: getExecutorDiscoveryIdSchema() }).strict(),
    v.object({
      type: v.literal("environment"),
      environmentName: getExecutorDiscoveryIdSchema(),
      releaseId: getExecutorDiscoveryIdSchema(),
    }).strict(),
  ])
);
export type ExecutorDiscoverySource = InferSchema<
  ReturnType<typeof getExecutorDiscoverySourceSchema>
>;
export const getExecutorDiscoveryAgentSourceSchema = defineSchema((v) =>
  v.enum(["auto", "code", "markdown"] as const)
);
export const getExecutorDiscoveryRequestSchema = defineSchema((v) => v.object({}).strict());
export const getExecutorAgentDescribeRequestSchema = defineSchema((v) =>
  v.object({ agentId: getExecutorDiscoveryIdSchema() }).strict()
);

export const getExecutorDiscoveryCandidatesSchema = defineSchema((v) =>
  v.object({
    codeAgentIds: v.array(getExecutorDiscoveryIdSchema()).max(EXECUTOR_DISCOVERY_MAX_AGENTS),
    markdownAgentIds: v.array(getExecutorDiscoveryIdSchema()).max(EXECUTOR_DISCOVERY_MAX_AGENTS),
  }).strict().refine((value) => {
    const ids = [...value.codeAgentIds, ...value.markdownAgentIds];
    return ids.length <= EXECUTOR_DISCOVERY_MAX_AGENTS && new Set(ids).size === ids.length;
  })
);

/** Preserve existing definition semantics while rejecting additional wire fields. */
export const getExecutorAgentDefinitionSchema = defineSchema((v) => {
  const ids = () => v.array(getExecutorDiscoveryIdSchema()).max(EXECUTOR_DISCOVERY_MAX_AGENTS);
  return getRuntimeAgentMarkdownDefinitionSchema().extend({
    id: getExecutorDiscoveryIdSchema(),
    tools: v.union([v.literal(true), ids()]).optional(),
    skills: v.union([v.literal(true), v.literal(false), ids()]).optional(),
    deniedTools: ids().optional(),
    delegates: ids().optional(),
    providerTools: ids().optional(),
    thinking: v.object({ enabled: v.boolean(), budgetTokens: v.number().positive().optional() })
      .strict().optional(),
    mcpServers: v.array(
      v.object({
        kind: v.enum(["veryfront-api", "veryfront-studio"] as const),
        id: getExecutorDiscoveryIdSchema().optional(),
        toolPolicy: v.object({
          allow: ids().optional(),
          deny: ids().optional(),
          approval: v.literal("never").optional(),
        }).strict().optional(),
      }).strict(),
    ).max(64).optional(),
  }).strict().refine((value) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      EXECUTOR_DISCOVERY_MAX_DEFINITION_BYTES
  );
});

export const getExecutorDiscoveryDescriptionSchema = defineSchema((v) =>
  v.object({
    source: getExecutorDiscoverySourceSchema(),
    candidates: getExecutorDiscoveryCandidatesSchema(),
    defaultAgentId: getExecutorDiscoveryIdSchema(),
    definition: getExecutorAgentDefinitionSchema(),
    errorCount: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict().refine((value) => value.defaultAgentId === value.definition.id)
);

export const getExecutorAgentDescriptionSchema = defineSchema((v) =>
  v.object({
    source: getExecutorDiscoverySourceSchema(),
    definition: getExecutorAgentDefinitionSchema(),
  }).strict()
);

const getExecutorDiscoveryFailureSchema = defineSchema((v) =>
  v.object({
    ok: v.literal(false),
    code: v.enum(
      [
        "EXECUTOR_DISCOVERY_INVALID_INPUT",
        "EXECUTOR_DISCOVERY_BINDING_MISMATCH",
        "EXECUTOR_DISCOVERY_INVALID_OUTPUT",
        "EXECUTOR_DISCOVERY_FAILED",
        "EXECUTOR_DISCOVERY_CLEANUP_FAILED",
        "EXECUTOR_DISCOVERY_BUSY",
        "EXECUTOR_DISCOVERY_NOT_READY",
        "EXECUTOR_DISCOVERY_CLOSED",
        "CONFIG_INVALID",
        "AGENT_NOT_FOUND",
        "ABORTED",
      ] as const,
    ),
  }).strict()
);

export const getExecutorDiscoveryResultSchema = defineSchema((v) =>
  v.discriminatedUnion("ok", [
    v.object({ ok: v.literal(true), value: getExecutorDiscoveryDescriptionSchema() }).strict(),
    getExecutorDiscoveryFailureSchema(),
  ])
);
export const getExecutorAgentDescribeResultSchema = defineSchema((v) =>
  v.discriminatedUnion("ok", [
    v.object({ ok: v.literal(true), value: getExecutorAgentDescriptionSchema() }).strict(),
    getExecutorDiscoveryFailureSchema(),
  ])
);

export function parseDiscoveryData<T>(schema: Schema<T>, value: unknown, output = false): T {
  try {
    const result = schema.safeParse(snapshotDiscoveryRecords(value));
    if (result.success) return snapshotDiscoveryRecords(result.data) as T;
  } catch {
    // Snapshot and validation failures share the fixed boundary diagnostic.
  }
  throw new ExecutorDiscoveryError(
    output ? "EXECUTOR_DISCOVERY_INVALID_OUTPUT" : "EXECUTOR_DISCOVERY_INVALID_INPUT",
  );
}

export function discoverySuccess(value: unknown): JsonValue {
  try {
    return executorAgentJson({ ok: true, value }, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
  } catch {
    throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_INVALID_OUTPUT");
  }
}
