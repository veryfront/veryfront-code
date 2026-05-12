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

const ZOD_SPECIFIER_RE = String.raw`["'](?:npm:)?zod(?:@[^"']*)?["']`;
const STATIC_ZOD_FROM_RE = new RegExp(String.raw`\bfrom\s+${ZOD_SPECIFIER_RE}`);
const SIDE_EFFECT_ZOD_IMPORT_RE = new RegExp(String.raw`^\s*import\s+${ZOD_SPECIFIER_RE}\s*;?\s*$`);
const DYNAMIC_ZOD_IMPORT_RE = /(^|[^"'`])\bimport\s*\(\s*["'](?:npm:)?zod(?:@[^"']*)?["']\s*\)/;
const STATIC_IMPORT_START_RE = /^\s*import(?:\s|["'{*])/;

function readStaticImportStatement(lines: string[], startIndex: number): string {
  let statement = lines[startIndex];
  for (let i = startIndex + 1; i < lines.length; i++) {
    statement += `\n${lines[i]}`;
    if (lines[i].includes(";") || STATIC_ZOD_FROM_RE.test(statement)) break;
  }
  return statement;
}

function isIllegalStaticZodImport(statement: string): boolean {
  return SIDE_EFFECT_ZOD_IMPORT_RE.test(statement.trim()) || STATIC_ZOD_FROM_RE.test(statement);
}

export function findIllegalZodImports(
  files: Array<{ path: string; content: string }>,
): IllegalImport[] {
  const result: IllegalImport[] = [];
  for (const f of files) {
    if (!shouldCheckZodImportPath(f.path)) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const staticImport = STATIC_IMPORT_START_RE.test(lines[i])
        ? isIllegalStaticZodImport(readStaticImportStatement(lines, i))
        : false;
      if (staticImport || DYNAMIC_ZOD_IMPORT_RE.test(lines[i])) {
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
