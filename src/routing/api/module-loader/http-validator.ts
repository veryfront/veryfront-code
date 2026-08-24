import { createError, toError } from "#veryfront/errors";

export function isAllowedRemoteHost(url: URL, allowedHosts: string[]): boolean {
  return allowedHosts.some((host) => {
    try {
      return new URL(host).origin === url.origin;
    } catch (_) {
      return false;
    }
  });
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function skipLineComment(source: string, index: number): number {
  const newline = source.indexOf("\n", index + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function readStringLiteral(source: string, index: number): { value: string; end: number } | null {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let value = "";
  for (let i = index + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      value += source.slice(i, i + 2);
      i++;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    value += char;
  }

  return null;
}

function skipStringLiteral(source: string, index: number): number {
  return readStringLiteral(source, index)?.end ?? source.length;
}

function skipWhitespaceAndComments(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char ?? "")) {
      i++;
      continue;
    }
    if (char === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    break;
  }
  return i;
}

function readSpecifierAfterFrom(source: string, index: number): string | null {
  let i = index;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    const char = source[i];
    const next = source[i + 1];

    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (char === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (char === ";" || char === "\n" || char === undefined) return null;

    if (
      source.startsWith("from", i) &&
      !isIdentifierChar(source[i - 1]) &&
      !isIdentifierChar(source[i + "from".length])
    ) {
      const specifierIndex = skipWhitespaceAndComments(source, i + "from".length);
      return readStringLiteral(source, specifierIndex)?.value ?? null;
    }

    i++;
  }
  return null;
}

function extractRemoteModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i) - 1;
      continue;
    }

    if (isIdentifierChar(source[i - 1])) continue;

    if (source.startsWith("import", i) && !isIdentifierChar(source[i + "import".length])) {
      const afterImport = skipWhitespaceAndComments(source, i + "import".length);
      if (source[afterImport] === "(") {
        const specifierIndex = skipWhitespaceAndComments(source, afterImport + 1);
        const specifier = readStringLiteral(source, specifierIndex)?.value;
        if (specifier?.startsWith("http://") || specifier?.startsWith("https://")) {
          specifiers.push(specifier);
        }
        continue;
      }

      const sideEffectSpecifier = readStringLiteral(source, afterImport)?.value;
      if (
        sideEffectSpecifier?.startsWith("http://") ||
        sideEffectSpecifier?.startsWith("https://")
      ) {
        specifiers.push(sideEffectSpecifier);
        continue;
      }

      const specifier = readSpecifierAfterFrom(source, afterImport);
      if (specifier?.startsWith("http://") || specifier?.startsWith("https://")) {
        specifiers.push(specifier);
      }
      continue;
    }

    if (source.startsWith("export", i) && !isIdentifierChar(source[i + "export".length])) {
      const specifier = readSpecifierAfterFrom(source, i + "export".length);
      if (specifier?.startsWith("http://") || specifier?.startsWith("https://")) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

export function validateHTTPImports(source: string, allowedHosts: string[]): void {
  for (const url of extractRemoteModuleSpecifiers(source)) {
    if (!url) continue;

    let u: URL;
    try {
      u = new URL(url);
    } catch (_) {
      /* expected: URL may be malformed */
      continue;
    }

    if (isAllowedRemoteHost(u, allowedHosts)) continue;

    const remediation =
      `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw toError(
      createError({
        type: "api",
        message:
          `[API] handler build failed: Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
      }),
    );
  }
}
