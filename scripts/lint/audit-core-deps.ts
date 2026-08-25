import { walk } from "#std/fs";
import { parseSource } from "./style-conventions/ast.ts";
import type { AstNodeLike } from "./style-conventions/types.ts";

export interface CoreDependencyIssue {
  specifier: string;
  target: string;
}

export interface CoreSourceDependencyIssue {
  path: string;
  line: number;
  specifier: string;
}

export interface RootNpmSpecifierLiteralIssue {
  path: string;
  value: string;
}

const CORE_THIRD_PARTY_IMPORT_ALLOWLIST = new Set<string>();

function isThirdPartyImportTarget(target: string): boolean {
  if (target.startsWith("./") || target.startsWith("../")) return false;
  if (target.startsWith("jsr:@std/")) return false;
  return target.startsWith("npm:") || target.startsWith("jsr:") ||
    target.startsWith("http://") || target.startsWith("https://");
}

function importMapTargetForSpecifier(
  imports: Record<string, string>,
  specifier: string,
): string | undefined {
  const exact = imports[specifier];
  if (exact) return exact;

  let bestPrefix: string | undefined;
  for (const prefix of Object.keys(imports)) {
    if (!prefix.endsWith("/") || !specifier.startsWith(prefix)) continue;
    if (!bestPrefix || prefix.length > bestPrefix.length) bestPrefix = prefix;
  }
  if (!bestPrefix) return undefined;
  return `${imports[bestPrefix]}${specifier.slice(bestPrefix.length)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function shouldCheckCoreSourceImportPath(path: string): boolean {
  const normalized = normalizePath(path);
  // `templates/` is deliberately absent: scaffolded project sources are not
  // framework source and are excluded by living outside `src/` and `cli/`.
  if (!normalized.startsWith("src/") && !normalized.startsWith("cli/")) {
    return false;
  }
  if (
    normalized.includes("/__fixtures__/") || normalized.includes("/fixtures/")
  ) return false;
  if (normalized.endsWith("/_test-setup.ts")) return false;
  if (/\.(?:test|integration|e2e|bench)\.[cm]?[tj]sx?$/.test(normalized)) {
    return false;
  }
  return /\.(?:[cm]?ts|tsx)$/.test(normalized);
}

function isAllowedCoreSourceSpecifier(
  specifier: string,
  allowedSpecifiers: ReadonlySet<string>,
  importMap: Record<string, string>,
): boolean {
  if (
    specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier.startsWith("/")
  ) {
    return true;
  }
  if (specifier.startsWith("#")) return true;
  if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
    return true;
  }
  if (specifier.startsWith("@veryfront/")) return true;
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith("jsr:@std/")) return true;
  const mappedTarget = importMapTargetForSpecifier(importMap, specifier);
  if (mappedTarget && !isThirdPartyImportTarget(mappedTarget)) return true;
  return allowedSpecifiers.has(specifier);
}

interface StaticBinding {
  initializer: AstNodeLike;
  scope: LexicalScope;
}

interface LexicalScope {
  parent?: LexicalScope;
  bindings: Map<string, StaticBinding | null>;
  variableScope: LexicalScope;
}

interface SourceImport {
  expression: AstNodeLike;
  line: number;
  scope: LexicalScope;
}

const FUNCTION_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
]);
const EXPRESSION_WRAPPER_TYPES = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TypeCastExpression",
]);

function isAstNode(value: unknown): value is AstNodeLike {
  return typeof value === "object" && value !== null &&
    typeof (value as AstNodeLike).type === "string";
}

function childNodes(node: AstNodeLike): AstNodeLike[] {
  const children: AstNodeLike[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" || key === "start" || key === "end" || key === "extra" ||
      key.endsWith("Comments")
    ) continue;
    if (Array.isArray(value)) {
      for (const entry of value) if (isAstNode(entry)) children.push(entry);
    } else if (isAstNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function bindPattern(scope: LexicalScope, pattern: unknown): void {
  if (!isAstNode(pattern)) return;
  if (pattern.type === "Identifier" && typeof pattern.name === "string") {
    scope.bindings.set(pattern.name, null);
    return;
  }
  if (pattern.type === "AssignmentPattern" || pattern.type === "RestElement") {
    bindPattern(
      scope,
      pattern.type === "AssignmentPattern" ? pattern.left : pattern.argument,
    );
    return;
  }
  if (pattern.type === "ArrayPattern" && Array.isArray(pattern.elements)) {
    for (const element of pattern.elements) bindPattern(scope, element);
    return;
  }
  if (pattern.type === "ObjectPattern" && Array.isArray(pattern.properties)) {
    for (const property of pattern.properties) {
      if (!isAstNode(property)) continue;
      bindPattern(
        scope,
        property.type === "ObjectProperty" ? property.value : property.argument,
      );
    }
    return;
  }
  if (pattern.type === "TSParameterProperty") {
    bindPattern(scope, pattern.parameter);
  }
}

function createScope(
  parent?: LexicalScope,
  ownsVariables = false,
): LexicalScope {
  const scope = {
    parent,
    bindings: new Map<string, StaticBinding | null>(),
  } as LexicalScope;
  scope.variableScope = ownsVariables ? scope : parent?.variableScope ?? scope;
  return scope;
}

function collectScopes(
  node: AstNodeLike,
  scope: LexicalScope,
  nodeScopes: WeakMap<object, LexicalScope>,
): void {
  nodeScopes.set(node, scope);

  if (
    (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") &&
    isAstNode(node.id) && node.id.type === "Identifier" &&
    typeof node.id.name === "string"
  ) {
    scope.bindings.set(node.id.name, null);
  }

  if (FUNCTION_NODE_TYPES.has(node.type ?? "")) {
    const parameterScope = createScope(scope);
    const bodyScope = createScope(parameterScope, true);
    if (node.type === "FunctionExpression") {
      bindPattern(parameterScope, node.id);
    }
    const parameters = Array.isArray(node.params)
      ? node.params.filter(isAstNode)
      : [];
    for (const parameter of parameters) {
      bindPattern(parameterScope, parameter);
    }
    const decorators = Array.isArray(node.decorators)
      ? node.decorators.filter(isAstNode)
      : [];
    const isMethod = node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod" || node.type === "ObjectMethod";
    for (const child of childNodes(node)) {
      if (child === node.id) continue;
      const evaluatedOutsideFunction = isMethod &&
        (child === node.key || decorators.includes(child));
      collectScopes(
        child,
        child === node.body
          ? bodyScope
          : evaluatedOutsideFunction
          ? scope
          : parameterScope,
        nodeScopes,
      );
    }
    return;
  }

  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    const classScope = createScope(scope);
    bindPattern(classScope, node.id);
    for (const child of childNodes(node)) {
      if (child !== node.id) collectScopes(child, classScope, nodeScopes);
    }
    return;
  }

  if (
    node.type === "BlockStatement" || node.type === "CatchClause" ||
    node.type === "ClassBody" || node.type === "StaticBlock" ||
    node.type === "SwitchStatement" || node.type === "TSModuleBlock"
  ) {
    const blockScope = createScope(
      scope,
      node.type === "StaticBlock" || node.type === "TSModuleBlock",
    );
    if (node.type === "CatchClause") bindPattern(blockScope, node.param);
    for (const child of childNodes(node)) {
      if (child !== node.param) collectScopes(child, blockScope, nodeScopes);
    }
    return;
  }

  if (
    node.type === "ForStatement" || node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const loopScope = createScope(scope);
    for (const child of childNodes(node)) {
      collectScopes(child, loopScope, nodeScopes);
    }
    return;
  }

  if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
    const declarationScope = node.kind === "var" ? scope.variableScope : scope;
    for (const declaration of node.declarations) {
      if (!isAstNode(declaration)) continue;
      const id = declaration.id;
      const initializer = declaration.init;
      if (
        node.kind === "const" && isAstNode(id) && id.type === "Identifier" &&
        typeof id.name === "string" && isAstNode(initializer)
      ) {
        declarationScope.bindings.set(id.name, {
          initializer,
          scope: declarationScope,
        });
      } else {
        bindPattern(declarationScope, id);
      }
    }
  }

  if (node.type === "ImportDeclaration" && Array.isArray(node.specifiers)) {
    for (const specifier of node.specifiers) {
      if (isAstNode(specifier)) bindPattern(scope, specifier.local);
    }
  }

  for (const child of childNodes(node)) collectScopes(child, scope, nodeScopes);
}

function resolveBinding(
  scope: LexicalScope,
  name: string,
): StaticBinding | null | undefined {
  for (
    let current: LexicalScope | undefined = scope;
    current;
    current = current.parent
  ) {
    if (current.bindings.has(name)) return current.bindings.get(name);
  }
  return undefined;
}

function propertyName(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function evaluateStaticString(
  node: AstNodeLike,
  scope: LexicalScope,
  resolving = new Set<StaticBinding>(),
  depth = 0,
): string | undefined {
  if (depth > 32) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    if (quasis.length !== expressions.length + 1) return undefined;
    let result = "";
    for (let index = 0; index < quasis.length; index++) {
      const quasi = quasis[index];
      if (
        !isAstNode(quasi) || !quasi.value || typeof quasi.value !== "object"
      ) {
        return undefined;
      }
      const value = quasi.value as Record<string, unknown>;
      const text = typeof value.cooked === "string"
        ? value.cooked
        : typeof value.raw === "string"
        ? value.raw
        : undefined;
      if (text === undefined) return undefined;
      result += text;
      if (index < expressions.length) {
        const expression = expressions[index];
        if (!isAstNode(expression)) return undefined;
        const evaluated = evaluateStaticString(
          expression,
          scope,
          resolving,
          depth + 1,
        );
        if (evaluated === undefined) return undefined;
        result += evaluated;
      }
    }
    return result;
  }
  if (node.type === "Identifier" && typeof node.name === "string") {
    const binding = resolveBinding(scope, node.name);
    if (!binding || resolving.has(binding)) return undefined;
    resolving.add(binding);
    const value = evaluateStaticString(
      binding.initializer,
      binding.scope,
      resolving,
      depth + 1,
    );
    resolving.delete(binding);
    return value;
  }
  if (
    EXPRESSION_WRAPPER_TYPES.has(node.type ?? "") && isAstNode(node.expression)
  ) {
    return evaluateStaticString(node.expression, scope, resolving, depth + 1);
  }
  if (
    node.type === "BinaryExpression" && node.operator === "+" &&
    isAstNode(node.left) && isAstNode(node.right)
  ) {
    const left = evaluateStaticString(node.left, scope, resolving, depth + 1);
    const right = evaluateStaticString(node.right, scope, resolving, depth + 1);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (node.type !== "CallExpression" || !isAstNode(node.callee)) {
    return undefined;
  }
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" || !isAstNode(callee.object) ||
    (callee.computed === true &&
      (!isAstNode(callee.property) ||
        callee.property.type !== "StringLiteral")) ||
    propertyName(callee.property) !== "join" ||
    callee.object.type !== "ArrayExpression"
  ) return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  if (args.length > 1) return undefined;
  let separator = ",";
  if (args.length === 1) {
    const argument = args[0];
    if (!isAstNode(argument)) return undefined;
    const evaluated = evaluateStaticString(
      argument,
      scope,
      resolving,
      depth + 1,
    );
    if (evaluated === undefined) return undefined;
    separator = evaluated;
  }
  const elements = Array.isArray(callee.object.elements)
    ? callee.object.elements
    : [];
  const values: string[] = [];
  for (const element of elements) {
    if (element === null) {
      values.push("");
      continue;
    }
    if (!isAstNode(element) || element.type === "SpreadElement") {
      return undefined;
    }
    const evaluated = evaluateStaticString(
      element,
      scope,
      resolving,
      depth + 1,
    );
    if (evaluated === undefined) return undefined;
    values.push(evaluated);
  }
  return values.join(separator);
}

function importExpression(node: AstNodeLike): AstNodeLike | undefined {
  if (
    (node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration") && isAstNode(node.source)
  ) return node.source;
  if (node.type === "ImportExpression" && isAstNode(node.source)) {
    return node.source;
  }
  if (node.type === "TSImportType" && isAstNode(node.argument)) {
    return node.argument;
  }
  if (node.type === "TSExternalModuleReference" && isAstNode(node.expression)) {
    return node.expression;
  }
  if (
    node.type === "CallExpression" && isAstNode(node.callee) &&
    node.callee.type === "Import" && Array.isArray(node.arguments) &&
    isAstNode(node.arguments[0])
  ) return node.arguments[0];
  return undefined;
}

function findSourceImports(path: string, content: string): SourceImport[] {
  const ast = parseSource(path, content);
  const rootScope = createScope(undefined, true);
  const nodeScopes = new WeakMap<object, LexicalScope>();
  collectScopes(ast, rootScope, nodeScopes);
  const imports: SourceImport[] = [];
  const visit = (node: AstNodeLike): void => {
    const expression = importExpression(node);
    if (expression) {
      imports.push({
        expression,
        line: node.loc?.start?.line ?? 1,
        scope: nodeScopes.get(expression) ?? rootScope,
      });
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(ast);
  return imports;
}

export function findCoreThirdPartyImports(
  config: { imports?: Record<string, string> },
  options: { allowedSpecifiers?: ReadonlySet<string> } = {},
): CoreDependencyIssue[] {
  const allowedSpecifiers = options.allowedSpecifiers ??
    CORE_THIRD_PARTY_IMPORT_ALLOWLIST;
  const issues: CoreDependencyIssue[] = [];

  for (const [specifier, target] of Object.entries(config.imports ?? {})) {
    if (!isThirdPartyImportTarget(target)) continue;
    if (allowedSpecifiers.has(specifier)) continue;
    issues.push({ specifier, target });
  }

  return issues;
}

function formatJsonPathProperty(property: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)) return `.${property}`;
  return `[${JSON.stringify(property)}]`;
}

function collectRootNpmSpecifierLiterals(
  value: unknown,
  path: string,
  issues: RootNpmSpecifierLiteralIssue[],
): void {
  if (typeof value === "string") {
    if (
      value.startsWith("npm:") &&
      !/^minimumDependencyAge\.exclude\[\d+\]$/.test(path)
    ) {
      issues.push({ path, value });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectRootNpmSpecifierLiterals(entry, `${path}[${index}]`, issues)
    );
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [property, entry] of Object.entries(value)) {
    const nextPath = path
      ? `${path}${formatJsonPathProperty(property)}`
      : property;
    collectRootNpmSpecifierLiterals(entry, nextPath, issues);
  }
}

export function findRootNpmSpecifierLiterals(
  config: unknown,
): RootNpmSpecifierLiteralIssue[] {
  const issues: RootNpmSpecifierLiteralIssue[] = [];
  collectRootNpmSpecifierLiterals(config, "", issues);
  return issues;
}

export function findCoreThirdPartySourceImports(
  files: Array<{ path: string; content: string }>,
  options: {
    allowedSpecifiers?: ReadonlySet<string>;
    importMap?: Record<string, string>;
  } = {},
): CoreSourceDependencyIssue[] {
  const allowedSpecifiers = options.allowedSpecifiers ??
    CORE_THIRD_PARTY_IMPORT_ALLOWLIST;
  const importMap = options.importMap ?? {};
  const issues: CoreSourceDependencyIssue[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!shouldCheckCoreSourceImportPath(path)) continue;

    const seen = new Set<string>();
    for (const sourceImport of findSourceImports(path, file.content)) {
      const dynamicSpecifier = evaluateStaticString(
        sourceImport.expression,
        sourceImport.scope,
      );
      if (
        dynamicSpecifier &&
        !isAllowedCoreSourceSpecifier(
          dynamicSpecifier,
          allowedSpecifiers,
          importMap,
        )
      ) {
        const key = `${sourceImport.line}\0${dynamicSpecifier}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({
            path,
            line: sourceImport.line,
            specifier: dynamicSpecifier,
          });
        }
      }
    }
  }

  return issues;
}

async function readCoreSourceFiles(): Promise<
  Array<{ path: string; content: string }>
> {
  const files: Array<{ path: string; content: string }> = [];

  for await (
    const entry of walk(".", {
      exts: [".ts", ".tsx", ".mts", ".cts"],
      skip: [
        /\bnode_modules\b/,
        /\bdist\b/,
        /\bcoverage\b/,
        /^\.\.?(?:\/|$)/,
        /^\.\/\.git(?:\/|$)/,
        /^\.\/\.omx(?:\/|$)/,
        /^\.\/\.worktrees(?:\/|$)/,
        /^\.\/npm(?:\/|$)/,
        /^\.\/projects(?:\/|$)/,
        /^\.\/data(?:\/|$)/,
        /^\.\/extensions(?:\/|$)/,
      ],
    })
  ) {
    if (!entry.isFile) continue;
    if (!shouldCheckCoreSourceImportPath(entry.path)) continue;
    files.push({
      path: normalizePath(entry.path),
      content: await Deno.readTextFile(entry.path),
    });
  }

  return files;
}

if (import.meta.main) {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const rootNpmLiteralIssues = findRootNpmSpecifierLiterals(config);
  const importMapIssues = findCoreThirdPartyImports(config);
  const sourceIssues = findCoreThirdPartySourceImports(
    await readCoreSourceFiles(),
    { importMap: config.imports ?? {} },
  );

  if (
    rootNpmLiteralIssues.length === 0 && importMapIssues.length === 0 &&
    sourceIssues.length === 0
  ) {
    console.log(
      "No disallowed third-party imports found in core deno.json or source files.",
    );
    Deno.exit(0);
  }

  if (rootNpmLiteralIssues.length > 0) {
    console.error(
      `${rootNpmLiteralIssues.length} npm specifier literal(s) in root deno.json:`,
    );
    for (const issue of rootNpmLiteralIssues) {
      console.error(`  ${issue.path}: ${issue.value}`);
    }
  }

  if (importMapIssues.length > 0) {
    console.error(
      `${importMapIssues.length} disallowed third-party import(s) in core deno.json:`,
    );
    for (const issue of importMapIssues) {
      console.error(`  ${issue.specifier}: ${issue.target}`);
    }
  }

  if (sourceIssues.length > 0) {
    console.error(
      `${sourceIssues.length} disallowed third-party import(s) in core source files:`,
    );
    for (const issue of sourceIssues) {
      console.error(`  ${issue.path}:${issue.line} imports ${issue.specifier}`);
    }
  }

  Deno.exit(1);
}
