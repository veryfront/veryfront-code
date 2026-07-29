import { parse } from "#babel/parser";
import { walk } from "#std/fs";
import { join, relative } from "#std/path";

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

interface LexicalScope {
  parent?: LexicalScope;
  bindings: Set<string>;
  functionScope: boolean;
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
  | "eval"
  | "uncertain-runtime-loader";

type ScopedValues<T> = WeakMap<LexicalScope, Map<string, T>>;
type ScopedMemberValues<T> = WeakMap<LexicalScope, Map<string, Map<string, T>>>;

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
        if (
          entryRealPath !== repositoryRealPath &&
          !entryRealPath.startsWith(`${repositoryRealPath}/`)
        ) {
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

function buildScopeMap(ast: AstNode): {
  scopeByNode: WeakMap<AstNode, LexicalScope>;
  programScope: LexicalScope;
} {
  const scopeByNode = new WeakMap<AstNode, LexicalScope>();
  let programScope: LexicalScope | undefined;

  function visit(node: AstNode, incomingScope?: LexicalScope): void {
    let scope = incomingScope;
    if (node.type === "File") {
      scope = { bindings: new Set(), functionScope: true };
    } else if (node.type === "Program") {
      scope ??= { bindings: new Set(), functionScope: true };
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

function unwrapAwait(node: unknown): unknown {
  let current = node;
  while (isNode(current)) {
    if (current.type === "AwaitExpression") {
      current = current.argument;
      continue;
    }
    if (
      current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSInstantiationExpression" ||
      current.type === "ParenthesizedExpression"
    ) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function propertyKeyName(node: AstNode): string | undefined {
  return identifierName(node.key) ?? literalString(node.key);
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

function getScopedMemberValue<T>(
  values: ScopedMemberValues<T>,
  scope: LexicalScope,
  ownerName: string,
  property: string,
): T | undefined {
  const bindingScope = closestBindingScope(scope, ownerName);
  return bindingScope
    ? values.get(bindingScope)?.get(ownerName)?.get(property)
    : undefined;
}

function setScopedMemberValue<T>(
  values: ScopedMemberValues<T>,
  scope: LexicalScope,
  ownerName: string,
  property: string,
  value: T,
): boolean {
  const bindingScope = closestBindingScope(scope, ownerName);
  if (!bindingScope) return false;
  let scoped = values.get(bindingScope);
  if (!scoped) {
    scoped = new Map();
    values.set(bindingScope, scoped);
  }
  let members = scoped.get(ownerName);
  if (!members) {
    members = new Map();
    scoped.set(ownerName, members);
  }
  if (members.get(property) === value) return false;
  members.set(property, value);
  return true;
}

function uncertainAlias(api: ApiBinding): ApiBinding {
  return api === "require" || api === "require-alias" ||
      api === "require-resolve" || api === "create-require"
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
  if (owner === "global-namespace") {
    if (property === "Worker") return "web-worker";
    if (property === "SharedWorker") return "shared-worker";
    if (property === "Function") return "Function";
    if (property === "eval") return "eval";
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

function bindObjectPatternFromOwner(
  pattern: AstNode,
  owner: ApiBinding | undefined,
  scope: LexicalScope,
  apiBindings: ScopedValues<ApiBinding>,
  transform: (api: ApiBinding) => ApiBinding = (api) => api,
): boolean {
  let changed = false;
  if (pattern.type !== "ObjectPattern") return false;
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (!isNode(property) || property.type !== "ObjectProperty") continue;
    const api = memberApi(owner, propertyKeyName(property));
    if (isNode(property.value) && property.value.type === "ObjectPattern") {
      changed = bindObjectPatternFromOwner(
        property.value,
        api,
        scope,
        apiBindings,
        transform,
      ) || changed;
      continue;
    }
    const local = identifierName(property.value) ||
      (isNode(property.value) && property.value.type === "AssignmentPattern"
        ? identifierName(property.value.left)
        : undefined);
    if (!local) continue;
    if (api) {
      changed = setScopedValue(apiBindings, scope, local, transform(api)) ||
        changed;
    }
  }
  return changed;
}

function bindObjectPatternApis(
  pattern: AstNode,
  moduleName: string,
  scope: LexicalScope,
  apiBindings: ScopedValues<ApiBinding>,
  transform: (api: ApiBinding) => ApiBinding = (api) => api,
): boolean {
  let changed = false;
  if (pattern.type !== "ObjectPattern") return false;
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (!isNode(property) || property.type !== "ObjectProperty") continue;
    const imported = propertyKeyName(property);
    const local = identifierName(property.value) ||
      (isNode(property.value) && property.value.type === "AssignmentPattern"
        ? identifierName(property.value.left)
        : undefined);
    if (!imported || !local) continue;
    const api = importedApi(moduleName, imported);
    if (api) {
      changed = setScopedValue(apiBindings, scope, local, transform(api)) ||
        changed;
    }
  }
  return changed;
}

function collectModuleBindings(
  ast: AstNode,
  scopeByNode: WeakMap<AstNode, LexicalScope>,
  filePath: string,
  options: SourceDependencyCollectionOptions,
): {
  stringValues: ScopedValues<string>;
  apiBindings: ScopedValues<ApiBinding>;
  resolveApi: (node: unknown, scope: LexicalScope) => ApiBinding | undefined;
  resolveMemberProperty: (
    node: unknown,
    scope: LexicalScope,
  ) => string | undefined;
} {
  const stringValues: ScopedValues<string> = new WeakMap();
  const apiBindings: ScopedValues<ApiBinding> = new WeakMap();
  const memberBindings: ScopedMemberValues<ApiBinding> = new WeakMap();
  const mutatedMemberBindings: WeakMap<LexicalScope, Set<string>> =
    new WeakMap();
  const memberMutations: Array<{ target: AstNode; scope: LexicalScope }> = [];
  const escapedValues: Array<{ value: unknown; scope: LexicalScope }> = [];
  const declarations: Array<{
    node: AstNode;
    scope: LexicalScope;
    kind: "const" | "let" | "var";
  }> = [];
  const assignmentPatterns: Array<{ node: AstNode; scope: LexicalScope }> = [];
  const assignments: Array<{ node: AstNode; scope: LexicalScope }> = [];
  const resolveModuleName = (specifier: string): string =>
    options.resolveModuleSpecifier?.(specifier, filePath) ?? specifier;

  const markMemberMutation = (
    target: unknown,
    scope: LexicalScope,
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
  };

  const visit = (node: AstNode): void => {
    const scope = scopeByNode.get(node);
    if (!scope) throw new Error(`missing lexical scope for ${node.type}`);
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
    }
    if (node.type === "AssignmentPattern") {
      assignmentPatterns.push({ node, scope });
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
          } else {
            const imported = identifierName(specifier.imported) ??
              literalString(specifier.imported);
            if (imported) api = importedApi(moduleName, imported);
          }
          if (api) setScopedValue(apiBindings, scope, local, api);
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
        : undefined;
      if (local && api) setScopedValue(apiBindings, scope, local, api);
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
        markMemberMutation(node.left, scope);
        memberMutations.push({ target: node.left, scope });
        escapedValues.push({ value: node.right, scope });
      }
      if (node.operator === "=") assignments.push({ node, scope });
    } else if (node.type === "UpdateExpression") {
      markMemberMutation(node.argument, scope);
      if (isNode(node.argument)) {
        memberMutations.push({ target: node.argument, scope });
      }
    } else if (node.type === "UnaryExpression" && node.operator === "delete") {
      markMemberMutation(node.argument, scope);
      if (isNode(node.argument)) {
        memberMutations.push({ target: node.argument, scope });
      }
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(ast);

  const evaluateString = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    const value = unwrapAwait(node);
    const literal = literalString(value);
    if (literal !== undefined) return literal;
    const name = identifierName(value);
    if (name) return getScopedValue(stringValues, scope, name);
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

  const importedModuleName = (
    node: unknown,
    scope: LexicalScope,
  ): string | undefined => {
    const unwrapped = unwrapAwait(node);
    if (!isNode(unwrapped)) return undefined;
    if (unwrapped.type === "ImportExpression") {
      const moduleName = evaluateString(unwrapped.source, scope);
      return moduleName === undefined
        ? undefined
        : resolveModuleName(moduleName);
    }
    if (
      unwrapped.type === "CallExpression" && isNode(unwrapped.callee) &&
      unwrapped.callee.type === "Import"
    ) {
      const args = Array.isArray(unwrapped.arguments)
        ? unwrapped.arguments
        : [];
      const moduleName = evaluateString(args[0], scope);
      return moduleName === undefined
        ? undefined
        : resolveModuleName(moduleName);
    }
    return undefined;
  };

  const apiForExpression = (
    node: unknown,
    scope: LexicalScope,
  ): ApiBinding | undefined => {
    const unwrapped = unwrapAwait(node);
    if (!isNode(unwrapped)) return undefined;
    if (
      unwrapped.type === "TSAsExpression" ||
      unwrapped.type === "TSTypeAssertion" ||
      unwrapped.type === "TSNonNullExpression" ||
      unwrapped.type === "ParenthesizedExpression"
    ) {
      return apiForExpression(unwrapped.expression, scope);
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
    const loadedModule = importedModuleName(unwrapped, scope) ??
      requiredModuleName(unwrapped, scope);
    if (loadedModule === "node:module") return "node-module-namespace";
    if (loadedModule === "node:worker_threads") {
      return "worker-threads-namespace";
    }
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
      const invoked = unwrapAwait(unwrapped.callee);
      if (
        isNode(invoked) &&
        (invoked.type === "ArrowFunctionExpression" ||
          invoked.type === "FunctionExpression")
      ) {
        let returnedApi: ApiBinding | undefined;
        if (isNode(invoked.body) && invoked.body.type !== "BlockStatement") {
          returnedApi = apiForExpression(invoked.body, scope);
        } else if (isNode(invoked.body)) {
          const returns =
            (Array.isArray(invoked.body.body) ? invoked.body.body : []).filter((
              statement,
            ) => isNode(statement) && statement.type === "ReturnStatement");
          const returnedApis = returns.map((statement) =>
            apiForExpression((statement as AstNode).argument, scope)
          ).filter((api): api is ApiBinding => api !== undefined);
          if (returnedApis.length > 0) {
            returnedApi = returnedApis.every((api) => api === returnedApis[0])
              ? returnedApis[0]
              : "uncertain-runtime-loader";
          }
        }
        if (returnedApi) return uncertainAlias(returnedApi);
      }
      if (apiForExpression(unwrapped.callee, scope) === "create-require") {
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
      const bound = getScopedValue(apiBindings, scope, name);
      if (bound) return bound;
      if (!isUnbound(scope, name)) return undefined;
      if (name === "require") return "require-alias";
      if (name === "Function") return "Function";
      if (name === "eval") return "eval";
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
    const ownerName = identifierName(unwrapped.object);
    if (ownerName && property) {
      const boundMember = getScopedMemberValue(
        memberBindings,
        scope,
        ownerName,
        property,
      );
      if (boundMember) return boundMember;
    }
    return memberApi(apiForExpression(unwrapped.object, scope), property);
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

  let changed = true;
  while (changed) {
    changed = false;
    for (const { node: pattern, scope } of assignmentPatterns) {
      const name = identifierName(pattern.left);
      const api = apiForExpression(pattern.right, scope);
      if (name && api) {
        changed = setScopedValue(
          apiBindings,
          scope,
          name,
          uncertainAlias(api),
        ) || changed;
      }
    }
    for (const { node: declaration, scope, kind } of declarations) {
      if (!isNode(declaration.id)) continue;
      const moduleName = importedModuleName(declaration.init, scope) ??
        requiredModuleName(declaration.init, scope);
      if (moduleName && declaration.id.type === "ObjectPattern") {
        changed = bindObjectPatternApis(
          declaration.id,
          moduleName,
          scope,
          apiBindings,
        ) || changed;
      } else if (moduleName && declaration.id.type === "Identifier") {
        const api = moduleName === "node:module"
          ? "node-module-namespace"
          : moduleName === "node:worker_threads"
          ? "worker-threads-namespace"
          : undefined;
        if (api) {
          changed = setScopedValue(
            apiBindings,
            scope,
            declaration.id.name as string,
            api,
          ) ||
            changed;
        }
      }

      if (declaration.id.type === "ObjectPattern") {
        const objectPatternInit = unwrapAwait(declaration.init);
        changed = bindObjectPatternFromOwner(
          declaration.id,
          isNode(objectPatternInit) &&
            (objectPatternInit.type === "ObjectExpression" ||
              objectPatternInit.type === "ArrayExpression")
            ? undefined
            : apiForExpression(declaration.init, scope),
          scope,
          apiBindings,
        ) || changed;
        const ownerName = identifierName(unwrapAwait(declaration.init));
        if (ownerName) {
          for (
            const property of Array.isArray(declaration.id.properties)
              ? declaration.id.properties
              : []
          ) {
            if (!isNode(property) || property.type !== "ObjectProperty") {
              continue;
            }
            const key = propertyKeyName(property);
            const local = identifierName(property.value) ??
              (isNode(property.value) &&
                  property.value.type === "AssignmentPattern"
                ? identifierName(property.value.left)
                : undefined);
            const api = key
              ? getScopedMemberValue(memberBindings, scope, ownerName, key)
              : undefined;
            if (local && api) {
              changed = setScopedValue(
                apiBindings,
                scope,
                local,
                uncertainAlias(api),
              ) || changed;
            }
          }
        }
        if (
          isNode(declaration.init) &&
          declaration.init.type === "ObjectExpression"
        ) {
          const valuesByKey = new Map<string, unknown>();
          for (
            const property of Array.isArray(declaration.init.properties)
              ? declaration.init.properties
              : []
          ) {
            if (!isNode(property) || property.type !== "ObjectProperty") {
              continue;
            }
            const key = propertyKeyName(property);
            if (key) valuesByKey.set(key, property.value);
          }
          for (
            const property of Array.isArray(declaration.id.properties)
              ? declaration.id.properties
              : []
          ) {
            if (!isNode(property) || property.type !== "ObjectProperty") {
              continue;
            }
            const key = propertyKeyName(property);
            const value = key ? valuesByKey.get(key) : undefined;
            const local = identifierName(property.value) ??
              (isNode(property.value) &&
                  property.value.type === "AssignmentPattern"
                ? identifierName(property.value.left)
                : undefined);
            const api = apiForExpression(value, scope);
            if (local && api) {
              changed = setScopedValue(
                apiBindings,
                scope,
                local,
                uncertainAlias(api),
              ) || changed;
            }
          }
        }
      } else if (declaration.id.type === "ArrayPattern") {
        const patterns = Array.isArray(declaration.id.elements)
          ? declaration.id.elements
          : [];
        const init = unwrapAwait(declaration.init);
        const values = isNode(init) && init.type === "ArrayExpression" &&
            Array.isArray(init.elements)
          ? init.elements
          : [];
        const ownerName = identifierName(init);
        patterns.forEach((pattern, index) => {
          const local = identifierName(pattern) ??
            (isNode(pattern) && pattern.type === "AssignmentPattern"
              ? identifierName(pattern.left)
              : undefined);
          const api = ownerName
            ? getScopedMemberValue(
              memberBindings,
              scope,
              ownerName,
              String(index),
            )
            : apiForExpression(values[index], scope);
          if (local && api) {
            changed = setScopedValue(
              apiBindings,
              scope,
              local,
              uncertainAlias(api),
            ) || changed;
          }
        });
      }

      const declaredName = identifierName(declaration.id);
      if (
        declaredName && isNode(declaration.init) &&
        declaration.init.type === "ObjectExpression"
      ) {
        for (
          const property of Array.isArray(declaration.init.properties)
            ? declaration.init.properties
            : []
        ) {
          if (!isNode(property) || property.type !== "ObjectProperty") continue;
          const propertyName = propertyKeyName(property);
          const memberApiBinding = apiForExpression(property.value, scope);
          if (propertyName && memberApiBinding) {
            changed = setScopedMemberValue(
              memberBindings,
              scope,
              declaredName,
              propertyName,
              uncertainAlias(memberApiBinding),
            ) || changed;
          }
        }
      } else if (
        declaredName && isNode(declaration.init) &&
        declaration.init.type === "ArrayExpression"
      ) {
        for (
          const [index, value] of (Array.isArray(declaration.init.elements)
            ? declaration.init.elements
            : []).entries()
        ) {
          const memberApiBinding = apiForExpression(value, scope);
          if (memberApiBinding) {
            changed = setScopedMemberValue(
              memberBindings,
              scope,
              declaredName,
              String(index),
              uncertainAlias(memberApiBinding),
            ) || changed;
          }
        }
      }

      const init = unwrapAwait(declaration.init);
      if (
        declaration.id.type === "ArrayPattern" && isNode(init) &&
        init.type === "CallExpression" && isNode(init.callee) &&
        init.callee.type === "MemberExpression" &&
        identifierName(init.callee.object) === "Promise" &&
        isUnbound(scope, "Promise") && memberPropertyName(init.callee) === "all"
      ) {
        const callArgs = Array.isArray(init.arguments) ? init.arguments : [];
        const modules =
          isNode(callArgs[0]) && callArgs[0].type === "ArrayExpression"
            ? (Array.isArray(callArgs[0].elements) ? callArgs[0].elements : [])
            : [];
        const patterns = Array.isArray(declaration.id.elements)
          ? declaration.id.elements
          : [];
        patterns.forEach((pattern, index) => {
          if (!isNode(pattern)) return;
          const imported = importedModuleName(modules[index], scope);
          if (imported) {
            changed = bindObjectPatternApis(
              pattern,
              imported,
              scope,
              apiBindings,
            ) || changed;
          }
        });
      }

      const name = identifierName(declaration.id);
      if (!name) continue;
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
      if (value !== undefined) {
        changed = setScopedValue(stringValues, scope, name, value) || changed;
      }
      const declarationInit = unwrapAwait(declaration.init);
      let api = isNode(declarationInit) &&
          (declarationInit.type === "ObjectExpression" ||
            declarationInit.type === "ArrayExpression")
        ? undefined
        : apiForExpression(declaration.init, scope);
      if (
        isNode(declaration.init) && declaration.init.type === "CallExpression"
      ) {
        const calleeApi = apiForExpression(declaration.init.callee, scope);
        if (calleeApi === "create-require") api = "require";
      }
      if (kind !== "const" && api) api = uncertainAlias(api);
      if (api) {
        changed = setScopedValue(apiBindings, scope, name, api) || changed;
      }
    }
    for (const { node: assignment, scope } of assignments) {
      const api = apiForExpression(assignment.right, scope);
      if (isNode(assignment.left) && assignment.left.type === "ObjectPattern") {
        const moduleName = importedModuleName(assignment.right, scope) ??
          requiredModuleName(assignment.right, scope);
        if (moduleName) {
          changed = bindObjectPatternApis(
            assignment.left,
            moduleName,
            scope,
            apiBindings,
            uncertainAlias,
          ) || changed;
        } else if (api) {
          changed = bindObjectPatternFromOwner(
            assignment.left,
            api,
            scope,
            apiBindings,
            uncertainAlias,
          ) || changed;
        }
        continue;
      }
      if (!api) continue;
      const name = identifierName(assignment.left);
      if (name) {
        changed = setScopedValue(
          apiBindings,
          scope,
          name,
          uncertainAlias(api),
        ) || changed;
        continue;
      }
      if (
        isNode(assignment.left) &&
        (assignment.left.type === "MemberExpression" ||
          assignment.left.type === "OptionalMemberExpression")
      ) {
        const ownerName = identifierName(assignment.left.object);
        const property = memberPropertyName(assignment.left);
        if (ownerName && property) {
          changed = setScopedMemberValue(
            memberBindings,
            scope,
            ownerName,
            property,
            uncertainAlias(api),
          ) || changed;
        }
      }
    }
  }

  return {
    stringValues,
    apiBindings,
    resolveApi: apiForExpression,
    resolveMemberProperty: resolvedMemberProperty,
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

function loaderSourceContainsModuleLoad(
  source: string,
  isVisibleLoaderIdentifier: (name: string) => boolean = () => false,
): boolean {
  let generatedAst: AstNode;
  try {
    generatedAst = parse(source, {
      sourceType: "unambiguous",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "importAttributes"],
    }) as unknown as AstNode;
  } catch {
    return true;
  }
  let found = false;
  const inspect = (node: AstNode): void => {
    if (found) return;
    if (node.type === "ImportExpression") {
      found = true;
      return;
    }
    if (node.type === "Identifier") {
      const name = identifierName(node) ?? "";
      if (
        [
          "require",
          "importScripts",
          "eval",
          "Function",
          "Worker",
          "SharedWorker",
        ].includes(name) || isVisibleLoaderIdentifier(name)
      ) {
        found = true;
        return;
      }
    }
    if (
      (node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression") &&
      ["resolve", "addModule", "register", "importScripts"].includes(
        memberPropertyName(node) ?? "",
      )
    ) {
      found = true;
      return;
    }
    if (
      node.type === "CallExpression" || node.type === "OptionalCallExpression"
    ) {
      const callee = node.callee;
      const name = identifierName(callee);
      if (
        isNode(callee) && callee.type === "Import" ||
        ["require", "importScripts", "eval", "Function"].includes(name ?? "") ||
        ["resolve", "addModule", "register"].includes(
          memberPropertyName(callee) ?? "",
        )
      ) {
        found = true;
        return;
      }
    }
    if (node.type === "NewExpression") {
      const name = identifierName(node.callee) ??
        memberPropertyName(node.callee);
      if (["Worker", "SharedWorker", "Function"].includes(name ?? "")) {
        found = true;
        return;
      }
    }
    for (const child of childNodes(node)) inspect(child);
  };
  inspect(generatedAst);
  return found;
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
  let ast: AstNode;
  try {
    ast = parse(file.content, {
      sourceType: "unambiguous",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: parserPluginsForPath(file.path),
    }) as unknown as AstNode;
  } catch (error) {
    throw new SourceImportCollectorError(
      "parse-failure",
      file.path,
      error instanceof Error ? error.message : String(error),
    );
  }

  let scopeByNode: WeakMap<AstNode, LexicalScope>;
  let stringValues: ScopedValues<string>;
  let resolveApi: (
    node: unknown,
    scope: LexicalScope,
  ) => ApiBinding | undefined;
  let resolveMemberProperty: (
    node: unknown,
    scope: LexicalScope,
  ) => string | undefined;
  try {
    ({ scopeByNode } = buildScopeMap(ast));
    ({ stringValues, resolveApi, resolveMemberProperty } =
      collectModuleBindings(
        ast,
        scopeByNode,
        file.path,
        options,
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

  const inspect = (node: AstNode): void => {
    const scope = scopeByNode.get(node);
    if (!scope) {
      throw new SourceImportCollectorError(
        "binding-resolution-failure",
        file.path,
        `missing lexical scope for ${node.type}`,
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
        const directApi = resolveApi(node.callee, scope);
        const indirectMethod = isNode(node.callee) &&
            (node.callee.type === "MemberExpression" ||
              node.callee.type === "OptionalMemberExpression")
          ? memberPropertyName(node.callee)
          : undefined;
        const indirectApi =
          indirectMethod === "call" || indirectMethod === "apply"
            ? resolveApi((node.callee as AstNode).object, scope)
            : undefined;
        const calleeName = identifierName(node.callee);
        const reflectMethod = isNode(node.callee) &&
            (node.callee.type === "MemberExpression" ||
              node.callee.type === "OptionalMemberExpression") &&
            identifierName(node.callee.object) === "Reflect" &&
            isUnbound(scope, "Reflect")
          ? resolveMemberProperty(node.callee, scope)
          : undefined;
        const reflectedApi = reflectMethod === "apply" ||
            reflectMethod === "construct"
          ? resolveApi(args[0], scope)
          : undefined;
        const reflectedLoader = reflectedApi
          ? unresolvedLoaderForApi(reflectedApi)
          : undefined;
        const generatedFunctionReceivesLoader = isNode(node.callee) &&
          (node.callee.type === "CallExpression" ||
            node.callee.type === "NewExpression") &&
          resolveApi(node.callee.callee, scope) === "Function" &&
          args.some((argument) => resolveApi(argument, scope) !== undefined);
        if (generatedFunctionReceivesLoader) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            { loader: "Function" },
          );
        } else if (reflectedLoader !== undefined) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            { loader: reflectedLoader },
          );
        } else if (directApi === "import-meta-resolve") {
          recordLoader(node, scope, "import.meta.resolve", args[0]);
        } else if (
          (calleeName === "require" && isUnbound(scope, "require")) ||
          directApi === "require"
        ) {
          recordLoader(node, scope, "require", args[0]);
        } else if (
          indirectApi === "require" || indirectApi === "require-alias" ||
          indirectApi === "require-resolve"
        ) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: indirectApi === "require-resolve"
                ? "require.resolve"
                : "require-alias",
            },
          );
        } else if (indirectApi && loaderForApi(indirectApi)) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            { loader: loaderForApi(indirectApi) },
          );
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
        } else if (
          (calleeName === "eval" && isUnbound(scope, "eval")) ||
          directApi === "eval" ||
          indirectApi === "eval"
        ) {
          const body = resolvedString(
            indirectApi === "eval"
              ? indirectMethod === "call" ? args[1] : undefined
              : args[0],
            stringValues,
            scope,
          );
          const directEval = calleeName === "eval" &&
            isUnbound(scope, "eval") && indirectApi === undefined;
          if (
            body === undefined ||
            loaderSourceContainsModuleLoad(
              body,
              directEval
                ? (name) =>
                  resolveApi({ type: "Identifier", name }, scope) !== undefined
                : undefined,
            )
          ) {
            pushDependency(
              dependencies,
              file.path,
              node,
              "unresolved-runtime-loader",
              {
                loader: "eval",
              },
            );
          }
        } else if (
          (calleeName === "Function" && isUnbound(scope, "Function")) ||
          directApi === "Function" || indirectApi === "Function"
        ) {
          const body = resolvedString(
            indirectApi === "Function" && indirectMethod === "apply"
              ? undefined
              : args.at(-1),
            stringValues,
            scope,
          );
          if (body === undefined || loaderSourceContainsModuleLoad(body)) {
            pushDependency(
              dependencies,
              file.path,
              node,
              "unresolved-runtime-loader",
              {
                loader: "Function",
              },
            );
          }
        }
      }
    } else if (node.type === "NewExpression") {
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const api = resolveApi(node.callee, scope);
      const name = identifierName(node.callee);
      const globalWorker = isNode(node.callee) &&
        node.callee.type === "MemberExpression" &&
        identifierName(node.callee.object) === "globalThis" &&
        isUnbound(scope, "globalThis") &&
        ["Worker", "SharedWorker"].includes(
          memberPropertyName(node.callee) ?? "",
        );
      if (
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
      } else if (
        (name === "Function" && isUnbound(scope, "Function")) ||
        api === "Function"
      ) {
        const body = resolvedString(args.at(-1), stringValues, scope);
        if (body === undefined || loaderSourceContainsModuleLoad(body)) {
          pushDependency(
            dependencies,
            file.path,
            node,
            "unresolved-runtime-loader",
            {
              loader: "Function",
            },
          );
        }
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
  dependencies.sort((left, right) =>
    left.line - right.line || left.column - right.column ||
    compareOrdinal(left.kind, right.kind) ||
    compareOrdinal(left.specifier ?? "", right.specifier ?? "") ||
    compareOrdinal(left.loader ?? "", right.loader ?? "")
  );
  return dependencies;
}
