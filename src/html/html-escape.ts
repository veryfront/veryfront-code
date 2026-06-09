export function escapeHTML(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeHtml = escapeHTML;

export function buildAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHTML(value)}"`)
    .join(" ");
}

export function buildNonceAttribute(nonce?: string): string {
  return nonce ? ` nonce="${escapeHTML(nonce)}"` : "";
}

export function escapeInlineScriptContent(content: string): string {
  return String(content ?? "").replace(/<\/script/gi, "<\\/script");
}

export function escapeInlineStyleContent(content: string): string {
  return String(content ?? "").replace(/<\/style/gi, "<\\/style");
}
