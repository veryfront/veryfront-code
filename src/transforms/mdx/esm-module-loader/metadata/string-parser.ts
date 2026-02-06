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

    if (ch === '"' || ch === "'") {
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
  let cleaned = moduleCode.replace(/import\s+.*?from\s+['"][^'"]+['"];?\s*/gm, "");

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
  } catch {
    return value;
  }
}
