import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";

const freeze = Object.freeze;

/** Host-owned identity of one immutable installed application release. */
export const getInstalledProjectHttpBindingSchema = defineSchema((v) => {
  const id = v.string().min(1).max(256).refine(
    (value) =>
      value.trim() === value &&
      Array.from(value).every((character) =>
        character.charCodeAt(0) >= 32 && character !== "\u007f"
      ),
    "Invalid installed project identity",
  );
  return v.object({
    projectId: id,
    projectSlug: id,
    releaseId: id,
    environmentId: id,
    environmentName: id,
  }).strict();
});

export type InstalledProjectHttpBinding = Readonly<
  InferSchema<ReturnType<typeof getInstalledProjectHttpBindingSchema>>
>;

/** Detach caller-owned objects before any application configuration or modules load. */
export function snapshotInstalledProjectHttpBinding(input: unknown): InstalledProjectHttpBinding {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) throw new TypeError("Invalid installed project identity");
  const result = getInstalledProjectHttpBindingSchema().safeParse(snapshot.value);
  if (!result.success) throw new TypeError("Invalid installed project identity");
  return freeze(result.data);
}

/** Source identity never derives from a browser-controlled host in this profile. */
export function installedProjectDomain(binding: InstalledProjectHttpBinding): ParsedDomain {
  return {
    slug: binding.projectSlug,
    branch: null,
    environment: "production",
    isVeryfrontDomain: false,
    isDraft: false,
    allowIframeEmbed: false,
  };
}
