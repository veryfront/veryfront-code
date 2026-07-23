const MAX_INTEGRATION_ICON_BYTES = 256 * 1024;

const DISALLOWED_ELEMENT_PATTERN = new RegExp(
  String
    .raw`<\s*\/?\s*(?:a|animate|animateMotion|animateTransform|audio|discard|embed|foreignObject|iframe|image|link|mpath|object|script|set|style|use|video)\b`,
  "i",
);
const EVENT_HANDLER_PATTERN = /\s+on[A-Za-z0-9_.:-]*\s*=/i;
const EXTERNAL_REFERENCE_ATTRIBUTE_PATTERN = /\s+(?:href|xlink:href|src)\s*=/i;
const NAMESPACED_ELEMENT_PATTERN = /<\s*\/?\s*[A-Za-z_][A-Za-z0-9_.-]*:/;
const XML_DECLARATION_PATTERN = /<\s*[!?]/;
const ALLOWED_INLINE_STYLE_PATTERN = /^\s*mask-type\s*:\s*luminance\s*;?\s*$/i;

function rejectUnsafeIcon(): never {
  throw new TypeError("Integration icon must be an inert, self-contained SVG");
}

function containsInvalidXmlControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function hasOnlyInternalPaintReferences(svg: string): boolean {
  const starts = [...svg.matchAll(/\burl\s*\(/gi)];
  const references = [...svg.matchAll(/\burl\s*\(([^)]*)\)/gi)];
  if (starts.length !== references.length) return false;

  for (const reference of references) {
    let target = reference[1]?.trim() ?? "";
    if (
      target.length >= 2 &&
      ((target.startsWith('"') && target.endsWith('"')) ||
        (target.startsWith("'") && target.endsWith("'")))
    ) {
      target = target.slice(1, -1).trim();
    }
    if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(target)) return false;
  }
  return true;
}

function hasOnlySafeInlineStyles(svg: string): boolean {
  for (const match of svg.matchAll(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[1] ?? match[2] ?? "";
    if (!ALLOWED_INLINE_STYLE_PATTERN.test(value)) return false;
  }

  const declaredStyles = [...svg.matchAll(/\s+style\s*=/gi)];
  const parsedStyles = [...svg.matchAll(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi)];
  return declaredStyles.length === parsedStyles.length;
}

/**
 * Validate an integration icon before embedding its raw SVG in the catalog.
 *
 * The validator accepts inert vector markup and local paint references. It
 * rejects active elements, resource-loading attributes, declarations, and
 * malformed or oversized input. The original string is returned unchanged.
 */
export function assertSafeIntegrationIconSvg(svg: string): string {
  if (
    typeof svg !== "string" ||
    new TextEncoder().encode(svg).byteLength > MAX_INTEGRATION_ICON_BYTES
  ) {
    return rejectUnsafeIcon();
  }

  const trimmed = svg.trim();
  if (
    !/^<svg(?:\s|>)/i.test(trimmed) ||
    !/<\/svg>$/i.test(trimmed) ||
    (trimmed.match(/<svg(?:\s|>)/gi)?.length ?? 0) !== 1 ||
    (trimmed.match(/<\/svg>/gi)?.length ?? 0) !== 1 ||
    XML_DECLARATION_PATTERN.test(trimmed) ||
    trimmed.includes("&") ||
    trimmed.includes("\\") ||
    containsInvalidXmlControlCharacter(trimmed) ||
    DISALLOWED_ELEMENT_PATTERN.test(trimmed) ||
    EVENT_HANDLER_PATTERN.test(trimmed) ||
    EXTERNAL_REFERENCE_ATTRIBUTE_PATTERN.test(trimmed) ||
    NAMESPACED_ELEMENT_PATTERN.test(trimmed) ||
    !hasOnlyInternalPaintReferences(trimmed) ||
    !hasOnlySafeInlineStyles(trimmed)
  ) {
    return rejectUnsafeIcon();
  }

  return svg;
}
