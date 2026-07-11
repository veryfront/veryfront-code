export function extractBalancedBlock(
  source: string,
  startIndex: number,
  open: "{" | "[" | "(",
  close?: "}" | "]" | ")",
): string {
  const closeCh = close ?? (open === "{" ? "}" : open === "[" ? "]" : ")");
  let depth = 0;

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      // Skip over string/template-literal content so that delimiters inside
      // them (including `}` inside `${}` in template literals) are not counted
      // toward the bracket depth.  Template literal interpolations are treated
      // as opaque text — nested `${...}` is not recursed into.
      const quote = ch;

      for (i++; i < source.length; i++) {
        const q = source[i];

        if (q === "\\") {
          i++;
          continue;
        }

        if (q === quote) break;
      }

      continue;
    }

    if (ch === open) depth++;

    if (ch !== closeCh) continue;

    depth--;
    if (depth === 0) return source.slice(startIndex, i + 1);
  }

  return "";
}

const MODULE_CODE_CLEANUP_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/export\s+\{[\s\S]*?\};?$/gm, ""],
  [/export\s+default\s+/gm, ""],
  [/export\s+const\s+/gm, "const "],
  [/export\s+function\s+/gm, "function "],
];

export function cleanModuleCode(moduleCode: string): string {
  // Remove import statements, including multiline destructured imports.
  // `[\s\S]*?` crosses newlines so `import {\n  Foo,\n  Bar\n} from "mod"` is
  // fully removed.  The non-greedy match stops at the first `from` keyword,
  // which is correct for well-formed ESM (a variable literally named `from`
  // inside an import binding would break this, but that never appears in
  // MDX-compiled output).
  let cleaned = moduleCode.replace(/import\s+[\s\S]*?\bfrom\b\s+['"][^'"]+['"];?[ \t]*\n?/g, "");
  // Remove side-effect-only imports (no bindings, no `from`): import "mod"
  cleaned = cleaned.replace(/^import\s+['"][^'"]+['"];?[ \t]*\n?/gm, "");

  for (const [pattern, replacement] of MODULE_CODE_CLEANUP_RULES) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  return cleaned;
}

export function parseJsonish(value: string): unknown {
  const jsonish = value
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');

  try {
    return JSON.parse(jsonish);
  } catch (_) {
    /* expected: value may not be valid JSON */
    return value;
  }
}
