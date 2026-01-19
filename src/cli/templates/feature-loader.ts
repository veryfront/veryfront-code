/**
 * Feature loader for composable templates
 *
 * Loads features from the features/ directory and handles:
 * - Feature file overlay
 * - Dependency merging
 * - Config merging
 * - Feature validation (requires/conflicts)
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/platform/compat/path-helper.ts";
import { loadTemplateFromDirectory } from "./loader.ts";
import type { FeatureConfig, FeatureName, ResolvedFeature, TemplateFile } from "./types.ts";

/**
 * Available features that can be added via --with flag
 */
export const AVAILABLE_FEATURES: FeatureName[] = [
  "ai",
  "auth",
  "workflows",
  "mdx",
  "redis",
  "blob",
];

/**
 * Get the directory path for a feature
 */
export function getFeatureDirectory(featureName: string): string {
  const moduleUrl = new URL(".", import.meta.url);
  let moduleDir: string;

  if (moduleUrl.protocol === "file:") {
    moduleDir = moduleUrl.pathname;
    if (
      typeof process !== "undefined" &&
      process.platform === "win32" &&
      moduleDir.startsWith("/")
    ) {
      moduleDir = moduleDir.slice(1);
    }
  } else {
    moduleDir = moduleUrl.href;
  }

  return pathHelper.join(moduleDir, "features", featureName);
}

/**
 * Load feature configuration from feature.json
 */
export async function loadFeatureConfig(
  featureName: FeatureName,
): Promise<FeatureConfig | null> {
  const fs = createFileSystem();
  const featureDir = getFeatureDirectory(featureName);
  const configPath = pathHelper.join(featureDir, "feature.json");

  try {
    const content = await fs.readTextFile(configPath);
    return JSON.parse(content) as FeatureConfig;
  } catch {
    return null;
  }
}

/**
 * Load a feature with its files
 */
export async function loadFeature(
  featureName: FeatureName,
): Promise<ResolvedFeature | null> {
  const config = await loadFeatureConfig(featureName);
  if (!config) {
    return null;
  }

  const featureDir = getFeatureDirectory(featureName);
  const filesDir = pathHelper.join(featureDir, "files");

  // Load feature files
  const files = await loadTemplateFromDirectory(filesDir);

  return {
    config,
    files,
  };
}

/**
 * Validate feature combinations
 */
export function validateFeatures(features: FeatureName[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for unknown features
  for (const feature of features) {
    if (!AVAILABLE_FEATURES.includes(feature)) {
      errors.push(`Unknown feature: ${feature}. Available: ${AVAILABLE_FEATURES.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Resolve feature dependencies and order
 */
export async function resolveFeatures(
  requestedFeatures: FeatureName[],
): Promise<{
  ordered: FeatureName[];
  errors: string[];
}> {
  const errors: string[] = [];
  const resolved = new Set<FeatureName>();
  const ordered: FeatureName[] = [];

  // Load all feature configs
  const configs = new Map<FeatureName, FeatureConfig>();
  for (const name of requestedFeatures) {
    const config = await loadFeatureConfig(name);
    if (config) {
      configs.set(name, config);
    } else {
      errors.push(`Feature not found: ${name}`);
    }
  }

  // Check conflicts
  for (const [name, config] of configs) {
    if (config.conflicts) {
      for (const conflict of config.conflicts) {
        if (requestedFeatures.includes(conflict)) {
          errors.push(`Feature '${name}' conflicts with '${conflict}'`);
        }
      }
    }
  }

  // Topological sort based on requires
  const visit = (name: FeatureName): boolean => {
    if (resolved.has(name)) return true;

    const config = configs.get(name);
    if (!config) return false;

    // Visit dependencies first
    if (config.requires) {
      for (const dep of config.requires) {
        if (!requestedFeatures.includes(dep)) {
          errors.push(`Feature '${name}' requires '${dep}' which is not included`);
          return false;
        }
        if (!visit(dep)) return false;
      }
    }

    resolved.add(name);
    ordered.push(name);
    return true;
  };

  for (const name of requestedFeatures) {
    visit(name);
  }

  return { ordered, errors };
}

/**
 * Merge feature files with base template files
 * Later files override earlier ones
 */
export function mergeFiles(
  baseFiles: TemplateFile[],
  featureFiles: TemplateFile[],
): TemplateFile[] {
  const fileMap = new Map<string, TemplateFile>();

  // Add base files
  for (const file of baseFiles) {
    fileMap.set(file.path, file);
  }

  // Overlay feature files
  for (const file of featureFiles) {
    fileMap.set(file.path, file);
  }

  return Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Merge dependencies from features
 */
export function mergeDependencies(
  baseDeps: Record<string, string>,
  featureDeps: Record<string, string>,
): Record<string, string> {
  return { ...baseDeps, ...featureDeps };
}

/**
 * Deep merge config objects
 */
export function mergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      // Deep merge objects
      result[key] = mergeConfig(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Check if a feature exists
 */
export async function featureExists(featureName: string): Promise<boolean> {
  const fs = createFileSystem();
  const featureDir = getFeatureDirectory(featureName);

  try {
    const stat = await fs.stat(featureDir);
    return stat.isDirectory;
  } catch {
    return false;
  }
}
