export type Capability = { type: string; [key: string]: unknown };

export interface ContractMetadata {
  provides?: string[];
  requires?: string[];
}

export interface ExtensionSourceMetadata {
  contracts?: ContractMetadata;
  legacyProvides: string[];
  capabilities: Capability[];
}

const KNOWN_CONTRACT_CONSTANTS: Record<string, string> = {
  LLMProviderRegistryName: "LLMProviderRegistry",
  SandboxShellToolsProviderName: "SandboxShellToolsProvider",
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function isBoundary(source: string, index: number): boolean {
  return !isIdentifierPart(source[index]);
}

function skipString(source: string, index: number, quote: string): number {
  let i = index + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function skipLineComment(source: string, index: number): number {
  const next = source.indexOf("\n", index + 2);
  return next === -1 ? source.length : next + 1;
}

function skipBlockComment(source: string, index: number): number {
  const next = source.indexOf("*/", index + 2);
  return next === -1 ? source.length : next + 2;
}

function skipTrivia(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    if (/\s/.test(source[i] ?? "")) {
      i += 1;
      continue;
    }
    if (source.startsWith("//", i)) {
      i = skipLineComment(source, i);
      continue;
    }
    if (source.startsWith("/*", i)) {
      i = skipBlockComment(source, i);
      continue;
    }
    return i;
  }
  return i;
}

function findPropertyColon(
  source: string,
  propertyName: string,
  startIndex = 0,
): number {
  let i = startIndex;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      i = skipString(source, i, char);
      continue;
    }
    if (char === "`") {
      i = skipString(source, i, char);
      continue;
    }
    if (source.startsWith("//", i)) {
      i = skipLineComment(source, i);
      continue;
    }
    if (source.startsWith("/*", i)) {
      i = skipBlockComment(source, i);
      continue;
    }
    if (
      source.startsWith(propertyName, i) &&
      isBoundary(source, i - 1) &&
      isBoundary(source, i + propertyName.length)
    ) {
      const colonIndex = skipTrivia(source, i + propertyName.length);
      if (source[colonIndex] === ":") return colonIndex;
    }
    i += 1;
  }
  return -1;
}

function balancedExpression(
  source: string,
  valueIndex: number,
): string | undefined {
  const start = skipTrivia(source, valueIndex);
  const opener = source[start];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : undefined;
  if (!closer) return undefined;

  const stack: string[] = [closer];
  let i = start + 1;
  while (i < source.length && stack.length > 0) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i, char);
      continue;
    }
    if (source.startsWith("//", i)) {
      i = skipLineComment(source, i);
      continue;
    }
    if (source.startsWith("/*", i)) {
      i = skipBlockComment(source, i);
      continue;
    }
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    if (char === stack[stack.length - 1]) stack.pop();
    i += 1;
  }

  return stack.length === 0 ? source.slice(start, i) : undefined;
}

function findPropertyExpression(
  source: string,
  propertyName: string,
  startIndex = 0,
): string | undefined {
  const colonIndex = findPropertyColon(source, propertyName, startIndex);
  if (colonIndex === -1) return undefined;
  return balancedExpression(source, colonIndex + 1);
}

function parseStringOrKnownIdentifier(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    try {
      return JSON.parse(
        quote === '"'
          ? trimmed
          : `"${trimmed.slice(1, -1).replaceAll('"', '\\"')}"`,
      );
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return KNOWN_CONTRACT_CONSTANTS[trimmed];
}

function splitTopLevelComma(source: string): string[] {
  const parts: string[] = [];
  let partStart = 0;
  const stack: string[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i, char);
      continue;
    }
    if (source.startsWith("//", i)) {
      i = skipLineComment(source, i);
      continue;
    }
    if (source.startsWith("/*", i)) {
      i = skipBlockComment(source, i);
      continue;
    }
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    if (char === stack[stack.length - 1]) stack.pop();
    if (char === "," && stack.length === 0) {
      parts.push(source.slice(partStart, i));
      partStart = i + 1;
    }
    i += 1;
  }
  parts.push(source.slice(partStart));
  return parts;
}

function parseStringArrayExpression(source: string | undefined): string[] {
  if (!source?.startsWith("[")) return [];
  const inner = source.slice(1, -1);
  return uniqueSorted(
    splitTopLevelComma(inner)
      .map(parseStringOrKnownIdentifier)
      .filter((value): value is string =>
        typeof value === "string" && value.length > 0
      ),
  );
}

function parseContracts(source: string): ContractMetadata | undefined {
  const contractsSource = findPropertyExpression(source, "contracts");
  if (!contractsSource) return undefined;

  const provides = parseStringArrayExpression(
    findPropertyExpression(contractsSource, "provides"),
  );
  const requires = parseStringArrayExpression(
    findPropertyExpression(contractsSource, "requires"),
  );

  return {
    ...(provides.length > 0 ? { provides } : {}),
    ...(requires.length > 0 ? { requires } : {}),
  };
}

function parseLegacyProvides(source: string): string[] {
  if (findPropertyExpression(source, "contracts")) return [];

  const providesSource = findPropertyExpression(source, "provides");
  if (!providesSource?.startsWith("{")) return [];

  const keys: string[] = [];
  const inner = providesSource.slice(1, -1);
  for (const part of splitTopLevelComma(inner)) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const quoted = /^["']([^"']+)["']\s*:/.exec(trimmed);
    if (quoted) {
      keys.push(quoted[1]);
      continue;
    }

    const identifier = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(trimmed);
    if (identifier) keys.push(identifier[1]);
  }

  return uniqueSorted(keys);
}

function toJsonLiteral(source: string): string {
  return source
    .replace(/\/\/[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, "$1");
}

function isCapability(value: unknown): value is Capability {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).type === "string";
}

function parseCapabilities(source: string): Capability[] {
  const capabilitiesSource = findPropertyExpression(source, "capabilities");
  if (!capabilitiesSource) return [];

  const parsed = JSON.parse(toJsonLiteral(capabilitiesSource)) as unknown;
  return Array.isArray(parsed) ? parsed.filter(isCapability) : [];
}

export function extractExtensionSourceMetadata(
  source: string,
): ExtensionSourceMetadata {
  return {
    contracts: parseContracts(source),
    legacyProvides: parseLegacyProvides(source),
    capabilities: parseCapabilities(source),
  };
}
