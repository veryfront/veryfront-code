
import {
  getTemplateDirectory,
  loadTemplateFromDirectory,
  templateDirectoryExists,
} from "./loader.ts";
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

export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
  ai: aiTemplateConfig,
};

const DIRECTORY_BASED_TEMPLATES: TemplateName[] = ["minimal", "ai", "app", "blog", "docs"];

const legacyTemplates: Partial<Record<TemplateName, TemplateFile[]>> = {};

export async function getTemplate(name: TemplateName): Promise<TemplateFile[] | null> {
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

  const legacyTemplate = legacyTemplates[name];
  if (legacyTemplate) {
    return legacyTemplate;
  }

  if (name === "pages-router" || name === "app-router") {
    return getTemplate("minimal");
  }

  return null;
}

export function getTemplateConfig(name: TemplateName): TemplateConfig | null {
  return templateConfigs[name] || null;
}

export function getTemplateSync(name: TemplateName): TemplateFile[] | null {
  const legacyTemplate = legacyTemplates[name];
  if (legacyTemplate) {
    return legacyTemplate;
  }

  if (name === "pages-router" || name === "app-router") {
    return getTemplateSync("minimal");
  }

  return null;
}

export const templates: Record<string, TemplateFile[]> = {};
