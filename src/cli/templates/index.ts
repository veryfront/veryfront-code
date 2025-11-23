/**
 * Template registry for Veryfront CLI
 */

import { appTemplate } from "./app.ts";
import { blogTemplate } from "./blog.ts";
import { docsTemplate } from "./docs.ts";
import { minimalTemplate } from "./minimal.ts";

export interface TemplateFile {
  path: string;
  content: string;
}

export type TemplateName = "blog" | "docs" | "app" | "minimal" | "pages-router" | "app-router";

export const templates: Record<TemplateName, TemplateFile[]> = {
  blog: blogTemplate,
  docs: docsTemplate,
  app: appTemplate,
  minimal: minimalTemplate,
  // Legacy names for backward compatibility
  "pages-router": minimalTemplate,
  "app-router": minimalTemplate,
};

export function getTemplate(name: TemplateName): TemplateFile[] | null {
  return templates[name] || null;
}
