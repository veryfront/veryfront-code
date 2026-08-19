/**
 * Node-type classification shared by the two reference walkers in
 * `browser-server-exports-strip.ts`.
 *
 * The strip pass has to answer one question about every node it meets: does an
 * identifier in this position keep a binding alive at runtime? Getting it wrong
 * is unsafe in both directions. Counting a fixed name as a read pins a
 * server-only import into the browser artifact, which is the leak the pass
 * exists to close. Missing a real read deletes live code, and the page dies on
 * a ReferenceError.
 *
 * Four review rounds on the strip-before-compile reorder each found the same
 * shape of defect: a node type nobody had classified reached a generic
 * descend-into-everything fallback, and its identifiers were counted as runtime
 * reads. TypeScript got an explicit classification and has been stable since;
 * everything else was ad hoc. This module closes that asymmetry by classifying
 * every node type the pinned `@babel/types` defines, once, for both walkers.
 *
 * Three answers, one per node type:
 *
 * - `read`: the node itself names a binding that is read at runtime.
 * - `erased`: neither the node nor anything under it emits runtime code.
 * - `structural`: neither, but a child can be a read. Descend, subject to
 *   {@link isReferenceChildKey}.
 *
 * Positions, not just node types, decide the answer: `a.hashOf` and
 * `{ hashOf: 1 }` hold the same `Identifier` node in a position that is a fixed
 * name rather than a reference. {@link NON_REFERENCE_KEYS} records those
 * positions per parent type, so both walkers skip the same subtrees.
 *
 * The classification is enforced, not documented: `unclassifiedNodeTypes`
 * backs a guard test that fails when `@babel/types` gains a node type this
 * module does not name. A Babel upgrade must break the build, not leak.
 *
 * @module transforms/pipeline/stages/reference-classification
 */

/** The minimal AST shape both walkers work with. */
export type Node = Record<string, unknown> & { type: string };

export function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

/** How a node type participates in reference counting. */
export type ReferenceClass =
  /** The node itself names a binding that is read at runtime. */
  | "read"
  /** Neither the node nor anything under it emits runtime code. */
  | "erased"
  /** Neither a read nor erased. Descend, subject to `isReferenceChildKey`. */
  | "structural";

/**
 * The class for a node type this module does not name.
 *
 * The two directions are not symmetric. Defaulting to a read over-retains: the
 * pass keeps a binding, so a server-only import can survive into the browser
 * artifact. Defaulting to "not a read" over-deletes: the pass removes a binding
 * live code still uses, and the page fails to load.
 *
 * `structural` is the over-retaining choice and it is the right one here.
 *
 * - A reference walker answering "is this name read?" is only sound when it
 *   over-approximates. Under-approximating reads is the unsound direction for
 *   any liveness analysis, and it is the direction every regression in this
 *   pass has come from.
 * - Over-retention degrades to the behaviour before this pass existed: the
 *   module keeps a binding it may not need. It never emits an artifact that
 *   throws. The compile stage still elides a genuinely unused import under the
 *   `ts` and `tsx` loaders, and the bundler still tree-shakes, so the retained
 *   binding is not necessarily even shipped.
 * - Over-deletion produces a ReferenceError at module evaluation in the
 *   browser, which no later stage can undo.
 * - New ECMAScript syntax is value syntax holding real expressions. Treating an
 *   unrecognised one as erased is nearly always wrong.
 *
 * This is a fallback, not a policy: the guard test makes an unclassified node
 * type a build failure, so in a checked build the default never fires.
 */
export const DEFAULT_REFERENCE_CLASS: ReferenceClass = "structural";

/**
 * The class for an unrecognised `TS`-prefixed node type.
 *
 * The TypeScript grammar inverts the argument above. Almost everything it adds
 * is type syntax that the compiler erases before the module runs, and the
 * handful of value-emitting forms is enumerated in
 * {@link RUNTIME_TS_NODE_TYPES}. Descending into an unrecognised type node
 * would count `p: typeof KEY` as a use of `KEY` and pin the server-only import
 * it came from, which is the leak this pass exists to close.
 *
 * This keeps the choice made when the TypeScript classification was added.
 * Like the default above, the guard test means it never fires in a checked
 * build.
 */
export const DEFAULT_TS_REFERENCE_CLASS: ReferenceClass = "erased";

/**
 * TypeScript nodes that survive type erasure and emit runtime code.
 *
 * The list is closed and enumerable, which is the point: it is a decidable
 * question, unlike proving what a module does to an intrinsic. Any new
 * TypeScript node type that emits runtime code must be added here.
 *
 * The split is invisible while this pass runs after the compile stage, which
 * erases every TypeScript node before the walkers see the module. It exists so
 * the pass stays correct when it runs on authored source.
 */
export const RUNTIME_TS_NODE_TYPES: ReadonlySet<string> = new Set([
  // Value expressions wrapping a value expression plus an erased type operand.
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  // `enum E { A = compute() }` emits an object and evaluates each initialiser.
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  // `namespace N { … }` with a body emits an IIFE over a runtime object.
  "TSModuleDeclaration",
  "TSModuleBlock",
  // `constructor(private dep = fallback())` emits an assignment in the body.
  "TSParameterProperty",
  // `import L = require("./l.ts")` and `import A = N.Sub` both emit a binding.
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSQualifiedName",
  // `export = handler` emits an assignment to the module export.
  "TSExportAssignment",
]);

/**
 * TypeScript nodes the compiler erases whole. An identifier under one of these
 * is a type reference and must not keep a binding alive.
 */
const ERASED_TS_NODE_TYPES: readonly string[] = [
  "TSAnyKeyword",
  "TSArrayType",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSCallSignatureDeclaration",
  "TSConditionalType",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  // An overload signature and an ambient method signature have no body to run.
  "TSDeclareFunction",
  "TSDeclareMethod",
  // `class A extends B implements C`: the heritage clause in a type position.
  "TSExpressionWithTypeArguments",
  "TSFunctionType",
  "TSImportType",
  "TSIndexSignature",
  "TSIndexedAccessType",
  "TSInferType",
  "TSInterfaceBody",
  "TSInterfaceDeclaration",
  "TSIntersectionType",
  "TSIntrinsicKeyword",
  "TSLiteralType",
  "TSMappedType",
  "TSMethodSignature",
  "TSNamedTupleMember",
  // `export as namespace Lib`: a declaration-file-only global alias.
  "TSNamespaceExportDeclaration",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSOptionalType",
  "TSParenthesizedType",
  "TSPropertySignature",
  "TSRestType",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypeParameter",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUndefinedKeyword",
  "TSUnionType",
  "TSUnknownKeyword",
  "TSVoidKeyword",
];

/**
 * Node types that name a binding directly. Every other identifier position in
 * the grammar reaches one of these two through a `structural` parent.
 */
const READ_NODE_TYPES: readonly string[] = [
  "Identifier",
  // A JSX identifier is a read everywhere except an intrinsic element name and
  // the fixed-name positions in `NON_REFERENCE_KEYS`. See
  // `isIntrinsicJsxElementName`.
  "JSXIdentifier",
];

/**
 * Everything else the pinned `@babel/types` defines, minus the Flow nodes and
 * the deprecated aliases the guard test excludes.
 *
 * A `structural` node is neither a read nor erased: the walkers descend into
 * the child keys `isReferenceChildKey` allows. Types listed here that no
 * enabled parser plugin can produce (`BindExpression`, `DoExpression`,
 * `RecordExpression`, the pipeline nodes, `Placeholder`,
 * `V8IntrinsicIdentifier`, …) are classified anyway, so the guard test can
 * demand total coverage of the package rather than of a hand-maintained subset
 * of it.
 */
const STRUCTURAL_NODE_TYPES: readonly string[] = [
  "ArgumentPlaceholder",
  "ArrayExpression",
  "ArrayPattern",
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "AssignmentPattern",
  "AwaitExpression",
  "BigIntLiteral",
  "BinaryExpression",
  "BindExpression",
  "BlockStatement",
  "BooleanLiteral",
  "BreakStatement",
  "CallExpression",
  "CatchClause",
  "ClassAccessorProperty",
  "ClassBody",
  "ClassDeclaration",
  "ClassExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassPrivateProperty",
  "ClassProperty",
  "ConditionalExpression",
  "ContinueStatement",
  "DebuggerStatement",
  "DecimalLiteral",
  "Decorator",
  "Directive",
  "DirectiveLiteral",
  "DoExpression",
  "DoWhileStatement",
  "EmptyStatement",
  "ExportAllDeclaration",
  "ExportDefaultDeclaration",
  "ExportDefaultSpecifier",
  "ExportNamedDeclaration",
  "ExportNamespaceSpecifier",
  "ExportSpecifier",
  "ExpressionStatement",
  "File",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "IfStatement",
  "Import",
  "ImportAttribute",
  "ImportDeclaration",
  "ImportDefaultSpecifier",
  "ImportExpression",
  "ImportNamespaceSpecifier",
  "ImportSpecifier",
  "InterpreterDirective",
  "JSXAttribute",
  "JSXClosingElement",
  "JSXClosingFragment",
  "JSXElement",
  "JSXEmptyExpression",
  "JSXExpressionContainer",
  "JSXFragment",
  "JSXMemberExpression",
  "JSXNamespacedName",
  "JSXOpeningElement",
  "JSXOpeningFragment",
  "JSXSpreadAttribute",
  "JSXSpreadChild",
  "JSXText",
  "LabeledStatement",
  "LogicalExpression",
  "MemberExpression",
  "MetaProperty",
  "ModuleExpression",
  "NewExpression",
  "Noop",
  "NullLiteral",
  "NumericLiteral",
  "ObjectExpression",
  "ObjectMethod",
  "ObjectPattern",
  "ObjectProperty",
  "OptionalCallExpression",
  "OptionalMemberExpression",
  "ParenthesizedExpression",
  "PipelineBareFunction",
  "PipelinePrimaryTopicReference",
  "PipelineTopicExpression",
  "Placeholder",
  "PrivateName",
  "Program",
  "RecordExpression",
  "RegExpLiteral",
  "RestElement",
  "ReturnStatement",
  "SequenceExpression",
  "SpreadElement",
  "StaticBlock",
  "StringLiteral",
  "Super",
  "SwitchCase",
  "SwitchStatement",
  "TaggedTemplateExpression",
  "TemplateElement",
  "TemplateLiteral",
  "ThisExpression",
  "ThrowStatement",
  "TopicReference",
  "TryStatement",
  "TupleExpression",
  "UnaryExpression",
  "UpdateExpression",
  "V8IntrinsicIdentifier",
  "VariableDeclaration",
  "VariableDeclarator",
  "VoidPattern",
  "WhileStatement",
  "WithStatement",
  "YieldExpression",
];

function buildClasses(): Map<string, ReferenceClass> {
  const classes = new Map<string, ReferenceClass>();
  for (const type of READ_NODE_TYPES) classes.set(type, "read");
  for (const type of ERASED_TS_NODE_TYPES) classes.set(type, "erased");
  for (const type of RUNTIME_TS_NODE_TYPES) classes.set(type, "structural");
  for (const type of STRUCTURAL_NODE_TYPES) classes.set(type, "structural");
  return classes;
}

/** Every node type this module classifies, keyed by `node.type`. */
export const NODE_REFERENCE_CLASSES: ReadonlyMap<string, ReferenceClass> = buildClasses();

/** The node types the classification does not cover, in input order. */
export function unclassifiedNodeTypes(types: Iterable<string>): string[] {
  const missing: string[] = [];
  for (const type of types) {
    if (!NODE_REFERENCE_CLASSES.has(type) && !missing.includes(type)) missing.push(type);
  }
  return missing;
}

/**
 * Child keys that hold a fixed name, string-like text or a binding position
 * rather than a runtime reference. Neither walker descends into them.
 *
 * Two positions are deliberately absent. `TSModuleDeclaration.id` and
 * `TSImportEqualsDeclaration.id` are binding positions, and the flat walker
 * counts them on purpose: that is the over-retaining direction for
 * module-declaration liveness, and the scope-aware walker binds them instead of
 * reading them. Moving them here would make the flat walker delete a
 * module-scope declaration that shares the name.
 */
const NON_REFERENCE_KEYS: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  // `break outer`, `continue outer`, `outer:`: a label is its own namespace and
  // never resolves to a binding.
  ["BreakStatement", ["label"]],
  ["ContinueStatement", ["label"]],
  ["LabeledStatement", ["label"]],
  // `import.meta`, `new.target`: both halves are keywords.
  ["MetaProperty", ["meta", "property"]],
  // `#count`: a private name is class-local, never a module binding.
  ["PrivateName", ["id"]],
  ["ClassPrivateProperty", ["key"]],
  ["ClassPrivateMethod", ["key"]],
  // `"use strict"`, `#!/usr/bin/env deno`: string text.
  ["Directive", ["value"]],
  ["DirectiveLiteral", ["value"]],
  ["InterpreterDirective", ["value"]],
  ["V8IntrinsicIdentifier", ["name"]],
  ["Placeholder", ["name"]],
  // `a.hashOf` and `{ hashOf: 1 }` are fixed names; `a[hashOf]` is a read, so
  // these keys come back when `computed` is true. See `COMPUTED_KEY_TYPES`.
  ["MemberExpression", ["property"]],
  ["OptionalMemberExpression", ["property"]],
  ["ObjectProperty", ["key"]],
  ["ObjectMethod", ["key"]],
  ["ClassMethod", ["key"]],
  ["ClassProperty", ["key"]],
  ["ClassAccessorProperty", ["key"]],
  // An import statement declares bindings, it does not read them. Both walkers
  // skip import statements outright as well; this keeps the answer the same for
  // any caller that hands one to `referenceChildren` directly.
  ["ImportDeclaration", ["specifiers", "source", "attributes", "assertions"]],
  ["ImportSpecifier", ["local", "imported"]],
  ["ImportDefaultSpecifier", ["local"]],
  ["ImportNamespaceSpecifier", ["local"]],
  ["ImportAttribute", ["key", "value"]],
  // `export { a as b }`: `a` is a local read, `b` is the name the module
  // publishes under. With a `source` the local half is not local either, which
  // `isReferenceChildKey` handles on the parent.
  ["ExportSpecifier", ["exported"]],
  ["ExportDefaultSpecifier", ["exported"]],
  ["ExportNamespaceSpecifier", ["exported"]],
  // `export * from "./m.js"` and `export * as ns from "./m.js"` name exports of
  // the source module. Nothing here is a local read.
  ["ExportAllDeclaration", ["source", "attributes", "assertions"]],
  ["ExportNamedDeclaration", ["source", "attributes", "assertions"]],
  // `<svg:circle xlink:href="x" />` compiles to `("svg:circle", { "xlink:href":
  // "x" })`: both halves of a namespaced name are string text, whether it names
  // an element or an attribute.
  ["JSXNamespacedName", ["namespace", "name"]],
  // `placeholder=`, `title=`, `href=`: an attribute name is a property key.
  ["JSXAttribute", ["name"]],
  // `<UI.Item />` and `<motion.div />`: the property is a fixed name. The
  // object is always a binding read, whatever its case. See
  // `isIntrinsicJsxElementName`.
  ["JSXMemberExpression", ["property"]],
  // An enum declaration names itself and its members; only the initialisers
  // read anything.
  ["TSEnumDeclaration", ["id"]],
  ["TSEnumMember", ["id"]],
  // `import Alias = NS.Sub`: only `NS` is a read, `Sub` is a fixed name.
  ["TSQualifiedName", ["right"]],
  // A parsed file carries its comments and tokens as siblings of the program.
  ["File", ["comments", "tokens"]],
]);

/** Parents whose fixed-name key becomes a real read when `computed` is true. */
const COMPUTED_KEY_TYPES: ReadonlySet<string> = new Set([
  "MemberExpression",
  "OptionalMemberExpression",
  "ObjectProperty",
  "ObjectMethod",
  "ClassMethod",
  "ClassProperty",
  "ClassAccessorProperty",
]);

/** Keys that never hold AST the walkers should visit. */
const IGNORED_KEYS: ReadonlySet<string> = new Set([
  "loc",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

/**
 * Whether a JSX element name is intrinsic tag text rather than a binding read.
 *
 * `<table>`, `<section>` and `<my-widget>` become string arguments to the JSX
 * factory, so they can never resolve to an import or a module-scope
 * declaration. Every JSX compiler agrees on the rule: a name that starts with a
 * lowercase letter, or that is not spelled like an identifier, is a string.
 * `<Card />` is a real reference and must keep its import alive.
 */
export function isIntrinsicJsxName(name: string | null): boolean {
  if (!name) return false;
  if (/^[a-z]/.test(name)) return true;
  return !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Whether the `name` of a JSX opening or closing element is string text.
 *
 * The rule applies to a bare `JSXIdentifier` that IS the element name, and to
 * nothing else. `<motion.div>`, `<styled.div>`, `<ui.Panel>` and
 * `<dialog.Root>` are `JSXMemberExpression` names, and their object is always a
 * binding read however it is spelled: the lowercase-means-string rule would
 * delete the import the element needs and the page would die on a
 * ReferenceError. A `JSXNamespacedName` is string text on both halves, which
 * `NON_REFERENCE_KEYS` already records, so it needs no answer here.
 */
export function isIntrinsicJsxElementName(name: unknown): boolean {
  if (!isNode(name) || name.type !== "JSXIdentifier") return false;
  const text = name.name;
  return isIntrinsicJsxName(typeof text === "string" ? text : null);
}

/** Whether a node carries decorators, which emit a runtime call even when the
 * declaration they annotate is ambient. */
export function nodeHasDecorators(node: Node): boolean {
  const decorators = node.decorators;
  return Array.isArray(decorators) && decorators.length > 0;
}

/**
 * The class of one node, taking the node's own modifiers into account.
 *
 * Both reference walkers ask this, and they must ask the same question. A
 * walker that counts a type-position read as a runtime reference keeps the
 * server-only import that binding came from; a walker that skips a runtime
 * TypeScript node reports live code as dead.
 */
export function referenceClassOf(node: Node): ReferenceClass {
  // `declare const`, `declare class`, `declare namespace`, `declare enum` and
  // `declare prop: T` are all ambient: they emit nothing.
  //
  // Decorators are the exception. Both tsc and esbuild emit a runtime
  // `__decorate` call for `@audit declare id: string`, so the decorator
  // expression is a real read even though the property it annotates is not.
  // Erasing it here deletes the import the decorator needs and the emitted
  // call then throws a ReferenceError at module evaluation.
  if (node.declare === true && !nodeHasDecorators(node)) return "erased";
  // `import { type Cfg }`, `export { type Cfg }`, `export type { Cfg }`.
  if (node.importKind === "type" || node.exportKind === "type") return "erased";

  const known = NODE_REFERENCE_CLASSES.get(node.type);
  if (known === undefined) {
    return node.type.startsWith("TS") ? DEFAULT_TS_REFERENCE_CLASS : DEFAULT_REFERENCE_CLASS;
  }
  // An ambient `declare module "x";` has no body to run.
  if (node.type === "TSModuleDeclaration" && !isNode(node.body)) return "erased";
  return known;
}

/** Whether the compiler erases `node` and everything under it. */
export function isErasedNode(node: Node): boolean {
  return referenceClassOf(node) === "erased";
}

/**
 * Whether the value under `key` of `parent` can hold a runtime identifier read.
 *
 * `false` means the whole subtree is a fixed name, string-like text or a
 * binding position, and neither walker descends into it.
 */
export function isReferenceChildKey(parent: Node, key: string): boolean {
  if (IGNORED_KEYS.has(key)) return false;

  // `<table>` is string text, `<Card />` and the `motion` of `<motion.div />`
  // are reads. Only the element-name position gets the intrinsic rule.
  if (
    (parent.type === "JSXOpeningElement" || parent.type === "JSXClosingElement") && key === "name"
  ) {
    return !isIntrinsicJsxElementName(parent.name);
  }

  // `export { token as clientToken } from "./client-utils.js"` reads no local
  // binding: `token` names an export of the SOURCE module. Without a source the
  // local half of each specifier is a real read of this module's scope.
  if (parent.type === "ExportNamedDeclaration" && key === "specifiers") {
    return !isNode(parent.source);
  }

  if (
    parent.computed === true && COMPUTED_KEY_TYPES.has(parent.type) &&
    (key === "key" || key === "property")
  ) {
    return true;
  }

  return !NON_REFERENCE_KEYS.get(parent.type)?.includes(key);
}

/**
 * The children of `node` that can hold a runtime identifier read.
 *
 * Both walkers descend through this, so a position classified as a fixed name
 * is skipped identically by each of them.
 */
export function referenceChildren(node: Node): Node[] {
  const found: Node[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (!isReferenceChildKey(node, key)) continue;

    if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) found.push(entry);
      continue;
    }
    if (isNode(value)) found.push(value);
  }

  return found;
}
