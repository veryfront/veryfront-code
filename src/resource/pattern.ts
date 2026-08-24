function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isParameterNameStart(code: number): boolean {
  return isAsciiLetter(code) || code === 95;
}

function isParameterNamePart(code: number): boolean {
  return isParameterNameStart(code) || isAsciiDigit(code);
}

function findSchemeDelimiter(pattern: string): number {
  if (!isAsciiLetter(pattern.charCodeAt(0))) return -1;
  for (let index = 1; index < pattern.length; index++) {
    const code = pattern.charCodeAt(index);
    if (code === 58) return index;
    if (
      !isAsciiLetter(code) && !isAsciiDigit(code) && code !== 43 &&
      code !== 45 && code !== 46
    ) {
      return -1;
    }
  }
  return -1;
}

function findFirstSchemeComponentEnd(pattern: string, schemeDelimiter: number): number {
  if (schemeDelimiter < 0) return -1;
  for (let index = schemeDelimiter + 1; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "/" || character === "?" || character === "#") return index;
  }
  return pattern.length;
}

function isUrnScheme(pattern: string, schemeDelimiter: number): boolean {
  if (schemeDelimiter !== 3) return false;
  const first = pattern.charCodeAt(0) | 32;
  const second = pattern.charCodeAt(1) | 32;
  const third = pattern.charCodeAt(2) | 32;
  return first === 117 && second === 114 && third === 110;
}

/**
 * Decide whether a rootless scheme-specific path is a template. It is when a
 * parameter starts at a boundary in the first component, or a later segment
 * begins with one; otherwise every colon in the path stays literal.
 */
function hasRootlessTemplateBoundary(
  pattern: string,
  schemeDelimiter: number,
  firstSchemeComponentEnd: number,
): boolean {
  for (let index = schemeDelimiter + 1; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "?" || character === "#") return false;
    if (character !== ":") continue;
    if (!isParameterNameStart(pattern.charCodeAt(index + 1))) continue;
    if (index < firstSchemeComponentEnd) {
      const previousCode = pattern.charCodeAt(index - 1);
      if (!isAsciiLetter(previousCode) && !isAsciiDigit(previousCode)) return true;
    } else if (pattern[index - 1] === "/") {
      return true;
    }
  }
  return false;
}

type ResourceComponent = "path" | "query" | "fragment";

type ResourcePatternToken =
  | { readonly kind: "literal"; readonly value: string }
  | {
    readonly kind: "parameter";
    readonly name: string;
    readonly component: ResourceComponent;
  };

interface ParsedResourcePattern {
  readonly tokens: readonly ResourcePatternToken[];
  readonly parameterNames: readonly string[];
  readonly adjacentParameters?: readonly [string, string];
}

function parseResourcePattern(pattern: string): ParsedResourcePattern {
  const tokens: ResourcePatternToken[] = [];
  const parameterNames: string[] = [];
  let adjacentParameters: readonly [string, string] | undefined;
  let literalStart = 0;
  const schemeDelimiter = findSchemeDelimiter(pattern);
  const firstSchemeComponentEnd = findFirstSchemeComponentEnd(pattern, schemeDelimiter);
  const urnScheme = isUrnScheme(pattern, schemeDelimiter);
  const hierarchicalScheme = schemeDelimiter >= 0 &&
    pattern[schemeDelimiter + 1] === "/";
  const rootlessTemplatePath = schemeDelimiter >= 0 && !urnScheme && !hierarchicalScheme &&
    hasRootlessTemplateBoundary(pattern, schemeDelimiter, firstSchemeComponentEnd);
  let component: ResourceComponent = "path";

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "?" && component === "path") component = "query";
    else if (character === "#") component = "fragment";
    if (character !== ":") continue;
    if (index === schemeDelimiter) continue;
    const firstNameCode = pattern.charCodeAt(index + 1);
    if (!isParameterNameStart(firstNameCode)) continue;

    const previousCode = index === 0 ? -1 : pattern.charCodeAt(index - 1);
    const legacyParameterContext = index === 0 ||
      (!isAsciiLetter(previousCode) && !isAsciiDigit(previousCode));
    const parameterContext = urnScheme && component === "path"
      ? false
      : schemeDelimiter < 0 || component !== "path" || hierarchicalScheme
      ? legacyParameterContext
      : rootlessTemplatePath && legacyParameterContext;
    if (!parameterContext) continue;

    let end = index + 2;
    while (end < pattern.length && isParameterNamePart(pattern.charCodeAt(end))) end++;
    if (index > literalStart) {
      tokens.push({ kind: "literal", value: pattern.slice(literalStart, index) });
    }
    const name = pattern.slice(index + 1, end);
    if (
      adjacentParameters === undefined && pattern[end] === ":" &&
      isParameterNameStart(pattern.charCodeAt(end + 1))
    ) {
      let adjacentEnd = end + 2;
      while (
        adjacentEnd < pattern.length &&
        isParameterNamePart(pattern.charCodeAt(adjacentEnd))
      ) {
        adjacentEnd++;
      }
      adjacentParameters = [name, pattern.slice(end + 1, adjacentEnd)];
    }
    tokens.push({ kind: "parameter", name, component });
    parameterNames.push(name);
    literalStart = end;
    index = end - 1;
  }
  if (literalStart < pattern.length) {
    tokens.push({ kind: "literal", value: pattern.slice(literalStart) });
  }
  return { tokens, parameterNames, adjacentParameters };
}

function captureAllows(component: ResourceComponent, value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "#") return false;
    if (component === "path" && (character === "/" || character === "?")) return false;
    if (component === "query" && character === "&") return false;
  }
  return true;
}

function findCaptureEnd(uri: string, offset: number, component: ResourceComponent): number {
  for (let index = offset; index < uri.length; index++) {
    const character = uri[index];
    if (character === "#") return index;
    if (component === "path" && (character === "/" || character === "?")) return index;
    if (component === "query" && character === "&") return index;
  }
  return uri.length;
}

/** Validate construction-only parameter rules and return admitted names. */
export function validateResourcePatternParameters(pattern: string): readonly string[] {
  const parsed = parseResourcePattern(pattern);
  if (parsed.adjacentParameters) {
    const [left, right] = parsed.adjacentParameters;
    throw new TypeError(
      `Resource pattern parameters "${left}" and "${right}" require a literal separator`,
    );
  }
  return parsed.parameterNames;
}

/**
 * Match one resource URI deterministically and decode captures exactly once.
 * Malformed percent escapes and raw component delimiters do not match.
 */
export function matchResourcePattern(
  uri: string,
  pattern: string,
): Record<string, string> | undefined {
  const { tokens, parameterNames } = parseResourcePattern(pattern);
  if (parameterNames.length === 0) return uri === pattern ? {} : undefined;

  const params = Object.create(null) as Record<string, string>;
  let offset = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === "literal") {
      if (!uri.startsWith(token.value, offset)) return undefined;
      offset += token.value.length;
      continue;
    }

    const next = tokens[index + 1];
    const end = next?.kind === "literal"
      ? uri.indexOf(next.value, offset)
      : findCaptureEnd(uri, offset, token.component);
    if (end < offset) return undefined;
    const rawValue = uri.slice(offset, end);
    if (!captureAllows(token.component, rawValue)) return undefined;
    try {
      params[token.name] = decodeURIComponent(rawValue);
    } catch {
      return undefined;
    }
    offset = end;
  }
  return offset === uri.length ? params : undefined;
}

export function resourcePatternToUriTemplate(pattern: string): string | undefined {
  const { tokens, parameterNames } = parseResourcePattern(pattern);
  if (parameterNames.length === 0) return undefined;
  let template = "";
  for (const token of tokens) {
    template += token.kind === "literal" ? token.value : `{${token.name}}`;
  }
  return template;
}
