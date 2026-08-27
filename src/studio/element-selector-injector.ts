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

// `html` wraps the whole document, so it must never be annotated itself while
// still letting its contents be annotated. Studio always receives a full
// document, and suppressing the subtree here would annotate nothing at all.
const NON_SUPPRESSING_ELEMENTS = new Set(["html"]);

interface InjectorOptions {
  /** Prefix for generated selectors */
  prefix?: string;
  /** Elements to skip (in addition to defaults) */
  skipElements?: string[];
}

/** Inject data-vf-selector attributes into HTML for Studio Navigator */
export function injectElementSelectors(
  html: string,
  options: InjectorOptions = {},
): string {
  const { prefix = "vf", skipElements = [] } = options;

  const skipSet = new Set([
    ...IGNORED_ELEMENTS,
    ...skipElements.map((e) => e.toLowerCase()),
  ]);

  let counter = 0;
  let inIgnoredElement = 0;

  // Find the content div (id="root")
  // Only inject selectors within the content area
  const contentStartMatch = html.match(
    /<div[^>]*id="root"[^>]*>/i,
  );
  const contentStart = contentStartMatch ? html.indexOf(contentStartMatch[0]) : 0;

  return html.replace(
    /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)\/?>/g,
    (match, isClosing, tagName, attributes = "", offset) => {
      const tag = tagName.toLowerCase();
      const isVoid = VOID_ELEMENTS.has(tag);
      const isSelfClosing = match.endsWith("/>");

      const suppressesContent = !isVoid && !NON_SUPPRESSING_ELEMENTS.has(tag);

      if (isClosing) {
        if (skipSet.has(tag) && suppressesContent) {
          inIgnoredElement = Math.max(0, inIgnoredElement - 1);
        }
        return match;
      }

      if (skipSet.has(tag)) {
        if (suppressesContent) inIgnoredElement++;
        return match;
      }

      if (inIgnoredElement > 0 || offset < contentStart) return match;
      if (/data-vf-(id|selector|ignore)/i.test(attributes)) return match;

      const selectorId = `${prefix}-${tag}-${++counter}`;
      const insertPoint = match.lastIndexOf(isSelfClosing ? "/>" : ">");

      return (
        match.slice(0, insertPoint) +
        ` data-vf-selector="${selectorId}"` +
        match.slice(insertPoint)
      );
    },
  );
}

/** Check if Studio embed mode is enabled from URL */
export function isStudioEmbed(url: URL | string): boolean {
  const urlObj = typeof url === "string" ? new URL(url) : url;
  return urlObj.searchParams.get("studio_embed") === "true";
}
