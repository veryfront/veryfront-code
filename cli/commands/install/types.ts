import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";

export const getAIToolIdSchema = defineSchema((v) =>
  v.enum([
    "cursor",
    "claude-code",
    "skill",
    "copilot",
    "windsurf",
    "agents",
  ])
);

export const AIToolIdSchema = lazySchema(getAIToolIdSchema);

export type AIToolId = InferSchema<ReturnType<typeof getAIToolIdSchema>>;

export const getAIToolSchema = defineSchema((v) =>
  v.object({
    id: getAIToolIdSchema(),
    label: v.string().min(1),
    file: v.string().min(1),
    description: v.string().min(1),
    template: v.string().min(1),
  })
);

export const AIToolSchema = lazySchema(getAIToolSchema);

export type AITool = InferSchema<ReturnType<typeof getAIToolSchema>>;

const getBaseCommandOptionsSchema = defineSchema((v) =>
  v.object({
    target: v.string().optional(),
    global: v.boolean().optional(),
    force: v.boolean().optional(),
    cwd: v.string().optional(),
  })
);

export const getInstallOptionsSchema = getBaseCommandOptionsSchema;
export const InstallOptionsSchema = lazySchema(getInstallOptionsSchema);
export type InstallOptions = InferSchema<ReturnType<typeof getInstallOptionsSchema>>;

export const getUninstallOptionsSchema = getBaseCommandOptionsSchema;
export const UninstallOptionsSchema = lazySchema(getUninstallOptionsSchema);
export type UninstallOptions = InferSchema<ReturnType<typeof getUninstallOptionsSchema>>;

export const getDetectOptionsSchema = defineSchema((v) =>
  v.object({
    cwd: v.string().optional(),
  })
);

export const DetectOptionsSchema = lazySchema(getDetectOptionsSchema);

export type DetectOptions = InferSchema<ReturnType<typeof getDetectOptionsSchema>>;
