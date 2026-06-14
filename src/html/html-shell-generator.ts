import type { ComponentProps, RenderMetadata } from "#veryfront/types";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { profilePhase } from "#veryfront/observability/request-profiler.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { isMarkdownPreview as checkMarkdownPreview } from "#veryfront/transforms/md/utils.ts";
import {
  generateModulePreloadHintsFromManifest,
  getRouteManifest,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
import {
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "#veryfront/release-assets/html-consumption.ts";
import { routeForPage } from "#veryfront/release-assets/route-path.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { buildNonceAttribute, escapeHTML } from "./html-escape.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
  PROD_HYDRATION_MODULE_PATH,
} from "./hydration-script-builder/index.ts";
import { getPreviewStylesheetLink, getStudioScripts } from "./dev-scripts.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
  extractCandidates,
  getDevStyles as getErrorOverlayStyles,
  getProjectCSS,
} from "./styles-builder/index.ts";
import type { HTMLGenerationOptions } from "./types.ts";
import { buildImportMap, buildRootAttributes, shouldDisableLayout } from "./utils.ts";

function pathToModuleUrl(
  path: string,
  studioEmbed?: boolean,
  manifest?: ReleaseAssetManifest | null,
): string {
  if (!path) return "";

  // Manifest hit → content-addressed asset URL (production only; never in
  // studio-embed). Miss falls through to the existing URL (per-entry fallback).
  if (manifest && !studioEmbed) {
    const assetUrl = resolveManifestModuleUrl(manifest, path);
    if (assetUrl) return assetUrl;
  }

  const withExtReplaced = path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  const urlBase = withExtReplaced === path && !path.endsWith(".js")
    ? `/_vf_modules/${path}.js`
    : `/_vf_modules/${withExtReplaced}`;

  return studioEmbed ? `${urlBase}?studio_embed=true` : urlBase;
}

function getRelativePagePath(
  fullPath: string | undefined,
  projectDir: string | undefined,
): string {
  if (!fullPath) return "";

  const normalized = fullPath.replace(/\\/g, "/");
  if (!projectDir) return normalized.replace(/^\//, "");

  return resolveRelativePath(normalized, projectDir);
}

type ProjectCSSResult = Awaited<ReturnType<typeof getProjectCSS>> | null;

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

  function addHint(moduleUrl: string): void {
    if (!moduleUrl || addedUrls.has(moduleUrl)) return;
    hints.push(`<link rel="modulepreload" href="${moduleUrl}">`);
    addedUrls.add(moduleUrl);
  }

  if (options.pagePath) {
    const relativePath = getRelativePagePath(options.pagePath, projectDir);
    addHint(pathToModuleUrl(relativePath, studioEmbed, releaseManifest));
  }

  for (const layout of options.nestedLayouts ?? []) {
    const layoutPath = layout.path ?? layout.componentPath ?? "";
    if (!layoutPath) continue;

    const relativePath = getRelativePagePath(layoutPath, projectDir);
    addHint(pathToModuleUrl(relativePath, studioEmbed, releaseManifest));
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
  const releaseManifestRoute = relativePagePath ? routeForPage(relativePagePath) ?? "" : "";
  const legacyModuleManifestRoute = relativePagePath
    ? relativePagePath
      .replace(/\.(tsx|ts|jsx|mdx)$/, "")
      .replace(/^pages\//, "")
    : "";

  // Manifest-covered routes: preload the full closure from the manifest.
  if (releaseManifest) {
    for (const url of resolveManifestRoutePreloadUrls(releaseManifest, releaseManifestRoute)) {
      addHint(url);
    }
    return hints.join("\n  ");
  }

  const projectSlug = options.projectSlug ?? options.projectId;
  const manifest = getRouteManifest(projectSlug, legacyModuleManifestRoute);
  if (!manifest || manifest.renderCount <= 0) return hints.join("\n  ");

  for (
    const hint of generateModulePreloadHintsFromManifest(
      projectSlug,
      legacyModuleManifestRoute,
      50,
    )
  ) {
    const href = hint.match(/href="([^"]+)"/)?.[1];
    if (!href || addedUrls.has(href)) continue;

    hints.push(hint);
    addedUrls.add(href);
  }

  return hints.join("\n  ");
}

export function generateHTMLShellParts(
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  contentForTailwind?: string,
  projectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<{ start: string; end: string }> {
  return withSpan(
    SpanNames.HTML_GENERATE_SHELL_PARTS,
    () =>
      generateHTMLShellPartsImpl(
        meta,
        options,
        params,
        props,
        contentForTailwind,
        projectCSSPromise,
      ),
    {
      "html.slug": meta.slug || "",
      "html.has_content": !!contentForTailwind,
      "html.mode": options.mode || "production",
      "html.is_local_project": options.isLocalProject ?? false,
    },
  );
}

async function generateHTMLShellPartsImpl(
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  contentForTailwind?: string,
  prefetchedProjectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<{ start: string; end: string }> {
  const stylesheetContent = options.globalCSS;

  const isLocalProject = options.isLocalProject ?? false;
  const isPreviewMode = options.environment === "preview";
  const useProductionCSS = !isLocalProject && options.environment === "production";

  // Use projectClasses (extracted from ALL source files) + current page as fallback
  const candidates = new Set<string>(options.projectClasses ?? []);
  if (contentForTailwind) {
    for (const cls of extractCandidates(contentForTailwind)) candidates.add(cls);
  }

  const projectSlug = resolveProjectCSSScope(options, meta.slug);
  const projectCSSPromise = prefetchedProjectCSSPromise ??
    (useProductionCSS && projectSlug !== "default"
      ? getProjectCSS(projectSlug, stylesheetContent, candidates, {
        minify: true,
        environment: options.environment,
        buildMode: options.mode as "development" | "production",
      })
      : Promise.resolve(null));

  const {
    effectiveTitle,
    metaTags,
    linkTags,
    scriptTags,
    styleTags,
    lang,
    bodyClass,
  } = processMetadata(meta);

  const noLayout = shouldDisableLayout(meta.frontmatter);

  const rootAttributes = buildRootAttributes(
    meta.slug || "",
    options.mode || "production",
    noLayout,
    meta.ssrHash,
  );

  const skipDevHMR = isPreviewMode || options.noHmr;
  // Error logger endpoint only enabled in local dev (returns 404 in preview/prod)
  const skipErrorLogger = isPreviewMode;
  // Enable dev scripts for local dev OR preview mode (for HMR support in Studio),
  // unless a caller explicitly forces production client scripts for fair benchmarking.
  const useDevScripts = !options.forceProductionScripts && (isLocalProject || isPreviewMode);
  const explicitReleaseManifest =
    (options as HTMLGenerationOptions & { releaseAssetManifest?: ReleaseAssetManifest | null })
      .releaseAssetManifest;
  const releaseManifest = options.studioEmbed
    ? null
    : explicitReleaseManifest !== undefined
    ? explicitReleaseManifest
    : await profilePhase("html.release_asset_manifest", () =>
      getReadyManifestForRenderAsync(options.releaseId));

  const importMapPromise = buildImportMap({
    projectDir: options.projectDir,
    config: options.config,
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
    ? `<link rel="modulepreload" href="${jsxRuntimeUrl}">`
    : "";
  const prodHydrationModulePreload = useDevScripts
    ? ""
    : `<link rel="modulepreload" href="${PROD_HYDRATION_MODULE_PATH}">`;

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

  let tailwindCSSBlock = "";
  // Manifest-consumed CSS: when a ready release asset manifest carries a
  // compiled CSS entry, serve it from the immutable asset path (no renderer
  // involvement). Per-entry fallback: no manifest CSS → existing JIT link.
  const manifestCssEntry = useProductionCSS ? releaseManifest?.css?.[0] : undefined;
  if (manifestCssEntry) {
    tailwindCSSBlock =
      `<link rel="stylesheet" href="/_vf/assets/${manifestCssEntry.contentHash}.css">`;
  } else if (useProductionCSS) {
    const projectCSS = await profilePhase("html.project_css", () => projectCSSPromise);
    const cssHash = projectCSS?.hash ?? "";
    if (cssHash) {
      tailwindCSSBlock = `<link rel="stylesheet" href="/_vf/css/${cssHash}.css">`;
    } else {
      // CSS generation failed — log error prominently and omit link to avoid /_vf/css/.css 404
      serverLogger.error(
        "[HTML] Tailwind CSS hash is empty — CSS link omitted. CSS generation likely failed.",
        {
          projectSlug,
          environment: options.environment,
        },
      );
    }
  } else {
    // Dev/preview: use link tag for HMR cache-busting
    tailwindCSSBlock = getPreviewStylesheetLink();
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
  ${hydrationErrorSuppression}
  ${themePersistenceScript}
  ${metaTags}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonceAttr}>
  ${importMapJson}
  </script>

  <!-- Modulepreload hints for faster cold start -->
  ${modulePreloadHints}
  ${criticalDepsPreload}
  ${prodHydrationModulePreload}

  <!-- Tailwind CSS: Server-side JIT compiled -->
  ${tailwindCSSBlock}
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

  const previewHMRScript = isPreviewMode && !options.forceProductionScripts
    ? `<script src="/_veryfront/preview-hmr.js"${nonceAttr}></script>`
    : "";

  const mermaidScript = isMarkdownPreview
    ? `<script type="module"${nonceAttr}>
import mermaid from 'https://esm.sh/mermaid@11';
mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default' });
// Convert code.language-mermaid blocks to mermaid-compatible format
document.querySelectorAll('code.language-mermaid').forEach((code, i) => {
  const pre = code.parentElement;
  if (pre?.tagName === 'PRE') {
    const div = document.createElement('pre');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    pre.replaceWith(div);
  }
});
mermaid.run();
</script>`
    : "";

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

  return { start, end };
}

export function wrapInHTMLShell(
  content: string,
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  projectCSSPromise?: Promise<ProjectCSSResult>,
): Promise<string> {
  return withSpan(
    SpanNames.HTML_WRAP_IN_SHELL,
    async () => {
      const cleanedContent = content.trim();
      const { start, end } = await generateHTMLShellParts(
        meta,
        options,
        params,
        props,
        cleanedContent,
        projectCSSPromise,
      );
      return `${start}${cleanedContent}${end}`;
    },
    {
      "html.slug": meta.slug || "",
      "html.content_length": content.length,
    },
  );
}
