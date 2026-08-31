import type { ASTNode } from "#veryfront/extensions/parser/index.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import * as pathHelper from "#veryfront/compat/path";

const IntrinsicJSON = JSON;
const IntrinsicSet = Set;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePush = Array.prototype.push;
const JSONStringify = JSON.stringify;
const ReflectApply = Reflect.apply;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const COMMONJS_EXPORT_PATTERN = /\b(?:module\s*\.\s*exports|exports\s*\.)/;

interface ParentLink {
  parent: ASTNode;
  key: string;
}

interface Binding {
  readonly scope: Scope;
  readonly initializers: ASTNode[];
  readonly propertySources: ASTNode[];
  readonly propertyInitializers: Array<{
    readonly propertyName: string | null;
    readonly value: ASTNode;
    readonly executionScope: Scope;
    readonly definitelyAssigned: boolean;
    readonly position: number | null;
  }>;
  readonly memberInitializers: Array<{
    readonly objectInitializer: ASTNode;
    readonly propertyName: string | null;
  }>;
  readonly workerObjectInitializers: ASTNode[];
  hasAliasAssignment: boolean;
  prototypeMutated: boolean;
  enumerableProtoPropertyDefined: boolean;
  processModuleObjectImport: boolean;
  processExecveImport: boolean;
}

interface PropertyInitializerContext {
  readonly propertyName: string | null;
  readonly value: ASTNode;
  readonly nodeScopes: WeakMap<ASTNode, Scope>;
  readonly definitelyAssigned: boolean;
  readonly position: number | null;
  readonly executionScope: Scope;
}

interface Scope {
  readonly parent: Scope | null;
  readonly kind: "program" | "function" | "block" | "catch" | "class";
  readonly bindings: Map<string, Binding>;
}

interface LocalClassObject {
  readonly classValue: ASTNode;
  readonly access: "static" | "instance";
}

export type WorkerUrlClassification =
  | { kind: "remote" | "dynamic" }
  | { kind: "file"; specifier: null }
  | {
    kind: "local";
    specifier: string | null;
    requiresUnqualifiedWorkerShim: boolean;
    resolutionBase: "module" | "route";
  };

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
const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "self", "window", "global"]);
const PROCESS_MODULE_SPECIFIERS = new Set(["node:process", "process"]);
const WELL_KNOWN_SYMBOL_NAMES = new Set([
  "asyncDispose",
  "asyncIterator",
  "dispose",
  "hasInstance",
  "isConcatSpreadable",
  "iterator",
  "match",
  "matchAll",
  "replace",
  "search",
  "species",
  "split",
  "toPrimitive",
  "toStringTag",
  "unscopables",
]);
const REMOTE_OR_INLINE_URL = /^(?:https?|data|blob):/i;
const FILE_URL = /^file:/i;
const LOCAL_MODULE_SPECIFIER = /^\.\.?\//;
const ALIAS_ASSIGNMENT_OPERATORS = new Set(["=", "&&=", "||=", "??="]);
const IMPORT_KEYWORD = "import";
const META_KEYWORD = "meta";

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

export type ImportMetaSpecifierResolver = (
  specifier: string,
  moduleUrl: string,
) => string | null | Promise<string | null>;

export type ImportMetaResolveCallRewriter = (
  specifier: string,
  moduleUrl: string,
) => string | Promise<string>;

export type ImportMetaResolveArgumentRewriter = (
  argumentSource: string,
  moduleUrl: string,
) => string | Promise<string>;

export type ImportMetaResolveReferenceRewriter = (
  moduleUrl: string,
) => string | Promise<string>;

/** Identify a real unbound CommonJS `module` reference without matching inert text. */
export async function usesUnboundCommonJsModule(source: string): Promise<boolean | null> {
  if (!(ReflectApply(StringPrototypeIncludes, source, ["module"]) as boolean)) return false;
  const program = await parseSource(source);
  if (program === null) return null;

  const { nodeScopes, parents } = buildScopes(program);
  let found = false;
  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node);
    if (
      scope && node.type === "Identifier" && node.name === "module" &&
      resolveBinding(scope, "module") === null && isIdentifierReference(node, parents)
    ) {
      found = true;
      return;
    }
    forEachChild(node, visit);
  };
  visit(program);
  return found;
}

/**
 * Rebind CommonJS require value references to a caller-provided module-local
 * require. Static direct calls remain intact so the bundler can still
 * traverse them.
 */
export async function rewriteUnboundCommonJsDynamicRequire(
  source: string,
  replacementIdentifier: string,
  staticRequireRecorderIdentifier?: string,
): Promise<string | null> {
  if (!(ReflectApply(StringPrototypeIncludes, source, ["require"]) as boolean)) return source;
  if (!/^[A-Za-z_$][A-Za-z\d_$]*$/.test(replacementIdentifier)) {
    throw new TypeError("The CommonJS require replacement must be an identifier");
  }
  if (
    staticRequireRecorderIdentifier !== undefined &&
    !/^[A-Za-z_$][A-Za-z\d_$]*$/.test(staticRequireRecorderIdentifier)
  ) {
    throw new TypeError("The CommonJS require recorder must be an identifier");
  }
  const program = await parseSource(source);
  if (program === null) return null;

  const { nodeScopes, parents } = buildScopes(program);
  collectAssignments(program, nodeScopes, parents);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const staticCalls: Array<{
    specifier: string;
    replacement: { start: number; end: number; value: string };
  }> = [];
  let hasDynamicRequireReplacement = false;
  const recordStaticCall = (
    call: ASTNode & { start: number; end: number },
    specifier: string,
    expression: string,
  ): void => {
    const replacement = { start: call.start, end: call.end, value: expression };
    staticCalls.push({ specifier, replacement });
    replacements.push(replacement);
  };
  const replaceDynamicCallee = (callee: ASTNode & { start: number; end: number }): void => {
    hasDynamicRequireReplacement = true;
    replacements.push({
      start: callee.start,
      end: callee.end,
      value: replacementIdentifier,
    });
  };
  const staticRequireExpression = (specifier: string): string =>
    `require(${safeStringLiteral(specifier)})`;
  const staticModuleRequireExpression = (specifier: string): string =>
    staticRequireExpression(specifier);
  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node);
    if (
      scope && node.type === "Identifier" && node.name === "require" &&
      resolveBinding(scope, "require") === null &&
      isIdentifierReference(node, parents) && hasSourceRange(node, source.length)
    ) {
      let directCall: ASTNode = node;
      let link = parents.get(directCall);
      while (
        link && TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) &&
        link.key === "expression"
      ) {
        directCall = link.parent;
        link = parents.get(directCall);
      }
      const call = link && isCallExpression(link.parent) && link.key === "callee"
        ? link.parent
        : undefined;
      const args = call === undefined ? [] : callArguments(call);
      let preserveRequire = args.length === 1 && staticString(args[0]) !== null;
      const directSpecifier = args.length === 1 ? staticString(args[0]) : null;
      if (call !== undefined && directSpecifier !== null && hasSourceRange(call, source.length)) {
        recordStaticCall(call, directSpecifier, staticRequireExpression(directSpecifier));
      } else if (
        !preserveRequire && args.length === 1 && hasSourceRange(args[0]!, source.length)
      ) {
        const boundSpecifier = staticStringFromImmutableBinding(
          args[0]!,
          scope,
          nodeScopes,
          parents,
        );
        if (boundSpecifier !== null) {
          if (call !== undefined && hasSourceRange(call, source.length)) {
            recordStaticCall(call, boundSpecifier, staticRequireExpression(boundSpecifier));
          } else {
            replacements.push({
              start: args[0]!.start,
              end: args[0]!.end,
              value: safeStringLiteral(boundSpecifier),
            });
          }
          preserveRequire = true;
        }
      }
      if (!preserveRequire) {
        const parent = parents.get(node);
        const shorthand = parent?.parent.type === "ObjectProperty" &&
          parent.key === "value" && parent.parent.shorthand === true;
        hasDynamicRequireReplacement = true;
        replacements.push({
          start: node.start,
          end: node.end,
          value: shorthand ? `require: ${replacementIdentifier}` : replacementIdentifier,
        });
      }
    }
    if (
      scope && (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
      memberPropertyName(node) === "require" && isNode(node.object) &&
      node.object.type === "Identifier" && node.object.name === "module" &&
      resolveBinding(scope, "module") === null && hasSourceRange(node, source.length)
    ) {
      let callee: ASTNode = node;
      let link = parents.get(callee);
      while (
        link && TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) &&
        link.key === "expression"
      ) {
        callee = link.parent;
        link = parents.get(callee);
      }
      const call = link && isCallExpression(link.parent) && link.key === "callee"
        ? link.parent
        : undefined;
      const args = call === undefined ? [] : callArguments(call);
      const directSpecifier = args.length === 1 ? staticString(args[0]) : null;
      if (call !== undefined && directSpecifier !== null && hasSourceRange(call, source.length)) {
        recordStaticCall(call, directSpecifier, staticModuleRequireExpression(directSpecifier));
      } else if (call !== undefined && args.length === 1 && hasSourceRange(call, source.length)) {
        const boundSpecifier = staticStringFromImmutableBinding(
          args[0]!,
          scope,
          nodeScopes,
          parents,
        );
        if (boundSpecifier !== null) {
          recordStaticCall(call, boundSpecifier, staticModuleRequireExpression(boundSpecifier));
        } else {
          replaceDynamicCallee(node);
        }
      } else {
        hasDynamicRequireReplacement = true;
        replacements.push({
          start: node.start,
          end: node.end,
          value: replacementIdentifier,
        });
      }
    }
    forEachChild(node, visit);
  };
  visit(program);

  if (hasDynamicRequireReplacement && staticRequireRecorderIdentifier !== undefined) {
    for (const call of staticCalls) {
      call.replacement.value = `${replacementIdentifier}(${safeStringLiteral(call.specifier)})`;
    }
  }
  replacements.sort((left, right) => right.start - left.start);
  const rewritten = replacements.reduce(
    (rewritten, replacement) =>
      rewritten.slice(0, replacement.start) + replacement.value +
      rewritten.slice(replacement.end),
    source,
  );
  if (
    !hasDynamicRequireReplacement || staticRequireRecorderIdentifier === undefined ||
    staticCalls.length === 0
  ) {
    return rewritten;
  }
  const registered = new IntrinsicSet<string>();
  const registrations: string[] = [];
  for (const call of staticCalls) {
    if (ReflectApply(SetPrototypeHas, registered, [call.specifier]) as boolean) continue;
    ReflectApply(SetPrototypeAdd, registered, [call.specifier]);
    ReflectApply(ArrayPrototypePush, registrations, [
      `${staticRequireRecorderIdentifier}(${safeStringLiteral(call.specifier)}, () => ${
        staticRequireExpression(call.specifier)
      });`,
    ]);
  }
  const prefix = `${ReflectApply(ArrayPrototypeJoin, registrations, ["\n"]) as string}\n`;
  if (!(ReflectApply(StringPrototypeStartsWith, rewritten, ["#!"]) as boolean)) {
    return prefix + rewritten;
  }
  const lineEnd = ReflectApply(StringPrototypeIndexOf, rewritten, ["\n"]) as number;
  return lineEnd < 0
    ? `${rewritten}\n${prefix}`
    : `${ReflectApply(StringPrototypeSlice, rewritten, [
      0,
      lineEnd + 1,
    ]) as string}${prefix}${ReflectApply(StringPrototypeSlice, rewritten, [
      lineEnd + 1,
    ]) as string}`;
}

function safeStringLiteral(value: string): string {
  const literal = ReflectApply(JSONStringify, IntrinsicJSON, [value]);
  if (typeof literal !== "string") {
    throw new TypeError("String literal serialization failed");
  }
  return literal;
}

/**
 * Bind location-sensitive import metadata to its declaring module before
 * bundling, without touching inert source text.
 */
export async function rewriteImportMetaLocations(
  source: string,
  moduleUrl: string,
  resolveSpecifier?: ImportMetaSpecifierResolver,
  rewriteResolveCall?: ImportMetaResolveCallRewriter,
  rewriteResolveArgument?: ImportMetaResolveArgumentRewriter,
  rewriteResolveReference?: ImportMetaResolveReferenceRewriter,
): Promise<string | null> {
  if (!(ReflectApply(StringPrototypeIncludes, source, [IMPORT_KEYWORD]) as boolean)) return source;
  const importIndex = ReflectApply(StringPrototypeIndexOf, source, [IMPORT_KEYWORD]) as number;
  if (
    !(ReflectApply(StringPrototypeIncludes, source, [
      META_KEYWORD,
      importIndex + IMPORT_KEYWORD.length,
    ]) as boolean)
  ) return source;
  const program = await parseSource(source);
  if (program === null) return null;

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const pendingResolutions: Array<{
    start: number;
    end: number;
    specifier: string;
  }> = [];
  const pendingResolveCallRewrites: Array<{
    start: number;
    end: number;
    replacement: string | null | Promise<string | null>;
  }> = [];
  let unsupportedResolve = false;
  const visit = (node: ASTNode): void => {
    if (
      isCallExpression(node) && isNode(node.callee) &&
      isImportMetaResolve(node.callee)
    ) {
      const args = callArguments(node);
      const argument = args.length === 1 ? args[0] : undefined;
      const specifier = argument === undefined ? null : staticString(argument);
      if (!hasSourceRange(node, source.length)) {
        unsupportedResolve = true;
      } else if (argument === undefined && rewriteResolveCall) {
        pendingResolveCallRewrites.push({
          start: node.start,
          end: node.end,
          replacement: rewriteResolveCall("undefined", moduleUrl),
        });
      } else if (argument === undefined && rewriteResolveArgument) {
        pendingResolveCallRewrites.push({
          start: node.start,
          end: node.end,
          replacement: rewriteResolveArgument("undefined", moduleUrl),
        });
      } else if (argument === undefined) {
        unsupportedResolve = true;
      } else if (
        specifier === null && rewriteResolveArgument && hasSourceRange(argument, source.length)
      ) {
        const argumentSource = source.slice(argument.start, argument.end);
        pendingResolveCallRewrites.push({
          start: node.start,
          end: node.end,
          replacement: (async () => {
            const rewrittenArgument = await rewriteImportMetaLocations(
              argumentSource,
              moduleUrl,
              resolveSpecifier,
              rewriteResolveCall,
              rewriteResolveArgument,
              rewriteResolveReference,
            );
            if (rewrittenArgument === null) return null;
            return await rewriteResolveArgument(rewrittenArgument, moduleUrl);
          })(),
        });
      } else if (specifier === null) {
        unsupportedResolve = true;
      } else if (rewriteResolveCall) {
        pendingResolveCallRewrites.push({
          start: node.start,
          end: node.end,
          replacement: rewriteResolveCall(specifier, moduleUrl),
        });
      } else if (resolveSpecifier) {
        pendingResolutions.push({
          start: node.start,
          end: node.end,
          specifier,
        });
      } else {
        const resolved = resolveImportMetaUrlSpecifier(specifier, moduleUrl);
        if (resolved === null) {
          unsupportedResolve = true;
        } else {
          replacements.push({
            start: node.start,
            end: node.end,
            value: safeStringLiteral(resolved),
          });
        }
      }
      return;
    }
    if (isImportMetaResolve(node)) {
      if (rewriteResolveReference && hasSourceRange(node, source.length)) {
        pendingResolveCallRewrites.push({
          start: node.start,
          end: node.end,
          replacement: rewriteResolveReference(moduleUrl),
        });
      } else {
        unsupportedResolve = true;
      }
      return;
    }
    if (isImportMetaUrl(node) && hasSourceRange(node, source.length)) {
      replacements.push({
        start: node.start,
        end: node.end,
        value: safeStringLiteral(moduleUrl),
      });
      return;
    }
    const importMetaPath = importMetaPathProperty(node);
    if (importMetaPath !== null && hasSourceRange(node, source.length)) {
      replacements.push({
        start: node.start,
        end: node.end,
        value: importMetaPathValue(moduleUrl, importMetaPath),
      });
      return;
    }
    if (isImportMeta(node) && hasSourceRange(node, source.length)) {
      if (!rewriteResolveReference) {
        unsupportedResolve = true;
        return;
      }
      pendingResolveCallRewrites.push({
        start: node.start,
        end: node.end,
        replacement: (async () => {
          const resolve = await rewriteResolveReference(moduleUrl);
          return `({ __proto__: null, url: ${safeStringLiteral(moduleUrl)}, dirname: ${
            importMetaPathValue(moduleUrl, "dirname")
          }, filename: ${importMetaPathValue(moduleUrl, "filename")}, resolve: ${resolve} })`;
        })(),
      });
      return;
    }
    forEachChild(node, visit);
  };
  visit(program);
  if (unsupportedResolve) return null;

  if (rewriteResolveCall || rewriteResolveArgument || rewriteResolveReference) {
    const rewrittenCalls = await Promise.all(
      pendingResolveCallRewrites.map(({ replacement }) => replacement),
    );
    for (let index = 0; index < pendingResolveCallRewrites.length; index++) {
      const request = pendingResolveCallRewrites[index];
      const replacement = rewrittenCalls[index];
      if (request === undefined || replacement === undefined || replacement === null) return null;
      replacements.push({
        start: request.start,
        end: request.end,
        value: replacement,
      });
    }
  }

  if (resolveSpecifier) {
    const resolvedSpecifiers = await Promise.all(
      pendingResolutions.map(({ specifier }) => resolveSpecifier(specifier, moduleUrl)),
    );
    for (let index = 0; index < pendingResolutions.length; index++) {
      const resolved = resolvedSpecifiers[index];
      const request = pendingResolutions[index];
      if (resolved === null || resolved === undefined || request === undefined) return null;
      replacements.push({
        start: request.start,
        end: request.end,
        value: safeStringLiteral(resolved),
      });
    }
  }

  replacements.sort((left, right) => right.start - left.start);
  return replacements.reduce(
    (rewritten, replacement) =>
      rewritten.slice(0, replacement.start) + replacement.value +
      rewritten.slice(replacement.end),
    source,
  );
}

function importMetaPathValue(moduleUrl: string, property: "dirname" | "filename"): string {
  try {
    const url = new URL(moduleUrl);
    if (url.protocol !== "file:") return "undefined";
    const filename = pathHelper.fromFileUrl(url);
    return safeStringLiteral(property === "dirname" ? pathHelper.dirname(filename) : filename);
  } catch {
    return "undefined";
  }
}

function resolveImportMetaUrlSpecifier(specifier: string, moduleUrl: string): string | null {
  if (
    !LOCAL_MODULE_SPECIFIER.test(specifier) && !specifier.startsWith("/") &&
    !/^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier)
  ) return null;
  try {
    return new URL(specifier, moduleUrl).href;
  } catch {
    return null;
  }
}

function hasSourceRange(
  node: ASTNode,
  sourceLength: number,
): node is ASTNode & { start: number; end: number } {
  return Number.isSafeInteger(node.start) && Number.isSafeInteger(node.end) &&
    (node.start as number) >= 0 && (node.end as number) >= (node.start as number) &&
    (node.end as number) <= sourceLength;
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
    propertySources: [],
    propertyInitializers: [],
    memberInitializers: [],
    workerObjectInitializers: [],
    hasAliasAssignment: false,
    prototypeMutated: false,
    enumerableProtoPropertyDefined: false,
    processModuleObjectImport: false,
    processExecveImport: false,
  };
  scope.bindings.set(name, binding);
  return binding;
}

function patternChild(node: unknown): ASTNode | undefined {
  return isNode(node) ? node : undefined;
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
      registerPattern(scope, patternChild(pattern.left));
      return;
    case "RestElement":
      registerPattern(scope, patternChild(pattern.argument));
      return;
    case "ArrayPattern": {
      registerArrayPattern(scope, pattern);
      return;
    }
    case "ObjectPattern": {
      registerObjectPattern(scope, pattern);
      return;
    }
    case "TSParameterProperty":
      registerPattern(scope, patternChild(pattern.parameter));
  }
}

function registerArrayPattern(scope: Scope, pattern: ASTNode): void {
  const elements = pattern.elements;
  if (!Array.isArray(elements)) return;
  for (const element of elements) {
    registerPattern(scope, patternChild(element));
  }
}

function registerObjectPattern(scope: Scope, pattern: ASTNode): void {
  const properties = pattern.properties;
  if (!Array.isArray(properties)) return;
  for (const property of properties) {
    if (!isNode(property)) continue;
    registerPattern(scope, bindingNodeForObjectPatternProperty(property));
  }
}

function bindingNodeForObjectPatternProperty(property: ASTNode): ASTNode | undefined {
  if (property.type === "RestElement") return patternChild(property.argument);
  return patternChild(property.value);
}

function staticPropertyKey(property: ASTNode): string | null {
  if (!isNode(property.key)) return null;
  if (property.computed === true) return staticString(property.key);
  if (property.key.type === "Identifier" && typeof property.key.name === "string") {
    return property.key.name;
  }
  return staticString(property.key);
}

function expressionBranches(expression: ASTNode): readonly [ASTNode, ASTNode] | null {
  if (
    expression.type === "ConditionalExpression" && isNode(expression.consequent) &&
    isNode(expression.alternate)
  ) {
    return [expression.consequent, expression.alternate];
  }
  if (
    expression.type === "LogicalExpression" && isNode(expression.left) && isNode(expression.right)
  ) {
    return [expression.left, expression.right];
  }
  return null;
}

function registerDestructuringAliases(
  scope: Scope,
  pattern: ASTNode,
  objectInitializer: ASTNode,
): void {
  if (pattern.type !== "ObjectPattern" || !Array.isArray(pattern.properties)) return;
  for (const property of pattern.properties) {
    if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.key)) continue;
    const propertyName = staticPropertyKey(property);
    if (!isNode(property.value)) continue;
    let value = property.value;
    if (value.type === "AssignmentPattern" && isNode(value.left)) value = value.left;
    if (value.type !== "Identifier" || typeof value.name !== "string") continue;
    const binding = ensureBinding(scope, value.name);
    binding.memberInitializers.push({ objectInitializer, propertyName });
    if (propertyName === "Worker") binding.workerObjectInitializers.push(objectInitializer);
  }
}

function collectDestructuringAliasAssignments(
  scope: Scope,
  pattern: ASTNode,
  objectInitializer: ASTNode,
): void {
  if (pattern.type !== "ObjectPattern" || !Array.isArray(pattern.properties)) return;
  for (const property of pattern.properties) {
    if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.value)) {
      continue;
    }
    let value = property.value;
    if (value.type === "AssignmentPattern" && isNode(value.left)) value = value.left;
    if (value.type !== "Identifier" || typeof value.name !== "string") continue;
    const binding = resolveBinding(scope, value.name);
    if (binding === null) continue;
    binding.hasAliasAssignment = true;
    const propertyName = staticPropertyKey(property);
    binding.memberInitializers.push({ objectInitializer, propertyName });
    if (propertyName === "Worker") binding.workerObjectInitializers.push(objectInitializer);
  }
}

function arrayDestructuringInitializer(
  arrayInitializer: ASTNode,
  index: number | null,
): ASTNode {
  return {
    type: "MemberExpression",
    object: arrayInitializer,
    property: index === null
      ? { type: "Identifier", name: "__veryfront_unknown_array_index" }
      : { type: "StringLiteral", value: String(index) },
    computed: true,
  };
}

function recordPatternInitializer(
  scope: Scope,
  pattern: ASTNode,
  initializer: ASTNode,
  assignment: boolean,
): void {
  if (pattern.type === "Identifier" && typeof pattern.name === "string") {
    const binding = assignment
      ? resolveBinding(scope, pattern.name)
      : ensureBinding(scope, pattern.name);
    if (binding === null) return;
    binding.hasAliasAssignment ||= assignment;
    binding.initializers.push(initializer);
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    recordPatternInitializer(scope, pattern.left, initializer, assignment);
    if (isNode(pattern.right)) {
      recordPatternInitializer(scope, pattern.left, pattern.right, assignment);
    }
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    recordPatternInitializer(scope, pattern.argument, initializer, assignment);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    if (assignment) collectDestructuringAliasAssignments(scope, pattern, initializer);
    else registerDestructuringAliases(scope, pattern, initializer);
    return;
  }
  if (pattern.type !== "ArrayPattern" || !Array.isArray(pattern.elements)) return;
  pattern.elements.forEach((element, index) => {
    if (!isNode(element)) return;
    const elementInitializer = arrayDestructuringInitializer(
      initializer,
      element.type === "RestElement" ? null : index,
    );
    recordPatternInitializer(scope, element, elementInitializer, assignment);
  });
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

function registerRuntimeDeclaration(scope: Scope, node: ASTNode): void {
  if (
    (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") &&
    node.declare !== true && isNode(node.id)
  ) {
    registerPattern(scope, node.id);
    // The declaration is the binding's value: computed property reads off it
    // reach Function through `constructor`, so the binding must remember it
    // is callable.
    if (node.id.type === "Identifier" && typeof node.id.name === "string") {
      ensureBinding(scope, node.id.name).initializers.push(node);
    }
    return;
  }
  if (
    (node.type === "TSEnumDeclaration" || node.type === "TSModuleDeclaration") &&
    node.declare !== true && isNode(node.id)
  ) {
    registerPattern(scope, node.id);
  }
}

function blockCreatesScope(node: ASTNode): boolean {
  return node.type === "BlockStatement" || node.type === "SwitchStatement" ||
    node.type === "StaticBlock" || node.type === "ForStatement" ||
    node.type === "ForInStatement" || node.type === "ForOfStatement" ||
    node.type === "TSModuleBlock";
}

function createNodeScope(node: ASTNode, incomingScope: Scope, root: Scope): Scope {
  if (node.type === "Program") return root;
  if (isFunction(node)) return createScope(incomingScope, "function");
  if (blockCreatesScope(node)) return createScope(incomingScope, "block");
  if (node.type === "CatchClause") return createScope(incomingScope, "catch");
  if (node.type === "ClassExpression") return createScope(incomingScope, "class");
  return incomingScope;
}

function registerScopeLocalBindings(scope: Scope, node: ASTNode): void {
  if (isFunction(node)) {
    if (node.type === "FunctionExpression" && isNode(node.id)) registerPattern(scope, node.id);
    const params = node.params;
    if (Array.isArray(params)) {
      for (const parameter of params) registerPattern(scope, patternChild(parameter));
    }
    return;
  }
  if (node.type === "CatchClause") {
    registerPattern(scope, patternChild(node.param));
    return;
  }
  if (node.type === "ClassExpression") registerPattern(scope, patternChild(node.id));
}

function registerImportBindings(scope: Scope, node: ASTNode): void {
  if (node.type !== "ImportDeclaration" || node.importKind === "type") return;
  const specifiers = node.specifiers;
  if (!Array.isArray(specifiers)) return;
  const moduleSpecifier = isNode(node.source)
    ? staticString(node.source)?.toLowerCase()
    : undefined;
  for (const specifier of specifiers) {
    if (isNode(specifier) && specifier.importKind !== "type" && isNode(specifier.local)) {
      registerPattern(scope, specifier.local);
      if (
        moduleSpecifier !== undefined && PROCESS_MODULE_SPECIFIERS.has(moduleSpecifier) &&
        specifier.local.type === "Identifier" && typeof specifier.local.name === "string"
      ) {
        const binding = ensureBinding(scope, specifier.local.name);
        const importedName = importedBindingName(specifier);
        binding.processModuleObjectImport ||= importedName === null || importedName === "default" ||
          importedName === "process";
        binding.processExecveImport ||= importedName === "execve";
      }
    }
  }
}

function importedBindingName(specifier: ASTNode): string | null {
  if (
    specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportNamespaceSpecifier"
  ) {
    return null;
  }
  if (!isNode(specifier.imported)) return null;
  if (specifier.imported.type === "Identifier" && typeof specifier.imported.name === "string") {
    return specifier.imported.name;
  }
  return staticString(specifier.imported);
}

function registerVariableBinding(
  scope: Scope,
  node: ASTNode,
  parent: ASTNode | undefined,
  visitChildren: () => void,
): boolean {
  if (node.type !== "VariableDeclarator") return false;
  const declaration = parent?.type === "VariableDeclaration" ? parent : undefined;
  if (declaration?.declare === true) {
    visitChildren();
    return true;
  }
  const bindingScope = declaration?.kind === "var" ? nearestFunctionScope(scope) : scope;
  const id = patternChild(node.id);
  registerPattern(bindingScope, id);
  if (id !== undefined && isNode(node.init)) {
    recordPatternInitializer(bindingScope, id, node.init, false);
  }
  return false;
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

    registerRuntimeDeclaration(incomingScope, node);
    const scope = createNodeScope(node, incomingScope, root);
    registerScopeLocalBindings(scope, node);

    nodeScopes.set(node, scope);

    registerImportBindings(scope, node);
    if (
      node.type === "TSImportEqualsDeclaration" && node.importKind !== "type" &&
      isNode(node.id)
    ) {
      registerPattern(scope, node.id);
      if (
        node.id.type === "Identifier" && typeof node.id.name === "string" &&
        isNode(node.moduleReference)
      ) {
        const binding = ensureBinding(scope, node.id.name);
        if (
          node.moduleReference.type === "TSExternalModuleReference" &&
          isNode(node.moduleReference.expression)
        ) {
          binding.processModuleObjectImport ||= isProcessModuleSpecifier(
            staticString(node.moduleReference.expression),
          );
        } else {
          binding.initializers.push(node.moduleReference);
        }
      }
    }
    const handled = registerVariableBinding(
      scope,
      node,
      parent,
      () => forEachChild(node, (child, childKey) => visit(child, scope, node, childKey)),
    );
    if (handled) {
      return;
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

function collectAssignments(
  program: ASTNode,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
): void {
  // First record every alias assignment as an initializer, so a prototype
  // mutation is resolved through aliases wherever the assignment sits in the
  // source, not only when it happens to precede the mutating call.
  const collectAliasAssignments = (node: ASTNode): void => {
    const scope = nodeScopes.get(node) as Scope;
    if (
      node.type === "AssignmentExpression" &&
      ALIAS_ASSIGNMENT_OPERATORS.has(String(node.operator)) &&
      isNode(node.left) && isNode(node.right)
    ) {
      if (
        node.left.type === "Identifier" || node.left.type === "ObjectPattern" ||
        node.left.type === "ArrayPattern"
      ) {
        recordPatternInitializer(scope, node.left, node.right, true);
      } else if (isMemberExpressionWithObject(node.left)) {
        recordPropertyInitializer(
          node.left.object,
          scope,
          {
            propertyName: memberPropertyName(node.left),
            value: node.right,
            nodeScopes,
            definitelyAssigned: node.operator === "=" &&
              isDefinitelySequencedMutation(node, parents),
            position: nodePosition(node),
            executionScope: scope,
          },
        );
      }
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

  const markEnumerableProtoProperty = (
    target: ASTNode,
    scope: Scope,
    seen = new Set<Binding>(),
  ): void => {
    const expression = unwrapExpression(target);
    if (expression.type !== "Identifier" || typeof expression.name !== "string") return;
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return;
    seen.add(binding);
    binding.enumerableProtoPropertyDefined = true;
    for (const initializer of binding.initializers) {
      markEnumerableProtoProperty(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        seen,
      );
    }
  };

  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node) as Scope;
    recordObjectPropertyCopies(node, scope, nodeScopes, parents);
    const assignmentTarget = protoAssignmentMutationTarget(node);
    if (assignmentTarget) markPrototypeMutation(assignmentTarget, scope);

    for (const target of borrowedPrototypeMutatorCallTargets(node, scope, nodeScopes)) {
      markPrototypeMutation(target, scope);
    }
    const callMutationTarget = protoCallMutationTarget(node, scope, nodeScopes);
    if (callMutationTarget) markPrototypeMutation(callMutationTarget, scope);

    const protoSourceTarget = enumerableProtoDefinitionTarget(node, scope, nodeScopes);
    if (protoSourceTarget) markEnumerableProtoProperty(protoSourceTarget, scope);
    forEachChild(node, visit);
  };
  visit(program);
}

const CONDITIONAL_EXECUTION_CONTAINERS = new Set([
  "CatchClause",
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "SwitchCase",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

const DEFERRED_INSTANCE_INITIALIZER_CONTAINERS = new Set([
  "ClassAccessorProperty",
  "ClassPrivateProperty",
  "ClassProperty",
]);

function isDefinitelySequencedMutation(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  while (true) {
    const link = parents.get(current);
    if (!link) return false;
    const parent = link.parent;
    if (parent.type === "Program" || isFunction(parent)) return true;
    if (
      link.key === "value" && parent.static !== true &&
      DEFERRED_INSTANCE_INITIALIZER_CONTAINERS.has(parent.type)
    ) return false;
    if (CONDITIONAL_EXECUTION_CONTAINERS.has(parent.type)) return false;
    if (
      parent.type === "LogicalExpression" ||
      parent.type === "OptionalCallExpression" ||
      parent.type === "OptionalMemberExpression"
    ) return false;
    current = parent;
  }
}

function nodePosition(node: ASTNode): number | null {
  return typeof node.start === "number" && Number.isSafeInteger(node.start) ? node.start : null;
}

function recordObjectPropertyCopies(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
): void {
  const assignArgs = objectIntrinsicCallArguments(node, "assign", scope, nodeScopes);
  if (Array.isArray(assignArgs) && assignArgs[0] !== undefined) {
    for (const source of assignArgs.slice(1)) {
      recordPropertySource(assignArgs[0], source, scope, nodeScopes);
    }
  }

  const definePropertyArgs = objectIntrinsicCallArguments(
    node,
    "defineProperty",
    scope,
    nodeScopes,
  );
  if (
    !Array.isArray(definePropertyArgs) || definePropertyArgs[0] === undefined ||
    definePropertyArgs[1] === undefined || definePropertyArgs[2] === undefined
  ) return;

  const propertyName = staticString(definePropertyArgs[1]);
  for (const value of descriptorDefinedValues(definePropertyArgs[2], scope, nodeScopes)) {
    recordPropertyInitializer(
      definePropertyArgs[0],
      scope,
      {
        propertyName,
        value,
        nodeScopes,
        definitelyAssigned: isDefinitelySequencedMutation(node, parents),
        position: nodePosition(node),
        executionScope: scope,
      },
    );
  }
}

function recordPropertySource(
  target: ASTNode,
  source: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): void {
  const expression = unwrapExpression(target);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return;
    seen.add(binding);
    binding.propertySources.push(source);
    for (const initializer of binding.initializers) {
      recordPropertySource(
        initializer,
        source,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      );
    }
    return;
  }
  if (isMemberExpressionWithObject(expression)) {
    const propertyName = memberPropertyName(expression);
    for (
      const value of objectPropertyValues(
        expression.object,
        propertyName,
        scope,
        nodeScopes,
        new Set(seen),
      )
    ) {
      recordPropertySource(
        value,
        source,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      );
    }
    return;
  }
  if (isAliasAssignmentExpression(expression)) {
    recordPropertySource(expression.right, source, scope, nodeScopes, seen);
    return;
  }
  const branches = expressionBranches(expression);
  if (branches === null) return;
  recordPropertySource(branches[0], source, scope, nodeScopes, new Set(seen));
  recordPropertySource(branches[1], source, scope, nodeScopes, new Set(seen));
}

function recordPropertyInitializer(
  target: ASTNode,
  scope: Scope,
  context: PropertyInitializerContext,
  seen = new Set<Binding>(),
): void {
  const expression = unwrapExpression(target);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return;
    seen.add(binding);
    binding.propertyInitializers.push({
      propertyName: context.propertyName,
      value: context.value,
      executionScope: context.executionScope,
      definitelyAssigned: context.definitelyAssigned,
      position: context.position,
    });
    for (const initializer of binding.initializers) {
      recordPropertyInitializer(
        initializer,
        context.nodeScopes.get(initializer) ?? binding.scope,
        context,
        seen,
      );
    }
    return;
  }
  if (isAliasAssignmentExpression(expression)) {
    recordPropertyInitializer(
      expression.right,
      scope,
      context,
      seen,
    );
    return;
  }
  const branches = expressionBranches(expression);
  if (branches === null) return;
  recordPropertyInitializer(
    branches[0],
    scope,
    context,
    new Set(seen),
  );
  recordPropertyInitializer(
    branches[1],
    scope,
    context,
    new Set(seen),
  );
}

function protoAssignmentMutationTarget(node: ASTNode): ASTNode | undefined {
  if (node.type !== "AssignmentExpression" || !isNode(node.left)) return undefined;
  const left = node.left;
  if (
    (left.type !== "MemberExpression" && left.type !== "OptionalMemberExpression") ||
    !isNode(left.object)
  ) return undefined;
  const property = memberPropertyName(left);
  if (property !== "__proto__" && !(left.computed === true && property === null)) return undefined;
  return left.object;
}

function protoCallMutationTarget(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode | undefined {
  if (!isCallExpression(node) || !isNode(node.callee)) return undefined;
  const callee = unwrapExpression(node.callee);
  const args = callArguments(node);
  if (resolvesToPrototypeMutator(callee, scope, nodeScopes)) return args[0];
  if (isObjectAssignCall(callee, args, scope, nodeScopes)) return args[0];
  if (!isMemberExpressionWithObject(callee)) return undefined;
  const property = memberPropertyName(callee);
  const mutationTarget = prototypeMutatorTarget(
    property,
    callee.object,
    args,
    scope,
    nodeScopes,
  );
  if (mutationTarget) return mutationTarget;
  const borrowedSetterTarget = borrowedProtoSetterCallTarget(
    property,
    callee.object,
    args,
    scope,
    nodeScopes,
  );
  if (borrowedSetterTarget) return borrowedSetterTarget;
  const reflectApplyTarget = reflectApplyBorrowedProtoSetterTarget(
    property,
    callee.object,
    args,
    scope,
    nodeScopes,
  );
  if (reflectApplyTarget) return reflectApplyTarget;
  return undefined;
}

function borrowedPrototypeMutatorCallTargets(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode[] {
  if (!isCallExpression(node) || !isNode(node.callee)) return [];
  const callee = unwrapExpression(node.callee);
  if (!isMemberExpressionWithObject(callee)) return [];
  const property = memberPropertyName(callee);
  const args = callArguments(node);
  if (
    property === "call" &&
    resolvesToPrototypeMutator(callee.object, scope, nodeScopes)
  ) {
    // Function.prototype.call receives the mutator's target after its thisArg.
    return args[1] === undefined ? [] : [args[1]];
  }
  if (
    property === "apply" &&
    resolvesToPrototypeMutator(callee.object, scope, nodeScopes)
  ) {
    return staticArrayElements(args[1], 0, scope, nodeScopes);
  }
  if (
    property === "apply" &&
    resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes) &&
    args[0] !== undefined &&
    resolvesToPrototypeMutator(args[0], scope, nodeScopes)
  ) {
    return staticArrayElements(args[2], 0, scope, nodeScopes);
  }
  return [];
}

function resolvesToPrototypeMutator(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.memberInitializers.some((initializer) =>
      (initializer.propertyName === null || initializer.propertyName === "setPrototypeOf") &&
      (["Object", "Reflect"] as const).some((name) =>
        resolvesToGlobalIntrinsic(
          initializer.objectInitializer,
          name,
          nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
          nodeScopes,
          new Set(seen),
        )
      )
    ) || binding.initializers.some((initializer) =>
      resolvesToPrototypeMutator(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (
    isMemberExpressionWithObject(expression) &&
    memberPropertyName(expression) === "setPrototypeOf"
  ) {
    return resolvesToGlobalIntrinsic(expression.object, "Object", scope, nodeScopes) ||
      resolvesToGlobalIntrinsic(expression.object, "Reflect", scope, nodeScopes);
  }
  if (isAliasAssignmentExpression(expression)) {
    const leftMayRemain = logicalAssignmentMayRetainTruthyLeft(expression) &&
      isNode(expression.left) &&
      resolvesToPrototypeMutator(expression.left, scope, nodeScopes, new Set(seen));
    return leftMayRemain ||
      resolvesToPrototypeMutator(expression.right, scope, nodeScopes, new Set(seen));
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToPrototypeMutator(branches[0], scope, nodeScopes, new Set(seen)) ||
      resolvesToPrototypeMutator(branches[1], scope, nodeScopes, new Set(seen));
  }
  return false;
}

function staticArrayElements(
  node: ASTNode | undefined,
  index: number,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): ASTNode[] {
  if (!node) return [];
  const expression = unwrapExpression(node);
  if (expression.type === "ArrayExpression" && Array.isArray(expression.elements)) {
    const element = expression.elements[index];
    return isNode(element) && element.type !== "SpreadElement" ? [element] : [];
  }
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return [];
    seen.add(binding);
    return binding.initializers.flatMap((initializer) =>
      staticArrayElements(
        initializer,
        index,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isAliasAssignmentExpression(expression)) {
    return staticArrayElements(expression.right, index, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return [
      ...staticArrayElements(branches[0], index, scope, nodeScopes, new Set(seen)),
      ...staticArrayElements(branches[1], index, scope, nodeScopes, new Set(seen)),
    ];
  }
  return [];
}

function prototypeMutatorTarget(
  property: string | null,
  object: ASTNode,
  args: readonly ASTNode[],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode | undefined {
  if (property === "setPrototypeOf") {
    if (
      resolvesToGlobalIntrinsic(object, "Object", scope, nodeScopes) ||
      resolvesToGlobalIntrinsic(object, "Reflect", scope, nodeScopes)
    ) return args[0];
    return undefined;
  }
  if (property !== "set") return undefined;
  const key = staticString(args[1]);
  if (
    !resolvesToGlobalIntrinsic(object, "Reflect", scope, nodeScopes) ||
    key !== "__proto__" && key !== null
  ) return undefined;
  // Reflect.set applies an inherited setter to its explicit receiver, when
  // supplied, rather than necessarily mutating the target.
  return args[3] ?? args[0];
}

function borrowedProtoSetterCallTarget(
  property: string | null,
  object: ASTNode,
  args: readonly ASTNode[],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode | undefined {
  if (property !== "call" && property !== "apply") return undefined;
  if (!resolvesToObjectPrototypeProtoSetter(object, scope, nodeScopes)) return undefined;
  return args[0];
}

function reflectApplyBorrowedProtoSetterTarget(
  property: string | null,
  object: ASTNode,
  args: readonly ASTNode[],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode | undefined {
  if (
    property !== "apply" ||
    !resolvesToGlobalIntrinsic(object, "Reflect", scope, nodeScopes) ||
    args[0] === undefined ||
    !resolvesToObjectPrototypeProtoSetter(args[0], scope, nodeScopes)
  ) return undefined;
  return args[1];
}

function resolvesToObjectPrototypeProtoSetter(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.initializers.some((initializer) =>
      resolvesToObjectPrototypeProtoSetter(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (isMemberExpressionWithObject(expression) && memberPropertyName(expression) === "set") {
    return readsObjectPrototypeProtoDescriptor(expression.object, scope, nodeScopes);
  }
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return resolvesToObjectPrototypeProtoSetter(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToObjectPrototypeProtoSetter(branches[0], scope, nodeScopes, new Set(seen)) ||
      resolvesToObjectPrototypeProtoSetter(branches[1], scope, nodeScopes, new Set(seen));
  }
  return false;
}

function readsObjectPrototypeProtoDescriptor(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type !== "CallExpression" || !isNode(expression.callee)) return false;
  const callee = unwrapExpression(expression.callee);
  if (
    !isMemberExpressionWithObject(callee) ||
    memberPropertyName(callee) !== "getOwnPropertyDescriptor"
  ) {
    return false;
  }
  if (
    !resolvesToGlobalIntrinsic(callee.object, "Object", scope, nodeScopes) &&
    !resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes)
  ) return false;
  const args = callArguments(expression);
  const descriptorKey = staticString(args[1]);
  return args[0] !== undefined &&
    isObjectPrototypeReference(args[0], scope, nodeScopes) &&
    (descriptorKey === null || descriptorKey === "__proto__");
}

function isObjectPrototypeReference(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  const expression = unwrapExpression(node);
  return isMemberExpressionWithObject(expression) &&
    memberPropertyName(expression) === "prototype" &&
    resolvesToGlobalIntrinsic(expression.object, "Object", scope, nodeScopes);
}

function isObjectAssignCall(
  callee: ASTNode,
  args: readonly ASTNode[],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  return args[0] !== undefined &&
    resolvesToGlobalIntrinsicMember(callee, "Object", "assign", scope, nodeScopes) &&
    args.slice(1).some((source) => mayCopyEnumerableProtoProperty(source, scope, nodeScopes));
}

function enumerableProtoDefinitionTarget(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode | undefined {
  if (node.type !== "CallExpression" || !isNode(node.callee)) return undefined;
  const callee = unwrapExpression(node.callee);
  if (!isMemberExpressionWithObject(callee) || memberPropertyName(callee) !== "defineProperty") {
    return undefined;
  }
  if (!resolvesToGlobalIntrinsic(callee.object, "Object", scope, nodeScopes)) return undefined;
  const args = callArguments(node);
  if (staticString(args[1]) !== "__proto__") return undefined;
  if (!descriptorDefinesEnumerableProperty(args[2])) return undefined;
  return args[0];
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
    return binding.memberInitializers.some((initializer) =>
      (initializer.propertyName === null || initializer.propertyName === name) &&
      isGlobalObject(
        initializer.objectInitializer,
        nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    ) || binding.initializers.some((initializer) =>
      resolvesToGlobalIntrinsic(
        initializer,
        name,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (isMemberExpressionWithObject(expression) && memberPropertyName(expression) === name) {
    return isGlobalObject(expression.object, scope, nodeScopes);
  }
  if (
    expression.type === "TSQualifiedName" && isNode(expression.left) &&
    isNode(expression.right) && expression.right.type === "Identifier" &&
    expression.right.name === name
  ) {
    return isGlobalObject(expression.left, scope, nodeScopes);
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToGlobalIntrinsic(
        value,
        name,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return resolvesToGlobalIntrinsic(expression.right, name, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToGlobalIntrinsic(branches[0], name, scope, nodeScopes, new Set(seen)) ||
      resolvesToGlobalIntrinsic(branches[1], name, scope, nodeScopes, new Set(seen));
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

function callArguments(node: ASTNode): ASTNode[] {
  return Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
}

function isCallExpression(node: ASTNode): boolean {
  return node.type === "CallExpression" || node.type === "OptionalCallExpression";
}

function isLocalFunctionValue(node: ASTNode): boolean {
  return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" || node.type === "ObjectMethod" ||
    node.type === "ClassMethod" || node.type === "ClassPrivateMethod";
}

function localFunctionValues(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const expression = unwrapExpression(node);
  if (isLocalFunctionValue(expression)) return [expression];
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return [];
    seen.add(binding);
    return binding.initializers.flatMap((initializer) =>
      localFunctionValues(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const propertyName = memberPropertyName(expression);
    return objectPropertyValues(expression.object, propertyName, scope, nodeScopes, seen).flatMap(
      (value) =>
        localFunctionValues(
          value,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (returned.length > 0) {
    return returned.flatMap((value) =>
      localFunctionValues(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isAliasAssignmentExpression(expression)) {
    return localFunctionValues(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches === null
    ? []
    : branches.flatMap((branch) => localFunctionValues(branch, scope, nodeScopes, new Set(seen)));
}

function functionReturnExpressions(node: ASTNode): ASTNode[] {
  if (
    node.type === "ArrowFunctionExpression" && isNode(node.body) &&
    node.body.type !== "BlockStatement"
  ) return [node.body];
  if (!isNode(node.body)) return [];

  const returned: ASTNode[] = [];
  const collect = (candidate: ASTNode): void => {
    if (isLocalFunctionValue(candidate)) return;
    if (candidate.type === "ReturnStatement") {
      if (isNode(candidate.argument)) returned.push(candidate.argument);
      return;
    }
    forEachChild(candidate, collect);
  };
  forEachChild(node.body, collect);
  return returned;
}

function localCallReturnExpressions(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const expression = unwrapExpression(node);
  if (expression.type === "AwaitExpression" && isNode(expression.argument)) {
    return localCallReturnExpressions(expression.argument, scope, nodeScopes, seen);
  }
  if (!isCallExpression(expression) || !isNode(expression.callee)) return [];
  return localFunctionValues(expression.callee, scope, nodeScopes, seen).flatMap(
    functionReturnExpressions,
  );
}

function localClassObjects(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): LocalClassObject[] {
  const expression = unwrapExpression(node);
  if (expression.type === "ClassDeclaration" || expression.type === "ClassExpression") {
    return [{ classValue: expression, access: "static" }];
  }
  if (expression.type === "NewExpression" && isNode(expression.callee)) {
    return localClassObjects(expression.callee, scope, nodeScopes, seen).map((value) => ({
      classValue: value.classValue,
      access: "instance",
    }));
  }
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return [];
    seen.add(binding);
    return binding.initializers.flatMap((initializer) =>
      localClassObjects(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const propertyName = memberPropertyName(expression);
    return objectPropertyValues(expression.object, propertyName, scope, nodeScopes, seen).flatMap(
      (value) =>
        localClassObjects(
          value,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (returned.length > 0) {
    return returned.flatMap((value) =>
      localClassObjects(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isAliasAssignmentExpression(expression)) {
    return localClassObjects(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches === null
    ? []
    : branches.flatMap((branch) => localClassObjects(branch, scope, nodeScopes, new Set(seen)));
}

function isMemberExpressionWithObject(
  node: ASTNode,
): node is ASTNode & { object: ASTNode } {
  return (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    isNode(node.object);
}

function resolvesToGlobalIntrinsicMember(
  node: ASTNode,
  objectName: string,
  propertyName: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.memberInitializers.some((initializer) =>
      (initializer.propertyName === null || initializer.propertyName === propertyName) &&
      resolvesToGlobalIntrinsic(
        initializer.objectInitializer,
        objectName,
        nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    ) || binding.initializers.some((initializer) =>
      resolvesToGlobalIntrinsicMember(
        initializer,
        objectName,
        propertyName,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const memberName = memberPropertyName(expression);
    if (
      memberName === propertyName &&
      resolvesToGlobalIntrinsic(expression.object, objectName, scope, nodeScopes)
    ) return true;
    return objectPropertyValues(expression.object, memberName, scope, nodeScopes, seen).some(
      (value) =>
        resolvesToGlobalIntrinsicMember(
          value,
          objectName,
          propertyName,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToGlobalIntrinsicMember(
        value,
        objectName,
        propertyName,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (isAliasAssignmentExpression(expression)) {
    const leftMayRemain = logicalAssignmentMayRetainTruthyLeft(expression) &&
      isNode(expression.left) &&
      resolvesToGlobalIntrinsicMember(
        expression.left,
        objectName,
        propertyName,
        scope,
        nodeScopes,
        new Set(seen),
      );
    return leftMayRemain || resolvesToGlobalIntrinsicMember(
      expression.right,
      objectName,
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    );
  }
  if (
    expression.type === "LogicalExpression" && expression.operator === "&&" &&
    isNode(expression.right)
  ) {
    return resolvesToGlobalIntrinsicMember(
      expression.right,
      objectName,
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    );
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToGlobalIntrinsicMember(
      branches[0],
      objectName,
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    ) || resolvesToGlobalIntrinsicMember(
      branches[1],
      objectName,
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    );
  }
  return false;
}

function resolvesToMemberNamed(
  node: ASTNode,
  propertyName: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.memberInitializers.some((initializer) =>
      initializer.propertyName === null || initializer.propertyName === propertyName
    ) || binding.initializers.some((initializer) =>
      resolvesToMemberNamed(
        initializer,
        propertyName,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    return memberPropertyName(expression) === propertyName;
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToMemberNamed(
        value,
        propertyName,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (isAliasAssignmentExpression(expression)) {
    return resolvesToMemberNamed(expression.right, propertyName, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToMemberNamed(
      branches[0],
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    ) || resolvesToMemberNamed(
      branches[1],
      propertyName,
      scope,
      nodeScopes,
      new Set(seen),
    );
  }
  return false;
}

function resolvesToUnboundIdentifier(
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
      resolvesToUnboundIdentifier(
        initializer,
        name,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const propertyName = memberPropertyName(expression);
    return objectPropertyValues(expression.object, propertyName, scope, nodeScopes, seen).some(
      (value) =>
        resolvesToUnboundIdentifier(
          value,
          name,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToUnboundIdentifier(
        value,
        name,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (isAliasAssignmentExpression(expression)) {
    return resolvesToUnboundIdentifier(expression.right, name, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return resolvesToUnboundIdentifier(
      branches[0],
      name,
      scope,
      nodeScopes,
      new Set(seen),
    ) || resolvesToUnboundIdentifier(
      branches[1],
      name,
      scope,
      nodeScopes,
      new Set(seen),
    );
  }
  return false;
}

function objectPropertyValues(
  node: ASTNode,
  propertyName: string | null,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const expression = unwrapExpression(node);
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (returned.length > 0) {
    return returned.flatMap((value) =>
      objectPropertyValues(
        value,
        propertyName,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  const classObjects = localClassObjects(expression, scope, nodeScopes, new Set(seen));
  if (classObjects.length > 0) {
    return classObjects.flatMap((classObject) =>
      classMemberPropertyValues(
        classObject.classValue,
        propertyName,
        classObject.access,
        nodeScopes.get(classObject.classValue) ?? scope,
        nodeScopes,
        new Set(),
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const memberName = memberPropertyName(expression);
    return objectPropertyValues(expression.object, memberName, scope, nodeScopes, seen).flatMap(
      (value) =>
        objectPropertyValues(
          value,
          propertyName,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  if (expression.type === "ArrayExpression") {
    return arrayPropertyValues(expression, propertyName, scope, nodeScopes, seen);
  }
  if (expression.type === "ObjectExpression") {
    return objectLiteralPropertyValues(expression, propertyName, scope, nodeScopes, seen);
  }
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return [];
    seen.add(binding);
    return bindingPropertyValues(
      binding,
      propertyName,
      scope,
      nodePosition(expression),
      nodeScopes,
      seen,
    );
  }
  const assignArgs = objectIntrinsicCallArguments(expression, "assign", scope, nodeScopes);
  if (Array.isArray(assignArgs)) {
    return assignedPropertyValuesFromSources(
      assignArgs,
      propertyName,
      scope,
      nodeScopes,
      seen,
    );
  }

  const definePropertyArgs = objectIntrinsicCallArguments(
    expression,
    "defineProperty",
    scope,
    nodeScopes,
  );
  if (Array.isArray(definePropertyArgs) && definePropertyArgs[0] !== undefined) {
    return definedPropertyValues(
      definePropertyArgs,
      propertyName,
      scope,
      nodeScopes,
      seen,
    );
  }
  if (isAliasAssignmentExpression(expression)) {
    return objectPropertyValues(expression.right, propertyName, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches === null) return [];
  return [
    ...objectPropertyValues(branches[0], propertyName, scope, nodeScopes, new Set(seen)),
    ...objectPropertyValues(branches[1], propertyName, scope, nodeScopes, new Set(seen)),
  ];
}

function classMemberPropertyValues(
  classValue: ASTNode,
  propertyName: string | null,
  access: LocalClassObject["access"],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seenClasses: Set<ASTNode>,
): ASTNode[] {
  if (
    seenClasses.has(classValue) || !isNode(classValue.body) ||
    !Array.isArray(classValue.body.body)
  ) return [];
  const nextSeenClasses = new Set(seenClasses);
  nextSeenClasses.add(classValue);
  const members = classValue.body.body.filter(isNode);
  const { matchedMembers, values, shadowsInheritedProperty } = collectOwnClassMemberPropertyValues(
    members,
    propertyName,
    access,
  );
  values.push(...referencedPrivateClassMemberValues(members, matchedMembers));
  const inheritedProperties = inheritedClassPropertyNames(
    propertyName,
    matchedMembers,
    shadowsInheritedProperty,
  );
  values.push(...inheritedClassPropertyValues(
    classValue,
    inheritedProperties,
    access,
    scope,
    nodeScopes,
    nextSeenClasses,
  ));
  return values;
}

function collectOwnClassMemberPropertyValues(
  members: readonly ASTNode[],
  propertyName: string | null,
  access: LocalClassObject["access"],
): {
  matchedMembers: ASTNode[];
  values: ASTNode[];
  shadowsInheritedProperty: boolean;
} {
  const matchedMembers: ASTNode[] = [];
  const values: ASTNode[] = [];
  let shadowsInheritedProperty = false;
  for (const member of members) {
    if (
      privateClassMemberName(member) !== null ||
      (member.static === true) !== (access === "static")
    ) continue;
    const key = staticPropertyKey(member);
    if (propertyName !== null && key !== null && key !== propertyName) continue;
    if (propertyName !== null && key === propertyName) shadowsInheritedProperty = true;
    matchedMembers.push(member);
    values.push(...classMemberValues(member));
  }
  return { matchedMembers, values, shadowsInheritedProperty };
}

function inheritedClassPropertyNames(
  propertyName: string | null,
  matchedMembers: readonly ASTNode[],
  shadowsInheritedProperty: boolean,
): Set<string | null> {
  const inheritedProperties = new Set<string | null>();
  if (!shadowsInheritedProperty) inheritedProperties.add(propertyName);
  for (const member of matchedMembers) {
    for (const referencedName of referencedSuperPropertyNames(member)) {
      inheritedProperties.add(referencedName);
    }
  }
  return inheritedProperties;
}

function inheritedClassPropertyValues(
  classValue: ASTNode,
  inheritedProperties: ReadonlySet<string | null>,
  access: LocalClassObject["access"],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seenClasses: Set<ASTNode>,
): ASTNode[] {
  if (inheritedProperties.size === 0 || !isNode(classValue.superClass)) return [];
  const values: ASTNode[] = [];
  const superScope = nodeScopes.get(classValue.superClass) ?? scope;
  const parentClasses = localClassObjects(
    classValue.superClass,
    superScope,
    nodeScopes,
    new Set(),
  );
  for (const parentClass of parentClasses) {
    if (parentClass.access !== "static") continue;
    for (const inheritedProperty of inheritedProperties) {
      values.push(...classMemberPropertyValues(
        parentClass.classValue,
        inheritedProperty,
        access,
        nodeScopes.get(parentClass.classValue) ?? superScope,
        nodeScopes,
        seenClasses,
      ));
    }
  }
  return values;
}

function referencedSuperPropertyNames(member: ASTNode): Set<string | null> {
  const names = new Set<string | null>();
  const collect = (candidate: ASTNode): void => {
    if (
      (candidate !== member &&
        (candidate.type === "ClassDeclaration" || candidate.type === "ClassExpression"))
    ) return;
    if (
      isMemberExpressionWithObject(candidate) && candidate.object.type === "Super"
    ) {
      names.add(memberPropertyName(candidate));
    }
    forEachChild(candidate, collect);
  };
  collect(member);
  return names;
}

function classMemberValues(member: ASTNode): ASTNode[] {
  if (member.type === "ClassMethod" || member.type === "ClassPrivateMethod") {
    if (member.kind === "get") return functionReturnExpressions(member);
    return member.kind === "set" || member.kind === "constructor" ? [] : [member];
  }
  return ["ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty"].includes(
      member.type,
    ) && isNode(member.value)
    ? [member.value]
    : [];
}

function privateClassMemberName(member: ASTNode): string | null {
  if (
    !["ClassPrivateMethod", "ClassPrivateProperty"].includes(member.type) ||
    !isNode(member.key) || member.key.type !== "PrivateName" || !isNode(member.key.id)
  ) return null;
  return member.key.id.type === "Identifier" && typeof member.key.id.name === "string"
    ? member.key.id.name
    : null;
}

function referencedPrivateClassMemberNames(node: ASTNode): Set<string> {
  const names = new Set<string>();
  const collect = (candidate: ASTNode): void => {
    if (
      candidate !== node &&
      (candidate.type === "ClassDeclaration" || candidate.type === "ClassExpression")
    ) return;
    if (
      isMemberExpressionWithObject(candidate) && isNode(candidate.property) &&
      candidate.property.type === "PrivateName" && isNode(candidate.property.id) &&
      candidate.property.id.type === "Identifier" &&
      typeof candidate.property.id.name === "string"
    ) names.add(candidate.property.id.name);
    forEachChild(candidate, collect);
  };
  collect(node);
  return names;
}

function referencedPrivateClassMemberValues(
  members: readonly ASTNode[],
  roots: readonly ASTNode[],
): ASTNode[] {
  const privateMembers = new Map<string, ASTNode[]>();
  for (const member of members) {
    const name = privateClassMemberName(member);
    if (name === null) continue;
    const values = privateMembers.get(name) ?? [];
    values.push(member);
    privateMembers.set(name, values);
  }

  const pending = roots.flatMap((root) => [...referencedPrivateClassMemberNames(root)]);
  const seen = new Set<string>();
  const values: ASTNode[] = [];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const member of privateMembers.get(name) ?? []) {
      values.push(...classMemberValues(member));
      pending.push(...referencedPrivateClassMemberNames(member));
    }
  }
  return values;
}

function classInstanceCapabilityValues(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ASTNode[] {
  return localClassObjects(node, scope, nodeScopes, new Set())
    .filter((classObject) => classObject.access === "static")
    .flatMap((classObject) =>
      classMemberPropertyValues(
        classObject.classValue,
        null,
        "instance",
        nodeScopes.get(classObject.classValue) ?? scope,
        nodeScopes,
        new Set(),
      )
    );
}

function arrayPropertyValues(
  expression: ASTNode,
  propertyName: string | null,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const elements = Array.isArray(expression.elements) ? expression.elements : [];
  let candidates: unknown[] = elements;
  if (propertyName !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(propertyName)) return [];
    const index = Number(propertyName);
    candidates = Number.isSafeInteger(index) && index < elements.length ? [elements[index]] : [];
  }
  const values: ASTNode[] = [];
  for (const candidate of candidates) {
    if (!isNode(candidate)) continue;
    if (candidate.type !== "SpreadElement") {
      values.push(candidate);
      continue;
    }
    if (!isNode(candidate.argument)) continue;
    values.push(...objectPropertyValues(
      candidate.argument,
      null,
      nodeScopes.get(candidate.argument) ?? scope,
      nodeScopes,
      new Set(seen),
    ));
  }
  return values;
}

function objectLiteralPropertyValues(
  expression: ASTNode,
  propertyName: string | null,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const values: ASTNode[] = [];
  const properties = Array.isArray(expression.properties) ? expression.properties : [];
  for (const property of properties) {
    if (!isNode(property)) continue;
    const contribution = objectLiteralPropertyContribution(
      property,
      propertyName,
      scope,
      nodeScopes,
      seen,
    );
    if (contribution === null) continue;
    if (contribution.shadowsNamedProperty) values.length = 0;
    values.push(...contribution.values);
  }
  return values;
}

function objectLiteralPropertyContribution(
  property: ASTNode,
  propertyName: string | null,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): { values: ASTNode[]; shadowsNamedProperty: boolean } | null {
  if (property.type === "SpreadElement" && isNode(property.argument)) {
    return {
      values: objectPropertyValues(
        property.argument,
        propertyName,
        nodeScopes.get(property.argument) ?? scope,
        nodeScopes,
        new Set(seen),
      ),
      shadowsNamedProperty: false,
    };
  }
  if (property.type === "ObjectMethod") {
    const key = staticPropertyKey(property);
    if (propertyName !== null && key !== null && key !== propertyName) return null;
    return {
      values: objectMethodValues(property),
      shadowsNamedProperty: propertyName !== null && key === propertyName,
    };
  }
  if (property.type !== "ObjectProperty" || !isNode(property.value)) return null;
  const key = staticPropertyKey(property);
  if (propertyName !== null && key !== null && key !== propertyName) return null;
  return {
    values: [property.value],
    shadowsNamedProperty: propertyName !== null && key === propertyName,
  };
}

function objectMethodValues(property: ASTNode): ASTNode[] {
  if (property.kind === "get") return functionReturnExpressions(property);
  if (property.kind === "set") return [];
  return [property];
}

function bindingPropertyValues(
  binding: Binding,
  propertyName: string | null,
  readScope: Scope,
  readPosition: number | null,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const sequencedValues = propertyName === null || readPosition === null
    ? []
    : binding.propertyInitializers.filter((initializer) =>
      initializer.propertyName === propertyName && initializer.definitelyAssigned &&
      initializer.executionScope === readScope && initializer.position !== null &&
      initializer.position < readPosition
    );
  const latestSequencedValue = sequencedValues.at(-1);
  const latestPosition = latestSequencedValue?.position;
  if (
    latestSequencedValue !== undefined && latestPosition !== null &&
    latestPosition !== undefined && readPosition !== null
  ) {
    const uncertainValues = binding.propertyInitializers
      .filter((initializer) =>
        (initializer.propertyName === null || initializer.propertyName === propertyName) &&
        (initializer.position === null || initializer.position > latestPosition) &&
        (initializer.position === null || initializer.position < readPosition)
      )
      .map((initializer) => initializer.value);
    return [latestSequencedValue.value, ...uncertainValues];
  }
  const assignedValues = binding.propertyInitializers
    .filter((initializer) =>
      propertyName === null || initializer.propertyName === null ||
      initializer.propertyName === propertyName
    )
    .map((initializer) => initializer.value);
  return [
    ...assignedValues,
    ...propertyValuesFromSources(
      binding.propertySources,
      propertyName,
      binding.scope,
      nodeScopes,
      seen,
    ),
    ...propertyValuesFromSources(
      binding.initializers,
      propertyName,
      binding.scope,
      nodeScopes,
      seen,
    ),
  ];
}

function propertyValuesFromSources(
  sources: readonly ASTNode[],
  propertyName: string | null,
  fallbackScope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  return sources.flatMap((source) =>
    objectPropertyValues(
      source,
      propertyName,
      nodeScopes.get(source) ?? fallbackScope,
      nodeScopes,
      new Set(seen),
    )
  );
}

function assignedPropertyValuesFromSources(
  sources: readonly ASTNode[],
  propertyName: string | null,
  fallbackScope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const values: ASTNode[] = [];
  for (const source of sources) {
    const sourceScope = nodeScopes.get(source) ?? fallbackScope;
    if (
      propertyName !== null &&
      sourceDefinitelyDefinesProperty(source, propertyName)
    ) values.length = 0;
    values.push(...objectPropertyValues(
      source,
      propertyName,
      sourceScope,
      nodeScopes,
      new Set(seen),
    ));
  }
  return values;
}

function sourceDefinitelyDefinesProperty(node: ASTNode, propertyName: string): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "ObjectExpression" && Array.isArray(expression.properties)) {
    return expression.properties.some((property) =>
      isNode(property) && property.type !== "SpreadElement" &&
      staticPropertyKey(property) === propertyName
    );
  }
  if (expression.type === "ArrayExpression" && Array.isArray(expression.elements)) {
    if (!/^(?:0|[1-9]\d*)$/.test(propertyName)) return false;
    const index = Number(propertyName);
    return Number.isSafeInteger(index) && isNode(expression.elements[index]);
  }
  if (isAliasAssignmentExpression(expression)) {
    return sourceDefinitelyDefinesProperty(expression.right, propertyName);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    sourceDefinitelyDefinesProperty(branches[0], propertyName) &&
    sourceDefinitelyDefinesProperty(branches[1], propertyName);
}

function definedPropertyValues(
  args: readonly ASTNode[],
  propertyName: string | null,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): ASTNode[] {
  const target = args[0];
  if (target === undefined) return [];
  const values = objectPropertyValues(
    target,
    propertyName,
    nodeScopes.get(target) ?? scope,
    nodeScopes,
    new Set(seen),
  );
  const definedName = staticString(args[1]);
  if (
    args[2] !== undefined &&
    (propertyName === null || definedName === null || definedName === propertyName)
  ) {
    values.push(...descriptorDefinedValues(
      args[2],
      nodeScopes.get(args[2]) ?? scope,
      nodeScopes,
      seen,
    ));
  }
  return values;
}

function descriptorDefinedValues(
  descriptor: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): ASTNode[] {
  const values = objectPropertyValues(
    descriptor,
    "value",
    scope,
    nodeScopes,
    new Set(seen),
  );
  for (
    const getter of objectPropertyValues(
      descriptor,
      "get",
      scope,
      nodeScopes,
      new Set(seen),
    )
  ) {
    const returned = localFunctionValues(
      getter,
      nodeScopes.get(getter) ?? scope,
      nodeScopes,
      new Set(seen),
    ).flatMap(functionReturnExpressions);
    values.push(...(returned.length > 0 ? returned : [getter]));
  }
  return values;
}

function objectIntrinsicCallArguments(
  node: ASTNode,
  method: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ResolvedCallArguments {
  return argumentsForResolvedCall(
    node,
    (callee) => resolvesToGlobalIntrinsicMember(callee, "Object", method, scope, nodeScopes),
    scope,
    nodeScopes,
  );
}

type ResolvedCallArguments = ASTNode[] | null | undefined;

function argumentsForResolvedCall(
  node: ASTNode,
  resolvesCallee: (callee: ASTNode) => boolean,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): ResolvedCallArguments {
  if (!isCallExpression(node) || !isNode(node.callee)) return undefined;
  const callee = unwrapExpression(node.callee);
  const args = callArguments(node);
  if (resolvesCallee(callee)) return args;
  if (isMemberExpressionWithObject(callee) && resolvesCallee(callee.object)) {
    const invocation = memberPropertyName(callee);
    if (invocation === "call") return args.slice(1);
    if (invocation === "apply" || invocation === "bind") return null;
  }
  if (
    resolvesToGlobalIntrinsicMember(callee, "Reflect", "apply", scope, nodeScopes) &&
    args[0] !== undefined && resolvesCallee(args[0])
  ) return null;
  return undefined;
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

function staticStringFromImmutableBinding(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  seen = new Set<Binding>(),
): string | null {
  const direct = staticString(node);
  if (direct !== null) return direct;

  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (
      binding === null || binding.hasAliasAssignment || seen.has(binding) ||
      binding.initializers.length !== 1 || !Number.isSafeInteger(expression.start)
    ) return null;
    const initializer = binding.initializers[0]!;
    if (
      !isDirectConstBindingInitializer(initializer, parents) ||
      !Number.isSafeInteger(initializer.end) ||
      (initializer.end as number) > (expression.start as number)
    ) return null;
    seen.add(binding);
    return staticStringFromImmutableBinding(
      initializer,
      nodeScopes.get(initializer) ?? binding.scope,
      nodeScopes,
      parents,
      seen,
    );
  }
  if (
    expression.type === "BinaryExpression" && expression.operator === "+" &&
    isNode(expression.left) && isNode(expression.right)
  ) {
    const left = staticStringFromImmutableBinding(
      expression.left,
      nodeScopes.get(expression.left) ?? scope,
      nodeScopes,
      parents,
      new Set(seen),
    );
    if (left === null) return null;
    const right = staticStringFromImmutableBinding(
      expression.right,
      nodeScopes.get(expression.right) ?? scope,
      nodeScopes,
      parents,
      new Set(seen),
    );
    return right === null ? null : left + right;
  }
  return null;
}

function isDirectConstBindingInitializer(
  initializer: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  const declaratorLink = parents.get(initializer);
  if (
    declaratorLink?.key !== "init" ||
    declaratorLink.parent.type !== "VariableDeclarator" ||
    !isNode(declaratorLink.parent.id) || declaratorLink.parent.id.type !== "Identifier"
  ) return false;
  const declarationLink = parents.get(declaratorLink.parent);
  return declarationLink?.parent.type === "VariableDeclaration" &&
    declarationLink.parent.kind === "const";
}

function memberPropertyName(node: ASTNode): string | null {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return null;
  const property = isNode(node.property) ? node.property : undefined;
  if (!property) return null;
  if (node.computed === true) {
    const stringName = staticString(property);
    if (stringName !== null) return stringName;
    return staticNonStringPropertyName(property);
  }
  return property.type === "Identifier" && typeof property.name === "string" ? property.name : null;
}

function staticNumericPropertyName(node: ASTNode): string | null {
  if (node.type === "NumericLiteral" && typeof node.value === "number") {
    return String(node.value);
  }
  if (
    node.type !== "UnaryExpression" ||
    (node.operator !== "+" && node.operator !== "-") ||
    !isNode(node.argument)
  ) return null;
  const argument = unwrapExpression(node.argument);
  if (argument.type !== "NumericLiteral" || typeof argument.value !== "number") return null;
  return String(node.operator === "-" ? -argument.value : +argument.value);
}

function staticNonStringPropertyName(node: ASTNode): string | null {
  const expression = unwrapExpression(node);
  const numericName = staticNumericPropertyName(expression);
  if (numericName !== null) return numericName;
  if (expression.type === "BigIntLiteral" && typeof expression.value === "string") {
    return expression.value;
  }
  if (expression.type === "BooleanLiteral" && typeof expression.value === "boolean") {
    return String(expression.value);
  }
  if (expression.type === "NullLiteral") return "null";
  return null;
}

function staticBoolean(node: ASTNode | undefined): boolean | null {
  if (!node) return null;
  const expression = unwrapExpression(node);
  return expression.type === "BooleanLiteral" && typeof expression.value === "boolean"
    ? expression.value
    : null;
}

function descriptorDefinesEnumerableProperty(node: ASTNode | undefined): boolean {
  if (!node) return false;
  const expression = unwrapExpression(node);
  if (expression.type !== "ObjectExpression") return false;
  const properties = Array.isArray(expression.properties) ? expression.properties : [];
  for (const property of properties) {
    if (!isNode(property) || property.type !== "ObjectProperty") continue;
    if (staticPropertyKey(property) !== "enumerable") continue;
    return staticBoolean(patternChild(property.value)) === true;
  }
  return false;
}

function objectPropertyIsProtoSetter(property: ASTNode): boolean {
  if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.key)) {
    return false;
  }
  return property.computed !== true && staticPropertyKey(property) === "__proto__";
}

function objectPropertyMayDefineEnumerableProto(property: ASTNode): boolean {
  if (
    !isNode(property) ||
    (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") ||
    !isNode(property.key)
  ) {
    return false;
  }
  if (property.computed !== true) {
    return property.type === "ObjectMethod" && staticPropertyKey(property) === "__proto__";
  }
  const key = staticString(property.key);
  return key === null || key === "__proto__";
}

function objectLiteralMutatesPrototype(node: ASTNode): boolean {
  const expression = unwrapExpression(node);
  if (expression.type !== "ObjectExpression") return false;
  const properties = Array.isArray(expression.properties) ? expression.properties : [];
  return properties.some(objectPropertyIsProtoSetter);
}

function objectLiteralMayDefineEnumerableProto(node: ASTNode): boolean {
  const expression = unwrapExpression(node);
  if (expression.type !== "ObjectExpression") return false;
  const properties = Array.isArray(expression.properties) ? expression.properties : [];
  return properties.some(objectPropertyMayDefineEnumerableProto);
}

function isImportMetaUrl(node: ASTNode | undefined): boolean {
  return isImportMetaMember(node, "url");
}

function isImportMeta(node: ASTNode | undefined): boolean {
  if (!node) return false;
  const expression = unwrapExpression(node);
  return expression.type === "MetaProperty" && isNode(expression.meta) &&
    expression.meta.name === "import" && isNode(expression.property) &&
    expression.property.name === "meta";
}

function isImportMetaResolve(node: ASTNode | undefined): boolean {
  return isImportMetaMember(node, "resolve");
}

function importMetaPathProperty(node: ASTNode | undefined): "dirname" | "filename" | null {
  if (isImportMetaMember(node, "dirname")) return "dirname";
  if (isImportMetaMember(node, "filename")) return "filename";
  return null;
}

function isImportMetaMember(node: ASTNode | undefined, propertyName: string): boolean {
  if (!node) return false;
  const expression = unwrapExpression(node);
  if (
    (expression.type !== "MemberExpression" && expression.type !== "OptionalMemberExpression") ||
    memberPropertyName(expression) !== propertyName || !isNode(expression.object)
  ) return false;
  const object = unwrapExpression(expression.object);
  return isImportMeta(object);
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

function isExecutableTypeScriptContainer(parent: ASTNode): boolean {
  return EXECUTABLE_TS_CONTAINER_TYPES.has(parent.type) ||
    ((parent.type === "TSModuleDeclaration" || parent.type === "TSEnumDeclaration") &&
      parent.declare !== true);
}

function isTypeAnnotationKey(key: string): boolean {
  return key === "typeAnnotation" || key === "returnType" || key === "typeParameters";
}

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
      if (isExecutableTypeScriptContainer(parent)) {
        current = parent;
        continue;
      }
      return true;
    }
    if (isTypeAnnotationKey(link.key)) return true;
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
    if (isDirectBindingPosition(parent, key)) return true;
    if (isNestedBindingPatternPosition(parent, key, parents)) {
      current = parent;
      continue;
    }
    return false;
  }
}

function isDirectBindingPosition(parent: ASTNode, key: string): boolean {
  return (parent.type === "VariableDeclarator" && key === "id") ||
    (isFunction(parent) && key === "params") ||
    (parent.type === "CatchClause" && key === "param") ||
    (parent.type === "TSParameterProperty" && key === "parameter");
}

function isNestedBindingPatternPosition(
  parent: ASTNode,
  key: string,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  if (parent.type === "AssignmentPattern" && key === "left") return true;
  if (parent.type === "RestElement" && key === "argument") return true;
  if (parent.type === "ArrayPattern" && key === "elements") return true;
  if (parent.type === "ObjectPattern" && key === "properties") return true;
  return parent.type === "ObjectProperty" && key === "value" &&
    parents.get(parent)?.parent.type === "ObjectPattern";
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
  if (isStaticMemberProperty(parent, key)) return false;
  if (isStaticPropertyKey(parent, key)) return false;
  if (isStatementLabel(parent)) return false;
  if (isDeclarationName(parent, key)) return false;
  if (parent.type === "ExportSpecifier" && key === "exported") return false;
  return true;
}

function isStaticMemberProperty(parent: ASTNode, key: string): boolean {
  return (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    key === "property" && parent.computed !== true;
}

function isStaticPropertyKey(parent: ASTNode, key: string): boolean {
  return ["ObjectProperty", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(
    parent.type,
  ) && key === "key" && parent.computed !== true;
}

function isStatementLabel(parent: ASTNode): boolean {
  return ["LabeledStatement", "BreakStatement", "ContinueStatement", "MetaProperty"].includes(
    parent.type,
  );
}

function isDeclarationName(parent: ASTNode, key: string): boolean {
  return parent.type.startsWith("Import") || key === "id" || key === "params" || key === "param";
}

function isGlobalObject(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    return identifierResolvesToGlobalObject(expression.name, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) {
    return isGlobalObject(branches[0], scope, nodeScopes, new Set(seen)) ||
      isGlobalObject(branches[1], scope, nodeScopes, new Set(seen));
  }
  if (
    isMemberExpressionWithObject(expression) &&
    GLOBAL_OBJECT_NAMES.has(memberPropertyName(expression) ?? "")
  ) {
    return isGlobalObject(expression.object, scope, nodeScopes, seen);
  }
  if (isValueOfCall(expression)) {
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

function identifierResolvesToGlobalObject(
  name: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): boolean {
  const binding = resolveBinding(scope, name);
  if (binding === null) return GLOBAL_OBJECT_NAMES.has(name);
  if (seen.has(binding)) return false;
  seen.add(binding);
  return binding.memberInitializers.some((initializer) =>
    (initializer.propertyName === null ||
      GLOBAL_OBJECT_NAMES.has(initializer.propertyName)) &&
    isGlobalObject(
      initializer.objectInitializer,
      nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
      nodeScopes,
      new Set(seen),
    )
  ) || binding.initializers.some((initializer) =>
    isGlobalObject(initializer, nodeScopes.get(initializer) ?? binding.scope, nodeScopes, seen)
  );
}

function isValueOfCall(
  node: ASTNode,
): node is ASTNode & { callee: ASTNode & { object: ASTNode } } {
  if (
    (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") ||
    !isNode(node.callee)
  ) return false;
  const callee = node.callee;
  return isMemberExpressionWithObject(callee) && memberPropertyName(callee) === "valueOf";
}

function isGlobalWorkerConstructor(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    return identifierResolvesToGlobalWorker(expression.name, scope, nodeScopes, seen);
  }
  if (isMemberExpressionWithObject(expression) && memberPropertyName(expression) === "Worker") {
    return isGlobalObject(expression.object, scope, nodeScopes);
  }
  if (
    expression.type === "TSQualifiedName" && isNode(expression.left) &&
    isNode(expression.right) && expression.right.type === "Identifier" &&
    expression.right.name === "Worker"
  ) {
    return isGlobalObject(expression.left, scope, nodeScopes);
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      isGlobalWorkerConstructor(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  // `new (W = Worker)(...)` constructs whatever the assignment evaluates to,
  // which is its right-hand side.
  if (isAliasAssignmentExpression(expression)) {
    return isGlobalWorkerConstructor(expression.right, scope, nodeScopes, seen);
  }
  if (isReflectGetGlobalWorker(expression, scope, nodeScopes)) return true;
  return false;
}

function identifierResolvesToGlobalWorker(
  name: string,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): boolean {
  const binding = resolveBinding(scope, name);
  if (binding === null) return name === "Worker";
  if (seen.has(binding)) return false;
  seen.add(binding);
  return bindingHasGlobalWorkerObjectInitializer(binding, nodeScopes, seen) ||
    binding.initializers.some((initializer) =>
      isGlobalWorkerConstructor(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
}

function bindingHasGlobalWorkerObjectInitializer(
  binding: Binding,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): boolean {
  return binding.workerObjectInitializers.some((initializer) =>
    isGlobalObject(
      initializer,
      nodeScopes.get(initializer) ?? binding.scope,
      nodeScopes,
      new Set(seen),
    )
  );
}

function isAliasAssignmentExpression(
  expression: ASTNode,
): expression is ASTNode & { right: ASTNode } {
  return expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right);
}

function logicalAssignmentMayRetainTruthyLeft(expression: ASTNode): boolean {
  return expression.operator === "||=" || expression.operator === "??=";
}

function isReflectGetGlobalWorker(
  expression: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  if (expression.type !== "CallExpression" || !isNode(expression.callee)) return false;
  const callee = unwrapExpression(expression.callee);
  if (!isMemberExpressionWithObject(callee) || memberPropertyName(callee) !== "get") return false;
  const reflect = unwrapExpression(callee.object);
  if (
    reflect.type !== "Identifier" || reflect.name !== "Reflect" ||
    resolveBinding(scope, "Reflect") !== null
  ) return false;
  const args = callArguments(expression);
  return args[0] !== undefined &&
    isGlobalObject(args[0], scope, nodeScopes) &&
    staticString(args[1]) === "Worker";
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
    return !objectLiteralMutatesPrototype(expression);
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

function mayCopyEnumerableProtoProperty(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (enumerableProtoDefinitionTarget(expression, scope, nodeScopes) !== undefined) return true;
  if (expression.type === "ObjectExpression") {
    return objectLiteralMayDefineEnumerableProto(expression);
  }
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding) || binding.initializers.length === 0) return true;
    if (binding.enumerableProtoPropertyDefined) return true;
    seen.add(binding);
    return binding.initializers.some((initializer) =>
      mayCopyEnumerableProtoProperty(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        seen,
      )
    );
  }
  if (
    expression.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(expression.operator)) && isNode(expression.right)
  ) {
    return mayCopyEnumerableProtoProperty(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  if (branches !== null) return eitherBranchCopiesProto(branches, scope, nodeScopes, seen);
  return ![
    "ArrayExpression",
    "ArrowFunctionExpression",
    "BigIntLiteral",
    "BooleanLiteral",
    "ClassExpression",
    "FunctionExpression",
    "NullLiteral",
    "NumericLiteral",
    "RegExpLiteral",
    "StringLiteral",
    "TemplateLiteral",
  ].includes(expression.type);
}

function eitherBranchCopiesProto(
  branches: readonly [ASTNode, ASTNode],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): boolean {
  return mayCopyEnumerableProtoProperty(branches[0], scope, nodeScopes, new Set(seen)) ||
    mayCopyEnumerableProtoProperty(branches[1], scope, nodeScopes, new Set(seen));
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
    // Imports, parameters, and destructured values have no initializer in this
    // syntax tree. They may still be callable, so an unresolved property name
    // on them must fail closed just like one on a local function.
    if (binding.initializers.length === 0) return true;
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
  const branches = expressionBranches(expression);
  if (branches !== null) return eitherBranchCallable(branches, scope, nodeScopes, seen);
  return false;
}

function eitherBranchCallable(
  branches: readonly [ASTNode, ASTNode],
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen: Set<Binding>,
): boolean {
  return isCallableValue(branches[0], scope, nodeScopes, new Set(seen)) ||
    isCallableValue(branches[1], scope, nodeScopes, new Set(seen));
}

function isPrototypeOfCallableValue(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type !== "CallExpression" || !isNode(expression.callee)) return false;
  const callee = unwrapExpression(expression.callee);
  if (
    (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") ||
    memberPropertyName(callee) !== "getPrototypeOf" || !isNode(callee.object)
  ) return false;
  if (
    !resolvesToGlobalIntrinsic(callee.object, "Object", scope, nodeScopes) &&
    !resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes)
  ) return false;
  const args = Array.isArray(expression.arguments) ? expression.arguments.filter(isNode) : [];
  return args[0] !== undefined && isCallableValue(args[0], scope, nodeScopes);
}

function readsFunctionConstructorDescriptor(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  if (node.type !== "CallExpression" || !isNode(node.callee)) return false;
  const callee = unwrapExpression(node.callee);
  if (
    (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") ||
    memberPropertyName(callee) !== "getOwnPropertyDescriptor" || !isNode(callee.object)
  ) return false;
  if (
    !resolvesToGlobalIntrinsic(callee.object, "Object", scope, nodeScopes) &&
    !resolvesToGlobalIntrinsic(callee.object, "Reflect", scope, nodeScopes)
  ) return false;
  const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
  const property = staticString(args[1]);
  return (property === null || property === "constructor") &&
    args[0] !== undefined && isPrototypeOfCallableValue(args[0], scope, nodeScopes);
}

function classifyLiteralWorkerUrl(
  value: string,
  specifier: string | null,
  requiresUnqualifiedWorkerShim = false,
): WorkerUrlClassification {
  if (REMOTE_OR_INLINE_URL.test(value)) return { kind: "remote" };
  if (FILE_URL.test(value)) return { kind: "file", specifier: null };
  if (!LOCAL_MODULE_SPECIFIER.test(value)) return { kind: "dynamic" };
  return {
    kind: "local",
    specifier,
    requiresUnqualifiedWorkerShim,
    resolutionBase: "route",
  };
}

function classifyUrlConstructorWorkerArgument(
  expression: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): WorkerUrlClassification | null {
  if (
    expression.type !== "NewExpression" || !isNode(expression.callee) ||
    !isGlobalUrlConstructor(expression.callee, scope, nodeScopes)
  ) return null;

  const args = callArguments(expression);
  const specifier = staticString(args[0]);
  if (specifier === null) return { kind: "dynamic" };
  const entry = classifyLiteralWorkerUrl(specifier, specifier);
  if (entry.kind !== "local") return entry;
  return classifyLocalUrlWorkerArgument(specifier, args[1]);
}

function classifyLocalUrlWorkerArgument(
  specifier: string,
  base: ASTNode | undefined,
): WorkerUrlClassification {
  if (isImportMetaUrl(base)) {
    return {
      kind: "local",
      specifier,
      requiresUnqualifiedWorkerShim: false,
      resolutionBase: "module",
    };
  }
  const staticBase = staticString(base);
  if (staticBase !== null && REMOTE_OR_INLINE_URL.test(staticBase)) return { kind: "remote" };
  if (staticBase !== null && FILE_URL.test(staticBase)) return { kind: "file", specifier: null };
  return { kind: "dynamic" };
}

function classifyWorkerArgument(
  argument: ASTNode | undefined,
  workerConstructor: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): WorkerUrlClassification {
  if (!argument) return { kind: "dynamic" };
  const literal = staticString(argument);
  if (literal !== null) {
    return classifyLiteralWorkerUrl(
      literal,
      literal,
      requiresUnqualifiedWorkerShim(workerConstructor, scope),
    );
  }

  const expression = unwrapExpression(argument);
  const urlArgument = classifyUrlConstructorWorkerArgument(expression, scope, nodeScopes);
  if (urlArgument !== null) return urlArgument;

  return { kind: "dynamic" };
}

function requiresUnqualifiedWorkerShim(workerConstructor: ASTNode, scope: Scope): boolean {
  const expression = unwrapExpression(workerConstructor);
  return !(expression.type === "Identifier" && expression.name === "Worker" &&
    resolveBinding(scope, "Worker") === null);
}

function isAliasInitializerUse(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  let link = parents.get(current);
  while (link && isInertInspectionValueFlow(link)) {
    current = link.parent;
    link = parents.get(current);
  }
  if (!link) return false;
  if (
    current.type === "AssignmentExpression" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(current.operator)) &&
    isNode(current.left) &&
    (current.left.type === "Identifier" ||
      isSafeGlobalObjectDestructuring(current.left)) &&
    link.parent.type === "ExpressionStatement" && link.key === "expression"
  ) return true;
  return (link.parent.type === "VariableDeclarator" && link.key === "init" &&
    isNode(link.parent.id) &&
    (link.parent.id.type === "Identifier" ||
      isSafeGlobalObjectDestructuring(link.parent.id))) ||
    (link.parent.type === "AssignmentExpression" && link.key === "right" &&
      ALIAS_ASSIGNMENT_OPERATORS.has(String(link.parent.operator)) &&
      isNode(link.parent.left) &&
      (link.parent.left.type === "Identifier" ||
        isSafeGlobalObjectDestructuring(link.parent.left)));
}

function isSafeGlobalObjectDestructuring(pattern: ASTNode): boolean {
  if (pattern.type !== "ObjectPattern" || !Array.isArray(pattern.properties)) return false;
  for (const property of pattern.properties) {
    if (!isNode(property) || property.type !== "ObjectProperty" || !isNode(property.key)) {
      return false;
    }
    const key = staticPropertyKey(property);
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

function isCallExpressionCallee(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  let link = parents.get(current);
  while (
    link && TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) &&
    link.key === "expression"
  ) {
    current = link.parent;
    link = parents.get(current);
  }
  return link !== undefined && isCallExpression(link.parent) && link.key === "callee";
}

function isInertCapabilityInspection(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  let link = parents.get(current);
  while (link && isInertInspectionValueFlow(link)) {
    if (isTruthyLogicalAndLeftGuard(link)) return true;
    current = link.parent;
    link = parents.get(current);
  }
  if (!link) return false;
  if (
    link.parent.type === "UnaryExpression" &&
    (link.parent.operator === "typeof" || link.parent.operator === "!") &&
    link.key === "argument"
  ) return true;
  if (isInertControlFlowUse(link)) return true;
  return link.parent.type === "BinaryExpression" &&
    (link.parent.operator === "===" || link.parent.operator === "!==") &&
    (link.key === "left" || link.key === "right");
}

function isTruthyLogicalAndLeftGuard(link: ParentLink): boolean {
  return link.parent.type === "LogicalExpression" &&
    link.parent.operator === "&&" &&
    link.key === "left";
}

function isInertInspectionValueFlow(link: ParentLink): boolean {
  if (TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) && link.key === "expression") return true;
  if (
    link.parent.type === "ConditionalExpression" &&
    (link.key === "consequent" || link.key === "alternate")
  ) return true;
  return link.parent.type === "LogicalExpression" &&
    (link.key === "left" || link.key === "right");
}

function isInertControlFlowUse(link: ParentLink): boolean {
  return (link.key === "test" &&
    (link.parent.type === "IfStatement" ||
      link.parent.type === "ConditionalExpression" ||
      link.parent.type === "WhileStatement" ||
      link.parent.type === "DoWhileStatement" ||
      link.parent.type === "ForStatement")) ||
    (link.key === "discriminant" && link.parent.type === "SwitchStatement");
}

function isTrackedPrototypeMutatorInvocationUse(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  let link = parents.get(current);
  while (
    link && TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) &&
    link.key === "expression"
  ) {
    current = link.parent;
    link = parents.get(current);
  }
  if (!link) return false;
  if (
    isCallExpression(link.parent) && link.key === "arguments" &&
    borrowedPrototypeMutatorCallTargets(link.parent, scope, nodeScopes).length > 0
  ) return true;
  if (
    !isMemberExpressionWithObject(link.parent) || link.key !== "object" ||
    (memberPropertyName(link.parent) !== "call" && memberPropertyName(link.parent) !== "apply")
  ) return false;
  current = link.parent;
  link = parents.get(current);
  while (
    link && TS_EXPRESSION_WRAPPER_TYPES.has(link.parent.type) &&
    link.key === "expression"
  ) {
    current = link.parent;
    link = parents.get(current);
  }
  return link !== undefined && isCallExpression(link.parent) && link.key === "callee" &&
    borrowedPrototypeMutatorCallTargets(link.parent, scope, nodeScopes).length > 0;
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

interface MutableSourceCapabilityAnalysis {
  hasDynamicCodeGeneration: boolean;
  workers: WorkerUrlClassification[];
  moduleSpecifiers: string[];
  hasUnconstrainedDynamicImport: boolean;
}

function recordModuleSpecifier(
  analysis: MutableSourceCapabilityAnalysis,
  specifier: string | null,
): void {
  if (specifier === null) analysis.hasUnconstrainedDynamicImport = true;
  else analysis.moduleSpecifiers.push(specifier);
}

function staticImportExportSpecifier(node: ASTNode): string | undefined {
  const isImport = node.type === "ImportDeclaration" && node.importKind !== "type" &&
    hasRuntimeSpecifiers(node, "importKind");
  const isExport = (node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration") &&
    node.exportKind !== "type" &&
    hasRuntimeSpecifiers(node, "exportKind");
  if ((!isImport && !isExport) || !isNode(node.source)) return undefined;
  return staticString(node.source) ?? undefined;
}

function hasRuntimeSpecifiers(node: ASTNode, kind: "importKind" | "exportKind"): boolean {
  if (!Array.isArray(node.specifiers) || node.specifiers.length === 0) return true;
  return node.specifiers.some((specifier) => !isNode(specifier) || specifier[kind] !== "type");
}

function tsImportEqualsSpecifier(node: ASTNode): string | null | undefined {
  if (
    node.type !== "TSImportEqualsDeclaration" || node.importKind === "type" ||
    !isNode(node.moduleReference) ||
    node.moduleReference.type !== "TSExternalModuleReference" ||
    !isNode(node.moduleReference.expression)
  ) return undefined;
  return staticString(node.moduleReference.expression);
}

function dynamicImportSpecifier(node: ASTNode): string | null | undefined {
  if (node.type === "ImportExpression" && isNode(node.source)) return staticString(node.source);
  if (node.type !== "CallExpression" || !isNode(node.callee) || node.callee.type !== "Import") {
    return undefined;
  }
  const args = callArguments(node);
  return staticString(args[0]);
}

function applyModuleSpecifierCapability(
  node: ASTNode,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const staticSpecifier = staticImportExportSpecifier(node);
  if (staticSpecifier !== undefined) analysis.moduleSpecifiers.push(staticSpecifier);

  const tsSpecifier = tsImportEqualsSpecifier(node);
  if (tsSpecifier !== undefined) recordModuleSpecifier(analysis, tsSpecifier);

  const importSpecifier = dynamicImportSpecifier(node);
  if (importSpecifier !== undefined) recordModuleSpecifier(analysis, importSpecifier);
}

function applyIdentifierCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type !== "Identifier" || typeof node.name !== "string") return;

  if (
    node.name === "Symbol" && resolveBinding(scope, node.name) === null &&
    isMutationTarget(node, parents)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }

  if (!isIdentifierReference(node, parents)) return;

  if (
    ["eval", "Function"].some((name) => resolvesToGlobalIntrinsic(node, name, scope, nodeScopes))
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }

  if (
    isGlobalObject(node, scope, nodeScopes) &&
    !isMemberObjectUse(node, parents) &&
    !isAliasInitializerUse(node, parents) &&
    !isReflectGetGlobalArgument(node, scope, parents)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }

  if (
    isGlobalWorkerConstructor(node, scope, nodeScopes) &&
    !isNewExpressionCallee(node, parents) &&
    !isAliasInitializerUse(node, parents)
  ) {
    analysis.workers.push({ kind: "dynamic" });
  }
}

function applyMemberCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return;
  const property = memberPropertyName(node);
  const object = patternChild(node.object);
  const objectIsProvablyPlain = object !== undefined &&
    isPlainObjectValue(object, scope, nodeScopes);
  const objectIsGlobal = object !== undefined && isGlobalObject(object, scope, nodeScopes);
  if (objectIsGlobal && property === "Symbol" && isMutationTarget(node, parents)) {
    analysis.hasDynamicCodeGeneration = true;
  }
  const computedKeyIsDefinitelySymbol = node.computed === true && isNode(node.property) &&
    isDefinitelySymbolValue(node.property, scope, nodeScopes);
  const mayReadConstructor = !isMemberWriteTarget(node, parents) &&
    (property === "constructor" ||
      node.computed === true && property === null && !computedKeyIsDefinitelySymbol);
  if (mayReadConstructor && !objectIsProvablyPlain) analysis.hasDynamicCodeGeneration = true;
  if (
    property === "extensions" && object !== undefined &&
    resolvesToUnboundIdentifier(object, "require", scope, nodeScopes)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
  if (
    resolvesToDenoCommand(node, scope, nodeScopes) &&
    !isNewExpressionCallee(node, parents) &&
    !isInertCapabilityInspection(node, parents) &&
    !isAliasInitializerUse(node, parents)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
  if (!objectIsGlobal) return;
  if (property === null || property === "eval" || property === "Function") {
    analysis.hasDynamicCodeGeneration = true;
  }
  if (
    property === "Worker" && !isNewExpressionCallee(node, parents) &&
    !isAliasInitializerUse(node, parents)
  ) {
    analysis.workers.push({ kind: "dynamic" });
  }
}

function isMemberWriteTarget(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  while (true) {
    const link = parents.get(current);
    if (!link) return false;
    if (
      link.parent.type === "AssignmentExpression" && link.key === "left" &&
      link.parent.operator === "="
    ) return true;
    if (
      (link.parent.type === "ForInStatement" || link.parent.type === "ForOfStatement") &&
      link.key === "left"
    ) return true;
    if (!isNestedBindingPatternPosition(link.parent, link.key, parents)) return false;
    current = link.parent;
  }
}

function isMutationTarget(
  node: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): boolean {
  let current = node;
  while (true) {
    const link = parents.get(current);
    if (!link) return false;
    if (isDirectMutationTarget(link)) return true;
    if (!isNestedBindingPatternPosition(link.parent, link.key, parents)) return false;
    current = link.parent;
  }
}

function isDirectMutationTarget(link: ParentLink): boolean {
  return link.parent.type === "AssignmentExpression" && link.key === "left" ||
    link.parent.type === "UpdateExpression" && link.key === "argument" ||
    link.parent.type === "UnaryExpression" && link.parent.operator === "delete" &&
      link.key === "argument" ||
    (link.parent.type === "ForInStatement" || link.parent.type === "ForOfStatement") &&
      link.key === "left";
}

function isDefinitelySymbolValue(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (
      binding === null || binding.hasAliasAssignment || seen.has(binding) ||
      binding.initializers.length === 0
    ) return false;
    seen.add(binding);
    return binding.initializers.every((initializer) =>
      isDefinitelySymbolValue(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isCallExpression(expression) && isNode(expression.callee)) {
    const callee = unwrapExpression(expression.callee);
    return resolvesDefinitelyToGlobalIntrinsic(callee, "Symbol", scope, nodeScopes) ||
      (isMemberExpressionWithObject(callee) && memberPropertyName(callee) === "for" &&
        resolvesDefinitelyToGlobalIntrinsic(callee.object, "Symbol", scope, nodeScopes));
  }
  if (isMemberExpressionWithObject(expression)) {
    const propertyName = memberPropertyName(expression);
    return propertyName !== null && WELL_KNOWN_SYMBOL_NAMES.has(propertyName) &&
      resolvesDefinitelyToGlobalIntrinsic(expression.object, "Symbol", scope, nodeScopes);
  }
  if (isAliasAssignmentExpression(expression)) {
    return expression.operator === "=" &&
      isDefinitelySymbolValue(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    isDefinitelySymbolValue(branches[0], scope, nodeScopes, new Set(seen)) &&
    isDefinitelySymbolValue(branches[1], scope, nodeScopes, new Set(seen));
}

function resolvesDefinitelyToGlobalIntrinsic(
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
    if (
      binding.hasAliasAssignment || seen.has(binding) || binding.initializers.length === 0
    ) return false;
    seen.add(binding);
    return binding.initializers.every((initializer) =>
      resolvesDefinitelyToGlobalIntrinsic(
        initializer,
        name,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isMemberExpressionWithObject(expression) && memberPropertyName(expression) === name) {
    return isUnshadowedGlobalObjectExpression(expression.object, scope);
  }
  if (isAliasAssignmentExpression(expression)) {
    return expression.operator === "=" &&
      resolvesDefinitelyToGlobalIntrinsic(expression.right, name, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    resolvesDefinitelyToGlobalIntrinsic(
      branches[0],
      name,
      scope,
      nodeScopes,
      new Set(seen),
    ) &&
    resolvesDefinitelyToGlobalIntrinsic(
      branches[1],
      name,
      scope,
      nodeScopes,
      new Set(seen),
    );
}

function isUnshadowedGlobalObjectExpression(
  node: ASTNode,
  scope: Scope,
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    return GLOBAL_OBJECT_NAMES.has(expression.name) &&
      resolveBinding(scope, expression.name) === null;
  }
  if (
    isMemberExpressionWithObject(expression) &&
    GLOBAL_OBJECT_NAMES.has(memberPropertyName(expression) ?? "")
  ) {
    return isUnshadowedGlobalObjectExpression(expression.object, scope);
  }
  return false;
}

function applyCallCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (!isCallExpression(node) || !isNode(node.callee)) return;
  if (readsFunctionConstructorDescriptor(node, scope, nodeScopes)) {
    analysis.hasDynamicCodeGeneration = true;
  }
  const callee = unwrapExpression(node.callee);
  applyReflectGetCapability(node, callee, scope, nodeScopes, analysis);
  applyDynamicRequireCapability(node, callee, scope, nodeScopes, analysis);
  applyGetBuiltinModuleCapability(node, scope, nodeScopes, analysis);
  applySubprocessCallCapability(node, scope, nodeScopes, analysis);
  applyReflectConstructionCapability(node, scope, nodeScopes, analysis);
  applyDescriptorReadCapability(node, scope, nodeScopes, analysis);
  applyIndirectPropertyCopyCapability(node, scope, nodeScopes, analysis);
}

function applyReflectConstructionCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const args = argumentsForResolvedCall(
    node,
    (candidate) =>
      resolvesToGlobalIntrinsicMember(candidate, "Reflect", "construct", scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args === undefined) return;
  if (args === null || args[0] && resolvesToDenoCommand(args[0], scope, nodeScopes)) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyIndirectPropertyCopyCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  for (const method of ["assign", "defineProperty"]) {
    if (objectIntrinsicCallArguments(node, method, scope, nodeScopes) === null) {
      analysis.hasDynamicCodeGeneration = true;
      return;
    }
  }
}

function applyReflectGetCapability(
  node: ASTNode,
  _callee: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const args = argumentsForResolvedCall(
    node,
    (candidate) => resolvesToGlobalIntrinsicMember(candidate, "Reflect", "get", scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args === undefined) return;
  if (args === null) {
    analysis.hasDynamicCodeGeneration = true;
    return;
  }
  const property = staticString(args[1]);
  if (property === null || property === "constructor") analysis.hasDynamicCodeGeneration = true;
  if (
    args[0] && isGlobalObject(args[0], scope, nodeScopes) &&
    (property === null || property === "eval" || property === "Function")
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyDynamicRequireCapability(
  node: ASTNode,
  callee: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const args = argumentsForResolvedCall(
    node,
    (candidate) => resolvesToUnboundIdentifier(candidate, "require", scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args === undefined) return;
  const directRequire = callee.type === "Identifier" && callee.name === "require" &&
    resolveBinding(scope, "require") === null;
  const moduleSpecifier = args === null ? null : staticString(args[0]);
  if (args === null || !directRequire || moduleSpecifier === null) {
    analysis.hasUnconstrainedDynamicImport = true;
  } else {
    analysis.moduleSpecifiers.push(moduleSpecifier);
  }
}

const RESTRICTED_BUILTIN_MODULES = new Set([
  "child_process",
  "cluster",
  "inspector",
  "inspector/promises",
  "module",
  "node:repl",
  "node:test",
  "node:child_process",
  "node:cluster",
  "node:inspector",
  "node:inspector/promises",
  "node:module",
  "node:vm",
  "node:worker_threads",
  "repl",
  "vm",
  "worker_threads",
]);

function applyGetBuiltinModuleCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const args = argumentsForResolvedCall(
    node,
    (candidate) => resolvesToMemberNamed(candidate, "getBuiltinModule", scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args === undefined) return;
  const moduleName = args === null ? null : staticString(args[0]);
  if (moduleName === null || RESTRICTED_BUILTIN_MODULES.has(moduleName.toLowerCase())) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function resolvesToDenoCommand(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  return resolvesToGlobalIntrinsicMember(node, "Deno", "Command", scope, nodeScopes);
}

function resolvesToBunSubprocess(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  return ["spawn", "spawnSync"].some((property) =>
    resolvesToGlobalIntrinsicMember(node, "Bun", property, scope, nodeScopes)
  );
}

function resolvesToBunShell(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  return resolvesToGlobalIntrinsicMember(node, "Bun", "$", scope, nodeScopes);
}

function resolvesToBunPlugin(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  return resolvesToGlobalIntrinsicMember(node, "Bun", "plugin", scope, nodeScopes);
}

function resolvesToProcessExecve(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.processExecveImport || binding.memberInitializers.some((initializer) =>
      (initializer.propertyName === null || initializer.propertyName === "execve") &&
      resolvesToProcessObject(
        initializer.objectInitializer,
        nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    ) || binding.initializers.some((initializer) =>
      resolvesToProcessExecve(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const property = memberPropertyName(expression);
    if (
      property === "execve" &&
      resolvesToProcessObject(expression.object, scope, nodeScopes, new Set(seen))
    ) return true;
    return objectPropertyValues(
      expression.object,
      property,
      scope,
      nodeScopes,
      new Set(seen),
    ).some(
      (value) =>
        resolvesToProcessExecve(
          value,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToProcessExecve(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (isAliasAssignmentExpression(expression)) {
    return resolvesToProcessExecve(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    (resolvesToProcessExecve(branches[0], scope, nodeScopes, new Set(seen)) ||
      resolvesToProcessExecve(branches[1], scope, nodeScopes, new Set(seen)));
}

const PROCESS_INTERNAL_BINDING_MEMBERS = new Set(["binding", "_linkedBinding"]);

function resolvesToProcessInternalBinding(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.memberInitializers.some((initializer) =>
      (initializer.propertyName === null ||
        PROCESS_INTERNAL_BINDING_MEMBERS.has(initializer.propertyName)) &&
      resolvesToProcessObject(
        initializer.objectInitializer,
        nodeScopes.get(initializer.objectInitializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    ) || binding.initializers.some((initializer) =>
      resolvesToProcessInternalBinding(
        initializer,
        nodeScopes.get(initializer) ?? binding.scope,
        nodeScopes,
        new Set(seen),
      )
    );
  }
  if (isMemberExpressionWithObject(expression)) {
    const property = memberPropertyName(expression);
    if (
      property !== null && PROCESS_INTERNAL_BINDING_MEMBERS.has(property) &&
      resolvesToProcessObject(expression.object, scope, nodeScopes, new Set(seen))
    ) return true;
    return objectPropertyValues(
      expression.object,
      property,
      scope,
      nodeScopes,
      new Set(seen),
    ).some(
      (value) =>
        resolvesToProcessInternalBinding(
          value,
          nodeScopes.get(value) ?? scope,
          nodeScopes,
          new Set(seen),
        ),
    );
  }
  const returned = localCallReturnExpressions(expression, scope, nodeScopes, seen);
  if (
    returned.some((value) =>
      resolvesToProcessInternalBinding(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        new Set(seen),
      )
    )
  ) return true;
  if (isAliasAssignmentExpression(expression)) {
    return resolvesToProcessInternalBinding(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    (resolvesToProcessInternalBinding(branches[0], scope, nodeScopes, new Set(seen)) ||
      resolvesToProcessInternalBinding(branches[1], scope, nodeScopes, new Set(seen)));
}

function resolvesToProcessObject(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seen = new Set<Binding>(),
): boolean {
  const expression = unwrapExpression(node);
  if (resolvesToGlobalIntrinsic(expression, "process", scope, nodeScopes, new Set(seen))) {
    return true;
  }
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    const binding = resolveBinding(scope, expression.name);
    if (binding === null || seen.has(binding)) return false;
    seen.add(binding);
    return binding.processModuleObjectImport ||
      binding.initializers.some((initializer) =>
        resolvesToProcessObject(
          initializer,
          nodeScopes.get(initializer) ?? binding.scope,
          nodeScopes,
          new Set(seen),
        )
      );
  }
  if (expression.type === "AwaitExpression" && isNode(expression.argument)) {
    return resolvesToProcessObject(expression.argument, scope, nodeScopes, seen);
  }
  const imported = dynamicImportSpecifier(expression);
  if (imported !== undefined) return isProcessModuleSpecifier(imported);
  if (
    expression.type === "TSExternalModuleReference" && isNode(expression.expression)
  ) {
    return isProcessModuleSpecifier(staticString(expression.expression));
  }
  const args = argumentsForResolvedCall(
    expression,
    (candidate) =>
      resolvesToUnboundIdentifier(candidate, "require", scope, nodeScopes) ||
      resolvesToMemberNamed(candidate, "getBuiltinModule", scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args !== undefined) return args !== null && isProcessModuleSpecifier(staticString(args[0]));
  if (isAliasAssignmentExpression(expression)) {
    return resolvesToProcessObject(expression.right, scope, nodeScopes, seen);
  }
  const branches = expressionBranches(expression);
  return branches !== null &&
    (resolvesToProcessObject(branches[0], scope, nodeScopes, new Set(seen)) ||
      resolvesToProcessObject(branches[1], scope, nodeScopes, new Set(seen)));
}

function isProcessModuleSpecifier(specifier: string | null): boolean {
  return specifier !== null && PROCESS_MODULE_SPECIFIERS.has(specifier.toLowerCase());
}

function applySubprocessCallCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const args = argumentsForResolvedCall(
    node,
    (candidate) =>
      resolvesToGlobalIntrinsicMember(candidate, "Deno", "run", scope, nodeScopes) ||
      resolvesToDenoCommand(candidate, scope, nodeScopes) ||
      resolvesToBunSubprocess(candidate, scope, nodeScopes) ||
      resolvesToBunShell(candidate, scope, nodeScopes) ||
      resolvesToBunPlugin(candidate, scope, nodeScopes) ||
      resolvesToProcessExecve(candidate, scope, nodeScopes) ||
      resolvesToProcessInternalBinding(candidate, scope, nodeScopes),
    scope,
    nodeScopes,
  );
  if (args !== undefined) analysis.hasDynamicCodeGeneration = true;
}

function applyTaggedTemplateCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (
    node.type === "TaggedTemplateExpression" && isNode(node.tag) &&
    resolvesToBunShell(node.tag, scope, nodeScopes)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyDescriptorReadCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  const pluralArgs = argumentsForResolvedCall(
    node,
    (candidate) =>
      resolvesToGlobalIntrinsicMember(
        candidate,
        "Object",
        "getOwnPropertyDescriptors",
        scope,
        nodeScopes,
      ),
    scope,
    nodeScopes,
  );
  if (pluralArgs !== undefined) {
    analysis.hasDynamicCodeGeneration = true;
    return;
  }
  const args = argumentsForResolvedCall(
    node,
    (candidate) =>
      resolvesToGlobalIntrinsicMember(
        candidate,
        "Object",
        "getOwnPropertyDescriptor",
        scope,
        nodeScopes,
      ) || resolvesToGlobalIntrinsicMember(
        candidate,
        "Reflect",
        "getOwnPropertyDescriptor",
        scope,
        nodeScopes,
      ),
    scope,
    nodeScopes,
  );
  if (args === undefined) return;
  if (args === null) {
    analysis.hasDynamicCodeGeneration = true;
    return;
  }
  const descriptorKey = staticString(args[1]);
  if (descriptorKey === null || descriptorKey === "constructor") {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyObjectPatternCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type !== "ObjectProperty" || parents.get(node)?.parent.type !== "ObjectPattern") return;
  const key = staticPropertyKey(node);
  if (!destructuredKeyMayExposeGenerator(key)) return;
  const source = objectPatternSource(node, parents);
  if (source === undefined) {
    analysis.hasDynamicCodeGeneration = true;
    return;
  }
  if (isGlobalObject(source, scope, nodeScopes)) {
    analysis.hasDynamicCodeGeneration = true;
    return;
  }
  if ((key === null || key === "constructor") && !isPlainObjectValue(source, scope, nodeScopes)) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function destructuredKeyMayExposeGenerator(key: string | null): boolean {
  return key === null || key === "eval" || key === "Function" || key === "constructor" ||
    key === "getOwnPropertyDescriptor" || key === "getOwnPropertyDescriptors";
}

function objectPatternSource(
  property: ASTNode,
  parents: WeakMap<ASTNode, ParentLink>,
): ASTNode | undefined {
  const pattern = parents.get(property)?.parent;
  if (pattern?.type !== "ObjectPattern") return undefined;
  const link = parents.get(pattern);
  if (!link) return undefined;
  if (
    link.parent.type === "VariableDeclarator" && link.key === "id" &&
    isNode(link.parent.init)
  ) return link.parent.init;
  if (
    link.parent.type === "AssignmentExpression" && link.key === "left" &&
    ALIAS_ASSIGNMENT_OPERATORS.has(String(link.parent.operator)) &&
    isNode(link.parent.right)
  ) return link.parent.right;
  return undefined;
}

function applyWorkerConstructionCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (
    node.type !== "NewExpression" || !isNode(node.callee) ||
    !isGlobalWorkerConstructor(node.callee, scope, nodeScopes)
  ) return;
  const args = callArguments(node);
  analysis.workers.push(classifyWorkerArgument(args[0], node.callee, scope, nodeScopes));
}

function applySubprocessConstructionCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (
    node.type === "NewExpression" && isNode(node.callee) &&
    resolvesToDenoCommand(node.callee, scope, nodeScopes)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applySubprocessReferenceCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type === "Identifier" && !isIdentifierReference(node, parents)) return;
  if (
    resolvesToDenoCommand(node, scope, nodeScopes) &&
    !isNewExpressionCallee(node, parents) &&
    !isInertCapabilityInspection(node, parents) &&
    !isAliasInitializerUse(node, parents) &&
    !isBindingIdentifier(node, parents) &&
    !isMutationTarget(node, parents)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyPrototypeMutatorReferenceCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  parents: WeakMap<ASTNode, ParentLink>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type === "Identifier" && !isIdentifierReference(node, parents)) return;
  if (
    resolvesToPrototypeMutator(node, scope, nodeScopes) &&
    !isCallExpressionCallee(node, parents) &&
    !isTrackedPrototypeMutatorInvocationUse(node, scope, nodeScopes, parents) &&
    !isInertCapabilityInspection(node, parents) &&
    !isAliasInitializerUse(node, parents) &&
    !isBindingIdentifier(node, parents) &&
    !isMutationTarget(node, parents)
  ) {
    analysis.hasDynamicCodeGeneration = true;
  }
}

function applyInheritedClassCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (
    (node.type !== "ClassDeclaration" && node.type !== "ClassExpression") ||
    !isNode(node.superClass) || !isNode(node.body) || !Array.isArray(node.body.body)
  ) return;

  const superScope = nodeScopes.get(node.superClass) ?? scope;
  const parentClasses = localClassObjects(node.superClass, superScope, nodeScopes, new Set())
    .filter((parentClass) => parentClass.access === "static");
  for (const member of node.body.body) {
    if (!isNode(member)) continue;
    if (
      memberReferencesInheritedCapability(
        member,
        parentClasses,
        node,
        superScope,
        nodeScopes,
      )
    ) {
      analysis.hasDynamicCodeGeneration = true;
      return;
    }
  }
}

function memberReferencesInheritedCapability(
  member: ASTNode,
  parentClasses: readonly LocalClassObject[],
  blockedClass: ASTNode,
  superScope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
): boolean {
  const referencedNames = referencedSuperPropertyNames(member);
  if (referencedNames.size === 0) return false;
  const access = member.static === true ? "static" : "instance";
  return parentClasses.some((parentClass) =>
    [...referencedNames].some((referencedName) =>
      classMemberPropertyValues(
        parentClass.classValue,
        referencedName,
        access,
        nodeScopes.get(parentClass.classValue) ?? superScope,
        nodeScopes,
        new Set([blockedClass]),
      ).some((value) =>
        isCrossModuleCapabilityAlias(
          value,
          nodeScopes.get(value) ?? superScope,
          nodeScopes,
        )
      )
    )
  );
}

function isCrossModuleCapabilityAlias(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seenFunctions = new Set<ASTNode>(),
  seenValues = new Set<ASTNode>(),
): boolean {
  const expression = unwrapExpression(node);
  if (seenValues.has(expression)) return false;
  const nextSeenValues = new Set(seenValues);
  nextSeenValues.add(expression);
  return isGlobalObject(expression, scope, nodeScopes) ||
    isGlobalWorkerConstructor(expression, scope, nodeScopes) ||
    resolvesToPrototypeMutator(expression, scope, nodeScopes) ||
    resolvesToGlobalIntrinsicMember(expression, "Reflect", "get", scope, nodeScopes) ||
    resolvesToGlobalIntrinsicMember(
      expression,
      "Object",
      "getOwnPropertyDescriptor",
      scope,
      nodeScopes,
    ) ||
    resolvesToGlobalIntrinsicMember(
      expression,
      "Reflect",
      "getOwnPropertyDescriptor",
      scope,
      nodeScopes,
    ) ||
    resolvesToGlobalIntrinsicMember(
      expression,
      "Object",
      "getOwnPropertyDescriptors",
      scope,
      nodeScopes,
    ) ||
    resolvesToMemberNamed(expression, "getBuiltinModule", scope, nodeScopes) ||
    resolvesToDenoCommand(expression, scope, nodeScopes) ||
    resolvesToBunSubprocess(expression, scope, nodeScopes) ||
    resolvesToBunShell(expression, scope, nodeScopes) ||
    resolvesToBunPlugin(expression, scope, nodeScopes) ||
    resolvesToProcessExecve(expression, scope, nodeScopes) ||
    resolvesToProcessInternalBinding(expression, scope, nodeScopes) ||
    resolvesToUnboundIdentifier(expression, "require", scope, nodeScopes) ||
    ["Bun", "Deno", "Object", "Reflect", "process"].some((name) =>
      resolvesToGlobalIntrinsic(expression, name, scope, nodeScopes)
    ) ||
    functionReturnsCrossModuleCapability(
      expression,
      scope,
      nodeScopes,
      seenFunctions,
      nextSeenValues,
    ) ||
    objectPropertyValues(expression, null, scope, nodeScopes, new Set()).some((value) =>
      isCrossModuleCapabilityAlias(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        seenFunctions,
        nextSeenValues,
      )
    ) ||
    classInstanceCapabilityValues(expression, scope, nodeScopes).some((value) =>
      isCrossModuleCapabilityAlias(
        value,
        nodeScopes.get(value) ?? scope,
        nodeScopes,
        seenFunctions,
        nextSeenValues,
      )
    );
}

function functionReturnsCrossModuleCapability(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  seenFunctions: Set<ASTNode>,
  seenValues: Set<ASTNode>,
): boolean {
  return localFunctionValues(node, scope, nodeScopes, new Set()).some((functionValue) => {
    if (seenFunctions.has(functionValue)) return false;
    const nextSeen = new Set(seenFunctions);
    nextSeen.add(functionValue);
    return functionReturnExpressions(functionValue).some((returned) =>
      isCrossModuleCapabilityAlias(
        returned,
        nodeScopes.get(returned) ?? scope,
        nodeScopes,
        nextSeen,
        seenValues,
      )
    );
  });
}

function exportedDeclarationValues(node: ASTNode): ASTNode[] {
  if (!isNode(node.declaration)) return [];
  if (node.declaration.type !== "VariableDeclaration") return [node.declaration];
  const candidates: ASTNode[] = [];
  const declarations = Array.isArray(node.declaration.declarations)
    ? node.declaration.declarations
    : [];
  for (const declaration of declarations) {
    if (isNode(declaration) && isNode(declaration.init)) candidates.push(declaration.init);
  }
  return candidates;
}

function exportedLocalSpecifiers(node: ASTNode): ASTNode[] {
  if (isNode(node.source) || !Array.isArray(node.specifiers)) return [];
  const candidates: ASTNode[] = [];
  for (const specifier of node.specifiers) {
    if (isNode(specifier) && isNode(specifier.local)) candidates.push(specifier.local);
  }
  return candidates;
}

function applyExportedCapabilityAlias(
  node: ASTNode,
  scope: Scope,
  nodeScopes: WeakMap<ASTNode, Scope>,
  analysis: MutableSourceCapabilityAnalysis,
): void {
  if (node.type !== "ExportNamedDeclaration" && node.type !== "ExportDefaultDeclaration") return;
  const candidates = node.type === "ExportDefaultDeclaration" && isNode(node.declaration)
    ? [node.declaration]
    : exportedDeclarationValues(node).concat(exportedLocalSpecifiers(node));
  if (candidates.some((candidate) => isCrossModuleCapabilityAlias(candidate, scope, nodeScopes))) {
    analysis.hasDynamicCodeGeneration = true;
  }
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
  collectAssignments(program, nodeScopes, parents);

  const analysis: MutableSourceCapabilityAnalysis = {
    hasDynamicCodeGeneration: false,
    workers: [],
    moduleSpecifiers: [],
    hasUnconstrainedDynamicImport: false,
  };

  const visit = (node: ASTNode): void => {
    const scope = nodeScopes.get(node);
    if (!scope || isTypeOnlyPosition(node, parents)) return;

    applyIdentifierCapability(node, scope, nodeScopes, parents, analysis);
    applyModuleSpecifierCapability(node, analysis);
    applyMemberCapability(node, scope, nodeScopes, parents, analysis);
    applyCallCapability(node, scope, nodeScopes, analysis);
    applyTaggedTemplateCapability(node, scope, nodeScopes, analysis);
    applyObjectPatternCapability(node, scope, nodeScopes, parents, analysis);
    applyWorkerConstructionCapability(node, scope, nodeScopes, analysis);
    applySubprocessConstructionCapability(node, scope, nodeScopes, analysis);
    applySubprocessReferenceCapability(node, scope, nodeScopes, parents, analysis);
    applyPrototypeMutatorReferenceCapability(
      node,
      scope,
      nodeScopes,
      parents,
      analysis,
    );
    applyInheritedClassCapability(node, scope, nodeScopes, analysis);
    applyExportedCapabilityAlias(node, scope, nodeScopes, analysis);

    forEachChild(node, visit);
  };

  visit(program);
  return {
    hasDynamicCodeGeneration: analysis.hasDynamicCodeGeneration,
    workers: analysis.workers,
    moduleSpecifiers: analysis.moduleSpecifiers,
    hasUnconstrainedDynamicImport: analysis.hasUnconstrainedDynamicImport,
  };
}

export type StaticRouteOptionsCapability = "present" | "absent" | "unknown";

function staticExportName(node: ASTNode | undefined): string | null {
  if (!isNode(node)) return null;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (
    (node.type === "StringLiteral" || node.type === "Literal") &&
    typeof node.value === "string"
  ) return node.value;
  return null;
}

function isStaticCallableRouteValue(node: ASTNode | undefined): boolean {
  return isNode(node) && (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "ClassExpression"
  );
}

function isTypeOnlyExportDeclaration(node: ASTNode | undefined): boolean {
  if (!isNode(node)) return true;
  return node.declare === true ||
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSDeclareFunction";
}

/**
 * Determine whether a route's OPTIONS export is statically absent.
 *
 * This intentionally reports `unknown` for dynamic or ambiguous export
 * shapes. Callers may use only `absent` as a pre-authentication signal; every
 * other result keeps the existing authenticate-before-evaluation boundary.
 */
export async function resolveStaticRouteOptionsCapability(
  source: string,
): Promise<StaticRouteOptionsCapability> {
  // CommonJS assignments are resolved by the loader rather than the ESM
  // export declarations below. Keep the pre-auth path conservative for them.
  if (COMMONJS_EXPORT_PATTERN.test(source)) return "unknown";

  const program = await parseSource(source);
  if (program === null) return "unknown";

  const statements = Array.isArray(program.body)
    ? program.body.filter((statement): statement is ASTNode => isNode(statement))
    : [];
  let uncertain = false;

  for (const statement of statements) {
    if (statement.type === "ExportDefaultDeclaration") {
      if (!isTypeOnlyExportDeclaration(statement.declaration as ASTNode | undefined)) {
        return "present";
      }
      continue;
    }

    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind !== "type") uncertain = true;
      continue;
    }

    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") {
      continue;
    }

    const declaration = statement.declaration as ASTNode | undefined;
    if (isNode(declaration)) {
      const declarationName = staticExportName(declaration.id as ASTNode | undefined);
      if (
        declarationName === "OPTIONS" &&
        declaration.declare !== true &&
        (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration")
      ) return "present";

      if (declaration.type === "VariableDeclaration") {
        const declarators = Array.isArray(declaration.declarations)
          ? declaration.declarations.filter((item): item is ASTNode => isNode(item))
          : [];
        const optionsDeclarator = declarators.find((item) =>
          staticExportName(item.id as ASTNode | undefined) === "OPTIONS"
        );
        if (
          declarators.some((item) => {
            const id = item.id as ASTNode | undefined;
            return isNode(id) && id.type !== "Identifier";
          })
        ) {
          uncertain = true;
        }
        if (optionsDeclarator) {
          if (isStaticCallableRouteValue(optionsDeclarator.init as ASTNode | undefined)) {
            return "present";
          }
          uncertain = true;
        }
      }
    }

    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers.filter((specifier): specifier is ASTNode => isNode(specifier))
      : [];
    for (const specifier of specifiers) {
      if (specifier.exportKind === "type") continue;
      const exportedName = staticExportName(specifier.exported as ASTNode | undefined);
      if (exportedName === "OPTIONS" || exportedName === "default") return "present";
    }
  }

  return uncertain ? "unknown" : "absent";
}
