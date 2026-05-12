import { walk } from "@std/fs";

export interface IllegalImport {
  path: string;
  line: number;
}

export function shouldCheckZodImportPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("extensions/ext-zod/")) return false;
  if (normalized.startsWith("cli/templates/")) return false;
  return normalized.startsWith("src/") || normalized.startsWith("cli/");
}

export function findIllegalZodImports(
  files: Array<{ path: string; content: string }>,
): IllegalImport[] {
  const result: IllegalImport[] = [];
  for (const f of files) {
    if (!shouldCheckZodImportPath(f.path)) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\b.*from\s+["'](?:npm:)?zod(?:@[^"']*)?["']/.test(lines[i])) {
        result.push({ path: f.path, line: i + 1 });
      }
    }
  }
  return result;
}

if (import.meta.main) {
  const files: Array<{ path: string; content: string }> = [];
  for await (
    const entry of walk(".", {
      exts: [".ts", ".tsx"],
      skip: [
        /\bnode_modules\b/,
        /\bdist\b/,
        /\bcoverage\b/,
        /^\.\.?(?:\/|$)/,
        /^\.\/\.git(?:\/|$)/,
        /^\.\/\.omx(?:\/|$)/,
        /^\.\/\.worktrees(?:\/|$)/,
        /^\.\/npm(?:\/|$)/,
        /^\.\/projects(?:\/|$)/,
        /^\.\/data(?:\/|$)/,
        /^\.\/cli\/templates(?:\/|$)/,
        /^\.\/extensions\/(?!ext-zod(?:\/|$))/,
      ],
    })
  ) {
    if (!entry.isFile) continue;
    if (!shouldCheckZodImportPath(entry.path)) continue;
    files.push({ path: entry.path, content: await Deno.readTextFile(entry.path) });
  }
  const offenders = findIllegalZodImports(files);
  if (offenders.length === 0) {
    console.log("No illegal zod imports.");
    Deno.exit(0);
  }
  console.log(`${offenders.length} illegal zod imports:`);
  for (const o of offenders) console.log(`  ${o.path}:${o.line}`);
  Deno.exit(1);
}
