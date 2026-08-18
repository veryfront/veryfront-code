#!/usr/bin/env -S deno run --allow-read
/**
 * Bans render-mode defaults that fail open toward development.
 *
 * The runtime threads a render mode (`dev`, `mode`, `isLocalProject`) from the
 * request down through SSR component loading, the transform pipeline, the
 * module server, and the RSC renderer. Every one of those seams used to give
 * the flag a development-favouring default, so a call site that forgot to pass
 * it silently got development semantics on a hosted production render:
 * unminified and untree-shaken output, raw transform errors returned to a
 * browser, the whole rendered tree serialized into the RSC payload, and local
 * filesystem paths in a hydration manifest.
 *
 * The fix for the value is to default toward production. The fix for the bug
 * class is this check: a default may not resolve to development, so a future
 * seam that forgets to thread the flag degrades safely instead of quietly
 * downgrading production.
 *
 * Prefer making the flag a required field over defaulting it at all. Where the
 * call-site count allows that, `deno task typecheck` rejects the omission
 * outright and no default exists for this check to inspect.
 *
 * Scans non-test `.ts` / `.tsx` files under `src`. Test files, `__tests__`
 * directories, `*test-helpers*` modules and the `src/testing` harness are
 * skipped: a fixture may legitimately default itself to development.
 */

const SCAN_ROOT = "src";

interface Rule {
  name: string;
  pattern: RegExp;
  guidance: string;
}

const RULES: Rule[] = [
  {
    name: "dev-fallback",
    pattern: /\b(?:dev|isLocal|isLocalProject)\b[^;\n]*\?\?\s*true\b/,
    guidance: "default this flag to false and let callers opt into development",
  },
  {
    name: "dev-default",
    pattern: /\b(?:dev|isLocal|isLocalProject)\s*=\s*true\b/,
    guidance: "default this flag to false and let callers opt into development",
  },
  {
    name: "mode-fallback",
    pattern: /\bmode\b[^;\n]*\?\?\s*"development"/,
    guidance: 'default this mode to "production"',
  },
  {
    name: "mode-default",
    pattern: /\bmode\s*(?::[^=\n]*)?=\s*"development"/,
    guidance: 'default this mode to "production"',
  },
];

/**
 * Strip comments so documentation examples cannot trigger a match. String
 * literals are kept, because two of the rules match on `"development"`.
 */
export function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export interface FailOpenDefault {
  line: number;
  rule: string;
  guidance: string;
  text: string;
}

/** Returns every fail-open render-mode default in `source`. */
export function findFailOpenDefaults(source: string): FailOpenDefault[] {
  const hits: FailOpenDefault[] = [];
  stripComments(source).split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      hits.push({
        line: index + 1,
        rule: rule.name,
        guidance: rule.guidance,
        text: line.trim(),
      });
      break;
    }
  });
  return hits;
}

/** Files whose render-mode defaults are checked. */
export function isScannedFile(path: string): boolean {
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
  if (path.includes("/__tests__/")) return false;
  if (path.includes("test-helpers")) return false;
  if (path.includes("_test-setup")) return false;
  if (path.startsWith("src/testing/") || path.includes("/testing/")) {
    return false;
  }
  return true;
}

async function walk(
  dir: string,
  onFile: (path: string) => Promise<void>,
): Promise<void> {
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch (_) {
    return; // expected: a scan root may not exist in every checkout
  }
  for await (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await walk(full, onFile);
    } else if (entry.isFile && isScannedFile(full)) {
      await onFile(full);
    }
  }
}

async function main(): Promise<void> {
  const violations: string[] = [];

  await walk(SCAN_ROOT, async (path) => {
    const source = await Deno.readTextFile(path);
    for (const hit of findFailOpenDefaults(source)) {
      violations.push(
        `${path}:${hit.line} [${hit.rule}] ${hit.text}\n    ${hit.guidance}`,
      );
    }
  });

  if (violations.length > 0) {
    console.error(
      `Found ${violations.length} render-mode default(s) that fail open toward ` +
        `development. A call site that omits the flag must degrade to production ` +
        `semantics, never the other way round:\n` +
        violations.join("\n"),
    );
    Deno.exit(1);
  }

  console.log("No render-mode defaults fail open toward development.");
}

if (import.meta.main) {
  await main();
}
