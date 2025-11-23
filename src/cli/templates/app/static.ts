/**
 * App template - Static files
 */

import type { TemplateFile } from "../blog.ts";

export const appStaticTemplates: TemplateFile[] = [
  {
    path: "public/robots.txt",
    content: `User-agent: *
Allow: /

Sitemap: /sitemap.xml`,
  },
];
