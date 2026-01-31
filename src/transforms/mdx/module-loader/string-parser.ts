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

export function cleanModuleCode(moduleCode: string): string {
  return moduleCode
    .replace(/import\s+.*?from\s+['"][^'"]+['"];?\s*/gm, "")
    .replace(/export\s+\{[\s\S]*?\};?$/gm, "")
    .replace(/export\s+default\s+/gm, "")
    .replace(/export\s+const\s+/gm, "const ")
    .replace(/export\s+function\s+/gm, "function ");
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
