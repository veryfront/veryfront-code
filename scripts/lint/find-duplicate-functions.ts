#!/usr/bin/env -S deno run --allow-read

/**
 * Duplicate function detector:
 * 1) Exact clones (identifier/literal-normalized token hash)
 * 2) Near clones (Jaccard similarity on normalized token shingles)
 *
 * Usage:
 *   deno task dupes
 *   deno task dupes -- --path src --path cli --threshold 0.88
 *   deno task dupes -- --ext ts --ext tsx
 *   deno task dupes -- --json
 */

import { parse } from "@babel/parser";
import { walk } from "jsr:@std/fs/walk";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { relative, resolve } from "jsr:@std/path";

type UnknownRecord = Record<string, unknown>;

interface SourceLocationPoint {
  line: number;
  column: number;
}

interface SourceLocationRange {
  start: SourceLocationPoint;
  end: SourceLocationPoint;
}

interface AstNode {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: SourceLocationRange | null;
  [key: string]: unknown;
}

interface AstFile {
  program: AstNode;
  tokens?: BabelToken[];
}

interface BabelTokenType {
  label: string;
}

interface BabelToken {
  type: BabelTokenType;
  value?: unknown;
  start: number;
  end: number;
}

interface ParentRef {
  node: AstNode;
  key: string;
  index?: number;
}

interface FunctionCandidate {
  id: number;
  filePath: string;
  relativePath: string;
  name: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  locLines: number;
  tokenCount: number;
  exactHash: string;
  normalizedTokens: string[];
  shingleHashes: number[];
}

interface NearEdge {
  a: number;
  b: number;
  similarity: number;
}

interface DuplicateGroup {
  id: string;
  kind: "exact" | "near";
  members: FunctionCandidate[];
  impact: number;
  similarity: number;
}

interface CliOptions {
  paths: string[];
  excludes: string[];
  extensions: Set<string>;
  includeTests: boolean;
  includeCallbacks: boolean;
  minTokens: number;
  minLines: number;
  threshold: number;
  shingleSize: number;
  maxGroups: number;
  maxShingleFrequency: number;
  failOnFindings: boolean;
  json: boolean;
}

interface ScanStats {
  scannedFiles: number;
  parsedFiles: number;
  parseErrors: number;
  skippedFunctions: number;
  analyzedFunctions: number;
}

const WALK_SKIP_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "errors",
  "tokens",
  "comments",
  "leadingComments",
  "innerComments",
  "trailingComments",
  "extra",
]);

const DEFAULT_TEXT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const DEFAULT_PATHS = ["src", "cli"];
const DEFAULT_EXCLUDES = [
  "node_modules/",
  ".git/",
  ".cache/",
  ".deno_cache/",
  "dist/",
  "coverage/",
  "npm/",
  "examples/",
  "cli/templates/",
  "scripts/rlm-ts/output/",
];

function printHelp(): void {
  console.log(`Duplicate function detector

Usage:
  deno task dupes [-- <options>]

Options:
  --path <dir>               Path to scan (repeatable, default: src + cli)
  --exclude <prefix>         Relative path prefix to skip (repeatable)
  --ext <extension>          File extension to scan (repeatable, default: .ts,.tsx,.js,.jsx,.mjs,.cjs)
  --include-tests            Include *.test.*, *.spec.*, __tests__, tests dirs
  --include-callbacks        Include inline callback/argument functions
  --min-tokens <n>           Minimum normalized token count (default: 30)
  --min-lines <n>            Minimum LOC for a function (default: 5)
  --threshold <0..1>         Near-duplicate similarity threshold (default: 0.85)
  --shingle-size <n>         Token shingle size for near matching (default: 3)
  --max-shingle-frequency <n> Skip very common shingles (default: 200)
  --max-groups <n>           Maximum groups shown (default: 30)
  --fail-on-findings         Exit non-zero when duplicates are found
  --json                     Print JSON instead of text
  --help                     Show this help
`);
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function parseExtensions(value: unknown): Set<string> {
  const provided = toArray(value)
    .map(normalizeExtension)
    .filter((extension) => extension.length > 1);

  if (provided.length === 0) {
    return new Set(DEFAULT_TEXT_EXTENSIONS);
  }

  return new Set(provided);
}

function parseCliOptions(): CliOptions {
  const rawArgs = [...Deno.args];
  const inputArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

  const args = parseArgs(inputArgs, {
    boolean: ["include-tests", "include-callbacks", "fail-on-findings", "json", "help"],
    string: [
      "path",
      "exclude",
      "ext",
      "min-tokens",
      "min-lines",
      "threshold",
      "shingle-size",
      "max-groups",
      "max-shingle-frequency",
    ],
    collect: ["path", "exclude", "ext"],
    default: {
      "include-tests": false,
      "include-callbacks": false,
      "fail-on-findings": false,
      "json": false,
      "min-tokens": "30",
      "min-lines": "5",
      "threshold": "0.85",
      "shingle-size": "3",
      "max-groups": "30",
      "max-shingle-frequency": "200",
    },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  const paths = toArray(args.path);
  const excludes = toArray(args.exclude);

  return {
    paths: paths.length > 0 ? paths : [...DEFAULT_PATHS],
    excludes,
    extensions: parseExtensions(args.ext),
    includeTests: Boolean(args["include-tests"]),
    includeCallbacks: Boolean(args["include-callbacks"]),
    minTokens: parsePositiveInt(args["min-tokens"], 30),
    minLines: parsePositiveInt(args["min-lines"], 5),
    threshold: parseThreshold(args.threshold, 0.85),
    shingleSize: parsePositiveInt(args["shingle-size"], 3),
    maxGroups: parsePositiveInt(args["max-groups"], 30),
    maxShingleFrequency: parsePositiveInt(args["max-shingle-frequency"], 200),
    failOnFindings: Boolean(args["fail-on-findings"]),
    json: Boolean(args.json),
  };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isTestPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".test.jsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.js") ||
    normalized.endsWith(".spec.jsx")
  );
}

function shouldSkipFile(relativePath: string, options: CliOptions): boolean {
  const normalized = normalizePath(relativePath);
  const fileName = normalized.split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";

  if (!options.extensions.has(extension)) {
    return true;
  }
  if (fileName.endsWith(".d.ts")) return true;
  if (!options.includeTests && isTestPath(normalized)) return true;

  const skipPrefixes = [...DEFAULT_EXCLUDES, ...options.excludes];
  return skipPrefixes.some((prefix) => normalized.startsWith(normalizePath(prefix)));
}

function isNode(value: unknown): value is AstNode {
  if (!value || typeof value !== "object") return false;
  return typeof (value as UnknownRecord).type === "string";
}

function traverseAst(
  node: AstNode,
  visit: (node: AstNode, parent: ParentRef | null) => void,
  parent: ParentRef | null = null,
): void {
  visit(node, parent);

  for (const [key, child] of Object.entries(node)) {
    if (WALK_SKIP_KEYS.has(key)) continue;
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index++) {
        const value = child[index];
        if (isNode(value)) {
          traverseAst(value, visit, { node, key, index });
        }
      }
      continue;
    }
    if (isNode(child)) {
      traverseAst(child, visit, { node, key });
    }
  }
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  );
}

function isIdentifierNode(node: unknown): node is AstNode {
  return isNode(node) && node.type === "Identifier";
}

function formatMemberExpressionName(node: AstNode): string {
  if (node.type === "Identifier") {
    return String((node as UnknownRecord).name ?? "<identifier>");
  }
  if (node.type === "ThisExpression") return "this";
  if (node.type === "Super") return "super";
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const object = (node as UnknownRecord).object;
    const property = (node as UnknownRecord).property;
    const computed = Boolean((node as UnknownRecord).computed);
    const objectName = isNode(object) ? formatMemberExpressionName(object) : "<expr>";
    if (!isNode(property)) return `${objectName}.[expr]`;
    const propertyName = property.type === "Identifier"
      ? String((property as UnknownRecord).name ?? "<prop>")
      : computed
      ? "[expr]"
      : formatMemberExpressionName(property);
    return computed ? `${objectName}[${propertyName}]` : `${objectName}.${propertyName}`;
  }
  return "<expr>";
}

function getPropertyKeyName(node: AstNode): string {
  const key = (node as UnknownRecord).key;
  if (!isNode(key)) return "<anonymous>";

  if (key.type === "Identifier") return String((key as UnknownRecord).name ?? "<anonymous>");
  if (key.type === "StringLiteral") return String((key as UnknownRecord).value ?? "<anonymous>");
  if (key.type === "NumericLiteral") return String((key as UnknownRecord).value ?? "<anonymous>");
  if (key.type === "PrivateName") {
    const id = (key as UnknownRecord).id;
    if (isNode(id) && id.type === "Identifier") {
      return `#${String((id as UnknownRecord).name ?? "private")}`;
    }
  }
  return "<computed>";
}

function getNodeName(node: AstNode, parent: ParentRef | null): string {
  if (node.type === "FunctionDeclaration") {
    const id = (node as UnknownRecord).id;
    if (isIdentifierNode(id)) return String((id as UnknownRecord).name ?? "<anonymous>");
    return "<anonymous>";
  }

  if (
    node.type === "ObjectMethod" || node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  ) {
    return getPropertyKeyName(node);
  }

  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    const id = (node as UnknownRecord).id;
    if (isIdentifierNode(id)) return String((id as UnknownRecord).name ?? "<anonymous>");

    if (!parent) return "<anonymous>";
    const p = parent.node;

    if (p.type === "VariableDeclarator") {
      const declaratorId = (p as UnknownRecord).id;
      if (isIdentifierNode(declaratorId)) {
        return String((declaratorId as UnknownRecord).name ?? "<anonymous>");
      }
      if (isNode(declaratorId)) return formatMemberExpressionName(declaratorId);
    }

    if (p.type === "AssignmentExpression") {
      const left = (p as UnknownRecord).left;
      if (isNode(left)) return formatMemberExpressionName(left);
    }

    if (p.type === "ObjectProperty") {
      return getPropertyKeyName(p);
    }

    if (p.type === "ClassProperty" || p.type === "ClassPrivateProperty") {
      return getPropertyKeyName(p);
    }

    if (p.type === "ExportDefaultDeclaration") return "default";
  }

  return "<anonymous>";
}

function isInlineCallback(node: AstNode, parent: ParentRef | null): boolean {
  if (!parent) return false;

  const p = parent.node;
  if (
    (p.type === "CallExpression" || p.type === "OptionalCallExpression" ||
      p.type === "NewExpression") &&
    parent.key === "arguments"
  ) {
    return true;
  }

  if (
    (p.type === "ArrayExpression" || p.type === "ObjectExpression") && parent.key === "elements"
  ) {
    return true;
  }

  const id = (node as UnknownRecord).id;
  return node.type === "FunctionExpression" && !id;
}

function binarySearchStart(tokens: BabelToken[], start: number): number {
  let low = 0;
  let high = tokens.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (tokens[mid].end < start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function tokensInRange(tokens: BabelToken[], start: number, end: number): BabelToken[] {
  const result: BabelToken[] = [];
  let index = binarySearchStart(tokens, start);

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.start > end) break;
    if (token.start >= start && token.end <= end && token.type.label !== "eof") {
      result.push(token);
    }
    index++;
  }

  return result;
}

function rawTokenSymbol(token: BabelToken): string {
  const label = token.type.label;
  if (typeof token.value === "string" && token.value.length > 0) {
    return token.value;
  }
  if (typeof token.value === "number") {
    return String(token.value);
  }
  return label;
}

function shouldPreserveIdentifier(index: number, tokens: BabelToken[]): boolean {
  const prev = tokens[index - 1];
  const next = tokens[index + 1];

  const prevRaw = prev ? rawTokenSymbol(prev) : "";
  const nextRaw = next ? rawTokenSymbol(next) : "";

  if (prevRaw === "." || prevRaw === "?.") return true;
  if ((prevRaw === "{" || prevRaw === ",") && nextRaw === ":") return true;
  return false;
}

function normalizeFunctionTokens(
  tokens: BabelToken[],
): { strictTokens: string[]; structuralTokens: string[] } {
  const strictTokens: string[] = [];
  const structuralTokens: string[] = [];
  const idMap = new Map<string, string>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const label = token.type.label;

    if (label === "eof") continue;
    if (label === "comment") continue;

    if (label === "name" || label === "jsxName") {
      const rawName = String(token.value ?? "");
      strictTokens.push(`id:${rawName}`);

      if (shouldPreserveIdentifier(index, tokens)) {
        structuralTokens.push(`id:${rawName}`);
        continue;
      }

      let mapped = idMap.get(rawName);
      if (!mapped) {
        mapped = `v${idMap.size + 1}`;
        idMap.set(rawName, mapped);
      }
      structuralTokens.push(`id:${mapped}`);
      continue;
    }

    if (label === "num" || label === "bigint" || label === "decimal") {
      strictTokens.push("lit:num");
      structuralTokens.push("lit:num");
      continue;
    }

    if (
      label === "string" ||
      label === "regexp" ||
      label === "template" ||
      label === "jsxText" ||
      label === "`"
    ) {
      strictTokens.push("lit:str");
      structuralTokens.push("lit:str");
      continue;
    }

    if (label === "true" || label === "false") {
      strictTokens.push("lit:bool");
      structuralTokens.push("lit:bool");
      continue;
    }

    if (label === "null") {
      strictTokens.push("lit:null");
      structuralTokens.push("lit:null");
      continue;
    }

    const symbol = rawTokenSymbol(token);
    strictTokens.push(`tok:${symbol}`);
    structuralTokens.push(`tok:${symbol}`);
  }

  return { strictTokens, structuralTokens };
}

function hashFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashFNV1aNumber(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function makeShingles(tokens: string[], size: number): number[] {
  if (tokens.length === 0) return [];
  if (tokens.length < size) {
    return [hashFNV1aNumber(tokens.join(" "))];
  }

  const set = new Set<number>();
  for (let i = 0; i <= tokens.length - size; i++) {
    const shingle = tokens.slice(i, i + size).join(" ");
    set.add(hashFNV1aNumber(shingle));
  }
  return [...set];
}

function findComponents(size: number, edges: NearEdge[]): number[][] {
  const parent = Array.from({ length: size }, (_, i) => i);
  const rank = new Array<number>(size).fill(0);

  function find(x: number): number {
    let current = x;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;

    if (rank[rootA] < rank[rootB]) {
      parent[rootA] = rootB;
      return;
    }
    if (rank[rootA] > rank[rootB]) {
      parent[rootB] = rootA;
      return;
    }
    parent[rootB] = rootA;
    rank[rootA]++;
  }

  for (const edge of edges) {
    union(edge.a, edge.b);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < size; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) {
      arr.push(i);
    } else {
      groups.set(root, [i]);
    }
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function isNestedPair(a: FunctionCandidate, b: FunctionCandidate): boolean {
  if (a.relativePath !== b.relativePath) return false;
  const aContainsB = a.startOffset <= b.startOffset && a.endOffset >= b.endOffset;
  const bContainsA = b.startOffset <= a.startOffset && b.endOffset >= a.endOffset;
  return aContainsB || bContainsA;
}

function scoreGroupImpact(members: FunctionCandidate[]): number {
  const total = members.reduce((sum, fn) => sum + fn.locLines, 0);
  const maxOne = members.reduce((max, fn) => Math.max(max, fn.locLines), 0);
  return Math.max(0, total - maxOne);
}

function formatFnRef(fn: FunctionCandidate): string {
  return `${fn.relativePath}:${fn.startLine}:${fn.startColumn + 1}`;
}

async function collectSourceFiles(options: CliOptions): Promise<string[]> {
  const cwd = Deno.cwd();
  const files: string[] = [];
  const seen = new Set<string>();

  for (const path of options.paths) {
    const absoluteRoot = resolve(cwd, path);
    try {
      const stat = await Deno.stat(absoluteRoot);
      if (!stat.isDirectory) continue;
    } catch {
      continue;
    }

    for await (
      const entry of walk(absoluteRoot, {
        includeDirs: false,
        includeFiles: true,
        includeSymlinks: false,
      })
    ) {
      if (!entry.isFile) continue;
      const rel = normalizePath(relative(cwd, entry.path));
      if (shouldSkipFile(rel, options)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      files.push(entry.path);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function safeParseFile(source: string): AstFile | null {
  try {
    return parse(source, {
      sourceType: "unambiguous",
      tokens: true,
      errorRecovery: true,
      plugins: [
        "typescript",
        "jsx",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "decorators-legacy",
        "dynamicImport",
        "importMeta",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
        "topLevelAwait",
      ],
    }) as unknown as AstFile;
  } catch {
    return null;
  }
}

async function extractCandidates(
  files: string[],
  options: CliOptions,
): Promise<{ stats: ScanStats; candidates: FunctionCandidate[] }> {
  const cwd = Deno.cwd();
  const candidates: FunctionCandidate[] = [];
  const stats: ScanStats = {
    scannedFiles: files.length,
    parsedFiles: 0,
    parseErrors: 0,
    skippedFunctions: 0,
    analyzedFunctions: 0,
  };

  let nextId = 0;
  for (const filePath of files) {
    const source = await Deno.readTextFile(filePath);
    const parsed = safeParseFile(source);
    if (!parsed || !parsed.program || !parsed.tokens) {
      stats.parseErrors++;
      continue;
    }
    stats.parsedFiles++;

    const tokens = parsed.tokens.filter((token) => token.type.label !== "eof");
    const relativePath = normalizePath(relative(cwd, filePath));

    traverseAst(parsed.program, (node, parent) => {
      if (!isFunctionNode(node)) return;
      if (options.includeCallbacks === false && isInlineCallback(node, parent)) return;
      if (typeof node.start !== "number" || typeof node.end !== "number") return;
      if (!node.loc?.start || !node.loc?.end) return;

      const rangeTokens = tokensInRange(tokens, node.start, node.end);
      if (rangeTokens.length === 0) return;

      const { strictTokens, structuralTokens } = normalizeFunctionTokens(rangeTokens);
      if (structuralTokens.length < options.minTokens) {
        stats.skippedFunctions++;
        return;
      }

      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      const locLines = Math.max(1, endLine - startLine + 1);
      if (locLines < options.minLines) return;

      const exactHash = hashFNV1a(structuralTokens.join(" "));
      const shingleHashes = makeShingles(strictTokens, options.shingleSize);

      candidates.push({
        id: nextId++,
        filePath,
        relativePath,
        name: getNodeName(node, parent),
        startOffset: node.start,
        endOffset: node.end,
        startLine,
        startColumn: node.loc.start.column,
        endLine,
        locLines,
        tokenCount: structuralTokens.length,
        exactHash,
        normalizedTokens: strictTokens,
        shingleHashes,
      });
      stats.analyzedFunctions++;
    });
  }

  return { stats, candidates };
}

function buildExactGroups(candidates: FunctionCandidate[]): DuplicateGroup[] {
  const byHash = new Map<string, FunctionCandidate[]>();
  for (const candidate of candidates) {
    const group = byHash.get(candidate.exactHash);
    if (group) {
      group.push(candidate);
    } else {
      byHash.set(candidate.exactHash, [candidate]);
    }
  }

  const groups: DuplicateGroup[] = [];
  let counter = 1;
  for (const members of byHash.values()) {
    if (members.length < 2) continue;

    const sorted = [...members].sort((a, b) => {
      if (a.relativePath !== b.relativePath) return a.relativePath.localeCompare(b.relativePath);
      return a.startLine - b.startLine;
    });

    groups.push({
      id: `E${String(counter).padStart(3, "0")}`,
      kind: "exact",
      members: sorted,
      impact: scoreGroupImpact(sorted),
      similarity: 1,
    });
    counter++;
  }

  return groups;
}

function buildNearGroups(
  candidates: FunctionCandidate[],
  exactGroups: DuplicateGroup[],
  options: CliOptions,
): DuplicateGroup[] {
  if (candidates.length < 2) return [];

  const exactMemberIds = new Set<number>();
  for (const group of exactGroups) {
    for (const member of group.members) {
      exactMemberIds.add(member.id);
    }
  }

  const shingleFrequency = new Map<number, number>();
  for (const candidate of candidates) {
    for (const shingle of candidate.shingleHashes) {
      shingleFrequency.set(shingle, (shingleFrequency.get(shingle) ?? 0) + 1);
    }
  }

  const index = new Map<number, number[]>();
  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx];
    for (const shingle of candidate.shingleHashes) {
      const freq = shingleFrequency.get(shingle) ?? 0;
      if (freq > options.maxShingleFrequency) continue;
      const posting = index.get(shingle);
      if (posting) {
        posting.push(idx);
      } else {
        index.set(shingle, [idx]);
      }
    }
  }

  const edges: NearEdge[] = [];
  const edgeSimilarity = new Map<string, number>();

  for (let idx = 0; idx < candidates.length; idx++) {
    const a = candidates[idx];
    if (exactMemberIds.has(a.id)) continue;

    const sharedCounts = new Map<number, number>();
    for (const shingle of a.shingleHashes) {
      const posting = index.get(shingle);
      if (!posting) continue;

      for (const otherIdx of posting) {
        if (otherIdx <= idx) continue;
        const b = candidates[otherIdx];
        if (exactMemberIds.has(b.id)) continue;
        if (a.exactHash === b.exactHash) continue;
        if (isNestedPair(a, b)) continue;
        sharedCounts.set(otherIdx, (sharedCounts.get(otherIdx) ?? 0) + 1);
      }
    }

    for (const [otherIdx, shared] of sharedCounts) {
      const b = candidates[otherIdx];
      const union = a.shingleHashes.length + b.shingleHashes.length - shared;
      if (union <= 0) continue;

      const similarity = shared / union;
      if (similarity < options.threshold) continue;

      edges.push({ a: idx, b: otherIdx, similarity });
      edgeSimilarity.set(edgeKey(idx, otherIdx), similarity);
    }
  }

  if (edges.length === 0) return [];
  const components = findComponents(candidates.length, edges);

  const groups: DuplicateGroup[] = [];
  let counter = 1;

  for (const component of components) {
    const members = component
      .map((idx) => candidates[idx])
      .filter((candidate) => !exactMemberIds.has(candidate.id))
      .sort((a, b) => {
        if (a.relativePath !== b.relativePath) return a.relativePath.localeCompare(b.relativePath);
        return a.startLine - b.startLine;
      });

    if (members.length < 2) continue;

    let total = 0;
    let count = 0;
    for (let i = 0; i < component.length; i++) {
      for (let j = i + 1; j < component.length; j++) {
        const sim = edgeSimilarity.get(edgeKey(component[i], component[j]));
        if (typeof sim === "number") {
          total += sim;
          count++;
        }
      }
    }

    const averageSimilarity = count > 0 ? total / count : options.threshold;
    groups.push({
      id: `N${String(counter).padStart(3, "0")}`,
      kind: "near",
      members,
      impact: scoreGroupImpact(members),
      similarity: averageSimilarity,
    });
    counter++;
  }

  return groups;
}

function sortGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
  return [...groups].sort((a, b) => {
    if (a.impact !== b.impact) return b.impact - a.impact;
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    if (a.similarity !== b.similarity) return b.similarity - a.similarity;
    return a.id.localeCompare(b.id);
  });
}

function toJson(stats: ScanStats, options: CliOptions, groups: DuplicateGroup[]): string {
  return JSON.stringify(
    {
      options: {
        paths: options.paths,
        excludes: options.excludes,
        extensions: [...options.extensions].sort((a, b) => a.localeCompare(b)),
        includeTests: options.includeTests,
        includeCallbacks: options.includeCallbacks,
        minTokens: options.minTokens,
        minLines: options.minLines,
        threshold: options.threshold,
        shingleSize: options.shingleSize,
        maxGroups: options.maxGroups,
        maxShingleFrequency: options.maxShingleFrequency,
      },
      stats,
      groupCount: groups.length,
      groups: groups.map((group) => ({
        id: group.id,
        kind: group.kind,
        impact: group.impact,
        similarity: Number(group.similarity.toFixed(4)),
        members: group.members.map((member) => ({
          file: member.relativePath,
          name: member.name,
          line: member.startLine,
          column: member.startColumn + 1,
          endLine: member.endLine,
          locLines: member.locLines,
          tokenCount: member.tokenCount,
        })),
      })),
    },
    null,
    2,
  );
}

function printTextReport(
  stats: ScanStats,
  groups: DuplicateGroup[],
  allCount: number,
  options: CliOptions,
): void {
  const exactCount = groups.filter((group) => group.kind === "exact").length;
  const nearCount = groups.filter((group) => group.kind === "near").length;
  const display = groups.slice(0, options.maxGroups);

  console.log("Duplicate Function Report");
  console.log("=========================");
  console.log(`Scanned files: ${stats.scannedFiles}`);
  console.log(`Parsed files: ${stats.parsedFiles}`);
  console.log(`Parse errors: ${stats.parseErrors}`);
  console.log(`Functions analyzed: ${stats.analyzedFunctions}`);
  console.log(`Groups found: ${groups.length} (exact=${exactCount}, near=${nearCount})`);
  console.log(
    `Near threshold: ${
      options.threshold.toFixed(2)
    } | Min tokens: ${options.minTokens} | Min lines: ${options.minLines}`,
  );
  console.log(
    `Extensions: ${[...options.extensions].sort((a, b) => a.localeCompare(b)).join(", ")}`,
  );
  console.log("");

  if (groups.length === 0) {
    console.log("No duplicate function groups found with current thresholds.");
    return;
  }

  for (const group of display) {
    const header =
      `${group.id} [${group.kind.toUpperCase()}] impact=${group.impact} members=${group.members.length} similarity=${
        group.similarity.toFixed(3)
      }`;
    console.log(header);
    for (const member of group.members) {
      console.log(
        `  - ${
          formatFnRef(member)
        } name=${member.name} lines=${member.locLines} tokens=${member.tokenCount}`,
      );
    }
    console.log("");
  }

  if (allCount > display.length) {
    console.log(
      `Showing ${display.length} of ${allCount} groups. Increase --max-groups to see more.`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const files = await collectSourceFiles(options);
  const { stats, candidates } = await extractCandidates(files, options);

  const exactGroups = buildExactGroups(candidates);
  const nearGroups = buildNearGroups(candidates, exactGroups, options);
  const groups = sortGroups([...exactGroups, ...nearGroups]);

  if (options.json) {
    console.log(toJson(stats, options, groups.slice(0, options.maxGroups)));
  } else {
    printTextReport(stats, groups, groups.length, options);
  }

  if (options.failOnFindings && groups.length > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
