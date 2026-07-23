/**
 * NPM Import Rewrites for Deno
 *
 * Generates regex rewrite rules from deno.json's import map for the small set
 * of framework-managed bare specifiers that still need pinning in Deno.
 *
 * Single source of truth: versions come from deno.json — no hardcoded strings.
 *
 * @module transforms/npm-import-rewrites
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { join, resolve } from "#veryfront/compat/path/index.ts";

/**
 * Bare specifiers that should be rewritten to their pinned npm: versions.
 * Each must have a corresponding entry in deno.json's import map.
 */
const REWRITABLE_PACKAGES = [] as const;

interface RewriteRule {
  pattern: RegExp;
  replacement: string;
}

let cachedRules = new Map<string, RewriteRule[]>();

function escapeForRegex(pkg: string): string {
  return pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRules(importMap: Record<string, string>): RewriteRule[] {
  const rules: RewriteRule[] = [];

  for (const pkg of REWRITABLE_PACKAGES) {
    const mapped = importMap[pkg];
    if (!mapped) continue;

    // deno.json values look like "npm:zod@4.3.6" — use as-is
    const escaped = escapeForRegex(pkg);

    // Static imports.
    // CONSTRAINT: these patterns match the specifier string anywhere in the
    // source, including inside string literals and comments.  This is safe only
    // because REWRITABLE_PACKAGES is empty and must remain limited to bare
    // specifiers that cannot appear as non-import substrings.  If packages are
    // added here, use the AST-aware replaceSpecifiers from esm/lexer.ts instead.
    rules.push({
      pattern: new RegExp(`from\\s+["']${escaped}["']`, "g"),
      replacement: `from "${mapped}"`,
    });

    // Dynamic imports
    rules.push({
      pattern: new RegExp(`import\\s*\\(\\s*["']${escaped}["']\\s*\\)`, "g"),
      replacement: `import("${mapped}")`,
    });
  }

  return rules;
}

function loadImportMapSync(baseDir: string = cwd()): Record<string, string> {
  try {
    const denoJsonPath = join(baseDir, "deno.json");
    const content = Deno.readTextFileSync(denoJsonPath);
    const config = JSON.parse(content);
    return config.imports ?? {};
  } catch {
    // deno.json may not exist (e.g. compiled binary running in user project dir)
    return {};
  }
}

function resolveProjectDir(baseDir: string): string {
  const resolvedBaseDir = resolve(baseDir);
  let canonicalBaseDir = resolvedBaseDir;
  try {
    canonicalBaseDir = Deno.realPathSync(resolvedBaseDir);
  } catch {
    // expected: user projects may not exist yet in some compiled-binary paths
  }
  return canonicalBaseDir;
}

/**
 * Returns rewrite rules derived from deno.json's import map.
 * Rules are cached per resolved project directory.
 */
export function getNpmRewriteRules(baseDir: string = cwd()): RewriteRule[] {
  const projectDir = resolveProjectDir(baseDir);
  const cacheKey = projectDir;
  const cached = cachedRules.get(cacheKey);
  if (cached) return cached;
  const importMap = loadImportMapSync(projectDir);
  const rules = buildRules(importMap);
  cachedRules.set(cacheKey, rules);
  return rules;
}

const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";

/**
 * Apply npm import rewrites to source code.
 * Rewrites bare specifiers to pinned npm: versions from deno.json.
 * No-op on Node.js where bare specifiers resolve via node_modules.
 */
export function rewriteNpmImports(source: string, baseDir: string = cwd()): string {
  if (!isDeno) return source;
  let result = source;
  for (const { pattern, replacement } of getNpmRewriteRules(baseDir)) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Exported for testing */
export { buildRules, REWRITABLE_PACKAGES };

/** @internal Reset cached rules — only for testing */
export function _resetCache(): void {
  cachedRules = new Map<string, RewriteRule[]>();
}
