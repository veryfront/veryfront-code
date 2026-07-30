/**
 * Template registry for Veryfront CLI
 *
 * Templates are loaded from the `files/` directory as actual files.
 * This provides better IDE support (syntax highlighting, linting) compared
 * to inline string templates.
 */

import {
  loadAiRuleTemplate,
  loadTemplateFromDirectory,
  templateDirectoryExists,
} from "./loader.ts";
import { STARTER_TEMPLATE_NAMES } from "./types.ts";
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

const CSS_PROCESSOR_EXTENSION = "@veryfront/ext-css-tailwind";
const NODE_WEBSOCKET_EXTENSION = "@veryfront/ext-node-websocket-ws";
const STANDARD_FIRST_PARTY_EXTENSIONS = [
  CSS_PROCESSOR_EXTENSION,
  NODE_WEBSOCKET_EXTENSION,
];

export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
  "minimal": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "ai-agent": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "docs-agent": {
    firstPartyExtensions: [
      ...STANDARD_FIRST_PARTY_EXTENSIONS,
      "@veryfront/ext-document-kreuzberg",
    ],
    npmDependencies: {
      "@kreuzberg/node": "^4.4.2",
      "@kreuzberg/wasm": "4.5.2",
    },
  },
  "multi-agent-system": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "agentic-workflow": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "coding-agent": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "saas-starter": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "pages-router": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
  "app-router": {
    firstPartyExtensions: [...STANDARD_FIRST_PARTY_EXTENSIONS],
  },
};

const DIRECTORY_BASED_TEMPLATES: TemplateName[] = [...STARTER_TEMPLATE_NAMES];

export async function getTemplate(name: TemplateName): Promise<TemplateFile[] | null> {
  if (name === "pages-router" || name === "app-router") {
    return getTemplate("ai-agent");
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

export function getAiRuleTemplate(templateName: string): string | null {
  return loadAiRuleTemplate(templateName);
}
