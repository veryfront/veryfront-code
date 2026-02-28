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

/** Options for generating markdown preview HTML. */
export interface MarkdownHtmlOptions {
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
  /** Branch ID for Yjs room GUID computation. */
  branchId?: string | null;
  /** API base URL for computing the WebSocket URL (e.g. "https://api.veryfront.com"). */
  apiBaseUrl?: string;
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
 * Injected when embedded in Studio (`studio_embed=true`) or for standalone
 * markdown/MDX pages so the edit button and editor features are available.
 */
function buildStudioScript(
  url: URL,
  projectId: string,
  filePath: string,
  branchId?: string | null,
  apiBaseUrl?: string,
): string {
  const studioEmbed = url.searchParams.get("studio_embed") === "true";
  const isMarkdown = /\.mdx?$/i.test(filePath);
  if (!studioEmbed && !isMarkdown) return "";

  const rawQueryProjectId = url.searchParams.get("vf_project_id")?.trim() || "";
  // Validate query param to prevent path traversal in WebSocket URL
  const queryProjectId = /^[a-zA-Z0-9_-]+$/.test(rawQueryProjectId) ? rawQueryProjectId : "";
  const queryFileId = url.searchParams.get("vf_file_id")?.trim() || "";
  const canonicalProjectId = queryProjectId || projectId;
  const canonicalPageId = queryFileId || filePath;

  // Compute Yjs WebSocket URL from the API base URL (Yjs endpoint lives on the API server)
  let wsUrl = "";
  if (apiBaseUrl) {
    try {
      const apiUrl = new URL(apiBaseUrl);
      const wsProtocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${wsProtocol}//${apiUrl.host}/ws/${canonicalProjectId}/yjs`;
    } catch {
      // Invalid API URL — wsUrl stays empty, bridge won't self-connect
    }
  }
  const yjsGuid = branchId ? `${canonicalProjectId}:${branchId}` : canonicalProjectId;

  const bridgeConfig: Record<string, unknown> = {
    projectId: canonicalProjectId,
    pageId: canonicalPageId,
    pagePath: filePath,
  };
  if (wsUrl) bridgeConfig.wsUrl = wsUrl;
  if (yjsGuid) bridgeConfig.yjsGuid = yjsGuid;

  // Escape </script> sequences to prevent XSS breakout from inline JSON
  const safeJson = JSON.stringify(bridgeConfig).replace(/</g, "\\u003c");
  return `<script>window.__VF_BRIDGE_CONFIG__=${safeJson};</script>
  <script type="module" src="/_veryfront/studio-bridge.js"></script>`;
}

/**
 * Generate a complete HTML document for markdown preview rendering.
 *
 * Includes GitHub-flavored markdown styles, syntax highlighting,
 * mermaid diagram support with theme-aware re-rendering, and optional
 * studio bridge integration.
 */
export function generateMarkdownHtml(options: MarkdownHtmlOptions): string {
  const { rawHtml, title, description, request, url, projectId, filePath, branchId, apiBaseUrl } =
    options;

  const theme = detectTheme(request, url);
  const studioScript = buildStudioScript(url, projectId, filePath, branchId, apiBaseUrl);
  const themeAttrs = theme ? ` data-theme="${theme}" style="color-scheme: ${theme};"` : "";

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

  <script type="module">
    import mermaid from 'https://esm.sh/mermaid@11';

    function getMermaidTheme() {
      return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
    }

    async function initMermaid() {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      // Convert code.language-mermaid blocks to mermaid-compatible format
      // Store original source in data attribute for theme changes
      const elements = [];
      document.querySelectorAll('code.language-mermaid').forEach((code) => {
        const pre = code.parentElement;
        if (pre?.tagName === 'PRE') {
          const div = document.createElement('pre');
          div.className = 'mermaid';
          div.dataset.source = code.textContent;
          div.textContent = code.textContent;
          div.style.visibility = 'hidden';
          pre.replaceWith(div);
          elements.push(div);
        }
      });
      await mermaid.run();
      elements.forEach((el) => el.style.visibility = '');
    }

    async function rerenderMermaid() {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      // Hide, restore source, re-render, then show
      const elements = document.querySelectorAll('.mermaid');
      elements.forEach((el) => {
        if (el.dataset.source) {
          el.style.visibility = 'hidden';
          el.innerHTML = '';
          el.textContent = el.dataset.source;
          el.removeAttribute('data-processed');
        }
      });
      await mermaid.run();
      elements.forEach((el) => el.style.visibility = '');
    }

    // Initial render
    initMermaid();

    // Re-render mermaid when color mode changes (via Studio bridge)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          rerenderMermaid();
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  </script>

  <!-- Preview HMR -->
  <script src="/_veryfront/preview-hmr.js"></script>
</body>
</html>`;
}
