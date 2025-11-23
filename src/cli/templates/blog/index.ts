/**
 * Blog template for Veryfront
 *
 * This module composes all blog template components
 */

import type { TemplateFile } from "../types.ts";
import { blogComponentTemplates } from "./components.ts";
import { blogConfigTemplates } from "./config.ts";
import { blogContentTemplates } from "./content.ts";
import { blogLibTemplates } from "./lib.ts";
import { blogPageTemplates } from "./pages.ts";
import { blogStaticTemplates } from "./static.ts";

export const blogTemplate: TemplateFile[] = [
  ...blogConfigTemplates,
  ...blogPageTemplates,
  ...blogContentTemplates,
  ...blogComponentTemplates,
  ...blogLibTemplates,
  ...blogStaticTemplates,
];
