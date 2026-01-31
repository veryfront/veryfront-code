/**
 * Extract all export names from source code.
 * Handles export function/class/const, named exports, and default exports.
 */
export function extractExportNames(source: string): string[] {
  const names = new Set<string>();

  if (/export\s+default\s+/m.test(source)) {
    names.add("default");
  }

  for (const match of source.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
    if (match[1]) names.add(match[1]);
  }

  for (const match of source.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    if (match[1]) names.add(match[1]);
  }

  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)/g)) {
    if (match[1]) names.add(match[1]);
  }

  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const innerRaw = match[1];
    if (!innerRaw) continue;
    const inner = innerRaw.split(",");
    for (const seg of inner) {
      const part = seg.trim();
      if (!part) continue;

      const asMatch = part.match(/([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)/i);
      if (asMatch?.[2]) {
        names.add(asMatch[2]);
        continue;
      }

      const plain = part.match(/^([A-Za-z0-9_]+)/);
      if (plain?.[1]) names.add(plain[1]);
    }
  }

  return [...names];
}
