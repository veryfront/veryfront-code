import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import { getDevScripts, getDevStyles, getProdScripts, getStudioScripts } from "./dev-scripts.ts";

export interface InjectHTMLContentOptions {
  mode: string;
  slug: string;
  devPort?: number;
  /** Absolute path to the page file, used for 'use client' hydration */
  pagePath?: string;
  /** Whether the page has 'use client' directive */
  isClientPage?: boolean;
  /** Whether page is embedded in Studio iframe */
  studioEmbed?: boolean;
  /** Project ID for Studio communication */
  projectId?: string;
  /** Page ID for Studio communication */
  pageId?: string;
  /** CSP nonce */
  nonce?: string;
  /** WebSocket URL for direct Yjs connection from the bridge */
  wsUrl?: string;
  /** Yjs document GUID for the bridge to join the same room */
  yjsGuid?: string;
}

export function injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string {
  let html = template;

  html = html.replace(/{{\s*content\s*}}/gi, content);
  html = html.replace(/{{\s*title\s*}}/gi, metadata.title ?? "");
  html = html.replace(/{{\s*description\s*}}/gi, metadata.description ?? "");

  if (/{{\s*meta\s*}}/i.test(html)) {
    html = html.replace(/{{\s*meta\s*}}/gi, generateMetaTags(metadata));
  }

  if (/{{\s*links\s*}}/i.test(html)) {
    html = html.replace(/{{\s*links\s*}}/gi, generateLinkTags(metadata));
  }

  if (/{{\s*scripts\s*}}/i.test(html)) {
    html = html.replace(/{{\s*scripts\s*}}/gi, generateScriptTags(metadata));
  }

  if (/{{\s*styles\s*}}/i.test(html)) {
    html = html.replace(/{{\s*styles\s*}}/gi, generateStyleTags(metadata));
  }

  const hasBodyClose = /<\/body>/i.test(html);

  // Inject hydration data for 'use client' pages (before scripts, so client.js can find it)
  if (options.pagePath && options.isClientPage && hasBodyClose) {
    const hydrationData = JSON.stringify({
      pagePath: options.pagePath,
      slug: options.slug,
      isClientPage: true,
    });
    const hydrationScript =
      `<script id="veryfront-hydration-data" type="application/json">${hydrationData}</script>`;
    html = html.replace(/<\/body>/i, `${hydrationScript}</body>`);
  }

  if (options.mode === "development") {
    const hasDevScriptsPlaceholder = /{{\s*devScripts\s*}}/i.test(html);

    if (hasDevScriptsPlaceholder) {
      html = html.replace(/{{\s*devScripts\s*}}/gi, getDevScripts());
    }

    html = html.replace(/{{\s*devStyles\s*}}/gi, getDevStyles());

    if (!hasDevScriptsPlaceholder && hasBodyClose) {
      html = html.replace(/<\/body>/i, `${getDevStyles()}${getDevScripts()}</body>`);
    }
  } else {
    html = html.replace(/{{\s*devScripts\s*}}/gi, "");
    html = html.replace(/{{\s*devStyles\s*}}/gi, "");

    const prodScripts = getProdScripts(options.slug);
    const hasProdScriptsPlaceholder = /{{\s*prodScripts\s*}}/i.test(html);

    if (hasProdScriptsPlaceholder) {
      html = html.replace(/{{\s*prodScripts\s*}}/gi, prodScripts);
    } else if (hasBodyClose) {
      html = html.replace(/<\/body>/i, `${prodScripts}</body>`);
    }
  }

  // Inject Studio bridge script when embedded in Studio iframe
  if (options.studioEmbed && hasBodyClose) {
    const studioScripts = getStudioScripts({
      projectId: options.projectId ?? options.slug,
      pageId: options.pageId ?? options.slug,
      nonce: options.nonce,
      wsUrl: options.wsUrl,
      yjsGuid: options.yjsGuid,
    });
    html = html.replace(/<\/body>/i, `${studioScripts}</body>`);
  }

  return html;
}
