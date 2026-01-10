/**
 * Extract all export names from source code.
 * Handles export function/class/const, named exports, and default exports.
 */
export function extractExportNames(source: string): string[] {
  const names = new Set<string>();

  // export default
  if (/export\s+default\s+/m.test(source)) {
    names.add("default");
  }

  // export function Name() {}
  for (const m of source.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }

  // export class Name {}
  for (const m of source.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }

  // export const/let/var Name =
  for (const m of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }

  // export { A, B as C }
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const inner = m[1]?.split(",") ?? [];
    for (const seg of inner) {
      const part = seg.trim();
      if (!part) continue;
      // Handle "Name as Alias" or just "Name"
      const asMatch = part.match(/([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)/i);
      if (asMatch) {
        names.add(asMatch[2]!);
      } else {
        const plain = part.match(/^([A-Za-z0-9_]+)/);
        if (plain) names.add(plain[1]!);
      }
    }
  }

  return Array.from(names);
}
