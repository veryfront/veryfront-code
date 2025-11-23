/**
 * Documentation site template for Veryfront
 *
 * This module composes all docs template components
 */

import type { TemplateFile } from "../blog.ts";
import { docsComponentTemplates } from "./components.ts";
import { docsConfigTemplates } from "./config.ts";
import { docsStaticTemplates } from "./static.ts";

export const docsTemplate: TemplateFile[] = [
  ...docsConfigTemplates,
  ...docsComponentTemplates,
  ...docsStaticTemplates,
];
