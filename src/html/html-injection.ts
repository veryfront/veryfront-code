import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
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

const MAX_INJECTION_INPUT_PROPERTIES = 128;

function snapshotOwnDataRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} must be a plain object` });
  }

  let isArray: boolean;
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} cannot be inspected` });
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} must be a plain object` });
  }
  if (keys.length > MAX_INJECTION_INPUT_PROPERTIES) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} exceeds the property limit` });
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw INPUT_VALIDATION_FAILED.create({ detail: `${label} cannot be inspected` });
    }
    if (!descriptor) {
      throw INPUT_VALIDATION_FAILED.create({ detail: `${label} cannot be inspected` });
    }
    if (!descriptor.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw INPUT_VALIDATION_FAILED.create({ detail: `${label} cannot be inspected` });
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
}

function replaceLiteral(
  source: string,
  pattern: RegExp,
  replacement: string,
): string {
  return source.replace(pattern, () => replacement);
}

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
}

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  const normalizedPath = absolutePath.replace(/\\/g, "/");

  if (!projectDir) return normalizedPath.replace(/^\//, "");

  return resolveRelativePath(normalizedPath, projectDir);
}

function hasProjectStylesheet(html: string): boolean {
  return /id=["']vf-tailwind-css["']/i.test(html) ||
    /href=["'][^"']*\/_vf_styles\/styles\.css(?:\?[^"']*)?["']/i.test(html) ||
    /href=["'][^"']*\/_vf\/css\/[^"']+\.css["']/i.test(html);
}

export function injectHTMLContent(
  template: string,
  content: string,
  metadata: HTMLMetadata,
  options: InjectHTMLContentOptions,
): string {
  metadata = snapshotOwnDataRecord(metadata, "HTML metadata") as HTMLMetadata;
  options = snapshotOwnDataRecord(
    options,
    "HTML injection options",
  ) as unknown as InjectHTMLContentOptions;

  let html = template;

  html = replaceLiteral(html, /{{\s*content\s*}}/gi, content);
  // Escape title and description: these come from user-authored frontmatter and
  // may appear in both text nodes and attribute values (e.g. <title> and <meta
  // content="">). escapeHTML handles &, <, >, ", and ' for both contexts.
  html = replaceLiteral(
    html,
    /{{\s*title\s*}}/gi,
    escapeHTML(metadata.title ?? ""),
  );
  html = replaceLiteral(
    html,
    /{{\s*description\s*}}/gi,
    escapeHTML(metadata.description ?? ""),
  );

  if (/{{\s*meta\s*}}/i.test(html)) {
    html = replaceLiteral(
      html,
      /{{\s*meta\s*}}/gi,
      generateMetaTags(metadata),
    );
  }

  if (/{{\s*links\s*}}/i.test(html)) {
    html = replaceLiteral(
      html,
      /{{\s*links\s*}}/gi,
      generateLinkTags(metadata),
    );
  }

  if (/{{\s*scripts\s*}}/i.test(html)) {
    html = replaceLiteral(
      html,
      /{{\s*scripts\s*}}/gi,
      generateScriptTags(metadata, options.nonce),
    );
  }

  if (/{{\s*styles\s*}}/i.test(html)) {
    html = replaceLiteral(
      html,
      /{{\s*styles\s*}}/gi,
      generateStyleTags(metadata, options.nonce),
    );
  }

  // Inject import map into <head> for ESM module resolution (must be before any module scripts)
  if (options.importMapJson && /<\/head>/i.test(html)) {
    const nonceAttr = buildNonceAttribute(options.nonce);
    const importMapTag = `<script type="importmap"${nonceAttr}>\n${
      escapeInlineJsonText(options.importMapJson)
    }\n</script>`;
    html = replaceLiteral(html, /<\/head>/i, `${importMapTag}\n</head>`);
  }

  if (options.projectStylesheetHref && /<\/head>/i.test(html) && !hasProjectStylesheet(html)) {
    const projectStylesheetTag = `<link rel="stylesheet" href="${options.projectStylesheetHref}">`;
    html = replaceLiteral(
      html,
      /<\/head>/i,
      `${projectStylesheetTag}\n</head>`,
    );
  }

  const shouldUsePreviewStylesheet = options.mode === "development" ||
    options.environment === "preview";

  if (shouldUsePreviewStylesheet && /<\/head>/i.test(html) && !hasProjectStylesheet(html)) {
    html = replaceLiteral(
      html,
      /<\/head>/i,
      `${getPreviewStylesheetLink()}\n</head>`,
    );
  }

  const hasBodyClose = /<\/body>/i.test(html);

  // Inject hydration data for 'use client' pages (before scripts, so client.js can find it)
  if (options.pagePath && options.isClientPage && hasBodyClose) {
    // Serialize with jsonForInlineScript, not raw JSON.stringify: route params
    // (and slug) are URL-derived and decoded, so a segment like `%3C/script%3E`
    // would otherwise break out of the <script> tag (reflected XSS). This escapes
    // `<`, `>`, `&`, and line separators, matching the main shell hydration path.
    const hydrationData = jsonForInlineScript({
      pagePath: toProjectRelativePath(options.pagePath, options.projectDir),
      slug: options.slug,
      isClientPage: true,
      params: options.params ?? {},
      clientModuleStrategy: determineClientModuleStrategy({
        isLocalProject: options.isLocalProject ?? options.mode === "development",
        environment: options.environment,
      }),
    });
    const nonceAttr = buildNonceAttribute(options.nonce);
    const hydrationScript =
      `<script id="veryfront-hydration-data" type="application/json"${nonceAttr}>${hydrationData}</script>`;
    html = replaceLiteral(html, /<\/body>/i, `${hydrationScript}</body>`);
  }

  if (options.mode === "development") {
    const hasDevScriptsPlaceholder = /{{\s*devScripts\s*}}/i.test(html);

    if (hasDevScriptsPlaceholder) {
      html = replaceLiteral(
        html,
        /{{\s*devScripts\s*}}/gi,
        getDevScripts(options.devPort, options.nonce),
      );
    }

    html = replaceLiteral(
      html,
      /{{\s*devStyles\s*}}/gi,
      getDevStyles(options.nonce),
    );

    if (!hasDevScriptsPlaceholder && hasBodyClose) {
      html = replaceLiteral(
        html,
        /<\/body>/i,
        `${getDevStyles(options.nonce)}${getDevScripts(options.devPort, options.nonce)}</body>`,
      );
    }
  } else {
    html = replaceLiteral(html, /{{\s*devScripts\s*}}/gi, "");
    html = replaceLiteral(html, /{{\s*devStyles\s*}}/gi, "");

    const prodScripts = getProdScripts(options.slug, options.nonce);
    const hasProdScriptsPlaceholder = /{{\s*prodScripts\s*}}/i.test(html);

    if (hasProdScriptsPlaceholder) {
      html = replaceLiteral(html, /{{\s*prodScripts\s*}}/gi, prodScripts);
    } else if (hasBodyClose) {
      html = replaceLiteral(html, /<\/body>/i, `${prodScripts}</body>`);
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
    html = replaceLiteral(html, /<\/body>/i, `${studioScripts}</body>`);
  }

  return html;
}
