/**
 * Lightweight HTML sanitizer for client-side use.
 *
 * Security model:
 * - RSC HTML from React's renderToString() is trusted (auto-escapes user content)
 * - Error messages and debug info are untrusted and must be escaped
 * - validateTrustedHtml() provides defense-in-depth for server HTML
 */

/**
 * Escape HTML entities to prevent XSS.
 * Use for untrusted strings that will be inserted into HTML.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Create text node safely (alternative to innerHTML for simple text).
 */
export function createSafeTextNode(text: string): Text {
  return document.createTextNode(text);
}

/**
 * Set text content safely (never interprets HTML).
 */
export function setSafeTextContent(element: HTMLElement, text: string): void {
  element.textContent = text;
}

/**
 * Patterns that RSC should never generate.
 * These indicate potential server compromise or misconfiguration.
 */
const SUSPICIOUS_PATTERNS = [
  { pattern: /<script[^>]*>[\s\S]*?<\/script>/gi, name: "inline script" },
  { pattern: /javascript:/gi, name: "javascript: URL" },
  { pattern: /\bon\w+\s*=/gi, name: "event handler attribute" },
  { pattern: /data:\s*text\/html/gi, name: "data: HTML URL" },
];

// Check if we're in development mode
function isDevMode(): boolean {
  if (typeof globalThis !== "undefined") {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    return g.__VERYFRONT_DEV__ === true || g.Deno?.env?.get?.("VERYFRONT_ENV") === "development";
  }
  return false;
}

export interface ValidateTrustedHtmlOptions {
  /** Throw on suspicious patterns even in dev mode */
  strict?: boolean;
  /** Log warnings for suspicious patterns */
  warn?: boolean;
}

/**
 * Validate trusted HTML from server (defense-in-depth).
 *
 * This is NOT a full sanitizer - server-rendered RSC content is trusted.
 * This catches scenarios where the server might be compromised or misconfigured.
 *
 * @param html - HTML string from server
 * @param options - Validation options
 * @returns The original HTML if valid
 * @throws Error if suspicious patterns detected in strict mode or production
 */
export function validateTrustedHtml(
  html: string,
  options: ValidateTrustedHtmlOptions = {},
): string {
  const { strict = false, warn = true } = options;

  for (const { pattern, name } of SUSPICIOUS_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;

    if (pattern.test(html)) {
      const message = `[Security] Suspicious ${name} detected in server HTML`;

      if (warn) {
        console.warn(message);
      }

      // In strict mode or production, throw
      if (strict || !isDevMode()) {
        throw new Error(`Potentially unsafe HTML: ${name} detected`);
      }
    }
  }

  return html;
}

/**
 * Create an error display element safely using DOM APIs.
 * Use this instead of innerHTML for displaying error messages.
 */
export function createErrorDisplay(options: {
  title: string;
  message: string;
  details?: string;
  style?: Partial<CSSStyleDeclaration>;
}): HTMLDivElement {
  const { title, message, details, style } = options;

  const container = document.createElement("div");

  // Apply default error styling
  Object.assign(container.style, {
    color: "red",
    border: "2px solid red",
    padding: "10px",
    margin: "5px",
    fontFamily: "monospace",
    fontSize: "14px",
    backgroundColor: "#fff0f0",
    ...style,
  });

  // Title
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  container.appendChild(titleEl);
  container.appendChild(document.createElement("br"));

  // Message
  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  container.appendChild(messageEl);

  // Details (optional)
  if (details) {
    container.appendChild(document.createElement("br"));
    const detailsEl = document.createElement("pre");
    detailsEl.style.cssText = "margin: 5px 0; white-space: pre-wrap; word-break: break-word;";
    detailsEl.textContent = details;
    container.appendChild(detailsEl);
  }

  return container;
}
