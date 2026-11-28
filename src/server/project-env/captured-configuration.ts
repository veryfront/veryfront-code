import { createHash } from "node:crypto";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability";
import { getInstalledProjectHttpBindingSchema } from "../runtime-handler/installed-project.ts";
import { createProjectEnvSnapshot } from "./snapshot.ts";
import {
  type RuntimeConfigurationReference,
  snapshotRuntimeConfigurationReference,
} from "#veryfront/agent/runtime/runtime-configuration-reference.ts";

/** Captured project data, shared by distinct HTTP and authored-execution grants. */
export const getExecutorProjectConfigurationSchema = defineSchema((v) =>
  getInstalledProjectHttpBindingSchema().extend({
    configurationId: v.string().min(1).max(256),
    variables: v.custom<Record<string, string>>((value) => {
      try {
        createProjectEnvSnapshot(value);
        return true;
      } catch {
        return false;
      }
    }, "Invalid application variable record").transform((value): Record<string, string> =>
      createProjectEnvSnapshot(value)
    ),
  }).strict()
);
export type CapturedProjectConfiguration = InferSchema<
  ReturnType<typeof getExecutorProjectConfigurationSchema>
>;

/** Exact API v1 bytes; no deployment identity or host ambient values enter this digest. */
export function snapshotCapturedProjectConfiguration(
  input: unknown,
  rawReference?: RuntimeConfigurationReference,
): CapturedProjectConfiguration {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) throw new TypeError("Invalid captured project configuration");
  const value = getExecutorProjectConfigurationSchema().parse(snapshot.value);
  const { projectId, environmentId, releaseId, projectSlug, environmentName, variables } = value;
  const canonical = JSON.stringify({
    projectId,
    environmentId,
    releaseId,
    projectSlug,
    environmentName,
    variables: Object.fromEntries(
      Object.keys(variables).sort().map((key) => [key, variables[key]]),
    ),
  });
  const id = "configuration-" + createHash("sha256").update(canonical, "utf8").digest("hex");
  if (
    id !== value.configurationId ||
    Object.keys(variables).some(isReservedSharedRuntimeTelemetryEnvKey)
  ) throw new TypeError("Captured configuration content identity mismatch");
  if (rawReference) {
    const reference = snapshotRuntimeConfigurationReference(rawReference);
    if (
      reference.projectId !== projectId || reference.environmentId !== environmentId ||
      reference.releaseId !== releaseId || reference.configurationId !== id
    ) throw new TypeError("Captured configuration scope mismatch");
  }
  return Object.freeze(value);
}
