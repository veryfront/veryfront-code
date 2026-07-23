import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

const MAX_IDENTIFIER_LENGTH = 255;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)) return true;
  }
  return false;
}

export const getGetAdapterParamsSchema = defineSchema((v) => {
  const identifier = (field: string) =>
    v.string().min(1, `${field} must be non-empty`).max(
      MAX_IDENTIFIER_LENGTH,
      `${field} must be at most ${MAX_IDENTIFIER_LENGTH} characters`,
    ).refine(
      (value) => !containsControlCharacter(value),
      `${field} must not contain control characters`,
    );

  return v.object({
    projectSlug: identifier("projectSlug"),
    token: v.string().min(1, "token must be non-empty").max(
      4_096,
      "token must be at most 4096 characters",
    ),
    projectId: identifier("projectId").optional(),
    productionMode: v.boolean(),
    releaseId: identifier("releaseId").nullable().optional(),
    environmentName: identifier("environmentName").nullable().optional(),
    branch: identifier("branch").nullable().optional(),
  }).superRefine((input, ctx) => {
    if (input.productionMode && !input.releaseId) {
      ctx.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "releaseId is required in production mode",
      });
    }
  });
});

export type GetAdapterParams = InferSchema<ReturnType<typeof getGetAdapterParamsSchema>>;
