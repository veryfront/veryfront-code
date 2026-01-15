/**
 * Install Command Types
 */

import { z } from "zod";

export const AIToolIdSchema = z.enum([
  "cursor",
  "claude-code",
  "skill",
  "copilot",
  "windsurf",
  "agents",
]);

export type AIToolId = z.infer<typeof AIToolIdSchema>;

export const AIToolSchema = z.object({
  id: AIToolIdSchema,
  label: z.string().min(1),
  file: z.string().min(1),
  description: z.string().min(1),
  template: z.string().min(1),
});

export type AITool = z.infer<typeof AIToolSchema>;

export const InstallOptionsSchema = z.object({
  target: z.string().optional(),
  global: z.boolean().optional(),
  force: z.boolean().optional(),
  cwd: z.string().optional(),
});

export type InstallOptions = z.infer<typeof InstallOptionsSchema>;

export const DetectOptionsSchema = z.object({
  cwd: z.string().optional(),
});

export type DetectOptions = z.infer<typeof DetectOptionsSchema>;

export interface MultiSelectOption {
  label: string;
  value: string;
  description: string;
  selected: boolean;
}
