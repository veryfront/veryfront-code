import { escapeHTML } from "./html-escape.ts";

export function buildRootAttributes(
  slug: string,
  mode: string,
  noLayout: boolean,
): string {
  const attributes = [
    'id="root"',
    noLayout ? "" : 'class="vf-tailwind"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
  ]
    .filter(Boolean)
    .join(" ");

  return attributes;
}

export function buildContentAttributes(
  slug: string,
  noLayout: boolean,
  ssrHash?: string,
): string {
  const attrs = [
    'id="veryfront-content"',
    `data-slug="${slug || ""}"`,
    `data-layout="${noLayout ? "none" : "default"}"`,
    ssrHash ? `data-ssr-hash="${escapeHTML(ssrHash)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return attrs;
}

function getDefaultHTMLImportMap(): Record<string, string> {
  return {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
  };
}

export function buildImportMapJson(importMap?: Record<string, string>): string {
  const imports = importMap || getDefaultHTMLImportMap();
  return JSON.stringify({ imports }, null, 2);
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
