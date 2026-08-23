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
 *   deno task lint:anti-slop:update
 */

import { parse } from "npm:@babel/parser@7.29.2";
import {
  type Finding,
  isSourceFile,
  ParseFailure,
  type RatchetSpec,
  runRatchet,
} from "./ratchet.ts";

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
    return type.types.some((member) =>
      isNode(member) && isBroadObjectType(member)
    );
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
    throw new ParseFailure(file, error);
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

/** Findings keyed by rule, the group the per-rule-per-file baseline uses. */
export function findAntiSlopFindings(source: string, file: string): Finding[] {
  return findAntiSlop(source, file).map((finding) => ({
    file,
    line: finding.line,
    message: `${finding.rule} (${finding.detail})`,
    group: finding.rule,
  }));
}

export const spec: RatchetSpec = {
  label: "Anti-slop findings",
  task: "lint:anti-slop",
  // The production surface `deno lint` checks: `lint.include` minus `lint.exclude`.
  scope: "lint",
  select: isSourceFile,
  scan: findAntiSlopFindings,
  baseline: {
    kind: "per-group-file",
    path: "scripts/lint/anti-slop-baseline.json",
  },
  advice:
    "Keep the precise type or parse at the boundary instead of asserting through " +
    "it — see the header of scripts/lint/audit-anti-slop.ts.",
};

if (import.meta.main) {
  Deno.exit(await runRatchet(spec));
}
