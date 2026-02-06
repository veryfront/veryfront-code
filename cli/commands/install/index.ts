/**
 * Install command - Setup AI assistant integrations
 */

export { detectAITools, formatDetectionHint } from "./detect.ts";
export { installCommand, installTargets, parseTargetFlag } from "./install.ts";
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
  UninstallOptionsSchema,
} from "./types.ts";
export type {
  AITool,
  AIToolId,
  DetectOptions,
  InstallOptions,
  MultiSelectOption,
  UninstallOptions,
} from "./types.ts";
export { findInstalledTools, uninstallCommand, uninstallTargets } from "./uninstall.ts";
