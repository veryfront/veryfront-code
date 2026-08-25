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

import { getLine, parseSource, walkAst } from "./style-conventions/ast.ts";
import type { AstNodeLike } from "./style-conventions/types.ts";

const SCAN_ROOT = "src";

type RuleName =
  | "dev-fallback"
  | "dev-default"
  | "mode-fallback"
  | "mode-default";

const DEV_NAMES = new Set(["dev", "isLocal", "isLocalProject"]);
const DEV_GUIDANCE =
  "default this flag to false and let callers opt into development";
const MODE_GUIDANCE = 'default this mode to "production"';

function asNode(value: unknown): AstNodeLike | undefined {
  return typeof value === "object" && value !== null &&
      typeof (value as AstNodeLike).type === "string"
    ? value as AstNodeLike
    : undefined;
}

function referenceName(value: unknown): string | undefined {
  const current = asNode(value);
  if (!current) return undefined;
  if (current.type === "Identifier") {
    return typeof current.name === "string" ? current.name : undefined;
  }
  if (
    current.type === "TSAsExpression" || current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    return referenceName(current.expression);
  }
  if (
    current.type !== "MemberExpression" &&
    current.type !== "OptionalMemberExpression"
  ) {
    return undefined;
  }
  const property = asNode(current.property);
  if (!property) return undefined;
  if (current.computed === true) {
    return property.type === "StringLiteral" &&
        typeof property.value === "string"
      ? property.value
      : undefined;
  }
  return property.type === "Identifier" && typeof property.name === "string"
    ? property.name
    : undefined;
}

function isTrue(value: unknown): boolean {
  const current = asNode(value);
  return current?.type === "BooleanLiteral" && current.value === true;
}

function isDevelopment(value: unknown): boolean {
  const current = asNode(value);
  return current?.type === "StringLiteral" && current.value === "development";
}

function defaultRule(
  name: string | undefined,
  value: unknown,
): RuleName | undefined {
  if (name && DEV_NAMES.has(name) && isTrue(value)) return "dev-default";
  if (name === "mode" && isDevelopment(value)) return "mode-default";
  return undefined;
}

function ruleFor(node: AstNodeLike): RuleName | undefined {
  if (node.type === "LogicalExpression" && node.operator === "??") {
    const name = referenceName(node.left);
    if (name && DEV_NAMES.has(name) && isTrue(node.right)) {
      return "dev-fallback";
    }
    if (name === "mode" && isDevelopment(node.right)) return "mode-fallback";
    return undefined;
  }

  if (node.type === "AssignmentPattern") {
    return defaultRule(referenceName(node.left), node.right);
  }

  if (node.type === "ObjectProperty") {
    const assignment = asNode(node.value);
    if (assignment?.type === "AssignmentPattern") {
      return defaultRule(referenceName(node.key), assignment.right);
    }
    return undefined;
  }

  if (node.type === "ClassProperty" || node.type === "PropertyDefinition") {
    return defaultRule(referenceName(node.key), node.value);
  }
  return undefined;
}

export interface FailOpenDefault {
  line: number;
  rule: string;
  guidance: string;
  text: string;
}

/** Returns every fail-open render-mode default in `source`. */
export function findFailOpenDefaults(
  source: string,
  file = "source.ts",
): FailOpenDefault[] {
  const hits: FailOpenDefault[] = [];
  const lines = source.split(/\r?\n/);
  const seen = new Set<string>();
  walkAst(parseSource(file, source), (current) => {
    const rule = ruleFor(current);
    if (!rule) return;
    const line = getLine(current);
    const identity = `${line}:${rule}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    hits.push({
      line,
      rule,
      guidance: rule.startsWith("dev-") ? DEV_GUIDANCE : MODE_GUIDANCE,
      text: lines[line - 1]?.trim() ?? "",
    });
  });
  hits.sort((left, right) => left.line - right.line);
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
    for (const hit of findFailOpenDefaults(source, path)) {
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
