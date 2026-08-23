const RESOURCE_PARAMETER = /:([A-Za-z_][A-Za-z0-9_]*)/g;
const RESOURCE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resourcePatternToRegex(pattern: string): RegExp {
  return new RegExp(
    `^${transformResourcePattern(pattern, escapeRegExp, (name) => `(?<${name}>[^/]+)`).value}$`,
  );
}

export function resourcePatternToUriTemplate(pattern: string): string | undefined {
  const transformed = transformResourcePattern(
    pattern,
    (literal) => literal,
    (name) => `{${name}}`,
  );
  return transformed.parameterized ? transformed.value : undefined;
}

function transformResourcePattern(
  pattern: string,
  transformLiteral: (literal: string) => string,
  transformParameter: (name: string) => string,
): { value: string; parameterized: boolean } {
  const schemeMatch = RESOURCE_SCHEME.exec(pattern);
  const parameterStart = schemeMatch && pattern[schemeMatch[0].length] !== "/"
    ? pattern.length
    : schemeMatch?.[0].length ?? 0;
  let value = "";
  let literalStart = 0;
  let parameterized = false;
  RESOURCE_PARAMETER.lastIndex = 0;

  for (
    let match = RESOURCE_PARAMETER.exec(pattern);
    match;
    match = RESOURCE_PARAMETER.exec(pattern)
  ) {
    if (match.index < parameterStart) continue;
    value += transformLiteral(pattern.slice(literalStart, match.index));
    value += transformParameter(match[1]!);
    literalStart = match.index + match[0].length;
    parameterized = true;
  }
  value += transformLiteral(pattern.slice(literalStart));
  return { value, parameterized };
}
