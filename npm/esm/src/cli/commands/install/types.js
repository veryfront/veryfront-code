import { z } from "zod";
export const AIToolIdSchema = z.enum([
    "cursor",
    "claude-code",
    "skill",
    "copilot",
    "windsurf",
    "agents",
]);
export const AIToolSchema = z.object({
    id: AIToolIdSchema,
    label: z.string().min(1),
    file: z.string().min(1),
    description: z.string().min(1),
    template: z.string().min(1),
});
const BaseCommandOptionsSchema = z.object({
    target: z.string().optional(),
    global: z.boolean().optional(),
    force: z.boolean().optional(),
    cwd: z.string().optional(),
});
export const InstallOptionsSchema = BaseCommandOptionsSchema;
export const UninstallOptionsSchema = BaseCommandOptionsSchema;
export const DetectOptionsSchema = z.object({
    cwd: z.string().optional(),
});
