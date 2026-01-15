/**
 * Install command - Setup AI assistant integrations
 */

export { installCommand, installTargets, parseTargetFlag } from "./install.ts";
export { detectAITools, formatDetectionHint } from "./detect.ts";
export {
  AI_TOOLS,
  getAllToolIds,
  getTemplateContent,
  getToolById,
  isValidToolId,
} from "./registry.ts";
export {
  AIToolIdSchema,
  AIToolSchema,
  DetectOptionsSchema,
  InstallOptionsSchema,
} from "./types.ts";
export type {
  AITool,
  AIToolId,
  DetectOptions,
  InstallOptions,
  MultiSelectOption,
} from "./types.ts";
