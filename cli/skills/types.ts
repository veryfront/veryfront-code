import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";

export const getSkillManifestSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    version: v.string(),
    description: v.string(),
    requires: v
      .object({
        cli: v.array(v.string()).optional(),
        mcp: v.array(v.string()).optional(),
      })
      .optional(),
    inputs: v
      .record(
        v.string(),
        v.object({
          type: v.string(),
          default: v.unknown().optional(),
          description: v.string().optional(),
        }),
      )
      .optional(),
  })
);
export const SkillManifestSchema = lazySchema(getSkillManifestSchema);

export type SkillManifest = InferSchema<ReturnType<typeof getSkillManifestSchema>>;

export function parseSkillJson(
  raw: unknown,
): { success: true; data: SkillManifest } | { success: false; error: string } {
  const result = SkillManifestSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const message = result.issues?.map((i) => i.message).join("; ") ?? "Validation failed";
  return { success: false, error: message };
}

export interface LoadedSkill {
  manifest: SkillManifest;
  skillMd: string;
  directory: string;
}
