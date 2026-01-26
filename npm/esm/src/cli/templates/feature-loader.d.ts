/**
 * Feature loader for composable templates
 *
 * Loads features from the features/ directory and handles:
 * - Feature file overlay
 * - Dependency merging
 * - Config merging
 * - Feature validation (requires/conflicts)
 */
import type { FeatureConfig, FeatureName, ResolvedFeature, TemplateFile } from "./types.js";
/**
 * Available features that can be added via --with flag
 */
export declare const AVAILABLE_FEATURES: FeatureName[];
/**
 * Get the directory path for a feature
 */
export declare function getFeatureDirectory(featureName: string): string;
/**
 * Load feature configuration from feature.json
 */
export declare function loadFeatureConfig(featureName: FeatureName): Promise<FeatureConfig | null>;
/**
 * Load a feature with its files
 */
export declare function loadFeature(featureName: FeatureName): Promise<ResolvedFeature | null>;
/**
 * Validate feature combinations
 */
export declare function validateFeatures(features: FeatureName[]): {
    valid: boolean;
    errors: string[];
};
/**
 * Resolve feature dependencies and order
 */
export declare function resolveFeatures(requestedFeatures: FeatureName[]): Promise<{
    ordered: FeatureName[];
    errors: string[];
}>;
/**
 * Merge feature files with base template files
 * Later files override earlier ones
 */
export declare function mergeFiles(baseFiles: TemplateFile[], featureFiles: TemplateFile[]): TemplateFile[];
/**
 * Merge dependencies from features
 */
export declare function mergeDependencies(baseDeps: Record<string, string>, featureDeps: Record<string, string>): Record<string, string>;
/**
 * Deep merge config objects
 */
export declare function mergeConfig(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown>;
/**
 * Check if a feature exists
 */
export declare function featureExists(featureName: string): Promise<boolean>;
//# sourceMappingURL=feature-loader.d.ts.map