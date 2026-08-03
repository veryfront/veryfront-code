#!/usr/bin/env -S deno run --allow-read
/**
 * Prevents new dependency cycles and broad-barrel imports in dependency-sensitive code.
 *
 * Foundation and browser modules must use focused `#veryfront/*` leaf imports for
 * errors, observability, and utilities. These public barrels aggregate large
 * dependency subgraphs and can create cycles or pull server-only code into browser
 * bundles. Existing violations and cyclic edges are recorded in a shrink-only
 * baseline so this check can run as a hard CI gate.
 */

import { dirname, extname, join, normalize } from "#std/path/posix";
import { getLine, parseSource, walkAst } from "./style-conventions/ast.ts";
import type { AstNodeLike } from "./style-conventions/types.ts";

const SCAN_ROOTS = ["src", "react"] as const;
const BASELINE_PATH = "scripts/lint/module-boundaries-baseline.json";

const CYCLE_SENSITIVE_PREFIXES = [
  "src/config/",
  "src/errors/",
  "src/fs/",
  "src/observability/",
  "src/platform/",
  "src/schemas/",
  "src/types/",
  "src/utils/",
] as const;

const BROWSER_PREFIXES = [
  "react/",
  "src/agent/react/",
  "src/react/components/",
  "src/react/context/",
  "src/react/fonts/",
  "src/react/primitives/",
  "src/react/router/",
  "src/react/runtime/",
  "src/rendering/client/",
  "src/routing/client/",
  "src/workflow/react/",
] as const;

const BROWSER_FILES = new Set(["src/react/index.ts"]);

const BROAD_BARRELS = new Set([
  "#veryfront/errors",
  "#veryfront/observability",
  "#veryfront/utils",
  "veryfront/errors",
  "veryfront/observability",
  "veryfront/utils",
]);

export type ImportKind = "runtime" | "type" | "dynamic";

export interface ImportReference {
  specifier: string;
  kind: ImportKind;
  line: number;
}

export interface BroadBarrelViolation {
  file: string;
  specifier: string;
  zone: "cycle-sensitive" | "browser";
  line: number;
  fingerprint: string;
}

interface ModuleBoundaryBaseline {
  broadBarrelImports: string[];
  cycleEdges: string[];
}

export interface ModuleAnalysis {
  broadBarrelImports: BroadBarrelViolation[];
  cycleEdges: string[];
  parseFailures: string[];
}

type ImportMap = Record<string, string>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  const record = asRecord(value);
  return record?.type === "StringLiteral" && typeof record.value === "string"
    ? record.value
    : null;
}

function allSpecifiersAreTypeOnly(node: Record<string, unknown>): boolean {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  if (!Array.isArray(node.specifiers) || node.specifiers.length === 0) {
    return false;
  }
  return node.specifiers.every((specifier) => {
    const record = asRecord(specifier);
    return record?.importKind === "type" || record?.exportKind === "type";
  });
}

/** Extract local dependency references from TypeScript using the repository parser. */
export function extractImports(
  file: string,
  source: string,
): ImportReference[] {
  const references: ImportReference[] = [];
  const ast = parseSource(file, source);

  walkAst(ast, (node: AstNodeLike) => {
    const record = node as Record<string, unknown>;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const specifier = stringValue(record.source);
      if (specifier) {
        references.push({
          specifier,
          kind: allSpecifiersAreTypeOnly(record) ? "type" : "runtime",
          line: getLine(node),
        });
      }
      return;
    }

    if (node.type === "CallExpression") {
      const callee = asRecord(record.callee);
      const argument = Array.isArray(record.arguments)
        ? record.arguments[0]
        : null;
      const specifier = callee?.type === "Import"
        ? stringValue(argument)
        : null;
      if (specifier) {
        references.push({ specifier, kind: "dynamic", line: getLine(node) });
      }
      return;
    }

    if (node.type === "ImportExpression") {
      const specifier = stringValue(record.source);
      if (specifier) {
        references.push({ specifier, kind: "dynamic", line: getLine(node) });
      }
    }
  });

  return references;
}

function classifyZone(
  file: string,
): BroadBarrelViolation["zone"] | null {
  if (CYCLE_SENSITIVE_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return "cycle-sensitive";
  }
  if (
    BROWSER_FILES.has(file) ||
    BROWSER_PREFIXES.some((prefix) => file.startsWith(prefix))
  ) {
    return "browser";
  }
  return null;
}

/**
 * Find broad public barrels used from modules that require focused leaf imports.
 * Type-only imports are included because they still couple source layers to a
 * public API surface, even though TypeScript erases them at runtime.
 */
export function findBroadBarrelViolations(
  file: string,
  imports: readonly ImportReference[],
): BroadBarrelViolation[] {
  const zone = classifyZone(file);
  if (!zone) return [];

  return imports
    .filter(({ specifier }) => BROAD_BARRELS.has(specifier))
    .map(({ specifier, line }) => ({
      file,
      specifier,
      zone,
      line,
      fingerprint: `${zone}:${file} -> ${specifier}`,
    }));
}

function withoutQueryOrFragment(specifier: string): string {
  const query = specifier.indexOf("?");
  const fragment = specifier.indexOf("#", 1);
  const boundary = [query, fragment]
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0] ?? -1;
  return boundary === -1 ? specifier : specifier.slice(0, boundary);
}

function resolveImportMapTarget(
  specifier: string,
  imports: ImportMap,
): string | null {
  if (Object.hasOwn(imports, specifier)) return imports[specifier];

  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && specifier.startsWith(key))
    .sort((left, right) => right.length - left.length)[0];
  if (!prefix) return null;

  return `${imports[prefix]}${specifier.slice(prefix.length)}`;
}

function localCandidate(
  fromFile: string,
  specifier: string,
  imports: ImportMap,
): string | null {
  const cleanSpecifier = withoutQueryOrFragment(specifier);
  if (cleanSpecifier.startsWith(".")) {
    return normalize(join(dirname(fromFile), cleanSpecifier));
  }

  const mapped = resolveImportMapTarget(cleanSpecifier, imports);
  if (!mapped || !mapped.startsWith(".")) return null;
  return normalize(mapped.replace(/^\.\//, ""));
}

/** Resolve a source import to a repository-relative TypeScript file. */
export function resolveLocalImport(
  fromFile: string,
  specifier: string,
  imports: ImportMap,
  files: ReadonlySet<string>,
): string | null {
  const candidate = localCandidate(fromFile, specifier, imports);
  if (!candidate) return null;

  const extension = extname(candidate);
  const candidates = extension
    ? [
      candidate,
      ...(extension === ".js"
        ? [`${candidate.slice(0, -3)}.ts`, `${candidate.slice(0, -3)}.tsx`]
        : []),
    ]
    : [
      candidate,
      `${candidate}.ts`,
      `${candidate}.tsx`,
      `${candidate}/index.ts`,
      `${candidate}/index.tsx`,
    ];

  return candidates.find((path) => files.has(path)) ?? null;
}

/** Return each directed edge contained in a strongly connected component. */
export function findCyclicEdges(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclicEdges = new Set<string>();

  function strongConnect(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex++;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indexes.has(target)) {
        strongConnect(target);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(target)!));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;

    const component = new Set<string>();
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.add(member);
    } while (member !== node);

    const isCycle = component.size > 1 ||
      [...component].some((item) => graph.get(item)?.has(item));
    if (!isCycle) return;

    for (const from of component) {
      for (const to of graph.get(from) ?? []) {
        if (component.has(to)) cyclicEdges.add(`${from} -> ${to}`);
      }
    }
  }

  const nodes = new Set(graph.keys());
  for (const targets of graph.values()) {
    for (const target of targets) nodes.add(target);
  }
  for (const node of [...nodes].sort()) {
    if (!indexes.has(node)) strongConnect(node);
  }

  return [...cyclicEdges].sort();
}

/** Return fingerprints present now but absent from the accepted baseline. */
export function findRegressions(
  current: readonly string[],
  baseline: readonly string[],
): string[] {
  const accepted = new Set(baseline);
  return [...new Set(current)].filter((item) => !accepted.has(item)).sort();
}

function shouldSkip(path: string): boolean {
  return path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".bench.ts") ||
    path.endsWith(".bench.tsx") ||
    path.endsWith(".generated.ts") ||
    path.endsWith(".generated.tsx") ||
    path.includes("/__tests__/") ||
    path.includes("/_generated/") ||
    path.includes("/generated/");
}

async function walkSourceFiles(dir: string, files: string[]): Promise<void> {
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  for await (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name !== "node_modules") await walkSourceFiles(path, files);
    } else if (
      entry.isFile &&
      (path.endsWith(".ts") || path.endsWith(".tsx")) &&
      !shouldSkip(path)
    ) {
      files.push(path);
    }
  }
}

async function readImportMap(): Promise<ImportMap> {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    imports?: Record<string, unknown>;
  };
  return Object.fromEntries(
    Object.entries(config.imports ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export async function analyzeModules(): Promise<ModuleAnalysis> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) await walkSourceFiles(root, files);
  files.sort();

  const fileSet = new Set(files);
  const imports = await readImportMap();
  const graph = new Map<string, ReadonlySet<string>>();
  const broadBarrelImports: BroadBarrelViolation[] = [];
  const parseFailures: string[] = [];

  for (const file of files) {
    let references: ImportReference[];
    try {
      references = extractImports(file, await Deno.readTextFile(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseFailures.push(`${file}: ${message}`);
      graph.set(file, new Set());
      continue;
    }

    broadBarrelImports.push(...findBroadBarrelViolations(file, references));
    const dependencies = new Set<string>();
    for (const reference of references) {
      // Only eager runtime imports create module-initialization cycles. Type-only
      // imports are erased and dynamic imports intentionally defer evaluation.
      if (reference.kind !== "runtime") continue;
      const dependency = resolveLocalImport(
        file,
        reference.specifier,
        imports,
        fileSet,
      );
      if (dependency) dependencies.add(dependency);
    }
    graph.set(file, dependencies);
  }

  return {
    broadBarrelImports,
    cycleEdges: findCyclicEdges(graph),
    parseFailures: parseFailures.sort(),
  };
}

function parseBaseline(value: unknown): ModuleBoundaryBaseline {
  const record = asRecord(value);
  if (
    !record ||
    !Array.isArray(record.broadBarrelImports) ||
    !record.broadBarrelImports.every((item) => typeof item === "string") ||
    !Array.isArray(record.cycleEdges) ||
    !record.cycleEdges.every((item) => typeof item === "string")
  ) {
    throw new Error(`Invalid module boundary baseline: ${BASELINE_PATH}`);
  }
  return {
    broadBarrelImports: [...record.broadBarrelImports].sort(),
    cycleEdges: [...record.cycleEdges].sort(),
  };
}

function baselineFor(analysis: ModuleAnalysis): ModuleBoundaryBaseline {
  return {
    broadBarrelImports: [
      ...new Set(analysis.broadBarrelImports.map((item) => item.fingerprint)),
    ].sort(),
    cycleEdges: analysis.cycleEdges,
  };
}

function printFindings(title: string, findings: readonly string[]): void {
  if (findings.length === 0) return;
  console.error(`\n${title}`);
  for (const finding of findings) console.error(`  ${finding}`);
}

async function main(): Promise<void> {
  const analysis = await analyzeModules();
  if (Deno.args.includes("--print-baseline")) {
    console.log(JSON.stringify(baselineFor(analysis), null, 2));
    return;
  }

  const baseline = parseBaseline(
    JSON.parse(await Deno.readTextFile(BASELINE_PATH)),
  );
  const current = baselineFor(analysis);
  const newBarrelImports = findRegressions(
    current.broadBarrelImports,
    baseline.broadBarrelImports,
  );
  const newCycleEdges = findRegressions(
    current.cycleEdges,
    baseline.cycleEdges,
  );

  printFindings(
    "Source files that could not be parsed:",
    analysis.parseFailures,
  );
  printFindings(
    "New broad-barrel imports in cycle-sensitive or browser modules:",
    newBarrelImports,
  );
  printFindings(
    "New dependency edges that participate in cycles:",
    newCycleEdges,
  );

  if (
    analysis.parseFailures.length > 0 ||
    newBarrelImports.length > 0 ||
    newCycleEdges.length > 0
  ) {
    console.error(
      "\nUse focused #veryfront/* leaf imports and remove the cyclic dependency. " +
        "Do not raise the baseline for new violations.",
    );
    Deno.exit(1);
  }

  const removedBarrelImports = findRegressions(
    baseline.broadBarrelImports,
    current.broadBarrelImports,
  );
  const removedCycleEdges = findRegressions(
    baseline.cycleEdges,
    current.cycleEdges,
  );
  if (removedBarrelImports.length > 0 || removedCycleEdges.length > 0) {
    console.log(
      `Module boundary debt decreased by ${removedBarrelImports.length} broad import(s) ` +
        `and ${removedCycleEdges.length} cyclic edge(s). Regenerate ${BASELINE_PATH} ` +
        "with --print-baseline to lock in the improvement.",
    );
    return;
  }

  console.log(
    `Module boundaries ok: ${current.broadBarrelImports.length} baselined broad import(s), ` +
      `${current.cycleEdges.length} baselined cyclic edge(s).`,
  );
}

if (import.meta.main) {
  await main();
}
