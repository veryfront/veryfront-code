/**
 * Template registry for Veryfront CLI
 *
 * Templates are loaded from the `files/` directory as actual files.
 * This provides better IDE support (syntax highlighting, linting) compared
 * to inline string templates.
 */
import { loadTemplateFromDirectory, templateDirectoryExists } from "./loader.js";
// Re-export feature functions
export { AVAILABLE_FEATURES, featureExists, loadFeature, loadFeatureConfig, mergeConfig, mergeDependencies, mergeFiles, resolveFeatures, validateFeatures, } from "./feature-loader.js";
/**
 * Template configurations (env vars, etc.)
 */
export const templateConfigs = {
    ai: {
        envVars: [
            {
                name: "OPENAI_API_KEY",
                description: "Your OpenAI API key",
                required: true,
                sensitive: true,
                placeholder: "sk-...",
                docsUrl: "https://platform.openai.com/api-keys",
            },
        ],
    },
};
/**
 * Templates that use directory-based loading.
 * All templates now use directory-based loading for better maintainability.
 */
const DIRECTORY_BASED_TEMPLATES = ["minimal", "ai", "app", "blog", "docs"];
/**
 * Get a template by name.
 * Prefers directory-based templates.
 *
 * @param name - Template name
 * @returns Array of template files, or null if template not found
 */
export async function getTemplate(name) {
    if (name === "pages-router" || name === "app-router") {
        return getTemplate("minimal");
    }
    if (!DIRECTORY_BASED_TEMPLATES.includes(name)) {
        return null;
    }
    const exists = await templateDirectoryExists(name);
    if (!exists) {
        return null;
    }
    const files = await loadTemplateFromDirectory(name);
    return files.length > 0 ? files : null;
}
/**
 * Get template configuration (env vars, etc.)
 *
 * @param name - Template name
 * @returns Template configuration, or null if none defined
 */
export function getTemplateConfig(name) {
    return templateConfigs[name] ?? null;
}
// Legacy exports for backward compatibility
// All templates should be loaded via async getTemplate()
export const templates = {};
