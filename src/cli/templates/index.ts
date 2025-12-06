/**
 * Template registry for Veryfront CLI
 *
 * Templates are loaded from the `files/` directory as actual files.
 * This provides better IDE support (syntax highlighting, linting) compared
 * to inline string templates.
 */

import {
  getTemplateDirectory,
  loadTemplateFromDirectory,
  templateDirectoryExists,
} from "./loader.ts";
import type { EnvVarConfig, TemplateConfig, TemplateFile, TemplateName } from "./types.ts";

// Re-export types
export type { EnvVarConfig, TemplateConfig, TemplateFile, TemplateName };

/**
 * AI template configuration including required environment variables
 */
const aiTemplateConfig: TemplateConfig = {
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
};

/**
 * Template configurations (env vars, etc.)
 */
export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
  ai: aiTemplateConfig,
};

/**
 * Templates that use directory-based loading.
 * All templates now use directory-based loading for better maintainability.
 */
const DIRECTORY_BASED_TEMPLATES: TemplateName[] = ["minimal", "ai", "app", "blog", "docs"];

/**
 * Legacy inline templates (for backward compatibility during migration).
 * All templates have been migrated to directory-based templates.
 */
const legacyTemplates: Partial<Record<TemplateName, TemplateFile[]>> = {};

/**
 * Get a template by name.
 * Prefers directory-based templates, falls back to inline templates.
 *
 * @param name - Template name
 * @returns Array of template files, or null if template not found
 */
export async function getTemplate(name: TemplateName): Promise<TemplateFile[] | null> {
  // Try directory-based template first
  if (DIRECTORY_BASED_TEMPLATES.includes(name)) {
    const exists = await templateDirectoryExists(name);
    if (exists) {
      const templateDir = getTemplateDirectory(name);
      const files = await loadTemplateFromDirectory(templateDir);
      if (files.length > 0) {
        return files;
      }
    }
  }

  // Fall back to legacy inline template
  const legacyTemplate = legacyTemplates[name];
  if (legacyTemplate) {
    return legacyTemplate;
  }

  // Handle aliases
  if (name === "pages-router" || name === "app-router") {
    return getTemplate("minimal");
  }

  return null;
}

/**
 * Get template configuration (env vars, etc.)
 *
 * @param name - Template name
 * @returns Template configuration, or null if none defined
 */
export function getTemplateConfig(name: TemplateName): TemplateConfig | null {
  return templateConfigs[name] || null;
}

/**
 * Synchronous version of getTemplate for backward compatibility.
 * Only returns inline templates. Use async getTemplate() for directory-based templates.
 *
 * @deprecated Use the async getTemplate() function instead
 */
export function getTemplateSync(name: TemplateName): TemplateFile[] | null {
  const legacyTemplate = legacyTemplates[name];
  if (legacyTemplate) {
    return legacyTemplate;
  }

  // Handle aliases
  if (name === "pages-router" || name === "app-router") {
    return getTemplateSync("minimal");
  }

  return null;
}

// Legacy exports for backward compatibility
// All templates should be loaded via async getTemplate()
export const templates: Record<string, TemplateFile[]> = {};
