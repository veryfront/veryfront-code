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
    // The optional `: alias` arm catches `const { dev: renderDev = true } = x`,
    // which is a destructuring default wearing a different local name.
    pattern:
      /\b(?:dev|isLocal|isLocalProject)\b(?:\s*:\s*[$\w]+)?\s*=\s*true\b/,
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
 * Blank out comments so documentation examples cannot trigger a match, while
 * keeping string literals intact (two of the rules match on `"development"`).
 *
 * This is a character scanner rather than a regex because a regex cannot tell
 * a real `/*` from one inside a string. Getting that wrong is not cosmetic
 * here: a single `"/*"` in a source file would make everything up to the next
 * `*` + `/` look like a comment, and a fail-open default inside that span
 * would sail through the check unseen.
 *
 * Comments are replaced with spaces rather than deleted so that line and
 * column positions survive and reported line numbers stay correct.
 */
export function stripComments(text: string): string {
  const out: string[] = [];
  let index = 0;
  let quote: string | null = null;

  const keep = (char: string) => out.push(char);
  const blank = (char: string) =>
    out.push(char === "\n" || char === "\r" ? char : " ");

  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];

    if (quote) {
      keep(char);
      // A backslash escapes the next character, including a closing quote.
      if (char === "\\" && index + 1 < text.length) {
        keep(text[index + 1] as string);
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      keep(char);
      index += 1;
      continue;
    }

    // Outside a string, consume an escaped character as a unit so that an
    // escaped slash in a regex literal cannot open a comment.
    if (char === "\\" && index + 1 < text.length) {
      keep(char);
      keep(text[index + 1] as string);
      index += 2;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        blank(text[index] as string), index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      blank(char);
      blank(next as string);
      index += 2;
      while (
        index < text.length && !(text[index] === "*" && text[index + 1] === "/")
      ) {
        blank(text[index] as string);
        index += 1;
      }
      if (index < text.length) {
        blank("*");
        blank("/");
        index += 2;
      }
      continue;
    }

    keep(char);
    index += 1;
  }

  return out.join("");
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
  try {
    // `Deno.readDir` is lazy, so a failure surfaces here rather than at the
    // call. The iteration has to be inside the guard.
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name === "node_modules") continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(full, onFile);
      } else if (entry.isFile && isScannedFile(full)) {
        await onFile(full);
      }
    }
  } catch (error) {
    // A scan root can be absent in a partial checkout. Nothing else may be
    // swallowed: a check that cannot read the tree must fail loudly, not
    // report "no violations" for files it never opened.
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
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
