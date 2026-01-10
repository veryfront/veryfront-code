const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const IGNORED_ELEMENTS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "noscript",
  "head",
  "html",
  "!doctype",
]);

interface InjectorOptions {
  /** Prefix for generated selectors */
  prefix?: string;
  /** Elements to skip (in addition to defaults) */
  skipElements?: string[];
  /** Only inject into elements within this selector */
  rootSelector?: string;
}

/** Inject data-vf-selector attributes into HTML for Studio Navigator */
export function injectElementSelectors(
  html: string,
  options: InjectorOptions = {},
): string {
  const { prefix = "vf", skipElements = [] } = options;
  const skipSet = new Set([...IGNORED_ELEMENTS, ...skipElements.map((e) => e.toLowerCase())]);

  let counter = 0;
  let inIgnoredElement = 0;
  let depth = 0;

  // Find the content div (id="veryfront-content" or id="root")
  // Only inject selectors within the content area
  const contentStartMatch = html.match(/<div[^>]*id="(?:veryfront-content|root)"[^>]*>/i);
  const contentStart = contentStartMatch ? html.indexOf(contentStartMatch[0]) : 0;

  // Process HTML by finding opening tags and injecting attributes
  const result = html.replace(
    /<(\/?)?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)\/?>/g,
    (match, isClosing, tagName, attributes, offset) => {
      const tag = tagName.toLowerCase();

      // Track depth for ignored elements
      if (isClosing) {
        if (skipSet.has(tag) && !VOID_ELEMENTS.has(tag)) {
          inIgnoredElement = Math.max(0, inIgnoredElement - 1);
        }
        depth--;
        return match;
      }

      depth++;

      // Skip if inside an ignored element or before content area
      if (inIgnoredElement > 0 || offset < contentStart) {
        if (skipSet.has(tag) && !VOID_ELEMENTS.has(tag)) {
          inIgnoredElement++;
        }
        return match;
      }

      // Skip ignored elements
      if (skipSet.has(tag)) {
        if (!VOID_ELEMENTS.has(tag)) {
          inIgnoredElement++;
        }
        return match;
      }

      // Skip if already has data-vf-* attribute
      if (/data-vf-(id|selector|ignore)/i.test(attributes || "")) {
        return match;
      }

      // Generate selector ID
      const selectorId = `${prefix}-${tag}-${++counter}`;

      // Inject the attribute
      const isVoid = VOID_ELEMENTS.has(tag);
      const isSelfClosing = match.endsWith("/>");

      if (isVoid || isSelfClosing) {
        // Self-closing: <tag ... /> or <tag ...>
        const insertPoint = match.lastIndexOf(isSelfClosing ? "/>" : ">");
        return (
          match.slice(0, insertPoint) +
          ` data-vf-selector="${selectorId}"` +
          match.slice(insertPoint)
        );
      }

      // Regular tag: <tag ...>
      const insertPoint = match.lastIndexOf(">");
      return (
        match.slice(0, insertPoint) +
        ` data-vf-selector="${selectorId}"` +
        match.slice(insertPoint)
      );
    },
  );

  return result;
}

/** Check if Studio embed mode is enabled from URL */
export function isStudioEmbed(url: URL | string): boolean {
  const urlObj = typeof url === "string" ? new URL(url) : url;
  return urlObj.searchParams.get("studio_embed") === "true";
}
