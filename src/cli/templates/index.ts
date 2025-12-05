/**
 * Template registry for Veryfront CLI
 */

import { appTemplate } from "./app.ts";
import { blogTemplate } from "./blog.ts";
import { docsTemplate } from "./docs.ts";
import { minimalTemplate } from "./minimal.ts";
import { aiTemplate, aiTemplateConfig } from "./ai.ts";

export interface TemplateFile {
  path: string;
  content: string;
}

/**
 * Configuration for an environment variable required by a template
 */
export interface EnvVarConfig {
  /** Environment variable name (e.g., "OPENAI_API_KEY") */
  name: string;
  /** Human-readable description shown during prompting */
  description: string;
  /** Whether this env var is required for the template to function */
  required: boolean;
  /** Whether to mask input (for API keys/secrets) */
  sensitive?: boolean;
  /** Placeholder value for .env.example */
  placeholder?: string;
  /** URL to documentation for obtaining this value */
  docsUrl?: string;
}

/**
 * Template configuration including env var requirements
 */
export interface TemplateConfig {
  /** Environment variables this template needs */
  envVars?: EnvVarConfig[];
}

export type TemplateName =
  | "blog"
  | "docs"
  | "app"
  | "minimal"
  | "ai"
  | "pages-router"
  | "app-router";

export const templates: Record<TemplateName, TemplateFile[]> = {
  blog: blogTemplate,
  docs: docsTemplate,
  app: appTemplate,
  minimal: minimalTemplate,
  ai: aiTemplate,
  "pages-router": minimalTemplate,
  "app-router": minimalTemplate,
};

export const templateConfigs: Partial<Record<TemplateName, TemplateConfig>> = {
  ai: aiTemplateConfig,
};

export function getTemplate(name: TemplateName): TemplateFile[] | null {
  return templates[name] || null;
}

export function getTemplateConfig(name: TemplateName): TemplateConfig | null {
  return templateConfigs[name] || null;
}
