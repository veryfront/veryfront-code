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
  const reactVersion = "18.3.1";
  const veryfrontVersion = "0.0.12";

  return {
    // React core
    "react": `https://esm.sh/react@${reactVersion}`,
    "react-dom": `https://esm.sh/react-dom@${reactVersion}`,
    "react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client`,
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${reactVersion}/jsx-dev-runtime`,

    // Veryfront AI client-side modules
    "veryfront/ai/react": `https://esm.sh/veryfront@${veryfrontVersion}/ai/react?external=react`,
    "veryfront/ai/components": `https://esm.sh/veryfront@${veryfrontVersion}/ai/components?external=react`,
    "veryfront/ai/primitives": `https://esm.sh/veryfront@${veryfrontVersion}/ai/primitives?external=react`,
  };
}

export function buildImportMapJson(importMap?: Record<string, string>): string {
  const imports = importMap || getDefaultHTMLImportMap();
  return JSON.stringify({ imports }, null, 2);
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
