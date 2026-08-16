#!/usr/bin/env -S deno run --allow-read
/**
 * Ratchet on low-evidence type patterns — the assertions and broad types
 * that make code look typed while the compiler has been told to stop
 * checking. `deno lint` has no baseline mechanism, so these checks live here
 * instead of as lint rules, enforced through the per-file ratchet this
 * directory already uses for cwd-relative test reads.
 *
 * Candidate patterns that were measured against `src/` and deliberately NOT
 * enforced:
 *
 *  - ad hoc `typeof` narrowing, `unknown` parameters, and mandatory safety
 *    comments on assertions: thousands of hits each. Cross-runtime code
 *    (`typeof Deno`, `typeof process`) and untyped I/O boundaries are how
 *    this codebase works, not slop.
 *  - `Reflect.apply` / `Reflect.get`: `Reflect.*` here is deliberate typed
 *    dispatch in sandbox/proxy code (e.g. `src/proxy/cache/validation.ts`).
 *  - `*Shape` symbol names: an established naming convention in this repo
 *    (`SleepToolInputShape`, `ContractSchemaShape`).
 *
 * ## The enforced rules
 *
 *  - `no-chained-type-assertions` — `x as unknown as Y` (and any nested
 *    assertion chain that is not all-`const`) fabricates type evidence: the
 *    compiler is told to forget what it knew and then told something new
 *    with no proof. Parse or narrow at the boundary instead.
 *  - `no-unknown-type-aliases` — `type Foo = unknown` (directly or through
 *    alias chains) hides the fact that a value is unparsed. `unknown` must
 *    stay visible where it exists.
 *  - `no-object-parameters` — a parameter typed `object` (including union
 *    members) accepts nearly anything while promising nothing; take a named
 *    domain type instead. Local aliases to `object` are not resolved —
 *    direct annotations only, which keeps the check free of scope analysis.
 *
 * Test files (`*.test.ts(x)`) are not scanned: `as unknown as` is the
 * idiomatic way to build partial doubles in tests, and banning it there
 * fights ~1300 existing sites for little signal.
 *
 * Counts are frozen per rule per file in `anti-slop-baseline.json` and may
 * only shrink. Regenerate after paying debt down with:
 *
 *   deno task lint:anti-slop -- --print-baseline > scripts/lint/anti-slop-baseline.json
 */

import { parse } from "npm:@babel/parser@7.29.2";
import { fromFileUrl } from "#std/path";

export type AntiSlopRule =
  | "no-chained-type-assertions"
  | "no-unknown-type-aliases"
  | "no-object-parameters";

export interface AntiSlopFinding {
  rule: AntiSlopRule;
  file: string;
  line: number;
  /** What was flagged: the alias name, the parameter name, or a chain label. */
  detail: string;
}

interface Node {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

/**
 * Attached comments carry a `type` too, so the walk would descend into them.
 * Nothing in a comment can violate these rules, and skipping them makes that
 * structural rather than incidental.
 */
const COMMENT_KEYS = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
]);

const ASSERTION_TYPES = new Set(["TSAsExpression", "TSTypeAssertion"]);

/** `x as const` — the one assertion form that adds evidence instead of discarding it. */
function isConstAssertion(node: Node): boolean {
  const annotation = node.typeAnnotation;
  if (!isNode(annotation) || annotation.type !== "TSTypeReference") {
    return false;
  }
  const name = annotation.typeName;
  return isNode(name) && name.type === "Identifier" && name.name === "const";
}

/**
 * Walk `.expression` through a nested assertion chain. Babel keeps
 * parentheses transparent, so `(x as A) as B` nests directly.
 */
function assertionChain(node: Node): { length: number; hasNonConst: boolean } {
  let length = 0;
  let hasNonConst = false;
  let current: unknown = node;
  while (isNode(current) && ASSERTION_TYPES.has(current.type)) {
    length += 1;
    if (!isConstAssertion(current)) hasNonConst = true;
    current = current.expression;
  }
  return { length, hasNonConst };
}

/** Node types that own a function parameter list, under either babel key. */
const PARAMETER_OWNERS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "TSDeclareFunction",
  "TSDeclareMethod",
  "TSFunctionType",
  "TSConstructorType",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
]);

/** Plain functions store `params`; TS signature nodes store `parameters`. */
function parametersOf(node: Node): Node[] {
  const raw = node.params ?? node.parameters;
  return Array.isArray(raw) ? raw.filter(isNode) : [];
}

function parameterAnnotation(parameter: Node): Node | undefined {
  if (parameter.type === "TSParameterProperty") {
    return isNode(parameter.parameter)
      ? parameterAnnotation(parameter.parameter)
      : undefined;
  }
  if (parameter.type === "AssignmentPattern") {
    const own = parameter.typeAnnotation;
    if (isNode(own)) return own;
    return isNode(parameter.left)
      ? parameterAnnotation(parameter.left)
      : undefined;
  }
  const annotation = parameter.typeAnnotation;
  if (isNode(annotation)) return annotation;
  if (parameter.type === "RestElement" && isNode(parameter.argument)) {
    return parameterAnnotation(parameter.argument);
  }
  return undefined;
}

function parameterName(parameter: Node): string {
  if (parameter.type === "Identifier") return parameter.name as string;
  if (parameter.type === "RestElement" && isNode(parameter.argument)) {
    return `...${parameterName(parameter.argument)}`;
  }
  if (parameter.type === "AssignmentPattern" && isNode(parameter.left)) {
    return parameterName(parameter.left);
  }
  if (parameter.type === "TSParameterProperty" && isNode(parameter.parameter)) {
    return parameterName(parameter.parameter);
  }
  return `<${parameter.type}>`;
}

/** The broad `object` keyword, directly or as a union member. */
function isBroadObjectType(type: Node): boolean {
  if (type.type === "TSObjectKeyword") return true;
  if (type.type === "TSUnionType" && Array.isArray(type.types)) {
    return type.types.some((member) => isNode(member) && isBroadObjectType(member));
  }
  return false;
}

/** Top-level type aliases by name, including `export type` forms. */
function collectTopLevelAliases(program: Node): Map<string, Node> {
  const aliases = new Map<string, Node>();
  const body = Array.isArray(program.body) ? program.body : [];
  for (const statement of body) {
    if (!isNode(statement)) continue;
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    if (isNode(declaration) && declaration.type === "TSTypeAliasDeclaration") {
      const id = declaration.id;
      if (isNode(id) && typeof id.name === "string") {
        aliases.set(id.name, declaration);
      }
    }
  }
  return aliases;
}

function resolvesToUnknown(
  type: Node,
  aliases: Map<string, Node>,
  visited: Set<string>,
): boolean {
  if (type.type === "TSUnknownKeyword") return true;
  if (type.type !== "TSTypeReference") return false;
  const name = type.typeName;
  if (!isNode(name) || name.type !== "Identifier") return false;
  // A reference with type arguments is not a bare alias to `unknown`.
  const args = type.typeParameters ?? type.typeArguments;
  if (isNode(args) && Array.isArray(args.params) && args.params.length > 0) {
    return false;
  }
  const aliasName = name.name as string;
  if (visited.has(aliasName)) return false;
  const alias = aliases.get(aliasName);
  // Generic aliases would need instantiation to resolve; leave them alone.
  if (alias === undefined || isNode(alias.typeParameters)) return false;
  const annotation = alias.typeAnnotation;
  if (!isNode(annotation)) return false;
  return resolvesToUnknown(
    annotation,
    aliases,
    new Set(visited).add(aliasName),
  );
}

/** Raised when a scanned file cannot be parsed, so the audit fails closed. */
export class ParseFailure extends Error {}

/**
 * Report every anti-slop violation in `source`.
 *
 * `.ts` sources are parsed without the JSX plugin so angle-bracket type
 * assertions (`<T>value`) parse as assertions rather than as JSX.
 */
export function findAntiSlop(source: string, file: string): AntiSlopFinding[] {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: file.endsWith(".tsx")
        ? ["typescript", "jsx", "decorators-legacy", "importAttributes"]
        : ["typescript", "decorators-legacy", "importAttributes"],
    });
  } catch (error) {
    throw new ParseFailure(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const program = ast.program as unknown as Node;
  const findings: AntiSlopFinding[] = [];

  const aliases = collectTopLevelAliases(program);
  for (const [name, alias] of aliases) {
    const annotation = alias.typeAnnotation;
    if (!isNode(annotation)) continue;
    if (!resolvesToUnknown(annotation, aliases, new Set([name]))) continue;
    findings.push({
      rule: "no-unknown-type-aliases",
      file,
      line: alias.loc?.start.line ?? 0,
      detail: name,
    });
  }

  /**
   * `underAssertion` marks a node reached through an assertion's
   * `.expression`, so only the outermost link of a chain reports.
   */
  const visit = (node: Node, underAssertion: boolean): void => {
    if (ASSERTION_TYPES.has(node.type) && !underAssertion) {
      const { length, hasNonConst } = assertionChain(node);
      if (length > 1 && hasNonConst) {
        findings.push({
          rule: "no-chained-type-assertions",
          file,
          line: node.loc?.start.line ?? 0,
          detail: `${length} chained assertions`,
        });
      }
    }

    if (PARAMETER_OWNERS.has(node.type)) {
      for (const parameter of parametersOf(node)) {
        const annotation = parameterAnnotation(parameter);
        const type = annotation === undefined
          ? undefined
          : annotation.typeAnnotation;
        if (!isNode(type) || !isBroadObjectType(type)) continue;
        findings.push({
          rule: "no-object-parameters",
          file,
          line: (isNode(annotation) ? annotation.loc?.start.line : undefined) ??
            0,
          detail: parameterName(parameter),
        });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || COMMENT_KEYS.has(key)) continue;
      const value = node[key];
      const intoExpression = ASSERTION_TYPES.has(node.type) &&
        key === "expression";
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, false);
      } else if (isNode(value)) {
        visit(value, intoExpression);
      }
    }
  };

  visit(program, false);
  return findings.sort((a, b) => a.line - b.line);
}

/** Per-rule, per-file counts — the shape stored in the baseline. */
export type AntiSlopBaseline = Record<string, Record<string, number>>;

export function countsByRuleAndFile(
  findings: readonly AntiSlopFinding[],
): AntiSlopBaseline {
  const counts: Record<string, Record<string, number>> = {};
  for (const finding of findings) {
    const perFile = counts[finding.rule] ?? (counts[finding.rule] = {});
    perFile[finding.file] = (perFile[finding.file] ?? 0) + 1;
  }
  const sorted: AntiSlopBaseline = {};
  for (const rule of Object.keys(counts).sort()) {
    sorted[rule] = Object.fromEntries(
      Object.entries(counts[rule]).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return sorted;
}

export interface BaselineComparison {
  /** `rule file: then -> now` where a count grew. The ratchet slipping. */
  regressions: string[];
  /** Where a count shrank. The ratchet earning a new floor. */
  improvements: string[];
}

/**
 * Compare current counts with the frozen baseline, per rule per file: a file
 * already carrying two chained assertions must not quietly grow a third.
 */
export function compareBaseline(
  current: AntiSlopBaseline,
  baseline: AntiSlopBaseline,
): BaselineComparison {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const rules = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const rule of rules) {
    const now = current[rule] ?? {};
    const then = baseline[rule] ?? {};
    for (const file of new Set([...Object.keys(now), ...Object.keys(then)])) {
      const a = now[file] ?? 0;
      const b = then[file] ?? 0;
      if (a > b) regressions.push(`${rule} ${file}: ${b} -> ${a}`);
      else if (a < b) improvements.push(`${rule} ${file}: ${b} -> ${a}`);
    }
  }
  return { regressions: regressions.sort(), improvements: improvements.sort() };
}

export function parseBaseline(value: unknown, path: string): AntiSlopBaseline {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid anti-slop baseline: ${path}`);
  }
  for (const [rule, files] of Object.entries(value)) {
    if (typeof files !== "object" || files === null || Array.isArray(files)) {
      throw new Error(`Invalid anti-slop baseline entry for ${rule}: ${path}`);
    }
    for (const [file, count] of Object.entries(files)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(
          `Invalid anti-slop baseline count for ${rule} ${file}: ${count}`,
        );
      }
    }
  }
  return value as AntiSlopBaseline;
}

/**
 * Baseline key for a scanned file: repo-relative, always posix separators,
 * so a Windows checkout produces the same keys a Linux one does.
 */
export function toRepoRelative(file: string, repoRoot: string): string {
  return file.slice(repoRoot.length).replaceAll("\\", "/");
}

const BASELINE_PATH = "scripts/lint/anti-slop-baseline.json";
/** Mirrors the production surface of `lint.include` in deno.json. */
const SCAN_ROOTS = ["src", "cli", "templates", "extensions", "react"] as const;
/** Mirrors `lint.exclude` in deno.json. */
const EXCLUDED_PREFIXES = ["src/studio/bridge/"] as const;

function isProdSource(name: string): boolean {
  if (!name.endsWith(".ts") && !name.endsWith(".tsx")) return false;
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  return !name.endsWith(".d.ts");
}

async function collectProdFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(root);
  } catch {
    return files; // expected: a scan root may not exist in every checkout
  }
  for await (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      // Mirrors lint.exclude: emitted output inside a scan root is not source.
      if (entry.name === "dist" || entry.name === "coverage") continue;
      files.push(...await collectProdFiles(path));
    } else if (entry.isFile && isProdSource(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function printFindings(title: string, findings: readonly string[]): void {
  if (findings.length === 0) return;
  console.error(`\n${title}`);
  for (const finding of findings) console.error(`  ${finding}`);
}

async function main(): Promise<void> {
  // `fromFileUrl`, not `URL.pathname`: pathname keeps the URL's leading slash
  // and percent encoding, so a Windows checkout would scan `/C:/...`.
  const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
  const findings: AntiSlopFinding[] = [];
  const parseFailures: string[] = [];

  for (const root of SCAN_ROOTS) {
    for (const file of await collectProdFiles(`${repoRoot}${root}`)) {
      const relative = toRepoRelative(file, repoRoot);
      if (EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
        continue;
      }
      try {
        findings.push(...findAntiSlop(await Deno.readTextFile(file), relative));
      } catch (error) {
        parseFailures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  const current = countsByRuleAndFile(findings);
  if (Deno.args.includes("--print-baseline")) {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  const baseline = parseBaseline(
    JSON.parse(await Deno.readTextFile(`${repoRoot}${BASELINE_PATH}`)),
    BASELINE_PATH,
  );
  const { regressions, improvements } = compareBaseline(current, baseline);

  printFindings("Files that could not be parsed:", parseFailures);
  if (regressions.length > 0) {
    const regressedFiles = new Set(
      regressions.map((entry) => entry.split(" ")[1]?.replace(/:$/, "")),
    );
    printFindings(
      "Anti-slop counts above the baseline (new low-evidence type patterns):",
      regressions,
    );
    printFindings(
      "Current findings in the regressed files:",
      findings
        .filter((finding) => regressedFiles.has(finding.file))
        .map((finding) =>
          `${finding.file}:${finding.line}  ${finding.rule} (${finding.detail})`
        ),
    );
  }

  if (parseFailures.length > 0 || regressions.length > 0) {
    console.error(
      `\nKeep the precise type or parse at the boundary instead of asserting ` +
        `through it — see the header of scripts/lint/audit-anti-slop.ts. ` +
        `Do not raise ${BASELINE_PATH} for new violations.`,
    );
    Deno.exit(1);
  }

  if (improvements.length > 0) {
    printFindings("Anti-slop debt decreased:", improvements);
    console.log(
      `\nRegenerate ${BASELINE_PATH} with ` +
        `\`deno task lint:anti-slop -- --print-baseline > ${BASELINE_PATH}\` to lock in the improvement.`,
    );
    return;
  }

  const total = findings.length;
  const fileCount = new Set(findings.map((finding) => finding.file)).size;
  console.log(
    `Anti-slop baseline ok: ${total} baselined finding(s) across ${fileCount} file(s).`,
  );
}

if (import.meta.main) {
  await main();
}
