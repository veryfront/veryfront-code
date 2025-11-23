/**
 * Docs template - Page templates orchestrator
 * @module
 */

import type { TemplateFile } from "./types.ts";
import { layoutTemplate } from "./layout.ts";
import { homeTemplate } from "./home.ts";
import { gettingStartedTemplate } from "./getting-started.ts";
import { coreConceptsTemplate } from "./core-concepts.ts";
import { apiReferenceTemplate } from "./api-reference.ts";

/**
 * Complete collection of docs page templates
 *
 * Includes:
 * - Root layout with sidebar and header
 * - Home page with welcome content
 * - Getting started guide
 * - Core concepts documentation
 * - API reference documentation
 *
 * @returns Array of all page template files
 */
export const docsPageTemplates: TemplateFile[] = [
  layoutTemplate,
  homeTemplate,
  gettingStartedTemplate,
  coreConceptsTemplate,
  apiReferenceTemplate,
];
