
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createSafeTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function setSafeTextContent(element: HTMLElement, text: string): void {
  element.textContent = text;
}

const SUSPICIOUS_PATTERNS = [
  { pattern: /<script[^>]*>[\s\S]*?<\/script>/gi, name: "inline script" },
  { pattern: /javascript:/gi, name: "javascript: URL" },
  { pattern: /\bon\w+\s*=/gi, name: "event handler attribute" },
  { pattern: /data:\s*text\/html/gi, name: "data: HTML URL" },
];

function isDevMode(): boolean {
  if (typeof globalThis !== "undefined") {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    return g.__VERYFRONT_DEV__ === true || g.Deno?.env?.get?.("VERYFRONT_ENV") === "development";
  }
  return false;
}

export interface ValidateTrustedHtmlOptions {
  strict?: boolean;
  warn?: boolean;
}

export function validateTrustedHtml(
  html: string,
  options: ValidateTrustedHtmlOptions = {},
): string {
  const { strict = false, warn = true } = options;

  for (const { pattern, name } of SUSPICIOUS_PATTERNS) {
    pattern.lastIndex = 0;

    if (pattern.test(html)) {
      const message = `[Security] Suspicious ${name} detected in server HTML`;

      if (warn) {
        console.warn(message);
      }

      if (strict || !isDevMode()) {
        throw new Error(`Potentially unsafe HTML: ${name} detected`);
      }
    }
  }

  return html;
}

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
  container.appendChild(titleEl);
  container.appendChild(document.createElement("br"));

  const messageEl = document.createElement("span");
  messageEl.textContent = message;
  container.appendChild(messageEl);

  if (details) {
    container.appendChild(document.createElement("br"));
    const detailsEl = document.createElement("pre");
    detailsEl.style.cssText = "margin: 5px 0; white-space: pre-wrap; word-break: break-word;";
    detailsEl.textContent = details;
    container.appendChild(detailsEl);
  }

  return container;
}
