import type { ASTNode } from "#veryfront/extensions/parser/index.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";

interface ParentLink {
  parent: ASTNode;
  key: string;
}

interface Binding {
  readonly scope: Scope;
  readonly initializers: ASTNode[];
  readonly workerObjectInitializers: ASTNode[];
  prototypeMutated: boolean;
}

interface Scope {
  readonly parent: Scope | null;
  readonly kind: "program" | "function" | "block" | "catch" | "class";
  readonly bindings: Map<string, Binding>;
}

export type WorkerUrlClassification =
  | { kind: "remote" | "dynamic" }
  | { kind: "file"; specifier: null }
  | { kind: "local"; specifier: string | null };

export interface SourceCapabilityAnalysis {
  readonly hasDynamicCodeGeneration: boolean;
  readonly workers: readonly WorkerUrlClassification[];
  readonly moduleSpecifiers: readonly string[];
  readonly hasUnconstrainedDynamicImport: boolean;
}

const COMMENT_KEYS = new Set([
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);
const METADATA_KEYS = new Set(["loc", "start", "end", "extra", "errors", "tokens"]);
const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "self", "window"]);
const REMOTE_OR_INLINE_URL = /^(?:https?|data|blob):/i;
const FILE_URL = /^file:/i;
const LOCAL_MODULE_SPECIFIER = /^\.\.?\//;
const ALIAS_ASSIGNMENT_OPERATORS = new Set(["=", "&&=", "||=", "??="]);

function isNode(value: unknown): value is ASTNode {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function forEachChild(
  node: ASTNode,
  visit: (child: ASTNode, key: string) => void,
): void {
  for (const [key, value] of Object.entries(node)) {
    if (COMMENT_KEYS.has(key) || METADATA_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item, key);
    } else if (isNode(value)) {
      visit(value, key);
    }
  }
}

export interface ParseOnlyParser {
  parse(options: { code: string; filePath?: string }): Promise<ASTNode>;
}

interface ParseOnlyParserModule {
  BabelParseOnlyParser?: new () => ParseOnlyParser;
}

interface ParserLoadState {
  readonly promise: Promise<ParseOnlyParser>;
}

let parserLoad: ParserLoadState | undefined;
let parserLoader: () => Promise<ParseOnlyParser> = loadParser;

export function __setSourceCapabilityParserLoaderForTests(
  loader: (() => Promise<ParseOnlyParser>) | undefined = undefined,
): void {
  parserLoad = undefined;
  parserLoader = loader ?? loadParser;
}

async function loadParser(): Promise<ParseOnlyParser> {
  const module = await importFirstPartyExtensionModule<ParseOnlyParserModule>(
    "ext-parser-babel",
    "@veryfront/ext-parser-babel",
    { sourceEntry: "parser-only", packageSubpath: "parser-only" },
  );
  if (typeof module.BabelParseOnlyParser !== "function") {
    throw new TypeError("The first-party parser extension has no parse-only constructor");
  }
  const parser = new module.BabelParseOnlyParser();
  if (typeof parser.parse !== "function") {
    throw new TypeError("The first-party parser extension has no parse method");
  }
  return parser;
}

async function getParser(): Promise<ParseOnlyParser> {
  const pending = parserLoad ??= { promise: parserLoader() };
  try {
    return await pending.promise;
  } catch (error) {
    if (parserLoad === pending) parserLoad = undefined;
    throw error;
  }
}

async function parseSource(source: string): Promise<ASTNode | null> {
  let parser: ParseOnlyParser;
  try {
    parser = await getParser();
  } catch {
    return null;
  }

  for (const filePath of ["route.tsx", "route.ts"]) {
    try {
      const ast = await parser.parse({ code: source, filePath });
      const program = isNode(ast.program) ? ast.program : ast;
      return program.type === "Program" ? program : null;
    } catch {
      // Try the other supported TypeScript/JSX reading. The caller retains a
      // conservative textual fallback when neither grammar parses.
    }
  }
  return null;
}

function createScope(parent: Scope | null, kind: Scope["kind"]): Scope {
  return { parent, kind, bindings: new Map() };
}

function ensureBinding(scope: Scope, name: string): Binding {
  const existing = scope.bindings.get(name);
  if (existing) return existing;
  const binding: Binding = {
    scope,
    initializers: [],
    workerObjectInitializers: [],
    prototypeMutated: false,
  };
  scope.bindings.set(name, binding);
  return binding;
}

function registerPattern(scope: Scope, pattern: ASTNode | null | undefined): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier": {
      const name = pattern.name;
      if (typeof name === "string") ensureBinding(scope, name);
      return;
    }
    case "AssignmentPattern":
      registerPattern(scope, isNode(pattern.left) ? pattern.left : undefined);
      return;
    case "RestElement":
      registerPattern(scope, isNode(pattern.argument) ? pattern.argument : undefined);
      return;
    case "ArrayPattern": {
      const elements = pattern.elements;
      if (Array.isArray(elements)) {
        for (const element of elements) {
          registerPattern(scope, isNode(element) ? element : undefined);
        }
      }
      return;
    }
    case "ObjectPattern": {
      const properties = pattern.properties;
      if (Array.isArray(properties)) {
        for (const property of properties) {
          if (!isNode(property)) continue;
          registerPattern(
            scope,
            property.type === "RestElement"
              ? (isNode(property.argument) ? property.argument : undefined)
              : (isNode(property.value) ? property.value : undefined),
          );
        }
      }
      return;
    }
    case "TSParameterProperty":
      registerPattern(scope, isNode(pattern.parameter) ? pattern.parameter : undefined);
  }
}

function registerWorkerDestructuringAliases(
  scope: Scope,
  pattern: ASTNode,
  objectInitializer: ASTNode,
): void {
  if (pattern.type !== "ObjectPattern" || !Array.isArray(pattern.properties)) return;
  for (const property of pattern.properties) {
    if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.key)) continue;
    const key = property.computed === true
      ? staticString(property.key)
      : property.key.type === "Identifier" && typeof property.key.name === "string"
      ? property.key.name
      : staticString(property.key);
    if (key !== "Worker" || !isNode(property.value)) continue;
    let value = property.value;
    if (value.type === "AssignmentPattern" && isNode(value.left)) value = value.left;
    if (value.type !== "Identifier" || typeof value.name !== "string") continue;
    ensureBinding(scope, value.name).workerObjectInitializers.push(objectInitializer);
  }
}

function nearestFunctionScope(scope: Scope): Scope {
  for (let candidate: Scope | null = scope; candidate; candidate = candidate.parent) {
    if (candidate.kind === "function" || candidate.kind === "program") return candidate;
  }
  return scope;
}

function isFunction(node: ASTNode): boolean {
  return [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ObjectMethod",
    "ClassMethod",
    "ClassPrivateMethod",
  ].includes(node.type);
}

function buildScopes(program: ASTNode): {
  root: Scope;
  nodeScopes: WeakMap<ASTNode, Scope>;
  parents: WeakMap<ASTNode, ParentLink>;
} {
  const root = createScope(null, "program");
  const nodeScopes = new WeakMap<ASTNode, Scope>();
  const parents = new WeakMap<ASTNode, ParentLink>();

  const visit = (
    node: ASTNode,
    incomingScope: Scope,
    parent?: ASTNode,
    key?: string,
  ): void => {
    if (parent && key) parents.set(node, { parent, key });

    if (
      (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") &&
      node.declare !== true && isNode(node.id)
    ) {
      registerPattern(incomingScope, node.id);
      // The declaration is the binding's value: computed property reads off it
      // reach Function through `constructor`, so the binding must remember it
      // is callable.
      if (node.id.type === "Identifier" && typeof node.id.name === "string") {
        ensureBinding(incomingScope, node.id.name).initializers.push(node);
      }
    }
    if (node.type === "TSEnumDeclaration" && node.declare !== true && isNode(node.id)) {
      registerPattern(incomingScope, node.id);
    }
    if (node.type === "TSModuleDeclaration" && node.declare !== true && isNode(node.id)) {
      registerPattern(incomingScope, node.id);
    }

    let scope = incomingScope;
    if (node.type === "Program") {
      scope = root;
    } else if (isFunction(node)) {
      scope = createScope(incomingScope, "function");
      if (node.type === "FunctionExpression" && isNode(node.id)) registerPattern(scope, node.id);
      const params = node.params;
      if (Array.isArray(params)) {
        for (const parameter of params) {
          registerPattern(scope, isNode(parameter) ? parameter : undefined);
        }
      }
    } else if (
      node.type === "BlockStatement" || node.type === "SwitchStatement" ||
      node.type === "StaticBlock" || node.type === "ForStatement" ||
      node.type === "ForInStatement" || node.type === "ForOfStatement" ||
      node.type === "TSModuleBlock"
    ) {
      scope = createScope(incomingScope, "block");
    } else if (node.type === "CatchClause") {
      scope = createScope(incomingScope, "catch");
      registerPattern(scope, isNode(node.param) ? node.param : undefined);
    } else if (node.type === "ClassExpression") {
      scope = createScope(incomingScope, "class");
      if (isNode(node.id)) registerPattern(scope, node.id);
    }

    nodeScopes.set(node, scope);

    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      const specifiers = node.specifiers;
      if (Array.isArray(specifiers)) {
        for (const specifier of specifiers) {
          if (
            isNode(specifier) && specifier.importKind !== "type" && isNode(specifier.local)
          ) {
            registerPattern(scope, specifier.local);
          }
        }
      }
    } else if (node.type === "TSImportEqualsDeclaration" && isNode(node.id)) {
      registerPattern(scope, node.id);
    } else if (node.type === "VariableDeclarator") {
      const declaration = parent?.type === "VariableDeclaration" ? parent : undefined;
      if (declaration?.declare === true) {
        forEachChild(node, (child, childKey) => visit(child, scope, node, childKey));
        return;
      }
      const bindingScope = declaration?.kind === "var" ? nearestFunctionScope(scope) : scope;
      const id = isNode(node.id) ? node.id : undefined;
      registerPattern(bindingScope, id);
      if (id?.type === "Identifier" && typeof id.name === "string" && isNode(node.init)) {
        ensureBinding(bindingScope, id.name).initializers.push(node.init);
      } else if (id?.type === "ObjectPattern" && isNode(node.init)) {
        registerWorkerDestructuringAliases(bindingScope, id, node.init);
      }
    }

    forEachChild(node, (child, childKey) => visit(child, scope, node, childKey));
  };

  visit(program, root);
  return { root, nodeScopes, parents };
}

function resolveBinding(scope: Scope, name: string): Binding | null {
  for (let candidate: Scope | null = scope; candidate; candidate = candidate.parent) {
    const binding = candidate.bindings.get(name);
    if (binding) return binding;
  }
  return null;
}

function collectAssignments(program: ASTNode, nodeScopes: WeakMap<ASTNode, Scope>): void {
  // First record every alias assignment as an initializer, so a prototype
  // mutation is resolved through aliases wherever the assignment sits in the
  // source, not only when it happens to precede the mutating call.
  const collectAliasAssignments = (node: ASTNode): void => {
    const scope = nodeScopes.get(node) as Scope;
    if (
      node.type === "AssignmentExpression" &&
      ALIAS_ASSIGNMENT_OPERATORS.has(String(node.operator)) &&
      isNode(node.left) && node.left.type === "Identifier" &&
      typeof node.left.name === "string" && isNode(node.right)
    ) {
      resolveBinding(scope, node.left.name)?.initializers.push(node.right);
    }
    forEachChild(node, collectAliasAssignments);
  };
  collectAliasAssignments(program);

  const markPrototypeMutation = (
    target: ASTNode,
    scope: Scope,
    seen = new Set<Binding>(),
  ): void => {
    const expression = unwrapExpression(target);
    if (expression.type !== "Identifier" || typeof expression.name !== "string") return;
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return;
    seen.add(binding);
    binding.prototypeMutated = true;
    for (const initializer of binding.initializers) {
      markPrototypeMutation(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        seen,
      );
    }
  };

  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node) as Scope;
    if (
      node.type === "AssignmentExpression" && isNode(node.left) &&
      (node.left.type === "MemberExpression" ||
        node.left.type === "OptionalMemberExpression") &&
      memberPropertyName(node.left) === "__proto__" && isNode(node.left.object)
    ) {
      markPrototypeMutation(node.left.object, scope);
    }
    if (node.type === "CallExpression" && isNode(node.callee)) {
      const callee = unwrapExpression(node.callee);
      if (
        (callee.type === "MemberExpression" ||
          callee.type === "OptionalMemberExpression") && isNode(callee.object)
      ) {
        const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
        const property = memberPropertyName(callee);
        // The receiver may name Object or Reflect directly, through a local
        // alias binding, or through a property read off the global object;
        // each reaches the same prototype mutator.
        const resolvesToObject = resolvesToGlobalIntrinsic(
          callee.object,
          "Object",
          scope,
          nodeScopes,
        );
        const mutatesPrototype = property === "setPrototypeOf" &&
            (resolvesToObject ||
              resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes)) ||
          property === "set" &&
            resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes) &&
            // A key this analysis cannot read may spell __proto__.
            (staticString(args[1]) === "__proto__" || staticString(args[1]) === null) ||
          // Object.assign invokes the target's inherited __proto__ setter when
          // a source carries an own enumerable property under that name.
          property === "assign" && resolvesToObject && args.length > 1;
        if (mutatesPrototype && args[0]) markPrototypeMutation(args[0], scope);
      }
    }
    forEachChild(node, visit);
  };
  visit(program);
}

/**
 * Whether this expression resolves to the named unshadowed global intrinsic
 * (such as `Object` or `Reflect`): named directly, reached through a local
 * alias binding, or read as a property off the global object.
 */
function resolvesToGlobalIntrinsic(
  node: ASTNode,
  name: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null) return expression.name === name;
    if (seen.has(binding)) return false;
    seen.add(binding);
    return binding.initializers.some((initializer) =>
      resolvesToGlobalIntrinsic(
        initializer,
        name,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (
    (expression.type === "MemberExpression" || expression.type === "OptionalMemberExpression") &&
    memberPropertyName(expression) === name && isNode(expression.object)
  ) {
    return isGlobalObject(expression.object, scope, nodeScopes);
  }
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return resolvesToGlobalIntrinsic(expression.right, name, scope, nodeScopes, seen);
  }
  if (
    expression.type === "ConditionalExpression" && isNode(expression.consequent) &&
    isNode(expression.alternate)
  ) {
    return resolvesToGlobalIntrinsic(
      expression.consequent,
      name,
      scope,
      nodeScopes,
      new Set(seen),
    ) ||
      resolvesToGlobalIntrinsic(expression.alternate, name, scope, nodeScopes, new Set(seen));
  }
  if (
    expression.type === "LogicalExpression" && isNode(expression.left) && isNode(expression.right)
  ) {
    return resolvesToGlobalIntrinsic(expression.left, name, scope, nodeScopes, new Set(seen)) ||
      resolvesToGlobalIntrinsic(expression.right, name, scope, nodeScopes, new Set(seen));
  }
  return false;
}

function unwrapExpression(node: ASTNode): ASTNode {
  let current = node;
  while (
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TSInstantiationExpression",
    ].includes(current.type) && isNode(current.expression)
  ) {
    current = current.expression;
  }
  return current;
}

function staticString(node: ASTNode | undefined): string | null {
  if (!node) return null;
  const expression = unwrapExpression(node);
  if (expression.type === "StringLiteral" && typeof expression.value === "string") {
    return expression.value;
  }
  if (expression.type === "TemplateLiteral") {
    const expressions = expression.expressions;
    const quasis = expression.quasis;
    if (!Array.isArray(expressions) || expressions.length !== 0 || !Array.isArray(quasis)) {
      return null;
    }
    const first = quasis[0];
    if (!isNode(first) || typeof first.value !== "object" || first.value === null) return null;
    const cooked = (first.value as { cooked?: unknown }).cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  if (
    expression.type === "BinaryExpression" && expression.operator === "+" &&
    isNode(expression.left) && isNode(expression.right)
  ) {
    const left = staticString(expression.left);
    const right = staticString(expression.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function memberPropertyName(node: ASTNode): string | null {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return null;
  const property = isNode(node.property) ? node.property : undefined;
  if (!property) return null;
  if (node.computed === true) return staticString(property);
  return property.type === "Identifier" && typeof property.name === "string" ? property.name : null;
}

function isImportMetaUrl(node: ASTNode | undefined): boolean {
  if (!node) return false;
  const expression = unwrapExpression(node);
  if (
    (expression.type !== "MemberExpression" && expression.type !== "OptionalMemberExpression") ||
    memberPropertyName(expression) !== "url" || !isNode(expression.object)
  ) return false;
  const object = unwrapExpression(expression.object);
  return object.type === "MetaProperty" && isNode(object.meta) && object.meta.name === "import" &&
    isNode(object.property) && object.property.name === "meta";
}

const TS_EXPRESSION_WRAPPER_TYPES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSInstantiationExpression",
]);

/**
 * TypeScript container nodes whose contents compile to executable JavaScript:
 * namespace bodies, enum members, `export =` assignments, and constructor
 * parameter properties all run at module evaluation, so a position inside one
 * is not type-only.
 */
const EXECUTABLE_TS_CONTAINER_TYPES = new Set([
  "TSModuleBlock",
  "TSEnumBody",
  "TSEnumMember",
  "TSExportAssignment",
  "TSParameterProperty",
]);

function isTypeOnlyPosition(node: ASTNode, parents: WeakMap<ASTNode, ParentLink>): boolean {
  let current = node;
  while (true) {
    const link = parents.get(current);
    if (!link) return false;
    const parent = link.parent;
    if (parent.type.startsWith("TS")) {
      if (TS_EXPRESSION_WRAPPER_TYPES.has(parent.type) && link.key === "expression") {
        current = parent;
        continue;
      }
      // A namespace or enum emits runtime code unless it is ambient, so its
      // contents stay subject to capability analysis.
      if (
        EXECUTABLE_TS_CONTAINER_TYPES.has(parent.type) ||
        ((parent.type === "TSModuleDeclaration" || parent.type === "TSEnumDeclaration") &&
          parent.declare !== true)
      ) {
        current = parent;
        continue;
      }
      return true;
    }
    if (
      link.key === "typeAnnotation" || link.key === "returnType" || link.key === "typeParameters"
    ) {
      return true;
    }
    current = parent;
  }
}

function isBindingIdentifier(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  while (true) {
    const link = parents.get(current);
    if (!link) return false;
    const { parent, key } = link;
    if (
      (parent.type === "VariableDeclarator" && key === "id") ||
      (isFunction(parent) && key === "params") ||
      (parent.type === "CatchClause" && key === "param") ||
      (parent.type === "TSParameterProperty" && key === "parameter")
    ) {
      return true;
    }
    if (
      (parent.type === "AssignmentPattern" && key === "left") ||
      (parent.type === "RestElement" && key === "argument") ||
      (parent.type === "ArrayPattern" && key === "elements") ||
      (parent.type === "ObjectPattern" && key === "properties") ||
      (parent.type === "ObjectProperty" && key === "value" &&
        parents.get(parent)?.parent.type === "ObjectPattern")
    ) {
      current = parent;
      continue;
    }
    return false;
  }
}

function isIdentifierReference(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  if (
    node.type !== "Identifier" || isTypeOnlyPosition(node, parents) ||
    isBindingIdentifier(node, parents)
  ) return false;
  const link = parents.get(node);
  if (!link) return true;
  const { parent, key } = link;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    key === "property" && parent.computed !== true
  ) return false;
  if (
    ["ObjectProperty", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(parent.type) &&
    key === "key" && parent.computed !== true
  ) return false;
  if (
    ["LabeledStatement", "BreakStatement", "ContinueStatement", "MetaProperty"].includes(
      parent.type,
    )
  ) {
    return false;
  }
  if (parent.type.startsWith("Import") || key === "id" || key === "params" || key === "param") {
    return false;
  }
  if (parent.type === "ExportSpecifier" && key === "exported") return false;
  return true;
}

function isGlobalObject(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null) return GLOBAL_OBJECT_NAMES.has(expression.name);
    if (seen.has(binding)) return false;
    seen.add(binding);
    return binding.initializers.some((initializer) =>
      isGlobalObject(initializer, nodeScopes.get(initializer) ?? binding.scope, nodeScopes, seen)
    );
  }
  if (
    expression.type === "ConditionalExpression" && isNode(expression.consequent) &&
    isNode(expression.alternate)
  ) {
    return isGlobalObject(expression.consequent, scope, nodeScopes, new Set(seen)) ||
      isGlobalObject(expression.alternate, scope, nodeScopes, new Set(seen));
  }
  if (
    expression.type === "LogicalExpression" && isNode(expression.left) &&
    isNode(expression.right)
  ) {
    return isGlobalObject(expression.left, scope, nodeScopes, new Set(seen)) ||
      isGlobalObject(expression.right, scope, nodeScopes, new Set(seen));
  }
  if (
    (expression.type === "MemberExpression" ||
      expression.type === "OptionalMemberExpression") &&
    isNode(expression.object) && GLOBAL_OBJECT_NAMES.has(memberPropertyName(expression) ?? "")
  ) {
    return isGlobalObject(expression.object, scope, nodeScopes, seen);
  }
  if (
    expression.type === "CallExpression" && isNode(expression.callee) &&
    (expression.callee.type === "MemberExpression" ||
      expression.callee.type === "OptionalMemberExpression") &&
    memberPropertyName(expression.callee) === "valueOf" &&
    isNode(expression.callee.object)
  ) {
    return isGlobalObject(expression.callee.object, scope, nodeScopes, seen);
  }
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return isGlobalObject(expression.right, scope, nodeScopes, seen);
  }
  return false;
}

function isGlobalWorkerConstructor(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null) return expression.name === "Worker";
    if (seen.has(binding)) return false;
    seen.add(binding);
    if (
      binding.workerObjectInitializers.some((initializer) =>
        isGlobalObject(
          initializer,
          nodeScopes.get(initializer) ?? binding.scope,
          nodeScopes,
          new Set(seen),
        )
      )
    ) {
      return true;
    }
    return binding.initializers.some((initializer) =>
      isGlobalWorkerConstructor(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (
    (expression.type === "MemberExpression" || expression.type === "OptionalMemberExpression") &&
    memberPropertyName(expression) === "Worker" && isNode(expression.object)
  ) {
    return isGlobalObject(expression.object, scope, nodeScopes);
  }
  // `new (W = Worker)(...)` constructs whatever the assignment evaluates to,
  // which is its right-hand side.
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return isGlobalWorkerConstructor(expression.right, scope, nodeScopes, seen);
  }
  if (expression.type === "CallExpression" && isNode(expression.callee)) {
    const callee = unwrapExpression(expression.callee);
    if (
      (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
      memberPropertyName(callee) === "get" && isNode(callee.object)
    ) {
      const reflect = unwrapExpression(callee.object);
      const args = Array.isArray(expression.arguments) ? expression.arguments.filter(isNode) : [];
      return reflect.type === "Identifier" && reflect.name === "Reflect" &&
        resolveBinding(scope, "Reflect") === null && args[0] !== undefined &&
        isGlobalObject(args[0], scope, nodeScopes) && staticString(args[1]) === "Worker";
    }
  }
  return false;
}

function isGlobalUrlConstructor(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && expression.name === "URL") {
    return resolveBinding(scope, "URL") === null;
  }
  return (expression.type === "MemberExpression" ||
    expression.type === "OptionalMemberExpression") &&
    memberPropertyName(expression) === "URL" && isNode(expression.object) &&
    isGlobalObject(expression.object, scope, nodeScopes);
}

function isPlainObjectValue(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "ObjectExpression") {
    const properties = Array.isArray(expression.properties) ? expression.properties : [];
    return !properties.some((property) =>
      isNode(property) && property.type === "ObjectProperty" && property.computed !== true &&
      isNode(property.key) &&
      (property.key.type === "Identifier" && property.key.name === "__proto__" ||
        staticString(property.key) === "__proto__")
    );
  }
  if (expression.type !== "Identifier" || typeof expression.name !== "string") return false;
  const binding = resolveBinding(scope, expression.name);
  if (
    binding === null || binding.prototypeMutated || seen.has(binding) ||
    binding.initializers.length === 0
  ) return false;
  seen.add(binding);
  return binding.initializers.every((initializer) =>
    isPlainObjectValue(
      initializer,
      nodeScopes.get(initializer) ?? binding.scope,
      nodeScopes,
      seen,
    )
  );
}

const CALLABLE_EXPRESSION_TYPES = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "ClassExpression",
  "ClassDeclaration",
]);

/**
 * Whether this expression can evaluate to a callable value this analysis can
 * see: a function or class written here, or a binding initialized from one. A
 * callable's `constructor` property is the Function code generator, so a
 * computed property read this analysis cannot resolve must fail closed on such
 * a value.
 */
function isCallableValue(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (CALLABLE_EXPRESSION_TYPES.has(expression.type)) return true;
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.initializers.some((initializer) =>
      isCallableValue(initializer, nodeScopes.get(initializer) ?? binding.scope, nodeScopes, seen)
    );
  }
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return isCallableValue(expression.right, scope, nodeScopes, seen);
  }
  if (
    expression.type === "ConditionalExpression" && isNode(expression.consequent) &&
    isNode(expression.alternate)
  ) {
    return isCallableValue(expression.consequent, scope, nodeScopes, new Set(seen)) ||
      isCallableValue(expression.alternate, scope, nodeScopes, new Set(seen));
  }
  if (
    expression.type === "LogicalExpression" && isNode(expression.left) && isNode(expression.right)
  ) {
    return isCallableValue(expression.left, scope, nodeScopes, new Set(seen)) ||
      isCallableValue(expression.right, scope, nodeScopes, new Set(seen));
  }
  return false;
}

function classifyLiteralWorkerUrl(
  value: string,
  specifier: string | null,
): WorkerUrlClassification {
  if (REMOTE_OR_INLINE_URL.test(value)) return { kind: "remote" };
  if (FILE_URL.test(value)) return { kind: "file", specifier: null };
  if (!LOCAL_MODULE_SPECIFIER.test(value)) return { kind: "dynamic" };
  return { kind: "local", specifier };
}

function classifyWorkerArgument(
  argument: ASTNode | undefined,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): WorkerUrlClassification {
  if (!argument) return { kind: "dynamic" };
  const literal = staticString(argument);
  if (literal !== null) return classifyLiteralWorkerUrl(literal, literal);

  const expression = unwrapExpression(argument);
  if (
    expression.type === "NewExpression" && isNode(expression.callee) &&
    isGlobalUrlConstructor(expression.callee, scope, nodeScopes)
  ) {
    const args = Array.isArray(expression.arguments) ? expression.arguments.filter(isNode) : [];
    const specifier = staticString(args[0]);
    if (specifier === null) return { kind: "dynamic" };
    if (REMOTE_OR_INLINE_URL.test(specifier)) return { kind: "remote" };
    if (FILE_URL.test(specifier)) return { kind: "file", specifier: null };
    if (!LOCAL_MODULE_SPECIFIER.test(specifier)) return { kind: "dynamic" };
    const base = args[1];
    if (isImportMetaUrl(base)) return { kind: "local", specifier };
    const staticBase = staticString(base);
    if (staticBase !== null && REMOTE_OR_INLINE_URL.test(staticBase)) return { kind: "remote" };
    if (staticBase !== null && FILE_URL.test(staticBase)) return { kind: "file", specifier: null };
    return { kind: "dynamic" };
  }

  return { kind: "dynamic" };
}

function isAliasInitializerUse(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  const link = parents.get(node);
  if (!link) return false;
  return (link.parent.type === "VariableDeclarator" && link.key === "init" &&
    isNode(link.parent.id) &&
    (link.parent.id.type === "Identifier" ||
      isSafeGlobalObjectDestructuring(link.parent.id))) ||
    (link.parent.type === "AssignmentExpression" && link.key === "right" &&
      ALIAS_ASSIGNMENT_OPERATORS.has(String(link.parent.operator)) &&
      isNode(link.parent.left) && link.parent.left.type === "Identifier");
}

function isSafeGlobalObjectDestructuring(pattern: ASTNode): boolean {
  if (pattern.type !== "ObjectPattern" || !Array.isArray(pattern.properties)) return false;
  for (const property of pattern.properties) {
    if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.key)) {
      return false;
    }
    const key = property.computed === true
      ? staticString(property.key)
      : property.key.type === "Identifier" && typeof property.key.name === "string"
      ? property.key.name
      : staticString(property.key);
    if (
      key === null || key === "eval" || key === "Function" || key === "constructor" ||
      GLOBAL_OBJECT_NAMES.has(key)
    ) {
      return false;
    }
  }
  return true;
}

function isNewExpressionCallee(node: ASTNode, parents: WeakMap<ASTNode, ParentLink>): boolean {
  const link = parents.get(node);
  return link?.parent.type === "NewExpression" && link.key === "callee";
}

function isMemberObjectUse(node: ASTNode, parents: WeakMap<ASTNode, ParentLink>): boolean {
  const link = parents.get(node);
  return (link?.parent.type === "MemberExpression" ||
    link?.parent.type === "OptionalMemberExpression") &&
    link.key === "object";
}

function isReflectGetGlobalArgument(
  node: ASTNode,
  scope: Scope,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  const link = parents.get(node);
  if (link?.parent.type !== "CallExpression" || link.key !== "arguments") return false;
  const args = link.parent.arguments;
  if (!Array.isArray(args) || args[0] !== node || !isNode(link.parent.callee)) return false;
  const callee = unwrapExpression(link.parent.callee);
  if (
    (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") ||
    memberPropertyName(callee) !== "get" || !isNode(callee.object)
  ) return false;
  const object = unwrapExpression(callee.object);
  return object.type === "Identifier" && object.name === "Reflect" &&
    resolveBinding(scope, "Reflect") === null;
}

/**
 * Parse executable JavaScript/TypeScript and classify capabilities that a raw
 * text scan cannot distinguish from inert strings, comments, types, or local
 * bindings. A null result means the parser could not read the source; callers
 * must retain their conservative fail-closed fallback in that case.
 */
export async function analyzeSourceCapabilities(
  source: string,
): Promise<SourceCapabilityAnalysis | null> {
  const program = await parseSource(source);
  if (program === null) return null;

  const { nodeScopes, parents } = buildScopes(program);
  collectAssignments(program, nodeScopes);

  let hasDynamicCodeGeneration = false;
  const workers: WorkerUrlClassification[] = [];
  const moduleSpecifiers: string[] = [];
  let hasUnconstrainedDynamicImport = false;

  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node);
    if (!scope || isTypeOnlyPosition(node, parents)) return;

    if (
      node.type === "Identifier" && typeof node.name === "string" &&
      isIdentifierReference(node, parents)
    ) {
      if (
        (node.name === "eval" || node.name === "Function") &&
        resolveBinding(scope, node.name) === null
      ) {
        hasDynamicCodeGeneration = true;
      }

      if (isGlobalObject(node, scope, nodeScopes)) {
        if (
          !isMemberObjectUse(node, parents) && !isAliasInitializerUse(node, parents) &&
          !isReflectGetGlobalArgument(node, scope, parents)
        ) {
          // Passing or returning the global object lets another function read
          // a computed generator property beyond this local analysis.
          hasDynamicCodeGeneration = true;
        }
      }

      if (
        isGlobalWorkerConstructor(node, scope, nodeScopes) &&
        !isNewExpressionCallee(node, parents) && !isAliasInitializerUse(node, parents)
      ) {
        workers.push({ kind: "dynamic" });
      }
    }

    if (
      (node.type === "ImportDeclaration" && node.importKind !== "type" ||
        (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
          node.exportKind !== "type") && isNode(node.source)
    ) {
      const specifier = staticString(node.source);
      if (specifier !== null) moduleSpecifiers.push(specifier);
    }

    if (
      node.type === "TSImportEqualsDeclaration" && node.importKind !== "type" &&
      isNode(node.moduleReference) &&
      node.moduleReference.type === "TSExternalModuleReference" &&
      isNode(node.moduleReference.expression)
    ) {
      const specifier = staticString(node.moduleReference.expression);
      if (specifier === null) hasUnconstrainedDynamicImport = true;
      else moduleSpecifiers.push(specifier);
    }

    if (
      node.type === "CallExpression" && isNode(node.callee) && node.callee.type === "Import"
    ) {
      const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
      const specifier = staticString(args[0]);
      if (specifier === null) hasUnconstrainedDynamicImport = true;
      else moduleSpecifiers.push(specifier);
    }

    if (node.type === "ImportExpression" && isNode(node.source)) {
      const specifier = staticString(node.source);
      if (specifier === null) hasUnconstrainedDynamicImport = true;
      else moduleSpecifiers.push(specifier);
    }

    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const property = memberPropertyName(node);
      if (
        property === "constructor" &&
        (!isNode(node.object) || !isPlainObjectValue(node.object, scope, nodeScopes))
      ) {
        hasDynamicCodeGeneration = true;
      }
      // A computed property name this analysis cannot resolve may spell
      // "constructor"; on a callable value that read returns the Function
      // code generator.
      if (
        node.computed === true && property === null && isNode(node.object) &&
        isCallableValue(node.object, scope, nodeScopes)
      ) {
        hasDynamicCodeGeneration = true;
      }
      if (isNode(node.object) && isGlobalObject(node.object, scope, nodeScopes)) {
        if (property === null || property === "eval" || property === "Function") {
          hasDynamicCodeGeneration = true;
        }
        if (
          property === "Worker" && !isNewExpressionCallee(node, parents) &&
          !isAliasInitializerUse(node, parents)
        ) {
          workers.push({ kind: "dynamic" });
        }
      }
    }

    if (node.type === "CallExpression" && isNode(node.callee)) {
      const callee = unwrapExpression(node.callee);
      if (
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
        isNode(callee.object)
      ) {
        const calleeProperty = memberPropertyName(callee);
        const object = unwrapExpression(callee.object);
        const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
        if (
          calleeProperty === "get" &&
          object.type === "Identifier" && object.name === "Reflect" &&
          resolveBinding(scope, "Reflect") === null
        ) {
          const property = staticString(args[1]);
          if (property === null) hasDynamicCodeGeneration = true;
          if (property === "constructor") hasDynamicCodeGeneration = true;
          if (args[0] && isGlobalObject(args[0], scope, nodeScopes)) {
            if (property === null || property === "eval" || property === "Function") {
              hasDynamicCodeGeneration = true;
            }
          }
        }
        if (
          calleeProperty === "getOwnPropertyDescriptor" &&
          (resolvesToGlobalIntrinsic(callee.object, "Object", scope, nodeScopes) ||
            resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes))
        ) {
          const descriptorKey = staticString(args[1]);
          if (descriptorKey === null || descriptorKey === "constructor") {
            hasDynamicCodeGeneration = true;
          }
        }
      }
    }

    if (node.type === "ObjectProperty" && parents.get(node)?.parent.type === "ObjectPattern") {
      const key = isNode(node.key) ? node.key : undefined;
      const property = node.computed === true
        ? staticString(key)
        : key?.type === "Identifier" && typeof key.name === "string"
        ? key.name
        : staticString(key);
      if (property === "constructor") hasDynamicCodeGeneration = true;
    }

    if (
      node.type === "NewExpression" && isNode(node.callee) &&
      isGlobalWorkerConstructor(node.callee, scope, nodeScopes)
    ) {
      const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
      workers.push(classifyWorkerArgument(args[0], scope, nodeScopes));
    }

    forEachChild(node, visit);
  };

  visit(program);
  return {
    hasDynamicCodeGeneration,
    workers,
    moduleSpecifiers,
    hasUnconstrainedDynamicImport,
  };
}
