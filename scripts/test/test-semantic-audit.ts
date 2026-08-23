import { parse } from "#babel/parser";
import {
  discoverTests,
  getExecutableTestKind,
  type TestLayoutInventoryEntry,
} from "./test-layout.ts";
import {
  TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
} from "./test-semantic-audit-migration.ts";

export type SemanticEffect =
  | "filesystem-read"
  | "filesystem-watch"
  | "filesystem-write"
  | "process"
  | "server"
  | "network"
  | "browser"
  | "shared-cwd";

interface SemanticDispositionBase {
  readonly path: string;
  readonly effects: readonly SemanticEffect[];
  readonly owner: string;
}

export type SemanticDispositionEntry =
  & SemanticDispositionBase
  & (
    | {
      readonly disposition: "replaceable-fake";
      readonly rationale?: string;
      readonly replacement: string;
      readonly removalPr: string;
    }
    | {
      readonly disposition: "hermetic-unit";
      readonly rationale: string;
    }
    | {
      readonly disposition: "integration-relocation";
      readonly rationale?: string;
      readonly destination: string;
      readonly removalPr: string;
    }
  );

export type SemanticDisposition = SemanticDispositionEntry["disposition"];

interface SemanticDispositionShapeInput {
  readonly path: string;
  readonly effects: readonly unknown[];
  readonly disposition: unknown;
  readonly owner: string;
  readonly rationale?: string;
  readonly replacement?: string;
  readonly destination?: string;
  readonly removalPr?: string;
}

export interface SemanticMarker {
  readonly effect: SemanticEffect;
  readonly line: number;
  readonly symbol: string;
}

export interface SemanticAuditCandidate {
  readonly path: string;
  readonly markers: readonly SemanticMarker[];
}

export interface SemanticAuditResult {
  readonly consideredFiles: number;
  readonly consideredRoots: readonly string[];
  readonly candidates: readonly SemanticAuditCandidate[];
  readonly errors: readonly string[];
}

export interface CollectSemanticAuditOptions {
  readonly root?: string;
  readonly paths?: readonly string[];
  readonly dispositions?: readonly SemanticDispositionEntry[];
}

export type SemanticDispositionBaseline =
  | { readonly kind: "missing"; readonly ref: string }
  | {
    readonly kind: "paths";
    readonly ref: string;
    readonly paths: readonly string[];
    readonly effectsByPath?: Readonly<
      Record<string, readonly SemanticEffect[]>
    >;
  }
  | {
    readonly kind: "malformed";
    readonly ref: string;
    readonly reason: string;
  };

const UNIT_ROOTS = [
  "src",
  "cli",
  "extensions",
  "templates",
  "scripts",
  "react",
] as const;

const READ_METHODS = new Set([
  "access",
  "accessSync",
  "createReadStream",
  "exists",
  "existsSync",
  "fstat",
  "fstatSync",
  "glob",
  "globSync",
  "lstat",
  "lstatSync",
  "openAsBlob",
  "opendir",
  "opendirSync",
  "read",
  "readDir",
  "readDirSync",
  "readFile",
  "readFileSync",
  "readLink",
  "readLinkSync",
  "readSync",
  "readTextFile",
  "readTextFileSync",
  "readv",
  "readvSync",
  "readdir",
  "readdirSync",
  "readlink",
  "readlinkSync",
  "realPath",
  "realPathSync",
  "stat",
  "statfs",
  "statfsSync",
  "statSync",
]);

const WATCH_METHODS = new Set([
  "unwatchFile",
  "watch",
  "watchFile",
  "watchFs",
]);

const WRITE_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "writeFile",
  "writeFileSync",
  "writeTextFile",
  "writeTextFileSync",
  "create",
  "createSync",
  "createWriteStream",
  "fdatasync",
  "fdatasyncSync",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "link",
  "linkSync",
  "lutimes",
  "lutimesSync",
  "makeTempDir",
  "makeTempDirSync",
  "makeTempFile",
  "makeTempFileSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "remove",
  "removeSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "utime",
  "utimeSync",
  "utimes",
  "utimesSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
]);

const FILESYSTEM_OPEN_METHODS = new Set(["open", "openSync"]);
const FILESYSTEM_MUTATING_OPEN_OPTIONS = new Set([
  "append",
  "create",
  "createNew",
  "truncate",
  "write",
]);
const READ_ONLY_NODE_OPEN_FLAGS = new Set(["r", "rs"]);

const PROCESS_METHODS = new Set([
  "Command",
  "addSignalListener",
  "spawn",
  "spawnSync",
  "exec",
  "execFile",
  "exit",
  "fork",
  "kill",
  "removeSignalListener",
  "runCommand",
]);

const PROCESS_CONSTRUCTORS = new Set(["Worker"]);
const SHARED_CWD_METHODS = new Set(["chdir", "cwd"]);

const GLOBAL_CONSTRUCTOR_EFFECTS = new Map<string, SemanticEffect>([
  ["EventSource", "network"],
  ["Worker", "process"],
  ["WebSocket", "network"],
  ["XMLHttpRequest", "network"],
]);

const NETWORK_GLOBAL_PROPERTIES = new Set([
  "EventSource",
  "WebSocket",
  "XMLHttpRequest",
  "fetch",
]);

const GLOBAL_SINGLE_PROPERTY_MUTATORS = new Set([
  "Object.defineProperty",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
  "Reflect.set",
]);

const GLOBAL_BULK_MUTATORS = new Set([
  "Object.assign",
  "Object.defineProperties",
  "Object.freeze",
  "Object.preventExtensions",
  "Object.seal",
  "Object.setPrototypeOf",
  "Reflect.preventExtensions",
  "Reflect.setPrototypeOf",
]);

const PROCESS_ENV_METHODS = new Set([
  "delete",
  "get",
  "has",
  "set",
  "toObject",
]);

const PROCESS_STATE_METHODS = new Set([
  "deleteEnv",
  "env",
  "getEnv",
  "getEnvBoolean",
  "getEnvNumber",
  "getEnvOverlayStorage",
  "getEnvString",
  "getHostEnv",
  "setEnv",
]);

const SERVER_METHODS = new Set([
  "serve",
  "listen",
  "listenTls",
  "createServer",
  "createSecureServer",
]);

const BROWSER_METHODS = new Set([
  "goto",
  "newPage",
  "launch",
  "click",
  "fill",
  "locator",
  "screenshot",
]);

const NETWORK_METHODS = new Set([
  "connect",
  "connectTls",
  "createConnection",
  "get",
  "request",
  "resolveDns",
]);

const GLOBAL_RUNTIME_RECEIVERS = new Set(["globalThis", "window", "self"]);

const CANONICAL_COMPAT_FS_SOURCE = "src/platform/compat/fs.ts";
const CANONICAL_COMPAT_PROCESS_SOURCE = "src/platform/compat/process.ts";

const GLOBAL_INTRINSIC_OBJECTS = new Set([
  "AbortController",
  "AbortSignal",
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Blob",
  "Boolean",
  "DataView",
  "Date",
  "DOMException",
  "Error",
  "EvalError",
  "Event",
  "EventTarget",
  "File",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "FormData",
  "Function",
  "Headers",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReadableStream",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Request",
  "Response",
  "Set",
  "SharedArrayBuffer",
  "String",
  "Symbol",
  "SyntaxError",
  "TextDecoder",
  "TextEncoder",
  "TransformStream",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "URIError",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "WebAssembly",
  "WritableStream",
]);

const COMMENT_KEYS = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
]);

const TYPE_ONLY_CHILD_KEYS = new Set([
  "abstract",
  "accessibility",
  "declare",
  "implements",
  "optional",
  "override",
  "returnType",
  "typeAnnotation",
  "typeArguments",
  "typeParameters",
  "typePredicate",
]);

const TYPESCRIPT_RUNTIME_NODES = new Set([
  "TSAsExpression",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSExportAssignment",
  "TSExternalModuleReference",
  "TSImportEqualsDeclaration",
  "TSInstantiationExpression",
  "TSModuleBlock",
  "TSModuleDeclaration",
  "TSNonNullExpression",
  "TSParameterProperty",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

const SCOPE_NODES = new Set([
  "Program",
  "BlockStatement",
  "CatchClause",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassDeclaration",
  "ClassExpression",
  "StaticBlock",
  "TSModuleBlock",
  "SwitchStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

interface Node {
  readonly type: string;
  readonly loc?: { readonly start: { readonly line: number } };
  readonly [key: string]: unknown;
}

interface ImportBindings {
  readonly importerPath: string;
  readonly filesystemRead: Set<string>;
  readonly filesystemWatch: Set<string>;
  readonly filesystemWrite: Set<string>;
  readonly filesystemOpen: Map<string, string>;
  readonly filesystemNamespaces: Set<string>;
  readonly sharedCwd: Set<string>;
  readonly process: Set<string>;
  readonly processNamespaces: Set<string>;
  readonly server: Set<string>;
  readonly serverNamespaces: Set<string>;
  readonly network: Set<string>;
  readonly playwright: Set<string>;
  readonly playwrightNamespaces: Set<string>;
  readonly createRequire: Set<string>;
  readonly importedNames: Set<string>;
}

type RuntimeBinding =
  | { readonly kind: "module"; readonly source: string }
  | { readonly kind: "effect"; readonly effect: SemanticEffect }
  | { readonly kind: "effect-object"; readonly effect: SemanticEffect }
  | {
    readonly kind: "namespace-object";
    readonly properties: ReadonlyMap<string, RuntimeBinding>;
  }
  | {
    readonly kind: "filesystem-open";
    readonly source: string;
    readonly boundArguments?: readonly unknown[];
  }
  | { readonly kind: "global-object" }
  | { readonly kind: "shared-object"; readonly intrinsic?: string }
  | {
    readonly kind: "mutation-method";
    readonly receiver: "Object" | "Reflect";
    readonly method: string;
  }
  | {
    readonly kind: "constructor-effect";
    readonly effect: SemanticEffect;
  }
  | {
    readonly kind: "global-runtime";
    readonly runtime: "Deno" | "process";
  }
  | { readonly kind: "create-require" };

interface Scope {
  readonly names: Set<string>;
  readonly playwrightFixtures: Set<string>;
  readonly runtimeBindings: Map<string, RuntimeBinding>;
}

export async function collectSemanticAuditCandidates(
  options: CollectSemanticAuditOptions = {},
): Promise<SemanticAuditResult> {
  const root = options.root ?? ".";
  const paths = options.paths
    ? options.paths.map(normalizeProjectPath).sort(compareOrdinal)
    : await collectUnitExecutableFiles(root);
  const consideredRoots = sortedUnique(
    paths
      .map((path) =>
        UNIT_ROOTS.find((unitRoot) => path.startsWith(`${unitRoot}/`))
      )
      .filter((root): root is typeof UNIT_ROOTS[number] => root !== undefined),
  );
  const candidates: SemanticAuditCandidate[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    try {
      const source = await Deno.readTextFile(resolveProjectPath(root, path));
      const markers = collectSemanticMarkers(source, path);
      if (markers.length > 0) candidates.push({ path, markers });
    } catch (error) {
      errors.push(
        error instanceof Error && error.name === "SyntaxError"
          ? `Unable to parse ${path}: ${error.message}`
          : error instanceof Error
          ? `${path}: ${error.message}`
          : `${path}: ${String(error)}`,
      );
    }
  }

  errors.push(
    ...validateSemanticDispositions(
      candidates,
      options.dispositions ?? TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES,
    ),
  );

  return {
    consideredFiles: paths.length,
    consideredRoots,
    candidates,
    errors,
  };
}

export function collectSemanticMarkers(
  source: string,
  file: string,
): readonly SemanticMarker[] {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy", "importAttributes"],
    });
  } catch (error) {
    throw new SyntaxError(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const program = ast.program as unknown as Node;
  const bindings = collectImportBindings(program, file);
  const markers: SemanticMarker[] = [];

  const visit = (
    node: Node,
    scopes: readonly Scope[],
    suppressMarker = false,
    allowAssignmentClearing = true,
  ): void => {
    if (isErasedTypeScriptNode(node)) return;
    const nextScopes = SCOPE_NODES.has(node.type)
      ? [...scopes, createScope(node, bindings, scopes)]
      : scopes;
    if (node.type === "VariableDeclarator") {
      const scope = nextScopes.at(-1);
      if (scope && declarationBelongsToScope(node, scope)) {
        bindRuntimeDeclaration(node, bindings, nextScopes, scope);
      }
    }
    bindRuntimeAssignment(
      node,
      bindings,
      nextScopes,
      allowAssignmentClearing,
    );
    const marker = suppressMarker
      ? undefined
      : markerForNode(node, bindings, nextScopes);
    if (marker) markers.push(marker);

    for (const key of Object.keys(node)) {
      if (
        key === "loc" || COMMENT_KEYS.has(key) ||
        TYPE_ONLY_CHILD_KEYS.has(key)
      ) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) {
            visit(
              item,
              nextScopes,
              false,
              allowAssignmentClearing && !isConditionalBranch(node, key),
            );
          }
        }
      } else if (isNode(value)) {
        visit(
          value,
          nextScopes,
          isGlobalRuntimePrefixObject(node, key, value),
          allowAssignmentClearing && !isConditionalBranch(node, key),
        );
      }
    }
  };
  visit(program, []);
  return uniqueMarkers(markers).sort((a, b) =>
    a.line - b.line || compareOrdinal(a.effect, b.effect) ||
    compareOrdinal(a.symbol, b.symbol)
  );
}

export function validateSemanticDispositions(
  candidates: readonly SemanticAuditCandidate[],
  entries: readonly SemanticDispositionEntry[],
): readonly string[] {
  const errors: string[] = [];
  const candidateByPath = new Map(candidates.map((candidate) => [
    normalizeProjectPath(candidate.path),
    candidate,
  ]));
  const seen = new Set<string>();

  for (const entry of entries) {
    const path = normalizeProjectPath(entry.path);
    errors.push(...validateSemanticDispositionShape(entry));
    if (seen.has(path)) errors.push(`duplicate semantic disposition: ${path}`);
    seen.add(path);
    const candidate = candidateByPath.get(path);
    if (!candidate) {
      errors.push(`stale semantic disposition must be removed: ${path}`);
      continue;
    }
    const entryEffects = sortedUnique(entry.effects);
    const candidateEffects = sortedUnique(
      candidate.markers.map((marker) => marker.effect),
    );
    const missingEffects = candidateEffects.filter((effect) =>
      !entryEffects.includes(effect)
    );
    const extraEffects = entryEffects.filter((effect) =>
      !candidateEffects.includes(effect)
    );
    if (missingEffects.length > 0) {
      errors.push(
        `semantic disposition missing effect(s) for ${path}: ${
          missingEffects.join(", ")
        }`,
      );
    }
    if (extraEffects.length > 0) {
      errors.push(
        `semantic disposition has stale effect(s) for ${path}: ${
          extraEffects.join(", ")
        }`,
      );
    }
  }

  for (
    const path of [...candidateByPath.keys()].sort(compareOrdinal)
  ) {
    if (!seen.has(path)) errors.push(`missing semantic disposition: ${path}`);
  }

  return errors;
}

export function validateSemanticDispositionShape(
  entry: SemanticDispositionShapeInput,
): readonly string[] {
  const path = entry.path;
  const errors: string[] = [];
  if (path.includes("\\")) {
    errors.push(`semantic disposition path must use forward slashes: ${path}`);
  } else if (!isSafeRepoRelativePath(path)) {
    errors.push(`semantic disposition path must be repo-relative: ${path}`);
  }
  if (!getExecutableTestKind(path)) {
    errors.push(
      `semantic disposition path must be an executable test: ${path}`,
    );
  }
  if (!entry.owner.trim()) {
    errors.push(`semantic disposition missing owner: ${path}`);
  }
  if (!Array.isArray(entry.effects) || entry.effects.length === 0) {
    errors.push(`semantic disposition missing effects: ${path}`);
  } else {
    const uniqueEffects = new Set(entry.effects);
    if (uniqueEffects.size !== entry.effects.length) {
      errors.push(`semantic disposition has duplicate effects: ${path}`);
    }
    if (entry.effects.some((effect) => !isEffect(effect))) {
      errors.push(`semantic disposition has invalid effects: ${path}`);
    }
  }
  if (!isDisposition(entry.disposition)) {
    errors.push(`semantic disposition has invalid disposition: ${path}`);
  }
  if (entry.disposition === "replaceable-fake") {
    if (!entry.replacement?.trim()) {
      errors.push(
        `replaceable-fake disposition missing replacement note: ${path}`,
      );
    }
    if (!entry.removalPr?.trim()) {
      errors.push(`semantic disposition missing removal PR: ${path}`);
    }
  } else if (entry.disposition === "hermetic-unit") {
    if (!entry.rationale?.trim()) {
      errors.push(`hermetic-unit disposition missing rationale: ${path}`);
    }
    const forbiddenEffects = entry.effects
      .filter(isEffect)
      .filter((effect) => effect !== "filesystem-read")
      .sort(compareOrdinal);
    if (forbiddenEffects.length > 0) {
      errors.push(
        `hermetic-unit disposition only permits filesystem-read: ${path} has ${
          forbiddenEffects.join(", ")
        }`,
      );
    }
  } else if (entry.disposition === "integration-relocation") {
    if (!entry.removalPr?.trim()) {
      errors.push(`semantic disposition missing removal PR: ${path}`);
    }
    if (!entry.destination?.trim()) {
      errors.push(
        `integration-relocation disposition missing destination: ${path}`,
      );
    } else if (
      !entry.destination.startsWith("tests/integration/") ||
      !isSafeRepoRelativePath(entry.destination) ||
      !getExecutableTestKind(entry.destination)
    ) {
      errors.push(
        `integration-relocation disposition destination must be a safe executable path under tests/integration/: ${path}`,
      );
    }
  }
  return errors;
}

export function compareSemanticDispositionBaseline(
  currentEntries: readonly SemanticDispositionEntry[],
  baseline: SemanticDispositionBaseline,
): readonly string[] {
  if (baseline.kind === "missing") return [];
  if (baseline.kind === "malformed") {
    return [
      `Semantic unit-boundary baseline at ${baseline.ref} is malformed: ${baseline.reason}`,
    ];
  }
  const baselinePaths = new Set(baseline.paths.map(normalizeProjectPath));
  const added = sortedUnique(
    currentEntries
      .map((entry) => normalizeProjectPath(entry.path))
      .filter((path) => !baselinePaths.has(path)),
  );
  const errors: string[] = [];
  if (added.length > 0) {
    errors.push(
      `Semantic unit-boundary inventory grew relative to ${baseline.ref}: ${
        added.join(", ")
      }`,
    );
  }
  const effectsByPath = baseline.effectsByPath;
  if (effectsByPath) {
    for (const entry of currentEntries) {
      const path = normalizeProjectPath(entry.path);
      const baselineEffects = effectsByPath[path];
      if (!baselineEffects) continue;
      const addedEffects = sortedUnique(entry.effects).filter((effect) =>
        !baselineEffects.includes(effect)
      );
      if (addedEffects.length > 0) {
        errors.push(
          `Semantic unit-boundary effect inventory grew relative to ${baseline.ref}: ${path} added ${
            addedEffects.join(", ")
          }`,
        );
      }
    }
  }
  return errors;
}

export function parseSemanticDispositionBaselineSource(
  source: string,
  ref: string,
): SemanticDispositionBaseline {
  let program: Node;
  try {
    program = (parse(source, {
      sourceType: "module",
      plugins: ["typescript"],
    }).program as unknown) as Node;
  } catch {
    return {
      kind: "malformed",
      ref,
      reason: "base semantic inventory is not valid TypeScript",
    };
  }

  const declarations = (Array.isArray(program.body) ? program.body : [])
    .flatMap((statement) => {
      if (
        !isNode(statement) ||
        statement.type !== "ExportNamedDeclaration" ||
        !isNode(statement.declaration) ||
        statement.declaration.type !== "VariableDeclaration"
      ) return [];
      return Array.isArray(statement.declaration.declarations)
        ? statement.declaration.declarations.filter((declaration) =>
          isNode(declaration) &&
          isNode(declaration.id) &&
          declaration.id.type === "Identifier" &&
          declaration.id.name === "TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES"
        )
        : [];
    });
  if (declarations.length !== 1) {
    return {
      kind: "malformed",
      ref,
      reason: declarations.length === 0
        ? "base semantic inventory does not export TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES"
        : "base semantic inventory exports TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES more than once",
    };
  }

  const init = declarations[0].init;
  const array = unwrapReadonlyArray(init);
  if (!array) {
    return {
      kind: "malformed",
      ref,
      reason: "base semantic inventory has no explicit executable paths",
    };
  }

  const paths: string[] = [];
  const effectsByPath: Record<string, readonly SemanticEffect[]> = {};
  for (const element of array.elements as unknown[]) {
    if (!isNode(element)) {
      return {
        kind: "malformed",
        ref,
        reason: "base semantic inventory has no explicit executable paths",
      };
    }
    const parsed = parseBaselineEntry(element);
    if (!parsed) {
      return {
        kind: "malformed",
        ref,
        reason: "base semantic inventory has no explicit executable paths",
      };
    }
    const { path, effects } = parsed;
    effectsByPath[path] = sortedUnique(effects) as SemanticEffect[];
    paths.push(path);
  }

  return { kind: "paths", ref, paths: sortedUnique(paths), effectsByPath };
}

function parseBaselineEntry(
  element: Node,
):
  | { readonly path: string; readonly effects: readonly SemanticEffect[] }
  | undefined {
  if (
    element.type === "CallExpression" &&
    isNode(element.callee) &&
    element.callee.type === "Identifier" &&
    element.callee.name === "entry" &&
    Array.isArray(element.arguments) &&
    isNode(element.arguments[0]) &&
    element.arguments[0].type === "StringLiteral" &&
    isNode(element.arguments[1]) &&
    element.arguments[1].type === "ArrayExpression"
  ) {
    const path = normalizeProjectPath(element.arguments[0].value as string);
    const effects = parseEffectArray(element.arguments[1]);
    if (!getExecutableTestKind(path) || !effects) return undefined;
    return { path, effects };
  }

  if (element.type !== "ObjectExpression") return undefined;
  const pathProperty =
    (Array.isArray(element.properties) ? element.properties : []).find((
      property,
    ) =>
      isNode(property) &&
      property.type === "ObjectProperty" &&
      !property.computed &&
      ((isNode(property.key) && property.key.type === "Identifier" &&
        property.key.name === "path") ||
        (isNode(property.key) && property.key.type === "StringLiteral" &&
          property.key.value === "path"))
    );
  if (
    !isNode(pathProperty) || !isNode(pathProperty.value) ||
    pathProperty.value.type !== "StringLiteral"
  ) {
    return undefined;
  }
  const path = normalizeProjectPath(pathProperty.value.value as string);
  const effectsProperty =
    (Array.isArray(element.properties) ? element.properties : []).find((
      property,
    ) =>
      isNode(property) &&
      property.type === "ObjectProperty" &&
      !property.computed &&
      isNode(property.key) &&
      property.key.type === "Identifier" &&
      property.key.name === "effects"
    );
  if (
    !isNode(effectsProperty) || !isNode(effectsProperty.value) ||
    effectsProperty.value.type !== "ArrayExpression"
  ) {
    return undefined;
  }
  const effects = parseEffectArray(effectsProperty.value);
  if (!getExecutableTestKind(path) || !effects) return undefined;
  return { path, effects };
}

function parseEffectArray(value: Node): readonly SemanticEffect[] | undefined {
  const effects: SemanticEffect[] = [];
  for (
    const effectElement of Array.isArray(value.elements) ? value.elements : []
  ) {
    if (
      !isNode(effectElement) || effectElement.type !== "StringLiteral" ||
      !isEffect(effectElement.value)
    ) {
      return undefined;
    }
    effects.push(effectElement.value);
  }
  return effects;
}

async function collectUnitExecutableFiles(root: string): Promise<string[]> {
  const discovery = await discoverTests({ root });
  if (discovery.violations.length > 0) {
    throw new Error(
      discovery.violations.map((violation) =>
        `${violation.path}: ${violation.reason}`
      ).join("\n"),
    );
  }
  return discovery.inventory
    .filter(isCanonicalUnitRootEntry)
    .map((entry) => entry.path)
    .sort(compareOrdinal);
}

function isCanonicalUnitRootEntry(entry: TestLayoutInventoryEntry): boolean {
  return entry.level === "unit" &&
    entry.kind === "canonical" &&
    UNIT_ROOTS.some((root) => entry.path.startsWith(`${root}/`));
}

function markerForNode(
  node: Node,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | undefined {
  const line = node.loc?.start.line ?? 0;
  if (node.type === "ImportDeclaration") {
    const source = literalValue(node.source);
    if (
      source && isPlaywrightSpecifier(source) &&
      importHasRuntimeValue(node)
    ) {
      return {
        effect: "browser",
        line: node.loc?.start.line ?? 0,
        symbol: source,
      };
    }
  }

  const globalPropertyMutation = globalPropertyMutationMarker(
    node,
    line,
    scopes,
    bindings,
  );
  if (globalPropertyMutation) return globalPropertyMutation;

  const processGlobal = processGlobalMarker(
    node,
    line,
    scopes,
    bindings.importedNames,
  );
  if (processGlobal) return processGlobal;

  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const runtimeMarker = memberRuntimeEffectMarker(
      node,
      line,
      bindings,
      scopes,
    );
    const objectName = memberObjectName(node);
    const effectObject = objectName
      ? resolveLocalBinding(objectName, scopes).binding?.kind ===
        "effect-object"
      : false;
    if (
      runtimeMarker &&
      (memberProperty(node) === "env" || effectObject ||
        isProcessModuleEnvDetail(node, bindings, scopes))
    ) {
      return runtimeMarker;
    }
  }

  if (node.type === "AssignmentExpression" && isNode(node.left)) {
    const globalMarker = globalRuntimeMemberMutationMarker(
      node.left,
      line,
      scopes,
      bindings.importedNames,
    );
    if (globalMarker) return globalMarker;
    return memberRuntimeEffectMarker(node.left, line, bindings, scopes);
  }

  if (node.type === "UpdateExpression" && isNode(node.argument)) {
    return globalRuntimeMemberMutationMarker(
      node.argument,
      line,
      scopes,
      bindings.importedNames,
    );
  }

  if (
    node.type !== "CallExpression" && node.type !== "OptionalCallExpression" &&
    node.type !== "NewExpression"
  ) {
    return undefined;
  }
  const callee = unwrapExpression(node.callee);
  if (!isNode(callee)) return undefined;

  const filesystemOpen = filesystemOpenMarker(
    node,
    callee,
    line,
    bindings,
    scopes,
  );
  if (filesystemOpen) return filesystemOpen;

  if (isCallLikeExpression(callee)) {
    return runtimeInvocationMarker(node, callee, line, bindings, scopes);
  }

  if (callee.type === "Identifier") {
    const name = callee.name as string;
    const local = resolveLocalBinding(name, scopes);
    if (local.declared) {
      if (local.binding?.kind === "effect") {
        return { effect: local.binding.effect, line, symbol: name };
      }
      if (
        node.type === "NewExpression" &&
        local.binding?.kind === "constructor-effect"
      ) {
        return { effect: local.binding.effect, line, symbol: name };
      }
      return undefined;
    }
    if (bindings.filesystemRead.has(name) && !isShadowed(name, scopes)) {
      return { effect: "filesystem-read", line, symbol: name };
    }
    if (bindings.filesystemWatch.has(name) && !isShadowed(name, scopes)) {
      return { effect: "filesystem-watch", line, symbol: name };
    }
    if (bindings.filesystemWrite.has(name) && !isShadowed(name, scopes)) {
      return { effect: "filesystem-write", line, symbol: name };
    }
    if (bindings.sharedCwd.has(name) && !isShadowed(name, scopes)) {
      return { effect: "shared-cwd", line, symbol: name };
    }
    if (bindings.process.has(name) && !isShadowed(name, scopes)) {
      return { effect: "process", line, symbol: name };
    }
    if (bindings.server.has(name) && !isShadowed(name, scopes)) {
      return { effect: "server", line, symbol: name };
    }
    if (bindings.network.has(name) && !isShadowed(name, scopes)) {
      return { effect: "network", line, symbol: name };
    }
    if (
      name === "fetch" && !bindings.importedNames.has("fetch") &&
      !isShadowed("fetch", scopes)
    ) {
      return { effect: "network", line, symbol: "fetch" };
    }
    const constructorEffect = GLOBAL_CONSTRUCTOR_EFFECTS.get(name);
    if (
      node.type === "NewExpression" && constructorEffect &&
      !isGlobalShadowed(name, scopes, bindings.importedNames)
    ) {
      return { effect: constructorEffect, line, symbol: name };
    }
    return undefined;
  }

  if (
    callee.type !== "MemberExpression" &&
    callee.type !== "OptionalMemberExpression"
  ) return undefined;
  const runtimeMarker = memberRuntimeEffectMarker(
    callee,
    line,
    bindings,
    scopes,
  );
  if (runtimeMarker) return runtimeMarker;
  const method = memberProperty(callee);
  const objectName = memberObjectName(callee);
  if (!method || !objectName) {
    return runtimeInvocationMarker(node, callee, line, bindings, scopes);
  }

  const constructorEffect = GLOBAL_CONSTRUCTOR_EFFECTS.get(method);
  if (
    node.type === "NewExpression" && constructorEffect &&
    isGlobalRuntimeReceiver(
      objectName,
      scopes,
      bindings.importedNames,
    )
  ) {
    return {
      effect: constructorEffect,
      line,
      symbol: `${objectName}.${method}`,
    };
  }

  const fetchMarker = globalFetchMarker(
    callee,
    line,
    scopes,
    bindings.importedNames,
  );
  if (fetchMarker) return fetchMarker;

  if (isPlaywrightFixture(objectName, scopes) && BROWSER_METHODS.has(method)) {
    return { effect: "browser", line, symbol: `${objectName}.${method}` };
  }

  if (resolveLocalBinding(objectName, scopes).declared) {
    return node.type === "NewExpression"
      ? runtimeInvocationMarker(node, callee, line, bindings, scopes)
      : undefined;
  }

  if (
    objectName === "Deno" &&
    !isGlobalShadowed("Deno", scopes, bindings.importedNames)
  ) {
    if (WATCH_METHODS.has(method)) {
      return { effect: "filesystem-watch", line, symbol: `Deno.${method}` };
    }
    if (READ_METHODS.has(method)) {
      return { effect: "filesystem-read", line, symbol: `Deno.${method}` };
    }
    if (WRITE_METHODS.has(method)) {
      return { effect: "filesystem-write", line, symbol: `Deno.${method}` };
    }
    if (PROCESS_METHODS.has(method)) {
      return { effect: "process", line, symbol: `Deno.${method}` };
    }
    if (SERVER_METHODS.has(method)) {
      return { effect: "server", line, symbol: `Deno.${method}` };
    }
    if (NETWORK_METHODS.has(method)) {
      return { effect: "network", line, symbol: `Deno.${method}` };
    }
    if (SHARED_CWD_METHODS.has(method)) {
      return { effect: "shared-cwd", line, symbol: `Deno.${method}` };
    }
  }

  if (
    bindings.filesystemNamespaces.has(objectName) &&
    !isShadowed(objectName, scopes)
  ) {
    if (WATCH_METHODS.has(method)) {
      return {
        effect: "filesystem-watch",
        line,
        symbol: `${objectName}.${method}`,
      };
    }
    if (READ_METHODS.has(method)) {
      return {
        effect: "filesystem-read",
        line,
        symbol: `${objectName}.${method}`,
      };
    }
    if (WRITE_METHODS.has(method)) {
      return {
        effect: "filesystem-write",
        line,
        symbol: `${objectName}.${method}`,
      };
    }
  }
  if (
    bindings.processNamespaces.has(objectName) &&
    !isShadowed(objectName, scopes)
  ) {
    if (SHARED_CWD_METHODS.has(method)) {
      return {
        effect: "shared-cwd",
        line,
        symbol: `${objectName}.${method}`,
      };
    }
    if (isProcessEffectMethod(method)) {
      return { effect: "process", line, symbol: `${objectName}.${method}` };
    }
  }
  if (
    bindings.serverNamespaces.has(objectName) &&
    !isShadowed(objectName, scopes)
  ) {
    if (SERVER_METHODS.has(method)) {
      return { effect: "server", line, symbol: `${objectName}.${method}` };
    }
    if (NETWORK_METHODS.has(method)) {
      return { effect: "network", line, symbol: `${objectName}.${method}` };
    }
  }
  return runtimeInvocationMarker(node, callee, line, bindings, scopes);
}

function memberRuntimeEffectMarker(
  member: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | undefined {
  if (
    member.type !== "MemberExpression" &&
    member.type !== "OptionalMemberExpression"
  ) return undefined;
  const chain = memberChain(member);
  if (isGlobalProcessEnvDetailChain(chain, imports, scopes)) return undefined;
  const binding = runtimeBindingForExpression(member, imports, scopes);
  if (binding?.kind === "effect") {
    return {
      effect: binding.effect,
      line,
      symbol: chain?.join(".") ?? invocationSymbol(member),
    };
  }
  const method = memberProperty(member);
  const objectName = memberObjectName(member);
  if (!method || !objectName) return undefined;
  const resolved = resolveLocalBinding(objectName, scopes);
  const effect = resolved.binding?.kind === "module"
    ? effectForModuleMethod(resolved.binding.source, method)
    : resolved.binding?.kind === "global-runtime"
    ? effectForGlobalRuntimeMethod(resolved.binding.runtime, method)
    : resolved.binding?.kind === "effect-object"
    ? resolved.binding.effect
    : undefined;
  return effect
    ? { effect, line, symbol: `${objectName}.${method}` }
    : undefined;
}

function isProcessModuleEnvDetail(
  member: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  const chain = memberChain(member);
  return chain !== undefined &&
    chain.length > 2 &&
    chain[1] === "env" &&
    moduleSourceForIdentifier(chain[0], imports, scopes) !== undefined &&
    isProcessSpecifier(moduleSourceForIdentifier(chain[0], imports, scopes)!);
}

function filesystemOpenMarker(
  node: Node,
  callee: Node,
  line: number,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | undefined {
  if (!isCallLikeExpression(node)) return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const invocation = filesystemOpenInvocation(callee, args, bindings, scopes);
  if (!invocation) return undefined;
  return {
    effect: filesystemOpenEffect(invocation.options),
    line,
    symbol: invocationSymbol(callee),
  };
}

function filesystemOpenInvocation(
  callee: Node,
  args: readonly unknown[],
  bindings: ImportBindings,
  scopes: readonly Scope[],
):
  | {
    readonly binding: Extract<
      RuntimeBinding,
      { readonly kind: "filesystem-open" }
    >;
    readonly options: unknown;
  }
  | undefined {
  const binding = filesystemOpenBinding(callee, bindings, scopes);
  if (binding) {
    return {
      binding,
      options: filesystemOpenOptions(binding, args),
    };
  }
  const callableBinding = callableMethodInvocationBinding(
    callee,
    bindings,
    scopes,
  );
  if (callableBinding?.kind !== "filesystem-open") return undefined;
  const method = memberProperty(callee);
  const invocationArguments = method === "apply"
    ? filesystemOpenApplyArguments(args[1])
    : args.slice(1);
  return {
    binding: callableBinding,
    options: filesystemOpenOptions(callableBinding, invocationArguments),
  };
}

function filesystemOpenOptions(
  binding: Extract<RuntimeBinding, { readonly kind: "filesystem-open" }>,
  invocationArguments: readonly unknown[],
): unknown {
  const args = [...binding.boundArguments ?? [], ...invocationArguments];
  return args.slice(0, 2).some((argument) =>
      isNode(argument) && argument.type === "SpreadElement"
    )
    ? { type: "Identifier", name: "unknownOpenOptions" }
    : args[1];
}

function filesystemOpenBinding(
  callee: Node,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): Extract<RuntimeBinding, { readonly kind: "filesystem-open" }> | undefined {
  const binding = runtimeBindingForExpression(callee, bindings, scopes);
  return binding?.kind === "filesystem-open" ? binding : undefined;
}

function runtimeInvocationMarker(
  node: Node,
  callee: Node,
  line: number,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | undefined {
  const chain = memberChain(callee);
  if (
    chain?.length === 3 && chain[0] === "Deno" && chain[1] === "env" &&
    PROCESS_ENV_METHODS.has(chain[2])
  ) {
    return undefined;
  }
  const binding = runtimeBindingForExpression(callee, bindings, scopes);
  if (binding?.kind === "effect") {
    return {
      effect: binding.effect,
      line,
      symbol: invocationSymbol(callee),
    };
  }
  const callableBinding = callableMethodInvocationBinding(
    callee,
    bindings,
    scopes,
  );
  if (callableBinding?.kind === "effect") {
    return {
      effect: callableBinding.effect,
      line,
      symbol: invocationSymbol(callee),
    };
  }
  if (
    node.type === "NewExpression" &&
    binding?.kind === "constructor-effect"
  ) {
    return {
      effect: binding.effect,
      line,
      symbol: invocationSymbol(callee),
    };
  }
  return undefined;
}

function callableMethodInvocationBinding(
  callee: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (
    callee.type !== "MemberExpression" &&
    callee.type !== "OptionalMemberExpression"
  ) return undefined;
  const method = memberProperty(callee);
  if (method !== "call" && method !== "apply") return undefined;
  const binding = runtimeBindingForExpression(callee.object, imports, scopes);
  return isCallableRuntimeBinding(binding) ? binding : undefined;
}

function isCallableRuntimeBinding(
  binding: RuntimeBinding | undefined,
): binding is Extract<
  RuntimeBinding,
  { readonly kind: "effect" | "filesystem-open" }
> {
  return binding?.kind === "effect" || binding?.kind === "filesystem-open";
}

function invocationSymbol(callee: Node): string {
  if (isCallLikeExpression(callee) && isNode(callee.callee)) {
    return invocationSymbol(callee.callee);
  }
  return memberChain(callee)?.join(".") ??
    (callee.type === "Identifier" ? callee.name as string : undefined) ??
    memberProperty(callee) ?? "runtime effect";
}

function filesystemOpenEffect(options: unknown): SemanticEffect {
  const value = unwrapExpression(options);
  if (!value) return "filesystem-read";
  if (value.type === "StringLiteral") {
    return READ_ONLY_NODE_OPEN_FLAGS.has(value.value as string)
      ? "filesystem-read"
      : "filesystem-write";
  }
  if (value.type !== "ObjectExpression") return "filesystem-write";
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property) || property.type !== "ObjectProperty") {
      return "filesystem-write";
    }
    const key = isNode(property.key)
      ? property.key.type === "Identifier" && property.computed !== true
        ? property.key.name as string
        : literalValue(property.key)
      : undefined;
    if (!key) {
      if (property.computed === true) return "filesystem-write";
      continue;
    }
    if (!FILESYSTEM_MUTATING_OPEN_OPTIONS.has(key)) continue;
    const option = unwrapExpression(property.value);
    if (!option || option.type !== "BooleanLiteral" || option.value !== false) {
      return "filesystem-write";
    }
  }
  return "filesystem-read";
}

function filesystemOpenApplyArguments(args: unknown): readonly unknown[] {
  const value = unwrapExpression(args);
  if (!value || value.type !== "ArrayExpression") {
    return [
      { type: "Identifier", name: "unknownOpenPath" },
      { type: "Identifier", name: "unknownOpenOptions" },
    ];
  }
  return Array.isArray(value.elements) ? value.elements : [];
}

function globalPropertyMutationMarker(
  node: Node,
  line: number,
  scopes: readonly Scope[],
  imports: ImportBindings,
): SemanticMarker | undefined {
  if (
    node.type === "UnaryExpression" && node.operator === "delete" &&
    isNode(node.argument)
  ) {
    return globalRuntimeMemberMutationMarker(
      node.argument,
      line,
      scopes,
      imports.importedNames,
    );
  }
  if (!isCallLikeExpression(node) || !isNode(node.callee)) return undefined;
  const binding = runtimeBindingForExpression(node.callee, imports, scopes);
  if (binding?.kind !== "mutation-method") return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const calleeName = node.callee.type === "Identifier"
    ? node.callee.name as string
    : memberChain(node.callee)?.join(".") ?? binding.method;
  return mutationCallMarker(
    binding,
    calleeName,
    args,
    line,
    scopes,
    imports.importedNames,
  );
}

function mutationMethodBinding(
  receiver: string,
  method: string,
): Extract<RuntimeBinding, { readonly kind: "mutation-method" }> | undefined {
  if (receiver !== "Object" && receiver !== "Reflect") return undefined;
  const calleeName = `${receiver}.${method}`;
  return GLOBAL_SINGLE_PROPERTY_MUTATORS.has(calleeName) ||
      GLOBAL_BULK_MUTATORS.has(calleeName)
    ? { kind: "mutation-method", receiver, method }
    : undefined;
}

function mutationCallMarker(
  binding: Extract<RuntimeBinding, { readonly kind: "mutation-method" }>,
  calleeName: string,
  args: readonly unknown[],
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  const canonicalName = `${binding.receiver}.${binding.method}`;
  const mutatesSingleProperty = GLOBAL_SINGLE_PROPERTY_MUTATORS.has(
    canonicalName,
  );
  const target = sharedGlobalMutationTarget(
    args[0],
    scopes,
    importedNames,
  );
  const property = mutatesSingleProperty ? literalValue(args[1]) : undefined;
  if (!target) return undefined;
  return {
    effect: mutatesSingleProperty && target.kind === "runtime-root"
      ? globalRuntimeMutationEffect(property)
      : "process",
    line,
    symbol: `${calleeName}(${target.symbol}.${property ?? "*"})`,
  };
}

function sharedGlobalMutationTarget(
  target: unknown,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
):
  | { readonly kind: "runtime-root" | "shared-object"; readonly symbol: string }
  | undefined {
  const value = unwrapExpression(target);
  if (!value) return undefined;
  if (value.type === "Identifier") {
    const name = value.name as string;
    const resolved = resolveLocalBinding(name, scopes);
    if (isGlobalRuntimeReceiver(name, scopes, importedNames)) {
      return { kind: "runtime-root", symbol: name };
    }
    const isSharedObject = resolved.binding?.kind === "shared-object" ||
      isGlobalRuntimeObject(name, scopes, importedNames) ||
      isGlobalIntrinsic(name, scopes, importedNames);
    return isSharedObject ? { kind: "shared-object", symbol: name } : undefined;
  }
  if (
    value.type !== "MemberExpression" &&
    value.type !== "OptionalMemberExpression"
  ) {
    return undefined;
  }
  const chain = memberChain(value);
  if (!chain || chain.length < 2) return undefined;
  const root = resolveLocalBinding(chain[0], scopes);
  if (
    root.binding?.kind === "shared-object" ||
    isGlobalRuntimeReceiver(chain[0], scopes, importedNames) ||
    isGlobalIntrinsic(chain[0], scopes, importedNames)
  ) {
    return { kind: "shared-object", symbol: chain.join(".") };
  }
  return undefined;
}

function isGlobalRuntimeObject(
  name: string,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): boolean {
  const resolved = resolveLocalBinding(name, scopes);
  if (resolved.binding?.kind === "global-runtime") return true;
  return (name === "Deno" || name === "process") &&
    !resolved.declared && !importedNames.has(name);
}

function isGlobalIntrinsic(
  name: string,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): boolean {
  return GLOBAL_INTRINSIC_OBJECTS.has(name) &&
    !isGlobalShadowed(name, scopes, importedNames);
}

function globalRuntimeMemberMutationMarker(
  member: Node,
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  const value = unwrapExpression(member);
  if (
    !value ||
    (value.type !== "MemberExpression" &&
      value.type !== "OptionalMemberExpression")
  ) {
    return undefined;
  }
  const chain = memberChain(value);
  const target = isNode(value.object)
    ? sharedGlobalMutationTarget(value.object, scopes, importedNames)
    : undefined;
  if (!target) return undefined;
  const property = memberProperty(value);
  return {
    effect: target.kind === "runtime-root"
      ? globalRuntimeMutationEffect(property)
      : "process",
    line,
    symbol: chain?.join(".") ?? `${target.symbol}.${property ?? "*"}`,
  };
}

function globalRuntimeMutationEffect(
  property: string | undefined,
): SemanticEffect {
  return property && NETWORK_GLOBAL_PROPERTIES.has(property)
    ? "network"
    : "process";
}

function isGlobalProcessEnvDetailChain(
  chain: readonly string[] | undefined,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  if (chain === undefined || chain.length <= 2 || chain[1] !== "env") {
    return false;
  }
  if (chain[0] === "Deno" || chain[0] === "process") return true;
  const root = runtimeBindingForExpression(
    { type: "Identifier", name: chain[0] },
    imports,
    scopes,
  );
  return root?.kind === "global-runtime";
}

function processGlobalMarker(
  node: Node,
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const chain = memberChain(node);
    if (
      chain?.[0] === "Deno" && chain[1] === "env" &&
      (chain.length === 2 || PROCESS_ENV_METHODS.has(chain[2])) &&
      !isGlobalShadowed("Deno", scopes, importedNames)
    ) {
      return { effect: "process", line, symbol: "Deno.env" };
    }
    if (
      chain?.[0] === "process" && chain[1] === "env" &&
      !isGlobalShadowed("process", scopes, importedNames)
    ) {
      return { effect: "process", line, symbol: "process.env" };
    }
    if (
      chain?.length === 2 &&
      chain[0] === "globalThis" &&
      (chain[1] === "process" || chain[1] === "Deno") &&
      !isGlobalShadowed("globalThis", scopes, importedNames)
    ) {
      return {
        effect: "process",
        line,
        symbol: `globalThis.${chain[1]}`,
      };
    }
    if (
      chain?.length === 2 &&
      (chain[0] === "Deno" || chain[0] === "process") &&
      SHARED_CWD_METHODS.has(chain[1]) &&
      !isGlobalShadowed(chain[0], scopes, importedNames)
    ) {
      return {
        effect: "shared-cwd",
        line,
        symbol: `${chain[0]}.${chain[1]}`,
      };
    }
    if (
      chain?.length === 2 && chain[0] === "Deno" &&
      PROCESS_METHODS.has(chain[1]) &&
      !isGlobalShadowed("Deno", scopes, importedNames)
    ) {
      return { effect: "process", line, symbol: `Deno.${chain[1]}` };
    }
    if (
      chain?.length === 2 && chain[0] === "process" &&
      isProcessEffectMethod(chain[1]) &&
      !isGlobalShadowed("process", scopes, importedNames)
    ) {
      return { effect: "process", line, symbol: `process.${chain[1]}` };
    }
  }

  if (!isCallLikeExpression(node) || !isNode(node.callee)) {
    return undefined;
  }
  const callee = memberChain(node.callee);
  if (
    callee?.length === 2 &&
    (callee[0] === "Deno" || callee[0] === "process") &&
    SHARED_CWD_METHODS.has(callee[1]) &&
    !isGlobalShadowed(callee[0], scopes, importedNames)
  ) {
    return {
      effect: "shared-cwd",
      line,
      symbol: `${callee[0]}.${callee[1]}`,
    };
  }
  if (
    callee?.length === 2 && callee[0] === "process" &&
    isProcessEffectMethod(callee[1]) &&
    !isGlobalShadowed("process", scopes, importedNames)
  ) {
    return { effect: "process", line, symbol: `process.${callee[1]}` };
  }
  return undefined;
}

function globalFetchMarker(
  member: Node,
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  if (
    (member.type !== "MemberExpression" &&
      member.type !== "OptionalMemberExpression") ||
    memberProperty(member) !== "fetch"
  ) {
    return undefined;
  }
  const receiver = memberObjectName(member);
  if (
    !receiver ||
    !isGlobalRuntimeReceiver(receiver, scopes, importedNames)
  ) {
    return undefined;
  }
  return { effect: "network", line, symbol: `${receiver}.fetch` };
}

function collectImportBindings(program: Node, file: string): ImportBindings {
  const bindings: ImportBindings = {
    importerPath: file,
    filesystemRead: new Set(),
    filesystemWatch: new Set(),
    filesystemWrite: new Set(),
    filesystemOpen: new Map(),
    filesystemNamespaces: new Set(),
    sharedCwd: new Set(),
    process: new Set(),
    processNamespaces: new Set(),
    server: new Set(),
    serverNamespaces: new Set(),
    network: new Set(),
    playwright: new Set(),
    playwrightNamespaces: new Set(),
    createRequire: new Set(),
    importedNames: new Set(),
  };
  const body = Array.isArray(program.body) ? program.body : [];
  for (const statement of body) {
    if (!isNode(statement)) continue;
    if (statement.type === "TSImportEqualsDeclaration") {
      const reference = isNode(statement.moduleReference)
        ? statement.moduleReference
        : undefined;
      const literalSource = reference?.type === "TSExternalModuleReference"
        ? literalValue(reference.expression)
        : undefined;
      const source = literalSource
        ? normalizeImportSource(literalSource, file)
        : undefined;
      if (
        statement.importKind !== "type" && source && isNode(statement.id) &&
        statement.id.type === "Identifier"
      ) {
        addRuntimeNamespaceImport(
          bindings,
          statement.id.name as string,
          source,
        );
      }
      continue;
    }
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    const literalSource = literalValue(statement.source);
    if (!literalSource) continue;
    const source = normalizeImportSource(literalSource, file);
    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers
      : [];
    for (const specifier of specifiers) {
      if (!isNode(specifier) || !isNode(specifier.local)) continue;
      if (specifier.importKind === "type") continue;
      const local = specifier.local.name as string;
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      ) {
        addRuntimeNamespaceImport(bindings, local, source);
        continue;
      }
      bindings.importedNames.add(local);
      const importedName =
        isNode(specifier.imported) && specifier.imported.type === "Identifier"
          ? specifier.imported.name as string
          : local;
      if (isFilesystemSpecifier(source)) {
        if (FILESYSTEM_OPEN_METHODS.has(importedName)) {
          bindings.filesystemOpen.set(local, source);
        } else if (WATCH_METHODS.has(importedName)) {
          bindings.filesystemWatch.add(local);
        } else if (READ_METHODS.has(importedName)) {
          bindings.filesystemRead.add(local);
        } else if (WRITE_METHODS.has(importedName)) {
          bindings.filesystemWrite.add(local);
        }
      }
      if (isProcessSpecifier(source)) {
        if (SHARED_CWD_METHODS.has(importedName)) {
          bindings.sharedCwd.add(local);
        } else if (isProcessEffectMethod(importedName)) {
          bindings.process.add(local);
        }
      }
      if (isServerSpecifier(source) && SERVER_METHODS.has(importedName)) {
        bindings.server.add(local);
      }
      if (isServerSpecifier(source) && NETWORK_METHODS.has(importedName)) {
        bindings.network.add(local);
      }
      if (isPlaywrightSpecifier(source)) bindings.playwright.add(local);
      if (
        isCreateRequireSpecifier(source) && importedName === "createRequire"
      ) {
        bindings.createRequire.add(local);
      }
    }
  }
  return bindings;
}

function addRuntimeNamespaceImport(
  bindings: ImportBindings,
  local: string,
  source: string,
): void {
  bindings.importedNames.add(local);
  if (isFilesystemSpecifier(source)) bindings.filesystemNamespaces.add(local);
  if (isProcessSpecifier(source)) bindings.processNamespaces.add(local);
  if (isServerSpecifier(source)) bindings.serverNamespaces.add(local);
  if (isPlaywrightSpecifier(source)) bindings.playwrightNamespaces.add(local);
}

function normalizeImportSource(source: string, importerPath: string): string {
  if (!source.startsWith(".")) return source;
  return canonicalCompatSource(
    normalizeRepoRelativeImportPath(importerPath, source),
  );
}

function normalizeRepoRelativeImportPath(
  importerPath: string,
  source: string,
): string {
  const importerSegments = normalizeProjectPath(importerPath).split("/");
  importerSegments.pop();
  const stack: string[] = [];
  for (const segment of [...importerSegments, ...source.split("/")]) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0 || stack.at(-1) === "..") stack.push(segment);
      else stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}

function canonicalCompatSource(source: string): string {
  const normalized = normalizeProjectPath(source);
  const pathBase = normalized.replace(/\.(?:c|m)?[jt]sx?$/, "");
  if (pathBase === "src/platform/compat/fs") {
    return CANONICAL_COMPAT_FS_SOURCE;
  }
  if (pathBase === "src/platform/compat/process") {
    return CANONICAL_COMPAT_PROCESS_SOURCE;
  }
  return normalized;
}

function createScope(
  node: Node,
  imports: ImportBindings,
  outerScopes: readonly Scope[],
): Scope {
  const names = new Set<string>();
  const playwrightFixtures = new Set<string>();
  collectLocalDeclaredNames(node, names, playwrightFixtures);
  if (isVarHoistScope(node)) collectHoistedVarDeclaredNames(node, names);
  const scope: Scope = {
    names,
    playwrightFixtures,
    runtimeBindings: new Map(),
  };
  collectLocalRuntimeBindings(node, imports, [...outerScopes, scope]);
  if (isVarHoistScope(node)) {
    collectHoistedVarRuntimeBindings(
      node,
      imports,
      [...outerScopes, scope],
      scope,
    );
  }
  collectRuntimeParameterDefaults(
    node,
    imports,
    [...outerScopes, scope],
    scope,
  );
  return scope;
}

function collectLocalDeclaredNames(
  node: Node,
  names: Set<string>,
  playwrightFixtures: Set<string>,
): void {
  const statements = lexicalScopeStatements(node);
  if (statements) {
    for (const child of statements) {
      if (!isNode(child)) continue;
      const statement = unwrapExportDeclaration(child);
      if (
        (statement.type === "FunctionDeclaration" ||
          statement.type === "ClassDeclaration") && isNode(statement.id)
      ) {
        names.add(statement.id.name as string);
      }
      if (
        statement.type === "TSModuleDeclaration" &&
        isNode(statement.id) && statement.id.type === "Identifier"
      ) {
        names.add(statement.id.name as string);
      }
      if (
        statement.type === "TSImportEqualsDeclaration" &&
        statement.importKind !== "type" && isNode(statement.id) &&
        statement.id.type === "Identifier"
      ) {
        names.add(statement.id.name as string);
      }
      if (statement.type === "VariableDeclaration") {
        if (statement.kind === "var") continue;
        for (
          const declaration of Array.isArray(statement.declarations)
            ? statement.declarations
            : []
        ) {
          if (isNode(declaration)) collectPatternNames(declaration.id, names);
        }
      }
    }
    return;
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  ) {
    if (node.type === "FunctionExpression" && isNode(node.id)) {
      names.add(node.id.name as string);
    }
    for (const param of Array.isArray(node.params) ? node.params : []) {
      collectPatternNames(param, names);
      collectPlaywrightFixtureNames(param, playwrightFixtures);
    }
    return;
  }
  if (
    (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
    isNode(node.id)
  ) {
    names.add(node.id.name as string);
    return;
  }
  if (
    node.type === "ForStatement" || node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const declaration = node.type === "ForStatement" ? node.init : node.left;
    if (isNode(declaration) && declaration.type === "VariableDeclaration") {
      if (declaration.kind === "var") return;
      for (
        const declarator of Array.isArray(declaration.declarations)
          ? declaration.declarations
          : []
      ) {
        if (isNode(declarator)) collectPatternNames(declarator.id, names);
      }
    }
    return;
  }
  if (node.type === "CatchClause") collectPatternNames(node.param, names);
}

function collectLocalRuntimeBindings(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): void {
  const statements = lexicalScopeStatements(node);
  if (!statements) return;
  const scope = scopes.at(-1);
  if (!scope) return;

  for (const statement of statements) {
    if (!isNode(statement)) continue;
    const declaration = unwrapExportDeclaration(statement);
    if (declaration.type === "TSModuleDeclaration") {
      bindRuntimeNamespaceDeclaration(declaration, imports, scopes, scope);
      continue;
    }
    if (declaration.type === "TSImportEqualsDeclaration") {
      bindRuntimeImportEqualsDeclaration(declaration, imports, scopes, scope);
      continue;
    }
    if (declaration.type !== "VariableDeclaration") {
      continue;
    }
    if (declaration.kind === "var") continue;
    for (
      const declarator of Array.isArray(declaration.declarations)
        ? declaration.declarations
        : []
    ) {
      if (!isNode(declarator)) continue;
      bindRuntimeDeclaration(declarator, imports, scopes, scope);
    }
  }
}

function isVarHoistScope(node: Node): boolean {
  return node.type === "Program" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock";
}

function collectHoistedVarDeclaredNames(
  node: Node,
  names: Set<string>,
): void {
  visitVarHoistDeclarations(node, (declaration) => {
    for (
      const declarator of Array.isArray(declaration.declarations)
        ? declaration.declarations
        : []
    ) {
      if (isNode(declarator)) collectPatternNames(declarator.id, names);
    }
  });
}

function collectHoistedVarRuntimeBindings(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  visitVarHoistDeclarations(node, (declaration) => {
    for (
      const declarator of Array.isArray(declaration.declarations)
        ? declaration.declarations
        : []
    ) {
      if (isNode(declarator)) {
        bindRuntimeDeclaration(declarator, imports, scopes, scope);
      }
    }
  });
}

function visitVarHoistDeclarations(
  node: Node,
  visitor: (declaration: Node) => void,
): void {
  const visit = (current: unknown, isRoot = false): void => {
    if (!isNode(current)) return;
    if (!isRoot && isVarHoistBoundary(current)) return;
    if (current.type === "VariableDeclaration" && current.kind === "var") {
      visitor(current);
      return;
    }
    for (const key of Object.keys(current)) {
      if (
        key === "loc" || COMMENT_KEYS.has(key) ||
        TYPE_ONLY_CHILD_KEYS.has(key)
      ) continue;
      const value = current[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else {
        visit(value);
      }
    }
  };
  visit(node, true);
}

function isVarHoistBoundary(node: Node): boolean {
  return node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock" ||
    node.type === "TSModuleDeclaration";
}

function declarationBelongsToScope(
  declaration: Node,
  scope: Scope,
): boolean {
  const names = new Set<string>();
  collectPatternNames(declaration.id, names);
  for (const name of names) {
    if (scope.names.has(name)) return true;
  }
  return names.size === 0;
}

function lexicalScopeStatements(node: Node): readonly Node[] | undefined {
  if (
    node.type === "Program" || node.type === "BlockStatement" ||
    node.type === "StaticBlock" || node.type === "TSModuleBlock"
  ) {
    return (Array.isArray(node.body) ? node.body : []).filter(isNode);
  }
  if (node.type !== "SwitchStatement") return undefined;
  return (Array.isArray(node.cases) ? node.cases : []).flatMap((caseNode) =>
    isNode(caseNode) && Array.isArray(caseNode.consequent)
      ? caseNode.consequent.filter(isNode)
      : []
  );
}

function bindRuntimeImportEqualsDeclaration(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (
    declaration.importKind === "type" || !isNode(declaration.id) ||
    declaration.id.type !== "Identifier"
  ) {
    return;
  }
  const binding = runtimeImportEqualsBinding(declaration, imports, scopes);
  if (binding) {
    scope.runtimeBindings.set(declaration.id.name as string, binding);
  }
}

function runtimeImportEqualsBinding(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (!isNode(declaration.moduleReference)) return undefined;
  if (declaration.moduleReference.type === "TSExternalModuleReference") {
    const literalSource = literalValue(declaration.moduleReference.expression);
    const source = literalSource
      ? normalizeImportSource(literalSource, imports.importerPath)
      : undefined;
    return source && isRuntimeEffectModule(source)
      ? { kind: "module", source }
      : undefined;
  }
  return runtimeBindingForEntityName(
    declaration.moduleReference,
    imports,
    scopes,
  );
}

function runtimeBindingForEntityName(
  entity: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (entity.type === "Identifier") {
    return identifierRuntimeBinding(entity, imports, scopes);
  }
  if (
    entity.type !== "TSQualifiedName" || !isNode(entity.left) ||
    !isNode(entity.right) || entity.right.type !== "Identifier"
  ) {
    return undefined;
  }
  const objectBinding = runtimeBindingForEntityName(
    entity.left,
    imports,
    scopes,
  );
  return objectBinding
    ? runtimePropertyBinding(objectBinding, entity.right.name as string)
    : undefined;
}

function bindRuntimeNamespaceDeclaration(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (
    declaration.declare === true || !isNode(declaration.id) ||
    declaration.id.type !== "Identifier"
  ) {
    return;
  }
  const binding = runtimeNamespaceBinding(declaration, imports, scopes);
  if (!binding) return;
  const name = declaration.id.name as string;
  const existing = scope.runtimeBindings.get(name);
  scope.runtimeBindings.set(
    name,
    existing?.kind === "namespace-object"
      ? mergeRuntimeNamespaceBindings(existing, binding)
      : binding,
  );
}

function mergeRuntimeNamespaceBindings(
  existing: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
  incoming: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
): Extract<RuntimeBinding, { readonly kind: "namespace-object" }> {
  const properties = new Map(existing.properties);
  for (const [name, binding] of incoming.properties) {
    const existingProperty = properties.get(name);
    properties.set(
      name,
      existingProperty?.kind === "namespace-object" &&
        binding.kind === "namespace-object"
        ? mergeRuntimeNamespaceBindings(existingProperty, binding)
        : binding,
    );
  }
  return { kind: "namespace-object", properties };
}

function runtimeNamespaceBinding(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): Extract<RuntimeBinding, { readonly kind: "namespace-object" }> | undefined {
  if (!isNode(declaration.body)) return undefined;
  if (declaration.body.type === "TSModuleDeclaration") {
    if (
      !isNode(declaration.body.id) ||
      declaration.body.id.type !== "Identifier"
    ) {
      return undefined;
    }
    const nested = runtimeNamespaceBinding(declaration.body, imports, scopes);
    return nested
      ? {
        kind: "namespace-object",
        properties: new Map([[declaration.body.id.name as string, nested]]),
      }
      : undefined;
  }
  if (declaration.body.type !== "TSModuleBlock") return undefined;

  const namespaceScope = createScope(declaration.body, imports, scopes);
  const properties = new Map<string, RuntimeBinding>();
  for (const statement of lexicalScopeStatements(declaration.body) ?? []) {
    if (
      statement.type === "TSImportEqualsDeclaration" &&
      statement.isExport === true && isNode(statement.id) &&
      statement.id.type === "Identifier"
    ) {
      const name = statement.id.name as string;
      const binding = namespaceScope.runtimeBindings.get(name);
      if (binding) properties.set(name, binding);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (isNode(statement.declaration)) {
      const names = new Set<string>();
      const exportedDeclaration = statement.declaration;
      if (exportedDeclaration.type === "VariableDeclaration") {
        for (
          const declarator of Array.isArray(exportedDeclaration.declarations)
            ? exportedDeclaration.declarations
            : []
        ) {
          if (isNode(declarator)) collectPatternNames(declarator.id, names);
        }
      } else if (
        (exportedDeclaration.type === "TSModuleDeclaration" ||
          exportedDeclaration.type === "FunctionDeclaration" ||
          exportedDeclaration.type === "ClassDeclaration") &&
        isNode(exportedDeclaration.id) &&
        exportedDeclaration.id.type === "Identifier"
      ) {
        names.add(exportedDeclaration.id.name as string);
      }
      for (const name of names) {
        const binding = namespaceScope.runtimeBindings.get(name);
        if (binding) properties.set(name, binding);
      }
    }
  }
  return { kind: "namespace-object", properties };
}

function collectRuntimeParameterDefaults(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (
    node.type !== "FunctionDeclaration" &&
    node.type !== "FunctionExpression" &&
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "ObjectMethod" &&
    node.type !== "ClassMethod" &&
    node.type !== "ClassPrivateMethod"
  ) {
    return;
  }
  for (const param of Array.isArray(node.params) ? node.params : []) {
    bindRuntimeDefaultPattern(param, imports, scopes, scope);
  }
}

function bindRuntimeDefaultPattern(
  pattern: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (!isNode(pattern)) return;
  if (pattern.type === "TSParameterProperty") {
    bindRuntimeDefaultPattern(pattern.parameter, imports, scopes, scope);
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    const binding = runtimeBindingForExpression(pattern.right, imports, scopes);
    if (binding) bindPatternToRuntime(pattern.left, binding, scope);
    return;
  }
  if (pattern.type === "ObjectPattern" || pattern.type === "ArrayPattern") {
    for (
      const property of Array.isArray(pattern.properties)
        ? pattern.properties
        : Array.isArray(pattern.elements)
        ? pattern.elements
        : []
    ) {
      const value = isNode(property) && isNode(property.value)
        ? property.value
        : property;
      bindRuntimeDefaultPattern(value, imports, scopes, scope);
    }
  }
}

function bindRuntimeAssignment(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  if (
    node.type !== "AssignmentExpression" || node.operator !== "=" ||
    !isNode(node.left)
  ) {
    return;
  }
  const binding = runtimeBindingForExpression(node.right, imports, scopes);
  if (binding) bindRuntimeAssignmentPattern(node.left, binding, scopes);
  else if (allowClearing) {
    clearCurrentScopeRuntimeAssignmentPattern(node.left, scopes);
  }
}

function bindRuntimeAssignmentPattern(
  pattern: Node,
  binding: RuntimeBinding,
  scopes: readonly Scope[],
): void {
  if (pattern.type === "Identifier") {
    const scope = declaringScopeForName(pattern.name as string, scopes);
    if (scope) scope.runtimeBindings.set(pattern.name as string, binding);
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    bindRuntimeAssignmentPattern(pattern.left, binding, scopes);
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindRuntimeAssignmentPattern(pattern.argument, binding, scopes);
    return;
  }
  if (
    pattern.type !== "ObjectPattern" ||
    (binding.kind !== "global-runtime" && binding.kind !== "global-object" &&
      binding.kind !== "shared-object" && binding.kind !== "effect-object" &&
      binding.kind !== "module" && binding.kind !== "namespace-object")
  ) {
    return;
  }
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (
      isNode(property) && property.type === "RestElement" &&
      isNode(property.argument)
    ) {
      bindRuntimeAssignmentPattern(property.argument, binding, scopes);
      continue;
    }
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const key = property.key.type === "Identifier"
      ? property.key.name as string
      : property.key.type === "StringLiteral"
      ? property.key.value as string
      : undefined;
    if (!key) continue;
    const propertyBinding = runtimePropertyBinding(binding, key);
    if (propertyBinding) {
      bindRuntimeAssignmentPattern(property.value, propertyBinding, scopes);
    }
  }
}

function clearCurrentScopeRuntimeAssignmentPattern(
  pattern: Node,
  scopes: readonly Scope[],
): void {
  if (pattern.type === "Identifier") {
    const scope = scopes.at(-1);
    if (scope?.names.has(pattern.name as string)) {
      scope.runtimeBindings.delete(pattern.name as string);
    }
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    clearCurrentScopeRuntimeAssignmentPattern(pattern.left, scopes);
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    clearCurrentScopeRuntimeAssignmentPattern(pattern.argument, scopes);
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (
      isNode(property) && property.type === "RestElement" &&
      isNode(property.argument)
    ) {
      clearCurrentScopeRuntimeAssignmentPattern(property.argument, scopes);
    } else if (isNode(property) && isNode(property.value)) {
      clearCurrentScopeRuntimeAssignmentPattern(property.value, scopes);
    }
  }
}

function declaringScopeForName(
  name: string,
  scopes: readonly Scope[],
): Scope | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (scope?.names.has(name)) return scope;
  }
  return undefined;
}

function unwrapExportDeclaration(statement: Node): Node {
  if (
    (statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration") &&
    isNode(statement.declaration)
  ) {
    return statement.declaration;
  }
  return statement;
}

function isConditionalBranch(parent: Node, key: string): boolean {
  if (
    (parent.type === "IfStatement" ||
      parent.type === "ConditionalExpression") &&
    (key === "consequent" || key === "alternate")
  ) {
    return true;
  }
  if (parent.type === "LogicalExpression" && key === "right") return true;
  if (
    parent.type === "OptionalCallExpression" && parent.optional === true &&
    key === "arguments"
  ) {
    return true;
  }
  return parent.type === "OptionalMemberExpression" &&
    parent.optional === true && parent.computed === true && key === "property";
}

function bindRuntimeDeclaration(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (!isNode(declaration.id)) return;
  const binding = runtimeBindingForExpression(
    declaration.init,
    imports,
    scopes,
  );
  if (binding) bindPatternToRuntime(declaration.id, binding, scope);
}

function runtimeBindingForExpression(
  expression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  const value = unwrapExpression(expression);
  if (!value) return undefined;
  const identifierBinding = identifierRuntimeBinding(value, imports, scopes);
  if (identifierBinding) return identifierBinding;
  const createRequireBinding = createRequireResultBinding(
    value,
    imports,
    scopes,
  );
  if (createRequireBinding) return createRequireBinding;
  const moduleSource = runtimeModuleSource(value, imports, scopes);
  if (moduleSource) return { kind: "module", source: moduleSource };
  const boundCallableBinding = boundCallableRuntimeBinding(
    value,
    imports,
    scopes,
  );
  if (boundCallableBinding) return boundCallableBinding;
  if (
    value.type !== "MemberExpression" &&
    value.type !== "OptionalMemberExpression"
  ) return undefined;
  const property = memberProperty(value);
  if (!property) return undefined;
  const objectBinding = runtimeBindingForExpression(
    value.object,
    imports,
    scopes,
  );
  return objectBinding
    ? runtimePropertyBinding(objectBinding, property)
    : undefined;
}

function boundCallableRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (!isCallLikeExpression(value) || !isNode(value.callee)) return undefined;
  const callee = unwrapExpression(value.callee);
  if (
    !callee ||
    (callee.type !== "MemberExpression" &&
      callee.type !== "OptionalMemberExpression") ||
    memberProperty(callee) !== "bind"
  ) {
    return undefined;
  }
  const binding = runtimeBindingForExpression(callee.object, imports, scopes);
  if (!isCallableRuntimeBinding(binding)) return undefined;
  if (binding.kind === "effect") return binding;
  const args = Array.isArray(value.arguments) ? value.arguments : [];
  return {
    ...binding,
    boundArguments: [
      ...binding.boundArguments ?? [],
      ...args.slice(1),
    ],
  };
}

function identifierRuntimeBinding(
  init: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (init.type !== "Identifier") return undefined;
  const name = init.name as string;
  const resolved = resolveLocalBinding(name, scopes);
  if (resolved.binding) return resolved.binding;
  if (resolved.declared) return undefined;
  const filesystemOpenSource = imports.filesystemOpen.get(name);
  if (filesystemOpenSource) {
    return { kind: "filesystem-open", source: filesystemOpenSource };
  }
  if (imports.filesystemRead.has(name)) {
    return { kind: "effect", effect: "filesystem-read" };
  }
  if (imports.filesystemWatch.has(name)) {
    return { kind: "effect", effect: "filesystem-watch" };
  }
  if (imports.filesystemWrite.has(name)) {
    return { kind: "effect", effect: "filesystem-write" };
  }
  if (imports.sharedCwd.has(name)) {
    return { kind: "effect", effect: "shared-cwd" };
  }
  if (imports.process.has(name)) return { kind: "effect", effect: "process" };
  if (imports.server.has(name)) return { kind: "effect", effect: "server" };
  if (imports.network.has(name)) return { kind: "effect", effect: "network" };
  if (name === "fetch" && !imports.importedNames.has("fetch")) {
    return { kind: "effect", effect: "network" };
  }
  if (imports.playwright.has(name)) {
    return { kind: "effect", effect: "browser" };
  }
  if (imports.filesystemNamespaces.has(name)) {
    return { kind: "module", source: "node:fs" };
  }
  if (imports.processNamespaces.has(name)) {
    return { kind: "module", source: "node:process" };
  }
  if (imports.serverNamespaces.has(name)) {
    return { kind: "module", source: "node:http" };
  }
  if (imports.playwrightNamespaces.has(name)) {
    return { kind: "module", source: "@playwright/test" };
  }
  return globalIdentifierRuntimeBinding(name, imports, scopes);
}

function moduleSourceForIdentifier(
  name: string,
  imports: ImportBindings,
  scopes: readonly Scope[],
): string | undefined {
  const resolved = resolveLocalBinding(name, scopes);
  if (resolved.binding?.kind === "module") return resolved.binding.source;
  if (resolved.declared) return undefined;
  if (imports.filesystemNamespaces.has(name)) return "node:fs";
  if (imports.processNamespaces.has(name)) return "node:process";
  if (imports.serverNamespaces.has(name)) return "node:http";
  if (imports.playwrightNamespaces.has(name)) return "@playwright/test";
  return undefined;
}

function moduleSourceForProperty(
  source: string,
  property: string,
): string | undefined {
  if (property === "default" && isRuntimeEffectModule(source)) return source;
  return isFilesystemSpecifier(source) && property === "promises"
    ? "node:fs/promises"
    : undefined;
}

function moduleRuntimeBindingForProperty(
  source: string,
  property: string,
): RuntimeBinding | undefined {
  if (isFilesystemSpecifier(source) && FILESYSTEM_OPEN_METHODS.has(property)) {
    return { kind: "filesystem-open", source };
  }
  if (isProcessSpecifier(source) && property === "env") {
    return { kind: "effect-object", effect: "process" };
  }
  const effect = effectForModuleMethod(source, property);
  return effect ? { kind: "effect", effect } : undefined;
}

function globalIdentifierRuntimeBinding(
  name: string,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  const resolved = resolveLocalBinding(name, scopes);
  if (
    resolved.binding?.kind === "global-runtime" ||
    resolved.binding?.kind === "global-object" ||
    resolved.binding?.kind === "shared-object" ||
    resolved.binding?.kind === "effect-object" ||
    resolved.binding?.kind === "mutation-method" ||
    resolved.binding?.kind === "constructor-effect"
  ) {
    return resolved.binding;
  }
  if (resolved.declared || imports.importedNames.has(name)) return undefined;
  const constructorEffect = GLOBAL_CONSTRUCTOR_EFFECTS.get(name);
  if (constructorEffect) {
    return { kind: "constructor-effect", effect: constructorEffect };
  }
  if (GLOBAL_RUNTIME_RECEIVERS.has(name)) return { kind: "global-object" };
  if (name === "Deno" || name === "process") {
    return { kind: "global-runtime", runtime: name };
  }
  return GLOBAL_INTRINSIC_OBJECTS.has(name)
    ? { kind: "shared-object", intrinsic: name }
    : undefined;
}

function globalObjectPropertyBinding(
  property: string,
): RuntimeBinding | undefined {
  if (property === "Deno" || property === "process") {
    return { kind: "global-runtime", runtime: property };
  }
  if (GLOBAL_RUNTIME_RECEIVERS.has(property)) {
    return { kind: "global-object" };
  }
  const constructorEffect = GLOBAL_CONSTRUCTOR_EFFECTS.get(property);
  if (constructorEffect) {
    return { kind: "constructor-effect", effect: constructorEffect };
  }
  if (GLOBAL_INTRINSIC_OBJECTS.has(property)) {
    return { kind: "shared-object", intrinsic: property };
  }
  return property === "fetch"
    ? { kind: "effect", effect: "network" }
    : undefined;
}

function sharedObjectPropertyBinding(
  intrinsic: string | undefined,
  property: string,
): RuntimeBinding {
  const mutation = intrinsic
    ? mutationMethodBinding(intrinsic, property)
    : undefined;
  if (mutation) return mutation;
  return { kind: "shared-object" };
}

function runtimePropertyBinding(
  binding: RuntimeBinding,
  property: string,
): RuntimeBinding | undefined {
  if (binding.kind === "module") {
    const nestedSource = moduleSourceForProperty(binding.source, property);
    return nestedSource
      ? { kind: "module", source: nestedSource }
      : moduleRuntimeBindingForProperty(binding.source, property);
  }
  if (binding.kind === "global-object") {
    return globalObjectPropertyBinding(property);
  }
  if (binding.kind === "shared-object") {
    return sharedObjectPropertyBinding(binding.intrinsic, property);
  }
  if (binding.kind === "global-runtime") {
    if (
      binding.runtime === "Deno" && FILESYSTEM_OPEN_METHODS.has(property)
    ) {
      return { kind: "filesystem-open", source: "Deno" };
    }
    const effect = effectForGlobalRuntimeMethod(binding.runtime, property);
    if (!effect) return undefined;
    return property === "env"
      ? { kind: "effect-object", effect }
      : { kind: "effect", effect };
  }
  if (binding.kind === "effect-object") {
    return { kind: "effect", effect: binding.effect };
  }
  if (binding.kind === "namespace-object") {
    return binding.properties.get(property);
  }
  return undefined;
}

function bindPatternToRuntime(
  pattern: Node,
  binding: RuntimeBinding,
  scope: Scope,
): void {
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    bindPatternToRuntime(pattern.left, binding, scope);
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindPatternToRuntime(pattern.argument, binding, scope);
    return;
  }
  if (pattern.type === "Identifier") {
    scope.runtimeBindings.set(pattern.name as string, binding);
    return;
  }
  if (
    pattern.type !== "ObjectPattern" ||
    (binding.kind !== "module" && binding.kind !== "global-runtime" &&
      binding.kind !== "global-object" &&
      binding.kind !== "shared-object" && binding.kind !== "effect-object" &&
      binding.kind !== "namespace-object")
  ) {
    return;
  }
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (
      isNode(property) && property.type === "RestElement" &&
      isNode(property.argument)
    ) {
      bindPatternToRuntime(property.argument, binding, scope);
      continue;
    }
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const method = property.key.type === "Identifier"
      ? property.key.name as string
      : property.key.type === "StringLiteral"
      ? property.key.value as string
      : undefined;
    if (!method) continue;
    const propertyBinding = runtimePropertyBinding(binding, method);
    if (propertyBinding) {
      bindPatternToRuntime(property.value, propertyBinding, scope);
    }
  }
}

function createRequireResultBinding(
  init: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (init.type !== "CallExpression" || !isNode(init.callee)) return undefined;
  if (init.callee.type !== "Identifier") return undefined;
  const name = init.callee.name as string;
  if (
    !imports.createRequire.has(name) ||
    resolveLocalBinding(name, scopes).declared
  ) {
    return undefined;
  }
  return { kind: "create-require" };
}

function runtimeModuleSource(
  init: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): string | undefined {
  if (init.type !== "CallExpression" || !isNode(init.callee)) return undefined;
  const literalSource = firstStringArgument(init);
  const source = literalSource
    ? normalizeImportSource(literalSource, imports.importerPath)
    : undefined;
  if (!source || !isRuntimeEffectModule(source)) return undefined;

  if (init.callee.type === "Import") return source;
  if (init.callee.type === "Identifier") {
    const loader = init.callee.name as string;
    const resolved = resolveLocalBinding(loader, scopes);
    if (resolved.binding?.kind === "create-require") return source;
    if (loader === "require" && !resolved.declared) return source;
    return undefined;
  }
  if (
    init.callee.type === "CallExpression" && isNode(init.callee.callee) &&
    init.callee.callee.type === "Identifier"
  ) {
    const loader = init.callee.callee.name as string;
    if (
      imports.createRequire.has(loader) &&
      !resolveLocalBinding(loader, scopes).declared
    ) return source;
  }
  return undefined;
}

function firstStringArgument(call: Node): string | undefined {
  const first = Array.isArray(call.arguments) ? call.arguments[0] : undefined;
  return literalValue(first);
}

function unwrapExpression(value: unknown): Node | undefined {
  let current = isNode(value) ? value : undefined;
  while (
    current &&
    (current.type === "AwaitExpression" || current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSInstantiationExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    current = isNode(current.argument)
      ? current.argument
      : isNode(current.expression)
      ? current.expression
      : undefined;
  }
  return current;
}

function collectPatternNames(value: unknown, names: Set<string>): void {
  if (!isNode(value)) return;
  if (value.type === "TSParameterProperty") {
    collectPatternNames(value.parameter, names);
    return;
  }
  if (value.type === "Identifier") {
    names.add(value.name as string);
    return;
  }
  if (value.type === "ObjectPattern") {
    for (
      const property of Array.isArray(value.properties) ? value.properties : []
    ) {
      if (isNode(property) && isNode(property.value)) {
        collectPatternNames(property.value, names);
      }
    }
    return;
  }
  if (value.type === "ArrayPattern") {
    for (const element of Array.isArray(value.elements) ? value.elements : []) {
      collectPatternNames(element, names);
    }
    return;
  }
  if (isNode(value.argument)) collectPatternNames(value.argument, names);
  if (isNode(value.left)) collectPatternNames(value.left, names);
}

function collectPlaywrightFixtureNames(
  value: unknown,
  names: Set<string>,
): void {
  if (!isNode(value) || value.type !== "ObjectPattern") return;
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property) || !isNode(property.key)) continue;
    const fixture = property.key.type === "Identifier"
      ? property.key.name as string
      : undefined;
    if (fixture === "page" || fixture === "browser" || fixture === "context") {
      if (isNode(property.value) && property.value.type === "Identifier") {
        names.add(property.value.name as string);
      } else if (fixture) {
        names.add(fixture);
      }
    }
  }
}

function isShadowed(name: string, scopes: readonly Scope[]): boolean {
  return resolveLocalBinding(name, scopes).declared;
}

function isGlobalShadowed(
  name: string,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): boolean {
  return importedNames.has(name) || isShadowed(name, scopes);
}

function isGlobalRuntimeReceiver(
  name: string,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): boolean {
  const resolved = resolveLocalBinding(name, scopes);
  if (resolved.binding?.kind === "global-object") return true;
  return GLOBAL_RUNTIME_RECEIVERS.has(name) &&
    !isGlobalShadowed(name, scopes, importedNames);
}

function resolveLocalBinding(
  name: string,
  scopes: readonly Scope[],
): { readonly declared: boolean; readonly binding?: RuntimeBinding } {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (!scope.names.has(name)) continue;
    return {
      declared: true,
      binding: scope.runtimeBindings.get(name),
    };
  }
  return { declared: false };
}

function isPlaywrightFixture(name: string, scopes: readonly Scope[]): boolean {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (!scope.names.has(name)) continue;
    return scope.playwrightFixtures.has(name);
  }
  return false;
}

function isFilesystemSpecifier(source: string): boolean {
  return source === "node:fs" || source === "node:fs/promises" ||
    source === "fs" || source === "fs/promises" ||
    source === CANONICAL_COMPAT_FS_SOURCE ||
    source === "#veryfront/compat/fs.ts" ||
    source === "#veryfront/platform/compat/fs.ts";
}

function isProcessSpecifier(source: string): boolean {
  return source === "node:child_process" || source === "child_process" ||
    source === "node:worker_threads" || source === "worker_threads" ||
    source === "node:process" || source === "process" ||
    source === CANONICAL_COMPAT_PROCESS_SOURCE ||
    source === "#veryfront/compat/process.ts" ||
    source === "#veryfront/platform/compat/process.ts";
}

function isProcessEffectMethod(method: string): boolean {
  return PROCESS_METHODS.has(method) || PROCESS_CONSTRUCTORS.has(method) ||
    PROCESS_STATE_METHODS.has(method);
}

function isServerSpecifier(source: string): boolean {
  return source === "node:http" || source === "node:https" ||
    source === "node:net" || source === "node:tls" ||
    source === "http" || source === "https" || source === "net" ||
    source === "tls";
}

function isCreateRequireSpecifier(source: string): boolean {
  return source === "node:module" || source === "module";
}

function isRuntimeEffectModule(source: string): boolean {
  return isFilesystemSpecifier(source) || isProcessSpecifier(source) ||
    isServerSpecifier(source) || isPlaywrightSpecifier(source);
}

function effectForModuleMethod(
  source: string,
  method: string,
): SemanticEffect | undefined {
  if (isFilesystemSpecifier(source)) {
    if (WATCH_METHODS.has(method)) return "filesystem-watch";
    if (READ_METHODS.has(method)) return "filesystem-read";
    if (WRITE_METHODS.has(method)) return "filesystem-write";
  }
  if (isProcessSpecifier(source) && SHARED_CWD_METHODS.has(method)) {
    return "shared-cwd";
  }
  if (isProcessSpecifier(source) && isProcessEffectMethod(method)) {
    return "process";
  }
  if (isServerSpecifier(source) && SERVER_METHODS.has(method)) return "server";
  if (isServerSpecifier(source) && NETWORK_METHODS.has(method)) {
    return "network";
  }
  if (isPlaywrightSpecifier(source) && BROWSER_METHODS.has(method)) {
    return "browser";
  }
  return undefined;
}

function effectForGlobalRuntimeMethod(
  runtime: "Deno" | "process",
  method: string,
): SemanticEffect | undefined {
  if (SHARED_CWD_METHODS.has(method)) return "shared-cwd";
  if (runtime === "Deno") {
    if (WATCH_METHODS.has(method)) return "filesystem-watch";
    if (READ_METHODS.has(method)) return "filesystem-read";
    if (WRITE_METHODS.has(method)) return "filesystem-write";
    if (PROCESS_METHODS.has(method) || method === "env") return "process";
    if (SERVER_METHODS.has(method)) return "server";
    if (NETWORK_METHODS.has(method)) return "network";
    return undefined;
  }
  if (isProcessEffectMethod(method)) return "process";
  return undefined;
}

function isPlaywrightSpecifier(source: string): boolean {
  return source === "@playwright/test" || source.includes("playwright");
}

function isDisposition(value: unknown): value is SemanticDisposition {
  return value === "replaceable-fake" ||
    value === "hermetic-unit" ||
    value === "integration-relocation";
}

function isEffect(value: unknown): value is SemanticEffect {
  return value === "filesystem-read" ||
    value === "filesystem-watch" ||
    value === "filesystem-write" ||
    value === "process" ||
    value === "server" ||
    value === "network" ||
    value === "browser" ||
    value === "shared-cwd";
}

function unwrapReadonlyArray(value: unknown): Node | undefined {
  if (!isNode(value)) return undefined;
  if (value.type === "ArrayExpression") return value;
  if (
    value.type === "CallExpression" &&
    isNode(value.callee) &&
    value.callee.type === "MemberExpression" &&
    memberObjectName(value.callee) === "Object" &&
    memberProperty(value.callee) === "freeze" &&
    Array.isArray(value.arguments) &&
    value.arguments.length === 1 &&
    isNode(value.arguments[0]) &&
    value.arguments[0].type === "ArrayExpression"
  ) return value.arguments[0];
  return undefined;
}

function memberProperty(node: Node): string | undefined {
  const property = node.property;
  if (!isNode(property)) return undefined;
  if (node.computed === true) {
    return property.type === "StringLiteral"
      ? property.value as string
      : undefined;
  }
  return property.type === "Identifier" ? property.name as string : undefined;
}

function memberObjectName(node: Node): string | undefined {
  const object = node.object;
  return isNode(object) && object.type === "Identifier"
    ? object.name as string
    : undefined;
}

function memberChain(node: Node): readonly string[] | undefined {
  const unwrapped = unwrapExpression(node);
  if (unwrapped && unwrapped !== node) return memberChain(unwrapped);
  if (node.type === "Identifier") return [node.name as string];
  if (
    (node.type !== "MemberExpression" &&
      node.type !== "OptionalMemberExpression")
  ) {
    return undefined;
  }
  const object = isNode(node.object) ? memberChain(node.object) : undefined;
  const property = memberProperty(node);
  return object && property ? [...object, property] : undefined;
}

function isGlobalRuntimePrefixObject(
  parent: Node,
  key: string,
  child: Node,
): boolean {
  if (
    key !== "object" ||
    (parent.type !== "MemberExpression" &&
      parent.type !== "OptionalMemberExpression") ||
    (child.type !== "MemberExpression" &&
      child.type !== "OptionalMemberExpression")
  ) {
    return false;
  }
  const parentChain = memberChain(parent);
  const childChain = memberChain(child);
  return parentChain !== undefined &&
    parentChain.length > 2 &&
    childChain !== undefined &&
    childChain.length === 2 &&
    childChain[0] === "globalThis" &&
    (childChain[1] === "Deno" || childChain[1] === "process");
}

function literalValue(value: unknown): string | undefined {
  return isNode(value) && value.type === "StringLiteral"
    ? value.value as string
    : undefined;
}

function importHasRuntimeValue(node: Node): boolean {
  if (node.importKind === "type") return false;
  const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
  return specifiers.length === 0 ||
    specifiers.some((specifier) =>
      isNode(specifier) && specifier.importKind !== "type"
    );
}

function isCallLikeExpression(node: Node): boolean {
  return node.type === "CallExpression" ||
    node.type === "OptionalCallExpression";
}

function isErasedTypeScriptNode(node: Node): boolean {
  if (node.declare === true) return true;
  return node.type.startsWith("TS") &&
    !TYPESCRIPT_RUNTIME_NODES.has(node.type);
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSafeRepoRelativePath(path: string): boolean {
  return path !== "" && path === normalizeProjectPath(path) &&
    !path.includes("\\") && !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    path.split("/").every((segment) =>
      segment !== "" && segment !== "." && segment !== ".."
    );
}

function resolveProjectPath(root: string, path: string): string {
  return `${root.replace(/\/$/, "")}/${path}`;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareOrdinal);
}

function uniqueMarkers(
  markers: readonly SemanticMarker[],
): SemanticMarker[] {
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.effect}\0${marker.line}\0${marker.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
