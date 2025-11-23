/**
 * Full-stack app template for Veryfront
 *
 * This module composes all app template components
 */

import type { TemplateFile } from "../blog.ts";
import { appApiTemplates } from "./api.ts";
import { appConfigTemplates } from "./config.ts";
import { appMiddlewareTemplates } from "./middleware.ts";
import { appPageTemplates } from "./pages.ts";
import { appStaticTemplates } from "./static.ts";

export const appTemplate: TemplateFile[] = [
  ...appConfigTemplates,
  ...appPageTemplates,
  ...appApiTemplates,
  ...appMiddlewareTemplates,
  ...appStaticTemplates,
];
