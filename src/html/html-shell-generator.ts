import { rendererLogger as logger } from "@veryfront/utils";
import type { ComponentProps, RenderMetadata } from "@veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";
import {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";
import { escapeHTML } from "./html-escape.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import {
  generateThemeVariables,
  getDevStyles,
  getProductionStyles,
} from "./styles-builder/index.ts";
import { generateTailwindCSS } from "./styles-builder/unocss-generator.ts";

export async function wrapInHTMLShell(
  content: string,
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
): Promise<string> {
  const hasNoLayout = shouldDisableLayout(meta.frontmatter);

  // Debug: Log received mode value at entry point
  logger.info("[HTML-SHELL] Mode received:", {
    mode: options.mode,
    modeType: typeof options.mode,
    slug: meta.slug,
  });

  logger.info("wrapInHTMLShell called with meta:", {
    title: meta.title,
    frontmatter: meta.frontmatter,
    layout: meta.frontmatter?.layout,
    layoutType: typeof meta.frontmatter?.layout,
    hasNoLayout,
  });

  // Generate Tailwind CSS on-the-fly from HTML content
  const tailwindCSS = await generateTailwindCSS(content);
  logger.info("Generated Tailwind CSS:", {
    cssLength: tailwindCSS.length,
    slug: meta.slug,
  });

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

  const importMapJson = buildImportMapJson(options.importMap);

  const hydrationDataJson = generateHydrationData(
    meta.slug || "",
    params || {},
    props || {},
    options,
  );

  const nonce = options.nonce || "";
  logger.debug("[NONCE-TRACE] HTML generation using nonce:", nonce);

  const modeScripts = (() => {
    logger.info("Adding scripts for mode:", options.mode, "slug:", meta.slug);
    return options.mode === "development"
      ? getDevScripts(meta.slug || "", options.config, params, props, nonce)
      : getProdScripts(meta.slug || "", params, props, nonce);
  })();

  const modeStyles = options.mode === "development"
    ? getDevStyles(nonce)
    : getProductionStyles(nonce);

  const syntaxHighlightTheme = options.mode === "development" ? "github-dark" : "github";

  return `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
  ${metaTags}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonce ? ` nonce="${nonce}"` : ""}>
  ${importMapJson}
  </script>

  <!-- CSS Variables for Theming (veryfront-renderer compatible) -->
  <style${nonce ? ` nonce="${nonce}"` : ""}>
${generateThemeVariables()}
  </style>

  <!-- Generated Tailwind CSS (UnoCSS on-the-fly compilation) -->
  ${tailwindCSS ? `<style${nonce ? ` nonce="${nonce}"` : ""}>\n${tailwindCSS}\n  </style>` : ""}

  <!-- Syntax highlighting for code blocks -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${syntaxHighlightTheme}.min.css">
  ${linkTags}
  ${styleTags}
  ${modeStyles}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
  <div ${rootAttributes}>
    <div ${contentAttributes}>
      ${content}
    </div>
  </div>
  <div id="veryfront-portals"></div>

  <!-- Hydration metadata for component tree reconstruction -->
  <script id="veryfront-hydration-data" type="application/json"${nonce ? ` nonce="${nonce}"` : ""}>
  ${hydrationDataJson}
  </script>

  ${scriptTags}
  ${modeScripts}
</body>
</html>`;
}
