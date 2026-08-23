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
  const schemeDelimiter = findSchemeDelimiter(pattern);
  const firstSchemeComponentEnd = findFirstSchemeComponentEnd(pattern, schemeDelimiter);

  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] !== ":") continue;
    if (index === schemeDelimiter) continue;
    const firstNameCode = pattern.charCodeAt(index + 1);
    if (!isParameterNameStart(firstNameCode)) continue;

    const inFirstSchemeComponent = schemeDelimiter >= 0 &&
      index > schemeDelimiter && index < firstSchemeComponentEnd;
    if (inFirstSchemeComponent && index !== schemeDelimiter + 1) continue;
    const previousCode = index === 0 ? -1 : pattern.charCodeAt(index - 1);
    if (
      !inFirstSchemeComponent && index !== 0 &&
      (isAsciiLetter(previousCode) || isAsciiDigit(previousCode))
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
  }
  value += transformLiteral(pattern.slice(literalStart));
  return { value, parameterized };
}
