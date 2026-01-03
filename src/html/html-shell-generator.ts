import type { ComponentProps, RenderMetadata } from "@veryfront/types";
import { escapeHTML } from "./html-escape.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import { getStudioScripts } from "./dev-scripts.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
  generateThemeVariables,
  getDevStyles,
  getProductionStyles,
} from "./styles-builder/index.ts";
import { generateTailwindCSS } from "./styles-builder/unocss-generator.ts";
import type { HTMLGenerationOptions } from "./types.ts";
import {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";

/**
 * Convert a source path to a module URL for preloading.
 * E.g., pages/index.mdx -> /_vf_modules/pages/index.js
 * E.g., _snippets/abc123 -> /_vf_modules/_snippets/abc123.js
 */
function pathToModuleUrl(path: string): string {
  if (!path) return "";
  // Replace known source extensions with .js
  const withExtReplaced = path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
  // If no extension was replaced and path doesn't end with .js, add .js
  if (withExtReplaced === path && !path.endsWith(".js")) {
    return "/_vf_modules/" + path + ".js";
  }
  return "/_vf_modules/" + withExtReplaced;
}

/**
 * Convert a full file path to a relative path from project root.
 * E.g., /Users/.../project/pages/index.tsx -> pages/index.tsx
 */
function getRelativePagePath(fullPath: string | undefined, projectDir: string | undefined): string {
  if (!fullPath) return "";
  let relativePath = fullPath.replace(/\\/g, "/");
  if (projectDir) {
    const normalizedDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (relativePath.startsWith(normalizedDir + "/")) {
      relativePath = relativePath.substring(normalizedDir.length + 1);
    }
  }
  return relativePath.replace(/^\//, "");
}

/**
 * Generate modulepreload hints for page and layout modules.
 * These tell the browser to start loading modules immediately, in parallel.
 */
function generateModulePreloadHints(options: HTMLGenerationOptions): string {
  const hints: string[] = [];

  // Preload page module
  if (options.pagePath) {
    const projectDir = options.projectDir || "";
    let relativePath = options.pagePath.replace(/\\/g, "/");
    if (projectDir) {
      const normalizedDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
      if (relativePath.startsWith(normalizedDir + "/")) {
        relativePath = relativePath.substring(normalizedDir.length + 1);
      }
    }
    relativePath = relativePath.replace(/^\//, "");
    // Keep components/ prefix - required for module server security validation
    const moduleUrl = pathToModuleUrl(relativePath);
    if (moduleUrl) {
      hints.push(`<link rel="modulepreload" href="${moduleUrl}">`);
    }
  }

  // Preload layout modules
  for (const layout of options.nestedLayouts || []) {
    const layoutPath = layout.path || layout.componentPath || "";
    if (!layoutPath) continue;

    const projectDir = options.projectDir || "";
    let relativePath = layoutPath.replace(/\\/g, "/");
    if (projectDir) {
      const normalizedDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
      if (relativePath.startsWith(normalizedDir + "/")) {
        relativePath = relativePath.substring(normalizedDir.length + 1);
      }
    }
    relativePath = relativePath.replace(/^\//, "");
    // Keep components/ prefix - required for module server security validation
    const moduleUrl = pathToModuleUrl(relativePath);
    if (moduleUrl) {
      hints.push(`<link rel="modulepreload" href="${moduleUrl}">`);
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
  // For streaming, we can't generate Tailwind CSS from the content
  // since the content isn't available yet. Use empty string or provided content.
  // Pass tailwind config for theme customization in production mode
  const tailwindConfig = options.config?.tailwind;
  const tailwindCSS = contentForTailwind
    ? await generateTailwindCSS(contentForTailwind, tailwindConfig)
    : "";

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

  const modeScripts = options.mode === "development"
    ? getDevScripts(meta.slug || "", options.config, params, props, nonce)
    : getProdScripts(meta.slug || "", params, props, nonce);

  const modeStyles = options.mode === "development"
    ? getDevStyles(nonce)
    : getProductionStyles(nonce);

  const syntaxHighlightTheme = options.mode === "development" ? "github-dark" : "github";

  // UnoCSS is used for all modes (dev, preview, production)
  // It scans HTML content and source files to generate only needed CSS
  // No more Tailwind CDN dependency - eliminates flickering from CDN's built-in watcher

  // Generate modulepreload hints for page and layout modules (faster cold start)
  const modulePreloadHints = generateModulePreloadHints(options);

  const start = `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
  ${metaTags}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonce ? ` nonce="${nonce}"` : ""}>
  ${importMapJson}
  </script>

  <!-- Modulepreload hints for faster cold start -->
  ${modulePreloadHints}

  <!-- UnoCSS-generated Tailwind CSS (all modes) -->
  ${tailwindCSS ? `<style${nonce ? ` nonce="${nonce}"` : ""}>\n${tailwindCSS}\n  </style>` : ""}

  <!-- CSS Variables for Theming (veryfront-renderer compatible) -->
  <style${nonce ? ` nonce="${nonce}"` : ""}>
${options.globalCSS || generateThemeVariables()}
  </style>

  <!-- Syntax highlighting for code blocks -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${syntaxHighlightTheme}.min.css">
  ${linkTags}
  ${styleTags}
  ${modeStyles}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
  <div ${rootAttributes}>
    <div ${contentAttributes}>
`;

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

  // Mermaid initialization script for diagram rendering
  const mermaidScript = `
  <!-- Mermaid diagram rendering -->
  <script type="module"${nonce ? ` nonce="${nonce}"` : ""}>
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>`;

  const end = `
    </div>
  </div>
  <div id="veryfront-portals"></div>

  <!-- Hydration metadata for component tree reconstruction -->
  <script id="veryfront-hydration-data" type="application/json"${nonce ? ` nonce="${nonce}"` : ""}>
  ${hydrationDataJson}
  </script>

  ${scriptTags}
  ${modeScripts}
  ${studioScripts}
  ${mermaidScript}
</body>
</html>`;

  return { start, end };
}

export async function wrapInHTMLShell(
  content: string,
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
): Promise<string> {
  const { start, end } = await generateHTMLShellParts(
    meta,
    options,
    params,
    props,
    content,
  );
  return `${start}${content}${end}`;
}
