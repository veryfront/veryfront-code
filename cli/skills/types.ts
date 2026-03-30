import { z } from "zod";

export const SkillManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  requires: z
    .object({
      cli: z.array(z.string()).optional(),
      mcp: z.array(z.string()).optional(),
    })
    .optional(),
  inputs: z
    .record(
      z.string(),
      z.object({
        type: z.string(),
        default: z.unknown().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export function parseSkillJson(
  raw: unknown,
): { success: true; data: SkillManifest } | { success: false; error: string } {
  const result = SkillManifestSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.message };
}

export interface LoadedSkill {
  manifest: SkillManifest;
  skillMd: string;
  directory: string;
}
