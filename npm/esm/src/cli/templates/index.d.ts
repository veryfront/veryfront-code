/**
 * Template registry for Veryfront CLI
 *
 * Templates are loaded from the `files/` directory as actual files.
 * This provides better IDE support (syntax highlighting, linting) compared
 * to inline string templates.
 */
import type { EnvVarConfig, FeatureConfig, FeatureName, ResolvedFeature, TemplateConfig, TemplateFile, TemplateName } from "./types.js";
export type { EnvVarConfig, FeatureConfig, FeatureName, ResolvedFeature, TemplateConfig, TemplateFile, TemplateName, };
export { AVAILABLE_FEATURES, featureExists, loadFeature, loadFeatureConfig, mergeConfig, mergeDependencies, mergeFiles, resolveFeatures, validateFeatures, } from "./feature-loader.js";
/**
 * Template configurations (env vars, etc.)
 */
export declare const templateConfigs: Partial<Record<TemplateName, TemplateConfig>>;
/**
 * Get a template by name.
 * Prefers directory-based templates.
 *
 * @param name - Template name
 * @returns Array of template files, or null if template not found
 */
export declare function getTemplate(name: TemplateName): Promise<TemplateFile[] | null>;
/**
 * Get template configuration (env vars, etc.)
 *
 * @param name - Template name
 * @returns Template configuration, or null if none defined
 */
export declare function getTemplateConfig(name: TemplateName): TemplateConfig | null;
export declare const templates: Record<string, TemplateFile[]>;
//# sourceMappingURL=index.d.ts.map