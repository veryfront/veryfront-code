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

/**
 * Neutralize the closing tag for a raw-text element (`script`/`style`) inside
 * inline content, so the content cannot break out of its element. The content
 * is otherwise left as-is (it is intentionally raw JS/CSS, not HTML).
 */
export function neutralizeRawTextContent(content: string, tag: "script" | "style"): string {
  return content.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

/**
 * Serialize a value to JSON safe for embedding inside an inline `<script>`.
 *
 * `JSON.stringify` alone does not neutralize `</script>` breakouts or the
 * U+2028/U+2029 line separators (which are invalid in JS string literals),
 * so any user-influenced data placed in a script tag must go through this.
 */
export function jsonForInlineScript(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
