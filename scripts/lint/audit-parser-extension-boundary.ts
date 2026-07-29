import { BabelParseOnlyParser } from "@veryfront/ext-parser-babel/parser-only";
import type { ASTNode } from "veryfront/extensions/parser";

const PARSER_EXTENSION_PACKAGE = "@veryfront/ext-parser-parse5";
const PARSER_ONLY_SPECIFIER = `${PARSER_EXTENSION_PACKAGE}/parser-only`;
const PARSER_ONLY_CORE_OWNER = "src/html/head-boundary.ts";

const SOURCE_EXTENSION_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export interface ParserExtensionSourceFile {
  path: string;
  content: string;
}

export interface UnauthorizedParserExtensionImport {
  path: string;
  line: number;
  specifier: string;
}

interface LexicalScope {
  readonly parent?: LexicalScope;
  readonly bindings: Set<string>;
  readonly functionScope: boolean;
}

function isNode(value: unknown): value is ASTNode {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function childNodes(node: ASTNode): ASTNode[] {
  const children: ASTNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" || key === "extra" || key === "comments" ||
      key === "tokens" || key === "errors"
    ) {
      continue;
    }
    if (isNode(value)) {
      children.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (isNode(entry)) children.push(entry);
      }
    }
  }
  return children;
}

function identifierName(node: unknown): string | undefined {
  if (!isNode(node) || node.type !== "Identifier") return undefined;
  return typeof node.name === "string" ? node.name : undefined;
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

function isFunctionNode(node: ASTNode): boolean {
  return node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" || node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod";
}

function isLexicalScopeNode(node: ASTNode): boolean {
  return node.type === "BlockStatement" || node.type === "CatchClause" ||
    node.type === "StaticBlock" || node.type === "ForStatement" ||
    node.type === "ForInStatement" || node.type === "ForOfStatement" ||
    node.type === "SwitchStatement" || node.type === "TSModuleBlock";
}

function buildScopeMap(ast: ASTNode): WeakMap<ASTNode, LexicalScope> {
  const scopeByNode = new WeakMap<ASTNode, LexicalScope>();

  function visit(node: ASTNode, incomingScope?: LexicalScope): void {
    let scope = incomingScope;

    if (node.type === "File") {
      scope = { bindings: new Set(), functionScope: true };
    } else if (node.type === "Program") {
      scope ??= { bindings: new Set(), functionScope: true };
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
      const isAmbient = node.declare === true;
      if (node.type === "ClassDeclaration" && incomingScope && !isAmbient) {
        addPatternBindings(node.id, incomingScope.bindings);
      }
      scope = {
        parent: incomingScope,
        bindings: new Set(),
        functionScope: false,
      };
      if (!isAmbient) addPatternBindings(node.id, scope.bindings);
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
    } else if (
      (node.type === "TSEnumDeclaration" ||
        node.type === "TSModuleDeclaration") && node.declare !== true
    ) {
      addPatternBindings(node.id, scope.bindings);
    }

    for (const child of childNodes(node)) visit(child, scope);
  }

  visit(ast);
  return scopeByNode;
}

function isBound(scope: LexicalScope, name: string): boolean {
  for (
    let current: LexicalScope | undefined = scope;
    current;
    current = current.parent
  ) {
    if (current.bindings.has(name)) return true;
  }
  return false;
}

function literalSpecifier(node: unknown): string | undefined {
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

function normalizePosixPath(path: string): string {
  const normalizedSeparators = path.replaceAll("\\", "/");
  const parts: string[] = [];
  for (const part of normalizedSeparators.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
      else parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function isParserExtensionTarget(
  importerPath: string,
  specifier: string,
): boolean {
  if (
    specifier === PARSER_EXTENSION_PACKAGE ||
    specifier.startsWith(`${PARSER_EXTENSION_PACKAGE}/`)
  ) {
    return true;
  }
  if (
    /^npm:@veryfront\/ext-parser-parse5(?:@[^/]+)?(?:\/.*)?$/.test(specifier)
  ) {
    return true;
  }

  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (
    !normalizedSpecifier.startsWith("./") &&
    !normalizedSpecifier.startsWith("../")
  ) {
    return false;
  }
  const target = normalizePosixPath(
    `${dirname(normalizePosixPath(importerPath))}/${normalizedSpecifier}`,
  );
  return target === "extensions/ext-parser-parse5" ||
    target.startsWith("extensions/ext-parser-parse5/");
}

function dependencyFromNode(
  node: ASTNode,
  scope: LexicalScope,
): string | undefined {
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration"
  ) {
    return literalSpecifier(node.source);
  }
  if (node.type === "TSImportEqualsDeclaration") {
    const reference = node.moduleReference;
    if (!isNode(reference) || reference.type !== "TSExternalModuleReference") {
      return undefined;
    }
    return literalSpecifier(reference.expression);
  }
  if (node.type !== "CallExpression") return undefined;

  const argumentsList = Array.isArray(node.arguments) ? node.arguments : [];
  const specifier = literalSpecifier(argumentsList[0]);
  if (!specifier) return undefined;

  const callee = node.callee;
  if (isNode(callee) && callee.type === "Import") return specifier;
  if (
    identifierName(callee) === "require" && !isBound(scope, "require")
  ) {
    return specifier;
  }
  if (
    !isNode(callee) || callee.type !== "MemberExpression" || callee.computed
  ) {
    return undefined;
  }
  if (
    identifierName(callee.object) === "require" &&
    identifierName(callee.property) === "resolve" &&
    !isBound(scope, "require")
  ) {
    return specifier;
  }
  return undefined;
}

function sourceLine(node: ASTNode): number {
  const location = node.loc;
  if (typeof location !== "object" || location === null) return 1;
  const start = (location as { start?: unknown }).start;
  if (typeof start !== "object" || start === null) return 1;
  const line = (start as { line?: unknown }).line;
  return typeof line === "number" ? line : 1;
}

/** Find reverse edges from framework core into the parse5 parser extension. */
export async function findUnauthorizedParserExtensionImports(
  files: ParserExtensionSourceFile[],
): Promise<UnauthorizedParserExtensionImport[]> {
  const parser = new BabelParseOnlyParser();
  const issues: UnauthorizedParserExtensionImport[] = [];

  for (const file of files) {
    const path = normalizePosixPath(file.path);
    const ast = await parser.parse({ code: file.content, filePath: path });
    const scopeByNode = buildScopeMap(ast);

    const inspect = (node: ASTNode): void => {
      const scope = scopeByNode.get(node);
      if (!scope) throw new Error(`Missing lexical scope for ${path}`);
      const specifier = dependencyFromNode(node, scope);
      if (
        specifier && isParserExtensionTarget(path, specifier) &&
        !(path === PARSER_ONLY_CORE_OWNER &&
          specifier === PARSER_ONLY_SPECIFIER)
      ) {
        issues.push({ path, line: sourceLine(node), specifier });
      }
      for (const child of childNodes(node)) inspect(child);
    };

    inspect(ast);
  }

  return issues;
}

/** Collect every supported TypeScript and JavaScript source below src/ and cli/. */
export async function collectParserExtensionSourceFiles(
  root = ".",
): Promise<ParserExtensionSourceFile[]> {
  const files: ParserExtensionSourceFile[] = [];

  async function walk(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path, relativePath);
      } else if (entry.isFile && SOURCE_EXTENSION_RE.test(entry.name)) {
        files.push({
          path: normalizePosixPath(relativePath),
          content: await Deno.readTextFile(path),
        });
      }
    }
  }

  for (const sourceRoot of ["src", "cli"] as const) {
    await walk(`${root}/${sourceRoot}`, sourceRoot);
  }
  return files;
}

if (import.meta.main) {
  const files = await collectParserExtensionSourceFiles(Deno.args[0] ?? ".");
  if (files.length === 0) {
    console.error("Parser extension boundary scanned zero source files.");
    Deno.exit(1);
  }

  const issues = await findUnauthorizedParserExtensionImports(files);
  if (issues.length === 0) {
    console.log(
      `Parser extension boundary: scanned ${files.length} source files; found 0 unauthorized imports.`,
    );
  } else {
    console.error(
      `Parser extension boundary: scanned ${files.length} source files; found ${issues.length} unauthorized import(s):`,
    );
    for (const issue of issues) {
      console.error(`  ${issue.path}:${issue.line} imports ${issue.specifier}`);
    }
    Deno.exit(1);
  }
}
