import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getGetAdapterParamsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().min(1, "projectSlug must be non-empty"),
    token: v.string().min(1, "token must be non-empty"),
    projectId: v.string().optional(),
    productionMode: v.boolean(),
    releaseId: v.string().nullable().optional(),
    environmentName: v.string().nullable().optional(),
    branch: v.string().nullable().optional(),
  })
);

export type GetAdapterParams = InferSchema<ReturnType<typeof getGetAdapterParamsSchema>>;
