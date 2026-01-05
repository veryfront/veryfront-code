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
  convertTailwindConfigForBrowser,
  generateTailwindConfig,
  generateThemeVariables,
  getDevStyles,
  getProductionStyles,
  getTailwindCDNUrl,
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
 * Extract head elements from React SSR content and return them separately.
 *
 * React's Head component renders a hidden div with data-veryfront-head attribute.
 * The browser's HTML parser hoists elements like <link>, <meta>, <title> out of divs,
 * causing hydration mismatch. This function extracts those elements to inject
 * into the actual <head>, and removes them from the body content.
 *
 * @param content - The React SSR rendered HTML content
 * @returns Object with extracted head elements HTML and cleaned content
 */
export function extractHeadElements(
  content: string,
): { headElements: string; cleanedContent: string } {
  // Match data-veryfront-head wrappers and extract their inner content
  // Pattern: <div data-veryfront-head="1" style="display:none">...</div>
  // Also handles <template data-veryfront-head="1">...</template>
  const headPattern = /<(div|template)(\s+data-veryfront-head="1"[^>]*)>([\s\S]*?)<\/\1>/gi;

  const headElements: string[] = [];
  const cleanedContent = content.replace(headPattern, (_match, tagName, attrs, innerContent) => {
    // Extract valid head elements from the inner content
    // Filter out <body> elements which are invalid in head
    const validHeadContent = innerContent.replace(/<body[^>]*>.*?<\/body>/gi, "");
    if (validHeadContent.trim()) {
      headElements.push(validHeadContent.trim());
    }
    // Return EMPTY wrapper (not removed) so hydration matches client initial render
    return `<${tagName}${attrs}></${tagName}>`;
  });

  return {
    headElements: headElements.join("\n  "),
    cleanedContent,
  };
}

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

  // In development, use Tailwind CDN for runtime CSS compilation (works with 'use client' pages)
  // In production, use UnoCSS-generated CSS from pre-rendered HTML
  const tailwindCDNUrl = getTailwindCDNUrl(tailwindConfig);

  // Use project's tailwind.config.js if available, otherwise fall back to generated config
  const tailwindConfigScript = options.tailwindConfigJs
    ? convertTailwindConfigForBrowser(options.tailwindConfigJs)
    : generateTailwindConfig(tailwindConfig);

  // Project's tailwind.config.js may use ESM imports, so use type="module"
  const configScriptType = options.tailwindConfigJs ? ' type="module"' : "";

  const tailwindCDN = options.mode === "development"
    ? `<script src="${tailwindCDNUrl}"${nonce ? ` nonce="${nonce}"` : ""}></script>
  <script${configScriptType}${nonce ? ` nonce="${nonce}"` : ""}>${tailwindConfigScript}</script>${
      tailwindConfig?.customCSS
        ? `
  <style type="text/tailwindcss"${nonce ? ` nonce="${nonce}"` : ""}>
${tailwindConfig.customCSS}
  </style>`
        : ""
    }`
    : "";

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

  <!-- Tailwind CSS: CDN in dev (runtime compilation), UnoCSS in prod (pre-generated) -->
  ${tailwindCDN}
  ${
    options.mode !== "development" && tailwindCSS
      ? `<style${nonce ? ` nonce="${nonce}"` : ""}>\n${tailwindCSS}\n  </style>`
      : ""
  }

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
  // Extract head elements from React content to inject into actual <head>
  // This fixes hydration mismatch caused by browser hoisting <link>/<meta> out of <div>
  const { headElements, cleanedContent } = extractHeadElements(content);

  const { start, end } = await generateHTMLShellParts(
    meta,
    options,
    params,
    props,
    cleanedContent, // Pass cleaned content for Tailwind CSS generation
  );

  // Inject extracted head elements into the <head> section (before </head>)
  const startWithHeadElements = headElements
    ? start.replace("</head>", `  ${headElements}\n</head>`)
    : start;

  return `${startWithHeadElements}${cleanedContent}${end}`;
}
