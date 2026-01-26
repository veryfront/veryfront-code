import type { ComponentProps, RenderMetadata } from "#veryfront/types";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { escapeHTML } from "./html-escape.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import { getStudioScripts } from "./dev-scripts.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
  extractCandidates,
  getDevStyles,
  getProductionStyles,
  getProjectCSS,
} from "./styles-builder/index.ts";
import type { HTMLGenerationOptions } from "./types.ts";
import {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
  shouldDisableProse,
} from "./utils.ts";
import {
  generateModulePreloadHintsFromManifest,
  getRouteManifest,
} from "../modules/manifest/route-module-manifest.ts";

function pathToModuleUrl(path: string, studioEmbed?: boolean): string {
  if (!path) return "";

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

function generateModulePreloadHints(options: HTMLGenerationOptions): string {
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
    addHint(pathToModuleUrl(relativePath, studioEmbed));
  }

  for (const layout of options.nestedLayouts ?? []) {
    const layoutPath = layout.path ?? layout.componentPath ?? "";
    if (!layoutPath) continue;

    const relativePath = getRelativePagePath(layoutPath, projectDir);
    addHint(pathToModuleUrl(relativePath, studioEmbed));
  }

  const projectSlug = options.projectId;
  const route = options.pagePath
    ? getRelativePagePath(options.pagePath, projectDir)
      .replace(/\.(tsx|ts|jsx|mdx)$/, "")
      .replace(/^pages\//, "")
    : "";

  const manifest = getRouteManifest(projectSlug, route);
  if (!manifest || manifest.renderCount <= 0) return hints.join("\n  ");

  for (const hint of generateModulePreloadHintsFromManifest(projectSlug, route, 50)) {
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
): Promise<{ start: string; end: string }> {
  return withSpan(
    SpanNames.HTML_GENERATE_SHELL_PARTS,
    () => generateHTMLShellPartsImpl(meta, options, params, props, contentForTailwind),
    {
      "html.slug": meta.slug || "",
      "html.has_content": !!contentForTailwind,
      "html.mode": options.mode || "production",
      "html.is_local_dev": options.isLocalDev ?? false,
    },
  );
}

async function generateHTMLShellPartsImpl(
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  contentForTailwind?: string,
): Promise<{ start: string; end: string }> {
  const stylesheetContent = options.globalCSS;

  const localDev = options.isLocalDev ?? false;
  const useProductionCSS = !localDev && options.environment === "production";

  // Use projectClasses (extracted from ALL source files) + current page as fallback
  const candidates = new Set<string>(options.projectClasses ?? []);
  if (contentForTailwind) {
    for (const cls of extractCandidates(contentForTailwind)) candidates.add(cls);
  }

  const projectSlug = options.projectId || meta.slug || "default";
  let cssHash = "";

  // Only generate CSS for production mode (dev/preview uses link tag to StylesCSSHandler)
  if (useProductionCSS && projectSlug !== "default") {
    const projectCSS = await getProjectCSS(projectSlug, stylesheetContent, candidates, {
      minify: true,
    });
    cssHash = projectCSS.hash;
  }

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
  // Only apply prose styles to MDX/markdown content, not TSX pages
  const isMdxContent = options.pagePath?.match(/\.(mdx?|md)$/i) ?? false;
  const noProse = !isMdxContent || shouldDisableProse(meta.frontmatter);

  const rootAttributes = buildRootAttributes(
    meta.slug || "",
    options.mode || "production",
    noLayout,
  );

  const contentAttributes = buildContentAttributes(meta.slug || "", noLayout, meta.ssrHash, noProse);

  const importMapJson = await buildImportMapJson({
    projectDir: options.projectDir,
    config: options.config,
    customImports: options.importMap,
  });

  const hydrationDataJson = generateHydrationData(
    meta.slug || "",
    params ?? {},
    props ?? {},
    options,
  );

  const nonce = options.nonce ?? "";

  const isPreviewMode = options.environment === "preview";
  const skipDevHMR = isPreviewMode;
  // Error logger endpoint only enabled in local dev (returns 404 in preview/prod)
  const skipErrorLogger = isPreviewMode;
  // Enable dev scripts for local dev OR preview mode (for HMR support in Studio)
  const useDevScripts = localDev || isPreviewMode;

  const modeScripts = useDevScripts
    ? getDevScripts(meta.slug || "", options.config, params, props, nonce, {
      skipDevHMR,
      skipErrorLogger,
    })
    : getProdScripts(meta.slug || "", params, props, nonce);

  const modeStyles = useDevScripts ? getDevStyles(nonce) : getProductionStyles(nonce);
  const syntaxHighlightTheme = useDevScripts ? "github-dark" : "github";

  const modulePreloadHints = generateModulePreloadHints(options);

  const hydrationErrorSuppression = !useDevScripts
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

  const colorScheme = options.colorScheme ?? "light";
  const htmlAttrs = [
    `lang="${escapeHTML(lang)}"`,
    `data-theme="${colorScheme}"`,
    `style="color-scheme: ${colorScheme};"`,
    "suppressHydrationWarning",
  ].join(" ");

  const themePersistenceScript = options.colorSchemeFromParam
    ? `<script${nonce ? ` nonce="${nonce}"` : ""}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){}})();
</script>`
    : "";

  let tailwindCSSBlock = "";
  if (useProductionCSS) {
    tailwindCSSBlock = `<link rel="stylesheet" href="/_vf/css/${cssHash}.css">`;
  } else {
    // Dev/preview: use link tag for HMR cache-busting
    tailwindCSSBlock =
      `<link id="vf-tailwind-css" rel="stylesheet" href="/_vf_styles/styles.css?t=${Date.now()}">`;
  }

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
  ${tailwindCSSBlock}

  <!-- Syntax highlighting for code blocks -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${syntaxHighlightTheme}.min.css">
  ${linkTags}
  ${styleTags}
  ${modeStyles}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""} suppressHydrationWarning>
  <div ${rootAttributes}>
    <div ${contentAttributes}>`;

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

  const previewHMRScript = options.environment === "preview"
    ? `<script src="/_veryfront/preview-hmr.js"${nonce ? ` nonce="${nonce}"` : ""}></script>`
    : "";

  const mermaidScript = `
  <!-- Mermaid diagram rendering (after hydration) -->
  <script type="module"${nonce ? ` nonce="${nonce}"` : ""}>
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    const runMermaid = () => { if (!window.__mermaidDone) { window.__mermaidDone = true; mermaid.run(); } };
    window.__veryfrontHydrationComplete = runMermaid;
    if (document.getElementById('veryfront-content')?.__reactRoot) runMermaid();
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

export function wrapInHTMLShell(
  content: string,
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
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
      );
      return `${start}${cleanedContent}${end}`;
    },
    {
      "html.slug": meta.slug || "",
      "html.content_length": content.length,
    },
  );
}
