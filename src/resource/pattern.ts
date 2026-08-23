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

function isParameterBoundary(character: string | undefined): boolean {
  return character === "/" || character === "?" || character === "&" ||
    character === "=" || character === "#";
}

function escapeRegExp(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (
      character === "." || character === "*" || character === "+" ||
      character === "?" || character === "^" || character === "$" ||
      character === "{" || character === "}" || character === "(" ||
      character === ")" || character === "|" || character === "[" ||
      character === "]" || character === "\\"
    ) {
      escaped += "\\";
    }
    escaped += character;
  }
  return escaped;
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
  let value = "";
  let literalStart = 0;
  let parameterized = false;
  let segmentParameterized = false;

  for (let index = 0; index < pattern.length; index++) {
    if (isParameterBoundary(pattern[index])) {
      segmentParameterized = false;
    }
    if (pattern[index] !== ":") continue;
    const firstNameCode = pattern.charCodeAt(index + 1);
    if (
      (index !== 0 && !isParameterBoundary(pattern[index - 1]) && !segmentParameterized) ||
      !isParameterNameStart(firstNameCode)
    ) {
      continue;
    }

    let end = index + 2;
    while (end < pattern.length && isParameterNamePart(pattern.charCodeAt(end))) end++;
    value += transformLiteral(pattern.slice(literalStart, index));
    value += transformParameter(pattern.slice(index + 1, end));
    literalStart = end;
    index = end - 1;
    parameterized = true;
    segmentParameterized = true;
  }
  value += transformLiteral(pattern.slice(literalStart));
  return { value, parameterized };
}
