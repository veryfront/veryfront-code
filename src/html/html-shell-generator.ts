import type { ComponentProps, RenderMetadata } from "@veryfront/types";
import { escapeHTML } from "./html-escape.ts";
import {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
import { processMetadata } from "./metadata-builder.ts";
import {
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

export async function generateHTMLShellParts(
  meta: RenderMetadata,
  options: HTMLGenerationOptions,
  params?: Record<string, string | string[]>,
  props?: ComponentProps,
  contentForTailwind?: string,
): Promise<{ start: string; end: string }> {
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

  const tailwindCDNUrl = getTailwindCDNUrl(tailwindConfig);
  const tailwindCDN = options.mode === "development"
    ? `<script src="${tailwindCDNUrl}"${nonce ? ` nonce="${nonce}"` : ""}></script>
  <script${nonce ? ` nonce="${nonce}"` : ""}>${generateTailwindConfig(tailwindConfig)}</script>${
      tailwindConfig?.customCSS
        ? `
  <style type="text/tailwindcss"${nonce ? ` nonce="${nonce}"` : ""}>
${tailwindConfig.customCSS}
  </style>`
        : ""
    }`
    : "";

  const start = `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
  ${metaTags}
  <title>${escapeHTML(effectiveTitle)}</title>

  <!-- Import map for ESM module resolution -->
  <script type="importmap"${nonce ? ` nonce="${nonce}"` : ""}>
  ${importMapJson}
  </script>

  <!-- Tailwind CSS: CDN in dev (runtime compilation), UnoCSS in prod (pre-generated) -->
  ${tailwindCDN}
  ${
    options.mode !== "development" && tailwindCSS
      ? `<style${nonce ? ` nonce="${nonce}"` : ""}>\n${tailwindCSS}\n  </style>`
      : ""
  }

  <!-- CSS Variables for Theming (veryfront-renderer compatible) -->
  <style${nonce ? ` nonce="${nonce}"` : ""}>
${generateThemeVariables()}
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
