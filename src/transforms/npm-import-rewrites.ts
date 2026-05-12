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
import { join } from "#veryfront/compat/path/index.ts";

/**
 * Bare specifiers that should be rewritten to their pinned npm: versions.
 * Each must have a corresponding entry in deno.json's import map.
 */
const REWRITABLE_PACKAGES = [] as const;

interface RewriteRule {
  pattern: RegExp;
  replacement: string;
}

let cachedRules: RewriteRule[] | undefined;

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

    // Static imports
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

function loadImportMapSync(): Record<string, string> {
  try {
    const denoJsonPath = join(cwd(), "deno.json");
    const content = Deno.readTextFileSync(denoJsonPath);
    const config = JSON.parse(content);
    return config.imports ?? {};
  } catch {
    // deno.json may not exist (e.g. compiled binary running in user project dir)
    return {};
  }
}

/**
 * Returns rewrite rules derived from deno.json's import map.
 * Rules are cached after first call.
 */
export function getNpmRewriteRules(): RewriteRule[] {
  if (cachedRules) return cachedRules;
  const importMap = loadImportMapSync();
  cachedRules = buildRules(importMap);
  return cachedRules;
}

const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";

/**
 * Apply npm import rewrites to source code.
 * Rewrites bare specifiers to pinned npm: versions from deno.json.
 * No-op on Node.js where bare specifiers resolve via node_modules.
 */
export function rewriteNpmImports(source: string): string {
  if (!isDeno) return source;
  let result = source;
  for (const { pattern, replacement } of getNpmRewriteRules()) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Exported for testing */
export { buildRules, REWRITABLE_PACKAGES };

/** @internal Reset cached rules — only for testing */
export function _resetCache(): void {
  cachedRules = undefined;
}
