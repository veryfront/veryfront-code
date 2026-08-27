import { bundlerLogger as logger } from "#veryfront/utils";
import { extract } from "#std/front-matter/yaml.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentPlugin, ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { loadDefaultCodeParser } from "#veryfront/extensions/parser/defaults.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import { ensureError, MODULE_NOT_FOUND } from "#veryfront/errors";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type {
  BundleResult,
  BundlerOptions,
  MDXBundleOptions,
  MDXBundleResult,
} from "../types/bundler-types.ts";
import { extractImports, processImports } from "../utils/import-utils.ts";
import { getSlugFromPath } from "../utils/loader-utils.ts";
import { normalizePlugins } from "../utils/plugin-utils.ts";

const fs = createFileSystem();
const MDX_PROVIDER_IMPORT_SOURCE = "veryfront/mdx";

function extractFrontmatter(
  content: string,
): { body: string; frontmatter: Record<string, unknown> } {
  if (!content.trim().startsWith("---")) {
    return { body: content, frontmatter: {} };
  }

  const extracted = extract(content);
  return {
    body: extracted.body,
    frontmatter: extracted.attrs as Record<string, unknown>,
  };
}

async function validateLocalImport(
  importPath: string,
  sourcePath: string,
  projectDir: string,
  result: BundleResult,
): Promise<void> {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return;

  const basePath = importPath.startsWith("/")
    ? join(projectDir, importPath)
    : join(dirname(sourcePath), importPath);

  const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs"];

  for (const ext of extensions) {
    try {
      const stat = await fs.stat(basePath + ext);
      if (stat.isFile) return;
    } catch (_) {
      /* expected: file may not exist with this extension */
    }
  }

  result.errors.push(
    MODULE_NOT_FOUND.create({ detail: `Cannot find module '${importPath}' from '${sourcePath}'` }),
  );
}

/**
 * Bundle MDX content
 */
function astNode(value: unknown): ASTNode | undefined {
  return typeof value === "object" && value !== null && typeof (value as ASTNode).type === "string"
    ? value as ASTNode
    : undefined;
}

function nodeName(value: unknown): string | undefined {
  const node = astNode(value);
  if (node?.type === "Identifier" || node?.type === "StringLiteral") {
    if (typeof node.name === "string") return node.name;
    if (typeof node.value === "string") return node.value;
  }
  return undefined;
}

function collectBindingPatternNames( // NOSONAR: recursive AST pattern walker keeps variant handling local.
  value: unknown,
  names: Set<string>,
): void {
  const node = astNode(value);
  if (!node) return;
  if (node.type === "Identifier") {
    if (typeof node.name === "string") names.add(node.name);
    return;
  }
  if (node.type === "RestElement") {
    collectBindingPatternNames(node.argument, names);
    return;
  }
  if (node.type === "AssignmentPattern") {
    collectBindingPatternNames(node.left, names);
    return;
  }
  if (node.type === "ArrayPattern") {
    if (Array.isArray(node.elements)) {
      for (const element of node.elements) collectBindingPatternNames(element, names);
    }
    return;
  }
  if (node.type === "ObjectPattern" && Array.isArray(node.properties)) {
    for (const property of node.properties) {
      const propertyNode = astNode(property);
      if (propertyNode?.type === "RestElement") {
        collectBindingPatternNames(propertyNode.argument, names);
      } else if (propertyNode?.type === "ObjectProperty") {
        collectBindingPatternNames(propertyNode.value, names);
      }
    }
  }
}

function collectDeclarationBindingNames(value: unknown, names: Set<string>): void {
  const node = astNode(value);
  if (!node) return;
  if (node.type === "VariableDeclaration") {
    if (Array.isArray(node.declarations)) {
      for (const declaration of node.declarations) {
        const declarationNode = astNode(declaration);
        if (declarationNode?.type === "VariableDeclarator") {
          collectBindingPatternNames(declarationNode.id, names);
        }
      }
    }
    return;
  }
  if (
    node.type === "FunctionDeclaration" || node.type === "ClassDeclaration" ||
    node.type === "TSDeclareFunction" || node.type === "TSEnumDeclaration" ||
    node.type === "TSModuleDeclaration"
  ) {
    const name = nodeName(node.id);
    if (name) names.add(name);
  }
}

function isModuleVarScopeBoundary(node: ASTNode): boolean {
  return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" ||
    node.type === "ClassMethod" || node.type === "ClassPrivateMethod" ||
    node.type === "ClassDeclaration" || node.type === "ClassExpression" ||
    node.type === "StaticBlock" || node.type === "TSDeclareFunction";
}

/** Collect `var` bindings hoisted into the module through nested statements. */
function collectModuleVarBindingNames(value: unknown, names: Set<string>): void {
  const node = astNode(value);
  if (!node || isModuleVarScopeBoundary(node)) return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    collectDeclarationBindingNames(node, names);
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const entry of child) collectModuleVarBindingNames(entry, names);
    } else {
      collectModuleVarBindingNames(child, names);
    }
  }
}

interface CompiledModuleNames {
  readonly bindings: Set<string>;
  readonly exports: Set<string>;
}

async function loadBundlerCodeParser(): Promise<CodeParser> {
  const parser = await loadDefaultCodeParser();
  if (!parser) {
    throw new Error("The first-party Babel parser is required to assemble compiled MDX modules");
  }
  return parser;
}

function analyzeCompiledProgram( // NOSONAR: AST binding/export collection must preserve traversal order.
  program: ASTNode | undefined,
): CompiledModuleNames {
  const bindings = new Set<string>();
  const exports = new Set<string>();

  if (!Array.isArray(program?.body)) return { bindings, exports };
  for (const statement of program.body) {
    const node = astNode(statement);
    if (!node) continue;
    collectModuleVarBindingNames(node, bindings);
    if (node.type === "ImportDeclaration") {
      if (Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          const name = nodeName(astNode(specifier)?.local);
          if (name) bindings.add(name);
        }
      }
      continue;
    }
    if (node.type === "ExportNamedDeclaration") {
      const declarationBindings = new Set<string>();
      collectDeclarationBindingNames(node.declaration, declarationBindings);
      for (const name of declarationBindings) {
        bindings.add(name);
        exports.add(name);
      }
      if (Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          const name = nodeName(astNode(specifier)?.exported);
          if (name) exports.add(name);
        }
      }
      continue;
    }
    if (node.type === "ExportDefaultDeclaration") {
      collectDeclarationBindingNames(node.declaration, bindings);
      continue;
    }
    if (node.type === "ExportAllDeclaration") {
      const name = nodeName(node.exported);
      if (name) exports.add(name);
      continue;
    }
    collectDeclarationBindingNames(node, bindings);
  }

  return { bindings, exports };
}

interface PreparedCompiledModule {
  readonly parser: CodeParser;
  readonly parsed: ASTNode;
  readonly program: ASTNode;
  changed: boolean;
}

interface BabelReferencePath extends BabelScopeAwarePath {
  readonly isReferencedIdentifier?: () => boolean;
}

function collectFreeIdentifierNames(
  parsed: ASTNode,
  parser: CodeParser,
): Set<string> {
  const names = new Set<string>();
  parser.traverse(parsed, {
    Identifier: (genericPath) => {
      const name = nodeName(genericPath.node);
      if (!name) return;
      const path = genericPath as BabelReferencePath;
      if (
        typeof path.isReferencedIdentifier === "function" &&
        !path.isReferencedIdentifier()
      ) return;
      if (path.scope?.getBinding(name) === undefined) names.add(name);
    },
  });
  return names;
}

function moduleUsesFreeIdentifier(
  parsed: ASTNode,
  parser: CodeParser,
  name: string,
): boolean {
  return collectFreeIdentifierNames(parsed, parser).has(name);
}

function uniqueBindingName(names: ReadonlySet<string>, base: string): string {
  let candidate = base;
  while (names.has(candidate)) candidate += "_";
  return candidate;
}

function identifier(name: string): ASTNode {
  return { type: "Identifier", name };
}

interface DefaultComponentExport {
  readonly statementIndex: number;
  readonly statement: ASTNode;
  readonly declaration: ASTNode;
  readonly specifierIndex?: number;
  readonly source?: ASTNode;
}

function findDefaultComponentExport(program: ASTNode): DefaultComponentExport | undefined {
  if (!Array.isArray(program.body)) return undefined;
  for (let statementIndex = 0; statementIndex < program.body.length; statementIndex++) {
    const statement = astNode(program.body[statementIndex]);
    if (statement?.type === "ExportDefaultDeclaration") {
      const declaration = astNode(statement.declaration);
      if (declaration) return { statementIndex, statement, declaration };
      continue;
    }
    if (
      statement?.type !== "ExportNamedDeclaration" || !Array.isArray(statement.specifiers)
    ) {
      continue;
    }
    const specifierIndex = statement.specifiers.findIndex((value) => {
      const specifier = astNode(value);
      return specifier?.type === "ExportSpecifier" && nodeName(specifier.exported) === "default";
    });
    if (specifierIndex < 0) continue;
    const specifier = astNode(statement.specifiers[specifierIndex]);
    const localName = nodeName(specifier?.local);
    if (localName) {
      return {
        statementIndex,
        statement,
        declaration: identifier(localName),
        specifierIndex,
        source: astNode(statement.source),
      };
    }
  }
  return undefined;
}

function providerProxyNameBase(defaultExport: DefaultComponentExport): string {
  if (defaultExport.source) return "__VeryfrontSourceMDXContent";
  return "__VeryfrontProviderMDXContentProxy";
}

function localDefaultExportName(defaultExport: DefaultComponentExport): string | undefined {
  if (defaultExport.source) return undefined;
  const declaration = defaultExport.declaration;
  if (defaultExport.specifierIndex !== undefined) return nodeName(declaration);
  if (declaration.type !== "FunctionDeclaration" && declaration.type !== "ClassDeclaration") {
    return undefined;
  }
  return nodeName(declaration.id);
}

function rewriteLocalExportAliases( // NOSONAR: local export rewrite keeps alias mutation decisions together.
  program: ASTNode,
  localName: string,
  wrapperName: string,
): ASTNode[] {
  if (!Array.isArray(program.body)) return [];
  const declarationExports: ASTNode[] = [];
  for (let statementIndex = 0; statementIndex < program.body.length; statementIndex++) {
    const value = program.body[statementIndex];
    const statement = astNode(value);
    if (
      statement?.type !== "ExportNamedDeclaration" || astNode(statement.source) ||
      !Array.isArray(statement.specifiers)
    ) {
      continue;
    }
    const declaration = astNode(statement.declaration);
    const declarationNames = new Set<string>();
    collectDeclarationBindingNames(declaration, declarationNames);
    if (declaration && declarationNames.has(localName)) {
      program.body[statementIndex] = declaration;
      for (const exportedName of declarationNames) {
        declarationExports.push({
          type: "ExportSpecifier",
          local: identifier(exportedName === localName ? wrapperName : exportedName),
          exported: identifier(exportedName),
        });
      }
      continue;
    }
    for (const specifierValue of statement.specifiers) {
      const specifier = astNode(specifierValue);
      if (
        specifier?.type === "ExportSpecifier" && nodeName(specifier.local) === localName
      ) {
        specifier.local = identifier(wrapperName);
      }
    }
  }
  return declarationExports;
}

function rewriteSourceExportAliases(
  program: ASTNode,
  sourceName: string,
  importedName: string,
  wrapperName: string,
): ASTNode[] {
  if (!Array.isArray(program.body)) return [];
  const aliasExports: ASTNode[] = [];
  for (let statementIndex = 0; statementIndex < program.body.length; statementIndex++) {
    const statement = astNode(program.body[statementIndex]);
    if (
      statement?.type !== "ExportNamedDeclaration" ||
      nodeName(statement.source) !== sourceName ||
      !Array.isArray(statement.specifiers)
    ) {
      continue;
    }
    for (
      let specifierIndex = statement.specifiers.length - 1;
      specifierIndex >= 0;
      specifierIndex--
    ) {
      const specifier = astNode(statement.specifiers[specifierIndex]);
      if (
        specifier?.type !== "ExportSpecifier" || nodeName(specifier.local) !== importedName
      ) {
        continue;
      }
      aliasExports.unshift({
        ...specifier,
        local: identifier(wrapperName),
      });
      statement.specifiers.splice(specifierIndex, 1);
    }
    if (statement.specifiers.length === 0 && !astNode(statement.declaration)) {
      program.body[statementIndex] = { type: "EmptyStatement" };
    }
  }
  return aliasExports;
}

function isFunctionNode(node: ASTNode | undefined): boolean {
  return node?.type === "FunctionDeclaration" || node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression" || node?.type === "ObjectMethod" ||
    node?.type === "ClassMethod" || node?.type === "ClassPrivateMethod" ||
    node?.type === "TSDeclareMethod";
}

function findTopLevelFunction(program: ASTNode, name: string): ASTNode | undefined {
  if (!Array.isArray(program.body)) return undefined;
  for (const statement of program.body) {
    const statementNode = astNode(statement);
    const declaration = statementNode?.type === "ExportNamedDeclaration"
      ? astNode(statementNode.declaration)
      : statementNode;
    if (declaration?.type === "FunctionDeclaration" && nodeName(declaration.id) === name) {
      return declaration;
    }
    if (declaration?.type !== "VariableDeclaration" || !Array.isArray(declaration.declarations)) {
      continue;
    }
    for (const declarator of declaration.declarations) {
      const declaratorNode = astNode(declarator);
      const init = astNode(declaratorNode?.init);
      if (
        declaratorNode?.type === "VariableDeclarator" && nodeName(declaratorNode.id) === name &&
        isFunctionNode(init)
      ) {
        return init;
      }
    }
  }
  return undefined;
}

function defaultComponentFunction(program: ASTNode): ASTNode | undefined {
  const declaration = findDefaultComponentExport(program)?.declaration;
  if (isFunctionNode(declaration)) return declaration;
  const name = declaration?.type === "Identifier" ? nodeName(declaration) : undefined;
  return name ? findTopLevelFunction(program, name) : undefined;
}

function pathIsWithinFunction(path: BabelBindingPath, functionNode: ASTNode): boolean {
  for (let current = path.parentPath; current; current = current.parentPath) {
    if (current.node === functionNode) return true;
    if (isFunctionNode(current.node)) return false;
  }
  return false;
}

function pathIsAncestor(ancestor: BabelBindingPath, path: BabelBindingPath): boolean {
  for (
    let current: BabelBindingPath | null | undefined = path;
    current;
    current = current.parentPath
  ) {
    if (current.node === ancestor.node) return true;
  }
  return false;
}

function hasEarlierReturn(
  returnPaths: readonly BabelBindingPath[],
  hookPath: BabelBindingPath,
): boolean {
  return returnPaths.some((returnPath) => {
    if (pathIsAncestor(returnPath, hookPath)) return false;
    return returnPath.node.start === undefined || hookPath.node.start === undefined ||
      returnPath.node.start < hookPath.node.start;
  });
}

function nodeInvokesProviderHook( // NOSONAR: AST dominance heuristic is intentionally localized.
  path: BabelScopeAwarePath,
  defaultFunction: ASTNode,
  returnPaths: readonly BabelBindingPath[],
): boolean {
  const callee = astNode(path.node.callee);
  const name = callee?.type === "Identifier" ? nodeName(callee) : undefined;
  if (!name) return false;

  let current = path.parentPath;
  if (current?.node.type !== "SpreadElement") return false;
  current = current.parentPath;
  if (current?.node.type !== "ObjectExpression") return false;
  const providerMapPath = current;
  while (current && current.node !== defaultFunction) {
    if (isFunctionNode(current.node)) return false;
    if (
      current.node.type === "IfStatement" || current.node.type === "ConditionalExpression" ||
      current.node.type === "LogicalExpression" || current.node.type === "SwitchCase" ||
      current.node.type === "ForStatement" || current.node.type === "ForInStatement" ||
      current.node.type === "ForOfStatement" || current.node.type === "WhileStatement" ||
      current.node.type === "DoWhileStatement"
    ) {
      return false;
    }
    current = current.parentPath;
  }
  if (current?.node !== defaultFunction) return false;
  if (hasEarlierReturn(returnPaths, path)) return false;

  const bindingPath = path.scope?.getBinding(name)?.path;
  if (bindingPath?.node.type !== "ImportSpecifier") return false;
  if (nodeName(bindingPath.node.imported) !== "useMDXComponents") return false;
  for (let parent = bindingPath.parentPath; parent; parent = parent.parentPath) {
    if (parent.node.type === "ImportDeclaration") {
      return nodeName(parent.node.source) === MDX_PROVIDER_IMPORT_SOURCE &&
        providerMapContributesToReturn(providerMapPath, path, defaultFunction);
    }
  }
  return false;
}

function providerMapContributesToReturn(
  providerMapPath: BabelBindingPath,
  callPath: BabelScopeAwarePath,
  defaultFunction: ASTNode,
): boolean {
  for (
    let current: BabelBindingPath | null | undefined = providerMapPath;
    current && current.node !== defaultFunction;
    current = current.parentPath
  ) {
    if (isFunctionNode(current.node)) return false;
    if (current.node.type === "ReturnStatement") break;
    if (current.node.type !== "VariableDeclarator") continue;

    const bindingNames = new Set<string>();
    collectBindingPatternNames(current.node.id, bindingNames);
    for (const bindingName of bindingNames) {
      const binding = callPath.scope?.getBinding(bindingName);
      if (
        binding?.referencePaths?.some((referencePath) =>
          pathSuppliesRenderedComponents(referencePath, defaultFunction)
        )
      ) {
        return true;
      }
    }
    return false;
  }
  return pathSuppliesRenderedComponents(providerMapPath, defaultFunction);
}

function importSource(path: BabelBindingPath | undefined): string | undefined {
  for (let current = path?.parentPath; current; current = current.parentPath) {
    if (current.node.type === "ImportDeclaration") return nodeName(current.node.source);
  }
  return undefined;
}

function isRenderFactoryCall(path: BabelScopeAwarePath): boolean {
  const node = path.node;
  if (node.type !== "CallExpression") return false;
  const callee = astNode(node.callee);
  if (callee?.type === "Identifier") {
    const bindingPath = path.scope?.getBinding(nodeName(callee) ?? "")?.path;
    if (bindingPath?.node.type !== "ImportSpecifier") return false;
    const importedName = nodeName(bindingPath.node.imported);
    const source = importSource(bindingPath);
    return (source === "react" && importedName === "createElement") ||
      ((source === "react/jsx-runtime" || source === "react/jsx-dev-runtime") &&
        (importedName === "jsx" || importedName === "jsxs" || importedName === "jsxDEV"));
  }
  if (callee?.type !== "MemberExpression" || nodeName(callee.property) !== "createElement") {
    return false;
  }
  const objectName = nodeName(callee.object);
  if (!objectName) return false;
  const bindingPath = path.scope?.getBinding(objectName)?.path;
  return (bindingPath?.node.type === "ImportDefaultSpecifier" ||
    bindingPath?.node.type === "ImportNamespaceSpecifier") &&
    importSource(bindingPath) === "react";
}

function isHostElementRenderTarget(value: unknown): boolean {
  const node = astNode(value);
  return node?.type === "StringLiteral" ||
    (node?.type === "Literal" && typeof node.value === "string");
}

function pathSuppliesRenderedComponents( // NOSONAR: render-path AST heuristic is intentionally localized.
  path: BabelBindingPath,
  defaultFunction: ASTNode,
): boolean {
  let suppliesComponentsProperty = false;
  let reachesRender = false;
  for (
    let current: BabelBindingPath | null | undefined = path;
    current && current.node !== defaultFunction;
    current = current.parentPath
  ) {
    if (current.node.type === "ReturnStatement") return reachesRender;
    if (isFunctionNode(current.node)) return false;
    const parentPath = current.parentPath as BabelScopeAwarePath | null | undefined;
    const parent = parentPath?.node;
    if (
      (parent?.type === "LogicalExpression" && parent.left === current.node) ||
      (parent?.type === "ConditionalExpression" && parent.test === current.node)
    ) {
      return false;
    }
    if (parent?.type === "ObjectProperty" && parent.value === current.node) {
      suppliesComponentsProperty = nodeName(parent.key) === "components";
      continue;
    }
    if (parent?.type !== "CallExpression") continue;
    const argumentsList = Array.isArray(parent.arguments) ? parent.arguments : [];
    if (parent.callee === current.node) {
      reachesRender = true;
    } else if (parentPath && isRenderFactoryCall(parentPath)) {
      if (argumentsList[0] === current.node) reachesRender = true;
      if (
        argumentsList[1] === current.node && suppliesComponentsProperty &&
        !isHostElementRenderTarget(argumentsList[0])
      ) {
        reachesRender = true;
      }
    }
    suppliesComponentsProperty = false;
  }
  return false;
}

interface BabelBindingPath {
  readonly node: ASTNode;
  readonly parentPath?: BabelBindingPath | null;
}

interface BabelBinding {
  readonly path: BabelBindingPath;
  readonly referencePaths?: readonly BabelBindingPath[];
}

interface BabelScopeAwarePath extends BabelBindingPath {
  readonly scope?: {
    getBinding(name: string): BabelBinding | undefined;
    rename?(oldName: string, newName: string): void;
  };
}

function renameProgramBinding(
  parsed: ASTNode,
  parser: CodeParser,
  oldName: string,
  newName: string,
): void {
  let renamed = false;
  parser.traverse(parsed, {
    Program: (genericPath) => {
      if (renamed) return;
      const path = genericPath as BabelScopeAwarePath;
      if (!path.scope?.getBinding(oldName)) return;
      if (!path.scope.rename) {
        throw new Error("The first-party parser cannot rename a shadowed intrinsic binding");
      }
      path.scope.rename(oldName, newName);
      renamed = true;
    },
  });
}

function defaultComponentInvokesProviderHook(
  parsed: ASTNode,
  program: ASTNode | undefined,
  parser: CodeParser,
): boolean {
  if (!Array.isArray(program?.body)) return false;
  const defaultFunction = defaultComponentFunction(program);
  if (!defaultFunction) return false;
  const returnPaths: BabelBindingPath[] = [];
  parser.traverse(parsed, {
    ReturnStatement: (genericPath) => {
      const path = genericPath as BabelBindingPath;
      if (pathIsWithinFunction(path, defaultFunction)) returnPaths.push(path);
    },
  });
  let found = false;
  parser.traverse(parsed, {
    CallExpression: (genericPath) => {
      if (!found) {
        found = nodeInvokesProviderHook(genericPath, defaultFunction, returnPaths);
      }
    },
  });
  return found;
}

function providerImport(localName: string): ASTNode {
  return {
    type: "ImportDeclaration",
    specifiers: [{
      type: "ImportSpecifier",
      imported: identifier("useMDXComponents"),
      local: identifier(localName),
    }],
    source: { type: "StringLiteral", value: MDX_PROVIDER_IMPORT_SOURCE },
  };
}

function createElementImport(localName: string): ASTNode {
  return {
    type: "ImportDeclaration",
    specifiers: [{
      type: "ImportSpecifier",
      imported: identifier("createElement"),
      local: identifier(localName),
    }],
    source: { type: "StringLiteral", value: "react" },
  };
}

function reactImport(): ASTNode {
  return {
    type: "ImportDeclaration",
    specifiers: [{
      type: "ImportDefaultSpecifier",
      local: identifier("React"),
    }],
    source: { type: "StringLiteral", value: "react" },
  };
}

function globalsDeclaration(names: readonly string[]): ASTNode {
  return {
    type: "VariableDeclaration",
    kind: "const",
    declarations: [{
      type: "VariableDeclarator",
      id: {
        type: "ObjectPattern",
        properties: names.map((name) => ({
          type: "ObjectProperty",
          key: identifier(name),
          value: identifier(name),
          computed: false,
          shorthand: true,
        })),
      },
      init: identifier("globalThis"),
    }],
  };
}

function providerWrapper(input: {
  wrapperName: string;
  originalName: string;
  providerHookName: string;
  createElementName: string;
  propsName: string;
  componentsName: string;
}): ASTNode {
  const props = identifier(input.propsName);
  const components = identifier(input.componentsName);
  const declaration: ASTNode = {
    type: "FunctionDeclaration",
    id: identifier(input.wrapperName),
    async: false,
    generator: false,
    params: [{
      type: "AssignmentPattern",
      left: props,
      right: { type: "ObjectExpression", properties: [] },
    }],
    body: {
      type: "BlockStatement",
      body: [
        {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [{
            type: "VariableDeclarator",
            id: components,
            init: {
              type: "CallExpression",
              callee: identifier(input.providerHookName),
              arguments: [{
                type: "MemberExpression",
                object: props,
                property: identifier("components"),
                computed: false,
                optional: false,
              }],
              optional: false,
            },
          }],
        },
        {
          type: "ReturnStatement",
          argument: {
            type: "CallExpression",
            callee: identifier(input.createElementName),
            arguments: [
              identifier(input.originalName),
              {
                type: "ObjectExpression",
                properties: [
                  { type: "SpreadElement", argument: props },
                  {
                    type: "ObjectProperty",
                    key: identifier("components"),
                    value: components,
                    computed: false,
                    shorthand: true,
                  },
                ],
              },
            ],
            optional: false,
          },
        },
      ],
    },
  };
  return declaration;
}

async function componentBackedProviderProxy(
  parser: CodeParser,
  filePath: string,
  proxyName: string,
  wrapperName: string,
  originalName: string,
  methodBindingsName: string,
  bindMethodName: string,
): Promise<ASTNode[]> {
  const code = `
    const ${methodBindingsName} = [];
    function ${bindMethodName}(method) {
      for (const binding of ${methodBindingsName}) {
        if (binding[0] === method) return binding[1];
      }
      const bound = method.bind(${originalName});
      ${methodBindingsName}.push([method, bound]);
      return bound;
    }
    const ${proxyName} = new Proxy(${wrapperName}, {
      get(target, key, receiver) {
        const object = ({}).constructor;
        const targetDescriptor = object.getOwnPropertyDescriptor(target, key);
        if (targetDescriptor?.get) return targetDescriptor.get.call(receiver);
        if (targetDescriptor) return target[key];
        const sourceDescriptor = object.getOwnPropertyDescriptor(${originalName}, key);
        if (sourceDescriptor?.get) return ${bindMethodName}(sourceDescriptor.get)();
        if (typeof sourceDescriptor?.value === "function") {
          return ${bindMethodName}(sourceDescriptor.value);
        }
        const sourceValue = ${originalName}[key];
        return typeof sourceValue === "function" ? ${bindMethodName}(sourceValue) : sourceValue;
      },
      set(target, key, value) {
        const object = ({}).constructor;
        if (object.getOwnPropertyDescriptor(target, key)) {
          target[key] = value;
          return true;
        }
        const sourceDescriptor = object.getOwnPropertyDescriptor(${originalName}, key);
        if (sourceDescriptor?.set) {
          sourceDescriptor.set.call(${originalName}, value);
        } else {
          ${originalName}[key] = value;
        }
        return true;
      },
      deleteProperty(target, key) {
        const object = ({}).constructor;
        if (object.getOwnPropertyDescriptor(target, key)) return delete target[key];
        return delete ${originalName}[key];
      },
      defineProperty(target, key, descriptor) {
        const object = ({}).constructor;
        const targetDescriptor = object.getOwnPropertyDescriptor(target, key);
        if (targetDescriptor) {
          const sourceDescriptor = object.getOwnPropertyDescriptor(${originalName}, key);
          if (sourceDescriptor && descriptor.configurable === false) {
            sourceDescriptor.configurable = false;
            if ("writable" in sourceDescriptor) sourceDescriptor.writable = false;
            object.defineProperty(${originalName}, key, sourceDescriptor);
          }
          object.defineProperty(target, key, descriptor);
        } else {
          if (!object.isExtensible(target)) return false;
          object.defineProperty(${originalName}, key, descriptor);
          const sourceDescriptor = object.getOwnPropertyDescriptor(${originalName}, key);
          if (sourceDescriptor?.configurable === false) {
            object.defineProperty(target, key, sourceDescriptor);
          }
        }
        return true;
      },
      has(target, key) {
        return key in target || key in ${originalName};
      },
      ownKeys(target) {
        const object = ({}).constructor;
        const targetKeys = [
          ...object.getOwnPropertyNames(target),
          ...object.getOwnPropertySymbols(target),
        ];
        if (!object.isExtensible(target)) return targetKeys;
        return [
          ...targetKeys,
          ...object.getOwnPropertyNames(${originalName}).filter((key) => !targetKeys.includes(key)),
          ...object.getOwnPropertySymbols(${originalName}).filter((key) => !targetKeys.includes(key)),
        ];
      },
      getOwnPropertyDescriptor(target, key) {
        const object = ({}).constructor;
        const targetDescriptor = object.getOwnPropertyDescriptor(target, key);
        if (targetDescriptor) return targetDescriptor;
        if (!object.isExtensible(target)) return undefined;
        const sourceDescriptor = object.getOwnPropertyDescriptor(${originalName}, key);
        if (sourceDescriptor) {
          sourceDescriptor.configurable = true;
          if (sourceDescriptor.get) {
            sourceDescriptor.get = ${bindMethodName}(sourceDescriptor.get);
          }
          if (sourceDescriptor.set) {
            sourceDescriptor.set = ${bindMethodName}(sourceDescriptor.set);
          }
          if (typeof sourceDescriptor.value === "function") {
            sourceDescriptor.value = ${bindMethodName}(sourceDescriptor.value);
          }
        }
        return sourceDescriptor;
      },
      preventExtensions(target) {
        const object = ({}).constructor;
        const sourceKeys = [
          ...object.getOwnPropertyNames(${originalName}),
          ...object.getOwnPropertySymbols(${originalName}),
        ];
        for (const key of sourceKeys) {
          if (object.getOwnPropertyDescriptor(target, key)) continue;
          const descriptor = object.getOwnPropertyDescriptor(${originalName}, key);
          if (!descriptor) continue;
          if ("value" in descriptor && typeof descriptor.value !== "function") {
            const forwardedDescriptor = {
              configurable: descriptor.configurable,
              enumerable: descriptor.enumerable,
              get: () => ${originalName}[key],
            };
            if (descriptor.writable) {
              forwardedDescriptor.set = (value) => ${originalName}[key] = value;
            }
            object.defineProperty(target, key, forwardedDescriptor);
            continue;
          }
          if (descriptor.get) descriptor.get = ${bindMethodName}(descriptor.get);
          if (descriptor.set) descriptor.set = ${bindMethodName}(descriptor.set);
          if (typeof descriptor.value === "function") {
            descriptor.value = ${bindMethodName}(descriptor.value);
          }
          object.defineProperty(target, key, descriptor);
        }
        object.preventExtensions(target);
        return true;
      },
    });
    export { ${proxyName} as default };
  `;
  const parsed = await parser.parse({ code, filePath });
  const program = parsed.type === "File" ? astNode(parsed.program) : parsed;
  if (!Array.isArray(program?.body)) {
    throw new TypeError("Could not construct the MDX provider component proxy");
  }
  return program.body as ASTNode[];
}

async function prepareCompiledModule( // NOSONAR: assembly coordinates parser output, naming, and wrapper rewrites.
  compiledCode: string,
  filePath: string,
): Promise<PreparedCompiledModule> {
  const parser = await loadBundlerCodeParser();
  const parsed = await parser.parse({ code: compiledCode, filePath });
  const program = parsed.type === "File" ? astNode(parsed.program) : parsed;
  if (!program || !Array.isArray(program.body)) {
    throw new Error("Compiled MDX did not produce a module program");
  }
  if (defaultComponentInvokesProviderHook(parsed, program, parser)) {
    return { parser, parsed, program, changed: false };
  }

  const names = analyzeCompiledProgram(program);
  // Analyze a separate tree so Babel's cached scope paths cannot be invalidated
  // when the emitted program is reshaped below.
  const freeIdentifierTree = await parser.parse({ code: compiledCode, filePath });
  const reserved = new Set([
    ...names.bindings,
    ...collectFreeIdentifierNames(freeIdentifierTree, parser),
  ]);
  const providerHookName = uniqueBindingName(reserved, "__veryfrontUseMDXComponents");
  reserved.add(providerHookName);
  const createElementName = uniqueBindingName(reserved, "__veryfrontCreateElement");
  reserved.add(createElementName);
  const wrapperName = uniqueBindingName(reserved, "__VeryfrontProviderMDXContent");
  reserved.add(wrapperName);
  const propsName = uniqueBindingName(reserved, "__veryfrontProps");
  reserved.add(propsName);
  const componentsName = uniqueBindingName(reserved, "__veryfrontComponents");
  reserved.add(componentsName);
  const staticMethodBindingsName = uniqueBindingName(reserved, "__veryfrontStaticMethodBindings");
  reserved.add(staticMethodBindingsName);
  const bindStaticMethodName = uniqueBindingName(reserved, "__veryfrontBindStaticMethod");
  reserved.add(bindStaticMethodName);

  const body = program.body as ASTNode[];
  let defaultExport = findDefaultComponentExport(program);
  if (!defaultExport) {
    throw new Error("Compiled MDX module must provide a default component export");
  }
  if (names.bindings.has("Proxy")) {
    const authoredProxyName = uniqueBindingName(reserved, "__veryfrontAuthoredProxy");
    reserved.add(authoredProxyName);
    renameProgramBinding(parsed, parser, "Proxy", authoredProxyName);
    defaultExport = findDefaultComponentExport(program);
    if (!defaultExport) {
      throw new Error("Compiled MDX module lost its default export while renaming Proxy");
    }
  }
  const publicWrapperName = uniqueBindingName(reserved, providerProxyNameBase(defaultExport));
  reserved.add(publicWrapperName);
  const declaration = defaultExport.declaration;
  const defaultIndex = defaultExport.statementIndex;
  const localDefaultName = localDefaultExportName(defaultExport);
  const sourceAliasExports: ASTNode[] = [];

  let originalName = nodeName(declaration.id);
  if (defaultExport.specifierIndex !== undefined) {
    const specifiers = defaultExport.statement.specifiers as ASTNode[];
    const defaultSpecifier = astNode(specifiers[defaultExport.specifierIndex]);
    if (defaultExport.source) {
      originalName = uniqueBindingName(reserved, "__VeryfrontCompiledMDXContent");
      reserved.add(originalName);
      const importedName = nodeName(defaultSpecifier?.local);
      const sourceImport: ASTNode = {
        type: "ImportDeclaration",
        specifiers: [{
          type: "ImportSpecifier",
          imported: defaultSpecifier?.local ?? identifier("default"),
          local: identifier(originalName),
        }],
        source: defaultExport.source,
        ...(defaultExport.statement.attributes === undefined
          ? {}
          : { attributes: defaultExport.statement.attributes }),
        ...(defaultExport.statement.assertions === undefined
          ? {}
          : { assertions: defaultExport.statement.assertions }),
      };
      specifiers.splice(defaultExport.specifierIndex, 1);
      const sourceName = nodeName(defaultExport.source);
      if (importedName && sourceName) {
        sourceAliasExports.push(
          ...rewriteSourceExportAliases(
            program,
            sourceName,
            importedName,
            publicWrapperName,
          ),
        );
      }
      if (specifiers.length === 0 && !astNode(defaultExport.statement.declaration)) {
        body[defaultIndex] = sourceImport;
      } else {
        body.splice(defaultIndex, 0, sourceImport);
      }
    } else {
      originalName = nodeName(declaration);
      specifiers.splice(defaultExport.specifierIndex, 1);
      if (specifiers.length === 0 && !astNode(defaultExport.statement.declaration)) {
        body[defaultIndex] = { type: "EmptyStatement" };
      }
    }
  } else if (declaration.type === "Identifier") {
    const exportedName = nodeName(declaration);
    if (!exportedName) throw new Error("Compiled MDX default export has no usable binding");
    originalName = uniqueBindingName(reserved, "__VeryfrontCompiledMDXContent");
    reserved.add(originalName);
    body[defaultIndex] = {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [{
        type: "VariableDeclarator",
        id: identifier(originalName),
        init: identifier(exportedName),
      }],
    };
  } else if (
    declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration"
  ) {
    originalName ??= uniqueBindingName(reserved, "__VeryfrontCompiledMDXContent");
    declaration.id = identifier(originalName);
    body[defaultIndex] = declaration;
  } else {
    originalName = uniqueBindingName(reserved, "__VeryfrontCompiledMDXContent");
    body[defaultIndex] = {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [{
        type: "VariableDeclarator",
        id: identifier(originalName),
        init: declaration,
      }],
    };
  }
  if (!originalName) throw new Error("Compiled MDX default export has no usable binding");
  const declarationAliasExports = localDefaultName
    ? rewriteLocalExportAliases(program, localDefaultName, publicWrapperName)
    : [];
  const proxyStatements = await componentBackedProviderProxy(
    parser,
    filePath,
    publicWrapperName,
    wrapperName,
    originalName,
    staticMethodBindingsName,
    bindStaticMethodName,
  );

  body.unshift(
    providerImport(providerHookName),
    createElementImport(createElementName),
  );
  body.push(
    providerWrapper({
      wrapperName,
      originalName,
      providerHookName,
      createElementName,
      propsName,
      componentsName,
    }),
    ...proxyStatements,
    ...(sourceAliasExports.length === 0 && declarationAliasExports.length === 0 ? [] : [{
      type: "ExportNamedDeclaration",
      declaration: null,
      specifiers: [...sourceAliasExports, ...declarationAliasExports],
      source: null,
    }]),
  );
  return { parser, parsed, program, changed: true };
}

/**
 * The `meta` export appended to a compiled module.
 *
 * MDX passes ESM declarations in the source through to the program output, so a
 * document that writes `export const meta = {...}` already has one. Appending a
 * second would redeclare the binding and the module would not parse.
 */
function buildMetaExport(
  names: CompiledModuleNames,
  meta: Record<string, unknown>,
  reservedNames: ReadonlySet<string> = names.bindings,
): string {
  if (names.exports.has("meta")) return "";

  const serialized = JSON.stringify(meta);
  if (!names.bindings.has("meta")) return `\nexport const meta = ${serialized};\n`;

  let localName = "__veryfrontGeneratedMeta";
  while (reservedNames.has(localName)) localName += "_";
  return `\nconst ${localName} = ${serialized};\nexport { ${localName} as meta };\n`;
}

async function assembleCompiledModule(
  compiledCode: string,
  meta: Record<string, unknown>,
  filePath: string,
  globals: readonly string[] = [],
): Promise<string> {
  const prepared = await prepareCompiledModule(compiledCode, filePath);
  const providerAwareNames = analyzeCompiledProgram(prepared.program);
  const unboundGlobals = globals.filter((name) => !providerAwareNames.bindings.has(name));
  const needsReactBinding = !providerAwareNames.bindings.has("React") &&
    !unboundGlobals.includes("React") &&
    moduleUsesFreeIdentifier(prepared.parsed, prepared.parser, "React");
  const injectedStatements = [
    ...(needsReactBinding ? [reactImport()] : []),
    ...(unboundGlobals.length === 0 ? [] : [globalsDeclaration(unboundGlobals)]),
  ];
  if (injectedStatements.length > 0) {
    (prepared.program.body as ASTNode[]).unshift(...injectedStatements);
    prepared.changed = true;
  }
  const names = analyzeCompiledProgram(prepared.program);
  const assembledCode = prepared.changed
    ? (await prepared.parser.generate(prepared.parsed)).code
    : compiledCode;
  let metaReservedNames: ReadonlySet<string> = names.bindings;
  if (!names.exports.has("meta") && names.bindings.has("meta")) {
    const metaNameTree = await prepared.parser.parse({ code: assembledCode, filePath });
    metaReservedNames = new Set([
      ...names.bindings,
      ...collectFreeIdentifierNames(metaNameTree, prepared.parser),
    ]);
  }
  return `${assembledCode}${buildMetaExport(names, meta, metaReservedNames)}`;
}

export function bundleMdx(
  source: { path: string; content: string },
  options: BundlerOptions,
  result: BundleResult,
  compileMDXForImport: (source: string, options: BundlerOptions) => Promise<string>,
): Promise<void> {
  return withSpan(
    "build.renderer.bundleMDX",
    async () => {
      try {
        const { body, frontmatter } = extractFrontmatter(source.content);

        const processedContent = await processImports(
          body,
          source.path,
          options.projectDir,
          async (importPath) => {
            if (importPath.endsWith(".mdx")) {
              try {
                const importContent = await fs.readTextFile(importPath);
                const compiledImport = await compileMDXForImport(importContent, options);

                const outputPath = importPath.replace(/\.mdx$/, ".js");
                result.outputs.set(outputPath, {
                  path: outputPath,
                  content: compiledImport,
                  type: "js",
                });

                return outputPath;
              } catch (error) {
                logger.debug("Failed to compile MDX import", { importPath, error });
                return null;
              }
            }

            await validateLocalImport(importPath, source.path, options.projectDir, result);
            return null;
          },
          { markdownCode: true },
        );

        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: processedContent,
          frontmatter,
          filePath: source.path,
          mode: options.mode,
          target: "server",
          providerImportSource: MDX_PROVIDER_IMPORT_SOURCE,
        });

        const slug = getSlugFromPath(source.path);
        const meta = {
          slug,
          title: frontmatter.title ?? slug,
          description: frontmatter.description ?? "",
          ...frontmatter,
        };

        // The compiled output is already an ES module that default-exports
        // MDXContent, so it is emitted as the module body. Declaring a second
        // MDXContent around it is what made the previous output unparseable.
        const outputPath = source.path.replace(/\.mdx$/, ".js");
        const moduleCode = await assembleCompiledModule(
          compiled.compiledCode,
          meta,
          outputPath,
        );
        result.outputs.set(outputPath, {
          path: outputPath,
          content: moduleCode,
          type: "js",
          meta: frontmatter,
        });

        result.dependencies.set(source.path, extractImports(moduleCode));

        logger.debug(`Bundled MDX: ${source.path} -> ${outputPath}`);
      } catch (error) {
        logger.error(`Failed to bundle MDX ${source.path}`, error);
        result.errors.push(ensureError(error));
      }
    },
    {
      "source.path": source.path,
      "options.mode": options.mode,
    },
  );
}

/**
 * Bundle MDX with additional options
 */
export function bundleMDXWithOptions(options: MDXBundleOptions): Promise<MDXBundleResult> {
  return withSpan(
    "build.renderer.bundleMDXWithOptions",
    async () => {
      const {
        content,
        filePath,
        mode = "production",
        globals = {},
        remarkPlugins = [],
        rehypePlugins = [],
      } = options;

      logger.info(`Bundling MDX file: ${filePath}`);

      try {
        const { body, frontmatter } = extractFrontmatter(content);

        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const compiled = await processor.compileMdx({
          projectDir: options.projectDir,
          content: body,
          frontmatter,
          filePath,
          mode,
          target: "server",
          providerImportSource: MDX_PROVIDER_IMPORT_SOURCE,
          remarkPlugins: normalizePlugins(remarkPlugins as ContentPlugin[]),
          rehypePlugins: normalizePlugins(rehypePlugins as ContentPlugin[]),
        });

        const compiledStr = compiled.compiledCode;

        const code = await assembleCompiledModule(
          compiledStr,
          frontmatter,
          filePath.replace(/\.mdx$/, ".js"),
          Object.keys(globals),
        );
        const dependencies = extractImports(code);

        return {
          code,
          frontmatter,
          dependencies,
        };
      } catch (error) {
        logger.error(`Failed to bundle MDX: ${filePath}`, error);
        return {
          code: "",
          frontmatter: {},
          dependencies: [],
          errors: [ensureError(error)],
        };
      }
    },
    {
      "file.path": options.filePath,
      "options.mode": options.mode ?? "production",
    },
  );
}
