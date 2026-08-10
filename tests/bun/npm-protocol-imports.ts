type Token = {
  kind: "identifier" | "punctuator" | "string";
  value: string;
};

/** Module paths whose imports need Bun-specific rewriting before resolution. */
export const BUN_REWRITE_MODULE_FILTER =
  /(\.test\.[cm]?[jt]sx?|[/\\]extensions[/\\]ext-[^/\\]+[/\\]src[/\\].*\.[cm]?[jt]sx?)$/;

function bareNpmSpecifier(specifier: string): string {
  const value = specifier.slice("npm:".length);
  const match = /^((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?(\/.*)?$/.exec(value);
  if (!match?.[1]) throw new Error(`Cannot translate Bun npm specifier: ${specifier}`);
  return `${match[1]}${match[2] ?? ""}`;
}

function isModuleSpecifier(tokens: Token[]): boolean {
  const previous = tokens.at(-1);
  if (previous?.kind === "identifier") {
    return previous.value === "from" || previous.value === "import";
  }
  return previous?.value === "(" && tokens.at(-2)?.value === "import";
}

/** Rewrite real module specifiers without touching fixture strings or comments. */
export function rewriteModuleSpecifiers(
  source: string,
  resolveSpecifier: (specifier: string) => string | null,
): string | null {
  const tokens: Token[] = [];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === "`") break;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      const start = index + 1;
      index = start;
      while (index < source.length && source[index] !== char) {
        index += source[index] === "\\" ? 2 : 1;
      }
      const value = source.slice(start, index);
      if (!value.includes("\\") && isModuleSpecifier(tokens)) {
        const replacement = resolveSpecifier(value);
        if (replacement !== null && replacement !== value) {
          replacements.push({ start, end: index, value: replacement });
        }
      }
      tokens.push({ kind: "string", value });
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < source.length && /[\w$]/.test(source[index]!)) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "punctuator", value: char });
    index += 1;
  }

  if (replacements.length === 0) return null;
  let transformed = source;
  for (const replacement of replacements.reverse()) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${
      transformed.slice(replacement.end)
    }`;
  }
  return transformed;
}

/** Rewrite real npm: imports without touching import-looking strings or comments. */
export function rewriteNpmProtocolImports(source: string): string | null {
  return rewriteModuleSpecifiers(
    source,
    (specifier) => specifier.startsWith("npm:") ? bareNpmSpecifier(specifier) : null,
  );
}

/** Rewrite imports selected by the Bun preload hook on every path style. */
export function rewriteBunPreloadedModuleContents(
  modulePath: string,
  source: string,
  resolveWorkspaceSpecifier: (specifier: string) => string | null,
): string {
  const posixPath = modulePath.replaceAll("\\", "/");
  let contents = posixPath.includes("/extensions/")
    ? rewriteModuleSpecifiers(source, resolveWorkspaceSpecifier) ?? source
    : source;
  if (/\.test\.[cm]?[jt]sx?$/.test(posixPath)) {
    contents = rewriteNpmProtocolImports(contents) ?? contents;
  }
  return contents;
}
