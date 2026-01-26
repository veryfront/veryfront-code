/**
 * Install command - Setup AI assistant integrations
 */

export { installCommand, installTargets, parseTargetFlag } from "./install.js";
export { findInstalledTools, uninstallCommand, uninstallTargets } from "./uninstall.js";
export { detectAITools, formatDetectionHint } from "./detect.js";
export {
  AI_TOOLS,
  getAllToolIds,
  getTemplateContent,
  getToolById,
  isValidToolId,
} from "./registry.js";
export {
  AIToolIdSchema,
  AIToolSchema,
  DetectOptionsSchema,
  InstallOptionsSchema,
  UninstallOptionsSchema,
} from "./types.js";
export type {
  AITool,
  AIToolId,
  DetectOptions,
  InstallOptions,
  MultiSelectOption,
  UninstallOptions,
} from "./types.js";
