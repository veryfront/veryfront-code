import { snapshotCapturedProjectConfiguration } from "../project-env/captured-configuration.ts";
import {
  type RuntimeConfigurationReference,
  snapshotRuntimeConfigurationReference,
} from "#veryfront/agent/runtime/runtime-configuration-reference.ts";
import { getHostedExecutorImageSchema } from "#veryfront/agent/hosted/executor-session-schema.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getExecutorHttpApplicationConfigurationSchema } from "./application-configuration.ts";

/** Distinct opt-in from publication protocol v2; legacy profiles do not imply this capability. */
export interface InstalledConfigurationReferences {
  version: 1;
  references: readonly RuntimeConfigurationReference[];
}
const scopeKey = (
  value: Pick<RuntimeConfigurationReference, "projectId" | "environmentId" | "releaseId">,
) => JSON.stringify([value.projectId, value.environmentId, value.releaseId]);
const contentKey = (value: Omit<RuntimeConfigurationReference, "version" | "deploymentId">) =>
  JSON.stringify([scopeKey(value), value.configurationId]);
const referenceKey = (value: RuntimeConfigurationReference) =>
  JSON.stringify([contentKey(value), value.deploymentId]);

/** Retain content once, but admit only explicitly installed exact deployment references. */
export function createInstalledConfigurationRegistry(
  installations: unknown,
  capability: InstalledConfigurationReferences,
) {
  const snapshot = snapshotBoundedJsonValue({ installations, capability });
  if (!snapshot.success) throw new TypeError("Invalid installed configuration registry");
  const input = snapshot.value;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid installed configuration registry");
  }
  const admitted = input.capability;
  if (
    !admitted || typeof admitted !== "object" || Array.isArray(admitted) ||
    Object.keys(admitted).length !== 2 ||
    !Object.hasOwn(admitted, "references") || !Object.hasOwn(admitted, "version") ||
    admitted.version !== 1 || !Array.isArray(admitted.references) ||
    admitted.references.length < 1 || admitted.references.length > 64 ||
    !Array.isArray(input.installations) || input.installations.length < 1 ||
    input.installations.length > 64
  ) {
    throw new TypeError("Invalid installed configuration capability");
  }
  type Configuration = ReturnType<
    ReturnType<typeof getExecutorHttpApplicationConfigurationSchema>["parse"]
  >;
  const contents = new Map<string, { image: string; configuration: Configuration }>();
  const images = new Map<string, string>();
  for (const entry of input.installations) {
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, "configuration") || !Object.hasOwn(entry, "image")
    ) {
      throw new TypeError("Invalid installed configuration entry");
    }
    const raw = entry as { image: unknown; configuration: unknown };
    const image = getHostedExecutorImageSchema().parse(raw.image);
    const configuration = snapshotCapturedProjectConfiguration(raw.configuration);
    const key = contentKey(configuration);
    const source = scopeKey(configuration);
    if (contents.has(key) || (images.has(source) && images.get(source) !== image)) {
      throw new TypeError("Conflicting installed configuration content");
    }
    images.set(source, image);
    Object.freeze(configuration.variables);
    contents.set(key, Object.freeze({ image, configuration: Object.freeze(configuration) }));
  }
  const references = new Set<string>();
  const deployments = new Set<string>();
  const referencedContents = new Set<string>();
  for (const raw of admitted.references) {
    const reference = snapshotRuntimeConfigurationReference(raw);
    const key = referenceKey(reference);
    if (deployments.has(reference.deploymentId) || !contents.has(contentKey(reference))) {
      throw new TypeError("Invalid installed configuration reference");
    }
    references.add(key);
    deployments.add(reference.deploymentId);
    referencedContents.add(contentKey(reference));
  }
  if (referencedContents.size !== contents.size) {
    throw new TypeError("Unreferenced installed configuration");
  }
  return Object.freeze({
    select(raw: unknown) {
      const reference = snapshotRuntimeConfigurationReference(raw);
      if (!references.has(referenceKey(reference))) {
        throw new TypeError("Captured configuration unavailable");
      }
      return { reference, ...contents.get(contentKey(reference))! };
    },
  });
}
