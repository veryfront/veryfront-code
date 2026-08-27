import { parse, type ParserPlugin } from "#babel/parser";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  SEPARATOR,
} from "#std/path";
import { hasForbiddenLocalModulePathSyntax } from "./extension-manifest-reader.ts";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_CAPABILITY_TYPE_CHARACTERS,
  MAX_EXTENSION_CONTRACT_NAME_CHARACTERS,
  MAX_EXTENSION_CONTRACTS_PER_LIST,
} from "../../src/extensions/metadata-policy.ts";

export type Capability = { type: string; [key: string]: unknown };

export interface ContractMetadata {
  provides?: string[];
  requires?: string[];
}

export interface ExtensionSourceMetadata {
  contracts?: ContractMetadata;
  contractResolutionIssues: string[];
  capabilityResolutionIssues: string[];
  legacyProvides: string[];
  capabilities: Capability[];
}

export interface ExtensionSourceFileMetadataOptions {
  /** Absolute workspace boundary containing every statically followed source. */
  workspaceRoot: string;
  /** Absolute path to the extension's source entrypoint. */
  entryPath: string;
  /** Directory against which manifest import-map targets are resolved. */
  importMapBaseDir: string;
  /** The extension manifest's `imports` object. */
  imports: Readonly<Record<string, unknown>>;
  /** Shared budget across every extension inspected by one workspace audit. */
  workspaceBudget?: ExtensionMetadataWorkspaceBudget;
}

export interface ExtensionMetadataWorkspaceBudget {
  sourceFiles: number;
  sourceBytes: number;
}

export const MAX_EXTENSION_METADATA_SOURCE_BYTES = 1024 * 1024;
export const MAX_EXTENSION_METADATA_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_EXTENSION_METADATA_FILES = 64;
export const MAX_EXTENSION_METADATA_RESOLUTION_DEPTH = 16;
export const MAX_EXTENSION_METADATA_IMPORT_MAPPINGS = 1024;
export const MAX_EXTENSION_METADATA_TOKENS = 200_000;
export const MAX_EXTENSION_METADATA_CONTRACT_REFERENCES =
  MAX_EXTENSION_CONTRACTS_PER_LIST;
export const MAX_EXTENSION_METADATA_WORKSPACE_FILES = 256;
export const MAX_EXTENSION_METADATA_WORKSPACE_SOURCE_BYTES = 16 * 1024 * 1024;

export function createExtensionMetadataWorkspaceBudget(): ExtensionMetadataWorkspaceBudget {
  return { sourceFiles: 0, sourceBytes: 0 };
}

const MAX_STATIC_IDENTIFIER_CHARACTERS = 256;
const MAX_STATIC_SPECIFIER_CHARACTERS = 2048;
const MAX_FACTORY_SCOPE_BINDINGS = 1024;
const MAX_FACTORY_SCOPE_NODES = 200_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface AstNode {
  type: string;
  [key: string]: unknown;
}

type StaticBindingExpression =
  | { kind: "literal"; value: string }
  | { kind: "identifier"; name: string }
  | { kind: "unsupported" };

interface StaticImportBinding {
  importedName: string;
  specifier: string;
}

type StaticExportBinding =
  | { kind: "local"; localName: string }
  | { kind: "reexport"; importedName: string; specifier: string };

interface StaticModuleBindings {
  ast: AstNode;
  source: string;
  locals: Map<string, StaticBindingExpression>;
  values: Map<string, AstNode>;
  imports: Map<string, StaticImportBinding>;
  exports: Map<string, StaticExportBinding>;
  starExports: string[];
  defaultExport?: AstNode;
}

type StaticResolutionFailureCode =
  | "ambiguous-binding"
  | "binding-not-found"
  | "cycle"
  | "depth-limit"
  | "file-limit"
  | "import-map-limit"
  | "invalid-import-mapping"
  | "invalid-source"
  | "non-local-import"
  | "path-outside-workspace"
  | "source-not-found"
  | "source-not-regular"
  | "source-symlink"
  | "source-too-large"
  | "token-limit"
  | "total-source-too-large"
  | "workspace-file-limit"
  | "workspace-total-source-too-large"
  | "unsupported-expression";

interface StaticResolutionFailure {
  code: StaticResolutionFailureCode;
  detail: string;
}

type StaticResolutionResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: StaticResolutionFailure };

type StaticStringReference =
  | { kind: "literal"; value: string }
  | { kind: "identifier"; name: string }
  | { kind: "unsupported"; expression: string };

interface ParsedContractReferences {
  provides: StaticStringReference[];
  requires: StaticStringReference[];
}

function resolutionFailure(
  code: StaticResolutionFailureCode,
  detail: string,
): StaticResolutionResult<never> {
  return { ok: false, failure: { code, detail } };
}

function formatStaticResolutionFailure(
  failure: StaticResolutionFailure,
): string {
  return `[${failure.code}] ${failure.detail}`;
}

function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string";
}

function nodeList(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function identifierName(value: unknown): string | undefined {
  return isNode(value) && value.type === "Identifier" &&
      typeof value.name === "string"
    ? value.name
    : undefined;
}

function stringLiteralValue(value: unknown): string | undefined {
  return isNode(value) && value.type === "StringLiteral" &&
      typeof value.value === "string"
    ? value.value
    : undefined;
}

function unwrapExpression(value: unknown): AstNode | undefined {
  let current = isNode(value) ? value : undefined;
  const active = new Set<AstNode>();
  while (
    current &&
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TypeCastExpression",
    ].includes(current.type)
  ) {
    if (active.has(current)) return undefined;
    active.add(current);
    current = isNode(current.expression) ? current.expression : undefined;
  }
  return current;
}

function compareDeterministically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareDeterministically);
}

function staticPropertyName(property: AstNode): string | undefined {
  const key = unwrapExpression(property.key);
  if (!key) return undefined;
  if (key.type === "Identifier" && property.computed !== true) {
    return identifierName(key);
  }
  return stringLiteralValue(key);
}

interface PropertyLookup {
  found: boolean;
  value?: AstNode;
  issue?: string;
}

function lookupObjectProperty(
  object: AstNode,
  propertyName: string,
): PropertyLookup {
  if (object.type !== "ObjectExpression") {
    return { found: false, issue: "metadata value is not an object literal" };
  }

  let match: AstNode | undefined;
  for (const property of nodeList(object.properties)) {
    if (property.type === "SpreadElement") {
      return {
        found: false,
        issue: `object containing ${propertyName} must not use spreads`,
      };
    }
    if (
      property.type !== "ObjectProperty" && property.type !== "ObjectMethod"
    ) {
      return {
        found: false,
        issue: `object containing ${propertyName} has an unsupported member`,
      };
    }
    const name = staticPropertyName(property);
    if (name === "__proto__") {
      return {
        found: false,
        issue: `object containing ${propertyName} must not declare __proto__`,
      };
    }
    if (name === undefined && property.computed === true) {
      return {
        found: false,
        issue:
          `object containing ${propertyName} has a dynamic computed property`,
      };
    }
    if (name !== propertyName) continue;
    if (property.type !== "ObjectProperty") {
      return {
        found: false,
        issue: `${propertyName} must be a data property`,
      };
    }
    if (match) {
      return {
        found: false,
        issue: `${propertyName} must not be declared more than once`,
      };
    }
    match = unwrapExpression(property.value);
    if (!match) {
      return {
        found: false,
        issue: `${propertyName} has an unsupported value`,
      };
    }
  }
  return match ? { found: true, value: match } : { found: false };
}

function expressionLabel(value: AstNode | undefined): string {
  if (!value) return "missing expression";
  if (value.type === "Identifier") return identifierName(value) ?? value.type;
  return value.type;
}

function parseModuleBindings(
  source: string,
  sourcePath = "metadata.ts",
): StaticResolutionResult<StaticModuleBindings> {
  let ast: AstNode;
  try {
    const extension = extname(sourcePath).toLowerCase();
    const plugins: ParserPlugin[] = [
      "decorators-legacy",
      "importAttributes",
      "explicitResourceManagement",
    ];
    if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) {
      plugins.unshift("typescript");
    }
    if ([".tsx", ".jsx"].includes(extension)) plugins.push("jsx");
    ast = parse(source, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      errorRecovery: false,
      tokens: true,
      plugins,
    }) as unknown as AstNode;
  } catch (error) {
    return resolutionFailure(
      "invalid-source",
      `could not parse source: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const tokens = Array.isArray(ast.tokens) ? ast.tokens : [];
  if (tokens.length > MAX_EXTENSION_METADATA_TOKENS) {
    return resolutionFailure(
      "token-limit",
      `source exceeds ${MAX_EXTENSION_METADATA_TOKENS} syntax tokens`,
    );
  }

  const program = isNode(ast.program) ? ast.program : undefined;
  if (!program || program.type !== "Program") {
    return resolutionFailure("invalid-source", "parser returned no program");
  }

  const locals = new Map<string, StaticBindingExpression>();
  const values = new Map<string, AstNode>();
  const imports = new Map<string, StaticImportBinding>();
  const exports = new Map<string, StaticExportBinding>();
  const starExports: string[] = [];
  let defaultExport: AstNode | undefined;

  const recordDeclaration = (declaration: AstNode, exported: boolean): void => {
    if (declaration.type === "VariableDeclaration") {
      if (declaration.kind !== "const") return;
      for (const declarator of nodeList(declaration.declarations)) {
        if (declarator.type !== "VariableDeclarator") continue;
        const name = identifierName(declarator.id);
        const value = unwrapExpression(declarator.init);
        if (!name || name.length > MAX_STATIC_IDENTIFIER_CHARACTERS || !value) {
          continue;
        }
        values.set(name, value);
        const literal = stringLiteralValue(value);
        const alias = identifierName(value);
        locals.set(
          name,
          literal !== undefined
            ? { kind: "literal", value: literal }
            : alias
            ? { kind: "identifier", name: alias }
            : { kind: "unsupported" },
        );
        if (exported) {
          exports.set(name, { kind: "local", localName: name });
        }
      }
      return;
    }
    if (declaration.type === "FunctionDeclaration") {
      const name = identifierName(declaration.id);
      if (name) {
        values.set(name, declaration);
        if (exported) {
          exports.set(name, { kind: "local", localName: name });
        }
      }
    }
  };

  for (const statement of nodeList(program.body)) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      const specifier = stringLiteralValue(statement.source);
      if (!specifier) continue;
      for (const binding of nodeList(statement.specifiers)) {
        if (
          binding.type !== "ImportSpecifier" || binding.importKind === "type"
        ) continue;
        const localName = identifierName(binding.local);
        const importedName = identifierName(binding.imported) ??
          stringLiteralValue(binding.imported);
        if (localName && importedName) {
          imports.set(localName, { importedName, specifier });
        }
      }
      continue;
    }

    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = unwrapExpression(statement.declaration) ??
        (isNode(statement.declaration) ? statement.declaration : undefined);
      if (defaultExport || !declaration) {
        return resolutionFailure(
          "invalid-source",
          "extension entry must have exactly one default export",
        );
      }
      defaultExport = declaration;
      recordDeclaration(declaration, false);
      continue;
    }

    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      const specifier = stringLiteralValue(statement.source);
      if (specifier) starExports.push(specifier);
      continue;
    }

    if (statement.type === "ExportNamedDeclaration") {
      if (statement.exportKind === "type") continue;
      if (isNode(statement.declaration)) {
        recordDeclaration(statement.declaration, true);
      }
      const specifier = stringLiteralValue(statement.source);
      for (const binding of nodeList(statement.specifiers)) {
        if (
          binding.type !== "ExportSpecifier" || binding.exportKind === "type"
        ) continue;
        const localName = identifierName(binding.local) ??
          stringLiteralValue(binding.local);
        const exportedName = identifierName(binding.exported) ??
          stringLiteralValue(binding.exported);
        if (!localName || !exportedName) continue;
        exports.set(
          exportedName,
          specifier
            ? { kind: "reexport", importedName: localName, specifier }
            : { kind: "local", localName },
        );
      }
      continue;
    }

    recordDeclaration(statement, false);
  }

  return {
    ok: true,
    value: {
      ast,
      source,
      locals,
      values,
      imports,
      exports,
      starExports: uniqueSorted(starExports),
      ...(defaultExport ? { defaultExport } : {}),
    },
  };
}

function containsStaticProperty(ast: AstNode, propertyName: string): boolean {
  const pending: unknown[] = [ast];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (isNode(value)) {
      if (
        (value.type === "ObjectProperty" || value.type === "ObjectMethod") &&
        staticPropertyName(value) === propertyName
      ) return true;
      for (const [key, child] of Object.entries(value)) {
        if (key !== "loc" && key !== "tokens" && key !== "comments") {
          pending.push(child);
        }
      }
    } else if (Array.isArray(value)) {
      pending.push(...value);
    }
  }
  return false;
}

interface FactoryReturns {
  directCount: number;
  directValue?: AstNode;
  hasNestedReturn: boolean;
}

interface FactoryDescriptor {
  value: AstNode;
  scopeBindings: ReadonlySet<string>;
}

function addPatternBindings(
  pattern: AstNode,
  bindings: Set<string>,
): StaticResolutionResult<undefined> {
  const pending: AstNode[] = [pattern];
  let visitedNodes = 0;
  while (pending.length > 0) {
    const next = pending.pop()!;
    const value = unwrapExpression(next) ?? next;
    visitedNodes += 1;
    if (visitedNodes > MAX_FACTORY_SCOPE_NODES) {
      return resolutionFailure(
        "token-limit",
        `factory binding pattern exceeds ${MAX_FACTORY_SCOPE_NODES} syntax nodes`,
      );
    }
    if (value.type === "Identifier") {
      const name = identifierName(value);
      if (name) bindings.add(name);
    } else if (value.type === "RestElement") {
      if (!isNode(value.argument)) {
        return resolutionFailure(
          "unsupported-expression",
          "factory contains an invalid rest binding",
        );
      }
      pending.push(value.argument);
    } else if (value.type === "AssignmentPattern") {
      if (!isNode(value.left)) {
        return resolutionFailure(
          "unsupported-expression",
          "factory contains an invalid default binding",
        );
      }
      pending.push(value.left);
    } else if (value.type === "ArrayPattern") {
      pending.push(...nodeList(value.elements));
    } else if (value.type === "ObjectPattern") {
      for (const property of nodeList(value.properties)) {
        if (property.type === "RestElement" && isNode(property.argument)) {
          pending.push(property.argument);
        } else if (
          property.type === "ObjectProperty" && isNode(property.value)
        ) {
          pending.push(property.value);
        } else {
          return resolutionFailure(
            "unsupported-expression",
            "factory contains an unsupported object binding",
          );
        }
      }
    } else if (
      value.type === "TSParameterProperty" && isNode(value.parameter)
    ) {
      pending.push(value.parameter);
    } else {
      return resolutionFailure(
        "unsupported-expression",
        `factory contains unsupported binding ${expressionLabel(value)}`,
      );
    }
    if (bindings.size > MAX_FACTORY_SCOPE_BINDINGS) {
      return resolutionFailure(
        "token-limit",
        `factory exceeds ${MAX_FACTORY_SCOPE_BINDINGS} local bindings`,
      );
    }
  }
  return { ok: true, value: undefined };
}

function collectFactoryScopeBindings(
  factory: AstNode,
  body: AstNode,
): StaticResolutionResult<ReadonlySet<string>> {
  const bindings = new Set<string>();
  const functionName = identifierName(factory.id);
  if (functionName) bindings.add(functionName);
  for (const parameter of nodeList(factory.params)) {
    const added = addPatternBindings(parameter, bindings);
    if (!added.ok) return added;
  }
  if (body.type !== "BlockStatement") return { ok: true, value: bindings };

  const pending: unknown[] = nodeList(body.body).filter((statement) =>
    statement.type !== "ReturnStatement"
  );
  const visited = new Set<object>();
  let visitedNodes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isNode(value)) continue;
    visitedNodes += 1;
    if (visitedNodes > MAX_FACTORY_SCOPE_NODES) {
      return resolutionFailure(
        "token-limit",
        `factory scope exceeds ${MAX_FACTORY_SCOPE_NODES} syntax nodes`,
      );
    }

    if (value.type === "VariableDeclaration") {
      for (const declaration of nodeList(value.declarations)) {
        if (
          declaration.type !== "VariableDeclarator" || !isNode(declaration.id)
        ) {
          return resolutionFailure(
            "unsupported-expression",
            "factory contains an invalid variable declaration",
          );
        }
        const added = addPatternBindings(declaration.id, bindings);
        if (!added.ok) return added;
      }
      continue;
    }
    if (
      value.type === "FunctionDeclaration" ||
      value.type === "ClassDeclaration" ||
      value.type === "TSEnumDeclaration" ||
      value.type === "TSModuleDeclaration"
    ) {
      const name = identifierName(value.id);
      if (name) bindings.add(name);
      if (bindings.size > MAX_FACTORY_SCOPE_BINDINGS) {
        return resolutionFailure(
          "token-limit",
          `factory exceeds ${MAX_FACTORY_SCOPE_BINDINGS} local bindings`,
        );
      }
      continue;
    }
    if (
      value.type === "ArrowFunctionExpression" ||
      value.type === "FunctionExpression" ||
      value.type === "ObjectMethod" ||
      value.type === "ClassExpression" ||
      value.type === "ClassMethod" ||
      value.type === "ClassPrivateMethod"
    ) {
      continue;
    }
    if (value.type === "CatchClause" && isNode(value.param)) {
      const added = addPatternBindings(value.param, bindings);
      if (!added.ok) return added;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        key !== "loc" && key !== "tokens" && key !== "comments" &&
        !(value.type === "CatchClause" && key === "param")
      ) {
        pending.push(child);
      }
    }
    if (bindings.size > MAX_FACTORY_SCOPE_BINDINGS) {
      return resolutionFailure(
        "token-limit",
        `factory exceeds ${MAX_FACTORY_SCOPE_BINDINGS} local bindings`,
      );
    }
  }
  return { ok: true, value: bindings };
}

function collectFactoryReturns(body: AstNode): FactoryReturns {
  if (body.type !== "BlockStatement") {
    return { directCount: 0, hasNestedReturn: false };
  }
  const statements = nodeList(body.body);
  const directReturns = statements.filter((statement) =>
    statement.type === "ReturnStatement"
  );
  const directValue = directReturns.length === 1
    ? unwrapExpression(directReturns[0]!.argument)
    : undefined;
  const pending: unknown[] = statements.filter((statement) =>
    statement.type !== "ReturnStatement"
  );
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isNode(value)) continue;
    if (value.type === "ReturnStatement") {
      return {
        directCount: directReturns.length,
        ...(directValue ? { directValue } : {}),
        hasNestedReturn: true,
      };
    }
    if (
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression",
        "ObjectMethod",
        "ClassDeclaration",
        "ClassExpression",
      ].includes(value.type)
    ) continue;
    for (const [key, child] of Object.entries(value)) {
      if (key !== "loc") pending.push(child);
    }
  }
  return {
    directCount: directReturns.length,
    ...(directValue ? { directValue } : {}),
    hasNestedReturn: false,
  };
}

function bindingIsPrivateToDefaultExport(ast: AstNode, name: string): boolean {
  const pending: Array<{ value: unknown; parent?: AstNode; key?: string }> = [
    { value: ast },
  ];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const { value, parent, key } = pending.pop()!;
    if (value === null || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      for (const child of value) pending.push({ value: child, parent, key });
      continue;
    }
    if (!isNode(value)) continue;
    if (value.type === "Identifier" && identifierName(value) === name) {
      const declaration = parent &&
        ((parent.type === "VariableDeclarator" && key === "id") ||
          (parent.type === "FunctionDeclaration" && key === "id"));
      const defaultExport = parent?.type === "ExportDefaultDeclaration" &&
        key === "declaration";
      const nonReferenceKey = parent &&
        (((parent.type === "ObjectProperty" ||
          parent.type === "ObjectMethod") &&
          key === "key" &&
          parent.computed !== true) ||
          (parent.type === "MemberExpression" && key === "property" &&
            parent.computed !== true) ||
          (["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(
            parent.type,
          ) && key === "label"));
      if (!declaration && !defaultExport && !nonReferenceKey) return false;
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (
        childKey !== "loc" && childKey !== "tokens" && childKey !== "comments"
      ) {
        pending.push({ value: child, parent: value, key: childKey });
      }
    }
  }
  return true;
}

function resolveFactoryDescriptor(
  module: StaticModuleBindings,
  expression: AstNode,
  active = new Set<string>(),
  depth = 0,
): StaticResolutionResult<FactoryDescriptor> {
  if (depth > MAX_EXTENSION_METADATA_RESOLUTION_DEPTH) {
    return resolutionFailure(
      "depth-limit",
      `factory resolution exceeds depth ${MAX_EXTENSION_METADATA_RESOLUTION_DEPTH}`,
    );
  }
  const value = unwrapExpression(expression) ?? expression;
  if (value.type === "Identifier") {
    const name = identifierName(value)!;
    if (active.has(name)) {
      return resolutionFailure("cycle", `factory binding cycle at ${name}`);
    }
    const bound = module.values.get(name);
    if (!bound) {
      return resolutionFailure(
        "binding-not-found",
        `default-export binding ${name} was not found`,
      );
    }
    const boundValue = unwrapExpression(bound) ?? bound;
    if (
      boundValue.type !== "ArrowFunctionExpression" &&
      boundValue.type !== "FunctionExpression"
    ) {
      return resolutionFailure(
        "unsupported-expression",
        `default-export binding ${name} must be a const function expression`,
      );
    }
    if (!bindingIsPrivateToDefaultExport(module.ast, name)) {
      return resolutionFailure(
        "unsupported-expression",
        `default-export factory binding ${name} has additional references`,
      );
    }
    active.add(name);
    const result = resolveFactoryDescriptor(
      module,
      boundValue,
      active,
      depth + 1,
    );
    active.delete(name);
    return result;
  }
  if (
    value.type !== "ArrowFunctionExpression" &&
    value.type !== "FunctionExpression" &&
    value.type !== "FunctionDeclaration"
  ) {
    return resolutionFailure(
      "unsupported-expression",
      `default export is ${expressionLabel(value)}, not a static factory`,
    );
  }
  if (value.type === "FunctionDeclaration" && identifierName(value.id)) {
    return resolutionFailure(
      "unsupported-expression",
      "named default function declarations are mutable bindings",
    );
  }
  if (value.async === true || value.generator === true) {
    return resolutionFailure(
      "unsupported-expression",
      "extension factory must be synchronous and non-generator",
    );
  }
  const body = unwrapExpression(value.body) ??
    (isNode(value.body) ? value.body : undefined);
  if (!body) {
    return resolutionFailure("unsupported-expression", "factory has no body");
  }
  const scopeBindings = collectFactoryScopeBindings(value, body);
  if (!scopeBindings.ok) return scopeBindings;
  if (body.type === "ObjectExpression") {
    return {
      ok: true,
      value: { value: body, scopeBindings: scopeBindings.value },
    };
  }
  const returns = collectFactoryReturns(body);
  if (
    returns.hasNestedReturn || returns.directCount !== 1 ||
    returns.directValue?.type !== "ObjectExpression"
  ) {
    return resolutionFailure(
      "unsupported-expression",
      "factory must return exactly one inline extension object",
    );
  }
  return {
    ok: true,
    value: { value: returns.directValue, scopeBindings: scopeBindings.value },
  };
}

function parseContractList(
  value: AstNode,
  path: "contracts.provides" | "contracts.requires",
  factoryScopeBindings: ReadonlySet<string>,
): StaticStringReference[] {
  const expression = unwrapExpression(value) ?? value;
  if (expression.type !== "ArrayExpression") {
    return [{
      kind: "unsupported",
      expression: `${path} must be an inline array`,
    }];
  }
  const rawElements = Array.isArray(expression.elements)
    ? expression.elements
    : [];
  if (rawElements.length > MAX_EXTENSION_METADATA_CONTRACT_REFERENCES) {
    return [{
      kind: "unsupported",
      expression:
        `${path} exceeds ${MAX_EXTENSION_METADATA_CONTRACT_REFERENCES} entries`,
    }];
  }
  return rawElements.map((element, index): StaticStringReference => {
    if (element === null) {
      return {
        kind: "unsupported",
        expression: `${path}[${index}] must not be an array hole`,
      };
    }
    const entry = unwrapExpression(element);
    const literal = stringLiteralValue(entry);
    if (literal !== undefined) return { kind: "literal", value: literal };
    const name = identifierName(entry);
    if (name && name.length <= MAX_STATIC_IDENTIFIER_CHARACTERS) {
      if (factoryScopeBindings.has(name)) {
        return {
          kind: "unsupported",
          expression:
            `${path}[${index}] identifier ${name} is shadowed by a factory-local binding`,
        };
      }
      return { kind: "identifier", name };
    }
    return {
      kind: "unsupported",
      expression: `${path}[${index}] is ${expressionLabel(entry)}`,
    };
  });
}

function unsupportedContractReferences(
  message: string,
): ParsedContractReferences {
  return {
    provides: [{ kind: "unsupported", expression: message }],
    requires: [],
  };
}

function parseContractReferences(
  module: StaticModuleBindings,
): ParsedContractReferences | undefined {
  if (!module.defaultExport) {
    return containsStaticProperty(module.ast, "contracts")
      ? unsupportedContractReferences(
        "source declares contracts but has no statically identifiable default extension factory",
      )
      : undefined;
  }
  const descriptor = resolveFactoryDescriptor(module, module.defaultExport);
  if (!descriptor.ok) {
    return unsupportedContractReferences(
      `could not identify extension factory metadata: ${
        formatStaticResolutionFailure(descriptor.failure)
      }`,
    );
  }
  const contractsProperty = lookupObjectProperty(
    descriptor.value.value,
    "contracts",
  );
  if (contractsProperty.issue) {
    return unsupportedContractReferences(contractsProperty.issue);
  }
  if (!contractsProperty.found || !contractsProperty.value) return undefined;
  const legacyProvidesProperty = lookupObjectProperty(
    descriptor.value.value,
    "provides",
  );
  if (legacyProvidesProperty.issue) {
    return unsupportedContractReferences(legacyProvidesProperty.issue);
  }
  if (legacyProvidesProperty.found) {
    return unsupportedContractReferences(
      "extension factory must not mix contracts with legacy provides",
    );
  }
  const contracts = unwrapExpression(contractsProperty.value);
  if (contracts?.type !== "ObjectExpression") {
    return unsupportedContractReferences(
      "contracts metadata must be an inline object literal",
    );
  }

  const readList = (
    propertyName: "provides" | "requires",
  ): StaticStringReference[] => {
    const property = lookupObjectProperty(contracts, propertyName);
    if (property.issue) {
      return [{ kind: "unsupported", expression: property.issue }];
    }
    if (!property.found || !property.value) return [];
    return parseContractList(
      property.value,
      `contracts.${propertyName}`,
      descriptor.value.scopeBindings,
    );
  };

  return { provides: readList("provides"), requires: readList("requires") };
}

function resolvedContractMetadata(
  provides: readonly string[],
  requires: readonly string[],
): ContractMetadata {
  const normalizedProvides = uniqueSorted(provides);
  const normalizedRequires = uniqueSorted(requires);
  return {
    ...(normalizedProvides.length > 0 ? { provides: normalizedProvides } : {}),
    ...(normalizedRequires.length > 0 ? { requires: normalizedRequires } : {}),
  };
}

function resolveLocalStaticIdentifier(
  module: StaticModuleBindings,
  name: string,
  active = new Set<string>(),
  depth = 0,
): StaticResolutionResult<string> {
  if (depth > MAX_EXTENSION_METADATA_RESOLUTION_DEPTH) {
    return resolutionFailure(
      "depth-limit",
      `binding resolution exceeds depth ${MAX_EXTENSION_METADATA_RESOLUTION_DEPTH}`,
    );
  }
  if (active.has(name)) {
    return resolutionFailure("cycle", `local binding cycle at ${name}`);
  }
  const expression = module.locals.get(name);
  if (expression?.kind === "literal") {
    return { ok: true, value: expression.value };
  }
  if (expression?.kind === "unsupported") {
    return resolutionFailure(
      "unsupported-expression",
      `binding ${name} is not exactly a static string or identifier`,
    );
  }
  if (expression?.kind === "identifier") {
    active.add(name);
    const result = resolveLocalStaticIdentifier(
      module,
      expression.name,
      active,
      depth + 1,
    );
    active.delete(name);
    return result;
  }
  if (module.imports.has(name)) {
    return resolutionFailure(
      "non-local-import",
      `binding ${name} requires file-aware import resolution`,
    );
  }
  return resolutionFailure(
    "binding-not-found",
    `binding ${name} was not found`,
  );
}

function validateResolvedContractName(
  value: string,
  path: string,
  index: number,
  seen: Set<string>,
): string | undefined {
  if (value.trim().length === 0) {
    return `${path}[${index}] must be a non-empty string`;
  }
  if (value.trim() !== value) {
    return `${path}[${index}] must not have surrounding whitespace`;
  }
  if (!isWellFormedUnicode(value)) {
    return `${path}[${index}] must contain well-formed Unicode`;
  }
  if (containsUnicodeControlOrLineSeparator(value)) {
    return `${path}[${index}] must not contain Unicode control characters or line separators`;
  }
  if (value.length > MAX_EXTENSION_CONTRACT_NAME_CHARACTERS) {
    return `${path}[${index}] must not exceed ${MAX_EXTENSION_CONTRACT_NAME_CHARACTERS} characters`;
  }
  if (seen.has(value)) return `${path}[${index}] duplicates "${value}"`;
  seen.add(value);
  return undefined;
}

async function collectResolvedContractReferences(
  references: readonly StaticStringReference[],
  path: "contracts.provides" | "contracts.requires",
  resolveIdentifier: (
    name: string,
  ) => StaticResolutionResult<string> | Promise<StaticResolutionResult<string>>,
): Promise<{ values: string[]; issues: string[] }> {
  const values: string[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]!;
    if (reference.kind === "unsupported") {
      issues.push(
        `${path}[${index}] uses an unsupported expression: ${reference.expression}`,
      );
      continue;
    }
    if (reference.kind === "literal") {
      const validationIssue = validateResolvedContractName(
        reference.value,
        path,
        index,
        seen,
      );
      if (validationIssue) issues.push(validationIssue);
      else values.push(reference.value);
      continue;
    }
    const result = await resolveIdentifier(reference.name);
    if (!result.ok) {
      issues.push(
        `${path}[${index}] could not resolve ${reference.name}: ${
          formatStaticResolutionFailure(result.failure)
        }`,
      );
      continue;
    }
    const validationIssue = validateResolvedContractName(
      result.value,
      path,
      index,
      seen,
    );
    if (validationIssue) issues.push(validationIssue);
    else values.push(result.value);
  }
  return { values, issues };
}

function isContainedPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${SEPARATOR}`));
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isSupportedSourceExtension(path: string): boolean {
  return [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]
    .includes(extname(path).toLowerCase());
}

class StaticContractResolver {
  readonly #workspaceRoot: string;
  readonly #entryPath: string;
  readonly #importMapBaseDir: string;
  readonly #imports: Readonly<Record<string, unknown>>;
  readonly #workspaceBudget?: ExtensionMetadataWorkspaceBudget;
  readonly #moduleCache = new Map<
    string,
    StaticResolutionResult<StaticModuleBindings>
  >();
  readonly #visitedFiles = new Set<string>();
  #totalSourceBytes = 0;

  private constructor(
    workspaceRoot: string,
    entryPath: string,
    importMapBaseDir: string,
    imports: Readonly<Record<string, unknown>>,
    workspaceBudget?: ExtensionMetadataWorkspaceBudget,
  ) {
    this.#workspaceRoot = workspaceRoot;
    this.#entryPath = entryPath;
    this.#importMapBaseDir = importMapBaseDir;
    this.#imports = imports;
    this.#workspaceBudget = workspaceBudget;
  }

  static async create(
    options: ExtensionSourceFileMetadataOptions,
  ): Promise<StaticContractResolver> {
    if (!isAbsolute(options.workspaceRoot)) {
      throw new TypeError("workspaceRoot must be absolute");
    }
    if (!isAbsolute(options.entryPath)) {
      throw new TypeError("entryPath must be absolute");
    }
    if (!isAbsolute(options.importMapBaseDir)) {
      throw new TypeError("importMapBaseDir must be absolute");
    }
    if (
      typeof options.imports !== "object" || options.imports === null ||
      Array.isArray(options.imports)
    ) {
      throw new TypeError("imports must be an object");
    }
    if (
      Object.keys(options.imports).length >
        MAX_EXTENSION_METADATA_IMPORT_MAPPINGS
    ) {
      throw new TypeError(
        `imports exceeds ${MAX_EXTENSION_METADATA_IMPORT_MAPPINGS} mappings`,
      );
    }
    if (
      options.workspaceBudget &&
      (!Number.isSafeInteger(options.workspaceBudget.sourceFiles) ||
        options.workspaceBudget.sourceFiles < 0 ||
        !Number.isSafeInteger(options.workspaceBudget.sourceBytes) ||
        options.workspaceBudget.sourceBytes < 0)
    ) {
      throw new TypeError(
        "workspaceBudget counters must be non-negative safe integers",
      );
    }

    let workspaceRoot: string;
    try {
      workspaceRoot = await Deno.realPath(options.workspaceRoot);
    } catch {
      throw new TypeError("workspaceRoot could not be resolved");
    }
    let entryInfo: Deno.FileInfo;
    try {
      entryInfo = await Deno.lstat(options.entryPath);
    } catch (error) {
      throw new TypeError(
        error instanceof Deno.errors.NotFound
          ? "entryPath was not found"
          : "entryPath could not be inspected",
      );
    }
    if (entryInfo.isSymlink) {
      throw new TypeError("entryPath must not be a symlink");
    }
    let entryPath: string;
    let importMapBaseDir: string;
    try {
      entryPath = await Deno.realPath(options.entryPath);
      importMapBaseDir = await Deno.realPath(options.importMapBaseDir);
    } catch {
      throw new TypeError(
        "entryPath or importMapBaseDir could not be resolved",
      );
    }
    if (
      !isContainedPath(workspaceRoot, entryPath) ||
      !isContainedPath(workspaceRoot, importMapBaseDir)
    ) {
      throw new TypeError(
        "entryPath and importMapBaseDir must be inside workspaceRoot",
      );
    }
    return new StaticContractResolver(
      workspaceRoot,
      entryPath,
      importMapBaseDir,
      options.imports,
      options.workspaceBudget,
    );
  }

  get entryPath(): string {
    return this.#entryPath;
  }

  #pathLabel(path: string): string {
    const label = relative(this.#workspaceRoot, path);
    return label.length === 0 ? "." : label.replaceAll("\\", "/");
  }

  async #resolveExistingSourcePath(
    unresolvedPath: string,
  ): Promise<StaticResolutionResult<string>> {
    const candidate = resolve(unresolvedPath);
    if (!isContainedPath(this.#workspaceRoot, candidate)) {
      return resolutionFailure(
        "path-outside-workspace",
        `source path escapes the workspace: ${this.#pathLabel(candidate)}`,
      );
    }
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      return error instanceof Deno.errors.NotFound
        ? resolutionFailure(
          "source-not-found",
          `source was not found: ${this.#pathLabel(candidate)}`,
        )
        : resolutionFailure(
          "invalid-source",
          `could not inspect ${this.#pathLabel(candidate)}`,
        );
    }
    if (info.isSymlink) {
      return resolutionFailure(
        "source-symlink",
        `source must not be a symlink: ${this.#pathLabel(candidate)}`,
      );
    }
    if (!info.isFile) {
      return resolutionFailure(
        "source-not-regular",
        `source is not a regular file: ${this.#pathLabel(candidate)}`,
      );
    }
    if (!isSupportedSourceExtension(candidate)) {
      return resolutionFailure(
        "invalid-source",
        `unsupported source extension: ${this.#pathLabel(candidate)}`,
      );
    }
    let realPath: string;
    try {
      realPath = await Deno.realPath(candidate);
    } catch {
      return resolutionFailure(
        "invalid-source",
        `could not resolve ${this.#pathLabel(candidate)}`,
      );
    }
    if (!isContainedPath(this.#workspaceRoot, realPath)) {
      return resolutionFailure(
        "path-outside-workspace",
        `resolved source escapes the workspace: ${this.#pathLabel(realPath)}`,
      );
    }
    return { ok: true, value: realPath };
  }

  async #loadModule(
    unresolvedPath: string,
  ): Promise<StaticResolutionResult<StaticModuleBindings>> {
    const pathResult = await this.#resolveExistingSourcePath(unresolvedPath);
    if (!pathResult.ok) return pathResult;
    const path = pathResult.value;
    const cached = this.#moduleCache.get(path);
    if (cached) return cached;
    if (this.#visitedFiles.size >= MAX_EXTENSION_METADATA_FILES) {
      return resolutionFailure(
        "file-limit",
        `resolution exceeds ${MAX_EXTENSION_METADATA_FILES} source files`,
      );
    }
    if (
      this.#workspaceBudget &&
      this.#workspaceBudget.sourceFiles >=
        MAX_EXTENSION_METADATA_WORKSPACE_FILES
    ) {
      return resolutionFailure(
        "workspace-file-limit",
        `workspace audit exceeds ${MAX_EXTENSION_METADATA_WORKSPACE_FILES} parsed source files`,
      );
    }
    this.#visitedFiles.add(path);
    if (this.#workspaceBudget) this.#workspaceBudget.sourceFiles += 1;

    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(path);
    } catch {
      return resolutionFailure(
        "invalid-source",
        `could not inspect ${this.#pathLabel(path)}`,
      );
    }
    if (!info.isFile || !Number.isSafeInteger(info.size) || info.size < 0) {
      return resolutionFailure(
        "source-not-regular",
        `source is not a regular bounded file: ${this.#pathLabel(path)}`,
      );
    }
    if (info.size > MAX_EXTENSION_METADATA_SOURCE_BYTES) {
      return resolutionFailure(
        "source-too-large",
        `${
          this.#pathLabel(path)
        } exceeds ${MAX_EXTENSION_METADATA_SOURCE_BYTES} bytes`,
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(path);
    } catch {
      return resolutionFailure(
        "invalid-source",
        `could not read ${this.#pathLabel(path)}`,
      );
    }
    if (bytes.length > MAX_EXTENSION_METADATA_SOURCE_BYTES) {
      return resolutionFailure(
        "source-too-large",
        `${
          this.#pathLabel(path)
        } exceeds ${MAX_EXTENSION_METADATA_SOURCE_BYTES} bytes`,
      );
    }
    if (this.#workspaceBudget) {
      this.#workspaceBudget.sourceBytes += bytes.length;
      if (
        this.#workspaceBudget.sourceBytes >
          MAX_EXTENSION_METADATA_WORKSPACE_SOURCE_BYTES
      ) {
        return resolutionFailure(
          "workspace-total-source-too-large",
          `workspace audit exceeds ${MAX_EXTENSION_METADATA_WORKSPACE_SOURCE_BYTES} parsed source bytes`,
        );
      }
    }
    this.#totalSourceBytes += bytes.length;
    if (this.#totalSourceBytes > MAX_EXTENSION_METADATA_TOTAL_SOURCE_BYTES) {
      return resolutionFailure(
        "total-source-too-large",
        `resolution exceeds ${MAX_EXTENSION_METADATA_TOTAL_SOURCE_BYTES} total source bytes`,
      );
    }
    let source: string;
    try {
      source = decoder.decode(bytes);
    } catch {
      return resolutionFailure(
        "invalid-source",
        `source is not valid UTF-8: ${this.#pathLabel(path)}`,
      );
    }
    const parsed = parseModuleBindings(source, path);
    this.#moduleCache.set(path, parsed);
    return parsed;
  }

  async loadEntry(): Promise<StaticResolutionResult<StaticModuleBindings>> {
    return await this.#loadModule(this.#entryPath);
  }

  #mappedSpecifierTarget(
    specifier: string,
    importer: string,
  ): StaticResolutionResult<string> {
    if (
      specifier.length === 0 ||
      specifier.length > MAX_STATIC_SPECIFIER_CHARACTERS
    ) {
      return resolutionFailure(
        "invalid-import-mapping",
        "module specifier is empty or too long",
      );
    }
    if (isLocalSpecifier(specifier)) {
      if (hasForbiddenLocalModulePathSyntax(specifier)) {
        return resolutionFailure(
          "invalid-import-mapping",
          "local module specifier contains unsupported URL/path syntax",
        );
      }
      return { ok: true, value: resolve(dirname(importer), specifier) };
    }

    let mappingKey: string | undefined;
    if (Object.hasOwn(this.#imports, specifier)) {
      mappingKey = specifier;
    } else {
      for (const key of Object.keys(this.#imports).sort(compareDeterministically)) {
        if (
          key.endsWith("/") && specifier.startsWith(key) &&
          (mappingKey === undefined || key.length > mappingKey.length)
        ) mappingKey = key;
      }
    }
    if (mappingKey === undefined) {
      return resolutionFailure(
        "non-local-import",
        `specifier is not mapped to local source: ${specifier}`,
      );
    }
    const mapped = this.#imports[mappingKey];
    if (
      typeof mapped !== "string" || mapped.length === 0 ||
      mapped.length > MAX_STATIC_SPECIFIER_CHARACTERS
    ) {
      return resolutionFailure(
        "invalid-import-mapping",
        `manifest import mapping is invalid: ${mappingKey}`,
      );
    }
    if (!isLocalSpecifier(mapped)) {
      return resolutionFailure(
        "non-local-import",
        `manifest mapping is not local source: ${mappingKey}`,
      );
    }
    if (hasForbiddenLocalModulePathSyntax(mapped)) {
      return resolutionFailure(
        "invalid-import-mapping",
        `local mapping target contains unsupported URL/path syntax: ${mappingKey}`,
      );
    }
    if (mappingKey.endsWith("/") && !mapped.endsWith("/")) {
      return resolutionFailure(
        "invalid-import-mapping",
        `prefix mapping target must end with "/": ${mappingKey}`,
      );
    }
    const suffix = mappingKey.endsWith("/")
      ? specifier.slice(mappingKey.length)
      : "";
    if (
      suffix &&
      (hasForbiddenLocalModulePathSyntax(suffix) ||
        suffix.split("/").some((segment) =>
          segment.length === 0 || segment === "." || segment === ".."
        ))
    ) {
      return resolutionFailure(
        "invalid-import-mapping",
        `mapped module suffix contains unsupported URL/path syntax: ${mappingKey}`,
      );
    }
    return {
      ok: true,
      value: resolve(this.#importMapBaseDir, `${mapped}${suffix}`),
    };
  }

  async #resolveImportedPath(
    importer: string,
    specifier: string,
  ): Promise<StaticResolutionResult<string>> {
    const target = this.#mappedSpecifierTarget(specifier, importer);
    return target.ok
      ? await this.#resolveExistingSourcePath(target.value)
      : target;
  }

  async resolveEntryIdentifier(
    name: string,
  ): Promise<StaticResolutionResult<string>> {
    return await this.#resolveBinding(
      "local",
      this.#entryPath,
      name,
      0,
      new Set(),
    );
  }

  async #resolveBinding(
    mode: "local" | "export",
    unresolvedPath: string,
    name: string,
    depth: number,
    active: Set<string>,
  ): Promise<StaticResolutionResult<string>> {
    if (depth > MAX_EXTENSION_METADATA_RESOLUTION_DEPTH) {
      return resolutionFailure(
        "depth-limit",
        `binding resolution exceeds depth ${MAX_EXTENSION_METADATA_RESOLUTION_DEPTH}`,
      );
    }
    const pathResult = await this.#resolveExistingSourcePath(unresolvedPath);
    if (!pathResult.ok) return pathResult;
    const path = pathResult.value;
    const key = `${mode}:${path}:${name}`;
    if (active.has(key)) {
      return resolutionFailure(
        "cycle",
        `binding cycle at ${this.#pathLabel(path)}#${name}`,
      );
    }
    active.add(key);
    try {
      const moduleResult = await this.#loadModule(path);
      if (!moduleResult.ok) return moduleResult;
      const module = moduleResult.value;
      if (mode === "local") {
        const local = module.locals.get(name);
        if (local?.kind === "literal") return { ok: true, value: local.value };
        if (local?.kind === "identifier") {
          return await this.#resolveBinding(
            "local",
            path,
            local.name,
            depth + 1,
            active,
          );
        }
        if (local?.kind === "unsupported") {
          return resolutionFailure(
            "unsupported-expression",
            `binding ${
              this.#pathLabel(path)
            }#${name} is not exactly a static string or identifier`,
          );
        }
        const imported = module.imports.get(name);
        if (!imported) {
          return resolutionFailure(
            "binding-not-found",
            `binding ${this.#pathLabel(path)}#${name} was not found`,
          );
        }
        const importedPath = await this.#resolveImportedPath(
          path,
          imported.specifier,
        );
        return importedPath.ok
          ? await this.#resolveBinding(
            "export",
            importedPath.value,
            imported.importedName,
            depth + 1,
            active,
          )
          : importedPath;
      }

      const exported = module.exports.get(name);
      if (exported?.kind === "local") {
        return await this.#resolveBinding(
          "local",
          path,
          exported.localName,
          depth + 1,
          active,
        );
      }
      if (exported?.kind === "reexport") {
        const exportedPath = await this.#resolveImportedPath(
          path,
          exported.specifier,
        );
        return exportedPath.ok
          ? await this.#resolveBinding(
            "export",
            exportedPath.value,
            exported.importedName,
            depth + 1,
            active,
          )
          : exportedPath;
      }

      let match: string | undefined;
      let matches = 0;
      for (const specifier of module.starExports) {
        const starPath = await this.#resolveImportedPath(path, specifier);
        if (!starPath.ok) return starPath;
        const starResult = await this.#resolveBinding(
          "export",
          starPath.value,
          name,
          depth + 1,
          active,
        );
        if (starResult.ok) {
          matches += 1;
          match = starResult.value;
        } else if (starResult.failure.code !== "binding-not-found") {
          return starResult;
        }
      }
      if (matches === 1 && match !== undefined) {
        return { ok: true, value: match };
      }
      if (matches > 1) {
        return resolutionFailure(
          "ambiguous-binding",
          `multiple star exports provide ${this.#pathLabel(path)}#${name}`,
        );
      }
      return resolutionFailure(
        "binding-not-found",
        `export ${this.#pathLabel(path)}#${name} was not found`,
      );
    } finally {
      active.delete(key);
    }
  }
}

function resolveInlineLiteralValue(
  expression: AstNode,
  depth = 0,
): StaticResolutionResult<unknown> {
  if (depth > MAX_EXTENSION_METADATA_RESOLUTION_DEPTH) {
    return resolutionFailure(
      "depth-limit",
      `literal resolution exceeds depth ${MAX_EXTENSION_METADATA_RESOLUTION_DEPTH}`,
    );
  }
  const value = unwrapExpression(expression) ?? expression;
  if (value.type === "StringLiteral") return { ok: true, value: value.value };
  if (value.type === "BooleanLiteral") return { ok: true, value: value.value };
  if (value.type === "NullLiteral") return { ok: true, value: null };
  if (
    value.type === "NumericLiteral" && typeof value.value === "number" &&
    Number.isFinite(value.value)
  ) return { ok: true, value: value.value };
  if (value.type === "UnaryExpression" && value.operator === "-") {
    const argument = unwrapExpression(value.argument);
    if (
      argument?.type === "NumericLiteral" &&
      typeof argument.value === "number" && Number.isFinite(argument.value)
    ) return { ok: true, value: -argument.value };
  }
  if (value.type === "ArrayExpression") {
    const result: unknown[] = [];
    const elements = Array.isArray(value.elements) ? value.elements : [];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (
        element === null || !isNode(element) || element.type === "SpreadElement"
      ) {
        return resolutionFailure(
          "unsupported-expression",
          `literal array has a hole or spread at index ${index}`,
        );
      }
      const resolved = resolveInlineLiteralValue(element, depth + 1);
      if (!resolved.ok) return resolved;
      result.push(resolved.value);
    }
    return { ok: true, value: result };
  }
  if (value.type === "ObjectExpression") {
    const result: Record<string, unknown> = Object.create(null);
    for (const property of nodeList(value.properties)) {
      if (property.type !== "ObjectProperty") {
        return resolutionFailure(
          "unsupported-expression",
          "literal object must contain only data properties",
        );
      }
      const propertyName = staticPropertyName(property);
      if (!propertyName) {
        return resolutionFailure(
          "unsupported-expression",
          "literal object has a dynamic computed property",
        );
      }
      if (propertyName === "__proto__") {
        return resolutionFailure(
          "unsupported-expression",
          "literal object must not declare __proto__",
        );
      }
      if (Object.hasOwn(result, propertyName)) {
        return resolutionFailure(
          "unsupported-expression",
          `literal object duplicates property ${propertyName}`,
        );
      }
      const propertyValue = unwrapExpression(property.value);
      if (!propertyValue) {
        return resolutionFailure(
          "unsupported-expression",
          `literal object property ${propertyName} has no static value`,
        );
      }
      const resolved = resolveInlineLiteralValue(propertyValue, depth + 1);
      if (!resolved.ok) return resolved;
      result[propertyName] = resolved.value;
    }
    return { ok: true, value: result };
  }
  return resolutionFailure(
    "unsupported-expression",
    `literal metadata contains ${expressionLabel(value)}`,
  );
}

function isCapability(value: unknown): value is Capability {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).type === "string";
}

interface ParsedCapabilities {
  values: Capability[];
  issues: string[];
}

function parseCapabilities(module: StaticModuleBindings): ParsedCapabilities {
  if (!module.defaultExport) {
    return {
      values: [],
      issues: [
        "source has no statically identifiable default extension factory",
      ],
    };
  }
  const descriptor = resolveFactoryDescriptor(module, module.defaultExport);
  if (!descriptor.ok) {
    return {
      values: [],
      issues: [
        `could not identify extension factory capabilities: ${
          formatStaticResolutionFailure(descriptor.failure)
        }`,
      ],
    };
  }
  const property = lookupObjectProperty(descriptor.value.value, "capabilities");
  if (property.issue) return { values: [], issues: [property.issue] };
  if (!property.found || !property.value) {
    return {
      values: [],
      issues: ["extension factory is missing capabilities metadata"],
    };
  }
  const resolved = resolveInlineLiteralValue(property.value);
  if (!resolved.ok) {
    return {
      values: [],
      issues: [
        `capabilities metadata could not be resolved: ${
          formatStaticResolutionFailure(resolved.failure)
        }`,
      ],
    };
  }
  if (!Array.isArray(resolved.value)) {
    return { values: [], issues: ["capabilities must be a static array"] };
  }
  const values: Capability[] = [];
  const issues: string[] = [];
  for (let index = 0; index < resolved.value.length; index += 1) {
    const capability = resolved.value[index];
    if (!isCapability(capability)) {
      issues.push(
        `capabilities[${index}] must be an object with a string type`,
      );
      continue;
    }
    if (
      capability.type.trim().length === 0 ||
      capability.type.trim() !== capability.type
    ) {
      issues.push(`capabilities[${index}].type must be a canonical string`);
      continue;
    }
    if (
      !isWellFormedUnicode(capability.type) ||
      containsUnicodeControlOrLineSeparator(capability.type) ||
      capability.type.length > MAX_CAPABILITY_TYPE_CHARACTERS
    ) {
      issues.push(
        `capabilities[${index}].type must be well-formed, single-line, and at most ${MAX_CAPABILITY_TYPE_CHARACTERS} characters`,
      );
      continue;
    }
    values.push(capability);
  }
  return { values, issues };
}

interface ParsedLegacyProvides {
  values: string[];
  issues: string[];
}

function parseLegacyProvides(
  module: StaticModuleBindings,
): ParsedLegacyProvides {
  if (!module.defaultExport) {
    return {
      values: [],
      issues: [
        "source has no statically identifiable default extension factory",
      ],
    };
  }
  const descriptor = resolveFactoryDescriptor(module, module.defaultExport);
  if (!descriptor.ok) {
    return containsStaticProperty(module.ast, "provides")
      ? {
        values: [],
        issues: [
          `could not identify extension factory legacy provides: ${
            formatStaticResolutionFailure(descriptor.failure)
          }`,
        ],
      }
      : { values: [], issues: [] };
  }
  const contracts = lookupObjectProperty(descriptor.value.value, "contracts");
  if (contracts.issue) return { values: [], issues: [contracts.issue] };
  if (contracts.found) return { values: [], issues: [] };
  const provides = lookupObjectProperty(descriptor.value.value, "provides");
  if (provides.issue) return { values: [], issues: [provides.issue] };
  if (!provides.found || !provides.value) return { values: [], issues: [] };
  const object = unwrapExpression(provides.value);
  if (object?.type !== "ObjectExpression") {
    return {
      values: [],
      issues: ["legacy provides metadata must be an inline object literal"],
    };
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const property of nodeList(object.properties)) {
    const index = names.length;
    if (index >= MAX_EXTENSION_CONTRACTS_PER_LIST) {
      return {
        values: [],
        issues: [
          `legacy provides must contain at most ${MAX_EXTENSION_CONTRACTS_PER_LIST} entries`,
        ],
      };
    }
    if (
      property.type !== "ObjectProperty" && property.type !== "ObjectMethod"
    ) {
      return {
        values: [],
        issues: ["legacy provides must not contain spreads"],
      };
    }
    const name = staticPropertyName(property);
    if (name === undefined) {
      return {
        values: [],
        issues: ["legacy provides has a dynamic computed property"],
      };
    }
    if (name === "__proto__") {
      return {
        values: [],
        issues: ["legacy provides must not declare __proto__"],
      };
    }
    if (seen.has(name)) {
      return {
        values: [],
        issues: [`legacy provides duplicates property ${name}`],
      };
    }
    if (name.trim().length === 0) {
      return {
        values: [],
        issues: ["legacy provides key must be a non-empty string"],
      };
    }
    if (name.trim() !== name) {
      return {
        values: [],
        issues: ["legacy provides key must not have surrounding whitespace"],
      };
    }
    const validationIssue = validateResolvedContractName(
      name,
      "legacy provides",
      index,
      seen,
    );
    if (validationIssue) {
      return { values: [], issues: [validationIssue] };
    }
    names.push(name);
  }
  return { values: names.sort(compareDeterministically), issues: [] };
}

async function buildMetadata(
  module: StaticModuleBindings,
  resolveIdentifier: (
    name: string,
  ) => StaticResolutionResult<string> | Promise<StaticResolutionResult<string>>,
): Promise<ExtensionSourceMetadata> {
  const references = parseContractReferences(module);
  const capabilities = parseCapabilities(module);
  if (!references) {
    const legacy = parseLegacyProvides(module);
    return {
      contracts: undefined,
      contractResolutionIssues: legacy.issues,
      capabilityResolutionIssues: capabilities.issues,
      legacyProvides: legacy.values,
      capabilities: capabilities.values,
    };
  }
  const provides = await collectResolvedContractReferences(
    references.provides,
    "contracts.provides",
    resolveIdentifier,
  );
  const requires = await collectResolvedContractReferences(
    references.requires,
    "contracts.requires",
    resolveIdentifier,
  );
  return {
    contracts: resolvedContractMetadata(provides.values, requires.values),
    contractResolutionIssues: uniqueSorted([
      ...provides.issues,
      ...requires.issues,
    ]),
    capabilityResolutionIssues: uniqueSorted(capabilities.issues),
    legacyProvides: [],
    capabilities: capabilities.values,
  };
}

export function extractExtensionSourceMetadata(
  source: string,
): ExtensionSourceMetadata {
  if (
    new TextEncoder().encode(source).length >
      MAX_EXTENSION_METADATA_SOURCE_BYTES
  ) {
    const issue =
      `[source-too-large] source exceeds ${MAX_EXTENSION_METADATA_SOURCE_BYTES} bytes`;
    return {
      contracts: {},
      contractResolutionIssues: [issue],
      capabilityResolutionIssues: [issue],
      legacyProvides: [],
      capabilities: [],
    };
  }
  const module = parseModuleBindings(source);
  if (!module.ok) {
    return {
      contracts: {},
      contractResolutionIssues: [formatStaticResolutionFailure(module.failure)],
      capabilityResolutionIssues: [
        formatStaticResolutionFailure(module.failure),
      ],
      legacyProvides: [],
      capabilities: [],
    };
  }
  const references = parseContractReferences(module.value);
  const capabilities = parseCapabilities(module.value);
  if (!references) {
    const legacy = parseLegacyProvides(module.value);
    return {
      contracts: undefined,
      contractResolutionIssues: legacy.issues,
      capabilityResolutionIssues: capabilities.issues,
      legacyProvides: legacy.values,
      capabilities: capabilities.values,
    };
  }
  const resolve = (name: string) =>
    resolveLocalStaticIdentifier(module.value, name);
  const collect = (
    values: readonly StaticStringReference[],
    path: "contracts.provides" | "contracts.requires",
  ): { values: string[]; issues: string[] } => {
    const resolved: string[] = [];
    const issues: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < values.length; index += 1) {
      const reference = values[index]!;
      if (reference.kind === "unsupported") {
        issues.push(
          `${path}[${index}] uses an unsupported expression: ${reference.expression}`,
        );
        continue;
      }
      if (reference.kind === "literal") {
        const validationIssue = validateResolvedContractName(
          reference.value,
          path,
          index,
          seen,
        );
        if (validationIssue) issues.push(validationIssue);
        else resolved.push(reference.value);
        continue;
      }
      const result = resolve(reference.name);
      if (!result.ok) {
        issues.push(
          `${path}[${index}] could not resolve ${reference.name}: ${
            formatStaticResolutionFailure(result.failure)
          }`,
        );
        continue;
      }
      const validationIssue = validateResolvedContractName(
        result.value,
        path,
        index,
        seen,
      );
      if (validationIssue) issues.push(validationIssue);
      else resolved.push(result.value);
    }
    return { values: resolved, issues };
  };
  const provides = collect(references.provides, "contracts.provides");
  const requires = collect(references.requires, "contracts.requires");
  return {
    contracts: resolvedContractMetadata(provides.values, requires.values),
    contractResolutionIssues: uniqueSorted([
      ...provides.issues,
      ...requires.issues,
    ]),
    capabilityResolutionIssues: uniqueSorted(capabilities.issues),
    legacyProvides: [],
    capabilities: capabilities.values,
  };
}

/**
 * Read and statically resolve extension contract metadata without importing or
 * executing extension modules. Babel parses syntax only; every followed module
 * must be a regular, non-symlinked file inside the canonical workspace root.
 */
export async function extractExtensionSourceMetadataFromFile(
  options: ExtensionSourceFileMetadataOptions,
): Promise<ExtensionSourceMetadata> {
  const resolver = await StaticContractResolver.create(options);
  const entry = await resolver.loadEntry();
  if (!entry.ok) {
    throw new TypeError(
      `Could not inspect extension source: ${
        formatStaticResolutionFailure(entry.failure)
      }`,
    );
  }
  return await buildMetadata(
    entry.value,
    (name) => resolver.resolveEntryIdentifier(name),
  );
}
