import { z } from "zod";

export const GetAdapterParamsSchema = z.object({
  projectSlug: z.string().min(1, "projectSlug must be non-empty"),
  token: z.string().min(1, "token must be non-empty"),
  projectId: z.string().optional(),
  productionMode: z.boolean(),
  releaseId: z.string().nullable().optional(),
  environmentName: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
});

export type GetAdapterParams = z.infer<typeof GetAdapterParamsSchema>;
