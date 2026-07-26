import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalProjectSlug,
  MAX_OPAQUE_ID_CODE_UNITS,
  MAX_PROJECT_SLUG_CODE_UNITS,
} from "#veryfront/utils/project-identity.ts";

export const MAX_PROXY_PROJECT_SLUG_CODE_UNITS = MAX_PROJECT_SLUG_CODE_UNITS;
export const MAX_PROXY_TOKEN_CODE_UNITS = 16_384;
export const MAX_PROXY_SOURCE_IDENTITY_CODE_UNITS = MAX_OPAQUE_ID_CODE_UNITS;

export const getGetAdapterParamsSchema = defineSchema((v) => {
  const sourceIdentity = v.string()
    .min(1, "source identity must be non-empty")
    .max(
      MAX_PROXY_SOURCE_IDENTITY_CODE_UNITS,
      `source identity must not exceed ${MAX_PROXY_SOURCE_IDENTITY_CODE_UNITS} characters`,
    )
    .refine(
      (value) => !hasProjectIdentityControlCharacters(value),
      "source identity must not contain control characters",
    );

  return v.object({
    projectSlug: v.string()
      .min(1, "projectSlug must be non-empty")
      .max(
        MAX_PROXY_PROJECT_SLUG_CODE_UNITS,
        `projectSlug must not exceed ${MAX_PROXY_PROJECT_SLUG_CODE_UNITS} characters`,
      )
      .refine(
        isCanonicalProjectSlug,
        "projectSlug must be a canonical hosted project slug",
      ),
    token: v.string()
      .min(1, "token must be non-empty")
      .max(
        MAX_PROXY_TOKEN_CODE_UNITS,
        `token must not exceed ${MAX_PROXY_TOKEN_CODE_UNITS} characters`,
      )
      .refine(
        (value) => !hasProjectIdentityControlCharacters(value),
        "token must not contain control characters",
      ),
    projectId: sourceIdentity.optional(),
    productionMode: v.boolean(),
    releaseId: sourceIdentity.nullable().optional(),
    environmentName: sourceIdentity.nullable().optional(),
    branch: sourceIdentity.nullable().optional(),
  }).superRefine((input, ctx) => {
    if (input.productionMode && !input.releaseId) {
      ctx.addIssue({
        code: "custom",
        path: ["releaseId"],
        message: "releaseId is required in production mode",
      });
    }
    if (!input.productionMode && !input.branch) {
      ctx.addIssue({
        code: "custom",
        path: ["branch"],
        message: "branch is required in preview mode",
      });
    }
  });
});

export type GetAdapterParams = InferSchema<ReturnType<typeof getGetAdapterParamsSchema>>;
