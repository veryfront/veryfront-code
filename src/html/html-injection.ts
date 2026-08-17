import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import { buildNonceAttribute, escapeHTML } from "./html-escape.ts";
import {
  escapeInlineJsonText,
  jsonForInlineScript,
} from "#veryfront/security/client/html-sanitizer.ts";
import {
  getDevScripts,
  getDevStyles,
  getPreviewStylesheetLink,
  getProdScripts,
  getStudioScripts,
} from "./dev-scripts.ts";
import { getProdScriptsForPath } from "./hydration-script-builder/prod-scripts.ts";
import { PROJECT_STYLESHEET_IDS } from "./project-stylesheet-ids.ts";
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import {
  type ConfiguredRouteDirectories,
  routeForConfiguredPage,
} from "#veryfront/release-assets/route-path.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Presence checks are scoped to real stylesheet markup. Bare substrings such
// as `data-id="..."`, `data-href="..."`, non-stylesheet links, or a CSS URL
// in ordinary text must not suppress the required injection. The configured
// ids are regex-escaped before interpolation.
const PROJECT_STYLESHEET_ID_PATTERNS = PROJECT_STYLESHEET_IDS.map((id) =>
  new RegExp(
    `(?:^|\\s)id\\s*=\\s*(["'])${escapeRegExpLiteral(id)}\\1(?=\\s|/?>|$)`,
    "i",
  )
);
const STYLESHEET_ELEMENT_PATTERN = /<(?:link|style)\b[^>]*>/gi;
const STYLE_ELEMENT_PATTERN = /^<style\b/i;
const LINK_REL_ATTRIBUTE_PATTERN = /(?:^|\s)rel\s*=\s*(["'])([^"']*)\1(?=\s|\/?>|$)/i;
const LINK_HREF_ATTRIBUTE_PATTERN = /(?:^|\s)href\s*=\s*(["'])([^"']*)\1(?=\s|\/?>|$)/i;
const PREVIEW_PROJECT_STYLESHEET_PATTERN = /\/_vf_styles\/styles\.css(?:\?[^"']*)?$/i;
const PRODUCTION_PROJECT_STYLESHEET_PATTERN = /\/_vf\/css\/[^"']+\.css$/i;

export interface InjectHTMLContentOptions {
  mode: string;
  slug: string;
  devPort?: number;
  /** Absolute path to the page file, used for 'use client' hydration */
  pagePath?: string;
  /** Project root used to normalize absolute page paths in hydration data */
  projectDir?: string;
  /** Whether the page has 'use client' directive */
  isClientPage?: boolean;
  /**
   * Route params from the initial match, seeded into the 'use client' hydration
   * payload so full-HTML-document client pages hydrate with their params
   * instead of an empty object (issue #2741). Catch-all arrays are preserved;
   * the client runtime joins them (issue #2742).
   */
  params?: Record<string, string | string[]>;
  /** Whether page is embedded in Studio iframe */
  studioEmbed?: boolean;
  /** Project ID for Studio communication */
  projectId?: string;
  /** Page ID for Studio communication */
  pageId?: string;
  /** CSP nonce */
  nonce?: string;
  /** Deployment environment for hydration module selection */
  environment?: "preview" | "production";
  /** Whether the request is being served from a local project */
  isLocalProject?: boolean;
  /** WebSocket URL for direct Yjs connection from the bridge */
  wsUrl?: string;
  /** Yjs document GUID for the bridge to join the same room */
  yjsGuid?: string;
  /** Pre-built import map JSON for ESM module resolution (injected into <head>) */
  importMapJson?: string;
  /** Framework-generated project stylesheet for production shells */
  projectStylesheetHref?: string;
  /** Request-scoped dependency snapshot used to version RSC module imports. */
  dependencyPinningCacheKey?: string;
  /** Ready release asset manifest used to hydrate full HTML client pages */
  releaseAssetManifest?: ReleaseAssetManifest | null;
  /** Production hydration runtime selected from the rendered artifact set */
  prodHydrationModulePath?: string;
  /** Configured route directories used to map physical page paths to route keys */
  directories?: ConfiguredRouteDirectories;
}

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  const normalizedPath = absolutePath.replace(/\\/g, "/");

  if (!projectDir) return normalizedPath.replace(/^\//, "");

  return resolveRelativePath(normalizedPath, projectDir);
}

function hasProjectStylesheet(html: string): boolean {
  for (const match of html.matchAll(STYLESHEET_ELEMENT_PATTERN)) {
    const element = match[0];
    const hasProjectId = PROJECT_STYLESHEET_ID_PATTERNS.some((pattern) => pattern.test(element));
    if (STYLE_ELEMENT_PATTERN.test(element)) {
      if (hasProjectId) return true;
      continue;
    }

    const rel = LINK_REL_ATTRIBUTE_PATTERN.exec(element)?.[2];
    if (!rel?.split(/\s+/).some((token) => token.toLowerCase() === "stylesheet")) {
      continue;
    }
    if (hasProjectId) return true;

    const href = LINK_HREF_ATTRIBUTE_PATTERN.exec(element)?.[2];
    if (
      href &&
      (PREVIEW_PROJECT_STYLESHEET_PATTERN.test(href) ||
        PRODUCTION_PROJECT_STYLESHEET_PATTERN.test(href))
    ) {
      return true;
    }
  }

  return false;
}

export function injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string {
  let html = template;

  html = html.replace(/{{\s*content\s*}}/gi, content);
  // Escape title and description: these come from user-authored frontmatter and
  // may appear in both text nodes and attribute values (e.g. <title> and <meta
  // content="">). escapeHTML handles &, <, >, ", and ' for both contexts.
  html = html.replace(/{{\s*title\s*}}/gi, escapeHTML(metadata.title ?? ""));
  html = html.replace(/{{\s*description\s*}}/gi, escapeHTML(metadata.description ?? ""));

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

  // Inject import map into <head> for ESM module resolution (must be before any module scripts)
  if (options.importMapJson && /<\/head>/i.test(html)) {
    const nonceAttr = buildNonceAttribute(options.nonce);
    const importMapTag = `<script type="importmap"${nonceAttr}>\n${
      escapeInlineJsonText(options.importMapJson)
    }\n</script>`;
    html = html.replace(/<\/head>/i, `${importMapTag}\n</head>`);
  }

  if (options.projectStylesheetHref && /<\/head>/i.test(html) && !hasProjectStylesheet(html)) {
    const projectStylesheetTag = `<link rel="stylesheet" href="${options.projectStylesheetHref}">`;
    html = html.replace(/<\/head>/i, `${projectStylesheetTag}\n</head>`);
  }

  const shouldUsePreviewStylesheet = options.mode === "development" ||
    options.environment === "preview";

  if (shouldUsePreviewStylesheet && /<\/head>/i.test(html) && !hasProjectStylesheet(html)) {
    html = html.replace(/<\/head>/i, `${getPreviewStylesheetLink()}\n</head>`);
  }

  const hasBodyOpen = /<body\b[^>]*>/i.test(html);
  const hasBodyClose = /<\/body>/i.test(html);

  const clientPagePath = options.isClientPage === true ? options.pagePath : undefined;
  const dependencyPinningCacheKey = options.dependencyPinningCacheKey?.startsWith("on:")
    ? options.dependencyPinningCacheKey
    : undefined;

  // Client pages need the full hydration payload. Other full documents still
  // need the immutable dependency token before client.js boots so any RSC
  // transport it starts remains on the document's snapshot.
  if ((clientPagePath || dependencyPinningCacheKey) && hasBodyOpen && hasBodyClose) {
    // Serialize with jsonForInlineScript, not raw JSON.stringify: route params
    // (and slug) are URL-derived and decoded, so a segment like `%3C/script%3E`
    // would otherwise break out of the <script> tag (reflected XSS). This escapes
    // `<`, `>`, `&`, and line separators, matching the main shell hydration path.
    const hydrationData = jsonForInlineScript({
      ...(clientPagePath
        ? {
          pagePath: toProjectRelativePath(clientPagePath, options.projectDir),
          slug: options.slug,
          isClientPage: true,
          params: options.params ?? {},
          clientModuleStrategy: determineClientModuleStrategy({
            isLocalProject: options.isLocalProject ?? options.mode === "development",
            environment: options.environment,
          }),
          releaseAssetModules: buildReleaseAssetModules(options.releaseAssetManifest, {
            route: routeForConfiguredPage(
              toProjectRelativePath(clientPagePath, options.projectDir),
              options.directories,
            ),
          }),
        }
        : {}),
      ...(dependencyPinningCacheKey ? { dependencyPinningCacheKey } : {}),
    });
    const nonceAttr = buildNonceAttribute(options.nonce);
    const hydrationScript =
      `<script id="veryfront-hydration-data" type="application/json"${nonceAttr}>${hydrationData}</script>`;
    html = html.replace(
      /<body\b[^>]*>/i,
      (openingBody) => `${openingBody}${hydrationScript}`,
    );
  }

  if (options.mode === "development") {
    const hasDevScriptsPlaceholder = /{{\s*devScripts\s*}}/i.test(html);

    if (hasDevScriptsPlaceholder) {
      html = html.replace(/{{\s*devScripts\s*}}/gi, getDevScripts(options.devPort, options.nonce));
    }

    html = html.replace(/{{\s*devStyles\s*}}/gi, getDevStyles(options.nonce));

    if (!hasDevScriptsPlaceholder && hasBodyClose) {
      html = html.replace(
        /<\/body>/i,
        `${getDevStyles(options.nonce)}${getDevScripts(options.devPort, options.nonce)}</body>`,
      );
    }
  } else {
    html = html.replace(/{{\s*devScripts\s*}}/gi, "");
    html = html.replace(/{{\s*devStyles\s*}}/gi, "");

    const prodScripts = options.prodHydrationModulePath
      ? getProdScriptsForPath(options.prodHydrationModulePath, options.nonce)
      : getProdScripts(options.slug, options.nonce);
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
