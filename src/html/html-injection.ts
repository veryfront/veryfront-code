import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";
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
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import {
  type ConfiguredRouteDirectories,
  routeForConfiguredPage,
} from "#veryfront/release-assets/route-path.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { createBuildVersion } from "#veryfront/utils/version.ts";
import { insertBeforeHtmlHeadClose } from "./tag-scanner.ts";

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
  /** Hash of the rendered source for Studio navigator synchronization */
  sourceHash?: string;
  /** CSP nonce */
  nonce?: string;
  /** Deployment environment for hydration module selection */
  environment?: "preview" | "production";
  /** Whether the request is being served from a local project */
  isLocalProject?: boolean;
  /** Exact browser module transport authorized by the serving runtime. */
  clientModuleStrategy?: ClientModuleStrategy;
  /**
   * @deprecated Retained for source compatibility. The Studio bridge no
   * longer opens a direct Yjs connection.
   */
  wsUrl?: string;
  /**
   * @deprecated Retained for source compatibility. The Studio bridge no
   * longer joins Yjs rooms directly.
   */
  yjsGuid?: string;
  /** Pre-built import map JSON for ESM module resolution (injected into <head>) */
  importMapJson?: string;
  /** Framework-generated project stylesheet for production shells */
  projectStylesheetHref?: string;
  /** Ready release asset manifest used to hydrate full HTML client pages */
  releaseAssetManifest?: ReleaseAssetManifest | null;
  /** Configured route directories used to map physical page paths to route keys */
  directories?: ConfiguredRouteDirectories;
}

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  const normalizedPath = absolutePath.replace(/\\/g, "/");

  if (!projectDir) return normalizedPath.replace(/^\//, "");

  return resolveRelativePath(normalizedPath, projectDir);
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

  const frameworkHeadAssets: string[] = [];

  // Inject import map into <head> for ESM module resolution (must be before any module scripts)
  if (options.importMapJson) {
    const nonceAttr = buildNonceAttribute(options.nonce);
    const importMapTag = `<script type="importmap"${nonceAttr}>\n${
      escapeInlineJsonText(options.importMapJson)
    }\n</script>`;
    frameworkHeadAssets.push(importMapTag);
  }

  // Authored markup is not authoritative for framework CSS. Always inject the
  // caller-selected stylesheet instead of letting href-like text suppress it.
  if (options.projectStylesheetHref) {
    const projectStylesheetTag = `<link rel="stylesheet" href="${
      escapeHTML(options.projectStylesheetHref)
    }">`;
    frameworkHeadAssets.push(projectStylesheetTag);
  }

  const shouldUsePreviewStylesheet = options.mode === "development" ||
    options.environment === "preview";

  // Preview CSS follows the same rule: only this boundary selects the link.
  if (shouldUsePreviewStylesheet) {
    frameworkHeadAssets.push(getPreviewStylesheetLink());
  }

  if (frameworkHeadAssets.length > 0) {
    html = insertBeforeHtmlHeadClose(
      html,
      `${frameworkHeadAssets.join("\n")}\n`,
    );
  }

  const hasBodyClose = /<\/body>/i.test(html);

  // Inject hydration data for 'use client' pages (before scripts, so client.js can find it)
  if (options.pagePath && options.isClientPage && hasBodyClose) {
    // Serialize with jsonForInlineScript, not raw JSON.stringify: route params
    // (and slug) are URL-derived and decoded, so a segment like `%3C/script%3E`
    // would otherwise break out of the <script> tag (reflected XSS). This escapes
    // `<`, `>`, `&`, and line separators, matching the main shell hydration path.
    const pagePath = toProjectRelativePath(options.pagePath, options.projectDir);
    const releaseManifest = options.studioEmbed ? null : options.releaseAssetManifest;
    const hydrationData = jsonForInlineScript({
      pagePath,
      slug: options.slug,
      params: options.params ?? {},
      props: {},
      layouts: [],
      clientModuleStrategy: options.clientModuleStrategy === "fs" ? "fs" : "rsc-module",
      releaseId: releaseManifest?.releaseId,
      releaseAssetModules: buildReleaseAssetModules(releaseManifest, {
        route: routeForConfiguredPage(pagePath, options.directories),
      }),
      buildVersion: createBuildVersion(),
      dev: options.mode === "development",
      studioEmbed: options.studioEmbed,
    });
    const nonceAttr = buildNonceAttribute(options.nonce);
    const hydrationScript =
      `<script id="veryfront-hydration-data" type="application/json"${nonceAttr}>${hydrationData}</script>`;
    html = replaceLiteral(html, /<\/body>/i, `${hydrationScript}</body>`);
  }

  if (options.clientModuleStrategy === "fs") {
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
      pagePath: options.pagePath
        ? toProjectRelativePath(options.pagePath, options.projectDir)
        : undefined,
      nonce: options.nonce,
      sourceHash: options.sourceHash,
    });
    html = replaceLiteral(html, /<\/body>/i, `${studioScripts}</body>`);
  }

  return html;
}
