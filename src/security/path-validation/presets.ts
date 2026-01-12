/**
 * Validation Presets
 * @module security/path-validation/presets
 */

import type { ValidationOptions } from "./types.ts";

/**
 * Common validation presets for different contexts
 */
export const ValidationPresets = {
  /**
   * Strict validation for user-provided paths
   */
  userInput: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "strict",
    allowedDirs: ["app", "pages", "public", "components", "lib"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),

  /**
   * Normal validation for internal operations
   */
  internal: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    followSymlinks: false,
    checkExists: false,
    allowAbsolute: false,
  }),

  /**
   * Permissive validation for build operations
   */
  build: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "permissive",
    followSymlinks: true,
    checkExists: false,
    allowAbsolute: true,
  }),

  /**
   * Static file serving validation
   */
  static: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    allowedDirs: ["dist", "public"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),
};
