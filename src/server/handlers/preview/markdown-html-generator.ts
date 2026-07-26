/**
 * Markdown HTML Generator
 *
 * Generates a standalone HTML document for GitHub-style markdown preview.
 * Handles theme detection (color_mode param, Sec-CH-Prefers-Color-Scheme header),
 * studio bridge script injection, and mermaid diagram initialization.
 *
 * @module server/handlers/preview/markdown-html-generator
 */

import { escapeHtml } from "veryfront/utils/html-escape";
import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import { buildMarkdownMermaidScript } from "#veryfront/html/markdown-mermaid-script.ts";

/** Options for generating markdown preview HTML. */
interface MarkdownHtmlOptions {
  /** Rendered HTML content from the markdown compiler. */
  rawHtml: string;
  /** Page title (from frontmatter or file path). */
  title: string;
  /** Page description from frontmatter. */
  description: string;
  /** Original request for reading client hints. */
  request: Request;
  /** Request URL for reading query parameters. */
  url: URL;
  /** Project slug or ID for the studio bridge. */
  projectId: string;
  /** File path of the markdown file. */
  filePath: string;
  /** CSP nonce for inline scripts. */
  nonce?: string;
}

/**
 * Detect the preferred color theme from request parameters and client hints.
 *
 * Priority: `?color_mode=` param > `Sec-CH-Prefers-Color-Scheme` header.
 */
function detectTheme(req: Request, url: URL): "light" | "dark" | null {
  const colorModeParam = url.searchParams.get("color_mode")?.toLowerCase();
  const clientHint = req.headers
    .get("Sec-CH-Prefers-Color-Scheme")
    ?.replace(/"/g, "")
    .trim()
    .toLowerCase();

  if (colorModeParam === "light" || colorModeParam === "dark") {
    return colorModeParam;
  }
  if (clientHint === "light" || clientHint === "dark") {
    return clientHint;
  }
  return null;
}

/**
 * Generate the studio bridge `<script>` tag.
 * Injected only when embedded in Studio (`studio_embed=true`).
 */
function buildStudioScript(
  url: URL,
  projectId: string,
  filePath: string,
  nonce?: string,
): string {
  const studioEmbed = url.searchParams.get("studio_embed") === "true";
  if (!studioEmbed) return "";
  const nonceAttr = buildNonceAttribute(nonce);

  const rawQueryProjectId = url.searchParams.get("vf_project_id")?.trim() || "";
  // Validate query param before using it in bridge config.
  const queryProjectId = /^[a-zA-Z0-9_-]+$/.test(rawQueryProjectId) ? rawQueryProjectId : "";
  const queryFileId = url.searchParams.get("vf_file_id")?.trim() || "";
  const canonicalProjectId = queryProjectId || projectId;
  const canonicalPageId = queryFileId || filePath;

  const bridgeConfig: Record<string, unknown> = {
    projectId: canonicalProjectId,
    pageId: canonicalPageId,
    pagePath: filePath,
  };
  if (nonce) bridgeConfig.nonce = nonce;

  // Escape </script> sequences to prevent XSS breakout from inline JSON
  const safeJson = JSON.stringify(bridgeConfig).replace(/</g, "\\u003c");
  return `<script${nonceAttr}>window.__VF_BRIDGE_CONFIG__=${safeJson};</script>
  <script type="module" src="/_veryfront/studio-bridge.js"${nonceAttr}></script>`;
}

/**
 * Generate a complete HTML document for markdown preview rendering.
 *
 * Includes GitHub-flavored markdown styles, syntax highlighting,
 * mermaid diagram support with theme-aware re-rendering, and optional
 * studio bridge integration.
 */
export function generateMarkdownHtml(options: MarkdownHtmlOptions): string {
  const { rawHtml, title, description, request, url, projectId, filePath, nonce } = options;

  const theme = detectTheme(request, url);
  const studioScript = buildStudioScript(url, projectId, filePath, nonce);
  const themeAttrs = theme ? ` data-theme="${theme}" style="color-scheme: ${theme};"` : "";
  const nonceAttr = buildNonceAttribute(nonce);
  const mermaidScript = buildMarkdownMermaidScript(nonce);

  return `<!DOCTYPE html>
<html lang="en"${themeAttrs}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
  <title>${escapeHtml(title)}</title>

  <!-- GitHub Markdown Preview Styles -->
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-markdown.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-syntax-highlighting.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/mermaid.min.css">
</head>
<body>
  <article class="markdown-body" id="markdown-body">
    ${rawHtml || ""}
  </article>

  ${studioScript}

  ${mermaidScript}

  <!-- Preview HMR -->
  <script src="/_veryfront/preview-hmr.js"${nonceAttr}></script>
</body>
</html>`;
}
