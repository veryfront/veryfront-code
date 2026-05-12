import { walk } from "@std/fs";

export interface IllegalImport {
  path: string;
  line: number;
}

export function findIllegalZodImports(
  files: Array<{ path: string; content: string }>,
): IllegalImport[] {
  const result: IllegalImport[] = [];
  for (const f of files) {
    if (f.path.startsWith("extensions/ext-zod/")) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\b.*from\s+["']zod["']/.test(lines[i])) {
        result.push({ path: f.path, line: i + 1 });
      }
    }
  }
  return result;
}

if (import.meta.main) {
  const files: Array<{ path: string; content: string }> = [];
  for await (const entry of walk(".", {
    exts: [".ts", ".tsx"],
    skip: [/\bnode_modules\b/, /\bdist\b/, /\bcoverage\b/, /\bnpm\/esm\b/, /\b\.worktrees\b/],
  })) {
    if (!entry.isFile) continue;
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
