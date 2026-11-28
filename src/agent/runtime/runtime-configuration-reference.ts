import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

/** API-captured deployment provenance; contains no environment values or credential. */
export const getRuntimeConfigurationReferenceSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    projectId: v.string().uuid(),
    environmentId: v.string().uuid(),
    releaseId: v.string().uuid(),
    deploymentId: v.string().uuid(),
    configurationId: v.string().regex(/^configuration-[a-f0-9]{64}$/),
  }).strict()
);
export type RuntimeConfigurationReference = Readonly<
  InferSchema<ReturnType<typeof getRuntimeConfigurationReferenceSchema>>
>;

/** Reject accessors/prototype input before parsing the fixed own-data reference. */
export function snapshotRuntimeConfigurationReference(
  value: unknown,
): RuntimeConfigurationReference {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) throw new TypeError("Invalid captured runtime configuration reference");
  const result = getRuntimeConfigurationReferenceSchema().safeParse(snapshot.value);
  if (!result.success) throw new TypeError("Invalid captured runtime configuration reference");
  return Object.freeze(result.data);
}
