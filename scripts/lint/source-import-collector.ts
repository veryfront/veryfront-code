import { parse } from "#babel/parser";
import { walk } from "#std/fs";
import { join, relative } from "#std/path";
import { isPathContained } from "../lib/path-containment.ts";

export interface CoreProductionSourceFile {
  path: string;
  content: string;
}

export interface CoreProductionFileCollection {
  files: CoreProductionSourceFile[];
  visitedFileCount: number;
}

export interface CoreProductionCollectionOptions {
  requiredRoots?: readonly string[];
  forcedIncludes?: readonly string[];
}

export interface SourceDependencyCollectionOptions {
  resolveModuleSpecifier?: (specifier: string, importer: string) => string;
  /** Test seam for forcing the structured non-convergence failure path. */
  maximumBindingPasses?: number;
  /** Maximum unique generated-source parses before analysis fails closed. */
  maximumExecutableSourceAnalyses?: number;
  /** Optional deterministic work counters for complexity regression tests. */
  onAnalysisDiagnostics?: (
    diagnostics: Readonly<SourceDependencyAnalysisDiagnostics>,
  ) => void;
}

export interface SourceDependencyAnalysisDiagnostics {
  awaitedIterableMemberVisits: number;
  awaitedPromiseOriginElementVisits: number;
  bindingDependencyEdges: number;
  bindingPasses: number;
  bindingTransferEvaluations: number;
  bindingWorklistEnqueues: number;
  containerIdentityElementVisits: number;
  containerIdentityInsertions: number;
  containerSnapshotForkElementCopies: number;
  containerMapEntryCopies: number;
  containerMemberJoins: number;
  executableSourceAnalyses: number;
  executableSourceBudgetExhaustions: number;
  executableSourceCacheHits: number;
  executableSourceCycleCuts: number;
  executableSourceDepthExhaustions: number;
  inheritedMemberProjectionTruncations: number;
  inheritedMemberProjectionVisits: number;
  promiseOriginElementVisits: number;
}

export type SourceDependencyKind =
  | "triple-slash-reference"
  | "static-import"
  | "static-export"
  | "type-import"
  | "import-equals"
  | "dynamic-import"
  | "runtime-loader"
  | "unresolved-runtime-loader";

export interface SourceDependency {
  path: string;
  line: number;
  column: number;
  kind: SourceDependencyKind;
  specifier?: string;
  loader?: string;
}

export type SourceImportCollectorErrorCode =
  | "parse-failure"
  | "binding-resolution-failure"
  | "traversal-failure"
  | "read-failure";

export class SourceImportCollectorError extends Error {
  readonly code: SourceImportCollectorErrorCode;
  readonly path: string;

  constructor(
    code: SourceImportCollectorErrorCode,
    path: string,
    detail: string,
  ) {
    super(`${code}: ${path}: ${detail}`);
    this.name = "SourceImportCollectorError";
    this.code = code;
    this.path = path;
  }
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface NormalizedInvocation {
  target: unknown;
  arguments: unknown[];
  capabilityInputs: unknown[];
  kind: "direct" | "call" | "apply" | "construct";
  argumentsKnown: boolean;
}

interface LexicalScope {
  parent?: LexicalScope;
  bindings: Set<string>;
  functionScope: boolean;
}

interface InheritedBindingSeed {
  name: string;
  api?: ApiBinding;
  stringValue?: string;
  memberApis?: InheritedMemberApiSnapshot;
}

interface InheritedMemberApiSeed {
  path: readonly (string | undefined)[];
  api: ApiBinding;
}

interface InheritedMemberApiSnapshot {
  projections: readonly InheritedMemberApiSeed[];
  truncated: boolean;
}

type ApiBinding =
  | "create-require"
  | "require"
  | "require-alias"
  | "require-resolve"
  | "node-worker"
  | "worker-threads-namespace"
  | "node-module-namespace"
  | "global-namespace"
  | "navigator-namespace"
  | "service-worker"
  | "import-meta-namespace"
  | "css-namespace"
  | "audio-worklet"
  | "css-paint-worklet"
  | "css-layout-worklet"
  | "css-animation-worklet"
  | "module-register"
  | "service-worker-register"
  | "import-meta-resolve"
  | "import-scripts"
  | "audio-worklet-add-module"
  | "css-paint-worklet-add-module"
  | "css-layout-worklet-add-module"
  | "css-animation-worklet-add-module"
  | "web-worker"
  | "shared-worker"
  | "Function"
  | "AsyncFunction"
  | "GeneratorFunction"
  | "AsyncGeneratorFunction"
  | "eval"
  | "set-timeout"
  | "set-interval"
  | "node-vm-namespace"
  | "node-vm-run-in-context"
  | "node-vm-run-in-new-context"
  | "node-vm-run-in-this-context"
  | "node-vm-compile-function"
  | "node-vm-create-script"
  | "node-vm-script"
  | "node-vm-source-text-module"
  | "uncertain-runtime-loader";

const REQUIRE_FAMILY_APIS: ReadonlySet<ApiBinding> = new Set([
  "create-require",
  "require",
  "require-alias",
  "require-resolve",
]);

type ScopedValues<T> = WeakMap<LexicalScope, Map<string, T>>;

interface PrefixSnapshotSetArena<T> {
  values: T[];
  positions: Map<T, number>;
}

interface PrefixSnapshotSetWorkDiagnostics {
  containerIdentityElementVisits: number;
  containerIdentityInsertions: number;
  containerSnapshotForkElementCopies: number;
}

interface ImmutableSnapshotSet<T> extends Iterable<T> {
  readonly size: number;
  has(value: T): boolean;
}

/**
 * An immutable set view backed by an append-only arena.
 *
 * Appending at the arena tip is O(delta) while older views retain their fixed
 * prefix length. Appending from an older branch forks only that branch, so a
 * join can never mutate facts that share the same provenance history.
 */
class PrefixSnapshotSet<T> implements ImmutableSnapshotSet<T> {
  readonly #arena: PrefixSnapshotSetArena<T>;
  readonly #length: number;

  private constructor(arena: PrefixSnapshotSetArena<T>, length: number) {
    this.#arena = arena;
    this.#length = length;
  }

  static from<T>(values: Iterable<T>): PrefixSnapshotSet<T> {
    if (values instanceof PrefixSnapshotSet) return values;
    const ordered: T[] = [];
    const positions = new Map<T, number>();
    for (const value of values) {
      if (positions.has(value)) continue;
      positions.set(value, ordered.length);
      ordered.push(value);
    }
    return new PrefixSnapshotSet(
      { values: ordered, positions },
      ordered.length,
    );
  }

  append(
    values: Iterable<T>,
    diagnostics?: PrefixSnapshotSetWorkDiagnostics,
  ): PrefixSnapshotSet<T> {
    const additions: T[] = [];
    const pending = new Set<T>();
    for (const value of values) {
      if (diagnostics) diagnostics.containerIdentityElementVisits++;
      if (this.has(value) || pending.has(value)) continue;
      pending.add(value);
      additions.push(value);
    }
    if (additions.length === 0) return this;

    let arena = this.#arena;
    if (this.#length !== arena.values.length) {
      if (diagnostics) {
        diagnostics.containerSnapshotForkElementCopies += this.#length;
      }
      const prefix = arena.values.slice(0, this.#length);
      arena = {
        values: prefix,
        positions: new Map(prefix.map((value, index) => [value, index])),
      };
    }
    for (const value of additions) {
      if (arena.positions.has(value)) continue;
      arena.positions.set(value, arena.values.length);
      arena.values.push(value);
    }
    if (diagnostics) {
      diagnostics.containerIdentityInsertions += additions.length;
    }
    return new PrefixSnapshotSet(arena, arena.values.length);
  }

  mergedWith(
    other: PrefixSnapshotSet<T>,
    diagnostics?: PrefixSnapshotSetWorkDiagnostics,
  ): PrefixSnapshotSet<T> {
    if (other === this) return this;
    if (other.#arena === this.#arena) {
      if (other.#length <= this.#length) return this;
      if (diagnostics) {
        diagnostics.containerIdentityInsertions += other.#length - this.#length;
      }
      return other;
    }
    return this.append(other, diagnostics);
  }

  get size(): number {
    return this.#length;
  }

  has(value: T): boolean {
    const position = this.#arena.positions.get(value);
    return position !== undefined && position < this.#length;
  }

  *#values(): IterableIterator<T> {
    for (let index = 0; index < this.#length; index++) {
      yield this.#arena.values[index];
    }
  }

  *#entries(): IterableIterator<[T, T]> {
    for (const value of this.#values()) yield [value, value];
  }

  entries(): SetIterator<[T, T]> {
    return this.#entries() as SetIterator<[T, T]>;
  }

  keys(): SetIterator<T> {
    return this.#values() as SetIterator<T>;
  }

  values(): SetIterator<T> {
    return this.#values() as SetIterator<T>;
  }

  forEach(
    callbackfn: (value: T, value2: T, set: ImmutableSnapshotSet<T>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.#values()) {
      callbackfn.call(thisArg, value, value, this);
    }
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return "Set";
  }
}

interface PromiseOrigins {
  origins: PrefixSnapshotSet<AstNode>;
  unknown: boolean;
}

type ValueContainerKind =
  | "object-literal"
  | "array-literal"
  | "promise-all-result"
  | "array-rest"
  | "object-rest";

interface ValueContainerIdentity {
  readonly site: AstNode;
  readonly kind: ValueContainerKind;
}

interface ValueFacts {
  api?: ApiBinding;
  promise: PromiseOrigins;
  containers: PrefixSnapshotSet<ValueContainerIdentity>;
  unknown: boolean;
  definitelyTruthy: boolean;
  definitelyNonNullish: boolean;
}

interface ValueContainerFacts {
  members: Map<string, ValueFacts>;
  wildcard?: ValueFacts;
}

const NO_PROMISE_ORIGINS: PromiseOrigins = {
  origins: PrefixSnapshotSet.from<AstNode>([]),
  unknown: false,
};
const UNKNOWN_PROMISE_ORIGINS: PromiseOrigins = {
  origins: PrefixSnapshotSet.from<AstNode>([]),
  unknown: true,
};

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isEligibleProductionSourcePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(normalized)) {
    return false;
  }
  if (
    /(?:\.(?:test|spec|integration|e2e|bench|test-helpers)|_test)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
      .test(
        normalized,
      ) || normalized.endsWith("/_test-setup.ts")
  ) {
    return false;
  }
  if (
    normalized.split("/").some((segment) =>
      segment === "__tests__" || segment === "__fixtures__" ||
      segment === "fixtures"
    )
  ) {
    return false;
  }
  return !normalized.startsWith("cli/templates/");
}

/** Collect production source files from the configured repository root. */
export async function collectCoreProductionFiles(
  root: string,
  options: CoreProductionCollectionOptions = {},
): Promise<CoreProductionFileCollection> {
  const files: CoreProductionSourceFile[] = [];
  const requiredRoots = options.requiredRoots ?? ["src", "cli"];
  const forcedIncludes = new Set(
    (options.forcedIncludes ?? []).map(normalizePath),
  );
  let repositoryRealPath: string;
  try {
    repositoryRealPath = await Deno.realPath(root);
  } catch (error) {
    throw new SourceImportCollectorError(
      "traversal-failure",
      normalizePath(root),
      error instanceof Error ? error.message : String(error),
    );
  }

  for (const rawSourceRoot of requiredRoots) {
    const sourceRoot = normalizePath(rawSourceRoot).replace(/\/$/, "");
    if (
      sourceRoot === "" || sourceRoot === ".." ||
      sourceRoot.startsWith("../") ||
      sourceRoot.startsWith("/")
    ) {
      throw new SourceImportCollectorError(
        "traversal-failure",
        sourceRoot || rawSourceRoot,
        "registered production root must be repository-relative",
      );
    }
    const sourceDirectory = join(root, sourceRoot);
    try {
      const stat = await Deno.lstat(sourceDirectory);
      if (stat.isSymlink) {
        throw new SourceImportCollectorError(
          "traversal-failure",
          sourceRoot,
          "registered production root is a symbolic link",
        );
      }
      if (!stat.isDirectory) {
        throw new SourceImportCollectorError(
          "traversal-failure",
          sourceRoot,
          "registered production root is not a directory",
        );
      }
    } catch (error) {
      if (error instanceof SourceImportCollectorError) throw error;
      if (error instanceof Deno.errors.NotFound) {
        throw new SourceImportCollectorError(
          "traversal-failure",
          sourceRoot,
          "registered production root is missing",
        );
      }
      throw new SourceImportCollectorError(
        "traversal-failure",
        sourceRoot,
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      for await (
        const entry of walk(sourceDirectory, {
          exts: SOURCE_EXTENSIONS,
          followSymlinks: false,
          skip: [
            /(?:^|\/)node_modules(?:\/|$)/,
            /(?:^|\/)dist(?:\/|$)/,
            /(?:^|\/)coverage(?:\/|$)/,
          ],
        })
      ) {
        const repositoryPath = normalizePath(relative(root, entry.path));
        if (entry.isSymlink) {
          throw new SourceImportCollectorError(
            "traversal-failure",
            repositoryPath,
            "symbolic links are not permitted in registered production roots",
          );
        }
        if (
          !entry.isFile ||
          !isEligibleProductionSourcePath(repositoryPath) &&
            !forcedIncludes.has(repositoryPath)
        ) continue;
        const entryRealPath = await Deno.realPath(entry.path);
        if (!isPathContained(repositoryRealPath, entryRealPath)) {
          throw new SourceImportCollectorError(
            "traversal-failure",
            repositoryPath,
            "production source escapes repository root",
          );
        }
        files.push({
          path: repositoryPath,
          content: await readSourceFile(entry.path, repositoryPath),
        });
      }
    } catch (error) {
      if (error instanceof SourceImportCollectorError) throw error;
      throw new SourceImportCollectorError(
        "traversal-failure",
        sourceRoot,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (files.length === 0) {
    throw new SourceImportCollectorError(
      "traversal-failure",
      normalizePath(root),
      "Core dependency audit found zero eligible production files",
    );
  }

  files.sort((left, right) => compareOrdinal(left.path, right.path));
  return { files, visitedFileCount: files.length };
}

async function readSourceFile(
  filesystemPath: string,
  repositoryPath: string,
): Promise<string> {
  try {
    return await Deno.readTextFile(filesystemPath);
  } catch (error) {
    throw new SourceImportCollectorError(
      "read-failure",
      repositoryPath,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" || key === "extra" || key === "comments" ||
      key === "tokens" || key === "errors"
    ) {
      continue;
    }
    if (isNode(value)) children.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) children.push(entry);
    }
  }
  return children;
}

function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" &&
      typeof node.name === "string"
    ? node.name
    : undefined;
}

function memberPropertyName(node: unknown): string | undefined {
  if (
    !isNode(node) || node.type !== "MemberExpression" &&
      node.type !== "OptionalMemberExpression"
  ) return undefined;
  if (node.computed === true) {
    const literal = literalString(node.property);
    if (literal !== undefined) return literal;
    if (
      isNode(node.property) && node.property.type === "NumericLiteral" &&
      typeof node.property.value === "number"
    ) {
      return String(node.property.value);
    }
    return undefined;
  }
  return identifierName(node.property);
}

function literalString(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.value === "string" ? node.value : undefined;
  }
  if (node.type !== "TemplateLiteral") return undefined;
  const expressions = Array.isArray(node.expressions) ? node.expressions : [];
  const quasis = Array.isArray(node.quasis) ? node.quasis : [];
  if (expressions.length !== 0 || quasis.length !== 1 || !isNode(quasis[0])) {
    return undefined;
  }
  const value = quasis[0].value;
  if (typeof value !== "object" || value === null) return undefined;
  const cooked = (value as { cooked?: unknown }).cooked;
  const raw = (value as { raw?: unknown }).raw;
  return typeof cooked === "string"
    ? cooked
    : typeof raw === "string"
    ? raw
    : undefined;
}

function templateElementString(node: unknown): string | undefined {
  if (!isNode(node) || node.type !== "TemplateElement") return undefined;
  const value = node.value;
  if (typeof value !== "object" || value === null) return undefined;
  const cooked = (value as { cooked?: unknown }).cooked;
  const raw = (value as { raw?: unknown }).raw;
  return typeof cooked === "string"
    ? cooked
    : typeof raw === "string"
    ? raw
    : undefined;
}

function addPatternBindings(pattern: unknown, bindings: Set<string>): void {
  if (!isNode(pattern)) return;
  const name = identifierName(pattern);
  if (name) {
    bindings.add(name);
    return;
  }
  if (pattern.type === "RestElement") {
    addPatternBindings(pattern.argument, bindings);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    addPatternBindings(pattern.left, bindings);
    return;
  }
  if (pattern.type === "TSParameterProperty") {
    addPatternBindings(pattern.parameter, bindings);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (
      const property of Array.isArray(pattern.properties)
        ? pattern.properties
        : []
    ) {
      if (!isNode(property)) continue;
      addPatternBindings(
        property.type === "RestElement" ? property.argument : property.value,
        bindings,
      );
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (
      const element of Array.isArray(pattern.elements) ? pattern.elements : []
    ) {
      addPatternBindings(element, bindings);
    }
  }
}

function nearestFunctionScope(scope: LexicalScope): LexicalScope {
  let current = scope;
  while (!current.functionScope && current.parent) current = current.parent;
  return current;
}

function isFunctionNode(node: AstNode): boolean {
  return node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" || node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod";
}

function isLexicalScopeNode(node: AstNode): boolean {
  return node.type === "BlockStatement" || node.type === "CatchClause" ||
    node.type === "StaticBlock" || node.type === "ForStatement" ||
    node.type === "ForInStatement" || node.type === "ForOfStatement" ||
    node.type === "SwitchStatement" || node.type === "TSModuleBlock";
}

function buildScopeMap(
  ast: AstNode,
  inheritedScope?: LexicalScope,
): {
  scopeByNode: WeakMap<AstNode, LexicalScope>;
  programScope: LexicalScope;
} {
  const scopeByNode = new WeakMap<AstNode, LexicalScope>();
  let programScope: LexicalScope | undefined;

  function visit(node: AstNode, incomingScope?: LexicalScope): void {
    let scope = incomingScope;
    if (node.type === "File") {
      scope = {
        parent: inheritedScope,
        bindings: new Set(),
        functionScope: true,
      };
    } else if (node.type === "Program") {
      scope ??= {
        parent: inheritedScope,
        bindings: new Set(),
        functionScope: true,
      };
      programScope = scope;
    } else if (isFunctionNode(node)) {
      if (node.type === "FunctionDeclaration" && incomingScope) {
        addPatternBindings(node.id, incomingScope.bindings);
      }
      scope = {
        parent: incomingScope,
        bindings: new Set(),
        functionScope: true,
      };
      if (node.type === "FunctionExpression") {
        addPatternBindings(node.id, scope.bindings);
      }
      for (const parameter of Array.isArray(node.params) ? node.params : []) {
        addPatternBindings(parameter, scope.bindings);
      }
    } else if (
      node.type === "ClassDeclaration" || node.type === "ClassExpression"
    ) {
      if (
        node.type === "ClassDeclaration" && incomingScope &&
        node.declare !== true
      ) {
        addPatternBindings(node.id, incomingScope.bindings);
      }
      scope = {
        parent: incomingScope,
        bindings: new Set(),
        functionScope: false,
      };
      if (node.declare !== true) addPatternBindings(node.id, scope.bindings);
    } else if (node.type === "TSModuleDeclaration") {
      if (incomingScope && node.declare !== true) {
        addPatternBindings(node.id, incomingScope.bindings);
      }
      scope = {
        parent: incomingScope,
        bindings: new Set(),
        functionScope: false,
      };
    } else if (isLexicalScopeNode(node)) {
      scope = {
        parent: incomingScope,
        bindings: new Set(),
        functionScope: false,
      };
      if (node.type === "CatchClause") {
        addPatternBindings(node.param, scope.bindings);
      }
    }
    if (!scope) throw new Error("Parser AST has no Program root scope");
    scopeByNode.set(node, scope);

    if (node.type === "VariableDeclaration" && node.declare !== true) {
      const target = node.kind === "var" ? nearestFunctionScope(scope) : scope;
      for (
        const declaration of Array.isArray(node.declarations)
          ? node.declarations
          : []
      ) {
        if (isNode(declaration)) {
          addPatternBindings(declaration.id, target.bindings);
        }
      }
    } else if (
      node.type === "ImportDeclaration" && node.importKind !== "type"
    ) {
      for (
        const specifier of Array.isArray(node.specifiers) ? node.specifiers : []
      ) {
        if (isNode(specifier) && specifier.importKind !== "type") {
          addPatternBindings(specifier.local, scope.bindings);
        }
      }
    } else if (
      node.type === "TSImportEqualsDeclaration" && node.importKind !== "type"
    ) {
      addPatternBindings(node.id, scope.bindings);
    } else if (node.type === "TSEnumDeclaration" && node.declare !== true) {
      addPatternBindings(node.id, scope.bindings);
    }
    for (const child of childNodes(node)) visit(child, scope);
  }

  visit(ast);
  if (!programScope) throw new Error("Parser AST has no Program scope");
  return { scopeByNode, programScope };
}

function closestBindingScope(
  scope: LexicalScope,
  name: string,
): LexicalScope | undefined {
  for (
    let current: LexicalScope | undefined = scope;
    current;
    current = current.parent
  ) {
    if (current.bindings.has(name)) return current;
  }
  return undefined;
}

function isUnbound(scope: LexicalScope, name: string): boolean {
  return closestBindingScope(scope, name) === undefined;
}

function sourceLocation(node: AstNode): { line: number; column: number } {
  const loc = node.loc;
  if (typeof loc !== "object" || loc === null) return { line: 1, column: 1 };
  const start = (loc as { start?: unknown }).start;
  if (typeof start !== "object" || start === null) {
    return { line: 1, column: 1 };
  }
  const line = (start as { line?: unknown }).line;
  const column = (start as { column?: unknown }).column;
  return {
    line: typeof line === "number" ? line : 1,
    column: typeof column === "number" ? column + 1 : 1,
  };
}

function isImportMeta(node: unknown): boolean {
  return isNode(node) && node.type === "MetaProperty" &&
    identifierName(node.meta) === "import" &&
    identifierName(node.property) === "meta";
}

function isImportMetaUrl(node: unknown): boolean {
  return isNode(node) && (node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression") &&
    isImportMeta(node.object) && memberPropertyName(node) === "url";
}

function transparentExpressionChild(node: AstNode): unknown {
  return node.type === "TSAsExpression" ||
      node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "TSInstantiationExpression" ||
      node.type === "ParenthesizedExpression"
    ? node.expression
    : undefined;
}

function unwrapTransparentExpression(node: unknown): unknown {
  let current = node;
  while (isNode(current)) {
    const child = transparentExpressionChild(current);
    if (child === undefined) break;
    current = child;
  }
  return current;
}

function unwrapAwaitedExpression(
  node: unknown,
): { value: unknown; awaited: boolean } {
  let value = unwrapTransparentExpression(node);
  let awaited = false;
  while (isNode(value) && value.type === "AwaitExpression") {
    awaited = true;
    value = unwrapTransparentExpression(value.argument);
  }
  return { value, awaited };
}

function unwrapAwait(node: unknown): unknown {
  return unwrapAwaitedExpression(node).value;
}

function getScopedValue<T>(
  values: ScopedValues<T>,
  scope: LexicalScope,
  name: string,
): T | undefined {
  const bindingScope = closestBindingScope(scope, name);
  return bindingScope ? values.get(bindingScope)?.get(name) : undefined;
}

function setScopedValue<T>(
  values: ScopedValues<T>,
  scope: LexicalScope,
  name: string,
  value: T,
): boolean {
  const bindingScope = closestBindingScope(scope, name);
  if (!bindingScope) return false;
  let scoped = values.get(bindingScope);
  if (!scoped) {
    scoped = new Map();
    values.set(bindingScope, scoped);
  }
  if (scoped.get(name) === value) return false;
  scoped.set(name, value);
  return true;
}

function joinPromiseOrigins(
  current: PromiseOrigins | undefined,
  incoming: PromiseOrigins,
  diagnostics?: SourceDependencyAnalysisDiagnostics,
): PromiseOrigins {
  if (current === undefined) {
    if (diagnostics) {
      diagnostics.promiseOriginElementVisits += incoming.origins.size;
    }
    return {
      origins: PrefixSnapshotSet.from(incoming.origins),
      unknown: incoming.unknown,
    };
  }
  if (
    current === incoming ||
    current.origins === incoming.origins &&
      (!incoming.unknown || current.unknown)
  ) {
    return current;
  }
  const additions: AstNode[] = [];
  for (const origin of incoming.origins) {
    if (diagnostics) diagnostics.promiseOriginElementVisits++;
    if (!current.origins.has(origin)) additions.push(origin);
  }
  const addsOrigin = additions.length > 0;
  const addsUnknown = incoming.unknown && !current.unknown;
  if (!addsOrigin && !addsUnknown) return current;
  return {
    origins: addsOrigin
      ? PrefixSnapshotSet.from(current.origins).append(additions)
      : current.origins,
    unknown: current.unknown || incoming.unknown,
  };
}

function withUnknownPromiseOrigins(origins: PromiseOrigins): PromiseOrigins {
  return origins.unknown
    ? origins
    : { origins: origins.origins, unknown: true };
}

function hasPromiseOrigins(origins: PromiseOrigins): boolean {
  return origins.origins.size > 0 || origins.unknown;
}

function uncertainAlias(api: ApiBinding): ApiBinding {
  return api === "require" || api === "require-alias" ||
      api === "require-resolve" || api === "create-require"
    ? "require-alias"
    : "uncertain-runtime-loader";
}

function joinApiBinding(
  current: ApiBinding | undefined,
  incoming: ApiBinding,
): ApiBinding {
  if (current === undefined || current === incoming) return incoming;
  if (current === "uncertain-runtime-loader") return current;
  return REQUIRE_FAMILY_APIS.has(current) && REQUIRE_FAMILY_APIS.has(incoming)
    ? "require-alias"
    : "uncertain-runtime-loader";
}

function loaderForApi(api: ApiBinding): string | undefined {
  switch (api) {
    case "import-meta-resolve":
      return "import.meta.resolve";
    case "module-register":
      return "module.register";
    case "service-worker-register":
      return "navigator.serviceWorker.register";
    case "import-scripts":
      return "importScripts";
    case "audio-worklet-add-module":
      return "AudioWorklet.addModule";
    case "css-paint-worklet-add-module":
      return "CSS.paintWorklet.addModule";
    case "css-layout-worklet-add-module":
      return "CSS.layoutWorklet.addModule";
    case "css-animation-worklet-add-module":
      return "CSS.animationWorklet.addModule";
    case "node-worker":
      return "node:worker_threads.Worker";
    case "web-worker":
      return "Worker";
    case "shared-worker":
      return "SharedWorker";
    default:
      return undefined;
  }
}

function unresolvedLoaderForApi(api: ApiBinding): string | undefined {
  if (
    api === "require" || api === "require-alias" || api === "create-require"
  ) {
    return "require-alias";
  }
  if (api === "require-resolve") return "require.resolve";
  if (api === "eval") return "eval";
  if (api === "Function") return "Function";
  if (api === "AsyncFunction") return "AsyncFunction";
  if (api === "GeneratorFunction") return "GeneratorFunction";
  if (api === "AsyncGeneratorFunction") return "AsyncGeneratorFunction";
  if (api === "set-timeout") return "setTimeout";
  if (api === "set-interval") return "setInterval";
  if (api === "node-vm-run-in-context") return "node:vm.runInContext";
  if (api === "node-vm-run-in-new-context") {
    return "node:vm.runInNewContext";
  }
  if (api === "node-vm-run-in-this-context") {
    return "node:vm.runInThisContext";
  }
  if (api === "node-vm-compile-function") return "node:vm.compileFunction";
  if (api === "node-vm-create-script") return "node:vm.createScript";
  if (api === "node-vm-script") return "node:vm.Script";
  if (api === "node-vm-source-text-module") {
    return "node:vm.SourceTextModule";
  }
  if (api === "uncertain-runtime-loader") return "runtime-loader-alias";
  return loaderForApi(api);
}

function importedApi(
  moduleName: string,
  imported: string,
): ApiBinding | undefined {
  if (moduleName === "node:module" && imported === "createRequire") {
    return "create-require";
  }
  if (moduleName === "node:module" && imported === "register") {
    return "module-register";
  }
  if (moduleName === "node:worker_threads" && imported === "Worker") {
    return "node-worker";
  }
  if (moduleName === "node:vm") {
    if (imported === "runInContext") return "node-vm-run-in-context";
    if (imported === "runInNewContext") return "node-vm-run-in-new-context";
    if (imported === "runInThisContext") return "node-vm-run-in-this-context";
    if (imported === "compileFunction") return "node-vm-compile-function";
    if (imported === "createScript") return "node-vm-create-script";
    if (imported === "Script") return "node-vm-script";
    if (imported === "SourceTextModule") return "node-vm-source-text-module";
  }
  return undefined;
}

function memberApi(
  owner: ApiBinding | undefined,
  property: string | undefined,
): ApiBinding | undefined {
  if (owner === "uncertain-runtime-loader") {
    return "uncertain-runtime-loader";
  }
  if (
    (owner === "require" || owner === "require-alias") &&
    property === "resolve"
  ) {
    return "require-resolve";
  }
  if (owner === "node-module-namespace" && property === "createRequire") {
    return "create-require";
  }
  if (owner === "node-module-namespace" && property === "register") {
    return "module-register";
  }
  if (owner === "node-module-namespace" && property === "require") {
    return "require";
  }
  if (
    (owner === "require" || owner === "require-alias") && property === "main"
  ) {
    return "node-module-namespace";
  }
  if (owner === "worker-threads-namespace" && property === "Worker") {
    return "node-worker";
  }
  if (owner === "node-vm-namespace") {
    if (property === "default") return "node-vm-namespace";
    if (property === "runInContext") return "node-vm-run-in-context";
    if (property === "runInNewContext") return "node-vm-run-in-new-context";
    if (property === "runInThisContext") return "node-vm-run-in-this-context";
    if (property === "compileFunction") return "node-vm-compile-function";
    if (property === "createScript") return "node-vm-create-script";
    if (property === "Script") return "node-vm-script";
    if (property === "SourceTextModule") return "node-vm-source-text-module";
  }
  if (owner === "global-namespace") {
    if (property === "Worker") return "web-worker";
    if (property === "SharedWorker") return "shared-worker";
    if (property === "Function") return "Function";
    if (property === "eval") return "eval";
    if (property === "setTimeout") return "set-timeout";
    if (property === "setInterval") return "set-interval";
    if (property === "importScripts") return "import-scripts";
    if (property === "CSS") return "css-namespace";
    if (property === "audioWorklet") return "audio-worklet";
    if (property === "navigator") return "navigator-namespace";
  }
  if (owner === "navigator-namespace" && property === "serviceWorker") {
    return "service-worker";
  }
  if (owner === "service-worker" && property === "register") {
    return "service-worker-register";
  }
  if (owner === "import-meta-namespace" && property === "resolve") {
    return "import-meta-resolve";
  }
  if (owner === "css-namespace") {
    if (property === "paintWorklet") return "css-paint-worklet";
    if (property === "layoutWorklet") return "css-layout-worklet";
    if (property === "animationWorklet") return "css-animation-worklet";
  }
  if (owner === "audio-worklet" && property === "addModule") {
    return "audio-worklet-add-module";
  }
  if (owner === "css-paint-worklet" && property === "addModule") {
    return "css-paint-worklet-add-module";
  }
  if (owner === "css-layout-worklet" && property === "addModule") {
    return "css-layout-worklet-add-module";
  }
  if (owner === "css-animation-worklet" && property === "addModule") {
    return "css-animation-worklet-add-module";
  }
  return undefined;
}

function isUnboundGlobalObject(
  node: unknown,
  scope: LexicalScope,
): boolean {
  const name = identifierName(node);
  return name !== undefined &&
    ["globalThis", "window", "self"].includes(name) &&
    isUnbound(scope, name);
}

function isGlobalNavigator(node: unknown, scope: LexicalScope): boolean {
  const name = identifierName(node);
  if (name === "navigator") return isUnbound(scope, name);
  return isNode(node) &&
    (node.type === "MemberExpression" ||
      node.type === "OptionalMemberExpression") &&
    memberPropertyName(node) === "navigator" &&
    isUnboundGlobalObject(node.object, scope);
}

function collectModuleBindings(
  ast: AstNode,
  scopeByNode: WeakMap<AstNode, LexicalScope>,
  filePath: string,
  options: SourceDependencyCollectionOptions,
  inheritedScope: LexicalScope | undefined,
  inheritedBindings: readonly InheritedBindingSeed[],
): {
  stringValues: ScopedValues<string>;
  resolveApi: (node: unknown, scope: LexicalScope) => ApiBinding | undefined;
  resolveMemberProperty: (
    node: unknown,
    scope: LexicalScope,
  ) => string | undefined;
  normalizeInvocation: (
    node: AstNode,
    scope: LexicalScope,
  ) => NormalizedInvocation;
  loaderEscapeForNode: (
    node: AstNode,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  capabilityApiForExpression: (
    node: unknown,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  memberApisForExpression: (
    node: unknown,
    scope: LexicalScope,
  ) => InheritedMemberApiSnapshot;
  analysisDiagnostics: SourceDependencyAnalysisDiagnostics;
} {
  const analysisDiagnostics: SourceDependencyAnalysisDiagnostics = {
    awaitedIterableMemberVisits: 0,
    awaitedPromiseOriginElementVisits: 0,
    bindingDependencyEdges: 0,
    bindingPasses: 0,
    bindingTransferEvaluations: 0,
    bindingWorklistEnqueues: 0,
    containerIdentityElementVisits: 0,
    containerIdentityInsertions: 0,
    containerSnapshotForkElementCopies: 0,
    containerMapEntryCopies: 0,
    containerMemberJoins: 0,
    executableSourceAnalyses: 0,
    executableSourceBudgetExhaustions: 0,
    executableSourceCacheHits: 0,
    executableSourceCycleCuts: 0,
    executableSourceDepthExhaustions: 0,
    inheritedMemberProjectionTruncations: 0,
    inheritedMemberProjectionVisits: 0,
    promiseOriginElementVisits: 0,
  };
  const stringValues: ScopedValues<string> = new WeakMap();
  const valueBindings: ScopedValues<ValueFacts> = new WeakMap();
  const valueContainerIdentities = new WeakMap<
    AstNode,
    ValueContainerIdentity
  >();
  const valueContainerFacts = new Map<
    ValueContainerIdentity,
    ValueContainerFacts
  >();
  const constructedValueContainerFacts = new Map<
    ValueContainerIdentity,
    ValueContainerFacts
  >();
  const valueContainerVersions = new Map<ValueContainerIdentity, number>();
  const flowValueFactsByNode = new WeakMap<AstNode, ValueFacts>();
  const unsafeLocalContainerIdentities = new Set<ValueContainerIdentity>();
  const trustedLocalContainerSites = new WeakSet<AstNode>();
  const staticApiSeeds: Array<{
    scope: LexicalScope;
    name: string;
    api: ApiBinding;
  }> = [];
  const inheritedMemberApis = new Map<
    string,
    InheritedMemberApiSnapshot
  >();
  if (inheritedScope) {
    for (const binding of inheritedBindings) {
      if (binding.api) {
        staticApiSeeds.push({
          scope: inheritedScope,
          name: binding.name,
          api: binding.api,
        });
      }
      if (binding.stringValue !== undefined) {
        setScopedValue(
          stringValues,
          inheritedScope,
          binding.name,
          binding.stringValue,
        );
      }
      if (
        binding.memberApis &&
        (binding.memberApis.projections.length > 0 ||
          binding.memberApis.truncated)
      ) {
        inheritedMemberApis.set(binding.name, binding.memberApis);
      }
    }
  }
  const parentByNode = new WeakMap<AstNode, AstNode>();
  const functionByScope = new WeakMap<LexicalScope, AstNode>();
  const immediatelyInvokedFunctions = new WeakSet<AstNode>();
  const returnValuesByFunction = new WeakMap<
    AstNode,
    Array<{ value: unknown; scope: LexicalScope }>
  >();
  const mutatedMemberBindings: WeakMap<LexicalScope, Set<string>> =
    new WeakMap();
  const memberMutationSites: WeakMap<
    LexicalScope,
    Map<string, AstNode[]>
  > = new WeakMap();
  const bindingReassignmentSites: WeakMap<
    LexicalScope,
    Map<string, AstNode[]>
  > = new WeakMap();
  const memberMutations: Array<{ target: AstNode; scope: LexicalScope }> = [];
  const escapedValues: Array<{ value: unknown; scope: LexicalScope }> = [];
  const declarations: Array<{
    node: AstNode;
    scope: LexicalScope;
    kind: "const" | "let" | "var";
  }> = [];
  const assignmentPatterns: Array<{ node: AstNode; scope: LexicalScope }> = [];
  const mutations: Array<{ node: AstNode; scope: LexicalScope }> = [];
  const loopBindings: Array<{ node: AstNode; scope: LexicalScope }> = [];
  const functionNodes: AstNode[] = [];
  let visitedNodeCount = 0;
  let promiseProducerNodeCount = 0;
  const resolveModuleName = (specifier: string): string =>
    options.resolveModuleSpecifier?.(specifier, filePath) ?? specifier;

  interface BindingDependency {
    readonly kind: "value" | "string" | "container";
  }

  interface BindingTransfer {
    readonly dependencies: Set<BindingDependency>;
    readonly evaluate: () => void;
    queued: boolean;
  }

  const valueBindingDependencies: WeakMap<
    LexicalScope,
    Map<string, BindingDependency>
  > = new WeakMap();
  const stringBindingDependencies: WeakMap<
    LexicalScope,
    Map<string, BindingDependency>
  > = new WeakMap();
  const containerDependencies = new Map<
    ValueContainerIdentity,
    BindingDependency
  >();
  const dependencySubscribers = new Map<
    BindingDependency,
    Set<BindingTransfer>
  >();
  const bindingWorklist: BindingTransfer[] = [];
  let bindingWorklistHead = 0;
  let activeBindingTransfer: BindingTransfer | undefined;

  const scopedBindingDependency = (
    dependencies: WeakMap<LexicalScope, Map<string, BindingDependency>>,
    kind: "value" | "string",
    scope: LexicalScope,
    name: string,
  ): BindingDependency | undefined => {
    const bindingScope = closestBindingScope(scope, name);
    if (!bindingScope) return undefined;
    let scoped = dependencies.get(bindingScope);
    if (!scoped) {
      scoped = new Map();
      dependencies.set(bindingScope, scoped);
    }
    let dependency = scoped.get(name);
    if (!dependency) {
      dependency = { kind };
      scoped.set(name, dependency);
    }
    return dependency;
  };

  const containerDependency = (
    identity: ValueContainerIdentity,
  ): BindingDependency => {
    let dependency = containerDependencies.get(identity);
    if (!dependency) {
      dependency = { kind: "container" };
      containerDependencies.set(identity, dependency);
    }
    return dependency;
  };

  const recordBindingDependency = (
    dependency: BindingDependency | undefined,
  ): void => {
    const transfer = activeBindingTransfer;
    if (!transfer || !dependency || transfer.dependencies.has(dependency)) {
      return;
    }
    transfer.dependencies.add(dependency);
    let subscribers = dependencySubscribers.get(dependency);
    if (!subscribers) {
      subscribers = new Set();
      dependencySubscribers.set(dependency, subscribers);
    }
    subscribers.add(transfer);
    analysisDiagnostics.bindingDependencyEdges++;
  };

  const enqueueBindingTransfer = (transfer: BindingTransfer): void => {
    if (transfer.queued) return;
    transfer.queued = true;
    bindingWorklist.push(transfer);
    analysisDiagnostics.bindingWorklistEnqueues++;
  };

  const notifyBindingDependency = (
    dependency: BindingDependency | undefined,
  ): void => {
    if (!dependency) return;
    const subscribers = dependencySubscribers.get(dependency);
    if (!subscribers) return;
    for (const transfer of subscribers) enqueueBindingTransfer(transfer);
  };

  const readValueBinding = (
    scope: LexicalScope,
    name: string,
  ): ValueFacts | undefined => {
    recordBindingDependency(
      scopedBindingDependency(valueBindingDependencies, "value", scope, name),
    );
    return getScopedValue(valueBindings, scope, name);
  };

  const readStringBinding = (
    scope: LexicalScope,
    name: string,
  ): string | undefined => {
    recordBindingDependency(
      scopedBindingDependency(stringBindingDependencies, "string", scope, name),
    );
    return getScopedValue(stringValues, scope, name);
  };

  const readContainerFacts = (
    identity: ValueContainerIdentity,
  ): ValueContainerFacts | undefined => {
    recordBindingDependency(containerDependency(identity));
    return valueContainerFacts.get(identity);
  };

  const readContainerVersion = (
    identity: ValueContainerIdentity,
  ): number => {
    recordBindingDependency(containerDependency(identity));
    return valueContainerVersions.get(identity) ?? 0;
  };

  const markMemberMutation = (
    target: unknown,
    scope: LexicalScope,
    mutation: AstNode,
    definitelyOverwritesConstructor: boolean,
  ): void => {
    let root = target;
    while (
      isNode(root) &&
      (root.type === "MemberExpression" ||
        root.type === "OptionalMemberExpression")
    ) {
      root = root.object;
    }
    const name = identifierName(root);
    if (!name) return;
    const bindingScope = closestBindingScope(scope, name);
    if (!bindingScope) return;
    let names = mutatedMemberBindings.get(bindingScope);
    if (!names) {
      names = new Set();
      mutatedMemberBindings.set(bindingScope, names);
    }
    names.add(name);
    if (!definitelyOverwritesConstructor) return;
    let scopedSites = memberMutationSites.get(bindingScope);
    if (!scopedSites) {
      scopedSites = new Map();
      memberMutationSites.set(bindingScope, scopedSites);
    }
    let sites = scopedSites.get(name);
    if (!sites) {
      sites = [];
      scopedSites.set(name, sites);
    }
    sites.push(mutation);
  };

  const markBindingReassignment = (
    target: unknown,
    scope: LexicalScope,
    mutation: AstNode,
  ): void => {
    const name = identifierName(unwrapTransparentExpression(target));
    if (!name) return;
    const bindingScope = closestBindingScope(scope, name);
    if (!bindingScope) return;
    let scopedSites = bindingReassignmentSites.get(bindingScope);
    if (!scopedSites) {
      scopedSites = new Map();
      bindingReassignmentSites.set(bindingScope, scopedSites);
    }
    let sites = scopedSites.get(name);
    if (!sites) {
      sites = [];
      scopedSites.set(name, sites);
    }
    sites.push(mutation);
  };

  const visit = (node: AstNode): void => {
    visitedNodeCount++;
    if (
      node.type === "ImportExpression" || node.type === "CallExpression" ||
      node.type === "OptionalCallExpression"
    ) promiseProducerNodeCount++;
    const scope = scopeByNode.get(node);
    if (!scope) throw new Error(`missing lexical scope for ${node.type}`);
    if (isFunctionNode(node)) {
      functionByScope.set(scope, node);
      functionNodes.push(node);
    }
    if (
      node.type === "CallExpression" || node.type === "OptionalCallExpression"
    ) {
      for (
        const argument of Array.isArray(node.arguments) ? node.arguments : []
      ) {
        escapedValues.push({
          value: isNode(argument) && argument.type === "SpreadElement"
            ? argument.argument
            : argument,
          scope,
        });
      }
      if (
        isNode(node.callee) &&
        (node.callee.type === "MemberExpression" ||
          node.callee.type === "OptionalMemberExpression")
      ) {
        escapedValues.push({ value: node.callee.object, scope });
      }
    } else if (node.type === "ReturnStatement") {
      escapedValues.push({ value: node.argument, scope });
      const localFunction = functionByScope.get(nearestFunctionScope(scope));
      if (localFunction) {
        let returnValues = returnValuesByFunction.get(localFunction);
        if (!returnValues) {
          returnValues = [];
          returnValuesByFunction.set(localFunction, returnValues);
        }
        returnValues.push({ value: node.argument, scope });
      }
    }
    if (node.type === "AssignmentPattern") {
      assignmentPatterns.push({ node, scope });
    }
    if (node.type === "ForOfStatement") {
      loopBindings.push({ node, scope });
    }
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      const rawModuleName = literalString(node.source);
      const moduleName = rawModuleName === undefined
        ? undefined
        : resolveModuleName(rawModuleName);
      if (moduleName) {
        for (
          const specifier of Array.isArray(node.specifiers)
            ? node.specifiers
            : []
        ) {
          if (!isNode(specifier) || specifier.importKind === "type") continue;
          const local = identifierName(specifier.local);
          if (!local) continue;
          let api: ApiBinding | undefined;
          if (
            specifier.type === "ImportNamespaceSpecifier" ||
            specifier.type === "ImportDefaultSpecifier"
          ) {
            if (moduleName === "node:module") api = "node-module-namespace";
            if (moduleName === "node:worker_threads") {
              api = "worker-threads-namespace";
            }
            if (moduleName === "node:vm") api = "node-vm-namespace";
          } else {
            const imported = identifierName(specifier.imported) ??
              literalString(specifier.imported);
            if (imported) api = importedApi(moduleName, imported);
          }
          if (api) staticApiSeeds.push({ scope, name: local, api });
        }
      }
    } else if (
      node.type === "TSImportEqualsDeclaration" && node.importKind !== "type" &&
      isNode(node.moduleReference) &&
      node.moduleReference.type === "TSExternalModuleReference"
    ) {
      const rawModuleName = literalString(node.moduleReference.expression);
      const moduleName = rawModuleName === undefined
        ? undefined
        : resolveModuleName(rawModuleName);
      const local = identifierName(node.id);
      const api = moduleName === "node:module"
        ? "node-module-namespace"
        : moduleName === "node:worker_threads"
        ? "worker-threads-namespace"
        : moduleName === "node:vm"
        ? "node-vm-namespace"
        : undefined;
      if (local && api) staticApiSeeds.push({ scope, name: local, api });
    } else if (
      node.type === "VariableDeclaration" &&
      (node.kind === "const" || node.kind === "let" || node.kind === "var")
    ) {
      for (
        const declaration of Array.isArray(node.declarations)
          ? node.declarations
          : []
      ) {
        if (isNode(declaration)) {
          declarations.push({
            node: declaration,
            scope: scopeByNode.get(declaration) ?? scope,
            kind: node.kind,
          });
        }
      }
    } else if (node.type === "AssignmentExpression") {
      if (
        isNode(node.left) &&
        (node.left.type === "MemberExpression" ||
          node.left.type === "OptionalMemberExpression")
      ) {
        markMemberMutation(node.left, scope, node, node.operator === "=");
        memberMutations.push({ target: node.left, scope });
        escapedValues.push({ value: node.right, scope });
      }
      if (node.operator === "=") {
        markBindingReassignment(node.left, scope, node);
      }
      mutations.push({ node, scope });
    } else if (node.type === "UpdateExpression") {
      mutations.push({ node, scope });
      markMemberMutation(node.argument, scope, node, true);
      markBindingReassignment(node.argument, scope, node);
      if (isNode(node.argument)) {
        memberMutations.push({ target: node.argument, scope });
      }
    } else if (node.type === "UnaryExpression" && node.operator === "delete") {
      mutations.push({ node, scope });
      markMemberMutation(node.argument, scope, node, false);
      if (isNode(node.argument)) {
        memberMutations.push({ target: node.argument, scope });
      }
    }
    for (const child of childNodes(node)) {
      parentByNode.set(child, node);
      visit(child);
    }
  };
  visit(ast);

  const immutableFunctionInitializers: ScopedValues<{
    value: unknown;
    scope: LexicalScope;
  }> = new WeakMap();
  interface ImmutableProjectionInitializer {
    source: unknown;
    scope: LexicalScope;
    path: readonly (string | undefined)[];
    uncertain: boolean;
  }
  const immutableProjectionInitializers: ScopedValues<
    ImmutableProjectionInitializer
  > = new WeakMap();
  for (const { node: declaration, scope, kind } of declarations) {
    if (kind !== "const") continue;
    const name = identifierName(declaration.id);
    if (!name || declaration.init === undefined) continue;
    setScopedValue(immutableFunctionInitializers, scope, name, {
      value: declaration.init,
      scope,
    });
  }
  for (const functionNode of functionNodes) {
    if (functionNode.type !== "FunctionDeclaration") continue;
    const name = identifierName(functionNode.id);
    const scope = scopeByNode.get(functionNode);
    if (!name || !scope) continue;
    setScopedValue(immutableFunctionInitializers, scope, name, {
      value: functionNode,
      scope,
    });
  }

  const nearestFunctionAncestor = (node: AstNode): AstNode | undefined => {
    for (
      let current = parentByNode.get(node);
      current;
      current = parentByNode.get(current)
    ) {
      if (isFunctionNode(current)) return current;
    }
    return undefined;
  };

  const sequentialPosition = (
    node: AstNode,
  ):
    | { container: AstNode; statement: AstNode; index: number }
    | undefined => {
    let child = node;
    for (
      let parent = parentByNode.get(child);
      parent;
      parent = parentByNode.get(parent)
    ) {
      if (
        parent.type === "Program" || parent.type === "BlockStatement" ||
        parent.type === "StaticBlock"
      ) {
        const body = Array.isArray(parent.body)
          ? parent.body.filter(isNode)
          : [];
        const index = body.indexOf(child);
        if (index >= 0) {
          return { container: parent, statement: child, index };
        }
      }
      child = parent;
    }
    return undefined;
  };

  const hasDefiniteMutationBefore = (
    mutationSites: WeakMap<LexicalScope, Map<string, AstNode[]>>,
    bindingScope: LexicalScope,
    name: string,
    useSite: AstNode,
  ): boolean => {
    const usePosition = sequentialPosition(useSite);
    if (!usePosition) return false;
    const useFunction = nearestFunctionAncestor(useSite);
    for (
      const mutation of mutationSites.get(bindingScope)?.get(name) ?? []
    ) {
      if (nearestFunctionAncestor(mutation) !== useFunction) continue;
      const mutationPosition = sequentialPosition(mutation);
      if (
        !mutationPosition ||
        mutationPosition.container !== usePosition.container ||
        mutationPosition.index >= usePosition.index ||
        mutationPosition.statement.type !== "ExpressionStatement" ||
        unwrapTransparentExpression(mutationPosition.statement.expression) !==
          mutation
      ) {
        continue;
      }
      return true;
    }
    return false;
  };

  const isInertLocalContainerInitializer = (node: AstNode): boolean => {
    if (node.type === "ArrayExpression") return true;
    if (node.type !== "ObjectExpression") return false;
    for (
      const property of Array.isArray(node.properties) ? node.properties : []
    ) {
      if (!isNode(property)) continue;
      if (property.type === "ObjectMethod") return false;
      if (property.type !== "ObjectProperty") continue;
      if (
        property.kind === "get" || property.kind === "set" ||
        property.method === true
      ) return false;
      const isPrototypeInitializer = property.computed !== true &&
        property.shorthand !== true &&
        (identifierName(property.key) ?? literalString(property.key)) ===
          "__proto__";
      if (
        isPrototypeInitializer &&
        (!isNode(property.value) || property.value.type !== "NullLiteral")
      ) return false;
    }
    return true;
  };

  for (const { node: declaration, kind } of declarations) {
    if (kind !== "const") continue;
    const variableDeclaration = parentByNode.get(declaration);
    const declarationOwner = variableDeclaration
      ? parentByNode.get(variableDeclaration)
      : undefined;
    if (
      declarationOwner?.type === "ExportNamedDeclaration" ||
      declarationOwner?.type === "ExportDefaultDeclaration"
    ) {
      continue;
    }
    const name = identifierName(declaration.id);
    const initializer = unwrapTransparentExpression(declaration.init);
    if (
      !name || !isNode(initializer) ||
      (initializer.type !== "ObjectExpression" &&
        initializer.type !== "ArrayExpression") ||
      !isInertLocalContainerInitializer(initializer)
    ) {
      continue;
    }
    trustedLocalContainerSites.add(initializer);
  }

  const evaluateString = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    const value = unwrapAwait(node);
    const literal = literalString(value);
    if (literal !== undefined) return literal;
    const name = identifierName(value);
    if (name) return readStringBinding(scope, name);
    if (
      isNode(value) && value.type === "BinaryExpression" &&
      value.operator === "+"
    ) {
      const left = evaluateString(value.left, scope);
      const right = evaluateString(value.right, scope);
      return left === undefined || right === undefined
        ? undefined
        : `${left}${right}`;
    }
    if (isNode(value) && value.type === "TemplateLiteral") {
      const quasis = Array.isArray(value.quasis) ? value.quasis : [];
      const expressions = Array.isArray(value.expressions)
        ? value.expressions
        : [];
      if (quasis.length !== expressions.length + 1) return undefined;
      let result = "";
      for (let index = 0; index < quasis.length; index++) {
        const quasi = templateElementString(quasis[index]);
        if (quasi === undefined) return undefined;
        result += quasi;
        if (index < expressions.length) {
          const expression = evaluateString(expressions[index], scope);
          if (expression === undefined) return undefined;
          result += expression;
        }
      }
      return result;
    }
    if (isNode(value) && value.type === "NewExpression") {
      const callee = identifierName(value.callee);
      const globalUrl = isNode(value.callee) &&
        value.callee.type === "MemberExpression" &&
        identifierName(value.callee.object) === "globalThis" &&
        isUnbound(scope, "globalThis") &&
        memberPropertyName(value.callee) === "URL";
      if (!(callee === "URL" && isUnbound(scope, "URL")) && !globalUrl) {
        return undefined;
      }
      const args = Array.isArray(value.arguments) ? value.arguments : [];
      if (!isImportMetaUrl(args[1])) return undefined;
      return evaluateString(args[0], scope);
    }
    return undefined;
  };

  const resolvedMemberProperty = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    const direct = memberPropertyName(node);
    if (direct !== undefined) return direct;
    if (
      !isNode(node) ||
      (node.type !== "MemberExpression" &&
        node.type !== "OptionalMemberExpression") ||
      node.computed !== true
    ) {
      return undefined;
    }
    return evaluateString(node.property, scope);
  };

  const resolvedPropertyKey = (
    node: AstNode,
    scope: LexicalScope,
  ): string | undefined => {
    if (node.computed !== true) {
      const direct = identifierName(node.key) ?? literalString(node.key);
      if (direct !== undefined) return direct;
      return isNode(node.key) && node.key.type === "NumericLiteral" &&
          typeof node.key.value === "number"
        ? String(node.key.value)
        : undefined;
    }
    const computed = evaluateString(node.key, scope);
    if (computed !== undefined) return computed;
    return isNode(node.key) && node.key.type === "NumericLiteral" &&
        typeof node.key.value === "number"
      ? String(node.key.value)
      : undefined;
  };

  const recordImmutableProjectionPattern = (
    pattern: unknown,
    source: unknown,
    scope: LexicalScope,
    path: readonly (string | undefined)[] = [],
    uncertain = false,
  ): void => {
    const target = unwrapTransparentExpression(pattern);
    if (!isNode(target)) return;
    const name = identifierName(target);
    if (name) {
      setScopedValue(immutableProjectionInitializers, scope, name, {
        source,
        scope,
        path: [...path],
        uncertain,
      });
      return;
    }
    if (target.type === "AssignmentPattern") {
      recordImmutableProjectionPattern(
        target.left,
        source,
        scope,
        path,
        true,
      );
      return;
    }
    if (target.type === "RestElement") {
      recordImmutableProjectionPattern(
        target.argument,
        source,
        scope,
        path,
        true,
      );
      return;
    }
    if (target.type === "ArrayPattern") {
      const elements = Array.isArray(target.elements) ? target.elements : [];
      elements.forEach((element, index) => {
        if (!isNode(element)) return;
        const rest = element.type === "RestElement";
        recordImmutableProjectionPattern(
          rest ? element.argument : element,
          source,
          scope,
          rest ? path : [...path, String(index)],
          uncertain || rest,
        );
      });
      return;
    }
    if (target.type !== "ObjectPattern") return;
    for (
      const property of Array.isArray(target.properties)
        ? target.properties
        : []
    ) {
      if (!isNode(property)) continue;
      if (property.type === "RestElement") {
        recordImmutableProjectionPattern(
          property.argument,
          source,
          scope,
          path,
          true,
        );
        continue;
      }
      if (property.type !== "ObjectProperty") continue;
      const propertyName = resolvedPropertyKey(property, scope);
      recordImmutableProjectionPattern(
        property.value,
        source,
        scope,
        [...path, propertyName],
        uncertain || propertyName === undefined,
      );
    }
  };
  for (const { node: declaration, scope, kind } of declarations) {
    if (kind !== "const" || declaration.init === undefined) continue;
    recordImmutableProjectionPattern(
      declaration.id,
      declaration.init,
      scope,
    );
  }

  const requiredModuleName = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    if (!isNode(node) || node.type !== "CallExpression") return undefined;
    if (
      identifierName(node.callee) !== "require" || !isUnbound(scope, "require")
    ) {
      return undefined;
    }
    const args = Array.isArray(node.arguments) ? node.arguments : [];
    const moduleName = evaluateString(args[0], scope);
    return moduleName === undefined ? undefined : resolveModuleName(moduleName);
  };

  const rawImportedModuleNames = new WeakMap<AstNode, string | undefined>();
  const rawImportedModuleName = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    const unwrapped = unwrapTransparentExpression(node);
    if (!isNode(unwrapped)) return undefined;
    if (rawImportedModuleNames.has(unwrapped)) {
      return rawImportedModuleNames.get(unwrapped);
    }
    let resolved: string | undefined;
    if (unwrapped.type === "ImportExpression") {
      const moduleName = evaluateString(unwrapped.source, scope);
      resolved = moduleName === undefined
        ? undefined
        : resolveModuleName(moduleName);
    } else if (
      unwrapped.type === "CallExpression" && isNode(unwrapped.callee) &&
      unwrapped.callee.type === "Import"
    ) {
      const args = Array.isArray(unwrapped.arguments)
        ? unwrapped.arguments
        : [];
      const moduleName = evaluateString(args[0], scope);
      resolved = moduleName === undefined
        ? undefined
        : resolveModuleName(moduleName);
    }
    rawImportedModuleNames.set(unwrapped, resolved);
    return resolved;
  };

  const arrayInvocationArguments = (
    node: unknown,
  ): { values: unknown[]; known: boolean } => {
    const value = unwrapAwait(node);
    if (!isNode(value) || value.type !== "ArrayExpression") {
      return {
        values: value === undefined ? [] : [value],
        known: false,
      };
    }
    const elements = Array.isArray(value.elements) ? value.elements : [];
    return {
      values: elements.map((element) =>
        isNode(element) && element.type === "SpreadElement"
          ? element.argument
          : element
      ),
      known: elements.every((element) =>
        !isNode(element) || element.type !== "SpreadElement"
      ),
    };
  };

  const normalizeInvocation = (
    node: AstNode,
    scope: LexicalScope,
  ): NormalizedInvocation => {
    const rawArguments = Array.isArray(node.arguments) ? node.arguments : [];
    if (node.type === "NewExpression") {
      return {
        target: node.callee,
        arguments: rawArguments,
        capabilityInputs: [],
        kind: "construct",
        argumentsKnown: rawArguments.every((argument) =>
          !isNode(argument) || argument.type !== "SpreadElement"
        ),
      };
    }
    if (
      !isNode(node.callee) ||
      (node.callee.type !== "MemberExpression" &&
        node.callee.type !== "OptionalMemberExpression")
    ) {
      return {
        target: node.callee,
        arguments: rawArguments,
        capabilityInputs: [],
        kind: "direct",
        argumentsKnown: rawArguments.every((argument) =>
          !isNode(argument) || argument.type !== "SpreadElement"
        ),
      };
    }
    const method = resolvedMemberProperty(node.callee, scope);
    const isReflectInvocation =
      identifierName(node.callee.object) === "Reflect" &&
      isUnbound(scope, "Reflect");
    if (
      isReflectInvocation && (method === "apply" || method === "construct")
    ) {
      const forwarded = arrayInvocationArguments(
        method === "apply" ? rawArguments[2] : rawArguments[1],
      );
      return {
        target: rawArguments[0],
        arguments: forwarded.values,
        capabilityInputs: [
          method === "apply" ? rawArguments[1] : rawArguments[2],
        ].filter((value) => value !== undefined),
        kind: method,
        argumentsKnown: forwarded.known,
      };
    }
    if (method === "call") {
      const effectiveArguments = rawArguments.slice(1);
      return {
        target: node.callee.object,
        arguments: effectiveArguments,
        capabilityInputs: rawArguments[0] === undefined
          ? []
          : [rawArguments[0]],
        kind: "call",
        argumentsKnown: effectiveArguments.every((argument) =>
          !isNode(argument) || argument.type !== "SpreadElement"
        ),
      };
    }
    if (method === "apply") {
      const forwarded = arrayInvocationArguments(rawArguments[1]);
      return {
        target: node.callee.object,
        arguments: forwarded.values,
        capabilityInputs: rawArguments[0] === undefined
          ? []
          : [rawArguments[0]],
        kind: "apply",
        argumentsKnown: forwarded.known,
      };
    }
    return {
      target: node.callee,
      arguments: rawArguments,
      capabilityInputs: [],
      kind: "direct",
      argumentsKnown: rawArguments.every((argument) =>
        !isNode(argument) || argument.type !== "SpreadElement"
      ),
    };
  };

  const isRawDynamicImport = (node: unknown): boolean => {
    const unwrapped = unwrapTransparentExpression(node);
    return isNode(unwrapped) &&
      (unwrapped.type === "ImportExpression" ||
        (unwrapped.type === "CallExpression" && isNode(unwrapped.callee) &&
          unwrapped.callee.type === "Import"));
  };

  const promiseAllInputs = (
    node: unknown,
    scope: LexicalScope,
  ): unknown[] | undefined => {
    const unwrapped = unwrapTransparentExpression(node);
    if (
      !isNode(unwrapped) || unwrapped.type !== "CallExpression" ||
      !isNode(unwrapped.callee) ||
      unwrapped.callee.type !== "MemberExpression" ||
      identifierName(unwrapped.callee.object) !== "Promise" ||
      !isUnbound(scope, "Promise") ||
      resolvedMemberProperty(unwrapped.callee, scope) !== "all"
    ) return undefined;
    const args = Array.isArray(unwrapped.arguments) ? unwrapped.arguments : [];
    const input = unwrapTransparentExpression(args[0]);
    if (!isNode(input) || input.type !== "ArrayExpression") return undefined;
    const elements = Array.isArray(input.elements) ? input.elements : [];
    if (
      elements.some((element) =>
        isNode(element) && element.type === "SpreadElement"
      )
    ) return undefined;
    return elements;
  };

  const isPromiseAll = (
    node: unknown,
    scope: LexicalScope,
  ): boolean => {
    const unwrapped = unwrapTransparentExpression(node);
    if (!isNode(unwrapped) || unwrapped.type !== "CallExpression") {
      return false;
    }
    if (!isNode(unwrapped.callee)) return false;
    return unwrapped.callee.type === "MemberExpression" &&
      identifierName(unwrapped.callee.object) === "Promise" &&
      isUnbound(scope, "Promise") &&
      resolvedMemberProperty(unwrapped.callee, scope) === "all";
  };

  const promiseOriginsForExpression = (
    node: unknown,
    scope: LexicalScope,
  ): PromiseOrigins => {
    const unwrapped = unwrapTransparentExpression(node);
    if (!isNode(unwrapped)) return UNKNOWN_PROMISE_ORIGINS;
    if (isRawDynamicImport(unwrapped) || isPromiseAll(unwrapped, scope)) {
      return {
        origins: PrefixSnapshotSet.from([unwrapped]),
        unknown: false,
      };
    }
    if (unwrapped.type === "SequenceExpression") {
      const expressions = Array.isArray(unwrapped.expressions)
        ? unwrapped.expressions
        : [];
      return promiseOriginsForExpression(expressions.at(-1), scope);
    }
    if (unwrapped.type === "AssignmentExpression") {
      if (unwrapped.operator === "=") {
        return promiseOriginsForExpression(unwrapped.right, scope);
      }
      if (["&&=", "||=", "??="].includes(unwrapped.operator as string)) {
        return withUnknownPromiseOrigins(joinPromiseOrigins(
          promiseOriginsForExpression(unwrapped.left, scope),
          promiseOriginsForExpression(unwrapped.right, scope),
          analysisDiagnostics,
        ));
      }
      return UNKNOWN_PROMISE_ORIGINS;
    }
    if (
      unwrapped.type === "ConditionalExpression" ||
      unwrapped.type === "LogicalExpression"
    ) {
      const branches = unwrapped.type === "ConditionalExpression"
        ? [unwrapped.consequent, unwrapped.alternate]
        : [unwrapped.left, unwrapped.right];
      return branches.reduce<PromiseOrigins>(
        (origins, branch) =>
          joinPromiseOrigins(
            origins,
            promiseOriginsForExpression(branch, scope),
            analysisDiagnostics,
          ),
        NO_PROMISE_ORIGINS,
      );
    }
    const name = identifierName(unwrapped);
    if (name) {
      return readValueBinding(scope, name)?.promise ??
        (isUnbound(scope, name) ? UNKNOWN_PROMISE_ORIGINS : NO_PROMISE_ORIGINS);
    }
    if (
      unwrapped.type === "MemberExpression" ||
      unwrapped.type === "OptionalMemberExpression"
    ) {
      const property = resolvedMemberProperty(unwrapped, scope);
      const owner = valueFactsForExpression(unwrapped.object, scope);
      return (property === undefined
        ? projectedUnknownPropertyValueFacts(owner)
        : projectedValueFacts(owner, property)).promise;
    }
    return UNKNOWN_PROMISE_ORIGINS;
  };

  const awaitedApiForPromiseOrigins = (
    origins: PromiseOrigins,
  ): ApiBinding | undefined => {
    let result: ApiBinding | undefined;
    let sawNonApiResult = origins.unknown;
    for (const origin of origins.origins) {
      const originScope = scopeByNode.get(origin);
      if (!originScope) {
        sawNonApiResult = true;
        continue;
      }
      if (isRawDynamicImport(origin)) {
        const moduleName = rawImportedModuleName(origin, originScope);
        const api = moduleName === "node:module"
          ? "node-module-namespace" as const
          : moduleName === "node:worker_threads"
          ? "worker-threads-namespace" as const
          : moduleName === "node:vm"
          ? "node-vm-namespace" as const
          : undefined;
        if (api) result = joinApiBinding(result, api);
        else sawNonApiResult = true;
      } else {
        sawNonApiResult = true;
      }
    }
    return result && sawNonApiResult ? uncertainAlias(result) : result;
  };

  const awaitedApiForPromiseExpression = (
    node: unknown,
    scope: LexicalScope,
  ): ApiBinding | undefined =>
    awaitedApiForPromiseOrigins(promiseOriginsForExpression(node, scope));

  const freshFunctionConstructorApi = (
    node: unknown,
  ): ApiBinding | undefined => {
    const value = unwrapTransparentExpression(node);
    if (
      !isNode(value) ||
      (value.type !== "FunctionExpression" &&
        value.type !== "ArrowFunctionExpression" &&
        value.type !== "FunctionDeclaration")
    ) {
      return undefined;
    }
    if (value.async === true && value.generator === true) {
      return "AsyncGeneratorFunction";
    }
    if (value.async === true) return "AsyncFunction";
    if (value.generator === true) return "GeneratorFunction";
    return "Function";
  };

  const immutableFreshFunctionConstructorApi = (
    node: unknown,
    scope: LexicalScope,
    useSite: AstNode,
    seen = new Set<AstNode>(),
  ): ApiBinding | undefined => {
    const value = unwrapTransparentExpression(node);
    const direct = freshFunctionConstructorApi(value);
    if (direct) return direct;
    if (!isNode(value) || seen.has(value)) return undefined;
    seen.add(value);
    const name = identifierName(value);
    if (name) {
      const bindingScope = closestBindingScope(scope, name);
      if (
        !bindingScope ||
        hasDefiniteMutationBefore(
          memberMutationSites,
          bindingScope,
          name,
          useSite,
        ) ||
        hasDefiniteMutationBefore(
          bindingReassignmentSites,
          bindingScope,
          name,
          useSite,
        )
      ) {
        return undefined;
      }
      const initializer = getScopedValue(
        immutableFunctionInitializers,
        scope,
        name,
      );
      return initializer
        ? immutableFreshFunctionConstructorApi(
          initializer.value,
          initializer.scope,
          useSite,
          seen,
        )
        : undefined;
    }
    if (value.type === "SequenceExpression") {
      const expressions = Array.isArray(value.expressions)
        ? value.expressions
        : [];
      return immutableFreshFunctionConstructorApi(
        expressions.at(-1),
        scope,
        useSite,
        seen,
      );
    }
    if (value.type === "ConditionalExpression") {
      const consequent = immutableFreshFunctionConstructorApi(
        value.consequent,
        scope,
        useSite,
        new Set(seen),
      );
      const alternate = immutableFreshFunctionConstructorApi(
        value.alternate,
        scope,
        useSite,
        new Set(seen),
      );
      return consequent === alternate ? consequent : undefined;
    }
    return undefined;
  };

  const derivedFunctionConstructorApi = (
    node: AstNode,
    scope: LexicalScope,
  ): ApiBinding | undefined => {
    if (
      node.type !== "MemberExpression" &&
      node.type !== "OptionalMemberExpression"
    ) {
      return undefined;
    }
    if (resolvedMemberProperty(node, scope) !== "constructor") {
      return undefined;
    }
    const direct = immutableFreshFunctionConstructorApi(
      node.object,
      scope,
      node,
    );
    if (direct) return direct;
    const owner = unwrapTransparentExpression(node.object);
    if (
      !isNode(owner) || owner.type !== "CallExpression" ||
      !isNode(owner.callee) ||
      (owner.callee.type !== "MemberExpression" &&
        owner.callee.type !== "OptionalMemberExpression") ||
      resolvedMemberProperty(owner.callee, scope) !== "getPrototypeOf"
    ) {
      return undefined;
    }
    const intrinsic = identifierName(owner.callee.object);
    if (
      (intrinsic !== "Object" && intrinsic !== "Reflect") ||
      !isUnbound(scope, intrinsic)
    ) {
      return undefined;
    }
    const args = Array.isArray(owner.arguments) ? owner.arguments : [];
    if (args.length !== 1) return undefined;
    return immutableFreshFunctionConstructorApi(args[0], scope, node);
  };

  interface InheritedMemberReference {
    snapshot: InheritedMemberApiSnapshot;
    path: readonly (string | undefined)[];
    uncertain: boolean;
    indeterminate: boolean;
  }

  const inheritedMemberReferenceForExpression = (
    node: unknown,
    scope: LexicalScope,
    seen = new Set<ImmutableProjectionInitializer>(),
  ): InheritedMemberReference | undefined => {
    if (!inheritedScope || inheritedMemberApis.size === 0) return undefined;
    const value = unwrapTransparentExpression(node);
    if (!isNode(value)) return undefined;
    if (
      value.type === "MemberExpression" ||
      value.type === "OptionalMemberExpression"
    ) {
      const owner = inheritedMemberReferenceForExpression(
        value.object,
        scope,
        seen,
      );
      if (!owner) return undefined;
      const property = resolvedMemberProperty(value, scope);
      return {
        ...owner,
        path: [...owner.path, property],
        uncertain: owner.uncertain || property === undefined,
      };
    }
    const name = identifierName(value);
    if (name) {
      const bindingScope = closestBindingScope(scope, name);
      if (!bindingScope) return undefined;
      if (bindingScope === inheritedScope) {
        const snapshot = inheritedMemberApis.get(name);
        return snapshot
          ? {
            snapshot,
            path: [],
            uncertain: mutatedMemberBindings.get(bindingScope)?.has(name) ===
              true,
            indeterminate: false,
          }
          : undefined;
      }
      const initializer = getScopedValue(
        immutableProjectionInitializers,
        scope,
        name,
      );
      if (!initializer || seen.has(initializer)) return undefined;
      const nextSeen = new Set(seen);
      nextSeen.add(initializer);
      const source = inheritedMemberReferenceForExpression(
        initializer.source,
        initializer.scope,
        nextSeen,
      );
      return source
        ? {
          ...source,
          path: [...source.path, ...initializer.path],
          uncertain: source.uncertain || initializer.uncertain ||
            mutatedMemberBindings.get(bindingScope)?.has(name) === true,
        }
        : undefined;
    }
    if (value.type === "SequenceExpression") {
      const expressions = Array.isArray(value.expressions)
        ? value.expressions
        : [];
      return inheritedMemberReferenceForExpression(
        expressions.at(-1),
        scope,
        seen,
      );
    }
    if (value.type === "AssignmentExpression" && value.operator === "=") {
      const assigned = inheritedMemberReferenceForExpression(
        value.right,
        scope,
        seen,
      );
      return assigned ? { ...assigned, uncertain: true } : undefined;
    }
    if (
      value.type !== "ConditionalExpression" &&
      value.type !== "LogicalExpression"
    ) {
      return undefined;
    }
    const branches = value.type === "ConditionalExpression"
      ? [value.consequent, value.alternate]
      : [value.left, value.right];
    const references = branches.map((branch) =>
      inheritedMemberReferenceForExpression(branch, scope, new Set(seen))
    );
    const present = references.filter((reference) => reference !== undefined);
    if (present.length === 0) return undefined;
    const first = present[0]!;
    const samePath = present.every((reference) =>
      reference!.snapshot === first.snapshot &&
      reference!.path.length === first.path.length &&
      reference!.path.every((segment, index) => segment === first.path[index])
    );
    return {
      ...first,
      uncertain: true,
      indeterminate: first.indeterminate || !samePath ||
        present.length !== references.length,
    };
  };

  const inheritedMemberApiForExpression = (
    node: unknown,
    scope: LexicalScope,
    includeDescendants = false,
  ): ApiBinding | undefined => {
    const reference = inheritedMemberReferenceForExpression(node, scope);
    if (!reference) return undefined;
    const { snapshot, path } = reference;
    if (snapshot.truncated || reference.indeterminate) {
      return "uncertain-runtime-loader";
    }
    let result: ApiBinding | undefined;
    let uncertain = reference.uncertain;
    for (const projection of snapshot.projections) {
      if (
        projection.path.length !== path.length &&
        (!includeDescendants || projection.path.length <= path.length)
      ) {
        continue;
      }
      let matches = true;
      let exact = true;
      for (let index = 0; index < path.length; index++) {
        const expected = projection.path[index];
        const actual = path[index];
        if (expected !== undefined && actual !== undefined) {
          if (expected !== actual) {
            matches = false;
            break;
          }
        } else {
          exact = false;
        }
      }
      if (!matches) continue;
      result = joinApiBinding(result, projection.api);
      if (!exact || projection.path.length > path.length) uncertain = true;
    }
    return result && uncertain ? uncertainAlias(result) : result;
  };

  function apiForExpression(
    node: unknown,
    scope: LexicalScope,
    precomputedMemberOwner?: ValueFacts,
  ): ApiBinding | undefined {
    const unwrapped = unwrapTransparentExpression(node);
    if (!isNode(unwrapped)) return undefined;
    const inheritedMemberApi = inheritedMemberApiForExpression(
      unwrapped,
      scope,
    );
    if (inheritedMemberApi) return inheritedMemberApi;
    const derivedFunctionConstructor = derivedFunctionConstructorApi(
      unwrapped,
      scope,
    );
    if (derivedFunctionConstructor) return derivedFunctionConstructor;
    if (unwrapped.type === "AwaitExpression") {
      return awaitedApiForPromiseExpression(unwrapped.argument, scope) ??
        apiForExpression(unwrapped.argument, scope);
    }
    if (unwrapped.type === "SequenceExpression") {
      const expressions = Array.isArray(unwrapped.expressions)
        ? unwrapped.expressions
        : [];
      return apiForExpression(expressions.at(-1), scope);
    }
    if (
      unwrapped.type === "AssignmentExpression" && unwrapped.operator === "="
    ) {
      const assignedApi = apiForExpression(unwrapped.right, scope);
      return assignedApi ? uncertainAlias(assignedApi) : undefined;
    }
    if (isImportMeta(unwrapped)) return "import-meta-namespace";
    const loadedModule = requiredModuleName(unwrapped, scope);
    if (loadedModule === "node:module") return "node-module-namespace";
    if (loadedModule === "node:worker_threads") {
      return "worker-threads-namespace";
    }
    if (loadedModule === "node:vm") return "node-vm-namespace";
    if (
      unwrapped.type === "ObjectExpression" ||
      unwrapped.type === "ArrayExpression"
    ) {
      const values = unwrapped.type === "ObjectExpression"
        ? (Array.isArray(unwrapped.properties)
          ? unwrapped.properties.flatMap((property) =>
            isNode(property) && property.type === "ObjectProperty"
              ? [property.value]
              : []
          )
          : [])
        : (Array.isArray(unwrapped.elements) ? unwrapped.elements : []);
      if (
        values.some((value) => apiForExpression(value, scope) !== undefined)
      ) {
        return "uncertain-runtime-loader";
      }
    }
    if (
      unwrapped.type === "CallExpression" ||
      unwrapped.type === "OptionalCallExpression"
    ) {
      const invocation = normalizeInvocation(unwrapped, scope);
      const invoked = unwrapAwait(invocation.target);
      if (
        isNode(invoked) &&
        (invoked.type === "ArrowFunctionExpression" ||
          invoked.type === "FunctionExpression")
      ) {
        const returnValues = isNode(invoked.body) &&
            invoked.body.type !== "BlockStatement"
          ? [{
            value: invoked.body,
            scope: scopeByNode.get(invoked.body) ?? scope,
          }]
          : returnValuesByFunction.get(invoked) ?? [];
        let returnedApi: ApiBinding | undefined;
        for (const returned of returnValues) {
          const api = apiForExpression(returned.value, returned.scope);
          if (api) returnedApi = joinApiBinding(returnedApi, api);
        }
        if (returnedApi) return uncertainAlias(returnedApi);
      }
      if (
        apiForExpression(invocation.target, scope) === "create-require"
      ) {
        return "require";
      }
      if (
        isNode(unwrapped.callee) &&
        (unwrapped.callee.type === "MemberExpression" ||
          unwrapped.callee.type === "OptionalMemberExpression") &&
        resolvedMemberProperty(unwrapped.callee, scope) === "bind"
      ) {
        const owner = apiForExpression(unwrapped.callee.object, scope);
        return owner ? uncertainAlias(owner) : undefined;
      }
      return undefined;
    }
    if (
      unwrapped.type === "ConditionalExpression" ||
      unwrapped.type === "LogicalExpression"
    ) {
      const branches = unwrapped.type === "ConditionalExpression"
        ? [unwrapped.consequent, unwrapped.alternate]
        : [unwrapped.left, unwrapped.right];
      const branchApis = branches.map((branch) =>
        apiForExpression(branch, scope)
      );
      if (
        branchApis.some((api) =>
          api === "require" || api === "require-alias" ||
          api === "require-resolve" ||
          api === "create-require"
        )
      ) return "require-alias";
      return branchApis.some((api) => api !== undefined)
        ? "uncertain-runtime-loader"
        : undefined;
    }
    const name = identifierName(unwrapped);
    if (name) {
      const bound = readValueBinding(scope, name)?.api;
      if (bound) return bound;
      if (!isUnbound(scope, name)) return undefined;
      if (name === "require") return "require-alias";
      if (name === "Function") return "Function";
      if (name === "eval") return "eval";
      if (name === "setTimeout") return "set-timeout";
      if (name === "setInterval") return "set-interval";
      if (name === "Worker") return "web-worker";
      if (name === "SharedWorker") return "shared-worker";
      if (name === "importScripts") return "import-scripts";
      if (name === "module") return "node-module-namespace";
      if (name === "navigator") return "navigator-namespace";
      if (["globalThis", "window", "self"].includes(name)) {
        return "global-namespace";
      }
      if (name === "CSS") return "css-namespace";
      if (name === "audioWorklet") return "audio-worklet";
      return undefined;
    }
    if (
      unwrapped.type !== "MemberExpression" &&
      unwrapped.type !== "OptionalMemberExpression"
    ) {
      return undefined;
    }
    const property = resolvedMemberProperty(unwrapped, scope);
    if (isImportMeta(unwrapped.object) && property === "resolve") {
      return "import-meta-resolve";
    }
    if (isUnboundGlobalObject(unwrapped.object, scope)) {
      if (property === "Function") return "Function";
      if (property === "eval") return "eval";
      if (property === "setTimeout") return "set-timeout";
      if (property === "setInterval") return "set-interval";
      if (property === "Worker") return "web-worker";
      if (property === "SharedWorker") return "shared-worker";
      if (property === "importScripts") return "import-scripts";
    }
    const serviceWorkerObject = isNode(unwrapped.object) &&
      (unwrapped.object.type === "MemberExpression" ||
        unwrapped.object.type === "OptionalMemberExpression") &&
      resolvedMemberProperty(unwrapped.object, scope) === "serviceWorker" &&
      isGlobalNavigator(unwrapped.object.object, scope);
    if (property === "register" && serviceWorkerObject) {
      return "service-worker-register";
    }
    if (property === "audioWorklet") return "audio-worklet";
    const ownerFacts = precomputedMemberOwner ??
      valueFactsForExpression(unwrapped.object, scope);
    if (property === undefined && ownerFacts.containers.size === 0) {
      return undefined;
    }
    const projected = flowValueFactsByNode.get(unwrapped) ??
      (property === undefined
        ? projectedUnknownPropertyValueFacts(ownerFacts)
        : projectedValueFacts(ownerFacts, property));
    return projected.api ?? memberApi(ownerFacts.api, property);
  }

  const NO_VALUE_CONTAINERS = PrefixSnapshotSet.from<ValueContainerIdentity>(
    [],
  );
  // A bound value whose provenance has not reached this fixed-point pass yet.
  // Unlike EMPTY_VALUE_FACTS, this is lattice bottom rather than a concrete
  // capability-free/falsey alternative, so joining it must preserve identity.
  const BOTTOM_VALUE_FACTS: ValueFacts = {
    promise: NO_PROMISE_ORIGINS,
    containers: NO_VALUE_CONTAINERS,
    unknown: false,
    definitelyTruthy: false,
    definitelyNonNullish: false,
  };
  const EMPTY_VALUE_FACTS: ValueFacts = {
    promise: NO_PROMISE_ORIGINS,
    containers: NO_VALUE_CONTAINERS,
    unknown: false,
    definitelyTruthy: false,
    definitelyNonNullish: false,
  };
  const UNKNOWN_VALUE_FACTS: ValueFacts = {
    promise: UNKNOWN_PROMISE_ORIGINS,
    containers: NO_VALUE_CONTAINERS,
    unknown: true,
    definitelyTruthy: false,
    definitelyNonNullish: false,
  };

  const apiIsDefinitelyTruthy = (api: ApiBinding): boolean =>
    api !== "require-alias" && api !== "uncertain-runtime-loader";

  const valueFactsForApi = (api: ApiBinding): ValueFacts => ({
    api,
    promise: NO_PROMISE_ORIGINS,
    containers: NO_VALUE_CONTAINERS,
    unknown: false,
    definitelyTruthy: apiIsDefinitelyTruthy(api),
    definitelyNonNullish: apiIsDefinitelyTruthy(api),
  });

  const withUnknownValueFacts = (facts: ValueFacts): ValueFacts => {
    const api = facts.api === undefined ? undefined : uncertainAlias(facts.api);
    const promise = withUnknownPromiseOrigins(facts.promise);
    if (
      facts.unknown && api === facts.api && promise === facts.promise &&
      !facts.definitelyTruthy && !facts.definitelyNonNullish
    ) {
      return facts;
    }
    return {
      ...facts,
      api,
      promise,
      unknown: true,
      definitelyTruthy: false,
      definitelyNonNullish: false,
    };
  };

  const joinValueFacts = (
    current: ValueFacts | undefined,
    incoming: ValueFacts,
  ): ValueFacts => {
    if (current === undefined) {
      return incoming.unknown ? withUnknownValueFacts(incoming) : incoming;
    }
    if (current === BOTTOM_VALUE_FACTS) return incoming;
    if (incoming === BOTTOM_VALUE_FACTS) return current;
    if (current === incoming) return current;
    let api = current.api;
    if (incoming.api !== undefined) api = joinApiBinding(api, incoming.api);
    const promise = joinPromiseOrigins(
      current.promise,
      incoming.promise,
      analysisDiagnostics,
    );
    const containers = current.containers.mergedWith(
      incoming.containers,
      analysisDiagnostics,
    );
    const unknown = current.unknown || incoming.unknown;
    const definitelyTruthy = current.definitelyTruthy &&
      incoming.definitelyTruthy;
    const definitelyNonNullish = current.definitelyNonNullish &&
      incoming.definitelyNonNullish;
    let result = api === current.api && promise === current.promise &&
        containers === current.containers && unknown === current.unknown &&
        definitelyTruthy === current.definitelyTruthy &&
        definitelyNonNullish === current.definitelyNonNullish
      ? current
      : {
        api,
        promise,
        containers,
        unknown,
        definitelyTruthy,
        definitelyNonNullish,
      };
    if (unknown) result = withUnknownValueFacts(result);
    return result;
  };

  const setScopedValueFacts = (
    scope: LexicalScope,
    name: string,
    incoming: ValueFacts,
  ): boolean => {
    if (
      incoming.api === undefined && !hasPromiseOrigins(incoming.promise) &&
      incoming.containers.size === 0 && !incoming.unknown
    ) return false;
    const current = getScopedValue(valueBindings, scope, name);
    const joined = joinValueFacts(current, incoming);
    if (joined === current) return false;
    const changed = setScopedValue(valueBindings, scope, name, joined);
    if (changed) {
      notifyBindingDependency(
        scopedBindingDependency(
          valueBindingDependencies,
          "value",
          scope,
          name,
        ),
      );
    }
    return changed;
  };

  const containerIdentityFor = (
    site: AstNode,
    kind: ValueContainerKind,
  ): ValueContainerIdentity => {
    let identity = valueContainerIdentities.get(site);
    if (!identity) {
      identity = { site, kind };
      valueContainerIdentities.set(site, identity);
    }
    return identity;
  };

  const joinContainerFacts = (
    current: ValueContainerFacts | undefined,
    incoming: ValueContainerFacts,
  ): { facts: ValueContainerFacts; changed: boolean } => {
    if (!current) {
      analysisDiagnostics.containerMapEntryCopies += incoming.members.size;
      return {
        facts: {
          members: new Map(incoming.members),
          wildcard: incoming.wildcard,
        },
        changed: true,
      };
    }
    let changed = false;
    for (const [key, incomingMember] of incoming.members) {
      analysisDiagnostics.containerMemberJoins++;
      const currentMember = current.members.get(key);
      const joined = joinValueFacts(currentMember, incomingMember);
      if (joined !== currentMember) {
        current.members.set(key, joined);
        changed = true;
      }
    }
    if (incoming.wildcard !== undefined) {
      const wildcard = joinValueFacts(current.wildcard, incoming.wildcard);
      if (wildcard !== current.wildcard) {
        current.wildcard = wildcard;
        changed = true;
      }
    }
    return { facts: current, changed };
  };

  const initializeContainerFacts = (
    identity: ValueContainerIdentity,
    facts: ValueContainerFacts,
  ): void => {
    const constructed = joinContainerFacts(
      constructedValueContainerFacts.get(identity),
      facts,
    );
    constructedValueContainerFacts.set(identity, constructed.facts);
    const current = valueContainerFacts.get(identity);
    const joined = joinContainerFacts(current, facts);
    if (joined.changed) {
      valueContainerFacts.set(identity, joined.facts);
      valueContainerVersions.set(
        identity,
        (valueContainerVersions.get(identity) ?? 0) + 1,
      );
      notifyBindingDependency(containerDependency(identity));
    }
  };

  const valueFactsReferencingContainer = (
    identity: ValueContainerIdentity,
    facts: ValueContainerFacts,
  ): ValueFacts => ({
    promise: NO_PROMISE_ORIGINS,
    containers: PrefixSnapshotSet.from([identity]),
    unknown: facts.wildcard !== undefined,
    definitelyTruthy: true,
    definitelyNonNullish: true,
  });

  const writeContainerFacts = (
    identity: ValueContainerIdentity,
    facts: ValueContainerFacts,
  ): boolean => {
    const current = valueContainerFacts.get(identity);
    const joined = joinContainerFacts(current, facts);
    if (!joined.changed) return false;
    valueContainerFacts.set(identity, joined.facts);
    valueContainerVersions.set(
      identity,
      (valueContainerVersions.get(identity) ?? 0) + 1,
    );
    notifyBindingDependency(containerDependency(identity));
    return true;
  };

  const valueFactsForContainer = (
    site: AstNode,
    kind: ValueContainerKind,
    facts: ValueContainerFacts,
  ): ValueFacts => {
    const identity = containerIdentityFor(site, kind);
    initializeContainerFacts(identity, facts);
    return valueFactsReferencingContainer(identity, facts);
  };

  const projectedValueFacts = (
    facts: ValueFacts,
    property: string,
  ): ValueFacts => {
    let projected: ValueFacts | undefined;
    let missing = facts.unknown;
    let unresolvedContainer = false;
    for (const identity of facts.containers) {
      const container = readContainerFacts(identity);
      if (!container) {
        missing = true;
        unresolvedContainer = true;
        continue;
      }
      const member = container.members.get(property);
      if (member) projected = joinValueFacts(projected, member);
      else missing = true;
      if (container.wildcard) {
        projected = joinValueFacts(projected, container.wildcard);
      }
    }
    const projectedApi = memberApi(facts.api, property);
    if (projectedApi !== undefined) {
      projected = joinValueFacts(projected, valueFactsForApi(projectedApi));
    }
    if (projected === undefined) {
      return facts.api !== undefined || facts.unknown || unresolvedContainer
        ? UNKNOWN_VALUE_FACTS
        : EMPTY_VALUE_FACTS;
    }
    return missing ? withUnknownValueFacts(projected) : projected;
  };

  const projectedUnknownPropertyValueFacts = (
    facts: ValueFacts,
  ): ValueFacts => {
    let projected: ValueFacts | undefined;
    for (const identity of facts.containers) {
      const container = readContainerFacts(identity);
      if (!container) continue;
      for (const member of container.members.values()) {
        projected = joinValueFacts(projected, member);
      }
      if (container.wildcard) {
        projected = joinValueFacts(projected, container.wildcard);
      }
    }
    if (facts.api !== undefined) {
      projected = joinValueFacts(
        projected,
        valueFactsForApi(uncertainAlias(facts.api)),
      );
    }
    if (projected) return withUnknownValueFacts(projected);
    return facts.containers.size > 0 || facts.api !== undefined || facts.unknown
      ? UNKNOWN_VALUE_FACTS
      : EMPTY_VALUE_FACTS;
  };

  const containerMembersForValueFacts = (
    facts: ValueFacts,
  ): { members: ReadonlyMap<string, ValueFacts>; unknown: boolean } => {
    const keys = new Set<string>();
    let unknown = facts.unknown;
    for (const identity of facts.containers) {
      const container = readContainerFacts(identity);
      if (!container) {
        unknown = true;
        continue;
      }
      for (const key of container.members.keys()) keys.add(key);
      if (container.wildcard) unknown = true;
    }
    const members = new Map<string, ValueFacts>();
    for (const key of keys) members.set(key, projectedValueFacts(facts, key));
    return { members, unknown };
  };

  const awaitedIterableFactsCache = new Map<
    ValueFacts,
    {
      versions: ReadonlyMap<ValueContainerIdentity, number>;
      facts: ValueContainerFacts;
    }
  >();

  function awaitedValueFacts(
    facts: ValueFacts,
  ): ValueFacts {
    const pendingOrigins: AstNode[] = [];
    const enqueuedOrigins = new Set<AstNode>();
    const awaitedShellCache = new Map<ValueFacts, ValueFacts>();

    const enqueueOrigin = (origin: AstNode): void => {
      if (enqueuedOrigins.has(origin)) return;
      enqueuedOrigins.add(origin);
      pendingOrigins.push(origin);
    };

    const awaitedShell = (input: ValueFacts): ValueFacts => {
      const cached = awaitedShellCache.get(input);
      if (cached) return cached;
      let result: ValueFacts | undefined;
      for (const origin of input.promise.origins) {
        analysisDiagnostics.awaitedPromiseOriginElementVisits++;
        const originScope = scopeByNode.get(origin);
        if (!originScope) {
          throw new Error("promise origin is missing its lexical scope");
        }
        if (isRawDynamicImport(origin)) {
          const moduleName = rawImportedModuleName(origin, originScope);
          const api = moduleName === "node:module"
            ? "node-module-namespace" as const
            : moduleName === "node:worker_threads"
            ? "worker-threads-namespace" as const
            : moduleName === "node:vm"
            ? "node-vm-namespace" as const
            : undefined;
          result = joinValueFacts(
            result,
            api === undefined ? UNKNOWN_VALUE_FACTS : valueFactsForApi(api),
          );
          continue;
        }
        if (!isPromiseAll(origin, originScope)) {
          throw new Error("unexpected promise provenance origin");
        }
        enqueueOrigin(origin);
        const identity = containerIdentityFor(origin, "promise-all-result");
        result = joinValueFacts(
          result,
          valueFactsReferencingContainer(identity, { members: new Map() }),
        );
      }
      if (input.promise.unknown || input.unknown) {
        result = joinValueFacts(result, UNKNOWN_VALUE_FACTS);
      }
      if (input.api !== undefined || input.containers.size > 0) {
        result = joinValueFacts(result, {
          api: input.api,
          promise: NO_PROMISE_ORIGINS,
          containers: input.containers,
          unknown: input.unknown,
          definitelyTruthy: input.definitelyTruthy,
          definitelyNonNullish: input.definitelyNonNullish,
        });
      }
      const awaited = result ?? EMPTY_VALUE_FACTS;
      awaitedShellCache.set(input, awaited);
      return awaited;
    };

    const awaitedIterableFacts = (input: ValueFacts): ValueContainerFacts => {
      const cached = awaitedIterableFactsCache.get(input);
      if (
        cached && cached.versions.size === input.containers.size &&
        [...input.containers].every((identity) =>
          cached.versions.get(identity) ===
            readContainerVersion(identity)
        )
      ) {
        return cached.facts;
      }

      const inputContainer = containerMembersForValueFacts(input);
      const members = new Map<string, ValueFacts>();
      for (const [key, member] of inputContainer.members) {
        analysisDiagnostics.awaitedIterableMemberVisits++;
        members.set(key, awaitedShell(member));
      }
      const resolved = {
        members,
        wildcard: inputContainer.unknown ? UNKNOWN_VALUE_FACTS : undefined,
      };
      awaitedIterableFactsCache.set(input, {
        versions: new Map(
          [...input.containers].map((identity) => [
            identity,
            readContainerVersion(identity),
          ]),
        ),
        facts: resolved,
      });
      return resolved;
    };

    const result = awaitedShell(facts);
    while (pendingOrigins.length > 0) {
      const origin = pendingOrigins.pop();
      if (!origin) break;
      const originScope = scopeByNode.get(origin);
      if (!originScope) {
        throw new Error("promise origin is missing its lexical scope");
      }
      if (!isPromiseAll(origin, originScope)) {
        throw new Error("unexpected promise provenance origin");
      }

      const members = new Map<string, ValueFacts>();
      const inputs = promiseAllInputs(origin, originScope);
      if (inputs) {
        inputs.forEach((input, index) => {
          members.set(
            String(index),
            awaitedShell(valueFactsForExpression(input, originScope)),
          );
        });
        valueFactsForContainer(origin, "promise-all-result", { members });
        continue;
      }

      const args = Array.isArray(origin.arguments) ? origin.arguments : [];
      const inputFacts = valueFactsForExpression(args[0], originScope);
      valueFactsForContainer(
        origin,
        "promise-all-result",
        awaitedIterableFacts(inputFacts),
      );
    }
    return result;
  }

  const logicalValueFacts = (
    operator: string,
    left: ValueFacts,
    right: ValueFacts,
  ): ValueFacts => {
    if (operator === "&&" || operator === "&&=") {
      return left.definitelyTruthy ? right : joinValueFacts(left, right);
    }
    if (
      operator === "||" || operator === "||=" || operator === "??" ||
      operator === "??="
    ) {
      const definitelyKeepsLeft = operator === "??" || operator === "??="
        ? left.definitelyNonNullish
        : left.definitelyTruthy;
      return definitelyKeepsLeft ? left : joinValueFacts(left, right);
    }
    return UNKNOWN_VALUE_FACTS;
  };

  function literalContainerFacts(
    expression: AstNode,
    scope: LexicalScope,
  ): ValueContainerFacts {
    const members = new Map<string, ValueFacts>();
    let wildcard: ValueFacts | undefined;
    const addWildcard = (facts: ValueFacts): void => {
      wildcard = joinValueFacts(wildcard, withUnknownValueFacts(facts));
    };
    if (expression.type === "ObjectExpression") {
      for (
        const property of Array.isArray(expression.properties)
          ? expression.properties
          : []
      ) {
        if (!isNode(property)) continue;
        if (property.type === "SpreadElement") {
          const spread = valueFactsForExpression(property.argument, scope);
          const spreadContainer = containerMembersForValueFacts(spread);
          for (const [key, member] of spreadContainer.members) {
            members.set(key, joinValueFacts(members.get(key), member));
          }
          if (spreadContainer.unknown) addWildcard(UNKNOWN_VALUE_FACTS);
          if (spread.api !== undefined) {
            addWildcard(projectedUnknownPropertyValueFacts(spread));
          }
          continue;
        }
        if (property.type !== "ObjectProperty") continue;
        const key = resolvedPropertyKey(property, scope);
        if (key === undefined) {
          addWildcard(valueFactsForExpression(property.value, scope));
          continue;
        }
        members.set(key, valueFactsForExpression(property.value, scope));
      }
    } else {
      const elements = Array.isArray(expression.elements)
        ? expression.elements
        : [];
      elements.forEach((element, index) => {
        if (isNode(element) && element.type === "SpreadElement") {
          addWildcard(
            iterableElementValueFacts(element.argument, scope, false),
          );
          return;
        }
        members.set(
          String(index),
          valueFactsForExpression(element, scope),
        );
      });
    }
    return {
      members,
      wildcard,
    };
  }

  function valueFactsForExpression(
    node: unknown,
    scope: LexicalScope,
  ): ValueFacts {
    const unwrapped = unwrapTransparentExpression(node);
    if (!isNode(unwrapped)) return UNKNOWN_VALUE_FACTS;
    if (unwrapped.type === "AwaitExpression") {
      return awaitedValueFacts(
        valueFactsForExpression(unwrapped.argument, scope),
      );
    }
    if (isRawDynamicImport(unwrapped) || isPromiseAll(unwrapped, scope)) {
      return {
        promise: {
          origins: PrefixSnapshotSet.from([unwrapped]),
          unknown: false,
        },
        containers: NO_VALUE_CONTAINERS,
        unknown: false,
        definitelyTruthy: true,
        definitelyNonNullish: true,
      };
    }
    if (unwrapped.type === "SequenceExpression") {
      const expressions = Array.isArray(unwrapped.expressions)
        ? unwrapped.expressions
        : [];
      return valueFactsForExpression(expressions.at(-1), scope);
    }
    if (unwrapped.type === "AssignmentExpression") {
      if (unwrapped.operator === "=") {
        return valueFactsForExpression(unwrapped.right, scope);
      }
      if (["&&=", "||=", "??="].includes(unwrapped.operator as string)) {
        return logicalValueFacts(
          unwrapped.operator as string,
          valueFactsForExpression(unwrapped.left, scope),
          valueFactsForExpression(unwrapped.right, scope),
        );
      }
      return UNKNOWN_VALUE_FACTS;
    }
    if (unwrapped.type === "ConditionalExpression") {
      return withUnknownValueFacts(joinValueFacts(
        valueFactsForExpression(unwrapped.consequent, scope),
        valueFactsForExpression(unwrapped.alternate, scope),
      ));
    }
    if (unwrapped.type === "LogicalExpression") {
      return logicalValueFacts(
        unwrapped.operator as string,
        valueFactsForExpression(unwrapped.left, scope),
        valueFactsForExpression(unwrapped.right, scope),
      );
    }
    if (
      unwrapped.type === "ObjectExpression" ||
      unwrapped.type === "ArrayExpression"
    ) {
      return valueFactsForContainer(
        unwrapped,
        unwrapped.type === "ObjectExpression"
          ? "object-literal"
          : "array-literal",
        literalContainerFacts(unwrapped, scope),
      );
    }

    const name = identifierName(unwrapped);
    if (name) {
      const result = readValueBinding(scope, name);
      if (result) return result;
      const api = apiForExpression(unwrapped, scope);
      if (api !== undefined) return valueFactsForApi(api);
      return isUnbound(scope, name) ? UNKNOWN_VALUE_FACTS : BOTTOM_VALUE_FACTS;
    }

    if (
      unwrapped.type === "MemberExpression" ||
      unwrapped.type === "OptionalMemberExpression"
    ) {
      const flowFacts = flowValueFactsByNode.get(unwrapped);
      if (flowFacts) return flowFacts;
      const property = resolvedMemberProperty(unwrapped, scope);
      const owner = valueFactsForExpression(unwrapped.object, scope);
      const api = apiForExpression(unwrapped, scope, owner);
      if (api !== undefined) return valueFactsForApi(api);
      return property === undefined
        ? projectedUnknownPropertyValueFacts(owner)
        : projectedValueFacts(owner, property);
    }

    const api = apiForExpression(unwrapped, scope);
    return api === undefined ? UNKNOWN_VALUE_FACTS : {
      api,
      promise: NO_PROMISE_ORIGINS,
      containers: NO_VALUE_CONTAINERS,
      unknown: false,
      definitelyTruthy: apiIsDefinitelyTruthy(api),
      definitelyNonNullish: apiIsDefinitelyTruthy(api),
    };
  }

  const iterableElementValueFacts = (
    iterable: unknown,
    scope: LexicalScope,
    awaitElements: boolean,
  ): ValueFacts => {
    const iterableFacts = valueFactsForExpression(iterable, scope);
    let result: ValueFacts | undefined;
    const iterableContainer = containerMembersForValueFacts(iterableFacts);
    for (const member of iterableContainer.members.values()) {
      result = joinValueFacts(
        result,
        awaitElements ? awaitedValueFacts(member) : member,
      );
    }
    if (iterableContainer.unknown) {
      result = joinValueFacts(result, UNKNOWN_VALUE_FACTS);
    }
    return result ??
      (iterableFacts.unknown ? UNKNOWN_VALUE_FACTS : EMPTY_VALUE_FACTS);
  };

  const capabilityInValueFactsGraph = (
    root: ValueFacts,
    options: {
      includeApi: (api: ApiBinding) => boolean;
      includePromises: boolean;
      forceUncertain?: boolean;
    },
  ): ApiBinding | undefined => {
    type CapabilityWorkItem =
      | {
        kind: "value";
        facts: ValueFacts;
        uncertain: boolean;
        promiseContext: boolean;
      }
      | {
        kind: "container";
        identity: ValueContainerIdentity;
        uncertain: boolean;
        promiseContext: boolean;
      }
      | {
        kind: "origin-set";
        origins: PromiseOrigins;
        uncertain: boolean;
      }
      | {
        kind: "origin";
        origin: AstNode;
        uncertain: boolean;
      };

    const worklist: CapabilityWorkItem[] = [{
      kind: "value",
      facts: root,
      uncertain: false,
      promiseContext: false,
    }];
    const visitedValues = Array.from(
      { length: 4 },
      () => new Set<ValueFacts>(),
    );
    const visitedContainers = Array.from(
      { length: 4 },
      () => new Set<ValueContainerIdentity>(),
    );
    const visitedContainerFacts = Array.from(
      { length: 4 },
      () => new Set<ValueContainerFacts>(),
    );
    const visitedOriginSets = [
      new Set<PromiseOrigins>(),
      new Set<PromiseOrigins>(),
    ];
    const visitedOrigins = [
      new Set<AstNode>(),
      new Set<AstNode>(),
    ];
    const promiseOriginApis = new Map<AstNode, ApiBinding | undefined>();
    const originSetSummaries = new Map<
      PromiseOrigins,
      {
        allRawImports: boolean;
        api?: ApiBinding;
        uncertain: boolean;
      }
    >();
    let result: ApiBinding | undefined;

    const recordCapability = (
      api: ApiBinding,
      uncertain: boolean,
    ): void => {
      result = joinApiBinding(
        result,
        uncertain || options.forceUncertain ? uncertainAlias(api) : api,
      );
    };

    const promiseOriginApi = (
      origin: AstNode,
      scope: LexicalScope,
    ): ApiBinding | undefined => {
      if (promiseOriginApis.has(origin)) return promiseOriginApis.get(origin);
      const moduleName = rawImportedModuleName(origin, scope);
      const api = moduleName === "node:module"
        ? "node-module-namespace"
        : moduleName === "node:worker_threads"
        ? "worker-threads-namespace"
        : moduleName === "node:vm"
        ? "node-vm-namespace"
        : undefined;
      promiseOriginApis.set(origin, api);
      return api;
    };

    const summarizeOriginSet = (
      origins: PromiseOrigins,
    ): {
      allRawImports: boolean;
      api?: ApiBinding;
      uncertain: boolean;
    } => {
      const cached = originSetSummaries.get(origins);
      if (cached) return cached;
      let api: ApiBinding | undefined;
      let allRawImports = true;
      let sawAbsentAlternative = origins.unknown;
      for (const origin of origins.origins) {
        const originScope = scopeByNode.get(origin);
        if (!originScope) {
          throw new Error("promise origin is missing its lexical scope");
        }
        if (!isRawDynamicImport(origin)) {
          allRawImports = false;
          continue;
        }
        const originApi = promiseOriginApi(origin, originScope);
        if (originApi === undefined) sawAbsentAlternative = true;
        else api = joinApiBinding(api, originApi);
      }
      const summary = {
        allRawImports,
        ...(api === undefined ? {} : { api }),
        uncertain: origins.unknown ||
          origins.origins.size > 1 &&
            (!allRawImports || sawAbsentAlternative),
      };
      originSetSummaries.set(origins, summary);
      return summary;
    };

    while (worklist.length > 0) {
      const entry = worklist.pop();
      if (!entry) break;

      if (entry.kind === "origin-set") {
        const summary = summarizeOriginSet(entry.origins);
        const uncertain = entry.uncertain || summary.uncertain;
        const visited = visitedOriginSets[uncertain ? 1 : 0];
        if (visited.has(entry.origins)) continue;
        visited.add(entry.origins);
        if (summary.allRawImports) {
          if (summary.api) recordCapability(summary.api, uncertain);
          continue;
        }
        for (const origin of entry.origins.origins) {
          worklist.push({ kind: "origin", origin, uncertain });
        }
        continue;
      }

      if (entry.kind === "origin") {
        const visited = visitedOrigins[entry.uncertain ? 1 : 0];
        if (visited.has(entry.origin)) continue;
        visited.add(entry.origin);
        const originScope = scopeByNode.get(entry.origin);
        if (!originScope) {
          throw new Error("promise origin is missing its lexical scope");
        }
        if (isRawDynamicImport(entry.origin)) {
          const api = promiseOriginApi(entry.origin, originScope);
          if (api) recordCapability(api, entry.uncertain);
          continue;
        }
        if (!isPromiseAll(entry.origin, originScope)) {
          throw new Error("unexpected promise provenance origin");
        }

        const inputs = promiseAllInputs(entry.origin, originScope);
        if (inputs) {
          for (const input of inputs) {
            worklist.push({
              kind: "value",
              facts: valueFactsForExpression(input, originScope),
              uncertain: entry.uncertain,
              promiseContext: true,
            });
          }
          continue;
        }

        const args = Array.isArray(entry.origin.arguments)
          ? entry.origin.arguments
          : [];
        const iterableFacts = valueFactsForExpression(args[0], originScope);
        const uncertain = entry.uncertain || iterableFacts.unknown;
        for (const identity of iterableFacts.containers) {
          worklist.push({
            kind: "container",
            identity,
            uncertain,
            promiseContext: true,
          });
        }
        continue;
      }

      if (entry.kind === "container") {
        const state = (entry.promiseContext ? 2 : 0) +
          (entry.uncertain ? 1 : 0);
        const visited = visitedContainers[state];
        if (visited.has(entry.identity)) continue;
        visited.add(entry.identity);
        const container = readContainerFacts(entry.identity);
        if (!container) {
          throw new Error("value container identity has no heap facts");
        }
        const visitedFacts = visitedContainerFacts[state];
        if (visitedFacts.has(container)) continue;
        visitedFacts.add(container);
        for (const member of container.members.values()) {
          worklist.push({
            kind: "value",
            facts: member,
            uncertain: entry.uncertain,
            promiseContext: entry.promiseContext,
          });
        }
        if (container.wildcard) {
          worklist.push({
            kind: "value",
            facts: container.wildcard,
            uncertain: true,
            promiseContext: entry.promiseContext,
          });
        }
        continue;
      }

      const uncertain = entry.uncertain || entry.facts.unknown;
      const state = (entry.promiseContext ? 2 : 0) + (uncertain ? 1 : 0);
      const visited = visitedValues[state];
      if (visited.has(entry.facts)) continue;
      visited.add(entry.facts);
      if (
        entry.facts.api &&
        (entry.promiseContext || options.includeApi(entry.facts.api))
      ) {
        recordCapability(entry.facts.api, uncertain);
      }
      if (options.includePromises && hasPromiseOrigins(entry.facts.promise)) {
        worklist.push({
          kind: "origin-set",
          origins: entry.facts.promise,
          uncertain,
        });
      }
      for (const identity of entry.facts.containers) {
        worklist.push({
          kind: "container",
          identity,
          uncertain,
          promiseContext: entry.promiseContext,
        });
      }
    }
    return result;
  };

  const capabilityForValueFacts = (
    facts: ValueFacts,
  ): ApiBinding | undefined =>
    capabilityInValueFactsGraph(facts, {
      includeApi: () => true,
      includePromises: true,
    });

  const valueFactsContainPromise = (
    facts: ValueFacts,
  ): boolean => {
    const worklist = [facts];
    const visited = new Set<ValueContainerIdentity>();
    while (worklist.length > 0) {
      const current = worklist.pop();
      if (!current) break;
      if (current.promise.origins.size > 0) return true;
      for (const identity of current.containers) {
        if (visited.has(identity)) continue;
        visited.add(identity);
        const container = readContainerFacts(identity);
        if (!container) continue;
        worklist.push(...container.members.values());
        if (container.wildcard) worklist.push(container.wildcard);
      }
    }
    return false;
  };

  const isModeledResolvedApiContainer = (facts: ValueFacts): boolean =>
    facts.containers.size > 0 && capabilityForValueFacts(facts) !== undefined &&
    !valueFactsContainPromise(facts);

  interface TargetTransferOptions {
    transformApi: (api: ApiBinding) => ApiBinding;
    allowTrustedMemberWrite?: boolean;
  }

  const restTargetValueFacts = (
    source: ValueFacts,
    rest: ValueFacts,
  ): ValueFacts => {
    if (source.api === undefined) return rest;
    return withUnknownValueFacts(
      joinValueFacts(rest, valueFactsForApi(source.api)),
    );
  };

  const transformValueFactApis = (
    facts: ValueFacts,
    transform: (api: ApiBinding) => ApiBinding,
  ): ValueFacts => {
    const api = facts.api === undefined ? undefined : transform(facts.api);
    const transformedApiIsDefinite = api === undefined ||
      apiIsDefinitelyTruthy(api);
    const definitelyTruthy = facts.definitelyTruthy &&
      transformedApiIsDefinite;
    const definitelyNonNullish = facts.definitelyNonNullish &&
      transformedApiIsDefinite;
    return api === facts.api &&
        definitelyTruthy === facts.definitelyTruthy &&
        definitelyNonNullish === facts.definitelyNonNullish
      ? facts
      : {
        ...facts,
        api,
        definitelyTruthy,
        definitelyNonNullish,
      };
  };

  const isResolvedContainerTree = (
    facts: ValueFacts,
    directApiAllowed = false,
  ): boolean => {
    const worklist: Array<{ facts: ValueFacts; directApiAllowed: boolean }> = [{
      facts,
      directApiAllowed,
    }];
    const visitedDisallowed = new Set<ValueContainerIdentity>();
    const visitedAllowed = new Set<ValueContainerIdentity>();
    while (worklist.length > 0) {
      const entry = worklist.pop();
      if (!entry) break;
      if (entry.facts.api !== undefined && !entry.directApiAllowed) {
        return false;
      }
      if (entry.facts.promise.origins.size > 0) return false;
      if (entry.facts.promise.unknown && !entry.directApiAllowed) return false;
      const visited = entry.directApiAllowed
        ? visitedAllowed
        : visitedDisallowed;
      for (const identity of entry.facts.containers) {
        if (visited.has(identity)) continue;
        visited.add(identity);
        const container = readContainerFacts(identity);
        if (!container) return false;
        const memberApiAllowed = identity.kind === "promise-all-result";
        for (const member of container.members.values()) {
          worklist.push({ facts: member, directApiAllowed: memberApiAllowed });
        }
        if (container.wildcard) {
          worklist.push({
            facts: container.wildcard,
            directApiAllowed: memberApiAllowed,
          });
        }
      }
    }
    return true;
  };

  const storedInitializerValueFacts = (
    initializer: unknown,
    scope: LexicalScope,
  ): ValueFacts => valueFactsForExpression(initializer, scope);

  const syncIdentifierValueFacts = (
    name: string,
    facts: ValueFacts,
    scope: LexicalScope,
  ): boolean => {
    return setScopedValueFacts(scope, name, facts);
  };

  const writeMemberValueFacts = (
    owner: ValueFacts,
    property: string | undefined,
    incoming: ValueFacts,
    options: TargetTransferOptions,
  ): boolean => {
    const capability = capabilityForValueFacts(incoming);
    const stored = capability !== undefined &&
        !options.allowTrustedMemberWrite
      ? UNKNOWN_VALUE_FACTS
      : incoming;
    let changed = false;
    for (const identity of owner.containers) {
      if (
        (property === undefined || property === "__proto__") &&
        !unsafeLocalContainerIdentities.has(identity)
      ) {
        unsafeLocalContainerIdentities.add(identity);
        changed = true;
      }
      changed = writeContainerFacts(
        identity,
        property === undefined
          ? { members: new Map(), wildcard: withUnknownValueFacts(stored) }
          : { members: new Map([[property, stored]]) },
      ) || changed;
    }
    return changed;
  };

  const transferValueFactsToTarget = (
    target: AstNode,
    incoming: ValueFacts,
    scope: LexicalScope,
    options: TargetTransferOptions,
  ): boolean => {
    const targetNode = unwrapTransparentExpression(target);
    if (!isNode(targetNode)) return false;
    if (targetNode.type === "AssignmentPattern") {
      if (!isNode(targetNode.left)) return false;
      const withDefault = withUnknownValueFacts(joinValueFacts(
        incoming,
        valueFactsForExpression(targetNode.right, scope),
      ));
      return transferValueFactsToTarget(
        targetNode.left,
        withDefault,
        scope,
        options,
      );
    }
    if (targetNode.type === "RestElement") {
      return isNode(targetNode.argument)
        ? transferValueFactsToTarget(
          targetNode.argument,
          incoming,
          scope,
          options,
        )
        : false;
    }

    const facts = transformValueFactApis(incoming, options.transformApi);
    const local = identifierName(targetNode);
    if (local) return syncIdentifierValueFacts(local, facts, scope);
    if (
      targetNode.type === "MemberExpression" ||
      targetNode.type === "OptionalMemberExpression"
    ) {
      const property = resolvedMemberProperty(targetNode, scope);
      return writeMemberValueFacts(
        valueFactsForExpression(targetNode.object, scope),
        property,
        facts,
        options,
      );
    }

    if (targetNode.type === "ArrayPattern") {
      let changed = false;
      const elements = Array.isArray(targetNode.elements)
        ? targetNode.elements
        : [];
      for (const [index, element] of elements.entries()) {
        if (!isNode(element)) continue;
        if (element.type === "RestElement" && isNode(element.argument)) {
          const sourceContainer = containerMembersForValueFacts(facts);
          const remaining = new Map<string, ValueFacts>();
          for (const [key, member] of sourceContainer.members) {
            const sourceIndex = Number(key);
            if (
              Number.isSafeInteger(sourceIndex) && sourceIndex >= index &&
              String(sourceIndex) === key
            ) {
              remaining.set(String(sourceIndex - index), member);
            }
          }
          const restFacts = valueFactsForContainer(
            element,
            "array-rest",
            {
              members: remaining,
              wildcard: sourceContainer.unknown
                ? UNKNOWN_VALUE_FACTS
                : undefined,
            },
          );
          changed = transferValueFactsToTarget(
            element.argument,
            restTargetValueFacts(facts, restFacts),
            scope,
            options,
          ) || changed;
          continue;
        }
        const memberFacts = projectedValueFacts(facts, String(index));
        changed = transferValueFactsToTarget(
          element,
          memberFacts,
          scope,
          options,
        ) || changed;
      }
      return changed;
    }
    if (targetNode.type !== "ObjectPattern") return false;

    let changed = false;
    const properties =
      (Array.isArray(targetNode.properties) ? targetNode.properties : [])
        .filter(isNode);
    const excludedKeys = new Set<string>();
    let hasIndeterminateKey = false;
    for (const property of properties) {
      if (property.type !== "ObjectProperty") continue;
      const key = resolvedPropertyKey(property, scope);
      if (key === undefined) hasIndeterminateKey = true;
      else excludedKeys.add(key);
    }
    for (const property of properties) {
      if (property.type === "RestElement" && isNode(property.argument)) {
        const sourceContainer = containerMembersForValueFacts(facts);
        const remaining = hasIndeterminateKey
          ? new Map(sourceContainer.members)
          : new Map(
            [...sourceContainer.members].filter(([key]) =>
              !excludedKeys.has(key)
            ),
          );
        const restFacts = valueFactsForContainer(
          property,
          "object-rest",
          {
            members: remaining,
            wildcard: sourceContainer.unknown || hasIndeterminateKey
              ? UNKNOWN_VALUE_FACTS
              : undefined,
          },
        );
        changed = transferValueFactsToTarget(
          property.argument,
          restTargetValueFacts(facts, restFacts),
          scope,
          options,
        ) || changed;
        continue;
      }
      if (property.type !== "ObjectProperty" || !isNode(property.value)) {
        continue;
      }
      const key = resolvedPropertyKey(property, scope);
      if (key !== undefined) {
        const memberFacts = projectedValueFacts(facts, key);
        changed = transferValueFactsToTarget(
          property.value,
          memberFacts,
          scope,
          options,
        ) || changed;
        continue;
      }
      changed = transferValueFactsToTarget(
        property.value,
        projectedUnknownPropertyValueFacts(facts),
        scope,
        options,
      ) || changed;
    }
    return changed;
  };

  const loopBindingTarget = (loop: AstNode): AstNode | undefined => {
    const left = loop.left;
    if (!isNode(left)) return undefined;
    if (left.type !== "VariableDeclaration") return left;
    return Array.isArray(left.declarations) && isNode(left.declarations[0]) &&
        isNode(left.declarations[0].id)
      ? left.declarations[0].id
      : undefined;
  };

  const mutationValueFacts = (
    mutation: AstNode,
    scope: LexicalScope,
  ): { target: AstNode; facts: ValueFacts } | undefined => {
    if (mutation.type === "AssignmentExpression" && isNode(mutation.left)) {
      if (mutation.operator === "=") {
        return {
          target: mutation.left,
          facts: valueFactsForExpression(mutation.right, scope),
        };
      }
      if (["&&=", "||=", "??="].includes(mutation.operator as string)) {
        return {
          target: mutation.left,
          facts: logicalValueFacts(
            mutation.operator as string,
            valueFactsForExpression(mutation.left, scope),
            valueFactsForExpression(mutation.right, scope),
          ),
        };
      }
      return { target: mutation.left, facts: UNKNOWN_VALUE_FACTS };
    }
    if (mutation.type === "UpdateExpression" && isNode(mutation.argument)) {
      return { target: mutation.argument, facts: UNKNOWN_VALUE_FACTS };
    }
    if (
      mutation.type === "UnaryExpression" && mutation.operator === "delete" &&
      isNode(mutation.argument)
    ) {
      return { target: mutation.argument, facts: UNKNOWN_VALUE_FACTS };
    }
    return undefined;
  };

  interface BindingIdentity {
    scope: LexicalScope;
    name: string;
  }
  const bindingIdentities: WeakMap<LexicalScope, Map<string, BindingIdentity>> =
    new WeakMap();
  const urlOrigins: ScopedValues<BindingIdentity> = new WeakMap();
  const unsafeUrlOrigins = new Set<BindingIdentity>();
  const bindingIdentity = (
    scope: LexicalScope,
    name: string,
  ): BindingIdentity | undefined => {
    const bindingScope = closestBindingScope(scope, name);
    if (!bindingScope) return undefined;
    let identities = bindingIdentities.get(bindingScope);
    if (!identities) {
      identities = new Map();
      bindingIdentities.set(bindingScope, identities);
    }
    let identity = identities.get(name);
    if (!identity) {
      identity = { scope: bindingScope, name };
      identities.set(name, identity);
    }
    return identity;
  };
  const isModuleUrlExpression = (
    node: unknown,
    scope: LexicalScope,
  ): boolean => {
    const expression = unwrapAwait(node);
    if (!isNode(expression) || expression.type !== "NewExpression") {
      return false;
    }
    const callee = identifierName(expression.callee);
    const globalUrl = isNode(expression.callee) &&
      (expression.callee.type === "MemberExpression" ||
        expression.callee.type === "OptionalMemberExpression") &&
      identifierName(expression.callee.object) === "globalThis" &&
      isUnbound(scope, "globalThis") &&
      memberPropertyName(expression.callee) === "URL";
    if (!(callee === "URL" && isUnbound(scope, "URL")) && !globalUrl) {
      return false;
    }
    const args = Array.isArray(expression.arguments)
      ? expression.arguments
      : [];
    return isImportMetaUrl(args[1]);
  };

  let urlOriginsChanged = true;
  while (urlOriginsChanged) {
    urlOriginsChanged = false;
    for (const { node: declaration, scope, kind } of declarations) {
      if (kind !== "const") continue;
      const name = identifierName(declaration.id);
      if (!name) continue;
      let origin: BindingIdentity | undefined;
      if (isModuleUrlExpression(declaration.init, scope)) {
        origin = bindingIdentity(scope, name);
      } else {
        const aliasedName = identifierName(unwrapAwait(declaration.init));
        if (aliasedName) {
          origin = getScopedValue(urlOrigins, scope, aliasedName);
        }
      }
      if (origin) {
        urlOriginsChanged = setScopedValue(
          urlOrigins,
          scope,
          name,
          origin,
        ) || urlOriginsChanged;
      }
    }
  }
  for (const { target, scope } of memberMutations) {
    let root: unknown = target;
    while (
      isNode(root) &&
      (root.type === "MemberExpression" ||
        root.type === "OptionalMemberExpression")
    ) {
      root = root.object;
    }
    const name = identifierName(root);
    if (!name) continue;
    const origin = getScopedValue(urlOrigins, scope, name);
    if (origin) unsafeUrlOrigins.add(origin);
  }
  for (const { value, scope } of escapedValues) {
    const name = identifierName(unwrapAwait(value));
    if (!name) continue;
    const origin = getScopedValue(urlOrigins, scope, name);
    if (origin) unsafeUrlOrigins.add(origin);
  }

  for (const seed of staticApiSeeds) {
    syncIdentifierValueFacts(
      seed.name,
      valueFactsForApi(seed.api),
      seed.scope,
    );
  }

  // Bindings contain only scalar lattice values and finite allocation-site
  // identities. Container members live in the shallow heap above, so cycles
  // add an existing identity instead of recursively growing copied trees.
  const structuralBindingStateCapacity = Math.max(
    1,
    visitedNodeCount + promiseProducerNodeCount + declarations.length +
      mutations.length + assignmentPatterns.length + loopBindings.length,
  );
  const maximumBindingPasses = options.maximumBindingPasses ??
    structuralBindingStateCapacity;
  if (!Number.isInteger(maximumBindingPasses) || maximumBindingPasses < 0) {
    throw new Error("maximum binding passes must be a non-negative integer");
  }
  const throwBindingNonConvergence = (): never => {
    throw new Error(
      `loader provenance binding analysis did not converge after ${analysisDiagnostics.bindingPasses} passes (structural capacity ${structuralBindingStateCapacity})`,
    );
  };
  if (maximumBindingPasses === 0) throwBindingNonConvergence();

  interface BindingTransferDefinition {
    readonly node: AstNode;
    readonly sequence: number;
    readonly evaluate: () => void;
  }
  const transferDefinitions: BindingTransferDefinition[] = [];
  const defineBindingTransfer = (
    node: AstNode,
    evaluate: () => void,
  ): void => {
    transferDefinitions.push({
      node,
      sequence: transferDefinitions.length,
      evaluate,
    });
  };

  for (const { node: pattern, scope } of assignmentPatterns) {
    defineBindingTransfer(pattern, () => {
      transferValueFactsToTarget(
        pattern,
        UNKNOWN_VALUE_FACTS,
        scope,
        { transformApi: (api) => api },
      );
    });
  }
  for (const { node: declaration, scope, kind } of declarations) {
    defineBindingTransfer(declaration, () => {
      if (!isNode(declaration.id)) return;
      if (declaration.init !== undefined && declaration.init !== null) {
        transferValueFactsToTarget(
          declaration.id,
          storedInitializerValueFacts(declaration.init, scope),
          scope,
          {
            transformApi: kind === "const" ? (api) => api : uncertainAlias,
          },
        );
      }
      const name = identifierName(declaration.id);
      if (!name) return;
      const bindingScope = closestBindingScope(scope, name);
      const hasMemberMutation = bindingScope !== undefined &&
        mutatedMemberBindings.get(bindingScope)?.has(name) === true;
      const urlOrigin = getScopedValue(urlOrigins, scope, name);
      const hasUnsafeUrlOrigin = urlOrigin !== undefined &&
        unsafeUrlOrigins.has(urlOrigin);
      const value = kind === "const" && !hasMemberMutation &&
          !hasUnsafeUrlOrigin
        ? evaluateString(declaration.init, scope)
        : undefined;
      if (value === undefined) return;
      const changed = setScopedValue(stringValues, scope, name, value);
      if (changed) {
        notifyBindingDependency(
          scopedBindingDependency(
            stringBindingDependencies,
            "string",
            scope,
            name,
          ),
        );
      }
    });
  }
  for (const { node: mutation, scope } of mutations) {
    defineBindingTransfer(mutation, () => {
      const transition = mutationValueFacts(mutation, scope);
      if (!transition) return;
      const isPlainAssignment = mutation.type === "AssignmentExpression" &&
        mutation.operator === "=";
      const isTrustedMemberWrite = isPlainAssignment &&
        isTrackableLocalMemberStore(mutation, scope);
      const transformApi = isPlainAssignment && !isTrustedMemberWrite
        ? uncertainAlias
        : (api: ApiBinding) => api;
      transferValueFactsToTarget(
        transition.target,
        transition.facts,
        scope,
        {
          transformApi,
          allowTrustedMemberWrite: !isPlainAssignment ||
            isTrustedMemberWrite,
        },
      );
    });
  }
  for (const { node: loop, scope } of loopBindings) {
    defineBindingTransfer(loop, () => {
      const target = loopBindingTarget(loop);
      if (!target) return;
      transferValueFactsToTarget(
        target,
        iterableElementValueFacts(loop.right, scope, loop.await === true),
        scope,
        { transformApi: (api) => api },
      );
    });
  }

  const sourceOffset = (node: AstNode): number =>
    typeof node.start === "number" ? node.start : Number.MAX_SAFE_INTEGER;
  transferDefinitions.sort((left, right) =>
    sourceOffset(left.node) - sourceOffset(right.node) ||
    left.sequence - right.sequence
  );
  const bindingTransfers = transferDefinitions.map<BindingTransfer>(
    (definition) => ({
      dependencies: new Set(),
      evaluate: definition.evaluate,
      queued: false,
    }),
  );
  for (const transfer of bindingTransfers) enqueueBindingTransfer(transfer);

  const transferCount = Math.max(1, bindingTransfers.length);
  const maximumTransferEvaluations = maximumBindingPasses * transferCount;
  while (bindingWorklistHead < bindingWorklist.length) {
    if (
      analysisDiagnostics.bindingTransferEvaluations >=
        maximumTransferEvaluations
    ) {
      throwBindingNonConvergence();
    }
    const transfer = bindingWorklist[bindingWorklistHead++];
    transfer.queued = false;
    activeBindingTransfer = transfer;
    analysisDiagnostics.bindingTransferEvaluations++;
    analysisDiagnostics.bindingPasses = Math.ceil(
      analysisDiagnostics.bindingTransferEvaluations / transferCount,
    );
    try {
      transfer.evaluate();
    } finally {
      activeBindingTransfer = undefined;
    }
  }

  interface SlotFlowState {
    slots: Map<
      ValueContainerIdentity,
      Map<string, ValueFacts>
    >;
    unsafe: Set<ValueContainerIdentity>;
  }

  const cloneValueFacts = (facts: ValueFacts): ValueFacts => ({
    ...facts,
    promise: {
      origins: PrefixSnapshotSet.from(facts.promise.origins),
      unknown: facts.promise.unknown,
    },
    containers: facts.containers,
  });
  const baseSlotFactsCache = new Map<
    ValueContainerIdentity,
    Map<string, ValueFacts>
  >();
  const baseSlotFacts = (
    identity: ValueContainerIdentity,
    property: string,
  ): ValueFacts => {
    let cached = baseSlotFactsCache.get(identity);
    if (!cached) {
      cached = new Map();
      baseSlotFactsCache.set(identity, cached);
    }
    const prior = cached.get(property);
    if (prior) return prior;
    const container = constructedValueContainerFacts.get(identity);
    if (!container) {
      throw new Error("value container identity has no construction facts");
    }
    let facts = container.members.get(property);
    if (container.wildcard) {
      facts = withUnknownValueFacts(joinValueFacts(
        facts,
        container.wildcard,
      ));
    }
    const result = cloneValueFacts(facts ?? EMPTY_VALUE_FACTS);
    cached.set(property, result);
    return result;
  };
  const cloneFlowState = (state: SlotFlowState): SlotFlowState => ({
    slots: new Map(
      [...state.slots].map(([identity, members]) => [
        identity,
        new Map(members),
      ]),
    ),
    unsafe: new Set(state.unsafe),
  });
  const flowSlotFacts = (
    state: SlotFlowState,
    identity: ValueContainerIdentity,
    property: string,
  ): ValueFacts =>
    state.slots.get(identity)?.get(property) ??
      baseSlotFacts(identity, property);
  const setFlowSlotFacts = (
    state: SlotFlowState,
    identity: ValueContainerIdentity,
    property: string,
    facts: ValueFacts,
  ): void => {
    let members = state.slots.get(identity);
    if (!members) {
      members = new Map();
      state.slots.set(identity, members);
    }
    members.set(property, cloneValueFacts(facts));
  };
  const mergeFlowStates = (
    target: SlotFlowState,
    alternatives: readonly SlotFlowState[],
  ): void => {
    const unsafe = new Set<ValueContainerIdentity>();
    const keys = new Map<ValueContainerIdentity, Set<string>>();
    for (const alternative of alternatives) {
      for (const identity of alternative.unsafe) unsafe.add(identity);
      for (const [identity, members] of alternative.slots) {
        let properties = keys.get(identity);
        if (!properties) {
          properties = new Set();
          keys.set(identity, properties);
        }
        for (const property of members.keys()) properties.add(property);
      }
    }
    const slots = new Map<
      ValueContainerIdentity,
      Map<string, ValueFacts>
    >();
    for (const [identity, properties] of keys) {
      const members = new Map<string, ValueFacts>();
      for (const property of properties) {
        const values = alternatives.map((alternative) =>
          flowSlotFacts(alternative, identity, property)
        );
        let joined: ValueFacts | undefined;
        for (const value of values) joined = joinValueFacts(joined, value);
        if (!joined) continue;
        const same = values.every((value) => value === values[0]);
        members.set(
          property,
          cloneValueFacts(same ? joined : withUnknownValueFacts(joined)),
        );
      }
      if (members.size > 0) slots.set(identity, members);
    }
    target.slots = slots;
    target.unsafe = unsafe;
  };

  const factsAreComplete = (root: ValueFacts): boolean => {
    const worklist = [root];
    const visited = new Set<ValueContainerIdentity>();
    while (worklist.length > 0) {
      const facts = worklist.pop();
      if (!facts) break;
      if (facts.unknown || facts.promise.unknown) return false;
      for (const identity of facts.containers) {
        if (visited.has(identity)) continue;
        visited.add(identity);
        const container = constructedValueContainerFacts.get(identity);
        if (!container || container.wildcard) return false;
        worklist.push(...container.members.values());
      }
    }
    return true;
  };
  const crossFunctionMutatedIdentities = new Set<ValueContainerIdentity>();
  const nonRefinableFlowIdentities = new Set<ValueContainerIdentity>();
  const nonLinearFlowNodeTypes = new Set([
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "SwitchStatement",
    "TryStatement",
    "CatchClause",
  ]);
  const isInsideNonLinearFlow = (node: AstNode): boolean => {
    let current = parentByNode.get(node);
    while (current && !isFunctionNode(current)) {
      if (nonLinearFlowNodeTypes.has(current.type)) return true;
      current = parentByNode.get(current);
    }
    return false;
  };
  const memberTargetsInPattern = (target: unknown): AstNode[] => {
    const node = unwrapTransparentExpression(target);
    if (!isNode(node)) return [];
    if (
      node.type === "MemberExpression" ||
      node.type === "OptionalMemberExpression"
    ) return [node];
    if (node.type === "AssignmentPattern") {
      return memberTargetsInPattern(node.left);
    }
    if (node.type === "RestElement") {
      return memberTargetsInPattern(node.argument);
    }
    if (node.type === "ArrayPattern") {
      return (Array.isArray(node.elements) ? node.elements : []).flatMap(
        memberTargetsInPattern,
      );
    }
    if (node.type === "ObjectPattern") {
      return (Array.isArray(node.properties) ? node.properties : []).flatMap(
        (property) => {
          if (!isNode(property)) return [];
          return property.type === "RestElement"
            ? memberTargetsInPattern(property.argument)
            : property.type === "ObjectProperty"
            ? memberTargetsInPattern(property.value)
            : [];
        },
      );
    }
    return [];
  };
  const disqualifyTargetIdentities = (
    target: unknown,
    scope: LexicalScope,
  ): void => {
    for (const member of memberTargetsInPattern(target)) {
      const owner = valueFactsForExpression(member.object, scope);
      for (const identity of owner.containers) {
        nonRefinableFlowIdentities.add(identity);
      }
    }
  };
  for (const { node: mutation, scope } of mutations) {
    const target = mutation.type === "AssignmentExpression"
      ? mutation.left
      : mutation.argument;
    const memberTargets = memberTargetsInPattern(target);
    for (const member of memberTargets) {
      const owner = valueFactsForExpression(member.object, scope);
      for (const identity of owner.containers) {
        const allocationScope = scopeByNode.get(identity.site);
        if (!allocationScope) {
          throw new Error("value container allocation is missing its scope");
        }
        if (
          nearestFunctionScope(allocationScope) !== nearestFunctionScope(scope)
        ) crossFunctionMutatedIdentities.add(identity);
        if (
          memberTargets.length > 1 ||
          member !== unwrapTransparentExpression(target) ||
          isInsideNonLinearFlow(mutation)
        ) nonRefinableFlowIdentities.add(identity);
      }
    }
  }
  for (const { node: loop, scope } of loopBindings) {
    disqualifyTargetIdentities(loopBindingTarget(loop), scope);
  }
  const identityCanBeFlowRefined = (
    identity: ValueContainerIdentity,
    property: string,
    scope: LexicalScope,
  ): boolean => {
    const allocationScope = scopeByNode.get(identity.site);
    if (!allocationScope) {
      throw new Error("value container allocation is missing its scope");
    }
    const constructed = constructedValueContainerFacts.get(identity);
    return nearestFunctionScope(allocationScope) ===
        nearestFunctionScope(scope) &&
      !crossFunctionMutatedIdentities.has(identity) &&
      !nonRefinableFlowIdentities.has(identity) &&
      !unsafeLocalContainerIdentities.has(identity) &&
      (trustedLocalContainerSites.has(identity.site) ||
        identity.kind === "promise-all-result" &&
          constructed?.members.has(property) === true);
  };
  const exactFlowSlot = (
    member: AstNode,
    scope: LexicalScope,
  ): { identity: ValueContainerIdentity; property: string } | undefined => {
    if (
      member.type !== "MemberExpression" &&
      member.type !== "OptionalMemberExpression"
    ) return undefined;
    const property = resolvedMemberProperty(member, scope);
    if (property === undefined || property === "__proto__") return undefined;
    const owner = valueFactsForExpression(member.object, scope);
    if (owner.unknown || owner.containers.size !== 1) return undefined;
    const identity = [...owner.containers][0];
    return identity && identityCanBeFlowRefined(identity, property, scope)
      ? { identity, property }
      : undefined;
  };
  const markFlowValueUnsafe = (
    value: unknown,
    scope: LexicalScope,
    state: SlotFlowState,
  ): void => {
    const facts = valueFactsForExpression(value, scope);
    for (const identity of facts.containers) state.unsafe.add(identity);
  };
  const recordFlowMemberRead = (
    member: AstNode,
    scope: LexicalScope,
    state: SlotFlowState,
  ): void => {
    const slot = exactFlowSlot(member, scope);
    if (!slot) return;
    if (state.unsafe.has(slot.identity)) {
      const owner = valueFactsForExpression(member.object, scope);
      flowValueFactsByNode.set(
        member,
        withUnknownValueFacts(projectedValueFacts(owner, slot.property)),
      );
      return;
    }
    flowValueFactsByNode.set(
      member,
      flowSlotFacts(state, slot.identity, slot.property),
    );
  };

  const isFlowStatement = (node: AstNode): boolean =>
    node.type === "Program" || node.type === "BlockStatement" ||
    node.type.endsWith("Statement") || node.type.endsWith("Declaration") ||
    node.type === "SwitchCase" || node.type === "CatchClause";
  const flowVisitExpression = (
    node: unknown,
    state: SlotFlowState,
  ): void => {
    if (!isNode(node) || isFunctionNode(node)) return;
    const scope = scopeByNode.get(node);
    if (!scope) throw new Error(`missing lexical scope for ${node.type}`);
    if (node.type === "ConditionalExpression") {
      flowVisitExpression(node.test, state);
      const consequent = cloneFlowState(state);
      flowVisitExpression(node.consequent, consequent);
      const alternate = cloneFlowState(state);
      flowVisitExpression(node.alternate, alternate);
      mergeFlowStates(state, [consequent, alternate]);
      return;
    }
    if (node.type === "LogicalExpression") {
      flowVisitExpression(node.left, state);
      const withoutRight = cloneFlowState(state);
      const withRight = cloneFlowState(state);
      flowVisitExpression(node.right, withRight);
      mergeFlowStates(state, [withoutRight, withRight]);
      return;
    }
    if (node.type === "AssignmentPattern") {
      flowVisitExpression(node.left, state);
      const withoutDefault = cloneFlowState(state);
      const withDefault = cloneFlowState(state);
      flowVisitExpression(node.right, withDefault);
      mergeFlowStates(state, [withoutDefault, withDefault]);
      return;
    }
    if (node.type === "OptionalCallExpression" && node.optional === true) {
      flowVisitExpression(node.callee, state);
      const withoutCall = cloneFlowState(state);
      const withCall = cloneFlowState(state);
      for (
        const argument of Array.isArray(node.arguments) ? node.arguments : []
      ) {
        const value = isNode(argument) && argument.type === "SpreadElement"
          ? argument.argument
          : argument;
        flowVisitExpression(value, withCall);
        markFlowValueUnsafe(value, scope, withCall);
      }
      mergeFlowStates(state, [withoutCall, withCall]);
      return;
    }
    if (
      node.type === "OptionalMemberExpression" && node.optional === true
    ) {
      flowVisitExpression(node.object, state);
      if (node.computed === true) {
        const withoutProperty = cloneFlowState(state);
        const withProperty = cloneFlowState(state);
        flowVisitExpression(node.property, withProperty);
        mergeFlowStates(state, [withoutProperty, withProperty]);
      }
      return;
    }
    if (
      node.type === "AssignmentExpression" && isNode(node.left) &&
      (node.left.type === "MemberExpression" ||
        node.left.type === "OptionalMemberExpression")
    ) {
      flowVisitExpression(node.left.object, state);
      if (node.left.computed === true) {
        flowVisitExpression(node.left.property, state);
      }
      const slot = exactFlowSlot(node.left, scope);
      const operator = String(node.operator);
      const isLogicalAssignment = ["&&=", "||=", "??="].includes(operator);
      const current = slot
        ? flowSlotFacts(state, slot.identity, slot.property)
        : undefined;
      const canTrustCurrent = slot !== undefined &&
        !state.unsafe.has(slot.identity);
      const skipsRight = canTrustCurrent && current !== undefined &&
        (operator === "||=" && current.definitelyTruthy ||
          operator === "??=" && current.definitelyNonNullish);
      if (skipsRight) return;
      const definitelyEvaluatesRight = !isLogicalAssignment ||
        canTrustCurrent && operator === "&&=" &&
          current?.definitelyTruthy === true;
      if (!definitelyEvaluatesRight) {
        const withoutRight = cloneFlowState(state);
        const withRight = cloneFlowState(state);
        flowVisitExpression(node.right, withRight);
        if (slot && current) {
          const incoming = valueFactsForExpression(node.right, scope);
          setFlowSlotFacts(
            withRight,
            slot.identity,
            slot.property,
            factsAreComplete(incoming)
              ? incoming
              : withUnknownValueFacts(joinValueFacts(current, incoming)),
          );
        } else {
          markFlowValueUnsafe(node.right, scope, withRight);
          const owner = valueFactsForExpression(node.left.object, scope);
          for (const identity of owner.containers) {
            withRight.unsafe.add(identity);
          }
        }
        mergeFlowStates(state, [withoutRight, withRight]);
        return;
      }
      flowVisitExpression(node.right, state);
      if (!slot) {
        markFlowValueUnsafe(node.right, scope, state);
        const owner = valueFactsForExpression(node.left.object, scope);
        for (const identity of owner.containers) state.unsafe.add(identity);
        return;
      }
      if (node.operator !== "=" || state.unsafe.has(slot.identity)) {
        const currentSlot = flowSlotFacts(
          state,
          slot.identity,
          slot.property,
        );
        const incoming = valueFactsForExpression(node.right, scope);
        const candidate = ["&&=", "||=", "??="].includes(operator)
          ? logicalValueFacts(operator, currentSlot, incoming)
          : UNKNOWN_VALUE_FACTS;
        setFlowSlotFacts(
          state,
          slot.identity,
          slot.property,
          factsAreComplete(candidate)
            ? candidate
            : withUnknownValueFacts(joinValueFacts(currentSlot, candidate)),
        );
        return;
      }
      const incoming = valueFactsForExpression(node.right, scope);
      setFlowSlotFacts(
        state,
        slot.identity,
        slot.property,
        factsAreComplete(incoming)
          ? incoming
          : withUnknownValueFacts(joinValueFacts(
            flowSlotFacts(state, slot.identity, slot.property),
            incoming,
          )),
      );
      return;
    }
    if (
      node.type === "UpdateExpression" ||
      node.type === "UnaryExpression" && node.operator === "delete"
    ) {
      const target = node.argument;
      if (isNode(target)) {
        flowVisitExpression(target, state);
        const slot = exactFlowSlot(target, scope);
        if (slot) {
          setFlowSlotFacts(
            state,
            slot.identity,
            slot.property,
            withUnknownValueFacts(flowSlotFacts(
              state,
              slot.identity,
              slot.property,
            )),
          );
        }
      }
      return;
    }
    for (const child of childNodes(node)) {
      if (!isFunctionNode(child)) flowVisitExpression(child, state);
    }
    if (
      node.type === "MemberExpression" ||
      node.type === "OptionalMemberExpression"
    ) {
      recordFlowMemberRead(node, scope, state);
    }
    if (
      node.type === "CallExpression" ||
      node.type === "OptionalCallExpression" ||
      node.type === "NewExpression"
    ) {
      for (
        const argument of Array.isArray(node.arguments) ? node.arguments : []
      ) {
        markFlowValueUnsafe(
          isNode(argument) && argument.type === "SpreadElement"
            ? argument.argument
            : argument,
          scope,
          state,
        );
      }
      if (
        isNode(node.callee) &&
        (node.callee.type === "MemberExpression" ||
          node.callee.type === "OptionalMemberExpression")
      ) {
        markFlowValueUnsafe(node.callee.object, scope, state);
      }
    }
    if (node.type === "TaggedTemplateExpression") {
      for (
        const expression of isNode(node.quasi) &&
            Array.isArray(node.quasi.expressions)
          ? node.quasi.expressions
          : []
      ) {
        markFlowValueUnsafe(expression, scope, state);
      }
    }
    if (
      node.type === "JSXExpressionContainer" ||
      node.type === "JSXSpreadAttribute" ||
      node.type === "JSXSpreadChild"
    ) {
      markFlowValueUnsafe(
        node.type === "JSXExpressionContainer"
          ? node.expression
          : node.argument,
        scope,
        state,
      );
    }
  };

  const flowVisitStatement = (
    node: AstNode,
    state: SlotFlowState,
  ): void => {
    const scope = scopeByNode.get(node);
    if (!scope) throw new Error(`missing lexical scope for ${node.type}`);
    if (isFunctionNode(node)) return;
    if (node.type === "Program" || node.type === "BlockStatement") {
      for (const statement of Array.isArray(node.body) ? node.body : []) {
        if (isNode(statement)) flowVisitStatement(statement, state);
      }
      return;
    }
    if (node.type === "VariableDeclaration") {
      for (
        const declaration of Array.isArray(node.declarations)
          ? node.declarations
          : []
      ) {
        if (isNode(declaration)) flowVisitExpression(declaration.init, state);
      }
      return;
    }
    if (node.type === "ExpressionStatement") {
      flowVisitExpression(node.expression, state);
      return;
    }
    if (node.type === "IfStatement") {
      flowVisitExpression(node.test, state);
      const consequent = cloneFlowState(state);
      if (isNode(node.consequent)) {
        flowVisitStatement(node.consequent, consequent);
      }
      const alternate = cloneFlowState(state);
      if (isNode(node.alternate)) flowVisitStatement(node.alternate, alternate);
      mergeFlowStates(state, [consequent, alternate]);
      return;
    }
    if (
      node.type === "WhileStatement" || node.type === "DoWhileStatement" ||
      node.type === "ForStatement" || node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      const entry = cloneFlowState(state);
      if (node.type === "ForStatement") {
        if (isNode(node.init)) {
          if (isFlowStatement(node.init)) flowVisitStatement(node.init, state);
          else flowVisitExpression(node.init, state);
        }
        flowVisitExpression(node.test, state);
      } else if (
        node.type === "ForInStatement" || node.type === "ForOfStatement"
      ) {
        flowVisitExpression(node.right, state);
      } else {
        flowVisitExpression(node.test, state);
      }
      const iteration = cloneFlowState(state);
      if (isNode(node.body)) flowVisitStatement(node.body, iteration);
      if (node.type === "ForStatement") {
        flowVisitExpression(node.update, iteration);
      }
      mergeFlowStates(state, [entry, iteration]);
      return;
    }
    if (node.type === "SwitchStatement") {
      flowVisitExpression(node.discriminant, state);
      const alternatives: SlotFlowState[] = [cloneFlowState(state)];
      for (const switchCase of Array.isArray(node.cases) ? node.cases : []) {
        if (!isNode(switchCase)) continue;
        const alternative = cloneFlowState(state);
        flowVisitExpression(switchCase.test, alternative);
        for (
          const statement of Array.isArray(switchCase.consequent)
            ? switchCase.consequent
            : []
        ) {
          if (isNode(statement)) flowVisitStatement(statement, alternative);
        }
        alternatives.push(alternative);
      }
      mergeFlowStates(state, alternatives);
      return;
    }
    if (node.type === "TryStatement") {
      const alternatives: SlotFlowState[] = [];
      const body = cloneFlowState(state);
      if (isNode(node.block)) flowVisitStatement(node.block, body);
      alternatives.push(body);
      if (isNode(node.handler)) {
        const caught = cloneFlowState(state);
        if (isNode(node.handler.body)) {
          flowVisitStatement(node.handler.body, caught);
        }
        alternatives.push(caught);
      } else {
        alternatives.push(cloneFlowState(state));
      }
      mergeFlowStates(state, alternatives);
      if (isNode(node.finalizer)) flowVisitStatement(node.finalizer, state);
      return;
    }
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") {
      flowVisitExpression(node.argument, state);
      markFlowValueUnsafe(node.argument, scope, state);
      return;
    }
    if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration"
    ) {
      if (isNode(node.declaration)) {
        if (isFlowStatement(node.declaration)) {
          flowVisitStatement(node.declaration, state);
        } else {
          flowVisitExpression(node.declaration, state);
        }
        markFlowValueUnsafe(node.declaration, scope, state);
      }
      for (
        const specifier of Array.isArray(node.specifiers) ? node.specifiers : []
      ) {
        if (isNode(specifier)) {
          markFlowValueUnsafe(specifier.local, scope, state);
        }
      }
      return;
    }
    for (const child of childNodes(node)) {
      if (isFunctionNode(child)) continue;
      if (isFlowStatement(child)) flowVisitStatement(child, state);
      else flowVisitExpression(child, state);
    }
  };

  flowVisitStatement(ast, { slots: new Map(), unsafe: new Set() });
  for (const functionNode of functionNodes) {
    const state: SlotFlowState = { slots: new Map(), unsafe: new Set() };
    if (isNode(functionNode.body)) {
      if (functionNode.body.type === "BlockStatement") {
        flowVisitStatement(functionNode.body, state);
      } else {
        flowVisitExpression(functionNode.body, state);
      }
    }
  }

  const markImmediatelyInvokedFunctions = (node: AstNode): void => {
    const scope = scopeByNode.get(node);
    if (!scope) throw new Error(`missing lexical scope for ${node.type}`);
    if (
      node.type === "CallExpression" ||
      node.type === "OptionalCallExpression"
    ) {
      const invoked = unwrapAwait(normalizeInvocation(node, scope).target);
      if (
        isNode(invoked) &&
        (invoked.type === "ArrowFunctionExpression" ||
          invoked.type === "FunctionExpression")
      ) {
        immediatelyInvokedFunctions.add(invoked);
      }
    }
    for (const child of childNodes(node)) {
      markImmediatelyInvokedFunctions(child);
    }
  };
  markImmediatelyInvokedFunctions(ast);

  const outermostTransparentExpression = (node: AstNode): AstNode => {
    let current = node;
    while (true) {
      const parent = parentByNode.get(current);
      if (!parent || transparentExpressionChild(parent) !== current) {
        return current;
      }
      current = parent;
    }
  };

  const containedPromiseCapability = (
    value: unknown,
    scope: LexicalScope,
  ): ApiBinding | undefined => {
    const result = capabilityInValueFactsGraph(
      valueFactsForExpression(value, scope),
      {
        includeApi: () => false,
        includePromises: true,
      },
    );
    return result ? uncertainAlias(result) : undefined;
  };

  const escapedApiInExpression = (
    value: unknown,
    scope: LexicalScope,
    includeNamespaces = false,
    includePromiseCapabilities = false,
    includeInheritedDescendants = true,
  ): ApiBinding | undefined => {
    const inheritedApi = inheritedMemberApiForExpression(
      value,
      scope,
      includeInheritedDescendants,
    );
    if (inheritedApi) return uncertainAlias(inheritedApi);
    return capabilityInValueFactsGraph(valueFactsForExpression(value, scope), {
      includeApi: (api) =>
        includeNamespaces || unresolvedLoaderForApi(api) !== undefined,
      includePromises: includePromiseCapabilities,
      forceUncertain: true,
    });
  };

  function patternContainsEscapingTarget(
    pattern: unknown,
    scope: LexicalScope,
  ): boolean {
    const target = unwrapTransparentExpression(pattern);
    if (!isNode(target)) return false;
    const name = identifierName(target);
    if (name) return closestBindingScope(scope, name) === undefined;
    if (
      target.type === "MemberExpression" ||
      target.type === "OptionalMemberExpression"
    ) {
      return true;
    }
    if (target.type === "AssignmentPattern") {
      return patternContainsEscapingTarget(target.left, scope);
    }
    if (target.type === "RestElement") {
      return patternContainsEscapingTarget(target.argument, scope);
    }
    if (target.type === "ArrayPattern") {
      return (Array.isArray(target.elements) ? target.elements : []).some(
        (element) => patternContainsEscapingTarget(element, scope),
      );
    }
    if (target.type === "ObjectPattern") {
      return (Array.isArray(target.properties) ? target.properties : []).some(
        (property) => {
          if (!isNode(property)) return false;
          return property.type === "RestElement"
            ? patternContainsEscapingTarget(property.argument, scope)
            : property.type === "ObjectProperty" &&
              patternContainsEscapingTarget(property.value, scope);
        },
      );
    }
    return false;
  }

  function isTrackableLocalMemberStore(
    assignment: AstNode,
    scope: LexicalScope,
  ): boolean {
    if (
      assignment.type !== "AssignmentExpression" ||
      assignment.operator !== "=" ||
      !isNode(assignment.left) ||
      (assignment.left.type !== "MemberExpression" &&
        assignment.left.type !== "OptionalMemberExpression")
    ) {
      return false;
    }
    const property = resolvedMemberProperty(assignment.left, scope);
    if (property === undefined) return false;
    const ownerFacts = valueFactsForExpression(assignment.left.object, scope);
    return !ownerFacts.unknown &&
      ownerFacts.containers.size > 0 &&
      [...ownerFacts.containers].every((identity) =>
        trustedLocalContainerSites.has(identity.site) &&
        !unsafeLocalContainerIdentities.has(identity)
      );
  }

  const loaderEscapeForNode = (
    node: AstNode,
    scope: LexicalScope,
  ): ApiBinding | undefined => {
    const writeTarget = outermostTransparentExpression(node);
    const writeParent = parentByNode.get(writeTarget);
    const isWriteOnlyMember = writeParent?.type === "AssignmentExpression" &&
        writeParent.left === writeTarget && writeParent.operator === "=" ||
      writeParent?.type === "UnaryExpression" &&
        writeParent.argument === writeTarget &&
        writeParent.operator === "delete";
    if (
      (node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression") &&
      node.computed === true && !isWriteOnlyMember &&
      resolvedMemberProperty(node, scope) === undefined
    ) {
      const ownerApi = apiForExpression(node.object, scope);
      if (
        ownerApi &&
        [
          "require",
          "require-alias",
          "node-module-namespace",
          "worker-threads-namespace",
          "global-namespace",
          "navigator-namespace",
          "service-worker",
          "import-meta-namespace",
          "css-namespace",
          "audio-worklet",
          "css-paint-worklet",
          "css-layout-worklet",
          "css-animation-worklet",
        ].includes(ownerApi)
      ) {
        return "uncertain-runtime-loader";
      }
    }
    if (
      node.type === "AssignmentPattern" &&
      patternContainsEscapingTarget(node.left, scope)
    ) {
      const api = escapedApiInExpression(node.right, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (node.type === "ReturnStatement") {
      const localFunction = functionByScope.get(nearestFunctionScope(scope));
      if (!localFunction) return undefined;
      if (immediatelyInvokedFunctions.has(localFunction)) {
        return containedPromiseCapability(node.argument, scope);
      }
      const api = escapedApiInExpression(node.argument, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (
      node.type === "ArrowFunctionExpression" &&
      isNode(node.body) && node.body.type !== "BlockStatement"
    ) {
      const bodyScope = scopeByNode.get(node.body) ?? scope;
      if (immediatelyInvokedFunctions.has(node)) {
        return containedPromiseCapability(node.body, bodyScope);
      }
      const api = escapedApiInExpression(node.body, bodyScope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (node.type === "YieldExpression") {
      const api = escapedApiInExpression(node.argument, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (node.type === "ThrowStatement") {
      const api = escapedApiInExpression(node.argument, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (node.type === "ForOfStatement") {
      const target = loopBindingTarget(node);
      if (!target || !patternContainsEscapingTarget(target, scope)) {
        return undefined;
      }
      const facts = iterableElementValueFacts(
        node.right,
        scope,
        node.await === true,
      );
      const api = capabilityForValueFacts(facts);
      return api ? uncertainAlias(api) : undefined;
    }
    if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration"
    ) {
      const values: unknown[] = [];
      if (
        isNode(node.declaration) &&
        node.declaration.type === "VariableDeclaration"
      ) {
        for (
          const declaration of Array.isArray(node.declaration.declarations)
            ? node.declaration.declarations
            : []
        ) {
          if (isNode(declaration)) values.push(declaration.init);
        }
      } else if (isNode(node.declaration)) {
        values.push(node.declaration);
      }
      if (node.type === "ExportNamedDeclaration") {
        for (
          const specifier of Array.isArray(node.specifiers)
            ? node.specifiers
            : []
        ) {
          if (isNode(specifier)) values.push(specifier.local);
        }
      }
      let exportedApi: ApiBinding | undefined;
      for (const value of values) {
        const api = escapedApiInExpression(value, scope, true, true);
        if (api) exportedApi = joinApiBinding(exportedApi, api);
      }
      if (exportedApi) return exportedApi;
    }
    if (node.type === "AssignmentExpression") {
      const assignmentTarget = unwrapTransparentExpression(node.left);
      if (!isNode(assignmentTarget)) return undefined;
      if (
        (assignmentTarget.type === "ArrayPattern" ||
          assignmentTarget.type === "ObjectPattern") &&
        patternContainsEscapingTarget(assignmentTarget, scope)
      ) {
        const api = escapedApiInExpression(node.right, scope, true, true);
        return api ? uncertainAlias(api) : undefined;
      }
      if (
        assignmentTarget.type === "MemberExpression" ||
        assignmentTarget.type === "OptionalMemberExpression"
      ) {
        const api = escapedApiInExpression(node.right, scope, true);
        const isTrustedStore = isTrackableLocalMemberStore(node, scope);
        if (api && !isTrustedStore) return uncertainAlias(api);
        const promiseApi = containedPromiseCapability(node.right, scope);
        return promiseApi && !isTrustedStore
          ? uncertainAlias(promiseApi)
          : undefined;
      }
    }
    if (
      (node.type === "ClassProperty" ||
        node.type === "ClassPrivateProperty" ||
        node.type === "PropertyDefinition")
    ) {
      const api = escapedApiInExpression(node.value, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (node.type === "TaggedTemplateExpression") {
      let escapedApi: ApiBinding | undefined;
      const tagApi = escapedApiInExpression(node.tag, scope, true, true);
      if (tagApi) escapedApi = joinApiBinding(escapedApi, tagApi);
      for (
        const expression of isNode(node.quasi) &&
            Array.isArray(node.quasi.expressions)
          ? node.quasi.expressions
          : []
      ) {
        const api = escapedApiInExpression(expression, scope, true, true);
        if (api) escapedApi = joinApiBinding(escapedApi, api);
      }
      return escapedApi ? uncertainAlias(escapedApi) : undefined;
    }
    if (
      node.type === "JSXExpressionContainer" ||
      node.type === "JSXSpreadAttribute" ||
      node.type === "JSXSpreadChild"
    ) {
      const value = node.type === "JSXExpressionContainer"
        ? node.expression
        : node.argument;
      const api = escapedApiInExpression(value, scope, true, true);
      return api ? uncertainAlias(api) : undefined;
    }
    if (
      node.type !== "CallExpression" &&
      node.type !== "OptionalCallExpression" &&
      node.type !== "NewExpression"
    ) {
      return undefined;
    }
    if (isPromiseAll(node, scope)) {
      let unmodeledInputApi: ApiBinding | undefined;
      const awaitedInputs = new Map<
        ValueFacts,
        { facts: ValueFacts; api?: ApiBinding }
      >();
      for (const input of promiseAllInputs(node, scope) ?? []) {
        const inputFacts = valueFactsForExpression(input, scope);
        let awaited = awaitedInputs.get(inputFacts);
        if (!awaited) {
          awaited = {
            facts: awaitedValueFacts(inputFacts),
            api: awaitedApiForPromiseOrigins(inputFacts.promise),
          };
          awaitedInputs.set(inputFacts, awaited);
        }
        if (
          isModeledResolvedApiContainer(awaited.facts) &&
          isResolvedContainerTree(awaited.facts)
        ) continue;
        const projectedApi = awaited.api ?? apiForExpression(input, scope);
        if (projectedApi) continue;
        const nestedPromiseApi = containedPromiseCapability(input, scope);
        if (nestedPromiseApi) {
          unmodeledInputApi = joinApiBinding(
            unmodeledInputApi,
            nestedPromiseApi,
          );
        }
      }
      return unmodeledInputApi;
    }
    const invocation = normalizeInvocation(node, scope);
    const target = invocation.target;
    if (apiForExpression(target, scope)) {
      return undefined;
    }
    if (
      isNode(target) &&
      (target.type === "CallExpression" || target.type === "NewExpression") &&
      apiForExpression(target.callee, scope) === "Function"
    ) {
      return undefined;
    }
    let escapedApi: ApiBinding | undefined;
    for (const capabilityInput of invocation.capabilityInputs) {
      const receiverApi = escapedApiInExpression(
        capabilityInput,
        scope,
        true,
        true,
      );
      if (receiverApi) escapedApi = joinApiBinding(escapedApi, receiverApi);
    }
    if (
      isNode(node.callee) &&
      (node.callee.type === "MemberExpression" ||
        node.callee.type === "OptionalMemberExpression")
    ) {
      if (!apiForExpression(node.callee.object, scope)) {
        const directReceiverCapability = escapedApiInExpression(
          node.callee.object,
          scope,
          true,
          false,
          false,
        );
        if (directReceiverCapability) {
          escapedApi = joinApiBinding(escapedApi, directReceiverCapability);
        }
      }
      const receiverOrigins = promiseOriginsForExpression(
        node.callee.object,
        scope,
      );
      const resolvedReceiverApi = awaitedApiForPromiseOrigins(receiverOrigins);
      const resolvedMember = resolvedReceiverApi &&
          resolvedReceiverApi !== "uncertain-runtime-loader"
        ? memberApi(
          resolvedReceiverApi,
          resolvedMemberProperty(node.callee, scope),
        )
        : undefined;
      if (!resolvedMember) {
        const receiverCapability = containedPromiseCapability(
          node.callee.object,
          scope,
        );
        if (receiverCapability) {
          escapedApi = joinApiBinding(escapedApi, receiverCapability);
        }
      }
    }
    for (const argument of invocation.arguments) {
      const api = escapedApiInExpression(
        isNode(argument) && argument.type === "SpreadElement"
          ? argument.argument
          : argument,
        scope,
        true,
        true,
      );
      if (api) escapedApi = joinApiBinding(escapedApi, api);
    }
    return escapedApi;
  };

  const memberApisForExpression = (
    node: unknown,
    scope: LexicalScope,
  ): InheritedMemberApiSnapshot => {
    const inheritedReference = inheritedMemberReferenceForExpression(
      node,
      scope,
    );
    if (inheritedReference) {
      if (
        inheritedReference.snapshot.truncated ||
        inheritedReference.uncertain || inheritedReference.indeterminate
      ) {
        return { projections: [], truncated: true };
      }
      const relative = new Map<string, InheritedMemberApiSeed>();
      for (const projection of inheritedReference.snapshot.projections) {
        if (projection.path.length <= inheritedReference.path.length) continue;
        let matches = true;
        for (let index = 0; index < inheritedReference.path.length; index++) {
          const expected = projection.path[index];
          const actual = inheritedReference.path[index];
          if (expected === undefined || actual === undefined) {
            return { projections: [], truncated: true };
          }
          if (expected !== actual) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        const path = projection.path.slice(inheritedReference.path.length);
        const key = JSON.stringify(path);
        const previous = relative.get(key);
        relative.set(key, {
          path,
          api: previous
            ? joinApiBinding(previous.api, projection.api)
            : projection.api,
        });
      }
      return {
        projections: [...relative.values()].sort((left, right) =>
          compareOrdinal(
            JSON.stringify(left.path),
            JSON.stringify(right.path),
          ) || compareOrdinal(left.api, right.api)
        ),
        truncated: false,
      };
    }

    const root = valueFactsForExpression(node, scope);
    const rootCapability = capabilityInValueFactsGraph(root, {
      includeApi: () => true,
      includePromises: true,
      forceUncertain: true,
    });
    if (!rootCapability) return { projections: [], truncated: false };

    const projections = new Map<string, InheritedMemberApiSeed>();
    let truncated = false;
    let visits = 0;
    const markTruncated = (): void => {
      if (truncated) return;
      truncated = true;
      analysisDiagnostics.inheritedMemberProjectionTruncations++;
    };
    const addProjection = (
      path: readonly (string | undefined)[],
      api: ApiBinding,
    ): void => {
      if (truncated || path.length === 0) return;
      const key = JSON.stringify(path);
      const previous = projections.get(key);
      if (!previous && projections.size >= MAX_INHERITED_MEMBER_PROJECTIONS) {
        markTruncated();
        return;
      }
      projections.set(key, {
        path: [...path],
        api: previous ? joinApiBinding(previous.api, api) : api,
      });
    };
    const visitFacts = (
      facts: ValueFacts,
      path: readonly (string | undefined)[],
      ancestors: ReadonlySet<ValueContainerIdentity>,
      depth: number,
    ): void => {
      if (truncated) return;
      if (visits >= MAX_INHERITED_MEMBER_PROJECTION_VISITS) {
        markTruncated();
        return;
      }
      visits++;
      analysisDiagnostics.inheritedMemberProjectionVisits++;
      if (facts.api) addProjection(path, facts.api);
      if (truncated) return;
      if (depth >= MAX_INHERITED_MEMBER_PROJECTION_DEPTH) {
        markTruncated();
        return;
      }
      for (const identity of facts.containers) {
        if (truncated) return;
        const container = valueContainerFacts.get(identity);
        if (!container) continue;
        if (ancestors.has(identity)) {
          markTruncated();
          return;
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(identity);
        for (const [property, member] of container.members) {
          visitFacts(member, [...path, property], nextAncestors, depth + 1);
          if (truncated) return;
        }
        if (container.wildcard) {
          visitFacts(
            container.wildcard,
            [...path, undefined],
            nextAncestors,
            depth + 1,
          );
        }
      }
    };
    visitFacts(root, [], new Set(), 0);
    return {
      projections: [...projections.values()].sort((left, right) =>
        compareOrdinal(JSON.stringify(left.path), JSON.stringify(right.path)) ||
        compareOrdinal(left.api, right.api)
      ),
      truncated,
    };
  };

  return {
    stringValues,
    resolveApi: apiForExpression,
    resolveMemberProperty: resolvedMemberProperty,
    normalizeInvocation,
    loaderEscapeForNode,
    capabilityApiForExpression: (node, scope) =>
      escapedApiInExpression(node, scope, true, true),
    memberApisForExpression,
    analysisDiagnostics,
  };
}

function resolvedString(
  node: unknown,
  stringValues: ScopedValues<string>,
  scope: LexicalScope,
  seen = new Set<string>(),
): string | undefined {
  const value = unwrapAwait(node);
  const literal = literalString(value);
  if (literal !== undefined) return literal;
  const name = identifierName(value);
  if (name) {
    const bindingScope = closestBindingScope(scope, name);
    const identity = bindingScope ? `${name}:${String(bindingScope)}` : name;
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    return getScopedValue(stringValues, scope, name);
  }
  if (
    isNode(value) && value.type === "BinaryExpression" &&
    value.operator === "+"
  ) {
    const left = resolvedString(value.left, stringValues, scope, new Set(seen));
    const right = resolvedString(
      value.right,
      stringValues,
      scope,
      new Set(seen),
    );
    return left === undefined || right === undefined
      ? undefined
      : `${left}${right}`;
  }
  if (isNode(value) && value.type === "TemplateLiteral") {
    const quasis = Array.isArray(value.quasis) ? value.quasis : [];
    const expressions = Array.isArray(value.expressions)
      ? value.expressions
      : [];
    if (quasis.length !== expressions.length + 1) return undefined;
    let result = "";
    for (let index = 0; index < quasis.length; index++) {
      const quasi = templateElementString(quasis[index]);
      if (quasi === undefined) return undefined;
      result += quasi;
      if (index < expressions.length) {
        const expression = resolvedString(
          expressions[index],
          stringValues,
          scope,
          new Set(seen),
        );
        if (expression === undefined) return undefined;
        result += expression;
      }
    }
    return result;
  }
  if (isNode(value) && value.type === "NewExpression") {
    const callee = identifierName(value.callee);
    const globalUrl = isNode(value.callee) &&
      value.callee.type === "MemberExpression" &&
      identifierName(value.callee.object) === "globalThis" &&
      isUnbound(scope, "globalThis") &&
      memberPropertyName(value.callee) === "URL";
    if (!(callee === "URL" && isUnbound(scope, "URL")) && !globalUrl) {
      return undefined;
    }
    const args = Array.isArray(value.arguments) ? value.arguments : [];
    if (!isImportMetaUrl(args[1])) return undefined;
    return resolvedString(args[0], stringValues, scope, seen);
  }
  return undefined;
}

function pushDependency(
  dependencies: SourceDependency[],
  filePath: string,
  node: AstNode,
  kind: SourceDependencyKind,
  options: { specifier?: string; loader?: string } = {},
): void {
  const { line, column } = sourceLocation(node);
  dependencies.push({ path: filePath, line, column, kind, ...options });
}

function callArguments(node: AstNode): unknown[] {
  return Array.isArray(node.arguments) ? node.arguments : [];
}

function isGlobalMember(
  node: unknown,
  object: string,
  property: string,
): boolean {
  return isNode(node) && node.type === "MemberExpression" &&
    identifierName(node.object) === object &&
    memberPropertyName(node) === property;
}

type ExecutableFunctionKind =
  | "function"
  | "async-function"
  | "generator-function"
  | "async-generator-function";

type ExecutableSourceMode =
  | {
    kind: "classic";
    inheritedBindings?: readonly InheritedBindingSeed[];
    allowNewTargetOutsideFunction?: boolean;
    allowSuperOutsideMethod?: boolean;
  }
  | { kind: "module" }
  | {
    kind: "function";
    functionKind: ExecutableFunctionKind;
    parameters: readonly string[];
  };

interface SourceDependencyInternalContext {
  sourceType: "script" | "module" | "unambiguous";
  allowAwaitOutsideFunction: boolean;
  allowReturnOutsideFunction: boolean;
  allowNewTargetOutsideFunction: boolean;
  allowSuperOutsideMethod: boolean;
  parserPlugins?: NonNullable<Parameters<typeof parse>[1]>["plugins"];
  inheritedBindings: readonly InheritedBindingSeed[];
  executableDepth: number;
  executableAnalysis: ExecutableSourceAnalysisState;
}

const MAX_EXECUTABLE_SOURCE_DEPTH = 16;
const DEFAULT_MAX_EXECUTABLE_SOURCE_ANALYSES = 256;
const MAX_INHERITED_MEMBER_PROJECTION_DEPTH = 32;
const MAX_INHERITED_MEMBER_PROJECTIONS = 256;
const MAX_INHERITED_MEMBER_PROJECTION_VISITS = 4_096;

interface ExecutableSourceAnalysisState {
  active: Set<string>;
  memoizedResults: Map<string, boolean>;
  maximumAnalyses: number;
  analyses: number;
  budgetExhaustions: number;
  cacheHits: number;
  cycleCuts: number;
  depthExhaustions: number;
}

function maximumExecutableSourceAnalyses(
  options: SourceDependencyCollectionOptions,
): number {
  const configured = options.maximumExecutableSourceAnalyses;
  return typeof configured === "number" && Number.isSafeInteger(configured) &&
      configured >= 0
    ? configured
    : DEFAULT_MAX_EXECUTABLE_SOURCE_ANALYSES;
}

function executableSourceAnalysisKey(
  source: string,
  mode: ExecutableSourceMode,
): string {
  const inheritedBindings = mode.kind === "classic"
    ? [...(mode.inheritedBindings ?? [])]
      .map(({ name, api, stringValue, memberApis }) => [
        name,
        api ?? null,
        stringValue ?? null,
        memberApis?.truncated ?? false,
        memberApis?.projections.map(({ path, api: memberApi }) => [
          path.map((segment) => segment ?? null),
          memberApi,
        ]) ?? [],
      ])
      .sort(([left], [right]) => compareOrdinal(String(left), String(right)))
    : [];
  return JSON.stringify([
    mode.kind,
    mode.kind === "function" ? mode.functionKind : null,
    mode.kind === "function" ? mode.parameters : null,
    mode.kind === "classic"
      ? mode.allowNewTargetOutsideFunction === true
      : false,
    mode.kind === "classic" ? mode.allowSuperOutsideMethod === true : false,
    inheritedBindings,
    source,
  ]);
}

function executableFunctionPrefix(kind: ExecutableFunctionKind): string {
  if (kind === "async-function") return "async function";
  if (kind === "generator-function") return "function*";
  if (kind === "async-generator-function") return "async function*";
  return "function";
}

function executableSourceContainsModuleLoad(
  source: string,
  mode: ExecutableSourceMode,
  options: SourceDependencyCollectionOptions,
  internal: SourceDependencyInternalContext,
): boolean {
  const state = internal.executableAnalysis;
  const key = executableSourceAnalysisKey(source, mode);
  const memoized = state.memoizedResults.get(key);
  if (memoized !== undefined) {
    state.cacheHits++;
    return memoized;
  }
  if (state.active.has(key)) {
    state.cycleCuts++;
    return true;
  }
  if (internal.executableDepth >= MAX_EXECUTABLE_SOURCE_DEPTH) {
    state.depthExhaustions++;
    return true;
  }
  if (state.analyses >= state.maximumAnalyses) {
    state.budgetExhaustions++;
    return true;
  }
  state.analyses++;
  state.active.add(key);
  const functionSource = mode.kind === "function"
    ? `${executableFunctionPrefix(mode.functionKind)} __veryfront_generated__(${
      mode.parameters.join(",")
    }) {\n${source}\n}`
    : source;
  const sourceType = mode.kind === "module" ? "module" : "script";
  let result = true;
  try {
    const dependencies = collectSourceDependenciesInternal(
      {
        path: `__veryfront_executable__/${mode.kind}.js`,
        content: functionSource,
      },
      { ...options, onAnalysisDiagnostics: undefined },
      {
        sourceType,
        allowAwaitOutsideFunction: false,
        allowReturnOutsideFunction: false,
        allowNewTargetOutsideFunction: mode.kind === "classic" &&
          mode.allowNewTargetOutsideFunction === true,
        allowSuperOutsideMethod: mode.kind === "classic" &&
          mode.allowSuperOutsideMethod === true,
        parserPlugins: ["importAttributes", "explicitResourceManagement"],
        inheritedBindings: mode.kind === "classic"
          ? mode.inheritedBindings ?? []
          : [],
        executableDepth: internal.executableDepth + 1,
        executableAnalysis: state,
      },
    );
    result = dependencies.some(({ kind }) =>
      kind === "static-import" || kind === "static-export" ||
      kind === "import-equals" || kind === "dynamic-import" ||
      kind === "runtime-loader" || kind === "unresolved-runtime-loader"
    );
  } catch {
    result = true;
  } finally {
    state.active.delete(key);
  }
  state.memoizedResults.set(key, result);
  return result;
}

function parserPluginsForPath(
  path: string,
): NonNullable<Parameters<typeof parse>[1]>["plugins"] {
  const plugins: NonNullable<Parameters<typeof parse>[1]>["plugins"] = [
    "importAttributes",
    "decorators-legacy",
    "explicitResourceManagement",
  ];
  if (/\.d\.(?:ts|cts|mts)$/.test(path)) {
    plugins.push(["typescript", { dts: true }]);
  } else if (/\.(?:ts|cts|mts)$/.test(path)) plugins.push("typescript");
  else if (/\.tsx$/.test(path)) plugins.push("typescript", "jsx");
  else plugins.push("jsx");
  return plugins;
}

function commentLine(comment: AstNode, matchIndex = 0): number {
  const { line } = sourceLocation(comment);
  const value = typeof comment.value === "string" ? comment.value : "";
  return line +
    value.slice(0, matchIndex).split(/\r\n|[\n\r\u2028\u2029]/).length - 1;
}

function collectCommentDependencies(
  ast: AstNode,
  filePath: string,
): SourceDependency[] {
  const dependencies: SourceDependency[] = [];
  const comments = Array.isArray(ast.comments)
    ? ast.comments.filter(isNode)
    : [];
  const program = ast.type === "File" && isNode(ast.program)
    ? ast.program
    : ast;
  const statements = Array.isArray(program.body)
    ? program.body.filter(isNode)
    : [];
  const firstStatementStart = statements.length > 0 &&
      typeof statements[0].start === "number"
    ? statements[0].start as number
    : Number.POSITIVE_INFINITY;

  for (const comment of comments) {
    const value = typeof comment.value === "string" ? comment.value : "";
    const end = typeof comment.end === "number"
      ? comment.end
      : Number.POSITIVE_INFINITY;
    if (comment.type === "CommentLine" && end <= firstStatementStart) {
      const tripleSlash =
        /^\/\s*<reference\s+(?:types|path)\s*=\s*["']([^"']+)["'][^>]*>\s*$/
          .exec(
            value,
          );
      if (tripleSlash) {
        dependencies.push({
          path: filePath,
          line: commentLine(comment),
          column: 1,
          kind: "triple-slash-reference",
          specifier: tripleSlash[1],
        });
      }
    }

    if (end <= firstStatementStart) {
      const jsxDirective = /^\s*\*?\s*@jsxImportSource\s+(\S+)\s*$/m.exec(
        value,
      );
      if (jsxDirective) {
        dependencies.push({
          path: filePath,
          line: commentLine(comment, jsxDirective.index),
          column: 1,
          kind: "runtime-loader",
          loader: "@jsxImportSource",
          specifier: jsxDirective[1],
        });
      }
    }

    const denoTypes = /^\s*@deno-types\s*=\s*["']([^"']+)["']\s*$/m.exec(value);
    if (denoTypes) {
      dependencies.push({
        path: filePath,
        line: commentLine(comment, denoTypes.index),
        column: 1,
        kind: "type-import",
        loader: "@deno-types",
        specifier: denoTypes[1],
      });
    }

    if (comment.type === "CommentBlock" && value.trimStart().startsWith("*")) {
      const jsDocImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
      for (const match of value.matchAll(jsDocImport)) {
        dependencies.push({
          path: filePath,
          line: commentLine(comment, match.index ?? 0),
          column: 1,
          kind: "type-import",
          loader: "JSDoc import",
          specifier: match[1],
        });
      }
    }
  }
  return dependencies;
}

/** Parse one production source file and return every statically observable module edge. */
export function collectSourceDependencies(
  file: CoreProductionSourceFile,
  options: SourceDependencyCollectionOptions = {},
): SourceDependency[] {
  const executableAnalysis: ExecutableSourceAnalysisState = {
    active: new Set(),
    memoizedResults: new Map(),
    maximumAnalyses: maximumExecutableSourceAnalyses(options),
    analyses: 0,
    budgetExhaustions: 0,
    cacheHits: 0,
    cycleCuts: 0,
    depthExhaustions: 0,
  };
  return collectSourceDependenciesInternal(file, options, {
    sourceType: "unambiguous",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowNewTargetOutsideFunction: false,
    allowSuperOutsideMethod: false,
    inheritedBindings: [],
    executableDepth: 0,
    executableAnalysis,
  });
}

function collectSourceDependenciesInternal(
  file: CoreProductionSourceFile,
  options: SourceDependencyCollectionOptions,
  internal: SourceDependencyInternalContext,
): SourceDependency[] {
  let ast: AstNode;
  try {
    ast = parse(file.content, {
      sourceType: internal.sourceType,
      allowAwaitOutsideFunction: internal.allowAwaitOutsideFunction,
      allowReturnOutsideFunction: internal.allowReturnOutsideFunction,
      allowNewTargetOutsideFunction: internal.allowNewTargetOutsideFunction,
      allowSuperOutsideMethod: internal.allowSuperOutsideMethod,
      errorRecovery: false,
      plugins: internal.parserPlugins ?? parserPluginsForPath(file.path),
    }) as unknown as AstNode;
  } catch (error) {
    throw new SourceImportCollectorError(
      "parse-failure",
      file.path,
      error instanceof Error ? error.message : String(error),
    );
  }

  let scopeByNode: WeakMap<AstNode, LexicalScope>;
  let inheritedScope: LexicalScope | undefined;
  let stringValues: ScopedValues<string>;
  let resolveApi: (
    node: unknown,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  let resolveMemberProperty: (
    node: unknown,
    scope: LexicalScope,
  ) => string | undefined;
  let normalizeInvocation: (
    node: AstNode,
    scope: LexicalScope,
  ) => NormalizedInvocation;
  let loaderEscapeForNode: (
    node: AstNode,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  let capabilityApiForExpression: (
    node: unknown,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  let memberApisForExpression: (
    node: unknown,
    scope: LexicalScope,
  ) => InheritedMemberApiSnapshot;
  let analysisDiagnostics: SourceDependencyAnalysisDiagnostics;
  try {
    inheritedScope = internal.inheritedBindings.length === 0 ? undefined : {
      bindings: new Set(
        internal.inheritedBindings.map(({ name }) => name),
      ),
      functionScope: true,
    } satisfies LexicalScope;
    ({ scopeByNode } = buildScopeMap(ast, inheritedScope));
    ({
      stringValues,
      resolveApi,
      resolveMemberProperty,
      normalizeInvocation,
      loaderEscapeForNode,
      capabilityApiForExpression,
      memberApisForExpression,
      analysisDiagnostics,
    } = collectModuleBindings(
      ast,
      scopeByNode,
      file.path,
      options,
      inheritedScope,
      internal.inheritedBindings,
    ));
  } catch (error) {
    throw new SourceImportCollectorError(
      "binding-resolution-failure",
      file.path,
      error instanceof Error ? error.message : String(error),
    );
  }

  const dependencies = collectCommentDependencies(ast, file.path);

  const recordLoader = (
    node: AstNode,
    scope: LexicalScope,
    loader: string,
    argument: unknown,
  ): void => {
    const specifier = resolvedString(
      argument,
      stringValues,
      scope,
    );
    pushDependency(
      dependencies,
      file.path,
      node,
      specifier === undefined
        ? "unresolved-runtime-loader"
        : loader === "import"
        ? "dynamic-import"
        : "runtime-loader",
      specifier === undefined ? { loader } : { loader, specifier },
    );
  };

  interface BoundInitializer {
    value: unknown;
    scope: LexicalScope;
  }

  type KnownPrimitive = string | number | boolean | bigint | null | undefined;

  const bindingInitializers: ScopedValues<BoundInitializer> = new WeakMap();
  const inspectionParentByNode = new WeakMap<AstNode, AstNode>();
  const collectBindingInitializers = (
    node: AstNode,
    parent?: AstNode,
  ): void => {
    if (parent) inspectionParentByNode.set(node, parent);
    const scope = scopeByNode.get(node);
    if (!scope) {
      throw new SourceImportCollectorError(
        "binding-resolution-failure",
        file.path,
        `missing lexical scope for ${node.type}`,
      );
    }
    if (node.type === "VariableDeclaration" && node.kind === "const") {
      for (
        const declaration of Array.isArray(node.declarations)
          ? node.declarations
          : []
      ) {
        if (!isNode(declaration)) continue;
        const name = identifierName(declaration.id);
        if (!name || declaration.init === undefined) continue;
        const declarationScope = scopeByNode.get(declaration) ?? scope;
        setScopedValue(bindingInitializers, declarationScope, name, {
          value: declaration.init,
          scope: declarationScope,
        });
      }
    } else if (
      node.type === "FunctionDeclaration" || node.type === "ClassDeclaration"
    ) {
      const name = identifierName(node.id);
      const declarationScope = scope.parent;
      if (name && declarationScope) {
        setScopedValue(bindingInitializers, declarationScope, name, {
          value: node,
          scope,
        });
      }
    }
    for (const child of childNodes(node)) {
      collectBindingInitializers(child, node);
    }
  };
  collectBindingInitializers(ast);

  const primitiveForSource = (
    node: unknown,
    scope: LexicalScope,
    seen = new Set<AstNode>(),
  ): { known: true; value: KnownPrimitive } | { known: false } => {
    const value = unwrapAwait(node);
    const text = resolvedString(value, stringValues, scope);
    if (text !== undefined) return { known: true, value: text };
    if (!isNode(value)) {
      return value === undefined
        ? { known: true, value: undefined }
        : { known: false };
    }
    if (seen.has(value)) return { known: false };
    seen.add(value);
    if (value.type === "NullLiteral") return { known: true, value: null };
    if (value.type === "BooleanLiteral" && typeof value.value === "boolean") {
      return { known: true, value: value.value };
    }
    if (value.type === "NumericLiteral" && typeof value.value === "number") {
      return { known: true, value: value.value };
    }
    if (value.type === "BigIntLiteral" && typeof value.value === "string") {
      try {
        return { known: true, value: BigInt(value.value) };
      } catch {
        return { known: false };
      }
    }
    const name = identifierName(value);
    if (name) {
      if (isUnbound(scope, name)) {
        if (name === "undefined") return { known: true, value: undefined };
        if (name === "NaN") return { known: true, value: Number.NaN };
        if (name === "Infinity") {
          return { known: true, value: Number.POSITIVE_INFINITY };
        }
      }
      const initializer = getScopedValue(bindingInitializers, scope, name);
      return initializer
        ? primitiveForSource(initializer.value, initializer.scope, seen)
        : { known: false };
    }
    if (value.type === "UnaryExpression") {
      if (value.operator === "void") {
        return { known: true, value: undefined };
      }
      if (value.operator === "+" || value.operator === "-") {
        const argument = primitiveForSource(value.argument, scope, seen);
        if (!argument.known) return argument;
        if (typeof argument.value === "number") {
          return {
            known: true,
            value: value.operator === "+" ? +argument.value : -argument.value,
          };
        }
        if (typeof argument.value === "bigint" && value.operator === "-") {
          return { known: true, value: -argument.value };
        }
      }
    }
    return { known: false };
  };

  const sourceText = (
    node: unknown,
    scope: LexicalScope,
  ): { known: true; text: string; wasString: boolean } | { known: false } => {
    const primitive = primitiveForSource(node, scope);
    return primitive.known
      ? {
        known: true,
        text: String(primitive.value),
        wasString: typeof primitive.value === "string",
      }
      : primitive;
  };

  const callableApis: ReadonlySet<ApiBinding> = new Set([
    "create-require",
    "require",
    "require-alias",
    "require-resolve",
    "node-worker",
    "service-worker-register",
    "module-register",
    "import-meta-resolve",
    "import-scripts",
    "audio-worklet-add-module",
    "css-paint-worklet-add-module",
    "css-layout-worklet-add-module",
    "css-animation-worklet-add-module",
    "web-worker",
    "shared-worker",
    "Function",
    "AsyncFunction",
    "GeneratorFunction",
    "AsyncGeneratorFunction",
    "eval",
    "set-timeout",
    "set-interval",
    "node-vm-run-in-context",
    "node-vm-run-in-new-context",
    "node-vm-run-in-this-context",
    "node-vm-compile-function",
    "node-vm-create-script",
    "node-vm-script",
    "node-vm-source-text-module",
  ]);

  const isDefinitelyCallable = (
    node: unknown,
    scope: LexicalScope,
    seen = new Set<AstNode>(),
  ): boolean => {
    const value = unwrapTransparentExpression(node);
    if (!isNode(value) || seen.has(value)) return false;
    seen.add(value);
    if (
      value.type === "FunctionExpression" ||
      value.type === "ArrowFunctionExpression" ||
      value.type === "FunctionDeclaration" ||
      value.type === "ClassExpression" ||
      value.type === "ClassDeclaration"
    ) {
      return true;
    }
    const api = resolveApi(value, scope);
    if (api && callableApis.has(api)) return true;
    const name = identifierName(value);
    if (name) {
      const initializer = getScopedValue(bindingInitializers, scope, name);
      return initializer
        ? isDefinitelyCallable(initializer.value, initializer.scope, seen)
        : false;
    }
    if (value.type === "SequenceExpression") {
      const expressions = Array.isArray(value.expressions)
        ? value.expressions
        : [];
      return isDefinitelyCallable(expressions.at(-1), scope, seen);
    }
    if (value.type === "AssignmentExpression" && value.operator === "=") {
      return isDefinitelyCallable(value.right, scope, seen);
    }
    if (
      value.type === "ConditionalExpression" ||
      value.type === "LogicalExpression"
    ) {
      const branches = value.type === "ConditionalExpression"
        ? [value.consequent, value.alternate]
        : [value.left, value.right];
      return branches.every((branch) =>
        isDefinitelyCallable(branch, scope, new Set(seen))
      );
    }
    if (
      value.type === "CallExpression" ||
      value.type === "OptionalCallExpression"
    ) {
      const callee = unwrapTransparentExpression(value.callee);
      return isNode(callee) &&
        (callee.type === "MemberExpression" ||
          callee.type === "OptionalMemberExpression") &&
        resolveMemberProperty(callee, scope) === "bind" &&
        isDefinitelyCallable(callee.object, scope, seen);
    }
    return false;
  };

  const inheritedBindingsForDirectEval = (
    scope: LexicalScope,
  ): InheritedBindingSeed[] => {
    const result: InheritedBindingSeed[] = [];
    const seen = new Set<string>();
    const inheritedBindingByName = new Map(
      internal.inheritedBindings.map((binding) => [binding.name, binding]),
    );
    for (
      let current: LexicalScope | undefined = scope;
      current;
      current = current.parent
    ) {
      for (const name of current.bindings) {
        if (seen.has(name)) continue;
        seen.add(name);
        const bindingScope = closestBindingScope(scope, name);
        const inheritedBinding = bindingScope === inheritedScope
          ? inheritedBindingByName.get(name)
          : undefined;
        if (inheritedBinding) {
          result.push({ ...inheritedBinding });
          continue;
        }
        const identifier = { type: "Identifier", name };
        result.push({
          name,
          api: resolveApi(identifier, scope),
          stringValue: resolvedString(identifier, stringValues, scope),
          memberApis: memberApisForExpression(identifier, scope),
        });
      }
    }
    return result;
  };

  const directEvalSyntacticContext = (
    node: AstNode,
  ): {
    allowNewTargetOutsideFunction: boolean;
    allowSuperOutsideMethod: boolean;
  } => {
    let descendant = node;
    for (
      let current = inspectionParentByNode.get(node);
      current;
      current = inspectionParentByNode.get(current)
    ) {
      const child = descendant;
      descendant = current;
      if (
        !isFunctionNode(current) || current.type === "ArrowFunctionExpression"
      ) {
        if (current.type === "StaticBlock") {
          return {
            allowNewTargetOutsideFunction: true,
            allowSuperOutsideMethod: true,
          };
        }
        if (
          [
            "ClassProperty",
            "ClassPrivateProperty",
            "PropertyDefinition",
            "ClassAccessorProperty",
          ].includes(current.type) && current.value === child
        ) {
          return {
            allowNewTargetOutsideFunction: true,
            allowSuperOutsideMethod: true,
          };
        }
        continue;
      }
      return {
        allowNewTargetOutsideFunction: true,
        allowSuperOutsideMethod: current.type === "ObjectMethod" ||
          current.type === "ClassMethod" ||
          current.type === "ClassPrivateMethod",
      };
    }
    return {
      allowNewTargetOutsideFunction: internal.allowNewTargetOutsideFunction,
      allowSuperOutsideMethod: internal.allowSuperOutsideMethod,
    };
  };

  const recordExecutableSource = (
    node: AstNode,
    loader: string,
    source: string | undefined,
    mode: ExecutableSourceMode,
    forceIssue = false,
  ): void => {
    if (
      forceIssue ||
      source === undefined ||
      executableSourceContainsModuleLoad(
        source,
        mode,
        options,
        internal,
      )
    ) {
      pushDependency(
        dependencies,
        file.path,
        node,
        "unresolved-runtime-loader",
        { loader },
      );
    }
  };

  const functionKindForApi = (
    api: ApiBinding | undefined,
  ): ExecutableFunctionKind | undefined => {
    if (api === "Function") return "function";
    if (api === "AsyncFunction") return "async-function";
    if (api === "GeneratorFunction") return "generator-function";
    if (api === "AsyncGeneratorFunction") return "async-generator-function";
    return undefined;
  };

  const parameterList = (
    node: unknown,
    scope: LexicalScope,
    seen = new Set<AstNode>(),
  ): string[] | undefined => {
    if (node === undefined) return [];
    const value = unwrapTransparentExpression(node);
    if (!isNode(value) || seen.has(value)) return undefined;
    seen.add(value);
    const name = identifierName(value);
    if (name) {
      const initializer = getScopedValue(bindingInitializers, scope, name);
      return initializer
        ? parameterList(initializer.value, initializer.scope, seen)
        : undefined;
    }
    if (value.type !== "ArrayExpression") return undefined;
    const elements = Array.isArray(value.elements) ? value.elements : [];
    const result: string[] = [];
    for (const element of elements) {
      if (!isNode(element) || element.type === "SpreadElement") {
        return undefined;
      }
      const parameter = sourceText(element, scope);
      if (!parameter.known) return undefined;
      result.push(parameter.text);
    }
    return result;
  };

  const inspectExecutableInvocation = (
    node: AstNode,
    scope: LexicalScope,
    invocation: NormalizedInvocation,
    api: ApiBinding | undefined,
  ): boolean => {
    const loader = api ? unresolvedLoaderForApi(api) : undefined;
    const argumentsContainCapability = (argumentsToInspect: unknown[]) =>
      argumentsToInspect.some((argument) =>
        capabilityApiForExpression(
          isNode(argument) && argument.type === "SpreadElement"
            ? argument.argument
            : argument,
          scope,
        ) !== undefined
      );
    const functionKind = functionKindForApi(api);
    if (functionKind && loader) {
      if (!invocation.argumentsKnown) {
        recordExecutableSource(node, loader, undefined, {
          kind: "function",
          functionKind,
          parameters: [],
        });
        return true;
      }
      const args = invocation.arguments;
      const body = args.length === 0
        ? { known: true as const, text: "", wasString: true }
        : sourceText(args.at(-1), scope);
      const parameters: string[] = [];
      let parametersKnown = true;
      for (const parameter of args.slice(0, -1)) {
        const resolved = sourceText(parameter, scope);
        if (!resolved.known) {
          parametersKnown = false;
          break;
        }
        parameters.push(resolved.text);
      }
      recordExecutableSource(
        node,
        loader,
        body.known && parametersKnown ? body.text : undefined,
        { kind: "function", functionKind, parameters },
      );
      return true;
    }

    if (api === "eval" && loader && invocation.kind !== "construct") {
      if (!invocation.argumentsKnown) {
        recordExecutableSource(node, loader, undefined, { kind: "classic" });
        return true;
      }
      const body = primitiveForSource(invocation.arguments[0], scope);
      if (!body.known || typeof body.value === "string") {
        const directEval = node.type === "CallExpression" &&
          identifierName(node.callee) === "eval" &&
          isUnbound(scope, "eval") && invocation.kind === "direct";
        const syntacticContext = directEval
          ? directEvalSyntacticContext(node)
          : {
            allowNewTargetOutsideFunction: false,
            allowSuperOutsideMethod: false,
          };
        recordExecutableSource(
          node,
          loader,
          body.known && typeof body.value === "string" ? body.value : undefined,
          {
            kind: "classic",
            inheritedBindings: directEval
              ? inheritedBindingsForDirectEval(scope)
              : [],
            ...syntacticContext,
          },
        );
      }
      return true;
    }

    if (
      (api === "set-timeout" || api === "set-interval") && loader &&
      invocation.kind !== "construct"
    ) {
      if (!invocation.argumentsKnown) {
        recordExecutableSource(node, loader, undefined, { kind: "classic" });
        return true;
      }
      const handler = invocation.arguments[0];
      if (!isDefinitelyCallable(handler, scope)) {
        const source = sourceText(handler, scope);
        recordExecutableSource(
          node,
          loader,
          source.known ? source.text : undefined,
          { kind: "classic" },
        );
      }
      return true;
    }

    if (
      api === "node-vm-run-in-context" ||
      api === "node-vm-run-in-new-context" ||
      api === "node-vm-run-in-this-context"
    ) {
      if (!loader) return true;
      const source = invocation.argumentsKnown
        ? sourceText(invocation.arguments[0], scope)
        : { known: false as const };
      recordExecutableSource(
        node,
        loader,
        source.known ? source.text : undefined,
        { kind: "classic" },
        argumentsContainCapability(invocation.arguments.slice(1)),
      );
      return true;
    }

    if (api === "node-vm-compile-function") {
      if (!loader) return true;
      const source = invocation.argumentsKnown
        ? sourceText(invocation.arguments[0], scope)
        : { known: false as const };
      const parameters = invocation.argumentsKnown
        ? parameterList(invocation.arguments[1], scope)
        : undefined;
      recordExecutableSource(
        node,
        loader,
        source.known && parameters !== undefined ? source.text : undefined,
        {
          kind: "function",
          functionKind: "function",
          parameters: parameters ?? [],
        },
        argumentsContainCapability(invocation.arguments.slice(2)),
      );
      return true;
    }

    if (api === "node-vm-create-script") {
      if (!loader) return true;
      const source = invocation.argumentsKnown
        ? sourceText(invocation.arguments[0], scope)
        : { known: false as const };
      recordExecutableSource(
        node,
        loader,
        source.known ? source.text : undefined,
        { kind: "classic" },
        argumentsContainCapability(invocation.arguments.slice(1)),
      );
      return true;
    }

    if (api === "node-vm-script" || api === "node-vm-source-text-module") {
      if (invocation.kind !== "construct") return true;
      if (!loader) return true;
      const source = invocation.argumentsKnown
        ? sourceText(invocation.arguments[0], scope)
        : { known: false as const };
      recordExecutableSource(
        node,
        loader,
        source.known ? source.text : undefined,
        api === "node-vm-source-text-module"
          ? { kind: "module" }
          : { kind: "classic" },
        argumentsContainCapability(invocation.arguments.slice(1)),
      );
      return true;
    }

    return false;
  };

  const inspect = (node: AstNode): void => {
    const scope = scopeByNode.get(node);
    if (!scope) {
      throw new SourceImportCollectorError(
        "binding-resolution-failure",
        file.path,
        `missing lexical scope for ${node.type}`,
      );
    }

    const escapedApi = loaderEscapeForNode(node, scope);
    const escapedLoader = escapedApi
      ? unresolvedLoaderForApi(escapedApi)
      : undefined;
    if (escapedLoader) {
      pushDependency(
        dependencies,
        file.path,
        node,
        "unresolved-runtime-loader",
        { loader: escapedLoader },
      );
    }

    if (node.type === "ImportDeclaration") {
      const specifier = literalString(node.source);
      if (specifier !== undefined) {
        pushDependency(
          dependencies,
          file.path,
          node,
          node.importKind === "type" ? "type-import" : "static-import",
          { specifier },
        );
      }
    } else if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const specifier = literalString(node.source);
      if (specifier !== undefined) {
        pushDependency(
          dependencies,
          file.path,
          node,
          node.exportKind === "type" ? "type-import" : "static-export",
          { specifier },
        );
      }
    } else if (node.type === "TSImportType") {
      const specifier = literalString(node.argument);
      if (specifier !== undefined) {
        pushDependency(dependencies, file.path, node, "type-import", {
          specifier,
        });
      }
    } else if (node.type === "TSImportEqualsDeclaration") {
      const reference = node.moduleReference;
      if (isNode(reference) && reference.type === "TSExternalModuleReference") {
        const specifier = literalString(reference.expression);
        if (specifier !== undefined) {
          pushDependency(dependencies, file.path, node, "import-equals", {
            specifier,
          });
        }
      }
    } else if (node.type === "ImportExpression") {
      recordLoader(node, scope, "import", node.source);
    } else if (
      node.type === "CallExpression" || node.type === "OptionalCallExpression"
    ) {
      const args = callArguments(node);
      if (isNode(node.callee) && node.callee.type === "Import") {
        recordLoader(node, scope, "import", args[0]);
      } else {
        const invocation = normalizeInvocation(node, scope);
        const args = invocation.arguments;
        const directApi = resolveApi(invocation.target, scope);
        const calleeName = identifierName(invocation.target);
        const generatedFunctionApi = isNode(node.callee) &&
            (node.callee.type === "CallExpression" ||
              node.callee.type === "NewExpression")
          ? resolveApi(node.callee.callee, scope)
          : undefined;
        const generatedFunctionReceivesLoader = isNode(node.callee) &&
          (node.callee.type === "CallExpression" ||
            node.callee.type === "NewExpression") &&
          functionKindForApi(generatedFunctionApi) !== undefined &&
          args.some((argument) => resolveApi(argument, scope) !== undefined);
        if (
          inspectExecutableInvocation(
            node,
            scope,
            invocation,
            directApi,
          )
        ) {
          // Executable-source sinks collapse all nested findings to this call.
        } else if (generatedFunctionReceivesLoader) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: unresolvedLoaderForApi(generatedFunctionApi!) ??
                "Function",
            },
          );
        } else if (directApi === "import-meta-resolve") {
          recordLoader(node, scope, "import.meta.resolve", args[0]);
        } else if (
          (calleeName === "require" && isUnbound(scope, "require")) ||
          directApi === "require"
        ) {
          recordLoader(node, scope, "require", args[0]);
        } else if (directApi === "require-resolve") {
          recordLoader(node, scope, "require.resolve", args[0]);
        } else if (directApi === "require-alias") {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: "require-alias",
            },
          );
        } else if (directApi === "uncertain-runtime-loader") {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: "runtime-loader-alias",
            },
          );
        } else if (
          directApi !== "import-scripts" && directApi &&
          loaderForApi(directApi)
        ) {
          recordLoader(node, scope, loaderForApi(directApi)!, args[0]);
        } else if (directApi === "service-worker-register") {
          recordLoader(
            node,
            scope,
            "navigator.serviceWorker.register",
            args[0],
          );
        } else if (
          directApi === "audio-worklet-add-module" ||
          directApi === "css-paint-worklet-add-module" ||
          directApi === "css-layout-worklet-add-module" ||
          directApi === "css-animation-worklet-add-module"
        ) {
          recordLoader(
            node,
            scope,
            loaderForApi(directApi)!,
            args[0],
          );
        } else if (
          isNode(node.callee) && node.callee.type === "MemberExpression" &&
          memberPropertyName(node.callee) === "resolve"
        ) {
          const ownerApi = resolveApi(node.callee.object, scope);
          const ownerName = identifierName(node.callee.object);
          if (
            ownerApi === "require" ||
            ownerName === "require" && isUnbound(scope, "require")
          ) {
            recordLoader(node, scope, "require.resolve", args[0]);
          }
        } else if (
          isNode(node.callee) && node.callee.type === "MemberExpression" &&
          identifierName(node.callee.object) === "require" &&
          isUnbound(scope, "require") && node.callee.computed === true
        ) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: "require.resolve",
            },
          );
        } else if (
          directApi === "import-scripts"
        ) {
          if (args.length === 0) {
            pushDependency(
              dependencies,
              file.path,
              node,
              "unresolved-runtime-loader",
              {
                loader: "importScripts",
              },
            );
          } else {
            for (const argument of args) {
              if (isNode(argument) && argument.type === "SpreadElement") {
                pushDependency(
                  dependencies,
                  file.path,
                  node,
                  "unresolved-runtime-loader",
                  {
                    loader: "importScripts",
                  },
                );
              } else recordLoader(node, scope, "importScripts", argument);
            }
          }
        } else if (
          isNode(node.callee) && node.callee.type === "MemberExpression" &&
          memberPropertyName(node.callee) === "register" &&
          isNode(node.callee.object) &&
          node.callee.object.type === "MemberExpression" &&
          memberPropertyName(node.callee.object) === "serviceWorker" &&
          ((identifierName(node.callee.object.object) === "navigator" &&
            isUnbound(scope, "navigator")) ||
            (isGlobalMember(
              node.callee.object.object,
              "globalThis",
              "navigator",
            ) &&
              isUnbound(scope, "globalThis")))
        ) {
          recordLoader(
            node,
            scope,
            "navigator.serviceWorker.register",
            args[0],
          );
        } else if (directApi === "module-register") {
          recordLoader(node, scope, "module.register", args[0]);
        } else if (
          isNode(node.callee) && node.callee.type === "MemberExpression" &&
          memberPropertyName(node.callee) === "register"
        ) {
          const objectApi = resolveApi(node.callee.object, scope);
          const objectName = identifierName(node.callee.object);
          if (
            objectApi === "node-module-namespace" ||
            objectName === "module" && isUnbound(scope, "module")
          ) {
            recordLoader(node, scope, "module.register", args[0]);
          }
        } else if (
          isNode(node.callee) &&
          (node.callee.type === "MemberExpression" ||
            node.callee.type === "OptionalMemberExpression") &&
          resolveMemberProperty(node.callee, scope) === "addModule"
        ) {
          const object = node.callee.object;
          if (
            identifierName(object) === "audioWorklet" &&
              isUnbound(scope, "audioWorklet") ||
            isNode(object) &&
              (object.type === "MemberExpression" ||
                object.type === "OptionalMemberExpression") &&
              resolveMemberProperty(object, scope) === "audioWorklet"
          ) {
            recordLoader(node, scope, "AudioWorklet.addModule", args[0]);
          } else if (
            isNode(object) &&
            (object.type === "MemberExpression" ||
              object.type === "OptionalMemberExpression") &&
            ["paintWorklet", "layoutWorklet", "animationWorklet"].includes(
              resolveMemberProperty(object, scope) ?? "",
            ) && identifierName(object.object) === "CSS" &&
            isUnbound(scope, "CSS")
          ) {
            recordLoader(
              node,
              scope,
              `CSS.${resolveMemberProperty(object, scope)}.addModule`,
              args[0],
            );
          }
        }
      }
    } else if (node.type === "NewExpression") {
      const invocation = normalizeInvocation(node, scope);
      const args = invocation.arguments;
      const api = resolveApi(invocation.target, scope);
      const name = identifierName(node.callee);
      const globalWorker = isNode(node.callee) &&
        node.callee.type === "MemberExpression" &&
        identifierName(node.callee.object) === "globalThis" &&
        isUnbound(scope, "globalThis") &&
        ["Worker", "SharedWorker"].includes(
          memberPropertyName(node.callee) ?? "",
        );
      if (inspectExecutableInvocation(node, scope, invocation, api)) {
        // Executable-source sinks collapse all nested findings to this call.
      } else if (
        api === "node-worker" || api === "web-worker" ||
        api === "shared-worker" ||
        ["Worker", "SharedWorker"].includes(name ?? "") &&
          isUnbound(scope, name!) ||
        globalWorker
      ) {
        recordLoader(
          node,
          scope,
          api === "node-worker"
            ? "node:worker_threads.Worker"
            : api === "shared-worker"
            ? "SharedWorker"
            : api === "web-worker"
            ? "Worker"
            : name ?? memberPropertyName(node.callee) ?? "Worker",
          args[0],
        );
      } else if (
        isNode(node.callee) && node.callee.type === "MemberExpression" &&
        memberPropertyName(node.callee) === "Worker" &&
        resolveApi(node.callee.object, scope) === "worker-threads-namespace"
      ) {
        recordLoader(node, scope, "node:worker_threads.Worker", args[0]);
      } else if (
        api === "uncertain-runtime-loader" || api === "require-alias"
      ) {
        pushDependency(
          dependencies,
          file.path,
          node,
          "unresolved-runtime-loader",
          {
            loader: api === "require-alias"
              ? "require-alias"
              : "runtime-loader-alias",
          },
        );
      }
    }

    for (const child of childNodes(node)) inspect(child);
  };

  try {
    inspect(ast);
  } catch (error) {
    if (error instanceof SourceImportCollectorError) throw error;
    throw new SourceImportCollectorError(
      "traversal-failure",
      file.path,
      error instanceof Error ? error.message : String(error),
    );
  }
  analysisDiagnostics.executableSourceAnalyses =
    internal.executableAnalysis.analyses;
  analysisDiagnostics.executableSourceBudgetExhaustions =
    internal.executableAnalysis.budgetExhaustions;
  analysisDiagnostics.executableSourceCacheHits =
    internal.executableAnalysis.cacheHits;
  analysisDiagnostics.executableSourceCycleCuts =
    internal.executableAnalysis.cycleCuts;
  analysisDiagnostics.executableSourceDepthExhaustions =
    internal.executableAnalysis.depthExhaustions;
  options.onAnalysisDiagnostics?.({ ...analysisDiagnostics });
  dependencies.sort((left, right) =>
    left.line - right.line || left.column - right.column ||
    compareOrdinal(left.kind, right.kind) ||
    compareOrdinal(left.specifier ?? "", right.specifier ?? "") ||
    compareOrdinal(left.loader ?? "", right.loader ?? "")
  );
  return dependencies;
}
