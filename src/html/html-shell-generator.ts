import type { ComponentProps, RenderMetadata } from "#veryfront/types";
import { escapeHTML } from "./html-escape.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import { getStudioScripts } from "./dev-scripts.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
  cacheCSS,
  extractCandidates,
  generateTailwindCSS,
  generateThemeVariables,
  getDevStyles,
  getProductionStyles,
} from "./styles-builder/index.ts";
import type { HTMLGenerationOptions } from "./types.ts";
import {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import {
  generateModulePreloadHintsFromManifest,
  getRouteManifest,
} from "../modules/manifest/route-module-manifest.ts";

/**
 * Convert a source path to a module URL for preloading.
 * E.g., pages/index.mdx -> /_vf_modules/pages/index.js
 * E.g., _snippets/abc123 -> /_vf_modules/_snippets/abc123.js
 *
 * @param path - Source file path
 * @param studioEmbed - If true, add ?studio_embed=true query param
 */
function pathToModuleUrl(path: string, studioEmbed?: boolean): string {
  if (!path) return "";
  const withExtReplaced = path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  let url: string;
  if (withExtReplaced === path && !path.endsWith(".js")) {
    url = "/_vf_modules/" + path + ".js";
  } else {
    url = "/_vf_modules/" + withExtReplaced;
  }
  if (studioEmbed) {
    url += "?studio_embed=true";
  }
  return url;
}

/**
 * Convert a full file path to a relative path from project root.
 * Uses the shared resolveRelativePath utility.
 */
function getRelativePagePath(fullPath: string | undefined, projectDir: string | undefined): string {
  if (!fullPath) return "";
  const normalized = fullPath.replace(/\\/g, "/");
  if (!projectDir) return normalized.replace(/^\//, "");
  return resolveRelativePath(normalized, projectDir);
}

/**
 * Generate modulepreload hints for page and layout modules.
 * These tell the browser to start loading modules immediately, in parallel.
 *
 * Enhanced to use the route module manifest when available, which includes
 * all dependencies discovered during previous renders (not just page/layout).
 */
function generateModulePreloadHints(options: HTMLGenerationOptions): string {
  const hints: string[] = [];
  const projectDir = options.projectDir || "";
  const addedUrls = new Set<string>();
  const studioEmbed = options.studioEmbed;

  // Helper to add a preload hint, deduplicating by URL
  function addHint(moduleUrl: string): void {
    if (moduleUrl && !addedUrls.has(moduleUrl)) {
      hints.push(`<link rel="modulepreload" href="${moduleUrl}">`);
      addedUrls.add(moduleUrl);
    }
  }

  // Preload page module (always first - most critical)
  if (options.pagePath) {
    const relativePath = getRelativePagePath(options.pagePath, projectDir);
    addHint(pathToModuleUrl(relativePath, studioEmbed));
  }

  // Preload layout modules
  for (const layout of options.nestedLayouts || []) {
    const layoutPath = layout.path || layout.componentPath || "";
    if (layoutPath) {
      const relativePath = getRelativePagePath(layoutPath, projectDir);
      addHint(pathToModuleUrl(relativePath, studioEmbed));
    }
  }

  // Use manifest to preload all known dependencies for this route
  // This significantly reduces waterfall loading by preloading dependencies
  // discovered during previous renders of this route.
  const projectSlug = options.projectId;
  const route = options.pagePath
    ? getRelativePagePath(options.pagePath, projectDir)
      .replace(/\.(tsx|ts|jsx|mdx)$/, "")
      .replace(/^pages\//, "")
    : "";

  const manifest = getRouteManifest(projectSlug, route);
  if (manifest && manifest.renderCount > 0) {
    // Get expanded hints from manifest (up to 50 modules)
    for (const hint of generateModulePreloadHintsFromManifest(projectSlug, route, 50)) {
      // Extract href from hint to check for duplicates
      const hrefMatch = hint.match(/href="([^"]+)"/);
      const href = hrefMatch?.[1];
      if (href && !addedUrls.has(href)) {
        hints.push(hint);
        addedUrls.add(href);
      }
    }
  }

  return hints.join("\n  ");
}

/**
 * Generate HTML shell parts for streaming
 * Returns the start (before content) and end (after content) parts of the HTML document
 */
export async function generateHTMLShellParts(
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  contentForTailwind?: string,
): Promise<{ start: string; end: string }> {
  // Generate JIT Tailwind CSS using native Tailwind v4 compile() API
  // Uses project's stylesheet (globals.css) for @theme, @plugin support
  // Extracts candidates from rendered HTML content + project-wide classes
  const stylesheetContent = options.globalCSS;
  const isProduction = options.mode === "production" && options.proxyEnvironment !== "preview";

  // Merge candidates from: 1) rendered HTML content, 2) pre-extracted project classes
  const candidates = new Set<string>(options.projectClasses || []);
  if (contentForTailwind) {
    for (const cls of extractCandidates(contentForTailwind)) {
      candidates.add(cls);
    }
  }

  const tailwindResult = await generateTailwindCSS(
    stylesheetContent,
    candidates,
    { minify: isProduction },
  );
  const tailwindCSS = tailwindResult.css;
  const tailwindError = tailwindResult.error;

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
  );

  const contentAttributes = buildContentAttributes(
    meta.slug || "",
    noLayout,
    meta.ssrHash,
  );

  // Build import map with config support (self-hosted mode, CDN versions, etc.)
  const importMapJson = await buildImportMapJson({
    projectDir: options.projectDir,
    config: options.config,
    customImports: options.importMap,
  });

  const hydrationDataJson = generateHydrationData(
    meta.slug || "",
    params || {},
    props || {},
    options,
  );

  const nonce = options.nonce || "";

  // Skip dev HMR script (hmr.js) when preview-hmr.js will be used instead
  const skipDevHMR = options.proxyEnvironment === "preview";
  const modeScripts = options.mode === "development"
    ? getDevScripts(meta.slug || "", options.config, params, props, nonce, { skipDevHMR })
    : getProdScripts(meta.slug || "", params, props, nonce);

  const modeStyles = options.mode === "development"
    ? getDevStyles(nonce)
    : getProductionStyles(nonce);

  const syntaxHighlightTheme = options.mode === "development" ? "github-dark" : "github";

  // Generate Tailwind CSS output - inline for preview, hashed link for production
  // cacheCSS stores the CSS and returns the hash for later retrieval
  const cssHash = tailwindCSS && isProduction ? cacheCSS(tailwindCSS) : "";

  // Generate modulepreload hints for page and layout modules (faster cold start)
  const modulePreloadHints = generateModulePreloadHints(options);

  // Deduplicate React hydration errors in production (error #418, #423, #425)
  // These are common with SSR + client-side libraries (themes, animations) and React 18
  // recovers gracefully. We log once with helpful context instead of spamming console.
  // Must run BEFORE React loads to intercept the console.error calls.
  const hydrationErrorSuppression = options.mode !== "development"
    ? `<script${nonce ? ` nonce="${nonce}"` : ""}>
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
</script>`
    : "";

  // Build HTML element attributes including color scheme from client hints
  const colorScheme = options.colorScheme || "light";
  const htmlAttrs = [
    `lang="${escapeHTML(lang)}"`,
    `data-theme="${colorScheme}"`,
    `style="color-scheme: ${colorScheme};"`,
    "suppressHydrationWarning",
  ].join(" ");

  // Theme persistence script - only needed when color_mode was set via URL param
  // This ensures next-themes picks up the SSR theme and doesn't flash/revert
  const themePersistenceScript = options.colorSchemeFromParam
    ? `<script${nonce ? ` nonce="${nonce}"` : ""}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){}})();
</script>`
    : "";

  const start = `<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
  ${hydrationErrorSuppression}
  ${themePersistenceScript}
  ${metaTags}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonce ? ` nonce="${nonce}"` : ""}>
  ${importMapJson}
  </script>

  <!-- Modulepreload hints for faster cold start -->
  ${modulePreloadHints}

  <!-- Tailwind CSS: Server-side JIT compiled -->
  ${(() => {
    if (!tailwindCSS) return "";
    if (isProduction) {
      // Production: link to hashed CSS file for immutable caching
      return `<link rel="stylesheet" href="/_vf/css/${cssHash}.css">`;
    } else {
      // Preview/Dev: inline style with ID for HMR updates
      return `<style id="vf-tailwind-css"${nonce ? ` nonce="${nonce}"` : ""}>\n${tailwindCSS}\n  </style>`;
    }
  })()}
  ${tailwindError ? `<!-- Tailwind CSS Error: ${tailwindError.replace(/-->/g, "- ->")} -->` : ""}

  <!-- CSS Variables for Theming (veryfront-renderer compatible) -->
  ${
    (() => {
      // If project has globals.css, serve via link tag for proper HMR support
      // Link tags can be hot-reloaded by updating href with cache-bust param
      if (options.globalCSS) {
        return `<link rel="stylesheet" href="/_vf_styles/globals.css">`;
      }
      // Fallback: inline default theme variables if no globals.css exists
      const css = generateThemeVariables();
      return `<style${nonce ? ` nonce="${nonce}"` : ""}>
${css}
  </style>`;
    })()
  }

  <!-- Syntax highlighting for code blocks -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${syntaxHighlightTheme}.min.css">
  ${linkTags}
  ${styleTags}
  ${modeStyles}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""} suppressHydrationWarning>
  <div ${rootAttributes}>
    <div ${contentAttributes}>`;

  // Studio bridge scripts for iframe communication with Studio
  // pageId should be the entity UUID from the API (preferred) or relative path as fallback
  // pagePath is the relative file path (e.g., pages/index.mdx) for Navigator node resolution
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

  // Preview HMR script for live updates in cloud preview mode
  // Connects to /_ws WebSocket and reloads on file changes
  const previewHMRScript = options.proxyEnvironment === "preview"
    ? `<script src="/_veryfront/preview-hmr.js"${nonce ? ` nonce="${nonce}"` : ""}></script>`
    : "";

  // Mermaid initialization script for diagram rendering
  const mermaidScript = `
  <!-- Mermaid diagram rendering -->
  <script type="module"${nonce ? ` nonce="${nonce}"` : ""}>
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>`;

  const end = `</div>
  </div>
  <div id="veryfront-portals"></div>

  <!-- Hydration metadata for component tree reconstruction -->
  <script id="veryfront-hydration-data" type="application/json"${nonce ? ` nonce="${nonce}"` : ""}>
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

/**
 * Wrap HTML content in a complete HTML shell.
 * Used for script pages and snippets that don't use the Head component.
 * For normal pages, use HTMLGenerator which uses HeadCollector directly.
 */
export async function wrapInHTMLShell(
  content: string,
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
): Promise<string> {
  const cleanedContent = content.trim();

  const { start, end } = await generateHTMLShellParts(
    meta,
    options,
    params,
    props,
    cleanedContent,
  );

  return `${start}${cleanedContent}${end}`;
}
