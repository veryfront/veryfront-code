import type { InferSchema, Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getExecutorBindingSchema } from "../executor/protocol.ts";
import {
  getHostedExecutorOwnerSchema,
  getHostedExecutorSourceSchema,
} from "./executor-session-schema.ts";
import { getExecutorRuntimeGrantDataSchema } from "./executor-runtime-prepare-schema.ts";
import { getExecutorPersistenceCapabilityIdsSchema } from "./executor-persistence-schema.ts";
import { getExecutorDiscoveryIdSchema } from "./executor-discovery-schema.ts";
import { getExecutorToolIdSchema } from "./executor-tool-schema.ts";

function artifactShape(v: SchemaValidator) {
  return {
    version: v.literal(1),
    owner: getHostedExecutorOwnerSchema(),
    source: getHostedExecutorSourceSchema(),
    root: v.literal("project"),
  };
}

/** Image-builder-owned metadata outside the project payload. No caller-selected paths. */
export const getExecutorArtifactManifestSchema = defineSchema((v) =>
  v.object(artifactShape(v)).strict()
);

export const getExecutorRuntimeInstallSchema = defineSchema((v) =>
  v.object({
    ...artifactShape(v),
    binding: getExecutorBindingSchema(),
    grant: getExecutorRuntimeGrantDataSchema(),
    /** Trusted ownership metadata for selected host tools, independent of source listings. */
    hostToolAliases: v.array(
      v.object({
        sourceId: getExecutorToolIdSchema(),
        toolName: getExecutorToolIdSchema(),
        ownerAgentId: getExecutorDiscoveryIdSchema(),
        shortName: getExecutorToolIdSchema(),
      }).strict(),
    ).max(4096).optional(),
    capabilities: v.object({
      persistence: getExecutorPersistenceCapabilityIdsSchema(),
      projectSteering: getExecutorDiscoveryIdSchema().optional(),
      conversationUserText: getExecutorDiscoveryIdSchema().optional(),
    }).strict(),
  }).strict().refine(({ grant, capabilities, hostToolAliases }) => {
    const aliases = new Set<string>();
    for (const alias of hostToolAliases ?? []) {
      const key = JSON.stringify([alias.sourceId, alias.toolName]);
      if (
        aliases.has(key) || alias.ownerAgentId !== grant.agentId ||
        !grant.hostToolFacadeIds.includes(alias.sourceId) ||
        !grant.allowedToolNames.includes(alias.toolName)
      ) return false;
      aliases.add(key);
    }
    const execution = grant.execution;
    if (
      (execution.projectId !== null || grant.requiredCapabilities?.includes("project-steering")) &&
      !capabilities.projectSteering
    ) return false;
    if (
      grant.requiredCapabilities?.includes("conversation-user-text") &&
      !capabilities.conversationUserText
    ) return false;
    if (execution.kind === "canonical") {
      if (
        !capabilities.persistence.publishParentRunEvents ||
        !capabilities.persistence.toolExposureCheckpoint
      ) return false;
      if (
        execution.providerReplay === "required" &&
        !capabilities.persistence.providerReplayCheckpoint
      ) return false;
    }
    return new Set(grant.models.map((model) => model.id)).size === grant.models.length &&
      grant.models.some((model) => model.id === grant.defaultModelId);
  }, "Missing or ambiguous executor installation authority")
);

export type ExecutorArtifactManifest = InferSchema<
  ReturnType<typeof getExecutorArtifactManifestSchema>
>;
export type ExecutorRuntimeInstall = InferSchema<
  ReturnType<typeof getExecutorRuntimeInstallSchema>
>;

/** Snapshot before parsing so installation never retains a caller's mutable objects. */
export function parseExecutorInstallation<T>(schema: Schema<T>, input: unknown): T {
  const snapshot = snapshotBoundedJsonValue(input);
  if (
    !snapshot.success ||
    new TextEncoder().encode(JSON.stringify(snapshot.value)).byteLength > 64 * 1024
  ) {
    throw new TypeError("Invalid executor installation");
  }
  const result = schema.safeParse(snapshot.value);
  if (!result.success) throw new TypeError("Invalid executor installation");
  return result.data;
}
