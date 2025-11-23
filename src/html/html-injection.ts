import type { HTMLMetadata } from "@veryfront/transforms/mdx/types.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import { getDevScripts, getDevStyles, getProdScripts } from "./dev-scripts.ts";
import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils/constants/server.ts";

export interface InjectHTMLContentOptions {
  mode: string;
  slug: string;
  devPort?: number;
}

export function injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string {
  let html = template;

  html = html.replace(/{{\s*content\s*}}/gi, content);
  html = html.replace(/{{\s*title\s*}}/gi, metadata.title || "");
  html = html.replace(/{{\s*description\s*}}/gi, metadata.description || "");

  if (/{{\s*meta\s*}}/i.test(html)) {
    const metaTags = generateMetaTags(metadata);
    html = html.replace(/{{\s*meta\s*}}/gi, metaTags);
  }

  if (/{{\s*links\s*}}/i.test(html)) {
    const linkTags = generateLinkTags(metadata);
    html = html.replace(/{{\s*links\s*}}/gi, linkTags);
  }

  if (/{{\s*scripts\s*}}/i.test(html)) {
    const scriptTags = generateScriptTags(metadata);
    html = html.replace(/{{\s*scripts\s*}}/gi, scriptTags);
  }

  if (/{{\s*styles\s*}}/i.test(html)) {
    const styleTags = generateStyleTags(metadata);
    html = html.replace(/{{\s*styles\s*}}/gi, styleTags);
  }

  if (options.mode === "development") {
    html = html.replace(
      /{{\s*devScripts\s*}}/gi,
      getDevScripts(options.slug, options.devPort || DEFAULT_DASHBOARD_PORT),
    );
    html = html.replace(/{{\s*devStyles\s*}}/gi, getDevStyles());
  } else {
    html = html.replace(/{{\s*devScripts\s*}}/gi, "");
    html = html.replace(/{{\s*devStyles\s*}}/gi, "");
    html = html.replace(/{{\s*prodScripts\s*}}/gi, getProdScripts(options.slug));
  }

  return html;
}
