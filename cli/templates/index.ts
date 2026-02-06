/**
 * Template registry for Veryfront CLI
 *
 * Templates are loaded from the `files/` directory as actual files.
 * This provides better IDE support (syntax highlighting, linting) compared
 * to inline string templates.
 */

import { loadTemplateFromDirectory, templateDirectoryExists } from "./loader.ts";
import type {
  EnvVarConfig,
  FeatureConfig,
  FeatureName,
  ResolvedFeature,
  TemplateConfig,
  TemplateFile,
  TemplateName,
} from "./types.ts";

export type {
  EnvVarConfig,
  FeatureConfig,
  FeatureName,
  ResolvedFeature,
  TemplateConfig,
  TemplateFile,
  TemplateName,
};

export {
  AVAILABLE_FEATURES,
  featureExists,
  loadFeature,
  loadFeatureConfig,
  mergeConfig,
  mergeDependencies,
  mergeFiles,
  resolveFeatures,
  validateFeatures,
} from "./feature-loader.ts";

export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
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

const DIRECTORY_BASED_TEMPLATES: TemplateName[] = ["minimal", "ai", "app", "blog", "docs"];

export async function getTemplate(name: TemplateName): Promise<TemplateFile[] | null> {
  if (name === "pages-router" || name === "app-router") {
    return getTemplate("minimal");
  }

  if (!DIRECTORY_BASED_TEMPLATES.includes(name)) {
    return null;
  }

  if (!(await templateDirectoryExists(name))) {
    return null;
  }

  const files = await loadTemplateFromDirectory(name);
  if (files.length === 0) {
    return null;
  }

  return files;
}

export function getTemplateConfig(name: TemplateName): TemplateConfig | null {
  return templateConfigs[name] ?? null;
}
