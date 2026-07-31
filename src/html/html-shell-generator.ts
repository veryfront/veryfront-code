import type { ComponentProps } from "#veryfront/types";
import { profilePhase, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { isMarkdownPreview as checkMarkdownPreview } from "#veryfront/transforms/md/utils.ts";
import {
  getReadyManifestForRenderAsync,
  isReleaseAssetManifestEnabled,
} from "#veryfront/release-assets/manifest-cache.ts";
import {
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
  releaseAssetUrl,
} from "#veryfront/release-assets/constants.ts";
import {
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "#veryfront/release-assets/html-consumption.ts";
import { routeForConfiguredPage } from "#veryfront/release-assets/route-path.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { buildNonceAttribute, escapeHTML } from "./html-escape.ts";
import { buildMarkdownMermaidScript } from "./markdown-mermaid-script.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdHydrationModulePath,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import { getPreviewStylesheetLink, getStudioScripts } from "./dev-scripts.ts";
import { type HTMLRenderMetadata, processMetadata } from "./metadata-builder.ts";
import {
  extractCandidates,
  getDevStyles as getErrorOverlayStyles,
  getProjectCSS,
} from "./styles-builder/index.ts";
import type { HTMLGenerationOptions } from "./types.ts";
import { buildImportMap, buildRootAttributes, shouldDisableLayout } from "./utils.ts";
import { appendDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  assertHTMLJsonValueIsNotProxy,
  snapshotHTMLJsonRecord,
  snapshotHTMLJsonValue,
} from "./json-snapshot.ts";
import { resolveCanonicalProjectRelativePath } from "./project-relative-path.ts";
import { snapshotHTMLShellConfig } from "./html-config-snapshot.ts";

const MAX_HTML_SHELL_INPUT_FIELDS = 256;

function snapshotShellInput<T extends object>(
  value: T,
  label: string,
): T {
  return snapshotHTMLJsonRecord(value, label, {
    accessorError: `${label} must not contain accessor properties`,
    maxProperties: MAX_HTML_SHELL_INPUT_FIELDS,
  });
}

function snapshotProjectClasses(value: unknown): Set<string> | undefined {
  if (value === undefined) return undefined;
  assertHTMLJsonValueIsNotProxy(value, "HTML shell project classes");
  if (typeof value !== "object" || value === null) {
    throw new TypeError("HTML shell project classes must be a plain Set");
  }

  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new TypeError("HTML shell project classes cannot be inspected");
  }
  if (prototype !== Set.prototype) {
    throw new TypeError("HTML shell project classes must be a plain Set");
  }

  const classes = new Set<string>();
  try {
    for (const className of Set.prototype.values.call(value as Set<unknown>)) {
      if (typeof className !== "string") {
        throw new TypeError("HTML shell project classes must contain strings");
      }
      classes.add(className);
      if (classes.size > 100_000) {
        throw new TypeError("HTML shell project classes exceed the entry limit");
      }
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("HTML shell")) throw error;
    throw new TypeError("HTML shell project classes cannot be inspected");
  }
  return classes;
}

function snapshotShellOptions(options: HTMLGenerationOptions): HTMLGenerationOptions {
  const label = "HTML shell options";
  assertHTMLJsonValueIsNotProxy(options, label);
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} must be a plain object`);
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (keys.length > MAX_HTML_SHELL_INPUT_FIELDS) {
    throw new TypeError(`${label} exceeds the field limit`);
  }

  const jsonOptions = Object.create(null) as Record<string, unknown>;
  let projectClasses: Set<string> | undefined;
  let config: HTMLGenerationOptions["config"] | undefined;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(options, key);
    } catch {
      throw new TypeError(`${label} cannot be inspected`);
    }
    if (!descriptor?.enumerable) continue;
    if (
      typeof key !== "string" || descriptor.get || descriptor.set ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} must not contain accessor properties`);
    }
    if (key === "projectClasses") {
      projectClasses = snapshotProjectClasses(descriptor.value);
      continue;
    }
    if (key === "config") {
      config = snapshotHTMLShellConfig(descriptor.value);
      continue;
    }
    if (descriptor.value === undefined) continue;
    Object.defineProperty(jsonOptions, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }

  const snapshot = snapshotHTMLJsonValue(
    jsonOptions,
    label,
  ) as unknown as HTMLGenerationOptions;
  if (config !== undefined) snapshot.config = config;
  if (projectClasses !== undefined) snapshot.projectClasses = projectClasses;
  return snapshot;
}

function snapshotShellInputs(
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
): {
  meta: HTMLRenderMetadata;
  options: HTMLGenerationOptions;
  params: Record<string, string | string[]> | undefined;
  props: ComponentProps | undefined;
} {
  return {
    meta: snapshotShellInput(meta, "HTML shell metadata"),
    options: snapshotShellOptions(options),
    params: params === undefined
      ? undefined
      : snapshotHTMLJsonValue(params, "HTML shell route params"),
    props: props === undefined
      ? undefined
      : snapshotHTMLJsonValue(props, "HTML shell component props"),
  };
}

function pathToModuleUrl(
  path: string,
  studioEmbed?: boolean,
  manifest?: ReleaseAssetManifest | null,
  fallbackReleaseId?: string,
  dependencyPinningCacheKey?: string,
): string {
  if (!path) return "";

  // Manifest hit → content-addressed asset URL (production only; never in
  // studio-embed). Miss falls through to the existing URL (per-entry fallback).
  if (manifest && !studioEmbed) {
    const assetUrl = resolveManifestModuleUrl(manifest, path);
    if (assetUrl) return assetUrl;
  }

  const hasSourceExtension = /\.(?:tsx?|jsx?|mdx?|mjs)$/.test(path);
  // Match the hydration loader exactly: explicit source extensions identify
  // one authored module and must not collapse onto a same-basename sibling.
  // Authored JavaScript gets a second suffix to distinguish it from the legacy
  // extensionless compiled-module endpoint.
  const requestPath = /\.(?:mjs|js)$/.test(path)
    ? `${path}.js`
    : hasSourceExtension
    ? path
    : `${path}.js`;
  const urlBase = `/_vf_modules/${requestPath}`;

  const moduleUrl = studioEmbed
    ? `${urlBase}?studio_embed=true`
    : fallbackReleaseId
    ? appendReleaseModuleVersion(urlBase, fallbackReleaseId)
    : urlBase;
  return appendDependencyPinningPathKey(moduleUrl, dependencyPinningCacheKey);
}

function appendReleaseModuleVersion(url: string, releaseId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    [RELEASE_MODULE_VERSION_PARAM]: releaseId,
    [RELEASE_MODULE_RUNTIME_VERSION_PARAM]: VERSION,
  });
  return `${url}${separator}${params.toString()}`;
}

function getRelativePagePath(
  fullPath: string | undefined,
  projectDir: string | undefined,
): string {
  if (!fullPath) return "";
  return resolveCanonicalProjectRelativePath(
    fullPath,
    projectDir,
    { module: true },
  ) ?? "";
}

type ProjectCSSResult = Awaited<ReturnType<typeof getProjectCSS>> | null;

type ProjectCSSSettlement =
  | { status: "fulfilled"; value: ProjectCSSResult }
  | { status: "rejected"; reason: unknown };

type ProjectCSSObservation = Promise<ProjectCSSSettlement>;

function observeProjectCSSPromise(
  projectCSSPromise: Promise<ProjectCSSResult>,
): ProjectCSSObservation {
  return projectCSSPromise.then(
    (value): ProjectCSSSettlement => ({ status: "fulfilled", value }),
    (reason): ProjectCSSSettlement => ({ status: "rejected", reason }),
  );
}

function reportUnusedProjectCSSObservation(
  projectCSSObservation: ProjectCSSObservation,
  reason: "release" | "non-production",
): void {
  void projectCSSObservation.then((settlement) => {
    if (settlement.status === "fulfilled") return;
    const error = settlement.reason;
    serverLogger.debug("Unused prefetched project CSS preparation failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function consumeProjectCSSObservation(
  projectCSSObservation: ProjectCSSObservation,
): Promise<ProjectCSSResult> {
  const settlement = await projectCSSObservation;
  if (settlement.status === "rejected") throw settlement.reason;
  return settlement.value;
}

export type LinkedStylesheetArtifact =
  | { kind: "project"; hash: string; css: string }
  | { kind: "release"; hash: string };

export interface HTMLShellPartsWithStylesheetArtifact {
  start: string;
  end: string;
  stylesheet: LinkedStylesheetArtifact | undefined;
}

function resolveProjectCSSScope(
  options: HTMLGenerationOptions,
  metaSlug?: string,
): string {
  return options.projectSlug || options.projectId || metaSlug || "default";
}

function generateModulePreloadHints(
  options: HTMLGenerationOptions,
  releaseManifest: ReleaseAssetManifest | null,
): string {
  const hints: string[] = [];
  const addedUrls = new Set<string>();
  const projectDir = options.projectDir ?? "";
  const studioEmbed = options.studioEmbed;
  // A ready manifest can intentionally cover only dependencies. Keep every
  // uncovered project module on the release-scoped JIT path instead of
  // treating the mere presence of a manifest as complete module coverage.
  const fallbackReleaseId = !studioEmbed && isReleaseAssetManifestEnabled()
    ? options.releaseId || releaseManifest?.releaseId
    : undefined;

  function addHint(moduleUrl: string): void {
    if (!moduleUrl || addedUrls.has(moduleUrl)) return;
    hints.push(`<link rel="modulepreload" href="${escapeHTML(moduleUrl)}">`);
    addedUrls.add(moduleUrl);
  }

  if (options.pagePath) {
    const relativePath = getRelativePagePath(options.pagePath, projectDir);
    addHint(
      pathToModuleUrl(
        relativePath,
        studioEmbed,
        releaseManifest,
        fallbackReleaseId,
        options.dependencyPinningCacheKey,
      ),
    );
  }

  for (const layout of options.nestedLayouts ?? []) {
    const layoutPath = layout.path ?? layout.componentPath ?? "";
    if (!layoutPath) continue;

    const relativePath = getRelativePagePath(layoutPath, projectDir);
    addHint(
      pathToModuleUrl(
        relativePath,
        studioEmbed,
        releaseManifest,
        fallbackReleaseId,
        options.dependencyPinningCacheKey,
      ),
    );
  }

  // Skip manifest-based preloads in preview/studio-embed mode:
  // HMR reloads modules with ?t=timestamp, so preloaded versions won't match
  // and the browser will warn about unused preloads.
  if (studioEmbed || options.environment === "preview") {
    return hints.join("\n  ");
  }

  const relativePagePath = options.pagePath
    ? getRelativePagePath(options.pagePath, projectDir)
    : "";
  const releaseManifestRoute = relativePagePath
    ? routeForConfiguredPage(relativePagePath, options.config?.directories) ?? ""
    : "";

  // Manifest-covered routes: preload the full closure from the manifest.
  if (releaseManifest) {
    for (const url of resolveManifestRoutePreloadUrls(releaseManifest, releaseManifestRoute)) {
      addHint(url);
    }
    return hints.join("\n  ");
  }

  return hints.join("\n  ");
}

export async function generateHTMLShellParts(
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  stylesheetCandidateSource?: string,
  projectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<{ start: string; end: string }> {
  const { start, end } = await generateHTMLShellPartsWithStylesheetArtifact(
    meta,
    options,
    params,
    props,
    stylesheetCandidateSource,
    projectCSSPromise,
  );
  return { start, end };
}

export async function generateHTMLShellPartsWithStylesheetArtifact(
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  stylesheetCandidateSource?: string,
  projectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<HTMLShellPartsWithStylesheetArtifact> {
  const snapshot = snapshotShellInputs(meta, options, params, props);
  const projectCSSObservation = projectCSSPromise
    ? observeProjectCSSPromise(projectCSSPromise)
    : undefined;
  return await generateHTMLShellPartsWithObservedStylesheetArtifact(
    snapshot.meta,
    snapshot.options,
    snapshot.params,
    snapshot.props,
    stylesheetCandidateSource,
    projectCSSObservation,
  );
}

async function generateHTMLShellPartsWithObservedStylesheetArtifact(
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  stylesheetCandidateSource?: string,
  projectCSSObservation?: ProjectCSSObservation,
): Promise<HTMLShellPartsWithStylesheetArtifact> {
  return await withSpan(
    SpanNames.HTML_GENERATE_SHELL_PARTS,
    () =>
      generateHTMLShellPartsImpl(
        meta,
        options,
        params,
        props,
        stylesheetCandidateSource,
        projectCSSObservation,
      ),
    {
      "html.slug": meta.slug || "",
      "html.has_stylesheet_candidate_source": !!stylesheetCandidateSource,
      "html.mode": options.mode || "production",
      "html.is_local_project": options.isLocalProject ?? false,
    },
  );
}

async function generateHTMLShellPartsImpl(
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  stylesheetCandidateSource?: string,
  prefetchedProjectCSSObservation?: ProjectCSSObservation,
): Promise<HTMLShellPartsWithStylesheetArtifact> {
  const stylesheetContent = options.globalCSS;

  const isLocalProject = options.isLocalProject ?? false;
  const isPreviewMode = options.environment === "preview";
  const useProductionCSS = !isLocalProject && options.environment === "production";

  // Use projectClasses (extracted from ALL source files) + current page as fallback
  const candidates = new Set<string>(options.projectClasses ?? []);
  if (stylesheetCandidateSource) {
    for (const candidate of extractCandidates(stylesheetCandidateSource)) candidates.add(candidate);
  }

  const projectSlug = resolveProjectCSSScope(options, meta.slug);

  const {
    effectiveTitle,
    metaTags,
    linkTags,
    scriptTags,
    styleTags,
    lang,
    bodyClass,
  } = processMetadata(meta, options.nonce);

  const noLayout = shouldDisableLayout(meta.frontmatter);

  const rootAttributes = buildRootAttributes(
    meta.slug || "",
    options.mode || "production",
    noLayout,
    meta.ssrHash,
  );

  const clientModuleStrategy = options.clientModuleStrategy === "fs" ? "fs" : "rsc-module";
  const skipDevHMR = clientModuleStrategy !== "fs" || isPreviewMode || options.noHmr;
  // Error logger endpoint only enabled in local dev (returns 404 in preview/prod)
  const skipErrorLogger = isPreviewMode;
  // Development module serving is the sole authority for dev scripts. Compilation
  // mode and preview status remain separate rendering concerns.
  const useDevScripts = !options.forceProductionScripts && clientModuleStrategy === "fs";
  const explicitReleaseManifest =
    (options as HTMLGenerationOptions & { releaseAssetManifest?: ReleaseAssetManifest | null })
      .releaseAssetManifest;
  const releaseManifest = options.studioEmbed
    ? null
    : explicitReleaseManifest !== undefined
    ? explicitReleaseManifest
    : await profilePhase("html.release_asset_manifest", () =>
      getReadyManifestForRenderAsync(options.releaseId));
  const manifestCssEntry = useProductionCSS ? releaseManifest?.css?.[0] : undefined;
  const shouldUseProjectCSS = useProductionCSS && !manifestCssEntry;
  if (prefetchedProjectCSSObservation && !shouldUseProjectCSS) {
    reportUnusedProjectCSSObservation(
      prefetchedProjectCSSObservation,
      manifestCssEntry ? "release" : "non-production",
    );
  }
  const projectCSSObservation = shouldUseProjectCSS
    ? prefetchedProjectCSSObservation ?? observeProjectCSSPromise(
      projectSlug !== "default"
        ? getProjectCSS(projectSlug, stylesheetContent, candidates, {
          minify: true,
          environment: options.environment,
          buildMode: options.mode as "development" | "production",
        })
        : Promise.resolve(null),
    )
    : undefined;

  const importMapPromise = buildImportMap({
    projectDir: options.projectDir,
    config: options.config,
    moduleServerOrigin: options.moduleServerOrigin,
    dependencyPinningCacheKey: options.dependencyPinningCacheKey,
    dependencyPinningDependencies: options.dependencyPinningDependencies,
    customImports: options.importMap,
    pretty: useDevScripts,
    releaseAssetManifest: releaseManifest,
  });

  const hydrationDataJson = generateHydrationData(
    meta.slug || "",
    params ?? {},
    props ?? {},
    { ...options, releaseAssetManifest: releaseManifest },
    { pretty: useDevScripts },
  );

  const nonce = options.nonce ?? "";

  const modeScripts = useDevScripts
    ? getDevScripts(meta.slug || "", options.config, params, props, nonce, {
      skipDevHMR,
      skipErrorLogger,
    })
    : getProdScripts(meta.slug || "", params, props, nonce);

  const modeStyles = useDevScripts ? getErrorOverlayStyles(nonce) : "";

  const modulePreloadHints = generateModulePreloadHints(options, releaseManifest);
  const importMap = await profilePhase("html.import_map", () => importMapPromise);
  const importMapJson = importMap.json;

  // Preload critical React dependencies to avoid waterfall delays.
  // jsx-runtime is discovered late (only when modules execute), adding ~500ms latency.
  const jsxRuntimeUrl = importMap.imports["react/jsx-runtime"];
  const criticalDepsPreload = jsxRuntimeUrl
    ? `<link rel="modulepreload" href="${escapeHTML(jsxRuntimeUrl)}">`
    : "";
  const prodHydrationModulePreload = useDevScripts
    ? ""
    : `<link rel="modulepreload" href="${getProdHydrationModulePath()}">`;

  const nonceAttr = buildNonceAttribute(nonce);

  // Expose project slug for runtime error overlay "Fix in Veryfront" button
  const overlaySlug = options.projectId || meta.slug;
  const slugForOverlay = useDevScripts && overlaySlug
    ? `<script${nonceAttr}>window.__VF_PROJECT_SLUG__=${
      JSON.stringify(overlaySlug).replace(/</g, "\\u003c")
    };</script>`
    : "";

  const hydrationErrorSuppression = useDevScripts ? "" : `<script${nonceAttr}>
(function(){
  var origError = console.error;
  var hydrationErrorLogged = false;
  console.error = function() {
    var msg = arguments[0];
    var isHydrationError = (typeof msg === 'string' && msg.includes('Minified React error #4')) ||
      (arguments[0] instanceof Error && arguments[0].message && arguments[0].message.includes('Minified React error #4'));
    if (isHydrationError) {
      if (!hydrationErrorLogged) {
        hydrationErrorLogged = true;
        origError.call(console, '[Veryfront] React hydration mismatch detected. This is usually caused by client-only code (localStorage, window checks) in SSR. React will recover automatically. See: https://react.dev/link/hydration-mismatch');
      }
      return;
    }
    origError.apply(console, arguments);
  };
})();
</script>`;

  const colorScheme = options.colorScheme ?? "light";
  // Only set data-theme/color-scheme when explicitly set via URL param (?color_mode=dark|light).
  const hasExplicitTheme = options.colorSchemeFromParam;
  const themeAttrs = hasExplicitTheme
    ? [`data-theme="${colorScheme}"`, `style="color-scheme: ${colorScheme};"`]
    : [];
  const htmlAttrs = [
    `lang="${escapeHTML(lang)}"`,
    ...themeAttrs,
    "suppressHydrationWarning",
  ].join(" ");

  const themePersistenceScript = options.colorSchemeFromParam
    ? `<script${nonceAttr}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){/* SILENT: localStorage may be unavailable */}})();
</script>`
    : "";

  let projectStylesheetBlock = "";
  let stylesheet: LinkedStylesheetArtifact | undefined;
  // Manifest-consumed CSS: when a ready release asset manifest carries a
  // compiled CSS entry, serve it from the immutable asset path (no renderer
  // involvement). Per-entry fallback: no manifest CSS → existing JIT link.
  if (manifestCssEntry) {
    const stylesheetHref = releaseAssetUrl(manifestCssEntry.contentHash, "css");
    projectStylesheetBlock = `<link rel="stylesheet" href="${stylesheetHref}">`;
    stylesheet = { kind: "release", hash: manifestCssEntry.contentHash };
  } else if (useProductionCSS) {
    const projectCSS = projectCSSObservation
      ? await profilePhase(
        "html.project_css",
        () => consumeProjectCSSObservation(projectCSSObservation),
      )
      : null;
    if (projectCSS?.hash) {
      projectStylesheetBlock = `<link rel="stylesheet" href="/_vf/css/${projectCSS.hash}.css">`;
      stylesheet = { kind: "project", hash: projectCSS.hash, css: projectCSS.css };
    } else {
      // CSS generation failed — log error prominently and omit link to avoid /_vf/css/.css 404
      serverLogger.error(
        "[HTML] Project CSS hash is empty — CSS link omitted. CSS generation likely failed.",
        {
          projectSlug,
          environment: options.environment,
        },
      );
    }
  } else {
    // Dev/preview: use link tag for HMR cache-busting
    projectStylesheetBlock = getPreviewStylesheetLink();
  }

  // Markdown styles: .md files with prose !== false get GitHub markdown CSS
  const isMarkdownPreview = options.pageType === "md" &&
    checkMarkdownPreview(options.pagePath, options.frontmatter);

  const markdownPreviewStyles = isMarkdownPreview
    ? `<!-- GitHub Markdown Preview Styles -->
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-markdown.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-syntax-highlighting.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/mermaid.min.css">`
    : "";

  const start = `<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
  ${metaTags}
  ${hydrationErrorSuppression}
  ${themePersistenceScript}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonceAttr}>
  ${importMapJson}
  </script>

  <!-- Modulepreload hints for faster cold start -->
  ${modulePreloadHints}
  ${criticalDepsPreload}
  ${prodHydrationModulePreload}

  <!-- Project stylesheet -->
  ${projectStylesheetBlock}
  ${markdownPreviewStyles}

  ${linkTags}
  ${styleTags}
  ${modeStyles}
  ${slugForOverlay}
</head>
<body${bodyClass ? ` class="${escapeHTML(bodyClass)}"` : ""} suppressHydrationWarning>
  <div ${rootAttributes}>`;

  const relativePagePath = getRelativePagePath(options.pagePath, options.projectDir);
  const studioScripts = options.studioEmbed
    ? getStudioScripts({
      projectId: options.projectId || meta.slug || "",
      pageId: options.pageId || relativePagePath || meta.slug || "",
      pagePath: relativePagePath || undefined,
      nonce,
      sourceHash: options.sourceHash,
    })
    : "";

  const previewHMRScript = isPreviewMode && clientModuleStrategy === "fs" &&
      !options.forceProductionScripts
    ? `<script src="/_veryfront/preview-hmr.js"${nonceAttr}></script>`
    : "";

  const mermaidScript = isMarkdownPreview ? buildMarkdownMermaidScript(nonce) : "";

  const end = `</div>
  <div id="veryfront-portals"></div>

  <!-- Hydration metadata for component tree reconstruction -->
  <script id="veryfront-hydration-data" type="application/json"${nonceAttr}>
  ${hydrationDataJson}
  </script>

  ${scriptTags}
  ${modeScripts}
  ${studioScripts}
  ${previewHMRScript}
  ${mermaidScript}
</body>
</html>`;

  return { start, end, stylesheet };
}

export async function wrapInHTMLShell(
  content: string,
  meta: HTMLRenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  projectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<string> {
  const snapshot = snapshotShellInputs(meta, options, params, props);
  const projectCSSObservation = projectCSSPromise
    ? observeProjectCSSPromise(projectCSSPromise)
    : undefined;
  return await withSpan(
    SpanNames.HTML_WRAP_IN_SHELL,
    async () => {
      const cleanedContent = content.trim();
      const { start, end } = await generateHTMLShellPartsWithObservedStylesheetArtifact(
        snapshot.meta,
        snapshot.options,
        snapshot.params,
        snapshot.props,
        cleanedContent,
        projectCSSObservation,
      );
      return `${start}${cleanedContent}${end}`;
    },
    {
      "html.slug": snapshot.meta.slug || "",
      "html.content_length": content.length,
    },
  );
}
