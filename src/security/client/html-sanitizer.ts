/**
 * Lightweight HTML sanitizer for client-side use.
 *
 * Security model:
 * - RSC HTML from React's renderToString() is trusted (auto-escapes user content)
 * - Error messages and debug info are untrusted and must be escaped
 * - validateTrustedHtml() provides defense-in-depth for server HTML
 */

import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";

export { escapeHtml };

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

/** Global interface for Veryfront runtime flags */
interface GlobalWithVeryfrontEnv {
  __VERYFRONT_DEV__?: boolean;
  Deno?: {
    env?: {
      get?: (name: string) => string | undefined;
    };
  };
}

function isDevMode(): boolean {
  const g = globalThis as GlobalWithVeryfrontEnv;
  return g.__VERYFRONT_DEV__ === true || g.Deno?.env?.get?.("VERYFRONT_ENV") === "development";
}

interface ValidateTrustedHtmlOptions {
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
    pattern.lastIndex = 0;
    if (!pattern.test(html)) continue;

    if (warn) console.warn(`[Security] Suspicious ${name} detected in server HTML`);
    if (strict || !isDevMode()) {
      throw SECURITY_VIOLATION.create({ detail: `Potentially unsafe HTML: ${name} detected` });
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

  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  container.append(titleEl, document.createElement("br"));

  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  container.appendChild(messageEl);

  if (!details) return container;

  const detailsEl = document.createElement("pre");
  detailsEl.style.cssText = "margin: 5px 0; white-space: pre-wrap; word-break: break-word;";
  detailsEl.textContent = details;
  container.append(document.createElement("br"), detailsEl);

  return container;
}
