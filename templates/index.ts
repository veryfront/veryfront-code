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

/**
 * Markdown renderer dependencies for the chat starters.
 *
 * `veryfront/markdown` presents plain source until a renderer is installed, so
 * every starter that renders `<Chat>` scaffolds one in `app/markdown-renderer.tsx`
 * and installs the parser it uses. Versions are exact: these reach the browser
 * through the module pipeline, where a floating range would resolve to whatever
 * is latest at request time.
 */
const CHAT_MARKDOWN_DEPENDENCIES: Record<string, string> = {
  "react-markdown": "9.0.3",
  "remark-gfm": "4.0.1",
};

export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
  "ai-agent": {
    npmDependencies: { ...CHAT_MARKDOWN_DEPENDENCIES },
  },
  "coding-agent": {
    npmDependencies: { ...CHAT_MARKDOWN_DEPENDENCIES },
  },
  "multi-agent-system": {
    npmDependencies: { ...CHAT_MARKDOWN_DEPENDENCIES },
  },
  "saas-starter": {
    npmDependencies: { ...CHAT_MARKDOWN_DEPENDENCIES },
  },
  "docs-agent": {
    firstPartyExtensions: ["@veryfront/ext-document-kreuzberg"],
    npmDependencies: {
      ...CHAT_MARKDOWN_DEPENDENCIES,
      "@kreuzberg/node": "^4.4.2",
      "@kreuzberg/wasm": "4.5.2",
    },
  },
};

const DIRECTORY_BASED_TEMPLATES: TemplateName[] = [...STARTER_TEMPLATE_NAMES];

/**
 * The router aliases scaffold the `ai-agent` files, so they must resolve the
 * same config. Keeping the mapping in one place stops files and dependencies
 * from drifting apart.
 */
function resolveTemplateAlias(name: TemplateName): TemplateName {
  return name === "pages-router" || name === "app-router" ? "ai-agent" : name;
}

export async function getTemplate(name: TemplateName): Promise<TemplateFile[] | null> {
  const resolved = resolveTemplateAlias(name);
  if (resolved !== name) {
    return getTemplate(resolved);
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
  return templateConfigs[resolveTemplateAlias(name)] ?? null;
}

export function getAiRuleTemplate(templateName: string): Promise<string | null> {
  return loadAiRuleTemplate(templateName);
}
