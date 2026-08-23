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

const ALL_SEMANTIC_EFFECTS: readonly SemanticEffect[] = [
  "browser",
  "filesystem-read",
  "filesystem-watch",
  "filesystem-write",
  "network",
  "process",
  "server",
  "shared-cwd",
];

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
  readonly filesystemReadLocality?: "repository" | "external-or-unresolved";
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
  "expandGlob",
  "expandGlobSync",
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
  "walk",
  "walkSync",
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
  "copy",
  "copyFile",
  "copyFileSync",
  "copySync",
  "cp",
  "cpSync",
  "emptyDir",
  "emptyDirSync",
  "ensureDir",
  "ensureDirSync",
  "ensureFile",
  "ensureFileSync",
  "ensureLink",
  "ensureLinkSync",
  "ensureSymlink",
  "ensureSymlinkSync",
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
  "move",
  "moveSync",
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
  "execFileSync",
  "execSync",
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
  "Object.create",
  "Object.defineProperties",
  "Object.freeze",
  "Object.preventExtensions",
  "Object.seal",
  "Object.setPrototypeOf",
  "Reflect.preventExtensions",
  "Reflect.setPrototypeOf",
]);

const ARRAY_SHAPE_MUTATORS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const ARRAY_RECEIVER_RETURNING_MUTATORS = new Set([
  "copyWithin",
  "fill",
  "reverse",
  "sort",
]);

const OBJECT_RECEIVER_RETURNING_MUTATORS = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "freeze",
  "preventExtensions",
  "seal",
  "setPrototypeOf",
]);

const LOCAL_PROPERTY_MUTATORS = new Set([
  "Object.assign",
  "Object.defineProperties",
  "Object.defineProperty",
  "Object.setPrototypeOf",
  "Reflect.defineProperty",
  "Reflect.deleteProperty",
  "Reflect.set",
  "Reflect.setPrototypeOf",
]);

const OBJECT_EXTENSIBILITY_MUTATORS = new Set([
  "Object.freeze",
  "Object.preventExtensions",
  "Object.seal",
  "Reflect.preventExtensions",
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

const PROCESS_ARGUMENT_PROPERTIES = new Set(["args", "argv"]);

const TESTING_RUNTIME_WRITE_METHODS = new Set([
  "makeTempDirWithOptions",
  "withTempDir",
  "withTempFile",
]);

const TESTING_RUNTIME_PROCESS_METHODS = new Set(["getArgs", "withEnv"]);

const TESTING_RUNTIME_NETWORK_METHODS = new Set([
  "installMockFetch",
  "restoreMockFetch",
  "withMockFetch",
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

const DNS_NETWORK_METHODS = new Set([
  "lookup",
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
]);

const DNS_RESOLVER_CONSTRUCTORS = new Set(["Resolver"]);

const GLOBAL_RUNTIME_RECEIVERS = new Set(["globalThis", "window", "self"]);

const CANONICAL_COMPAT_FS_SOURCE = "src/platform/compat/fs.ts";
const CANONICAL_COMPAT_PROCESS_SOURCE = "src/platform/compat/process.ts";
const CANONICAL_TESTING_DENO_COMPAT_SOURCE = "src/testing/deno-compat.ts";
const CANONICAL_TESTING_BARREL_SOURCE = "src/testing/index.ts";
const CANONICAL_TESTING_MOCK_FETCH_SOURCE = "src/testing/mock-fetch.ts";

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

const THIS_RUNTIME_ROOT = "this";

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
  readonly runtimeNamespaces: Map<string, string>;
  readonly runtimeConstructors: Map<string, string>;
  readonly createRequire: Set<string>;
  readonly importedNames: Set<string>;
}

type NamespacePropertyOperation =
  | {
    readonly kind: "spread";
    readonly binding: RuntimeBinding;
    readonly conservativePartial?: boolean;
  }
  | {
    readonly kind: "define";
    readonly name: string;
    readonly binding?: RuntimeBinding;
    readonly aliasTargets?: readonly RuntimeAliasTarget[];
    readonly defaultMayRun: boolean;
    readonly preservesPrevious?: boolean;
    readonly crossesFunctionBoundary?: boolean;
    readonly enumerable?: boolean;
    readonly configurable?: boolean;
  }
  | {
    readonly kind: "define-unknown";
    readonly binding?: RuntimeBinding;
    readonly aliasTargets?: readonly RuntimeAliasTarget[];
    readonly defaultMayRun: boolean;
    readonly crossesFunctionBoundary?: boolean;
    readonly minimumArrayIndex?: number;
    readonly fallbackOnly?: boolean;
    readonly replacesFallback?: boolean;
    readonly enumerable?: boolean;
    readonly configurable?: boolean;
  };

const MAX_MATERIALIZED_ARRAY_SPREAD_ENTRIES = 256;

interface RuntimePropertyResolution {
  readonly binding?: RuntimeBinding;
  readonly aliasTargets?: readonly RuntimeAliasTarget[];
  readonly defaultMayRun: boolean;
  readonly enumerable?: boolean;
  readonly configurable?: boolean;
}

interface RuntimePatternEntry {
  readonly pattern: Node;
  readonly resolution: RuntimePropertyResolution;
}

interface RuntimeAliasTarget {
  readonly scope: Scope;
  readonly root: string;
}

type RuntimeBinding =
  | { readonly kind: "module"; readonly source: string }
  | { readonly kind: "module-constructor"; readonly source: string }
  | { readonly kind: "module-instance"; readonly source: string }
  | { readonly kind: "effect"; readonly effect: SemanticEffect }
  | { readonly kind: "effect-object"; readonly effect: SemanticEffect }
  | {
    readonly kind: "property-getter-effect";
    readonly binding: RuntimeBinding;
    readonly enumerable?: boolean;
  }
  | {
    readonly kind: "property-getter-value";
    readonly binding: RuntimeBinding;
    readonly enumerable?: boolean;
  }
  | { readonly kind: "property-setter"; readonly binding: RuntimeBinding }
  | {
    readonly kind: "namespace-object";
    readonly shape?: "array" | "object";
    readonly exactArrayLength?: number;
    readonly extensible?: boolean;
    readonly properties: ReadonlyMap<string, RuntimeBinding>;
    readonly propertyOperations?: readonly NamespacePropertyOperation[];
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
    readonly receiver: "Array";
    readonly method: string;
    readonly boundTarget?: unknown;
    readonly boundValues?: readonly unknown[];
  }
  | {
    readonly kind: "mutation-method";
    readonly receiver: "Object" | "Reflect";
    readonly method: string;
  }
  | {
    readonly kind: "reflect-method";
    readonly method: "apply" | "construct";
    readonly boundArguments?: readonly unknown[];
  }
  | {
    readonly kind: "constructor-effect";
    readonly effect: SemanticEffect;
  }
  | {
    readonly kind: "global-runtime";
    readonly runtime: "Deno" | "process";
  }
  | { readonly kind: "create-require" }
  | { readonly kind: "partial"; readonly binding: RuntimeBinding }
  | {
    readonly kind: "one-of";
    readonly bindings: readonly RuntimeBinding[];
  };

const RUNTIME_GETTER_EFFECT_PRESENCE = new WeakMap<RuntimeBinding, boolean>();

interface Scope {
  readonly names: Set<string>;
  readonly definitelyNonUndefinedNames: Set<string>;
  readonly functionBoundary: boolean;
  readonly playwrightFixtures: Set<string>;
  readonly runtimeBindings: Map<string, RuntimeBinding>;
  readonly runtimeAliases: Map<string, readonly RuntimeAliasTarget[]>;
  readonly classRuntimeBindings?: {
    readonly name?: string;
    instance?: RuntimeBinding;
    static?: RuntimeBinding;
    readonly memberEntries: Map<Node, RuntimeBinding | undefined>;
  };
  readonly classReceiver?: {
    readonly classScope: Scope;
    readonly kind: "instance" | "static";
  };
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
        bindRuntimeDeclaration(
          node,
          bindings,
          nextScopes,
          scope,
          !allowAssignmentClearing,
          allowAssignmentClearing,
        );
      }
    }
    bindRuntimeClassDeclaration(node, nextScopes);
    const nodeMarkers = suppressMarker
      ? undefined
      : markerForNode(node, bindings, nextScopes);
    if (nodeMarkers) {
      markers.push(
        ...semanticMarkers(nodeMarkers).map((marker) =>
          annotateFilesystemReadLocality(marker, node, bindings, nextScopes)
        ),
      );
    }
    bindRuntimeAssignment(
      node,
      bindings,
      nextScopes,
      allowAssignmentClearing,
    );
    bindRuntimeDeleteMutation(
      node,
      bindings,
      nextScopes,
      allowAssignmentClearing,
    );
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
        const childScopes = classFieldValueScopes(node, key, nextScopes);
        const suppressChildMarker = isGlobalRuntimePrefixObject(
          node,
          key,
          value,
        ) || isRuntimeEnvDetailObjectChild(
          node,
          key,
          value,
          bindings,
          childScopes,
        ) || isWriteOnlyAssignmentTargetChild(node, key);
        visit(
          value,
          childScopes,
          suppressChildMarker,
          allowAssignmentClearing && !isConditionalBranch(node, key),
        );
      }
    }
    bindRuntimeCallMutation(
      node,
      bindings,
      nextScopes,
      allowAssignmentClearing,
    );
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
    if (entry.disposition === "hermetic-unit") {
      for (
        const marker of candidate.markers.filter((marker) =>
          marker.effect === "filesystem-read" &&
          marker.filesystemReadLocality !== "repository"
        )
      ) {
        errors.push(
          `hermetic-unit filesystem read is not proven repository-local: ${path}:${marker.line} ${marker.symbol}`,
        );
      }
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
): SemanticMarker | readonly SemanticMarker[] | undefined {
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

  if (node.type === "SpreadElement" && isNode(node.argument)) {
    const markers = spreadGetterRuntimeEffectMarkers(
      node.argument,
      line,
      bindings,
      scopes,
    );
    if (markers.length > 0) return markers;
  }

  const globalPropertyMutation = globalPropertyMutationMarker(
    node,
    line,
    scopes,
    bindings,
  );
  if (globalPropertyMutation) return globalPropertyMutation;

  const reflectInvocation = reflectInvocationMarkers(
    node,
    line,
    bindings,
    scopes,
  );
  if (reflectInvocation.length > 0) return reflectInvocation;

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
    const getterMarkers = memberGetterRuntimeEffectMarkers(
      node,
      line,
      bindings,
      scopes,
    );
    if (getterMarkers.length > 0) return getterMarkers;
    const runtimeMarker = memberRuntimeEffectMarker(
      node,
      line,
      bindings,
      scopes,
    );
    const objectName = memberObjectName(node);
    const chain = memberChain(node);
    const effectObject = objectName
      ? resolveLocalBinding(objectName, scopes).binding?.kind ===
        "effect-object"
      : false;
    if (
      runtimeMarker &&
      (memberProperty(node) === "env" ||
        PROCESS_ARGUMENT_PROPERTIES.has(memberProperty(node) ?? "") ||
        effectObject ||
        isRuntimeEnvDetailChain(chain, bindings, scopes) ||
        isProcessModuleEnvDetail(node, bindings, scopes))
    ) {
      return runtimeMarker;
    }
  }

  if (node.type === "AssignmentExpression" && isNode(node.left)) {
    const markers = assignmentTargetRuntimeEffectMarkers(
      node.left,
      line,
      bindings,
      scopes,
      node.right,
    );
    return markers.length > 0 ? markers : undefined;
  }

  if (node.type === "UpdateExpression" && isNode(node.argument)) {
    const markers = assignmentTargetRuntimeEffectMarkers(
      node.argument,
      line,
      bindings,
      scopes,
      unknownRuntimeValueExpression(),
    );
    return markers.length > 0 ? markers : undefined;
  }

  if (
    (node.type === "ForOfStatement" || node.type === "ForInStatement") &&
    isNode(node.left)
  ) {
    const markers = assignmentTargetRuntimeEffectMarkers(
      node.left,
      line,
      bindings,
      scopes,
      unknownRuntimeValueExpression(),
    );
    return markers.length > 0 ? markers : undefined;
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
      const localMarkers = markersForRuntimeBinding(
        local.binding,
        name,
        line,
        node.type === "NewExpression",
      );
      if (localMarkers.length > 0) return localMarkers;
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
  if (callee.computed === true && memberProperty(callee) === undefined) {
    return runtimeInvocationMarker(node, callee, line, bindings, scopes);
  }
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
    return runtimeInvocationMarker(node, callee, line, bindings, scopes);
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

function semanticMarkers(
  markers: SemanticMarker | readonly SemanticMarker[],
): readonly SemanticMarker[] {
  return Array.isArray(markers) ? markers : [markers as SemanticMarker];
}

function annotateFilesystemReadLocality(
  marker: SemanticMarker,
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker {
  if (marker.effect !== "filesystem-read") return marker;
  const operand = filesystemReadPathOperand(node);
  return {
    ...marker,
    filesystemReadLocality: isRepositoryLocalFilesystemOperand(
        operand,
        imports,
        scopes,
      )
      ? "repository"
      : "external-or-unresolved",
  };
}

function filesystemReadPathOperand(node: Node): unknown {
  if (
    node.type !== "CallExpression" && node.type !== "OptionalCallExpression" &&
    node.type !== "NewExpression"
  ) return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const callee = unwrapExpression(node.callee);
  if (!callee) return undefined;
  if (
    (callee.type === "MemberExpression" ||
      callee.type === "OptionalMemberExpression") &&
    memberObjectName(callee) === "Reflect" &&
    memberProperty(callee) === "apply"
  ) {
    return firstArrayElement(args[2]);
  }
  if (
    callee.type === "MemberExpression" ||
    callee.type === "OptionalMemberExpression"
  ) {
    const wrapper = memberProperty(callee);
    if (wrapper === "call") return args[1];
    if (wrapper === "apply") return firstArrayElement(args[1]);
  }
  return args[0];
}

function firstArrayElement(value: unknown): unknown {
  const array = unwrapExpression(value);
  return array?.type === "ArrayExpression" && Array.isArray(array.elements)
    ? array.elements[0]
    : undefined;
}

function isRepositoryLocalFilesystemOperand(
  operand: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  const value = unwrapExpression(operand);
  if (!value) return false;
  if (value.type === "StringLiteral") {
    return isSafeRepositoryFilesystemLiteral(value.value as string);
  }
  if (
    value.type === "TemplateLiteral" &&
    Array.isArray(value.expressions) && value.expressions.length === 0 &&
    Array.isArray(value.quasis) && value.quasis.length === 1 &&
    isNode(value.quasis[0]) &&
    typeof value.quasis[0].value === "object" &&
    value.quasis[0].value !== null
  ) {
    const cooked = (value.quasis[0].value as { readonly cooked?: unknown })
      .cooked;
    return typeof cooked === "string" &&
      isSafeRepositoryFilesystemLiteral(cooked);
  }
  if (
    value.type !== "NewExpression" || !isNode(value.callee) ||
    value.callee.type !== "Identifier" || value.callee.name !== "URL" ||
    isGlobalShadowed("URL", scopes, imports.importedNames)
  ) {
    return false;
  }
  const args = Array.isArray(value.arguments) ? value.arguments : [];
  const relative = unwrapExpression(args[0]);
  return relative?.type === "StringLiteral" &&
    isSafeRepositoryUrlLiteral(relative.value as string) &&
    isImportMetaUrl(args[1]);
}

function isSafeRepositoryFilesystemLiteral(value: string): boolean {
  const normalized = normalizeProjectPath(value);
  return value !== "" && !value.includes("\\") &&
    !/^[A-Za-z][A-Za-z\d+.-]*:/.test(value) &&
    isSafeRepoRelativePath(normalized);
}

function isSafeRepositoryUrlLiteral(value: string): boolean {
  if (
    value === "" || value.includes("\\") || value.startsWith("/") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  ) {
    return false;
  }
  const repositoryPath = "/__veryfront_semantic_audit_repository__/";
  try {
    const resolved = new URL(
      value,
      `file://${repositoryPath}source.test.ts`,
    );
    return resolved.protocol === "file:" && resolved.host === "" &&
      resolved.pathname.startsWith(repositoryPath);
  } catch {
    return false;
  }
}

function isImportMetaUrl(value: unknown): boolean {
  const member = unwrapExpression(value);
  if (
    !member ||
    (member.type !== "MemberExpression" &&
      member.type !== "OptionalMemberExpression") ||
    memberProperty(member) !== "url"
  ) {
    return false;
  }
  const object = unwrapExpression(member.object);
  return object?.type === "MetaProperty" && isNode(object.meta) &&
    object.meta.type === "Identifier" && object.meta.name === "import" &&
    isNode(object.property) && object.property.type === "Identifier" &&
    object.property.name === "meta";
}

function markersForRuntimeBinding(
  binding: RuntimeBinding | undefined,
  symbol: string,
  line: number,
  allowConstructor: boolean,
): readonly SemanticMarker[] {
  return flattenRuntimeBindings(binding).flatMap((candidate) => {
    if (candidate.kind === "effect") {
      return [{ effect: candidate.effect, line, symbol }];
    }
    if (allowConstructor && candidate.kind === "constructor-effect") {
      return [{ effect: candidate.effect, line, symbol }];
    }
    return [];
  });
}

function callableRuntimeBindingMarkers(
  binding: RuntimeBinding | undefined,
  symbol: string,
  line: number,
  invocationArguments: readonly unknown[] = [],
  includeUnboundInvocationArguments = true,
): readonly SemanticMarker[] {
  const effects = sortedUnique(
    flattenRuntimeBindings(binding).flatMap((candidate) =>
      candidate.kind === "effect"
        ? [candidate.effect]
        : candidate.kind === "filesystem-open"
        ? [
          filesystemOpenEffect(
            filesystemOpenOptions(
              candidate,
              includeUnboundInvocationArguments ||
                (candidate.boundArguments?.length ?? 0) > 0
                ? invocationArguments
                : [],
            ),
          ),
        ]
        : []
    ),
  );
  return effects.map((effect) => ({ effect, line, symbol }));
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
  if (isGlobalProcessEnvDetailChain(chain)) return undefined;
  const binding = runtimeBindingForExpression(member, imports, scopes);
  const effectBindings = flattenRuntimeBindings(binding).filter((candidate) =>
    candidate.kind === "effect"
  );
  if (effectBindings.length === 1 && effectBindings[0].kind === "effect") {
    return {
      effect: effectBindings[0].effect,
      line,
      symbol: chain?.join(".") ?? invocationSymbol(member),
    };
  }
  const effectObjectBindings = flattenRuntimeBindings(binding).filter((
    candidate,
  ) => candidate.kind === "effect-object");
  if (
    effectObjectBindings.length === 1 &&
    effectObjectBindings[0].kind === "effect-object" &&
    (isRuntimeEnvRootChain(chain, imports, scopes) ||
      isRuntimeArgumentRootChain(chain))
  ) {
    return {
      effect: effectObjectBindings[0].effect,
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

function memberGetterRuntimeEffectMarkers(
  member: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  if (
    member.type !== "MemberExpression" &&
    member.type !== "OptionalMemberExpression"
  ) return [];
  const object = unwrapExpression(member.object);
  const objectBinding = object
    ? runtimeBindingForExpression(object, imports, scopes)
    : undefined;
  if (!objectBinding) return [];
  const property = memberProperty(member);
  const getterBinding = property === undefined
    ? runtimeUnknownPropertyGetterEffectBinding(objectBinding)
    : runtimePropertyGetterEffectBinding(objectBinding, property);
  return getterRuntimeEffectMarkers(
    getterBinding,
    `${memberChain(member)?.join(".") ?? invocationSymbol(member)} getter`,
    line,
  );
}

function spreadGetterRuntimeEffectMarkers(
  argument: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  const binding = runtimeBindingForExpression(argument, imports, scopes);
  return getterRuntimeEffectMarkers(
    runtimeUnknownPropertyGetterEffectBinding(binding, true),
    `${invocationSymbol(argument)}.* getter`,
    line,
  );
}

function getterRuntimeEffectMarkers(
  binding: RuntimeBinding | undefined,
  symbol: string,
  line: number,
): readonly SemanticMarker[] {
  const effects = sortedUnique(
    flattenRuntimeBindings(binding).flatMap((candidate) =>
      candidate.kind === "effect" ? [candidate.effect] : []
    ),
  );
  return effects.map((effect) => ({ effect, line, symbol }));
}

function memberAssignmentRuntimeEffectMarkers(
  member: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
  assignedValue?: unknown,
): readonly SemanticMarker[] {
  if (
    member.type !== "MemberExpression" &&
    member.type !== "OptionalMemberExpression"
  ) return [];
  const setterMarkers = memberSetterRuntimeEffectMarkers(
    member,
    line,
    imports,
    scopes,
    assignedValue,
  );
  if (setterMarkers.length > 0) return setterMarkers;
  const object = unwrapExpression(member.object);
  const objectBinding = object
    ? runtimeBindingForExpression(object, imports, scopes)
    : undefined;
  const objectBindings = flattenRuntimeBindings(objectBinding);
  if (
    objectBindings.length > 0 &&
    objectBindings.every((binding) => binding.kind === "namespace-object")
  ) {
    return [];
  }
  const marker = memberRuntimeEffectMarker(member, line, imports, scopes);
  return marker ? [marker] : [];
}

function assignmentTargetRuntimeEffectMarkers(
  target: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
  assignedValue?: unknown,
): readonly SemanticMarker[] {
  const unwrapped = unwrapExpression(target);
  if (!unwrapped) return [];
  if (
    unwrapped.type === "MemberExpression" ||
    unwrapped.type === "OptionalMemberExpression"
  ) {
    const chain = memberChain(unwrapped);
    if (isRuntimeEnvDetailChain(chain, imports, scopes)) {
      return [{
        effect: "process",
        line,
        symbol: chain?.[0] === "Deno" || chain?.[0] === "process"
          ? `${chain[0]}.env`
          : chain?.join(".") ?? "runtime.env",
      }];
    }
    const globalMarker = globalRuntimeMemberMutationMarker(
      unwrapped,
      line,
      scopes,
      imports.importedNames,
    );
    if (globalMarker) return [globalMarker];
    return memberAssignmentRuntimeEffectMarkers(
      unwrapped,
      line,
      imports,
      scopes,
      assignedValue,
    );
  }
  if (unwrapped.type === "AssignmentPattern" && isNode(unwrapped.left)) {
    return assignmentTargetRuntimeEffectMarkers(
      unwrapped.left,
      line,
      imports,
      scopes,
      assignedValue,
    );
  }
  if (unwrapped.type === "RestElement" && isNode(unwrapped.argument)) {
    return assignmentTargetRuntimeEffectMarkers(
      unwrapped.argument,
      line,
      imports,
      scopes,
      assignedValue,
    );
  }
  const children = unwrapped.type === "ObjectPattern"
    ? unwrapped.properties
    : unwrapped.type === "ArrayPattern"
    ? unwrapped.elements
    : undefined;
  return (Array.isArray(children) ? children : []).flatMap((child) => {
    if (!isNode(child)) return [];
    const target = child.type === "ObjectProperty" && isNode(child.value)
      ? child.value
      : child;
    return assignmentTargetRuntimeEffectMarkers(
      target,
      line,
      imports,
      scopes,
      unknownRuntimeValueExpression(),
    );
  });
}

function memberSetterRuntimeEffectMarkers(
  member: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
  assignedValue: unknown = unknownRuntimeValueExpression(),
): readonly SemanticMarker[] {
  if (
    member.type !== "MemberExpression" &&
    member.type !== "OptionalMemberExpression"
  ) return [];
  const object = unwrapExpression(member.object);
  const objectBinding = object
    ? runtimeBindingForExpression(object, imports, scopes)
    : undefined;
  if (!objectBinding) return [];
  const property = memberProperty(member);
  const setterBinding = property === undefined
    ? runtimeUnknownPropertySetterBinding(objectBinding)
    : runtimePropertySetterBinding(objectBinding, property);
  const chain = memberChain(member);
  return callableRuntimeBindingMarkers(
    setterBinding,
    `${chain?.join(".") ?? invocationSymbol(member)} setter`,
    line,
    [assignedValue],
  );
}

function unknownRuntimeValueExpression(): Node {
  return { type: "Identifier", name: "unknownRuntimeValue" };
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

function isRuntimeArgumentRootChain(
  chain: readonly string[] | undefined,
): boolean {
  return chain !== undefined &&
    PROCESS_ARGUMENT_PROPERTIES.has(chain.at(-1) ?? "");
}

function filesystemOpenMarker(
  node: Node,
  callee: Node,
  line: number,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | readonly SemanticMarker[] | undefined {
  if (!isCallLikeExpression(node)) return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const invocations = filesystemOpenInvocations(callee, args, bindings, scopes);
  if (invocations.length === 0) return undefined;
  return invocations.map((invocation) => ({
    effect: filesystemOpenEffect(invocation.options),
    line,
    symbol: invocationSymbol(callee),
  }));
}

function reflectInvocationMarkers(
  node: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  if (!isCallLikeExpression(node) || !isNode(node.callee)) return [];
  const callee = unwrapExpression(node.callee);
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const reflectInvocations = reflectInvocationCalls(
    callee,
    args,
    imports,
    scopes,
  );
  return reflectInvocations.flatMap(
    ({ method, symbolPrefix, arguments: invocationArguments }) => {
      if (method !== "apply" && method !== "construct") return [];
      const target = unwrapExpression(invocationArguments[0]);
      if (!target) return [];
      const targetSymbol = invocationSymbol(target);
      const binding = runtimeBindingForExpression(target, imports, scopes);
      const symbol = `${symbolPrefix}(${targetSymbol})`;

      if (method === "construct") {
        return markersForRuntimeBinding(binding, symbol, line, true);
      }

      return flattenRuntimeBindings(binding).flatMap((candidate) => {
        if (candidate.kind === "effect") {
          return [{ effect: candidate.effect, line, symbol }];
        }
        if (candidate.kind === "filesystem-open") {
          return [{
            effect: filesystemOpenEffect(
              filesystemOpenOptions(
                candidate,
                filesystemOpenApplyArguments(invocationArguments[2]),
              ),
            ),
            line,
            symbol,
          }];
        }
        return [];
      });
    },
  );
}

function reflectInvocationCalls(
  callee: Node | undefined,
  args: readonly unknown[],
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly {
  readonly method: "apply" | "construct";
  readonly symbolPrefix: string;
  readonly arguments: readonly unknown[];
}[] {
  if (!callee) return [];
  const direct = flattenRuntimeBindings(
    runtimeBindingForExpression(callee, imports, scopes),
  ).flatMap((candidate) =>
    candidate.kind === "reflect-method"
      ? [{
        method: candidate.method,
        symbolPrefix: invocationSymbol(callee),
        arguments: [...candidate.boundArguments ?? [], ...args],
      }]
      : []
  );
  if (
    callee.type !== "MemberExpression" &&
    callee.type !== "OptionalMemberExpression"
  ) return direct;
  const wrapper = memberProperty(callee);
  if (wrapper !== "call" && wrapper !== "apply") return direct;
  const wrapperArguments = wrapper === "apply"
    ? arrayExpressionArguments(args[1])
    : args.slice(1);
  const wrapped = flattenRuntimeBindings(
    runtimeBindingForExpression(callee.object, imports, scopes),
  ).flatMap((candidate) =>
    candidate.kind === "reflect-method"
      ? [{
        method: candidate.method,
        symbolPrefix: invocationSymbol(callee),
        arguments: [
          ...candidate.boundArguments ?? [],
          ...wrapperArguments,
        ],
      }]
      : []
  );
  return [...direct, ...wrapped];
}

function filesystemOpenInvocations(
  callee: Node,
  args: readonly unknown[],
  bindings: ImportBindings,
  scopes: readonly Scope[],
): readonly {
  readonly binding: Extract<
    RuntimeBinding,
    { readonly kind: "filesystem-open" }
  >;
  readonly options: unknown;
}[] {
  const directBindings = filesystemOpenBindings(callee, bindings, scopes);
  if (directBindings.length > 0) {
    return directBindings.map((binding) => ({
      binding,
      options: filesystemOpenOptions(binding, args),
    }));
  }
  const callableBindings = callableMethodInvocationBindings(
    callee,
    bindings,
    scopes,
  ).filter((
    candidate,
  ): candidate is Extract<
    RuntimeBinding,
    { readonly kind: "filesystem-open" }
  > => candidate.kind === "filesystem-open");
  if (callableBindings.length === 0) return [];
  const method = memberProperty(callee);
  const invocationArguments = method === "apply"
    ? filesystemOpenApplyArguments(args[1])
    : args.slice(1);
  return callableBindings.map((binding) => ({
    binding,
    options: filesystemOpenOptions(binding, invocationArguments),
  }));
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

function filesystemOpenBindings(
  callee: Node,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): readonly Extract<RuntimeBinding, { readonly kind: "filesystem-open" }>[] {
  const binding = runtimeBindingForExpression(callee, bindings, scopes);
  return flattenRuntimeBindings(binding).filter((
    candidate,
  ): candidate is Extract<
    RuntimeBinding,
    { readonly kind: "filesystem-open" }
  > => candidate.kind === "filesystem-open");
}

function runtimeInvocationMarker(
  node: Node,
  callee: Node,
  line: number,
  bindings: ImportBindings,
  scopes: readonly Scope[],
): SemanticMarker | readonly SemanticMarker[] | undefined {
  const chain = memberChain(callee);
  if (
    chain?.length === 3 && chain[0] === "Deno" && chain[1] === "env" &&
    PROCESS_ENV_METHODS.has(chain[2])
  ) {
    return undefined;
  }
  const unknownComputedMarkers = unknownComputedRuntimeInvocationMarkers(
    callee,
    line,
    bindings,
    scopes,
  );
  if (unknownComputedMarkers.length > 0) return unknownComputedMarkers;
  const binding = runtimeBindingForExpression(callee, bindings, scopes);
  const directMarkers = markersForRuntimeBinding(
    binding,
    invocationSymbol(callee),
    line,
    node.type === "NewExpression",
  );
  if (directMarkers.length > 0) return directMarkers;
  const callableMarkers = callableMethodInvocationBindings(
    callee,
    bindings,
    scopes,
  ).flatMap((candidate) =>
    candidate.kind === "effect"
      ? [{ effect: candidate.effect, line, symbol: invocationSymbol(callee) }]
      : []
  );
  if (callableMarkers.length > 0) return callableMarkers;
  return undefined;
}

function unknownComputedRuntimeInvocationMarkers(
  callee: Node,
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  if (
    (callee.type !== "MemberExpression" &&
      callee.type !== "OptionalMemberExpression") ||
    callee.computed !== true || memberProperty(callee) !== undefined
  ) {
    return [];
  }
  const object = unwrapExpression(callee.object);
  if (!object) return [];
  const effects = conservativeRuntimeEffects(
    runtimeBindingForExpression(object, imports, scopes),
  );
  if (effects.length === 0) return [];
  const symbol = `${invocationSymbol(object)}.*`;
  return effects.map((effect) => ({ effect, line, symbol }));
}

function conservativeRuntimeEffects(
  binding: RuntimeBinding | undefined,
): readonly SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  const visited = new Set<RuntimeBinding>();
  const pending = [...flattenRuntimeBindings(binding)];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) continue;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    if (
      candidate.kind === "effect" || candidate.kind === "effect-object" ||
      candidate.kind === "constructor-effect"
    ) {
      effects.push(candidate.effect);
      continue;
    }
    if (candidate.kind === "filesystem-open") {
      effects.push("filesystem-read", "filesystem-write");
      continue;
    }
    if (candidate.kind === "global-runtime") {
      effects.push(
        ...candidate.runtime === "Deno"
          ? [
            "filesystem-read",
            "filesystem-watch",
            "filesystem-write",
            "process",
            "server",
            "network",
            "shared-cwd",
          ] as const
          : ["process", "shared-cwd"] as const,
      );
      continue;
    }
    if (candidate.kind === "global-object") {
      effects.push(
        "filesystem-read",
        "filesystem-watch",
        "filesystem-write",
        "process",
        "server",
        "network",
        "browser",
        "shared-cwd",
      );
      continue;
    }
    if (
      candidate.kind === "module" || candidate.kind === "module-instance"
    ) {
      effects.push(...conservativeModuleEffects(candidate.source));
      continue;
    }
    if (
      candidate.kind === "property-getter-effect" ||
      candidate.kind === "property-getter-value"
    ) {
      pending.push(candidate.binding);
      continue;
    }
    if (candidate.kind === "namespace-object") {
      pending.push(...namespaceBindingsForUnknownProperty(candidate));
      continue;
    }
    if (candidate.kind === "one-of") {
      pending.push(...candidate.bindings);
    }
  }
  return sortedUnique(effects);
}

function namespaceBindingsForUnknownProperty(
  binding: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
): readonly RuntimeBinding[] {
  return namespaceUnknownPropertyResolutions(binding).flatMap((resolution) =>
    resolution.binding ?? []
  );
}

function runtimeUnknownPropertyResolution(
  binding: RuntimeBinding,
  onlyEnumerable = false,
): RuntimePropertyResolution {
  const propertyBindings: RuntimeBinding[] = [];
  const aliasTargets: RuntimeAliasTarget[] = [];
  for (const candidate of flattenRuntimeBindings(binding)) {
    if (candidate.kind !== "namespace-object") {
      if (
        candidate.kind === "global-runtime" || candidate.kind === "module" ||
        candidate.kind === "module-instance" ||
        candidate.kind === "effect-object"
      ) {
        propertyBindings.push(
          ...conservativeRuntimeEffects(candidate).map((effect) => ({
            kind: "effect" as const,
            effect,
          })),
        );
      }
      continue;
    }
    for (
      const resolution of namespaceUnknownPropertyResolutions(
        candidate,
        onlyEnumerable,
      )
    ) {
      if (resolution.binding) propertyBindings.push(resolution.binding);
      aliasTargets.push(...resolution.aliasTargets ?? []);
    }
  }
  const resolvedBinding = unionRuntimeBindingsPreservingPartial(
    propertyBindings,
  );
  return {
    binding: resolvedBinding && runtimeBindingHasPartialAlternative(binding) &&
        !runtimeBindingHasPartialAlternative(resolvedBinding)
      ? { kind: "partial", binding: resolvedBinding }
      : resolvedBinding,
    aliasTargets: uniqueRuntimeAliasTargets(aliasTargets),
    defaultMayRun: true,
  };
}

function namespaceUnknownPropertyResolutions(
  binding: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
  onlyEnumerable = false,
): readonly RuntimePropertyResolution[] {
  return [...namespaceUnknownPropertyNames(binding)].map((
    propertyName,
  ) => runtimePropertyResolution(binding, propertyName, false, onlyEnumerable));
}

function namespaceUnknownPropertyNames(
  binding: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
): Set<string> {
  const propertyNames = namespacePropertyNames(binding);
  for (const operation of binding.propertyOperations ?? []) {
    if (
      operation.kind === "define-unknown" &&
      operation.minimumArrayIndex !== undefined
    ) {
      propertyNames.add(String(operation.minimumArrayIndex));
    }
  }
  let unknownPropertyName = "__veryfront_unknown_computed_property__";
  while (propertyNames.has(unknownPropertyName)) {
    unknownPropertyName += "_";
  }
  propertyNames.add(unknownPropertyName);
  return propertyNames;
}

function namespacePropertyNames(
  binding: RuntimeBinding | undefined,
): Set<string> {
  const propertyNames = new Set<string>();
  const pending = binding ? [binding] : [];
  const seen = new Set<RuntimeBinding>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate.kind === "one-of") {
      pending.push(...candidate.bindings);
      continue;
    }
    if (candidate.kind !== "namespace-object") continue;
    for (const propertyName of candidate.properties.keys()) {
      propertyNames.add(propertyName);
    }
    for (const operation of candidate.propertyOperations ?? []) {
      if (operation.kind === "define") {
        propertyNames.add(operation.name);
      } else if (operation.kind === "spread") {
        pending.push(operation.binding);
      }
    }
  }
  return propertyNames;
}

function conservativeModuleEffects(
  source: string,
): readonly SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  if (isFilesystemSpecifier(source)) {
    effects.push("filesystem-read", "filesystem-watch", "filesystem-write");
  }
  if (isProcessSpecifier(source)) effects.push("process", "shared-cwd");
  if (isServerSpecifier(source)) effects.push("server", "network");
  if (isDnsSpecifier(source)) effects.push("network");
  if (isPlaywrightSpecifier(source)) effects.push("browser");
  if (isTestingRuntimeSpecifier(source)) {
    effects.push(
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
      "shared-cwd",
    );
  }
  return sortedUnique(effects);
}

function callableMethodInvocationBindings(
  callee: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly Extract<
  RuntimeBinding,
  { readonly kind: "effect" | "filesystem-open" | "reflect-method" }
>[] {
  if (
    callee.type !== "MemberExpression" &&
    callee.type !== "OptionalMemberExpression"
  ) return [];
  const method = memberProperty(callee);
  if (method !== "call" && method !== "apply") return [];
  const binding = runtimeBindingForExpression(callee.object, imports, scopes);
  return flattenRuntimeBindings(binding).filter(isCallableRuntimeBinding);
}

function isCallableRuntimeBinding(
  binding: RuntimeBinding | undefined,
): binding is Extract<
  RuntimeBinding,
  { readonly kind: "effect" | "filesystem-open" | "reflect-method" }
> {
  return binding?.kind === "effect" || binding?.kind === "filesystem-open" ||
    binding?.kind === "reflect-method";
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

function arrayExpressionArguments(args: unknown): readonly unknown[] {
  const value = unwrapExpression(args);
  return value?.type === "ArrayExpression" && Array.isArray(value.elements)
    ? value.elements
    : [{ type: "Identifier", name: "unknownMutationTarget" }];
}

function globalPropertyMutationMarker(
  node: Node,
  line: number,
  scopes: readonly Scope[],
  imports: ImportBindings,
): SemanticMarker | readonly SemanticMarker[] | undefined {
  if (
    node.type === "UnaryExpression" && node.operator === "delete" &&
    isNode(node.argument)
  ) {
    const processMarker = processGlobalMarker(
      node.argument,
      line,
      scopes,
      imports.importedNames,
    );
    if (processMarker) return processMarker;
    return globalRuntimeMemberMutationMarker(
      node.argument,
      line,
      scopes,
      imports.importedNames,
    );
  }
  if (!isCallLikeExpression(node) || !isNode(node.callee)) return undefined;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const invocations = mutationMethodInvocations(
    node.callee,
    args,
    imports,
    scopes,
  );
  if (invocations.length === 0) return undefined;
  const markers = invocations.flatMap(({ binding, calleeName, args }) =>
    mutationCallMarker(
      binding,
      calleeName,
      args,
      line,
      scopes,
      imports,
    ) ?? []
  );
  return markers.length > 0 ? markers : undefined;
}

function mutationMethodInvocations(
  callee: Node,
  args: readonly unknown[],
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly {
  readonly binding: Extract<
    RuntimeBinding,
    { readonly kind: "mutation-method" }
  >;
  readonly calleeName: string;
  readonly args: readonly unknown[];
  readonly target?: unknown;
}[] {
  const directBindings = mutationMethodBindings(callee, imports, scopes);
  if (directBindings.length > 0) {
    const calleeName = callee.type === "Identifier"
      ? callee.name as string
      : memberChain(callee)?.join(".") ?? "mutation";
    return directBindings.map((binding) => ({
      binding,
      calleeName,
      args: binding.receiver === "Array"
        ? [...binding.boundValues ?? [], ...args]
        : args,
      target: binding.receiver === "Array" &&
          binding.boundTarget !== undefined
        ? binding.boundTarget
        : binding.receiver === "Array" &&
            (callee.type === "MemberExpression" ||
              callee.type === "OptionalMemberExpression")
        ? callee.object
        : args[0],
    }));
  }

  const reflectInvocations = reflectInvocationCalls(
    unwrapExpression(callee),
    args,
    imports,
    scopes,
  );
  const reflectedMutations = reflectInvocations.flatMap((invocation) => {
    if (invocation.method !== "apply") return [];
    const target = unwrapExpression(invocation.arguments[0]);
    if (!target) return [];
    const invocationArgs = arrayExpressionArguments(invocation.arguments[2]);
    const arrayInvocationArgs = mutationApplyArguments(
      invocation.arguments[2],
    );
    return mutationMethodBindings(target, imports, scopes).map((binding) => ({
      binding,
      calleeName: `${invocation.symbolPrefix}(${invocationSymbol(target)})`,
      args: binding.receiver === "Array"
        ? [...binding.boundValues ?? [], ...arrayInvocationArgs]
        : invocationArgs,
      target: binding.receiver === "Array"
        ? binding.boundTarget ?? invocation.arguments[1]
        : invocationArgs[0],
    }));
  });
  if (reflectedMutations.length > 0) return reflectedMutations;

  if (
    callee.type !== "MemberExpression" &&
    callee.type !== "OptionalMemberExpression"
  ) {
    return [];
  }
  const method = memberProperty(callee);
  if (method !== "call" && method !== "apply") return [];
  const invocationArgs = method === "apply"
    ? arrayExpressionArguments(args[1])
    : args.slice(1);
  const arrayInvocationArgs = method === "apply"
    ? mutationApplyArguments(args[1])
    : invocationArgs;
  return mutationMethodBindings(callee.object, imports, scopes).map(
    (binding) => ({
      binding,
      calleeName: invocationSymbol(callee),
      args: binding.receiver === "Array"
        ? [...binding.boundValues ?? [], ...arrayInvocationArgs]
        : invocationArgs,
      target: binding.receiver === "Array"
        ? binding.boundTarget ?? args[0]
        : invocationArgs[0],
    }),
  );
}

function mutationApplyArguments(expression: unknown): readonly unknown[] {
  const value = unwrapExpression(expression);
  return value?.type === "ArrayExpression" && Array.isArray(value.elements)
    ? value.elements
    : [runtimeUnknownPropertyExpression(expression)];
}

function mutationMethodBindings(
  expression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly Extract<RuntimeBinding, { readonly kind: "mutation-method" }>[] {
  return flattenRuntimeBindings(
    runtimeBindingForExpression(expression, imports, scopes),
  ).filter((
    candidate,
  ): candidate is Extract<
    RuntimeBinding,
    { readonly kind: "mutation-method" }
  > => candidate.kind === "mutation-method");
}

function mutationMethodBinding(
  receiver: string,
  method: string,
): Extract<RuntimeBinding, { readonly kind: "mutation-method" }> | undefined {
  if (
    (receiver === "Array" || receiver === "Array.prototype") &&
    (ARRAY_SHAPE_MUTATORS.has(method) || method === "*")
  ) {
    return { kind: "mutation-method", receiver: "Array", method };
  }
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
  imports: ImportBindings,
): SemanticMarker | readonly SemanticMarker[] | undefined {
  if (binding.receiver === "Array") {
    if (binding.method !== "sort") return undefined;
    const comparatorBinding = runtimeBindingForExpression(
      args[0],
      imports,
      scopes,
    );
    const markers = callableRuntimeBindingMarkers(
      comparatorBinding,
      `${calleeName}(comparator)`,
      line,
      [unknownRuntimeValueExpression(), unknownRuntimeValueExpression()],
      false,
    );
    return markers.length > 0 ? markers : undefined;
  }
  const canonicalName = `${binding.receiver}.${binding.method}`;
  if (canonicalName === "Object.create") return undefined;
  let setterMarkers: readonly SemanticMarker[] = [];
  let getterMarkers: readonly SemanticMarker[] = [];
  if (canonicalName === "Reflect.set") {
    const property = literalPropertyName(args[1]);
    setterMarkers = memberSetterRuntimeEffectMarkers(
      property === undefined
        ? runtimeUnknownPropertyExpression(args[0])
        : runtimePropertyExpression(args[0], property),
      line,
      imports,
      scopes,
      args[2],
    );
  } else if (canonicalName === "Object.assign") {
    setterMarkers = objectAssignSetterMarkers(args, line, imports, scopes);
    getterMarkers = objectAssignGetterMarkers(args, line, imports, scopes);
  }
  const mutatesSingleProperty = GLOBAL_SINGLE_PROPERTY_MUTATORS.has(
    canonicalName,
  );
  const targetArgument = args[0];
  const target = sharedGlobalMutationTarget(
    targetArgument,
    scopes,
    imports.importedNames,
  );
  const property = mutatesSingleProperty
    ? literalPropertyName(args[1])
    : undefined;
  let mutationMarker: SemanticMarker | undefined;
  if (!target) {
    if (isUnknownMutationTarget(targetArgument)) {
      mutationMarker = {
        effect: "process",
        line,
        symbol: `${calleeName}(*)`,
      };
    }
  } else {
    mutationMarker = {
      effect: mutatesSingleProperty && target.kind === "runtime-root"
        ? globalRuntimeMutationEffect(property)
        : "process",
      line,
      symbol: `${calleeName}(${target.symbol}.${property ?? "*"})`,
    };
  }
  const accessorMarkers = [...getterMarkers, ...setterMarkers];
  return accessorMarkers.length > 0
    ? [...accessorMarkers, ...(mutationMarker ? [mutationMarker] : [])]
    : mutationMarker;
}

function objectAssignGetterMarkers(
  args: readonly unknown[],
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  return args.slice(1).flatMap((source) => {
    const sourceBinding = runtimeBindingForExpression(source, imports, scopes);
    return getterRuntimeEffectMarkers(
      runtimeUnknownPropertyGetterEffectBinding(sourceBinding, true),
      `Object.assign(${
        invocationSymbol(
          unwrapExpression(source) ?? {
            type: "Identifier",
            name: "source",
          },
        )
      } getter)`,
      line,
    );
  });
}

function objectAssignSetterMarkers(
  args: readonly unknown[],
  line: number,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly SemanticMarker[] {
  const markers: SemanticMarker[] = [];
  for (const sourceExpression of args.slice(1)) {
    const source = unwrapExpression(sourceExpression);
    if (!source || source.type !== "ObjectExpression") {
      markers.push(
        ...memberSetterRuntimeEffectMarkers(
          runtimeUnknownPropertyExpression(args[0]),
          line,
          imports,
          scopes,
          unknownRuntimeValueExpression(),
        ),
      );
      continue;
    }
    for (
      const property of Array.isArray(source.properties)
        ? source.properties
        : []
    ) {
      const propertyName = isNode(property)
        ? staticObjectPropertyName(property)
        : undefined;
      markers.push(
        ...memberSetterRuntimeEffectMarkers(
          propertyName === undefined
            ? runtimeUnknownPropertyExpression(args[0])
            : runtimePropertyExpression(args[0], propertyName),
          line,
          imports,
          scopes,
          property.type === "ObjectProperty"
            ? property.value
            : unknownRuntimeValueExpression(),
        ),
      );
    }
  }
  return markers;
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
    if (
      bindingHasGlobalRuntime(resolved.binding) ||
      isGlobalRuntimeReceiver(name, scopes, importedNames)
    ) {
      return { kind: "runtime-root", symbol: name };
    }
    const isSharedObject = bindingHasSharedObject(resolved.binding) ||
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
    bindingHasSharedObject(root.binding) ||
    bindingHasGlobalRuntime(root.binding) ||
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
  if (bindingHasGlobalRuntime(resolved.binding)) return true;
  return (name === "Deno" || name === "process") &&
    !resolved.declared && !importedNames.has(name);
}

function bindingHasGlobalRuntime(binding: RuntimeBinding | undefined): boolean {
  return flattenRuntimeBindings(binding).some((candidate) =>
    candidate.kind === "global-runtime"
  );
}

function bindingHasSharedObject(binding: RuntimeBinding | undefined): boolean {
  return flattenRuntimeBindings(binding).some((candidate) =>
    candidate.kind === "shared-object"
  );
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
  if (isGlobalRuntimeEnvDetailChain(chain, scopes)) return undefined;
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

function isGlobalRuntimeEnvDetailChain(
  chain: readonly string[] | undefined,
  scopes: readonly Scope[],
): boolean {
  return chain !== undefined &&
    chain.length > 2 &&
    chain[1] === "env" &&
    bindingHasGlobalRuntime(resolveLocalBinding(chain[0], scopes).binding);
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
): boolean {
  if (chain === undefined || chain.length <= 2 || chain[1] !== "env") {
    return false;
  }
  if (chain[0] === "Deno" || chain[0] === "process") return true;
  return false;
}

function isRuntimeEnvDetailChain(
  chain: readonly string[] | undefined,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  if (chain === undefined || chain.length <= 2 || chain[1] !== "env") {
    return false;
  }
  const root = runtimeBindingForExpression(
    { type: "Identifier", name: chain[0] },
    imports,
    scopes,
  );
  return bindingHasGlobalRuntime(root);
}

function isRuntimeEnvRootChain(
  chain: readonly string[] | undefined,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  if (chain === undefined || chain.length !== 2 || chain[1] !== "env") {
    return false;
  }
  const root = runtimeBindingForExpression(
    { type: "Identifier", name: chain[0] },
    imports,
    scopes,
  );
  return bindingHasGlobalRuntime(root);
}

function isRuntimeEnvDetailObjectChild(
  parent: Node,
  key: string,
  child: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  return (
    parent.type === "MemberExpression" ||
    parent.type === "OptionalMemberExpression"
  ) &&
    key === "object" &&
    isRuntimeEnvDetailChain(memberChain(parent), imports, scopes) &&
    isRuntimeEnvRootChain(memberChain(child), imports, scopes);
}

function isUnknownMutationTarget(target: unknown): boolean {
  const value = unwrapExpression(target);
  return !value ||
    value.type === "SpreadElement" ||
    (value.type === "Identifier" &&
      (value.name as string) === "unknownMutationTarget");
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
    runtimeNamespaces: new Map(),
    runtimeConstructors: new Map(),
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
          : isNode(specifier.imported)
          ? literalValue(specifier.imported) ?? local
          : local;
      if (importedName === "default" && isRuntimeEffectModule(source)) {
        addRuntimeNamespaceImport(bindings, local, source);
        continue;
      }
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
      if (isTestingRuntimeSpecifier(source)) {
        const effect = effectForModuleMethod(source, importedName);
        if (effect) addEffectImportBinding(bindings, local, effect);
      }
      if (isServerSpecifier(source) && SERVER_METHODS.has(importedName)) {
        bindings.server.add(local);
      }
      if (isServerSpecifier(source) && NETWORK_METHODS.has(importedName)) {
        bindings.network.add(local);
      }
      if (isDnsSpecifier(source) && DNS_NETWORK_METHODS.has(importedName)) {
        bindings.network.add(local);
      }
      if (isDnsSpecifier(source) && importedName === "promises") {
        addRuntimeNamespaceImport(bindings, local, "node:dns/promises");
      }
      if (
        isDnsSpecifier(source) && DNS_RESOLVER_CONSTRUCTORS.has(importedName)
      ) {
        bindings.runtimeConstructors.set(local, source);
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

function addEffectImportBinding(
  bindings: ImportBindings,
  local: string,
  effect: SemanticEffect,
): void {
  if (effect === "filesystem-read") bindings.filesystemRead.add(local);
  else if (effect === "filesystem-watch") {
    bindings.filesystemWatch.add(local);
  } else if (effect === "filesystem-write") {
    bindings.filesystemWrite.add(local);
  } else if (effect === "shared-cwd") bindings.sharedCwd.add(local);
  else if (effect === "process") bindings.process.add(local);
  else if (effect === "server") bindings.server.add(local);
  else if (effect === "network") bindings.network.add(local);
  else if (effect === "browser") bindings.playwright.add(local);
}

function addRuntimeNamespaceImport(
  bindings: ImportBindings,
  local: string,
  source: string,
): void {
  bindings.importedNames.add(local);
  if (isRuntimeEffectModule(source)) {
    bindings.runtimeNamespaces.set(local, source);
  }
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
  if (pathBase === "src/testing/deno-compat") {
    return CANONICAL_TESTING_DENO_COMPAT_SOURCE;
  }
  if (pathBase === "src/testing/index") {
    return CANONICAL_TESTING_BARREL_SOURCE;
  }
  if (pathBase === "src/testing/mock-fetch") {
    return CANONICAL_TESTING_MOCK_FETCH_SOURCE;
  }
  return normalized;
}

function createScope(
  node: Node,
  imports: ImportBindings,
  outerScopes: readonly Scope[],
): Scope {
  const names = new Set<string>();
  const definitelyNonUndefinedNames = new Set<string>();
  const playwrightFixtures = new Set<string>();
  collectLocalDeclaredNames(
    node,
    names,
    definitelyNonUndefinedNames,
    playwrightFixtures,
  );
  if (hasOwnThisRuntimeBinding(node)) names.add(THIS_RUNTIME_ROOT);
  if (isVarHoistScope(node)) collectHoistedVarDeclaredNames(node, names);
  const className = classRuntimeName(node);
  const classReceiver = classRuntimeReceiverForScope(node, outerScopes);
  const scope: Scope = {
    names,
    definitelyNonUndefinedNames,
    functionBoundary: isFunctionScopeNode(node),
    playwrightFixtures,
    runtimeBindings: new Map(),
    runtimeAliases: new Map(),
    classRuntimeBindings: isClassScopeNode(node)
      ? { name: className, memberEntries: new Map() }
      : undefined,
    classReceiver: classReceiver
      ? {
        classScope: classReceiver.classScope,
        kind: classReceiver.kind,
      }
      : undefined,
  };
  if (className) {
    scope.runtimeBindings.set(className, emptyRuntimeNamespaceBinding());
  }
  if (hasOwnThisRuntimeBinding(node)) {
    scope.runtimeBindings.set(
      THIS_RUNTIME_ROOT,
      classReceiver?.binding ??
        emptyRuntimeNamespaceBinding(),
    );
  }
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
  collectClassRuntimeBindings(
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
  definitelyNonUndefinedNames: Set<string>,
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
        const name = statement.id.name as string;
        names.add(name);
        definitelyNonUndefinedNames.add(name);
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
      const name = node.id.name as string;
      names.add(name);
      definitelyNonUndefinedNames.add(name);
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
    const name = node.id.name as string;
    names.add(name);
    definitelyNonUndefinedNames.add(name);
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
  return node.type === "Program" || isFunctionScopeNode(node) ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock";
}

function isFunctionScopeNode(node: Node): boolean {
  return node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod";
}

function isClassScopeNode(node: Node): boolean {
  return node.type === "ClassDeclaration" || node.type === "ClassExpression";
}

function classRuntimeName(node: Node): string | undefined {
  return isClassScopeNode(node) && isNode(node.id) &&
      node.id.type === "Identifier"
    ? node.id.name as string
    : undefined;
}

function hasOwnThisRuntimeBinding(node: Node): boolean {
  return node.type === "StaticBlock" ||
    (isFunctionScopeNode(node) && node.type !== "ArrowFunctionExpression");
}

function emptyRuntimeNamespaceBinding(): Extract<
  RuntimeBinding,
  { readonly kind: "namespace-object" }
> {
  return {
    kind: "namespace-object",
    extensible: true,
    properties: new Map(),
    propertyOperations: [],
  };
}

function runtimeReceiverScope(
  binding?: RuntimeBinding,
  classScope?: Scope,
  kind?: "instance" | "static",
): Scope {
  return {
    names: new Set([THIS_RUNTIME_ROOT]),
    definitelyNonUndefinedNames: new Set([THIS_RUNTIME_ROOT]),
    functionBoundary: false,
    playwrightFixtures: new Set(),
    runtimeBindings: new Map([
      [THIS_RUNTIME_ROOT, binding ?? emptyRuntimeNamespaceBinding()],
    ]),
    runtimeAliases: new Map(),
    classReceiver: classScope && kind ? { classScope, kind } : undefined,
  };
}

function classFieldValueScopes(
  parent: Node,
  key: string,
  scopes: readonly Scope[],
): readonly Scope[] {
  if (
    key !== "value" ||
    (parent.type !== "ClassProperty" &&
      parent.type !== "ClassPrivateProperty")
  ) {
    return scopes;
  }
  for (let index = scopes.length - 1; index >= 0; index--) {
    const classScope = scopes[index];
    const classBindings = classScope.classRuntimeBindings;
    if (!classBindings) continue;
    const receiverKind = parent.static === true ? "static" : "instance";
    const value = unwrapExpression(parent.value);
    const binding = value?.type === "ArrowFunctionExpression"
      ? classBindings[receiverKind]
      : classBindings.memberEntries.get(parent);
    return [
      ...scopes,
      runtimeReceiverScope(binding, classScope, receiverKind),
    ];
  }
  return scopes;
}

function classRuntimeReceiverForScope(
  node: Node,
  scopes: readonly Scope[],
): {
  readonly binding?: RuntimeBinding;
  readonly classScope: Scope;
  readonly kind: "instance" | "static";
} | undefined {
  if (
    node.type !== "ClassMethod" && node.type !== "ClassPrivateMethod" &&
    node.type !== "StaticBlock"
  ) {
    return undefined;
  }
  for (let index = scopes.length - 1; index >= 0; index--) {
    const classScope = scopes[index];
    const classBindings = classScope.classRuntimeBindings;
    if (classBindings) {
      if (node.type === "StaticBlock") {
        return {
          binding: classBindings.memberEntries.get(node),
          classScope,
          kind: "static",
        };
      }
      const kind = node.static === true ? "static" : "instance";
      return { binding: classBindings[kind], classScope, kind };
    }
  }
  return undefined;
}

function collectClassRuntimeBindings(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (!isClassScopeNode(node) || !scope.classRuntimeBindings) return;
  const body = isNode(node.body) && Array.isArray(node.body.body)
    ? node.body.body
    : [];
  for (const member of body) {
    if (!isNode(member)) continue;
    if (member.type === "StaticBlock") {
      scope.classRuntimeBindings.memberEntries.set(
        member,
        scope.classRuntimeBindings.static,
      );
      const blockBinding = summarizeClassStaticBlockRuntimeBinding(
        member,
        imports,
        scopes,
      );
      if (blockBinding) setClassRuntimeBinding(scope, "static", blockBinding);
      continue;
    }
    if (
      (member.type !== "ClassProperty" &&
        member.type !== "ClassPrivateProperty") ||
      member.declare === true || member.abstract === true
    ) {
      continue;
    }
    const name = staticObjectPropertyName(member);
    const hasUnknownComputedName = member.computed === true && !name;
    if (!name && !hasUnknownComputedName) continue;
    const receiverKind = member.static === true ? "static" : "instance";
    const existing = scope.classRuntimeBindings[receiverKind];
    scope.classRuntimeBindings.memberEntries.set(member, existing);
    const receiverScope = runtimeReceiverScope(existing, scope, receiverKind);
    const fieldScopes = [...scopes, receiverScope];
    const binding = runtimeBindingForExpression(
      member.value,
      imports,
      fieldScopes,
    );
    const aliasTargets = runtimeNamespaceAliasTargetsForExpression(
      member.value,
      imports,
      fieldScopes,
    );
    const defaultMayRun = expressionMayBeUndefined(
      member.value,
      binding,
      imports,
      fieldScopes,
    );
    const fieldBinding = name
      ? assignRuntimeProperty(
        existing,
        [name],
        binding,
        defaultMayRun,
        false,
        aliasTargets,
      )
      : assignUnknownRuntimeProperty(
        existing,
        [],
        binding,
        defaultMayRun,
        false,
        aliasTargets,
      );
    const arrowBinding = summarizeClassFieldArrowRuntimeBinding(
      member,
      fieldBinding,
      imports,
      scopes,
    );
    const nextBinding = arrowBinding
      ? unionRuntimeBindings([fieldBinding, arrowBinding]) ?? arrowBinding
      : fieldBinding;
    setClassRuntimeBinding(scope, receiverKind, nextBinding);
    syncClassStaticRuntimeBinding(scope);
  }
  for (const method of body) {
    if (
      !isNode(method) ||
      (method.type !== "ClassMethod" && method.type !== "ClassPrivateMethod")
    ) {
      continue;
    }
    const receiverKind = method.static === true ? "static" : "instance";
    const existing = scope.classRuntimeBindings[receiverKind];
    const methodBinding = summarizeClassMethodRuntimeBinding(
      method,
      imports,
      scopes,
    );
    if (!methodBinding) continue;
    const nextBinding = existing
      ? unionRuntimeBindings([existing, methodBinding]) ?? methodBinding
      : methodBinding;
    setClassRuntimeBinding(scope, receiverKind, nextBinding);
    syncClassStaticRuntimeBinding(scope);
  }
}

function setClassRuntimeBinding(
  scope: Scope,
  kind: "instance" | "static",
  binding: RuntimeBinding,
): void {
  const classBindings = scope.classRuntimeBindings;
  if (!classBindings) return;
  classBindings[kind] = binding;
  if (kind === "static" && classBindings.name) {
    scope.runtimeBindings.set(classBindings.name, binding);
  }
}

function syncClassStaticRuntimeBinding(scope: Scope): void {
  const classBindings = scope.classRuntimeBindings;
  if (!classBindings?.name) return;
  const binding = scope.runtimeBindings.get(classBindings.name);
  if (binding) classBindings.static = binding;
}

function bindRuntimeClassDeclaration(
  node: Node,
  scopes: readonly Scope[],
): void {
  if (
    node.type !== "ClassDeclaration" || !isNode(node.id) ||
    node.id.type !== "Identifier"
  ) {
    return;
  }
  const classScope = scopes.at(-1);
  const outerScope = scopes.at(-2);
  const name = node.id.name as string;
  if (
    !classScope?.classRuntimeBindings ||
    classScope.classRuntimeBindings.name !== name || !outerScope
  ) {
    return;
  }
  const binding = classScope.runtimeBindings.get(name);
  if (binding) outerScope.runtimeBindings.set(name, binding);
}

function summarizeClassStaticBlockRuntimeBinding(
  block: Node,
  imports: ImportBindings,
  classScopes: readonly Scope[],
): RuntimeBinding | undefined {
  const blockScope = createScope(block, imports, classScopes);
  const blockScopes = [...classScopes, blockScope];
  for (const statement of Array.isArray(block.body) ? block.body : []) {
    if (isNode(statement)) {
      visitRuntimeBindingSummary(statement, imports, blockScopes, true);
    }
  }
  return blockScope.runtimeBindings.get(THIS_RUNTIME_ROOT);
}

function summarizeClassMethodRuntimeBinding(
  method: Node,
  imports: ImportBindings,
  classScopes: readonly Scope[],
): RuntimeBinding | undefined {
  const methodScope = createScope(method, imports, classScopes);
  const methodScopes = [...classScopes, methodScope];
  for (const parameter of Array.isArray(method.params) ? method.params : []) {
    if (isNode(parameter)) {
      visitRuntimeBindingSummary(parameter, imports, methodScopes, true);
    }
  }
  if (isNode(method.body)) {
    visitRuntimeBindingSummary(method.body, imports, methodScopes, true);
  }
  return methodScope.runtimeBindings.get(THIS_RUNTIME_ROOT);
}

function summarizeClassFieldArrowRuntimeBinding(
  field: Node,
  receiverBinding: RuntimeBinding,
  imports: ImportBindings,
  classScopes: readonly Scope[],
): RuntimeBinding | undefined {
  const value = unwrapExpression(field.value);
  if (!value || value.type !== "ArrowFunctionExpression") return undefined;
  const classScope = classScopes.at(-1);
  const receiverScope = runtimeReceiverScope(
    receiverBinding,
    classScope?.classRuntimeBindings ? classScope : undefined,
    field.static === true ? "static" : "instance",
  );
  const arrowScope = createScope(
    value,
    imports,
    [...classScopes, receiverScope],
  );
  const arrowScopes = [...classScopes, receiverScope, arrowScope];
  for (const parameter of Array.isArray(value.params) ? value.params : []) {
    if (isNode(parameter)) {
      visitRuntimeBindingSummary(parameter, imports, arrowScopes, true);
    }
  }
  if (isNode(value.body)) {
    visitRuntimeBindingSummary(value.body, imports, arrowScopes, true);
  }
  return receiverScope.runtimeBindings.get(THIS_RUNTIME_ROOT);
}

function visitRuntimeBindingSummary(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  if (isErasedTypeScriptNode(node)) return;
  const nextScopes = SCOPE_NODES.has(node.type)
    ? [...scopes, createScope(node, imports, scopes)]
    : scopes;
  if (node.type === "VariableDeclarator") {
    const scope = nextScopes.at(-1);
    if (scope && declarationBelongsToScope(node, scope)) {
      bindRuntimeDeclaration(
        node,
        imports,
        nextScopes,
        scope,
        !allowClearing,
        allowClearing,
      );
    }
  }
  bindRuntimeClassDeclaration(node, nextScopes);
  bindRuntimeAssignment(node, imports, nextScopes, allowClearing);
  bindRuntimeDeleteMutation(node, imports, nextScopes, allowClearing);
  for (const key of Object.keys(node)) {
    if (
      key === "loc" || COMMENT_KEYS.has(key) ||
      TYPE_ONLY_CHILD_KEYS.has(key)
    ) {
      continue;
    }
    const value = node[key];
    const childAllowsClearing = allowClearing &&
      !isConditionalBranch(node, key);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          visitRuntimeBindingSummary(
            item,
            imports,
            nextScopes,
            childAllowsClearing,
          );
        }
      }
    } else if (isNode(value)) {
      visitRuntimeBindingSummary(
        value,
        imports,
        nextScopes,
        childAllowsClearing,
      );
    }
  }
  bindRuntimeCallMutation(node, imports, nextScopes, allowClearing);
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
  visitVarHoistDeclarations(node, (declaration, isConditional) => {
    for (
      const declarator of Array.isArray(declaration.declarations)
        ? declaration.declarations
        : []
    ) {
      if (isNode(declarator)) {
        bindRuntimeDeclaration(
          declarator,
          imports,
          scopes,
          scope,
          isConditional,
        );
      }
    }
  });
}

function visitVarHoistDeclarations(
  node: Node,
  visitor: (declaration: Node, isConditional: boolean) => void,
): void {
  const visit = (
    current: unknown,
    isRoot = false,
    isConditional = false,
  ): void => {
    if (!isNode(current)) return;
    if (!isRoot && isVarHoistBoundary(current)) return;
    if (current.type === "VariableDeclaration" && current.kind === "var") {
      visitor(current, isConditional);
      return;
    }
    for (const key of Object.keys(current)) {
      if (
        key === "loc" || COMMENT_KEYS.has(key) ||
        TYPE_ONLY_CHILD_KEYS.has(key)
      ) continue;
      const value = current[key];
      const childIsConditional = isConditional ||
        isConditionalBranch(current, key);
      if (Array.isArray(value)) {
        for (const item of value) visit(item, false, childIsConditional);
      } else {
        visit(value, false, childIsConditional);
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
      mergeNamespacePropertyBinding(existingProperty, binding),
    );
  }
  return {
    kind: "namespace-object",
    shape: existing.shape === incoming.shape ? existing.shape : undefined,
    extensible: existing.extensible === incoming.extensible
      ? existing.extensible
      : undefined,
    properties,
  };
}

function mergeNamespacePropertyBinding(
  existing: RuntimeBinding | undefined,
  incoming: RuntimeBinding,
): RuntimeBinding {
  if (
    existing?.kind === "namespace-object" &&
    incoming.kind === "namespace-object"
  ) {
    return mergeRuntimeNamespaceBindings(existing, incoming);
  }
  return existing
    ? unionRuntimeBindings([existing, incoming]) ?? incoming
    : incoming;
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
    bindRuntimeParameterProperty(pattern.parameter, imports, scopes, scope);
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    const binding = runtimeBindingForExpression(pattern.right, imports, scopes);
    if (binding) {
      bindPatternToRuntime(
        pattern.left,
        binding,
        imports,
        scopes,
        scope,
      );
    }
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

function bindRuntimeParameterProperty(
  parameter: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  if (
    !isNode(parameter) || parameter.type !== "AssignmentPattern" ||
    !isNode(parameter.left) || parameter.left.type !== "Identifier"
  ) {
    return;
  }
  const binding = runtimeBindingForExpression(parameter.right, imports, scopes);
  const existing = scope.runtimeBindings.get(THIS_RUNTIME_ROOT);
  if (!existing) return;
  scope.runtimeBindings.set(
    THIS_RUNTIME_ROOT,
    assignRuntimeProperty(
      existing,
      [parameter.left.name as string],
      binding,
      expressionMayBeUndefined(parameter.right, binding, imports, scopes),
      false,
      runtimeNamespaceAliasTargetsForExpression(
        parameter.right,
        imports,
        scopes,
      ),
    ),
  );
}

function bindRuntimeAssignment(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  if (
    node.type !== "AssignmentExpression" ||
    !["=", "&&=", "||=", "??="].includes(String(node.operator)) ||
    !isNode(node.left)
  ) {
    return;
  }
  const canClearPrevious = node.operator === "=" && allowClearing;
  const binding = runtimeBindingForExpression(node.right, imports, scopes);
  const assignedMayBeUndefined = expressionMayBeUndefined(
    node.right,
    binding,
    imports,
    scopes,
  );
  bindRuntimeAlias(
    node.left,
    node.right,
    imports,
    scopes,
    canClearPrevious,
    (name) => declaringScopeForName(name, scopes),
  );
  bindDefinitelyNonUndefinedPattern(
    node.left,
    binding,
    assignedMayBeUndefined,
    imports,
    scopes,
    canClearPrevious,
    (name) => declaringScopeForName(name, scopes),
  );
  if (
    bindRuntimeMemberAssignment(
      node.left,
      binding,
      node.right,
      imports,
      scopes,
      { allowClearing: canClearPrevious },
    )
  ) {
    return;
  }
  if (binding) {
    bindRuntimeAssignmentPattern(
      node.left,
      binding,
      imports,
      scopes,
      !canClearPrevious,
      canClearPrevious,
    );
  } else {
    if (canClearPrevious) {
      clearCurrentScopeRuntimeAssignmentPattern(node.left, scopes);
    }
    bindRuntimePatternDefaults(
      node.left,
      imports,
      scopes,
      (pattern, defaultBinding) =>
        bindRuntimeAssignmentPattern(
          pattern,
          defaultBinding,
          imports,
          scopes,
          !canClearPrevious,
          canClearPrevious,
        ),
    );
  }
}

function bindRuntimeDeleteMutation(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  if (
    node.type !== "UnaryExpression" || node.operator !== "delete" ||
    !isNode(node.argument)
  ) {
    return;
  }
  const member = unwrapExpression(node.argument);
  if (
    !member ||
    (member.type !== "MemberExpression" &&
      member.type !== "OptionalMemberExpression")
  ) return;
  const property = memberProperty(member);
  const receiver = runtimeBindingForExpression(member.object, imports, scopes);
  if (property === undefined || receiver === undefined) return;
  const configurable = runtimePropertyResolution(
    receiver,
    property,
    true,
  ).configurable;
  if (configurable === false) return;
  bindRuntimeMemberAssignment(
    node.argument,
    undefined,
    undefined,
    imports,
    scopes,
    {
      allowClearing: allowClearing && configurable === true,
      clearAccessors: true,
    },
  );
}

function bindRuntimeCallMutation(
  node: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  if (!isCallLikeExpression(node) || !isNode(node.callee)) return;
  const callee = unwrapExpression(node.callee);
  if (!callee) return;
  const args = Array.isArray(node.arguments) ? node.arguments : [];

  for (
    const invocation of mutationMethodInvocations(
      node.callee,
      args,
      imports,
      scopes,
    )
  ) {
    const canonicalName =
      `${invocation.binding.receiver}.${invocation.binding.method}`;
    if (invocation.binding.receiver === "Array") {
      if (invocation.target === undefined) continue;
      if (
        invocation.binding.method === "pop" ||
        invocation.binding.method === "shift"
      ) {
        bindRuntimeArrayRemovalMutation(
          invocation.target,
          invocation.binding.method,
          imports,
          scopes,
          allowClearing,
        );
        continue;
      }
      const movesExistingValues = arrayMutationMayMoveExistingValues(
        invocation.binding.method,
        invocation.args,
      );
      if (movesExistingValues) {
        bindRuntimeArrayShapeMutation(
          invocation.target,
          imports,
          scopes,
        );
      }
      const inserted = arrayMutationInsertedExpressions(
        invocation.binding.method,
        invocation.args,
      );
      if (inserted.length === 0) {
        if (
          !movesExistingValues &&
          invocation.binding.method !== "push" &&
          invocation.binding.method !== "unshift"
        ) {
          bindRuntimeUnknownPropertyMutation(
            invocation.target,
            undefined,
            imports,
            scopes,
            0,
          );
        }
      } else {
        for (const expression of inserted) {
          bindRuntimeUnknownPropertyMutation(
            invocation.target,
            expression,
            imports,
            scopes,
            0,
          );
        }
      }
      continue;
    }
    const target = invocation.args[0];
    if (OBJECT_EXTENSIBILITY_MUTATORS.has(canonicalName)) {
      bindRuntimeExtensibilityMutation(target, imports, scopes);
      continue;
    }
    if (!LOCAL_PROPERTY_MUTATORS.has(canonicalName)) continue;
    if (isPrototypeMutation(canonicalName)) {
      bindRuntimePrototypeMutation(
        target,
        invocation.args[1],
        imports,
        scopes,
        canonicalName === "Object.setPrototypeOf" && allowClearing,
      );
      continue;
    }
    if (
      canonicalName === "Object.defineProperties" &&
      bindRuntimeLiteralDescriptorMutations(
        target,
        invocation.args[1],
        imports,
        scopes,
        allowClearing,
      )
    ) {
      continue;
    }
    const mutationAllowsClearing = allowClearing &&
      runtimePropertyMutationAllowsClearing(
        canonicalName,
        target,
        literalPropertyName(invocation.args[1]),
        invocation.args[2],
        imports,
        scopes,
      );
    const targetBinding = runtimeBindingForExpression(target, imports, scopes);
    const descriptorMutations = localMutationAccessorDescriptors(
      canonicalName,
      invocation.args,
    ).map((accessor) => ({
      ...accessor,
      attributes: runtimeDescriptorMutationAttributes(
        targetBinding,
        accessor.property,
        accessor.descriptor,
      ),
    }));
    for (const accessor of descriptorMutations) {
      if (mutationAllowsClearing) {
        clearRuntimeDescriptorProperty(
          target,
          accessor.property,
          accessor.descriptor,
          imports,
          scopes,
          accessor.attributes,
        );
      }
    }
    const assigned = localMutationAssignedEntries(
      canonicalName,
      invocation.args,
    );
    if (canonicalName === "Object.assign" && assigned.length === 0) continue;
    if (assigned.length === 0 && descriptorMutations.length === 0) {
      bindRuntimeUnknownPropertyMutation(
        target,
        undefined,
        imports,
        scopes,
      );
      continue;
    }
    const mutationTarget = canonicalName === "Reflect.set" &&
        invocation.args.length >= 4
      ? invocation.args[3]
      : target;
    for (const entry of assigned) {
      const attributes = descriptorMutations.find((descriptor) =>
        descriptor.property === entry.property
      )?.attributes;
      const binding = localMutationAssignedEntryBinding(
        entry,
        imports,
        scopes,
      );
      if (entry.property !== undefined) {
        bindRuntimeNamedPropertyMutationBinding(
          mutationTarget,
          entry.property,
          binding,
          entry.expression,
          imports,
          scopes,
          {
            allowClearing: entry.definiteOverwrite === true &&
              mutationAllowsClearing,
            enumerable: attributes ? attributes.enumerable : entry.enumerable,
            configurable: attributes
              ? attributes.configurable
              : entry.configurable,
          },
        );
      } else {
        bindRuntimeUnknownPropertyMutationBinding(
          mutationTarget,
          binding,
          entry.expression,
          imports,
          scopes,
        );
      }
    }
    for (const accessor of descriptorMutations) {
      bindRuntimeAccessorMutation(
        target,
        accessor.property,
        accessor.descriptor,
        imports,
        scopes,
        accessor.attributes,
      );
    }
  }
}

function bindRuntimeExtensibilityMutation(
  target: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): void {
  for (
    const alias of runtimeNamespaceAliasTargetsForExpression(
      target,
      imports,
      scopes,
    )
  ) {
    const existing = alias.scope.runtimeBindings.get(alias.root);
    if (!existing) continue;
    alias.scope.runtimeBindings.set(
      alias.root,
      withRuntimeExtensibility(existing, false),
    );
    if (
      alias.root !== THIS_RUNTIME_ROOT &&
      alias.scope.classRuntimeBindings?.name === alias.root
    ) {
      syncClassStaticRuntimeBinding(alias.scope);
    }
  }
}

function runtimePropertyMutationAllowsClearing(
  canonicalName: string,
  target: unknown,
  property: string | undefined,
  descriptor: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  if (
    canonicalName !== "Object.defineProperty" &&
    canonicalName !== "Reflect.defineProperty"
  ) return true;
  if (property === undefined) return false;
  const targetBinding = runtimeBindingForExpression(target, imports, scopes);
  if (!targetBinding) return false;
  return runtimeDescriptorDefinitionAllowsClearing(
    targetBinding,
    property,
    descriptor,
  );
}

function bindRuntimeArrayShapeMutation(
  target: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): void {
  const targetBinding = runtimeBindingForExpression(target, imports, scopes);
  const existingElements = targetBinding
    ? runtimeUnknownPropertyResolution(targetBinding).binding
    : undefined;
  bindRuntimeUnknownPropertyMutationBinding(
    target,
    existingElements,
    runtimeUnknownPropertyExpression(target),
    imports,
    scopes,
    { minimumArrayIndex: 0 },
  );
}

function bindRuntimeArrayRemovalMutation(
  target: unknown,
  method: "pop" | "shift",
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): void {
  const targetBinding = runtimeBindingForExpression(target, imports, scopes);
  const exactLength = exactRuntimeArrayLength(targetBinding);
  const receiver = unwrapExpression(target);
  if (!targetBinding || exactLength === undefined || !receiver) {
    if (method === "pop") {
      bindRuntimeUnknownPropertyMutation(target, undefined, imports, scopes, 0);
    } else {
      bindRuntimeArrayShapeMutation(target, imports, scopes);
    }
    return;
  }
  if (exactLength === 0) return;
  const removedProperty = runtimePropertyResolution(
    targetBinding,
    String(exactLength - 1),
    true,
  );
  const removalAllowsClearing = allowClearing &&
    runtimeBindingExtensibility(targetBinding) === true &&
    removedProperty.configurable === true;
  if (method === "shift") {
    const shifted = Array.from({ length: exactLength - 1 }, (_, index) => {
      const sourceIndex = String(index + 1);
      return {
        index: String(index),
        binding: runtimePropertyResolution(targetBinding, sourceIndex).binding,
        expression: runtimePropertyExpression(receiver, sourceIndex),
      };
    });
    for (const entry of shifted) {
      bindRuntimeNamedPropertyMutationBinding(
        target,
        entry.index,
        entry.binding,
        entry.expression,
        imports,
        scopes,
        { allowClearing: removalAllowsClearing },
      );
    }
  }
  bindRuntimeNamedPropertyMutationBinding(
    target,
    String(exactLength - 1),
    undefined,
    undefined,
    imports,
    scopes,
    { allowClearing: removalAllowsClearing },
  );
  bindRuntimeNamedPropertyMutationBinding(
    target,
    "length",
    undefined,
    undefined,
    imports,
    scopes,
  );
}

function arrayMutationMayMoveExistingValues(
  method: string,
  args: readonly unknown[],
): boolean {
  if (method === "copyWithin") return args.length >= 1;
  if (method === "splice" || method === "unshift") return args.length > 0;
  return method === "*" || method === "reverse" || method === "sort";
}

function mutationReturnsTarget(
  binding: Extract<RuntimeBinding, { readonly kind: "mutation-method" }>,
): boolean {
  return binding.receiver === "Array"
    ? ARRAY_RECEIVER_RETURNING_MUTATORS.has(binding.method)
    : binding.receiver === "Object" &&
      OBJECT_RECEIVER_RETURNING_MUTATORS.has(binding.method);
}

function mutationCallResultRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (!isCallLikeExpression(value) || !isNode(value.callee)) return undefined;
  const args = Array.isArray(value.arguments) ? value.arguments : [];
  const results: RuntimeBinding[] = [];
  for (
    const invocation of mutationMethodInvocations(
      value.callee,
      args,
      imports,
      scopes,
    )
  ) {
    const targetBinding = runtimeBindingForExpression(
      invocation.target,
      imports,
      scopes,
    );
    if (
      invocation.binding.receiver === "Array" &&
      (invocation.binding.method === "pop" ||
        invocation.binding.method === "shift")
    ) {
      const exactRemoved = exactArrayElementRemovalResult(
        invocation.binding.method,
        targetBinding,
      );
      if (exactRemoved.exact) {
        if (exactRemoved.binding) results.push(exactRemoved.binding);
        continue;
      }
      const removed = targetBinding
        ? runtimeUnknownPropertyResolution(targetBinding).binding
        : undefined;
      if (removed) results.push(removed);
      continue;
    }
    if (
      invocation.binding.receiver === "Array" &&
      invocation.binding.method === "splice"
    ) {
      const exactRemoved = exactArraySpliceResult(
        targetBinding,
        invocation.args,
      );
      if (exactRemoved) {
        results.push(exactRemoved);
        continue;
      }
      const removed = targetBinding
        ? runtimeUnknownPropertyResolution(targetBinding).binding
        : undefined;
      results.push({
        kind: "namespace-object",
        shape: "array",
        properties: new Map(),
        propertyOperations: removed
          ? [{
            kind: "define-unknown",
            binding: removed,
            defaultMayRun: true,
            crossesFunctionBoundary: false,
          }]
          : undefined,
      });
      continue;
    }
    const canonicalName =
      `${invocation.binding.receiver}.${invocation.binding.method}`;
    if (
      canonicalName !== "Object.create" &&
      !mutationReturnsTarget(invocation.binding)
    ) continue;
    let result = canonicalName === "Object.create"
      ? emptyRuntimeNamespaceBinding()
      : targetBinding ?? emptyRuntimeNamespaceBinding();
    if (canonicalName === "Object.create") {
      result = appendRuntimeMutationResultProperty(
        result,
        undefined,
        runtimePrototypeMutationBinding(
          invocation.args[0],
          imports,
          scopes,
        ),
        {
          preservesPrevious: false,
          fallbackOnly: true,
          replacesFallback: true,
        },
      );
    }
    if (
      canonicalName === "Object.freeze" ||
      canonicalName === "Object.preventExtensions" ||
      canonicalName === "Object.seal"
    ) {
      result = withRuntimeExtensibility(result, false);
    }
    const descriptorMutations = invocation.binding.receiver === "Object"
      ? localMutationAccessorDescriptors(canonicalName, invocation.args).map(
        (accessor) => ({
          ...accessor,
          attributes: runtimeDescriptorMutationAttributes(
            result,
            accessor.property,
            accessor.descriptor,
          ),
        }),
      )
      : [];
    if (invocation.binding.receiver === "Object") {
      for (const accessor of descriptorMutations) {
        result = clearRuntimeDescriptorResultProperty(
          result,
          accessor.property,
          accessor.descriptor,
          accessor.attributes,
        );
      }
      if (canonicalName === "Object.setPrototypeOf") {
        result = appendRuntimeMutationResultProperty(
          result,
          undefined,
          runtimePrototypeMutationBinding(
            invocation.args[1],
            imports,
            scopes,
          ),
          {
            preservesPrevious: false,
            fallbackOnly: true,
            replacesFallback: true,
          },
        );
      } else if (canonicalName === "Object.assign") {
        for (const source of invocation.args.slice(1)) {
          const sourceBinding = runtimeBindingForExpression(
            source,
            imports,
            scopes,
          );
          const getterEnumerabilities = sourceBinding
            ? runtimeBindingHasPartialAlternative(sourceBinding)
              ? []
              : runtimeUnknownGetterEnumerabilities(sourceBinding)
            : [];
          if (sourceBinding && getterEnumerabilities.length > 0) {
            for (const property of namespacePropertyNames(sourceBinding)) {
              const sourceResolution = runtimePropertyResolution(
                sourceBinding,
                property,
                true,
                true,
              );
              if (sourceResolution.enumerable === false) continue;
              const preservesSetter = runtimePropertySetterBinding(
                result,
                property,
              ) !== undefined;
              const definitelyCopies = sourceResolution.enumerable === true &&
                !sourceResolution.defaultMayRun;
              result = appendRuntimeMutationResultProperty(
                result,
                property,
                runtimeEnumerablePropertyBinding(sourceBinding, property),
                {
                  preservesPrevious: preservesSetter || !definitelyCopies,
                  allowClearing: !preservesSetter && definitelyCopies,
                  configurable: definitelyCopies ? true : undefined,
                  enumerable: definitelyCopies ? true : undefined,
                },
              );
            }
            continue;
          }
          for (
            const entry of localMutationResultAssignedEntries(
              canonicalName,
              [invocation.args[0], source],
            )
          ) {
            const preservesSetter = entry.property !== undefined &&
              runtimePropertySetterBinding(result, entry.property) !==
                undefined;
            result = appendRuntimeMutationResultProperty(
              result,
              entry.property,
              localMutationAssignedEntryBinding(entry, imports, scopes),
              {
                preservesPrevious: preservesSetter,
                allowClearing: entry.definiteOverwrite === true &&
                  !preservesSetter,
                configurable: entry.configurable,
                enumerable: entry.enumerable,
              },
            );
          }
        }
      } else {
        for (
          const entry of localMutationResultAssignedEntries(
            canonicalName,
            invocation.args,
          )
        ) {
          const attributes = descriptorMutations.find((descriptor) =>
            descriptor.property === entry.property
          )?.attributes;
          result = appendRuntimeMutationResultProperty(
            result,
            entry.property,
            localMutationAssignedEntryBinding(entry, imports, scopes),
            {
              preservesPrevious: false,
              allowClearing: entry.definiteOverwrite === true,
              configurable: attributes
                ? attributes.configurable
                : entry.configurable,
              enumerable: attributes ? attributes.enumerable : entry.enumerable,
            },
          );
        }
      }
    } else {
      const assigned = arrayMutationInsertedExpressions(
        invocation.binding.method,
        invocation.args,
      );
      const assignedBindings = assigned.flatMap((expression) =>
        runtimeBindingForExpression(expression, imports, scopes) ?? []
      );
      const carried = assignedBindings.length > 0
        ? assignedBindings
        : targetBinding
        ? [runtimeUnknownPropertyResolution(targetBinding).binding].flatMap((
          binding,
        ) => binding ?? [])
        : [];
      for (const binding of carried) {
        result = appendRuntimePropertyOperation(result, {
          kind: "define-unknown",
          binding,
          defaultMayRun: true,
          crossesFunctionBoundary: false,
        });
      }
    }
    if (invocation.binding.receiver === "Object") {
      for (const accessor of descriptorMutations) {
        const accessors = runtimeDescriptorAccessorExpressions(
          accessor.descriptor,
        );
        const { configurable, enumerable } = accessor.attributes;
        const getterInvocationBinding = unionRuntimeBindings([
          ...accessors.getterInvocationExpressions.flatMap((expression) =>
            runtimeBindingForExpression(expression, imports, scopes) ?? []
          ),
          ...(accessors.getterInvocationUnknown
            ? [conservativeSemanticEffectBinding()]
            : []),
        ]);
        result = appendRuntimeMutationResultProperty(
          result,
          accessor.property,
          getterInvocationBinding
            ? {
              kind: "property-getter-effect",
              binding: getterInvocationBinding,
              enumerable,
            }
            : undefined,
          {
            preservesPrevious: true,
            configurable,
            enumerable,
          },
        );
        const getterBinding = unionRuntimeBindingsPreservingPartial([
          ...accessors.getterExpressions.flatMap((expression) =>
            runtimeBindingForExpression(expression, imports, scopes) ?? []
          ),
          ...(accessors.getterUnknown
            ? [conservativeSemanticEffectBinding()]
            : []),
        ]);
        result = appendRuntimeMutationResultProperty(
          result,
          accessor.property,
          getterBinding
            ? {
              kind: "property-getter-value",
              binding: getterBinding,
              enumerable,
            }
            : undefined,
          {
            preservesPrevious: getterInvocationBinding !== undefined,
            configurable,
            enumerable,
          },
        );
        const setterBinding = unionRuntimeBindings([
          ...accessors.setterExpressions.flatMap((expression) =>
            runtimeBindingForExpression(expression, imports, scopes) ?? []
          ),
          ...(accessors.setterUnknown
            ? [conservativeSemanticEffectBinding()]
            : []),
        ]);
        result = appendRuntimeMutationResultProperty(
          result,
          accessor.property,
          setterBinding
            ? { kind: "property-setter", binding: setterBinding }
            : undefined,
          {
            preservesPrevious: getterBinding !== undefined,
            configurable,
            enumerable,
          },
        );
      }
    }
    results.push(result);
  }
  return unionRuntimeBindings(results);
}

function exactArrayElementRemovalResult(
  method: "pop" | "shift",
  binding: RuntimeBinding | undefined,
): { readonly exact: boolean; readonly binding?: RuntimeBinding } {
  const length = exactRuntimeArrayLength(binding);
  if (length === undefined || !binding) return { exact: false };
  if (length === 0) return { exact: true };
  const index = method === "pop" ? length - 1 : 0;
  return {
    exact: true,
    binding: runtimePropertyResolution(binding, String(index)).binding,
  };
}

function exactArraySpliceResult(
  binding: RuntimeBinding | undefined,
  args: readonly unknown[],
): RuntimeBinding | undefined {
  const length = exactRuntimeArrayLength(binding);
  const startValue = finiteNumericLiteral(args[0]);
  if (length === undefined || !binding || startValue === undefined) {
    return undefined;
  }
  const integerStart = Math.trunc(startValue);
  const start = integerStart < 0
    ? Math.max(length + integerStart, 0)
    : Math.min(integerStart, length);
  let deleteCount = length - start;
  if (args.length > 1) {
    const deleteValue = finiteNumericLiteral(args[1]);
    if (deleteValue === undefined) return undefined;
    deleteCount = Math.min(
      Math.max(Math.trunc(deleteValue), 0),
      length - start,
    );
  }
  const properties = new Map<string, RuntimeBinding>();
  for (let index = 0; index < deleteCount; index++) {
    const removed = runtimePropertyResolution(
      binding,
      String(start + index),
    ).binding;
    if (removed) properties.set(String(index), removed);
  }
  return {
    kind: "namespace-object",
    shape: "array",
    exactArrayLength: deleteCount,
    properties,
  };
}

function finiteNumericLiteral(value: unknown): number | undefined {
  const literal = unwrapExpression(value);
  const number = literal?.type === "NumericLiteral"
    ? literal.value as number
    : literal?.type === "UnaryExpression" && literal.operator === "-" &&
        isNode(literal.argument) && literal.argument.type === "NumericLiteral"
    ? -(literal.argument.value as number)
    : undefined;
  if (number === undefined) return undefined;
  return Number.isFinite(number) ? number : undefined;
}

interface RuntimeMutationResultPropertyOptions {
  readonly preservesPrevious: boolean;
  readonly allowClearing?: boolean;
  readonly configurable?: boolean;
  readonly enumerable?: boolean;
  readonly fallbackOnly?: boolean;
  readonly replacesFallback?: boolean;
}

function appendRuntimeMutationResultProperty(
  existing: RuntimeBinding,
  property: string | undefined,
  binding: RuntimeBinding | undefined,
  options: RuntimeMutationResultPropertyOptions,
): RuntimeBinding {
  if (
    !binding && (property === undefined || !options.allowClearing) &&
    !options.replacesFallback
  ) {
    return existing;
  }
  return appendRuntimePropertyOperation(
    existing,
    property === undefined
      ? {
        kind: "define-unknown",
        binding,
        defaultMayRun: true,
        crossesFunctionBoundary: false,
        fallbackOnly: options.fallbackOnly,
        replacesFallback: options.replacesFallback,
      }
      : {
        kind: "define",
        name: property,
        binding,
        defaultMayRun: false,
        preservesPrevious: options.preservesPrevious,
        crossesFunctionBoundary: false,
        enumerable: options.enumerable,
        configurable: options.configurable,
      },
  );
}

function arrayMutationInsertedExpressions(
  method: string,
  args: readonly unknown[],
): readonly unknown[] {
  const inserted = method === "push" || method === "unshift" || method === "*"
    ? args
    : method === "splice"
    ? args.slice(2)
    : method === "fill"
    ? args.slice(0, 1)
    : [];
  return inserted.map(runtimeSpreadValueExpression);
}

interface LocalMutationAssignedEntry {
  readonly property?: string;
  readonly expression: unknown;
  readonly unknownSource?: unknown;
  readonly copySource?: unknown;
  readonly definiteOverwrite?: boolean;
  readonly enumerable?: boolean;
  readonly configurable?: boolean;
  readonly copyEnumerableOnly?: boolean;
}

function localMutationAssignedEntries(
  canonicalName: string,
  args: readonly unknown[],
): readonly LocalMutationAssignedEntry[] {
  if (canonicalName === "Object.assign") {
    return args.slice(1).flatMap((sourceExpression) => {
      const source = unwrapExpression(sourceExpression);
      if (source?.type !== "ObjectExpression") {
        return [{
          expression: runtimeUnknownPropertyExpression(sourceExpression),
          unknownSource: sourceExpression,
          copyEnumerableOnly: true,
        }];
      }
      return (Array.isArray(source.properties) ? source.properties : []).map(
        (property) => {
          const propertyName = isNode(property)
            ? staticObjectPropertyName(property)
            : undefined;
          if (propertyName !== undefined) {
            return {
              property: propertyName,
              expression: runtimePropertyExpression(
                sourceExpression,
                propertyName,
              ),
              copySource: sourceExpression,
              definiteOverwrite: true,
            };
          }
          const unknownSource = isNode(property) &&
              property.type === "SpreadElement" && isNode(property.argument)
            ? property.argument
            : sourceExpression;
          return {
            expression: runtimeUnknownPropertyExpression(unknownSource),
            unknownSource,
            copyEnumerableOnly: true,
          };
        },
      );
    });
  }
  if (canonicalName === "Object.defineProperties") {
    return [{
      expression: runtimePropertyExpression(
        runtimeUnknownPropertyExpression(args[1]),
        "value",
      ),
    }];
  }
  if (
    canonicalName === "Object.defineProperty" ||
    canonicalName === "Reflect.defineProperty"
  ) {
    const fields = runtimeDescriptorDefinedFields(args[2]);
    if (fields && !fields.has("value")) return [];
    return [{
      property: literalPropertyName(args[1]),
      expression: runtimeDescriptorValueExpression(args[2]),
      definiteOverwrite: runtimeDescriptorDefinesField(args[2], "value"),
      enumerable: runtimeDescriptorEnumerable(args[2]),
      configurable: runtimeDescriptorConfigurable(args[2]),
    }];
  }
  if (canonicalName === "Reflect.set") {
    return [{
      property: literalPropertyName(args[1]),
      expression: args[2],
    }];
  }
  if (canonicalName === "Reflect.deleteProperty") {
    return [{
      property: literalPropertyName(args[1]),
      expression: undefined,
    }];
  }
  return [];
}

function localMutationAssignedEntryBinding(
  entry: LocalMutationAssignedEntry,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (entry.copySource !== undefined && entry.property !== undefined) {
    const sourceBinding = runtimeBindingForExpression(
      entry.copySource,
      imports,
      scopes,
    );
    if (sourceBinding) {
      return runtimeEnumerablePropertyBinding(
        sourceBinding,
        entry.property,
      );
    }
  }
  if (entry.copyEnumerableOnly && entry.unknownSource !== undefined) {
    const sourceBinding = runtimeBindingForExpression(
      entry.unknownSource,
      imports,
      scopes,
    );
    if (sourceBinding && runtimeBindingHasPartialAlternative(sourceBinding)) {
      return conservativeSemanticEffectBinding();
    }
    const copied = sourceBinding
      ? runtimeUnknownPropertyResolution(sourceBinding, true).binding
      : undefined;
    if (copied) return copied;
    const source = unwrapExpression(entry.unknownSource);
    const sourceName = source?.type === "Identifier" &&
        typeof source.name === "string"
      ? source.name
      : undefined;
    const sourceIsStable = source?.type === "ObjectExpression" ||
      sourceName !== undefined &&
        resolveLocalBinding(sourceName, scopes).definitelyNonUndefined === true;
    const sourceIsFullyModeled = sourceIsStable &&
      sourceBinding !== undefined &&
      flattenRuntimeBindings(sourceBinding).every((candidate) =>
        candidate.kind === "namespace-object"
      );
    return sourceIsFullyModeled
      ? undefined
      : conservativeSemanticEffectBinding();
  }
  const binding = runtimeBindingForExpression(
    entry.expression,
    imports,
    scopes,
  );
  if (binding || entry.unknownSource === undefined) return binding;
  return conservativeSemanticEffectBinding();
}

function localMutationResultAssignedEntries(
  canonicalName: string,
  args: readonly unknown[],
): readonly LocalMutationAssignedEntry[] {
  if (
    canonicalName === "Object.create" ||
    canonicalName === "Object.defineProperties"
  ) {
    const descriptors = unwrapExpression(args[1]);
    if (descriptors?.type === "ObjectExpression") {
      const properties = Array.isArray(descriptors.properties)
        ? descriptors.properties
        : [];
      const entries: LocalMutationAssignedEntry[] = [];
      for (
        const property of properties
      ) {
        if (!isNode(property) || property.type !== "ObjectProperty") break;
        const propertyName = staticObjectPropertyName(property);
        if (propertyName === undefined) break;
        entries.push({
          property: propertyName,
          expression: runtimeDescriptorValueExpression(property.value),
          definiteOverwrite: runtimeDescriptorDefinesField(
            property.value,
            "value",
          ),
          enumerable: runtimeDescriptorEnumerable(property.value),
          configurable: runtimeDescriptorConfigurable(property.value),
        });
      }
      if (entries.length === properties.length) return entries;
    }
  }
  return localMutationAssignedEntries(canonicalName, args);
}

function bindRuntimeLiteralDescriptorMutations(
  target: unknown,
  descriptors: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  allowClearing: boolean,
): boolean {
  const descriptorMap = unwrapExpression(descriptors);
  if (!descriptorMap || descriptorMap.type !== "ObjectExpression") return false;
  for (
    const property of Array.isArray(descriptorMap.properties)
      ? descriptorMap.properties
      : []
  ) {
    const descriptor = isNode(property) && property.type === "ObjectProperty"
      ? property.value
      : undefined;
    const propertyName = isNode(property)
      ? staticObjectPropertyName(property)
      : undefined;
    const assignedExpression = runtimeDescriptorValueExpression(descriptor);
    const targetBinding = runtimeBindingForExpression(target, imports, scopes);
    const attributes = runtimeDescriptorMutationAttributes(
      targetBinding,
      propertyName,
      descriptor,
    );
    if (
      allowClearing && targetBinding && propertyName &&
      runtimeDescriptorDefinitionAllowsClearing(
        targetBinding,
        propertyName,
        descriptor,
      )
    ) {
      clearRuntimeDescriptorProperty(
        target,
        propertyName,
        descriptor,
        imports,
        scopes,
        attributes,
      );
    }
    const fields = runtimeDescriptorDefinedFields(descriptor);
    if (propertyName && (!fields || fields.has("value"))) {
      bindRuntimeNamedPropertyMutation(
        target,
        propertyName,
        assignedExpression,
        imports,
        scopes,
        attributes.enumerable,
        attributes.configurable,
      );
    } else if (!propertyName) {
      bindRuntimeUnknownPropertyMutation(
        target,
        assignedExpression,
        imports,
        scopes,
      );
    }
    bindRuntimeAccessorMutation(
      target,
      propertyName,
      descriptor,
      imports,
      scopes,
      attributes,
    );
  }
  return true;
}

function isPrototypeMutation(canonicalName: string): boolean {
  return canonicalName === "Object.setPrototypeOf" ||
    canonicalName === "Reflect.setPrototypeOf";
}

function bindRuntimePrototypeMutation(
  target: unknown,
  prototype: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  replaceFallback: boolean,
): void {
  const propertyExpression = runtimeUnknownPropertyExpression(prototype);
  const binding = runtimePrototypeMutationBinding(
    prototype,
    imports,
    scopes,
  );
  bindRuntimeUnknownPropertyMutationBinding(
    target,
    binding,
    propertyExpression,
    imports,
    scopes,
    { fallbackOnly: true, replacesFallback: replaceFallback },
  );
}

function runtimePrototypeMutationBinding(
  prototype: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  const prototypeBinding = runtimeBindingForExpression(
    prototype,
    imports,
    scopes,
  );
  const prototypeExpression = unwrapExpression(prototype);
  const prototypeIsKnown = prototypeBinding !== undefined ||
    prototypeExpression?.type === "NullLiteral";
  if (!prototypeBinding) {
    return prototypeIsKnown ? undefined : conservativeSemanticEffectBinding();
  }
  const getterEffect = runtimeUnknownPropertyGetterEffectBinding(
    prototypeBinding,
  );
  const setter = runtimeUnknownPropertySetterBinding(prototypeBinding);
  const getterBinding: RuntimeBinding | undefined = getterEffect
    ? { kind: "property-getter-effect", binding: getterEffect }
    : undefined;
  const setterBinding: RuntimeBinding | undefined = setter
    ? { kind: "property-setter", binding: setter }
    : undefined;
  return unionRuntimeBindings([
    runtimeUnknownPropertyResolution(prototypeBinding).binding,
    getterBinding,
    setterBinding,
  ].flatMap((binding) => binding ?? []));
}

function conservativeSemanticEffectBinding(): RuntimeBinding {
  return {
    kind: "one-of",
    bindings: ALL_SEMANTIC_EFFECTS.map((effect) => ({
      kind: "effect",
      effect,
    })),
  };
}

function localMutationAccessorDescriptors(
  canonicalName: string,
  args: readonly unknown[],
): readonly {
  readonly property?: string;
  readonly descriptor?: unknown;
}[] {
  if (
    canonicalName === "Object.defineProperty" ||
    canonicalName === "Reflect.defineProperty"
  ) {
    const property = literalPropertyName(args[1]);
    return [{
      property,
      descriptor: args[2],
    }];
  }
  if (
    canonicalName !== "Object.create" &&
    canonicalName !== "Object.defineProperties"
  ) return [];
  if (canonicalName === "Object.create" && args.length < 2) return [];
  const descriptors = unwrapExpression(args[1]);
  if (!descriptors || descriptors.type !== "ObjectExpression") {
    return [{}];
  }
  return (Array.isArray(descriptors.properties) ? descriptors.properties : [])
    .map((property) =>
      isNode(property) && property.type === "ObjectProperty"
        ? {
          property: staticObjectPropertyName(property),
          descriptor: property.value,
        }
        : {}
    );
}

interface RuntimeDescriptorAttributes {
  readonly configurable?: boolean;
  readonly enumerable?: boolean;
}

function runtimeDescriptorMutationAttributes(
  target: RuntimeBinding | undefined,
  property: string | undefined,
  descriptor: unknown,
): RuntimeDescriptorAttributes {
  if (!target || property === undefined) return {};
  const fields = runtimeDescriptorDefinedFields(descriptor);
  if (!fields) return {};
  const existing = runtimePropertyResolution(target, property, true);
  const definitelyAbsent = runtimeOwnPropertyDefinitelyAbsent(
    target,
    property,
  );
  const attribute = (
    field: "configurable" | "enumerable",
  ): boolean | undefined =>
    fields.has(field)
      ? runtimeDescriptorBooleanField(descriptor, field)
      : definitelyAbsent
      ? false
      : !existing.defaultMayRun
      ? existing[field]
      : undefined;
  return {
    configurable: attribute("configurable"),
    enumerable: attribute("enumerable"),
  };
}

function runtimeDescriptorCreatesOwnProperty(
  target: RuntimeBinding,
  property: string,
  descriptor: unknown,
): boolean {
  return runtimeDescriptorDefinedFields(descriptor) !== undefined &&
    runtimeOwnPropertyDefinitelyAbsent(target, property) &&
    runtimeBindingExtensibility(target) === true;
}

function runtimeDescriptorDefinitionAllowsClearing(
  target: RuntimeBinding,
  property: string,
  descriptor: unknown,
): boolean {
  return runtimeDescriptorCreatesOwnProperty(target, property, descriptor) ||
    runtimePropertyResolution(target, property, true).configurable === true;
}

function runtimeBindingExtensibility(
  binding: RuntimeBinding,
): boolean | undefined {
  if (binding.kind === "partial") return undefined;
  if (binding.kind === "one-of") {
    const values = binding.bindings.map(runtimeBindingExtensibility);
    return values.every((value) => value === values[0]) ? values[0] : undefined;
  }
  return binding.kind === "namespace-object" ? binding.extensible : undefined;
}

function withRuntimeExtensibility(
  binding: RuntimeBinding,
  extensible: boolean,
): RuntimeBinding {
  if (binding.kind === "partial") {
    return {
      kind: "partial",
      binding: withRuntimeExtensibility(binding.binding, extensible),
    };
  }
  if (binding.kind === "one-of") {
    return {
      kind: "one-of",
      bindings: binding.bindings.map((candidate) =>
        withRuntimeExtensibility(candidate, extensible)
      ),
    };
  }
  return binding.kind === "namespace-object"
    ? { ...binding, extensible }
    : binding;
}

function runtimeOwnPropertyDefinitelyAbsent(
  binding: RuntimeBinding,
  property: string,
): boolean {
  const pending = [binding];
  const visited = new Set<RuntimeBinding>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    if (candidate.kind === "partial") return false;
    if (candidate.kind === "one-of") {
      pending.push(...candidate.bindings);
      continue;
    }
    if (candidate.kind !== "namespace-object") return false;
    if (candidate.properties.has(property)) return false;
    for (const operation of candidate.propertyOperations ?? []) {
      if (operation.kind === "spread") {
        pending.push(operation.binding);
        continue;
      }
      if (operation.kind === "define") {
        if (operation.name === property) return false;
        continue;
      }
      if (operation.fallbackOnly === true) continue;
      const propertyIndex = runtimeArrayIndex(property);
      if (
        operation.minimumArrayIndex === undefined ||
        propertyIndex !== undefined &&
          propertyIndex >= operation.minimumArrayIndex
      ) return false;
    }
  }
  return true;
}

function bindRuntimeAccessorMutation(
  target: unknown,
  property: string | undefined,
  descriptor: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  attributes?: RuntimeDescriptorAttributes,
): void {
  const accessors = runtimeDescriptorAccessorExpressions(descriptor);
  const configurable = attributes
    ? attributes.configurable
    : accessors.configurable;
  const enumerable = attributes ? attributes.enumerable : accessors.enumerable;
  const getterInvocationBinding = unionRuntimeBindings([
    ...accessors.getterInvocationExpressions.flatMap((expression) =>
      runtimeBindingForExpression(expression, imports, scopes) ?? []
    ),
    ...(accessors.getterInvocationUnknown
      ? [conservativeSemanticEffectBinding()]
      : []),
  ]);
  if (getterInvocationBinding) {
    bindRuntimeMemberAssignment(
      property === undefined
        ? runtimeUnknownPropertyExpression(target)
        : runtimePropertyExpression(target, property),
      {
        kind: "property-getter-effect",
        binding: getterInvocationBinding,
        enumerable,
      },
      accessors.getterInvocationExpressions[0],
      imports,
      scopes,
      {
        configurable,
        enumerable,
      },
    );
  }
  for (const expression of accessors.getterExpressions) {
    const binding = runtimeBindingForExpression(expression, imports, scopes);
    const aliasTargets = runtimeNamespaceAliasTargetsForExpression(
      expression,
      imports,
      scopes,
    );
    if (!binding && aliasTargets.length === 0) continue;
    const getterValueBinding = binding
      ? {
        kind: "property-getter-value" as const,
        binding,
        enumerable,
      }
      : undefined;
    if (property) {
      bindRuntimeNamedPropertyMutationBinding(
        target,
        property,
        getterValueBinding,
        expression,
        imports,
        scopes,
        {
          configurable,
          enumerable,
        },
      );
    } else {
      bindRuntimeUnknownPropertyMutationBinding(
        target,
        getterValueBinding,
        expression,
        imports,
        scopes,
        {
          configurable,
          enumerable,
        },
      );
    }
  }
  if (accessors.getterUnknown) {
    if (property) {
      bindRuntimeNamedPropertyMutationBinding(
        target,
        property,
        {
          kind: "property-getter-value",
          binding: conservativeSemanticEffectBinding(),
          enumerable,
        },
        undefined,
        imports,
        scopes,
        {
          configurable,
          enumerable,
        },
      );
    } else {
      bindRuntimeUnknownPropertyMutationBinding(
        target,
        {
          kind: "property-getter-value",
          binding: conservativeSemanticEffectBinding(),
          enumerable,
        },
        undefined,
        imports,
        scopes,
        {
          configurable,
          enumerable,
        },
      );
    }
  }
  const setterBinding = unionRuntimeBindings([
    ...accessors.setterExpressions.flatMap((expression) =>
      runtimeBindingForExpression(expression, imports, scopes) ?? []
    ),
    ...(accessors.setterUnknown ? [conservativeSemanticEffectBinding()] : []),
  ]);
  if (!setterBinding) return;
  bindRuntimeMemberAssignment(
    property === undefined
      ? runtimeUnknownPropertyExpression(target)
      : runtimePropertyExpression(target, property),
    { kind: "property-setter", binding: setterBinding },
    accessors.setterExpressions[0],
    imports,
    scopes,
    {
      configurable,
      enumerable,
    },
  );
}

function clearRuntimeDescriptorProperty(
  target: unknown,
  property: string | undefined,
  descriptor: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  attributes?: RuntimeDescriptorAttributes,
): void {
  if (property === undefined) return;
  const targetBinding = runtimeBindingForExpression(target, imports, scopes);
  if (!targetBinding) return;
  const retained = retainedRuntimeDescriptorBinding(
    targetBinding,
    property,
    descriptor,
  );
  if (!retained.changed) return;
  const effectiveAttributes = attributes ??
    runtimeDescriptorMutationAttributes(targetBinding, property, descriptor);
  bindRuntimeNamedPropertyMutationBinding(
    target,
    property,
    retained.binding,
    descriptor,
    imports,
    scopes,
    {
      allowClearing: true,
      clearAccessors: true,
      configurable: effectiveAttributes.configurable,
      enumerable: effectiveAttributes.enumerable,
    },
  );
}

function clearRuntimeDescriptorResultProperty(
  target: RuntimeBinding,
  property: string | undefined,
  descriptor: unknown,
  attributes?: RuntimeDescriptorAttributes,
): RuntimeBinding {
  if (property === undefined) return target;
  const retained = retainedRuntimeDescriptorBinding(
    target,
    property,
    descriptor,
  );
  const effectiveAttributes = attributes ??
    runtimeDescriptorMutationAttributes(target, property, descriptor);
  return retained.changed
    ? appendRuntimeMutationResultProperty(
      target,
      property,
      retained.binding,
      {
        preservesPrevious: false,
        allowClearing: true,
        configurable: effectiveAttributes.configurable,
        enumerable: effectiveAttributes.enumerable,
      },
    )
    : target;
}

function retainedRuntimeDescriptorBinding(
  target: RuntimeBinding,
  property: string,
  descriptor: unknown,
): { readonly changed: boolean; readonly binding?: RuntimeBinding } {
  const fields = runtimeDescriptorDefinedFields(descriptor);
  if (!fields) return { changed: false };
  const changesProperty = ["value", "get", "set"].some((field) =>
    fields.has(field)
  );
  const changesEnumerable = fields.has("enumerable");
  const changesConfigurable = fields.has("configurable");
  if (runtimeDescriptorCreatesOwnProperty(target, property, descriptor)) {
    return { changed: true };
  }
  if (!changesProperty && !changesEnumerable && !changesConfigurable) {
    return { changed: false };
  }
  const existing = runtimePropertyResolution(target, property, true).binding;
  if (fields.has("value")) return { changed: true };
  const enumerable = changesEnumerable
    ? runtimeDescriptorBooleanField(descriptor, "enumerable")
    : undefined;
  const retained = unionRuntimeBindings(
    flattenRuntimeBindings(existing).flatMap((candidate) => {
      const keep = candidate.kind === "property-setter"
        ? !fields.has("set")
        : candidate.kind === "property-getter-effect" ||
            candidate.kind === "property-getter-value"
        ? !fields.has("get")
        : !changesProperty;
      if (!keep) return [];
      return changesEnumerable &&
          (candidate.kind === "property-getter-effect" ||
            candidate.kind === "property-getter-value")
        ? [{ ...candidate, enumerable }]
        : [candidate];
    }),
  );
  return {
    changed: true,
    binding: retained && runtimeBindingHasPartialAlternative(existing)
      ? { kind: "partial", binding: retained }
      : retained,
  };
}

function runtimeDescriptorAccessorExpressions(descriptor: unknown): {
  readonly configurable: boolean | undefined;
  readonly getterInvocationExpressions: readonly unknown[];
  readonly getterInvocationUnknown: boolean;
  readonly getterExpressions: readonly unknown[];
  readonly getterUnknown: boolean;
  readonly enumerable: boolean | undefined;
  readonly setterExpressions: readonly unknown[];
  readonly setterUnknown: boolean;
} {
  const value = unwrapExpression(descriptor);
  if (!value || value.type !== "ObjectExpression") {
    return {
      getterInvocationExpressions: [],
      getterInvocationUnknown: true,
      getterExpressions: [],
      getterUnknown: true,
      configurable: undefined,
      enumerable: undefined,
      setterExpressions: [],
      setterUnknown: true,
    };
  }
  const getterInvocationExpressions: unknown[] = [];
  const getterExpressions: unknown[] = [];
  const setterExpressions: unknown[] = [];
  let getterUnknown = false;
  let getterInvocationUnknown = false;
  const configurable = runtimeDescriptorConfigurable(descriptor);
  const enumerable = runtimeDescriptorEnumerable(descriptor);
  let setterUnknown = false;
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property)) {
      getterInvocationUnknown = true;
      getterUnknown = true;
      setterUnknown = true;
      continue;
    }
    const name = staticObjectPropertyName(property);
    if (!name) {
      getterInvocationUnknown = true;
      getterUnknown = true;
      setterUnknown = true;
      continue;
    }
    if (name === "enumerable") continue;
    if (name === "set") {
      if (property.type === "ObjectProperty") {
        setterExpressions.push(property.value);
      } else if (property.type !== "ObjectMethod") {
        setterUnknown = true;
      }
      continue;
    }
    if (name !== "get") continue;
    const getter = property.type === "ObjectProperty"
      ? unwrapExpression(property.value)
      : property.type === "ObjectMethod"
      ? property
      : undefined;
    if (!getter) {
      getterUnknown = true;
      continue;
    }
    getterInvocationExpressions.push(getter);
    const returned = runtimeFunctionReturnExpressions(getter);
    getterExpressions.push(...returned.expressions);
    getterUnknown ||= !returned.known;
  }
  return {
    getterInvocationExpressions,
    getterInvocationUnknown,
    getterExpressions,
    getterUnknown,
    configurable,
    enumerable,
    setterExpressions,
    setterUnknown,
  };
}

function runtimeDescriptorEnumerable(
  descriptor: unknown,
): boolean | undefined {
  return runtimeDescriptorBooleanField(descriptor, "enumerable");
}

function runtimeDescriptorConfigurable(
  descriptor: unknown,
): boolean | undefined {
  return runtimeDescriptorBooleanField(descriptor, "configurable");
}

function runtimeDescriptorBooleanField(
  descriptor: unknown,
  field: "configurable" | "enumerable",
): boolean | undefined {
  const value = unwrapExpression(descriptor);
  if (!value || value.type !== "ObjectExpression") return undefined;
  let result: boolean | undefined = false;
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property)) {
      result = undefined;
      continue;
    }
    const name = staticObjectPropertyName(property);
    if (!name) {
      result = undefined;
      continue;
    }
    if (name !== field) continue;
    const fieldValue = property.type === "ObjectProperty"
      ? unwrapExpression(property.value)
      : undefined;
    result = fieldValue?.type === "BooleanLiteral"
      ? Boolean(fieldValue.value)
      : undefined;
  }
  return result;
}

function runtimeDescriptorValueExpression(descriptor: unknown): unknown {
  const value = unwrapExpression(descriptor);
  if (!value || value.type !== "ObjectExpression") {
    return runtimePropertyExpression(descriptor, "value");
  }
  let valueExpression: unknown;
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property) || property.type === "SpreadElement") {
      return runtimePropertyExpression(descriptor, "value");
    }
    if (staticObjectPropertyName(property) !== "value") continue;
    valueExpression = property.type === "ObjectProperty"
      ? property.value
      : undefined;
  }
  return valueExpression;
}

function runtimeDescriptorDefinesField(
  descriptor: unknown,
  field: string,
): boolean {
  return runtimeDescriptorDefinedFields(descriptor)?.has(field) === true;
}

function runtimeDescriptorDefinedFields(
  descriptor: unknown,
): ReadonlySet<string> | undefined {
  const value = unwrapExpression(descriptor);
  if (!value || value.type !== "ObjectExpression") return undefined;
  const fields = new Set<string>();
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property) || property.type === "SpreadElement") {
      return undefined;
    }
    const name = staticObjectPropertyName(property);
    if (name === undefined) return undefined;
    fields.add(name);
  }
  return fields;
}

function runtimeFunctionReturnExpressions(value: Node): {
  readonly expressions: readonly unknown[];
  readonly known: boolean;
} {
  if (
    value.type !== "ArrowFunctionExpression" &&
    value.type !== "FunctionExpression" &&
    value.type !== "ObjectMethod"
  ) {
    return { expressions: [], known: false };
  }
  if (
    value.type === "ArrowFunctionExpression" && isNode(value.body) &&
    value.body.type !== "BlockStatement"
  ) {
    return { expressions: [value.body], known: true };
  }
  if (!isNode(value.body)) return { expressions: [], known: false };
  const expressions: unknown[] = [];
  const visit = (node: Node, root = false): void => {
    if (!root && isFunctionLikeNode(node)) return;
    if (node.type === "ReturnStatement") {
      if (node.argument !== undefined) expressions.push(node.argument);
      return;
    }
    for (const key of Object.keys(node)) {
      if (
        key === "loc" || COMMENT_KEYS.has(key) ||
        TYPE_ONLY_CHILD_KEYS.has(key)
      ) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) visit(item);
      } else if (isNode(child)) {
        visit(child);
      }
    }
  };
  visit(value.body, true);
  return { expressions, known: true };
}

function isFunctionLikeNode(node: Node): boolean {
  return node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" || node.type === "ObjectMethod" ||
    node.type === "ClassMethod" || node.type === "ClassPrivateMethod";
}

function runtimeSpreadValueExpression(value: unknown): unknown {
  const expression = unwrapExpression(value);
  return expression?.type === "SpreadElement"
    ? runtimeUnknownPropertyExpression(expression.argument)
    : value;
}

function runtimePropertyExpression(
  object: unknown,
  property: string,
): Node {
  return {
    type: "MemberExpression",
    object,
    property: { type: "Identifier", name: property },
    computed: false,
  };
}

function runtimeUnknownPropertyExpression(object: unknown): Node {
  return {
    type: "MemberExpression",
    object,
    property: {
      type: "Identifier",
      name: "__veryfront_unknown_mutated_property__",
    },
    computed: true,
  };
}

function bindRuntimeUnknownPropertyMutation(
  target: unknown,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  minimumArrayIndex?: number,
  enumerable?: boolean,
  configurable?: boolean,
): void {
  bindRuntimeUnknownPropertyMutationBinding(
    target,
    runtimeBindingForExpression(assignedExpression, imports, scopes),
    assignedExpression,
    imports,
    scopes,
    { minimumArrayIndex, enumerable, configurable },
  );
}

function bindRuntimeNamedPropertyMutation(
  target: unknown,
  property: string,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  enumerable?: boolean,
  configurable?: boolean,
): void {
  bindRuntimeNamedPropertyMutationBinding(
    target,
    property,
    runtimeBindingForExpression(assignedExpression, imports, scopes),
    assignedExpression,
    imports,
    scopes,
    { enumerable, configurable },
  );
}

interface RuntimeMemberMutationOptions {
  readonly allowClearing?: boolean;
  readonly clearAccessors?: boolean;
  readonly configurable?: boolean;
  readonly enumerable?: boolean;
  readonly fallbackOnly?: boolean;
  readonly minimumArrayIndex?: number;
  readonly replacesFallback?: boolean;
}

function bindRuntimeNamedPropertyMutationBinding(
  target: unknown,
  property: string,
  binding: RuntimeBinding | undefined,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  options: RuntimeMemberMutationOptions = {},
): void {
  const receiver = unwrapExpression(target);
  if (!receiver) return;
  bindRuntimeMemberAssignment(
    runtimePropertyExpression(receiver, property),
    binding,
    assignedExpression,
    imports,
    scopes,
    options,
  );
}

function bindRuntimeUnknownPropertyMutationBinding(
  target: unknown,
  binding: RuntimeBinding | undefined,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  options: RuntimeMemberMutationOptions = {},
): void {
  const receiver = unwrapExpression(target);
  if (!receiver) return;
  const member = runtimeUnknownPropertyExpression(receiver);
  bindRuntimeMemberAssignment(
    member,
    binding,
    assignedExpression,
    imports,
    scopes,
    options,
  );
}

function bindRuntimeMemberAssignment(
  member: Node,
  binding: RuntimeBinding | undefined,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  options: RuntimeMemberMutationOptions = {},
): boolean {
  if (
    member.type !== "MemberExpression" &&
    member.type !== "OptionalMemberExpression"
  ) {
    return false;
  }
  const chain = memberChain(member);
  const property = memberProperty(member);
  const hasUnknownComputedProperty = member.computed === true &&
    property === undefined;
  const objectChain = hasUnknownComputedProperty && isNode(member.object)
    ? memberChain(member.object)
    : undefined;
  const targetChain = chain ?? objectChain;
  const mutations: Array<{
    readonly target: RuntimeAliasTarget;
    readonly propertyPath: readonly string[];
    readonly hasUnknownComputedProperty: boolean;
  }> = [];
  if (targetChain && targetChain.length >= (chain ? 2 : 1)) {
    const classAlias = classStaticAliasResolution(targetChain[0], scopes);
    const aliasTargets = classAlias?.receiverScope
      ? [{ scope: classAlias.receiverScope, root: THIS_RUNTIME_ROOT }]
      : runtimeAliasTargetsForName(targetChain[0], scopes);
    const directTarget = assignmentTargetScope(targetChain[0], scopes);
    for (
      const target of uniqueRuntimeAliasTargets([
        ...aliasTargets,
        ...(classAlias?.receiverScope || !directTarget
          ? []
          : [{ scope: directTarget.scope, root: targetChain[0] }]),
      ])
    ) {
      mutations.push({
        target,
        propertyPath: targetChain.slice(1),
        hasUnknownComputedProperty,
      });
    }
  }

  let receiver = unwrapExpression(member.object);
  let remainingPath = property ? [property] : [];
  let unknownAtEnd = hasUnknownComputedProperty;
  let representable = true;
  while (receiver) {
    if (representable) {
      for (
        const target of runtimeNamespaceAliasTargetsForExpression(
          receiver,
          imports,
          scopes,
        )
      ) {
        mutations.push({
          target,
          propertyPath: remainingPath,
          hasUnknownComputedProperty: unknownAtEnd,
        });
      }
    }
    if (
      receiver.type !== "MemberExpression" &&
      receiver.type !== "OptionalMemberExpression"
    ) {
      break;
    }
    const receiverProperty = memberProperty(receiver);
    if (receiverProperty) {
      remainingPath = [receiverProperty, ...remainingPath];
    } else if (remainingPath.length === 0 && !unknownAtEnd) {
      unknownAtEnd = true;
    } else {
      representable = false;
    }
    receiver = unwrapExpression(receiver.object);
  }

  if (mutations.length === 0) return targetChain !== undefined;
  const seen = new Map<Scope, Set<string>>();
  for (const mutation of mutations) {
    const key = `${mutation.target.root}\u0000${
      mutation.hasUnknownComputedProperty ? "*" : "="
    }\u0000${mutation.propertyPath.join("\u0000")}`;
    const scopeKeys = seen.get(mutation.target.scope) ?? new Set<string>();
    if (scopeKeys.has(key)) continue;
    scopeKeys.add(key);
    seen.set(mutation.target.scope, scopeKeys);
    const target = assignmentTargetForAlias(mutation.target, scopes);
    if (!target) continue;
    bindRuntimeMemberAssignmentTarget(
      mutation.target,
      target.crossesFunctionBoundary,
      mutation.propertyPath,
      binding,
      assignedExpression,
      imports,
      scopes,
      mutation.hasUnknownComputedProperty,
      options,
    );
  }
  return true;
}

function bindRuntimeMemberAssignmentTarget(
  target: RuntimeAliasTarget,
  crossesFunctionBoundary: boolean,
  propertyPath: readonly string[],
  binding: RuntimeBinding | undefined,
  assignedExpression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  hasUnknownComputedProperty: boolean,
  options: RuntimeMemberMutationOptions,
): void {
  const { scope, root } = target;
  const existing = scope.runtimeBindings.get(root);
  if (
    existing &&
    !flattenRuntimeBindings(existing).every((candidate) =>
      candidate.kind === "namespace-object"
    )
  ) {
    return;
  }
  const canClear = !hasUnknownComputedProperty && options.allowClearing &&
    !crossesFunctionBoundary &&
    !runtimePropertyHasCrossFunctionMutation(existing, propertyPath) &&
    (options.clearAccessors ||
      runtimePropertySetterBindingAtPath(existing, propertyPath) ===
        undefined);
  const defaultMayRun = expressionMayBeUndefined(
    assignedExpression,
    binding,
    imports,
    scopes,
  );
  const aliasTargets = runtimeNamespaceAliasTargetsForExpression(
    assignedExpression,
    imports,
    scopes,
  );
  const assigned = hasUnknownComputedProperty
    ? assignUnknownRuntimeProperty(
      existing,
      propertyPath,
      binding,
      defaultMayRun,
      crossesFunctionBoundary,
      aliasTargets,
      options.minimumArrayIndex,
      options.fallbackOnly === true,
      options.replacesFallback === true,
      options.enumerable,
      options.configurable,
    )
    : assignRuntimeProperty(
      existing,
      propertyPath,
      binding,
      defaultMayRun,
      crossesFunctionBoundary,
      aliasTargets,
      !canClear,
      options.enumerable,
      options.configurable,
    );
  scope.runtimeBindings.set(root, assigned);
  if (
    root !== THIS_RUNTIME_ROOT &&
    scope.classRuntimeBindings?.name === root
  ) {
    syncClassStaticRuntimeBinding(scope);
  }
}

function runtimePropertySetterBindingAtPath(
  binding: RuntimeBinding | undefined,
  path: readonly string[],
): RuntimeBinding | undefined {
  const property = path.at(-1);
  if (!binding || property === undefined) return undefined;
  let receiver = binding;
  for (const segment of path.slice(0, -1)) {
    const nested = runtimePropertyBinding(receiver, segment);
    if (!nested) return undefined;
    receiver = nested;
  }
  return runtimePropertySetterBinding(receiver, property);
}

function classStaticAliasResolution(
  name: string,
  scopes: readonly Scope[],
): {
  readonly binding?: RuntimeBinding;
  readonly receiverScope?: Scope;
} | undefined {
  const classScope = declaringScopeForName(name, scopes);
  if (classScope?.classRuntimeBindings?.name !== name) return undefined;
  const classScopeIndex = scopes.lastIndexOf(classScope);
  for (let index = scopes.length - 1; index > classScopeIndex; index--) {
    const scope = scopes[index];
    if (!scope.names.has(THIS_RUNTIME_ROOT)) continue;
    if (
      scope.classReceiver?.classScope === classScope &&
      scope.classReceiver.kind === "static"
    ) {
      return {
        binding: scope.runtimeBindings.get(THIS_RUNTIME_ROOT),
        receiverScope: scope,
      };
    }
    break;
  }
  return {
    binding: classScope.runtimeBindings.get(name) ??
      classScope.classRuntimeBindings.static,
  };
}

function runtimeAliasTargetsForName(
  name: string,
  scopes: readonly Scope[],
): readonly RuntimeAliasTarget[] {
  const scope = declaringScopeForName(name, scopes);
  return resolveRuntimeAliasTargets(scope?.runtimeAliases.get(name) ?? []);
}

function runtimeNamespaceAliasTargetsForExpression(
  expression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): readonly RuntimeAliasTarget[] {
  const value = unwrapExpression(expression);
  if (!value) return [];
  let targets: readonly RuntimeAliasTarget[] = [];
  const assignment = runtimeAssignmentExpressionResolution(
    value,
    imports,
    scopes,
  );
  if (assignment) {
    targets = assignment.aliasTargets ?? [];
  } else if (value.type === "ConditionalExpression") {
    targets = uniqueRuntimeAliasTargets([
      ...runtimeNamespaceAliasTargetsForExpression(
        value.consequent,
        imports,
        scopes,
      ),
      ...runtimeNamespaceAliasTargetsForExpression(
        value.alternate,
        imports,
        scopes,
      ),
    ]);
  } else if (value.type === "LogicalExpression") {
    targets = uniqueRuntimeAliasTargets([
      ...runtimeNamespaceAliasTargetsForExpression(value.left, imports, scopes),
      ...runtimeNamespaceAliasTargetsForExpression(
        value.right,
        imports,
        scopes,
      ),
    ]);
  } else if (value.type === "SequenceExpression") {
    const expressions = Array.isArray(value.expressions)
      ? value.expressions
      : [];
    targets = runtimeNamespaceAliasTargetsForExpression(
      expressions.at(-1),
      imports,
      scopes,
    );
  } else if (isCallLikeExpression(value) && isNode(value.callee)) {
    const args = Array.isArray(value.arguments) ? value.arguments : [];
    targets = uniqueRuntimeAliasTargets(
      mutationMethodInvocations(value.callee, args, imports, scopes).flatMap((
        invocation,
      ) =>
        mutationReturnsTarget(invocation.binding)
          ? runtimeNamespaceAliasTargetsForExpression(
            invocation.target,
            imports,
            scopes,
          )
          : []
      ),
    );
  } else if (value.type === "ThisExpression") {
    const receiver = assignmentTargetScope(THIS_RUNTIME_ROOT, scopes);
    if (receiver) {
      targets = [{ scope: receiver.scope, root: THIS_RUNTIME_ROOT }];
    }
  } else if (value.type === "Identifier") {
    const name = value.name as string;
    const classAlias = classStaticAliasResolution(name, scopes);
    if (classAlias?.receiverScope) {
      targets = [{
        scope: classAlias.receiverScope,
        root: THIS_RUNTIME_ROOT,
      }];
    } else {
      targets = runtimeAliasTargetsForName(name, scopes);
      if (targets.length === 0) {
        const scope = declaringScopeForName(name, scopes);
        if (scope) targets = [{ scope, root: name }];
      }
    }
  } else if (
    value.type === "MemberExpression" ||
    value.type === "OptionalMemberExpression"
  ) {
    const property = memberProperty(value);
    const objectBinding = runtimeBindingForExpression(
      value.object,
      imports,
      scopes,
    );
    if (objectBinding) {
      targets = (property
        ? runtimePropertyResolution(objectBinding, property)
        : runtimeUnknownPropertyResolution(objectBinding))
        .aliasTargets ?? [];
    }
  }
  return resolveRuntimeAliasTargets(targets).filter((target) => {
    const binding = target.scope.runtimeBindings.get(target.root);
    return binding &&
      flattenRuntimeBindings(binding).every((candidate) =>
        candidate.kind === "namespace-object"
      );
  });
}

function resolveRuntimeAliasTargets(
  initial: readonly RuntimeAliasTarget[],
): readonly RuntimeAliasTarget[] {
  const pending = [...initial];
  const resolved: RuntimeAliasTarget[] = [];
  const seen = new Map<Scope, Set<string>>();
  while (pending.length > 0) {
    const target = pending.shift();
    if (!target) continue;
    const roots = seen.get(target.scope) ?? new Set<string>();
    if (roots.has(target.root)) continue;
    roots.add(target.root);
    seen.set(target.scope, roots);
    const next = target.scope.runtimeAliases.get(target.root) ?? [];
    if (next.length > 0) {
      pending.push(...next);
    } else {
      resolved.push(target);
    }
  }
  return resolved;
}

function uniqueRuntimeAliasTargets(
  targets: readonly RuntimeAliasTarget[],
): readonly RuntimeAliasTarget[] {
  const seen = new Map<Scope, Set<string>>();
  return targets.filter((target) => {
    const roots = seen.get(target.scope) ?? new Set<string>();
    if (roots.has(target.root)) return false;
    roots.add(target.root);
    seen.set(target.scope, roots);
    return true;
  });
}

function currentRuntimeAliasBinding(
  targets: readonly RuntimeAliasTarget[] | undefined,
): RuntimeBinding | undefined {
  return unionRuntimeBindings(
    resolveRuntimeAliasTargets(targets ?? []).flatMap((target) =>
      target.scope.runtimeBindings.get(target.root) ?? []
    ),
  );
}

function assignmentTargetForAlias(
  alias: RuntimeAliasTarget,
  scopes: readonly Scope[],
): {
  readonly scope: Scope;
  readonly crossesFunctionBoundary: boolean;
} | undefined {
  let crossesFunctionBoundary = false;
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (scope === alias.scope) return { scope, crossesFunctionBoundary };
    if (scope.functionBoundary) crossesFunctionBoundary = true;
  }
  return undefined;
}

function assignmentTargetScope(
  name: string,
  scopes: readonly Scope[],
): {
  readonly scope: Scope;
  readonly crossesFunctionBoundary: boolean;
} | undefined {
  let crossesFunctionBoundary = false;
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (scope.names.has(name)) return { scope, crossesFunctionBoundary };
    if (scope.functionBoundary) crossesFunctionBoundary = true;
  }
  return undefined;
}

function bindDefinitelyNonUndefinedPattern(
  pattern: Node,
  binding: RuntimeBinding | undefined,
  mayBeUndefined: boolean,
  imports: ImportBindings,
  scopes: readonly Scope[],
  unconditional: boolean,
  scopeForName: (name: string) => Scope | undefined,
): void {
  if (pattern.type === "Identifier") {
    const name = pattern.name as string;
    const scope = scopeForName(name);
    if (!scope) return;
    if (mayBeUndefined) {
      scope.definitelyNonUndefinedNames.delete(name);
    } else if (unconditional) {
      scope.definitelyNonUndefinedNames.add(name);
    }
    return;
  }
  if (
    pattern.type === "AssignmentPattern" && isNode(pattern.left) &&
    isNode(pattern.right)
  ) {
    const defaultBinding = runtimeBindingForExpression(
      pattern.right,
      imports,
      scopes,
    );
    bindDefinitelyNonUndefinedPattern(
      pattern.left,
      mayBeUndefined
        ? unionRuntimeBindings(
          [binding, defaultBinding].flatMap((candidate) => candidate ?? []),
        )
        : binding,
      mayBeUndefined &&
        expressionMayBeUndefined(
          pattern.right,
          defaultBinding,
          imports,
          scopes,
        ),
      imports,
      scopes,
      unconditional,
      scopeForName,
    );
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindDefinitelyNonUndefinedPattern(
      pattern.argument,
      undefined,
      false,
      imports,
      scopes,
      unconditional,
      scopeForName,
    );
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (
      const property of Array.isArray(pattern.properties)
        ? pattern.properties
        : []
    ) {
      if (!isNode(property)) continue;
      if (property.type === "RestElement" && isNode(property.argument)) {
        bindDefinitelyNonUndefinedPattern(
          property.argument,
          undefined,
          false,
          imports,
          scopes,
          unconditional,
          scopeForName,
        );
        continue;
      }
      if (property.type !== "ObjectProperty" || !isNode(property.value)) {
        continue;
      }
      const resolution = binding
        ? runtimePatternPropertyResolution(binding, property)
        : { defaultMayRun: true };
      bindDefinitelyNonUndefinedPattern(
        property.value,
        resolution.binding,
        mayBeUndefined || resolution.defaultMayRun,
        imports,
        scopes,
        unconditional,
        scopeForName,
      );
    }
    return;
  }
  if (pattern.type !== "ArrayPattern") return;
  for (const entry of runtimeArrayPatternEntries(pattern, binding)) {
    bindDefinitelyNonUndefinedPattern(
      entry.pattern,
      entry.resolution.binding,
      mayBeUndefined || entry.resolution.defaultMayRun,
      imports,
      scopes,
      unconditional,
      scopeForName,
    );
  }
}

function assignRuntimeProperty(
  existing: RuntimeBinding | undefined,
  path: readonly string[],
  binding: RuntimeBinding | undefined,
  defaultMayRun: boolean,
  crossesFunctionBoundary: boolean,
  aliasTargets: readonly RuntimeAliasTarget[] = [],
  preservesPrevious = false,
  enumerable?: boolean,
  configurable?: boolean,
): RuntimeBinding {
  const [property, ...rest] = path;
  const assigned = rest.length === 0 ? binding : assignRuntimeProperty(
    existing ? runtimePropertyBinding(existing, property) : undefined,
    rest,
    binding,
    defaultMayRun,
    crossesFunctionBoundary,
    aliasTargets,
    preservesPrevious,
    enumerable,
    configurable,
  );
  const operation: NamespacePropertyOperation = {
    kind: "define",
    name: property,
    binding: assigned,
    aliasTargets: rest.length === 0 ? aliasTargets : undefined,
    defaultMayRun: rest.length === 0 ? defaultMayRun : false,
    preservesPrevious: rest.length === 0 ? preservesPrevious : false,
    crossesFunctionBoundary: rest.length === 0
      ? crossesFunctionBoundary
      : false,
    enumerable: rest.length === 0 ? enumerable : undefined,
    configurable: rest.length === 0 ? configurable : undefined,
  };
  return appendRuntimePropertyOperation(existing, operation);
}

function assignUnknownRuntimeProperty(
  existing: RuntimeBinding | undefined,
  objectPath: readonly string[],
  binding: RuntimeBinding | undefined,
  defaultMayRun: boolean,
  crossesFunctionBoundary: boolean,
  aliasTargets: readonly RuntimeAliasTarget[] = [],
  minimumArrayIndex?: number,
  fallbackOnly = false,
  replacesFallback = false,
  enumerable?: boolean,
  configurable?: boolean,
): RuntimeBinding {
  const [property, ...rest] = objectPath;
  if (property) {
    const nested = assignUnknownRuntimeProperty(
      existing ? runtimePropertyBinding(existing, property) : undefined,
      rest,
      binding,
      defaultMayRun,
      crossesFunctionBoundary,
      aliasTargets,
      minimumArrayIndex,
      fallbackOnly,
      replacesFallback,
      enumerable,
      configurable,
    );
    return assignRuntimeProperty(existing, [property], nested, false, false);
  }
  return appendRuntimePropertyOperation(existing, {
    kind: "define-unknown",
    binding,
    aliasTargets,
    defaultMayRun,
    crossesFunctionBoundary,
    minimumArrayIndex,
    fallbackOnly,
    replacesFallback,
    enumerable,
    configurable,
  });
}

function appendRuntimePropertyOperation(
  existing: RuntimeBinding | undefined,
  operation: NamespacePropertyOperation,
): RuntimeBinding {
  if (
    existing?.kind === "namespace-object" &&
    existing.propertyOperations && operation.kind === "define-unknown" &&
    operation.replacesFallback === true
  ) {
    existing = {
      ...existing,
      propertyOperations: existing.propertyOperations.filter((candidate) =>
        candidate.kind !== "define-unknown" ||
        candidate.fallbackOnly !== true
      ),
    };
  }
  if (existing?.kind === "namespace-object" && existing.propertyOperations) {
    const previous = existing.propertyOperations.at(-1);
    if (
      previous?.kind === "define-unknown" &&
      operation.kind === "define-unknown" &&
      previous.minimumArrayIndex === operation.minimumArrayIndex &&
      previous.fallbackOnly === operation.fallbackOnly &&
      previous.replacesFallback === operation.replacesFallback &&
      previous.enumerable === operation.enumerable &&
      previous.configurable === operation.configurable
    ) {
      return {
        kind: "namespace-object",
        shape: existing.shape,
        exactArrayLength: updatedRuntimeArrayLength(existing, operation),
        extensible: existing.extensible,
        properties: existing.properties,
        propertyOperations: [
          ...existing.propertyOperations.slice(0, -1),
          {
            kind: "define-unknown",
            binding: unionRuntimeBindings(
              [previous.binding, operation.binding].flatMap((binding) =>
                binding ?? []
              ),
            ),
            aliasTargets: uniqueRuntimeAliasTargets([
              ...previous.aliasTargets ?? [],
              ...operation.aliasTargets ?? [],
            ]),
            defaultMayRun: previous.defaultMayRun || operation.defaultMayRun,
            crossesFunctionBoundary:
              previous.crossesFunctionBoundary === true ||
              operation.crossesFunctionBoundary === true,
            minimumArrayIndex: operation.minimumArrayIndex,
            fallbackOnly: operation.fallbackOnly,
            replacesFallback: operation.replacesFallback,
            enumerable: operation.enumerable,
            configurable: operation.configurable,
          },
        ],
      };
    }
    return {
      kind: "namespace-object",
      shape: existing.shape,
      exactArrayLength: updatedRuntimeArrayLength(existing, operation),
      extensible: existing.extensible,
      properties: existing.properties,
      propertyOperations: [...existing.propertyOperations, operation],
    };
  }
  return {
    kind: "namespace-object",
    shape: existing?.kind === "namespace-object" ? existing.shape : undefined,
    exactArrayLength: existing?.kind === "namespace-object"
      ? updatedRuntimeArrayLength(existing, operation)
      : undefined,
    extensible: existing?.kind === "namespace-object"
      ? existing.extensible
      : undefined,
    properties: new Map(),
    propertyOperations: existing
      ? [{ kind: "spread", binding: existing }, operation]
      : [operation],
  };
}

function updatedRuntimeArrayLength(
  existing: Extract<RuntimeBinding, { readonly kind: "namespace-object" }>,
  operation: NamespacePropertyOperation,
): number | undefined {
  if (
    existing.shape !== "array" || existing.exactArrayLength === undefined ||
    operation.kind !== "define" || operation.name === "length"
  ) {
    return undefined;
  }
  const index = runtimeArrayIndex(operation.name);
  if (index === undefined) return existing.exactArrayLength;
  if (operation.preservesPrevious && index >= existing.exactArrayLength) {
    return undefined;
  }
  return Math.max(existing.exactArrayLength, index + 1);
}

function bindRuntimeAssignmentPattern(
  pattern: Node,
  binding: RuntimeBinding,
  imports: ImportBindings,
  scopes: readonly Scope[],
  merge = false,
  clear = false,
): void {
  if (pattern.type === "Identifier") {
    const scope = declaringScopeForName(pattern.name as string, scopes);
    if (scope) {
      const name = pattern.name as string;
      scope.runtimeBindings.set(
        name,
        mergeRuntimeBinding(scope.runtimeBindings.get(name), binding, merge),
      );
    }
    return;
  }
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    bindRuntimeAssignmentPattern(
      pattern.left,
      binding,
      imports,
      scopes,
      merge,
      clear,
    );
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindRuntimeAssignmentPattern(
      pattern.argument,
      binding,
      imports,
      scopes,
      merge,
      clear,
    );
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const entry of runtimeArrayPatternEntries(pattern, binding)) {
      const propertyBinding = entry.resolution.binding;
      if (propertyBinding) {
        bindRuntimeAssignmentPattern(
          entry.pattern,
          propertyBinding,
          imports,
          scopes,
          merge,
          clear,
        );
      } else if (clear) {
        clearCurrentScopeRuntimeAssignmentPattern(entry.pattern, scopes);
      }
      if (entry.resolution.defaultMayRun) {
        bindRuntimePatternDefaults(
          entry.pattern,
          imports,
          scopes,
          (pattern, defaultBinding) =>
            bindRuntimeAssignmentPattern(
              pattern,
              defaultBinding,
              imports,
              scopes,
              merge || propertyBinding !== undefined,
              clear,
            ),
        );
      }
    }
    return;
  }
  if (
    pattern.type !== "ObjectPattern" ||
    (binding.kind !== "global-runtime" && binding.kind !== "global-object" &&
      binding.kind !== "shared-object" && binding.kind !== "effect-object" &&
      binding.kind !== "module" && binding.kind !== "module-instance" &&
      binding.kind !== "namespace-object" &&
      binding.kind !== "one-of" && binding.kind !== "partial")
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
      bindRuntimeAssignmentPattern(
        property.argument,
        binding,
        imports,
        scopes,
        merge,
        clear,
      );
      continue;
    }
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const propertyResolution = runtimePatternPropertyResolution(
      binding,
      property,
    );
    const propertyBinding = propertyResolution.binding;
    if (propertyBinding) {
      bindRuntimeAssignmentPattern(
        property.value,
        propertyBinding,
        imports,
        scopes,
        merge,
        clear,
      );
    } else if (clear) {
      clearCurrentScopeRuntimeAssignmentPattern(property.value, scopes);
    }
    if (propertyResolution.defaultMayRun) {
      bindRuntimePatternDefaults(
        property.value,
        imports,
        scopes,
        (pattern, defaultBinding) =>
          bindRuntimeAssignmentPattern(
            pattern,
            defaultBinding,
            imports,
            scopes,
            merge || propertyBinding !== undefined,
            clear,
          ),
      );
    }
  }
}

function bindRuntimePatternDefaults(
  pattern: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  bind: (pattern: Node, binding: RuntimeBinding) => void,
): void {
  if (
    pattern.type === "AssignmentPattern" && isNode(pattern.left) &&
    isNode(pattern.right)
  ) {
    const binding = runtimeBindingForExpression(pattern.right, imports, scopes);
    if (binding) {
      bind(pattern.left, binding);
    } else {
      bindRuntimePatternDefaults(pattern.left, imports, scopes, bind);
    }
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindRuntimePatternDefaults(pattern.argument, imports, scopes, bind);
    return;
  }
  const children = pattern.type === "ObjectPattern"
    ? pattern.properties
    : pattern.type === "ArrayPattern"
    ? pattern.elements
    : undefined;
  for (const child of Array.isArray(children) ? children : []) {
    const value = isNode(child) && isNode(child.value) ? child.value : child;
    if (isNode(value)) {
      bindRuntimePatternDefaults(value, imports, scopes, bind);
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
  const children = pattern.type === "ObjectPattern"
    ? pattern.properties
    : pattern.type === "ArrayPattern"
    ? pattern.elements
    : undefined;
  for (const property of Array.isArray(children) ? children : []) {
    if (
      isNode(property) && property.type === "RestElement" &&
      isNode(property.argument)
    ) {
      clearCurrentScopeRuntimeAssignmentPattern(property.argument, scopes);
    } else if (isNode(property) && isNode(property.value)) {
      clearCurrentScopeRuntimeAssignmentPattern(property.value, scopes);
    } else if (pattern.type === "ArrayPattern" && isNode(property)) {
      clearCurrentScopeRuntimeAssignmentPattern(property, scopes);
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
  if (parent.type === "SwitchCase" && key === "consequent") return true;
  if (
    (parent.type === "WhileStatement" ||
      parent.type === "DoWhileStatement" ||
      parent.type === "ForStatement" ||
      parent.type === "ForInStatement" ||
      parent.type === "ForOfStatement") &&
    (key === "body" || key === "update" || key === "left")
  ) {
    return true;
  }
  if (
    (parent.type === "TryStatement" &&
      (key === "block" || key === "handler")) ||
    (parent.type === "CatchClause" && key === "body")
  ) {
    return true;
  }
  if (
    parent.type === "OptionalCallExpression" && parent.optional === true &&
    key === "arguments"
  ) {
    return true;
  }
  return parent.type === "OptionalMemberExpression" &&
    parent.optional === true && parent.computed === true && key === "property";
}

function isWriteOnlyAssignmentTargetChild(parent: Node, key: string): boolean {
  if (
    parent.type === "UnaryExpression" && parent.operator === "delete" &&
    key === "argument"
  ) {
    return true;
  }
  if (key !== "left") return false;
  return parent.type === "AssignmentExpression" && parent.operator === "=" ||
    parent.type === "ForOfStatement" || parent.type === "ForInStatement";
}

function bindRuntimeDeclaration(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
  merge = false,
  clear = false,
): void {
  if (!isNode(declaration.id)) return;
  const binding = runtimeBindingForExpression(
    declaration.init,
    imports,
    scopes,
  );
  bindDefinitelyNonUndefinedPattern(
    declaration.id,
    binding,
    expressionMayBeUndefined(declaration.init, binding, imports, scopes),
    imports,
    scopes,
    !merge,
    (name) => scope.names.has(name) ? scope : undefined,
  );
  bindRuntimeAlias(
    declaration.id,
    declaration.init,
    imports,
    scopes,
    !merge,
    (name) => scope.names.has(name) ? scope : undefined,
  );
  if (binding) {
    bindPatternToRuntime(
      declaration.id,
      binding,
      imports,
      scopes,
      scope,
      merge,
      clear,
    );
  } else {
    if (clear) {
      clearCurrentScopeRuntimeAssignmentPattern(declaration.id, [scope]);
    }
    bindRuntimePatternDefaults(
      declaration.id,
      imports,
      scopes,
      (pattern, defaultBinding) =>
        bindPatternToRuntime(
          pattern,
          defaultBinding,
          imports,
          scopes,
          scope,
          merge,
          clear,
        ),
    );
  }
}

function bindRuntimeAlias(
  pattern: Node,
  expression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
  unconditional: boolean,
  scopeForName: (name: string) => Scope | undefined,
): void {
  const binding = runtimeBindingForExpression(expression, imports, scopes);
  const targets = runtimeNamespaceAliasTargetsForExpression(
    expression,
    imports,
    scopes,
  );
  bindRuntimeAliasPattern(
    pattern,
    binding,
    targets,
    expressionMayBeUndefined(expression, binding, imports, scopes),
    imports,
    scopes,
    unconditional,
    scopeForName,
  );
}

function bindRuntimeAliasPattern(
  pattern: Node,
  binding: RuntimeBinding | undefined,
  targets: readonly RuntimeAliasTarget[],
  mayUseDefault: boolean,
  imports: ImportBindings,
  scopes: readonly Scope[],
  unconditional: boolean,
  scopeForName: (name: string) => Scope | undefined,
): void {
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    const defaultBinding = runtimeBindingForExpression(
      pattern.right,
      imports,
      scopes,
    );
    const defaultTargets = runtimeNamespaceAliasTargetsForExpression(
      pattern.right,
      imports,
      scopes,
    );
    bindRuntimeAliasPattern(
      pattern.left,
      mayUseDefault
        ? unionRuntimeBindings(
          [binding, defaultBinding].flatMap((candidate) => candidate ?? []),
        )
        : binding,
      mayUseDefault
        ? uniqueRuntimeAliasTargets([...targets, ...defaultTargets])
        : targets,
      mayUseDefault &&
        expressionMayBeUndefined(
          pattern.right,
          defaultBinding,
          imports,
          scopes,
        ),
      imports,
      scopes,
      unconditional,
      scopeForName,
    );
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (
      const property of Array.isArray(pattern.properties)
        ? pattern.properties
        : []
    ) {
      if (
        !isNode(property) || property.type !== "ObjectProperty" ||
        !isNode(property.value)
      ) {
        continue;
      }
      const resolution = binding
        ? runtimePatternPropertyResolution(binding, property)
        : { defaultMayRun: true };
      bindRuntimeAliasPattern(
        property.value,
        resolution.binding,
        resolution.aliasTargets ?? [],
        resolution.defaultMayRun,
        imports,
        scopes,
        unconditional,
        scopeForName,
      );
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const entry of runtimeArrayPatternEntries(pattern, binding)) {
      bindRuntimeAliasPattern(
        entry.pattern,
        entry.resolution.binding,
        entry.resolution.aliasTargets ?? [],
        entry.resolution.defaultMayRun,
        imports,
        scopes,
        unconditional,
        scopeForName,
      );
    }
    return;
  }
  if (pattern.type !== "Identifier") return;
  const name = pattern.name as string;
  const scope = scopeForName(name);
  if (!scope) return;
  const externalTargets = targets.filter((target) =>
    target.scope !== scope || target.root !== name
  );
  if (!unconditional) {
    const possibleTargets = uniqueRuntimeAliasTargets([
      ...(scope.runtimeAliases.get(name) ?? []),
      ...externalTargets,
    ]);
    if (possibleTargets.length > 0) {
      scope.runtimeAliases.set(name, possibleTargets);
    }
    return;
  }
  if (externalTargets.length > 0) {
    scope.runtimeAliases.set(name, externalTargets);
  } else {
    scope.runtimeAliases.delete(name);
  }
}

function runtimeAssignmentExpressionResolution(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimePropertyResolution | undefined {
  const operator = String(value.operator);
  if (
    value.type !== "AssignmentExpression" ||
    !["=", "&&=", "||=", "??="].includes(operator) ||
    !isNode(value.left)
  ) {
    return undefined;
  }

  const rightBinding = runtimeBindingForExpression(
    value.right,
    imports,
    scopes,
  );
  const rightAliasTargets = runtimeNamespaceAliasTargetsForExpression(
    value.right,
    imports,
    scopes,
  );
  const rightMayBeUndefined = expressionMayBeUndefined(
    value.right,
    rightBinding,
    imports,
    scopes,
  );
  if (operator === "=") {
    return {
      binding: rightBinding,
      aliasTargets: rightAliasTargets,
      defaultMayRun: rightMayBeUndefined,
    };
  }

  const leftBinding = runtimeBindingForExpression(value.left, imports, scopes);
  const leftAliasTargets = runtimeNamespaceAliasTargetsForExpression(
    value.left,
    imports,
    scopes,
  );
  return {
    binding: unionRuntimeBindings(
      [leftBinding, rightBinding].flatMap((binding) => binding ?? []),
    ),
    aliasTargets: uniqueRuntimeAliasTargets([
      ...leftAliasTargets,
      ...rightAliasTargets,
    ]),
    defaultMayRun: operator === "&&="
      ? expressionMayBeUndefined(
        value.left,
        leftBinding,
        imports,
        scopes,
      ) || rightMayBeUndefined
      : rightMayBeUndefined,
  };
}

function runtimeBindingForExpression(
  expression: unknown,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  const value = unwrapExpression(expression);
  if (!value) return undefined;
  const assignment = runtimeAssignmentExpressionResolution(
    value,
    imports,
    scopes,
  );
  if (assignment) return assignment.binding;
  if (value.type === "ClassExpression") {
    const classScope = createScope(value, imports, scopes);
    const name = classScope.classRuntimeBindings?.name;
    return name
      ? classScope.runtimeBindings.get(name) ?? emptyRuntimeNamespaceBinding()
      : classScope.classRuntimeBindings?.static ??
        emptyRuntimeNamespaceBinding();
  }
  if (value.type === "ThisExpression") {
    return resolveLocalBinding(THIS_RUNTIME_ROOT, scopes).binding;
  }
  const mutationResult = mutationCallResultRuntimeBinding(
    value,
    imports,
    scopes,
  );
  if (mutationResult) return mutationResult;
  const identifierBinding = identifierRuntimeBinding(value, imports, scopes);
  if (identifierBinding) return identifierBinding;
  const createRequireBinding = createRequireResultBinding(
    value,
    imports,
    scopes,
  );
  if (createRequireBinding) return createRequireBinding;
  const constructedBinding = constructedRuntimeBinding(value, imports, scopes);
  if (constructedBinding) return constructedBinding;
  const moduleSource = runtimeModuleSource(value, imports, scopes);
  if (moduleSource) return { kind: "module", source: moduleSource };
  const boundCallableBinding = boundCallableRuntimeBinding(
    value,
    imports,
    scopes,
  );
  if (boundCallableBinding) return boundCallableBinding;
  const alternativeBinding = alternativeRuntimeBinding(value, imports, scopes);
  if (alternativeBinding) return alternativeBinding;
  const literalArrayBinding = arrayLiteralRuntimeBinding(
    value,
    imports,
    scopes,
  );
  if (literalArrayBinding) return literalArrayBinding;
  const literalObjectBinding = objectLiteralRuntimeBinding(
    value,
    imports,
    scopes,
  );
  if (literalObjectBinding) return literalObjectBinding;
  if (
    value.type !== "MemberExpression" &&
    value.type !== "OptionalMemberExpression"
  ) return undefined;
  const property = memberProperty(value);
  const objectBinding = runtimeBindingForExpression(
    value.object,
    imports,
    scopes,
  );
  if (!objectBinding) return undefined;
  if (property) return runtimePropertyBinding(objectBinding, property);
  const unknownProperty = runtimeUnknownPropertyResolution(objectBinding)
    .binding;
  const unknownArrayMutation = flattenRuntimeBindings(objectBinding).some(
      (binding) =>
        binding.kind === "namespace-object" && binding.shape === "array",
    )
    ? mutationMethodBinding("Array", "*")
    : undefined;
  return unionRuntimeBindings(
    [unknownProperty, unknownArrayMutation].flatMap((binding) => binding ?? []),
  );
}

function arrayLiteralRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (value.type !== "ArrayExpression") return undefined;
  const properties = new Map<string, RuntimeBinding>();
  const propertyOperations: NamespacePropertyOperation[] = [];
  const elements = Array.isArray(value.elements) ? value.elements : [];
  let nextIndex: number | undefined = 0;
  let minimumUnknownIndex: number | undefined;
  for (const element of elements) {
    if (!isNode(element)) {
      if (nextIndex !== undefined) nextIndex++;
      continue;
    }
    if (element.type === "SpreadElement") {
      const spread = runtimeBindingForExpression(
        element.argument,
        imports,
        scopes,
      );
      const spreadLength = exactRuntimeArrayLength(spread);
      if (
        nextIndex !== undefined && spread && spreadLength !== undefined &&
        nextIndex + spreadLength <= MAX_MATERIALIZED_ARRAY_SPREAD_ENTRIES
      ) {
        for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex++) {
          const resolution = runtimePropertyResolution(
            spread,
            String(spreadIndex),
          );
          const name = String(nextIndex + spreadIndex);
          propertyOperations.push({
            kind: "define",
            name,
            binding: resolution.binding,
            aliasTargets: resolution.aliasTargets,
            defaultMayRun: resolution.defaultMayRun,
          });
          if (resolution.binding) properties.set(name, resolution.binding);
        }
        nextIndex += spreadLength;
        continue;
      }
      minimumUnknownIndex ??= nextIndex ?? 0;
      const resolution = spread
        ? runtimeUnknownPropertyResolution(spread)
        : { defaultMayRun: true };
      propertyOperations.push({
        kind: "define-unknown",
        binding: resolution.binding,
        aliasTargets: resolution.aliasTargets,
        defaultMayRun: true,
        minimumArrayIndex: minimumUnknownIndex,
      });
      nextIndex = undefined;
      continue;
    }
    const binding = runtimeBindingForExpression(element, imports, scopes);
    const aliasTargets = runtimeNamespaceAliasTargetsForExpression(
      element,
      imports,
      scopes,
    );
    const defaultMayRun = expressionMayBeUndefined(
      element,
      binding,
      imports,
      scopes,
    );
    if (nextIndex === undefined) {
      propertyOperations.push({
        kind: "define-unknown",
        binding,
        aliasTargets,
        defaultMayRun: true,
        minimumArrayIndex: minimumUnknownIndex,
      });
      continue;
    }
    const name = String(nextIndex);
    propertyOperations.push({
      kind: "define",
      name,
      binding,
      aliasTargets,
      defaultMayRun,
      configurable: true,
      enumerable: true,
    });
    if (binding) properties.set(name, binding);
    nextIndex++;
  }
  return {
    kind: "namespace-object",
    shape: "array",
    exactArrayLength: nextIndex,
    extensible: true,
    properties,
    propertyOperations,
  };
}

function exactRuntimeArrayLength(
  binding: RuntimeBinding | undefined,
): number | undefined {
  const candidates = flattenRuntimeBindings(binding);
  if (candidates.length === 0) return undefined;
  const lengths = candidates.map((candidate) =>
    candidate.kind === "namespace-object" && candidate.shape === "array"
      ? candidate.exactArrayLength
      : undefined
  );
  const length = lengths[0];
  return length !== undefined &&
      lengths.every((candidate) => candidate === length)
    ? length
    : undefined;
}

function objectLiteralRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (value.type !== "ObjectExpression") return undefined;
  const properties = new Map<string, RuntimeBinding>();
  const propertyOperations: NamespacePropertyOperation[] = [];
  for (
    const property of Array.isArray(value.properties) ? value.properties : []
  ) {
    if (!isNode(property)) continue;
    if (property.type === "SpreadElement") {
      const spread = runtimeBindingForExpression(
        property.argument,
        imports,
        scopes,
      );
      if (spread) {
        propertyOperations.push({
          kind: "spread",
          binding: spread,
          conservativePartial: true,
        });
      }
      continue;
    }
    const name = staticObjectPropertyName(property);
    if (!name) {
      if (
        property.type === "ObjectProperty" && property.computed === true
      ) {
        const binding = runtimeBindingForExpression(
          property.value,
          imports,
          scopes,
        );
        propertyOperations.push({
          kind: "define-unknown",
          binding,
          aliasTargets: runtimeNamespaceAliasTargetsForExpression(
            property.value,
            imports,
            scopes,
          ),
          defaultMayRun: expressionMayBeUndefined(
            property.value,
            binding,
            imports,
            scopes,
          ),
          configurable: true,
          enumerable: true,
        });
      } else if (
        property.type === "ObjectMethod" && property.kind === "get"
      ) {
        propertyOperations.push({
          kind: "define-unknown",
          ...runtimeGetterResolution(property, imports, scopes),
          configurable: true,
          enumerable: true,
        });
      }
      continue;
    }
    if (property.type === "ObjectMethod" && property.kind === "get") {
      const resolution = runtimeGetterResolution(property, imports, scopes);
      propertyOperations.push({
        kind: "define",
        name,
        ...resolution,
        configurable: true,
        enumerable: true,
      });
      if (resolution.binding) properties.set(name, resolution.binding);
      else properties.delete(name);
      continue;
    }
    if (property.type !== "ObjectProperty") {
      properties.delete(name);
      propertyOperations.push({
        kind: "define",
        name,
        defaultMayRun: false,
        configurable: true,
        enumerable: true,
      });
      continue;
    }
    const binding = runtimeBindingForExpression(
      property.value,
      imports,
      scopes,
    );
    propertyOperations.push({
      kind: "define",
      name,
      binding,
      aliasTargets: runtimeNamespaceAliasTargetsForExpression(
        property.value,
        imports,
        scopes,
      ),
      defaultMayRun: expressionMayBeUndefined(
        property.value,
        binding,
        imports,
        scopes,
      ),
      configurable: true,
      enumerable: true,
    });
    if (binding) {
      properties.set(name, binding);
    } else {
      properties.delete(name);
    }
  }
  return {
    kind: "namespace-object",
    shape: "object",
    extensible: true,
    properties,
    propertyOperations,
  };
}

function runtimeGetterResolution(
  getter: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimePropertyResolution {
  const returned = runtimeFunctionReturnExpressions(getter);
  const bindings = returned.expressions.flatMap((expression) => {
    const binding = runtimeBindingForExpression(expression, imports, scopes);
    return binding ? [binding] : [];
  });
  return {
    binding: unionRuntimeBindingsPreservingPartial(bindings),
    aliasTargets: uniqueRuntimeAliasTargets(
      returned.expressions.flatMap((expression) =>
        runtimeNamespaceAliasTargetsForExpression(expression, imports, scopes)
      ),
    ),
    // Block-bodied getters may complete without reaching a return statement.
    defaultMayRun: true,
  };
}

function expressionMayBeUndefined(
  expression: unknown,
  binding: RuntimeBinding | undefined,
  imports: ImportBindings,
  scopes: readonly Scope[],
): boolean {
  const value = unwrapExpression(expression);
  if (!value) return true;
  const assignment = runtimeAssignmentExpressionResolution(
    value,
    imports,
    scopes,
  );
  if (assignment) return assignment.defaultMayRun;
  const nestedMayBeUndefined = (candidate: unknown): boolean =>
    expressionMayBeUndefined(
      candidate,
      runtimeBindingForExpression(candidate, imports, scopes),
      imports,
      scopes,
    );
  if (value.type === "ConditionalExpression") {
    return nestedMayBeUndefined(value.consequent) ||
      nestedMayBeUndefined(value.alternate);
  }
  if (value.type === "LogicalExpression") {
    return value.operator === "&&"
      ? nestedMayBeUndefined(value.left) || nestedMayBeUndefined(value.right)
      : nestedMayBeUndefined(value.right);
  }
  if (value.type === "SequenceExpression") {
    const expressions = Array.isArray(value.expressions)
      ? value.expressions
      : [];
    return nestedMayBeUndefined(expressions.at(-1));
  }
  if (value.type === "Identifier") {
    const resolved = resolveLocalBinding(value.name as string, scopes);
    return resolved.declared
      ? !resolved.definitelyNonUndefined
      : binding === undefined;
  }
  if (value.type === "UnaryExpression") return value.operator === "void";
  if (
    (value.type === "OptionalCallExpression" ||
      value.type === "OptionalMemberExpression") && value.optional === true
  ) {
    return true;
  }
  if (binding) return false;
  return !(
    value.type === "ArrayExpression" ||
    value.type === "ArrowFunctionExpression" ||
    value.type === "BigIntLiteral" ||
    value.type === "BinaryExpression" ||
    value.type === "BooleanLiteral" ||
    value.type === "ClassExpression" ||
    value.type === "DecimalLiteral" ||
    value.type === "FunctionExpression" ||
    value.type === "JSXElement" ||
    value.type === "JSXFragment" ||
    value.type === "NewExpression" ||
    value.type === "NullLiteral" ||
    value.type === "NumericLiteral" ||
    value.type === "ObjectExpression" ||
    value.type === "RegExpLiteral" ||
    value.type === "StringLiteral" ||
    value.type === "TemplateLiteral"
  );
}

function constructedRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  const constructorBindings = value.type === "NewExpression" &&
      isNode(value.callee)
    ? [runtimeBindingForExpression(value.callee, imports, scopes)]
    : isCallLikeExpression(value) && isNode(value.callee)
    ? reflectInvocationCalls(
      unwrapExpression(value.callee),
      Array.isArray(value.arguments) ? value.arguments : [],
      imports,
      scopes,
    ).filter((invocation) => invocation.method === "construct")
      .map((invocation) =>
        runtimeBindingForExpression(
          invocation.arguments[0],
          imports,
          scopes,
        )
      )
    : [];
  return unionRuntimeBindings(
    constructorBindings.flatMap((binding) =>
      flattenRuntimeBindings(binding).flatMap((candidate) =>
        candidate.kind === "module-constructor"
          ? [{ kind: "module-instance", source: candidate.source } as const]
          : []
      )
    ),
  );
}

function alternativeRuntimeBinding(
  value: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (value.type === "ConditionalExpression") {
    return partialAlternativeRuntimeBinding([
      runtimeBindingForExpression(value.consequent, imports, scopes),
      runtimeBindingForExpression(value.alternate, imports, scopes),
    ]);
  }
  if (value.type === "LogicalExpression") {
    return partialAlternativeRuntimeBinding([
      runtimeBindingForExpression(value.left, imports, scopes),
      runtimeBindingForExpression(value.right, imports, scopes),
    ]);
  }
  return undefined;
}

function partialAlternativeRuntimeBinding(
  alternatives: readonly (RuntimeBinding | undefined)[],
): RuntimeBinding | undefined {
  const partial = alternatives.some((candidate) =>
    candidate === undefined || runtimeBindingHasPartialAlternative(candidate)
  );
  const binding = unionRuntimeBindings(
    alternatives.flatMap((candidate) => candidate ?? []),
  );
  return binding && partial ? { kind: "partial", binding } : binding;
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
  const args = Array.isArray(value.arguments) ? value.arguments : [];
  return unionRuntimeBindings(
    flattenRuntimeBindings(binding).flatMap((candidate): RuntimeBinding[] => {
      if (candidate.kind === "mutation-method") {
        if (candidate.receiver !== "Array") return [];
        return [{
          ...candidate,
          boundTarget: candidate.boundTarget ?? args[0],
          boundValues: [
            ...candidate.boundValues ?? [],
            ...args.slice(1),
          ],
        }];
      }
      if (!isCallableRuntimeBinding(candidate)) return [];
      return [
        candidate.kind === "effect" ? candidate : {
          ...candidate,
          boundArguments: [
            ...candidate.boundArguments ?? [],
            ...args.slice(1),
          ],
        },
      ];
    }),
  );
}

function identifierRuntimeBinding(
  init: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (init.type !== "Identifier") return undefined;
  const name = init.name as string;
  const classAlias = classStaticAliasResolution(name, scopes);
  if (classAlias) return classAlias.binding;
  const resolved = resolveLocalBinding(name, scopes);
  const aliasTargets = runtimeAliasTargetsForName(name, scopes);
  if (aliasTargets.length > 0) {
    return unionRuntimeBindings([
      resolved.binding,
      ...aliasTargets.map((target) =>
        target.scope.runtimeBindings.get(target.root)
      ),
    ].flatMap((binding) => binding ?? []));
  }
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
  const runtimeNamespace = imports.runtimeNamespaces.get(name);
  if (runtimeNamespace) return { kind: "module", source: runtimeNamespace };
  const runtimeConstructor = imports.runtimeConstructors.get(name);
  if (runtimeConstructor) {
    return { kind: "module-constructor", source: runtimeConstructor };
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
  const runtimeNamespace = imports.runtimeNamespaces.get(name);
  if (runtimeNamespace) return runtimeNamespace;
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
  if (property !== "promises") return undefined;
  if (isFilesystemSpecifier(source)) return "node:fs/promises";
  return isDnsSpecifier(source) ? "node:dns/promises" : undefined;
}

function moduleRuntimeBindingForProperty(
  source: string,
  property: string,
): RuntimeBinding | undefined {
  if (isDnsSpecifier(source) && DNS_RESOLVER_CONSTRUCTORS.has(property)) {
    return { kind: "module-constructor", source };
  }
  if (isFilesystemSpecifier(source) && FILESYSTEM_OPEN_METHODS.has(property)) {
    return { kind: "filesystem-open", source };
  }
  if (isProcessSpecifier(source) && property === "env") {
    return { kind: "effect-object", effect: "process" };
  }
  if (isProcessSpecifier(source) && property === "argv") {
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
  if (intrinsic === "Array" && property === "prototype") {
    return { kind: "shared-object", intrinsic: "Array.prototype" };
  }
  if (
    intrinsic === "Reflect" &&
    (property === "apply" || property === "construct")
  ) {
    return { kind: "reflect-method", method: property };
  }
  const mutation = intrinsic
    ? mutationMethodBinding(intrinsic, property)
    : undefined;
  if (mutation) return mutation;
  return { kind: "shared-object" };
}

function runtimePatternPropertyResolution(
  binding: RuntimeBinding,
  property: Node,
): RuntimePropertyResolution {
  const propertyName = staticObjectPropertyName(property);
  const resolution = propertyName
    ? runtimePropertyResolution(binding, propertyName)
    : property.computed === true
    ? runtimeUnknownPropertyResolution(binding)
    : { defaultMayRun: true };
  if (!runtimeBindingHasPartialAlternative(binding)) return resolution;
  return {
    ...resolution,
    binding: unionDerivedRuntimeBindingsPreservingPartial(
      binding,
      [resolution.binding, conservativeSemanticEffectBinding()].flatMap(
        (candidate) => candidate ?? [],
      ),
    ),
  };
}

function runtimeArrayPatternEntries(
  pattern: Node,
  binding: RuntimeBinding | undefined,
): readonly RuntimePatternEntry[] {
  if (pattern.type !== "ArrayPattern") return [];
  const entries: RuntimePatternEntry[] = [];
  const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (!isNode(element)) continue;
    if (element.type === "RestElement") {
      if (!isNode(element.argument)) continue;
      entries.push({
        pattern: element.argument,
        resolution: {
          binding: binding
            ? runtimeArrayRestBinding(binding, index)
            : undefined,
          defaultMayRun: false,
        },
      });
      continue;
    }
    entries.push({
      pattern: element,
      resolution: binding
        ? runtimePropertyResolution(binding, String(index))
        : { defaultMayRun: true },
    });
  }
  return entries;
}

function runtimeArrayRestBinding(
  binding: RuntimeBinding,
  startIndex: number,
): RuntimeBinding {
  return unionRuntimeBindings(
    flattenRuntimeBindings(binding).map((candidate) =>
      staticRuntimeArrayRestBinding(candidate, startIndex) ??
        conservativeRuntimeArrayRestBinding(candidate)
    ),
  ) ?? { kind: "namespace-object", shape: "array", properties: new Map() };
}

function staticRuntimeArrayRestBinding(
  binding: RuntimeBinding,
  startIndex: number,
): RuntimeBinding | undefined {
  if (
    binding.kind !== "namespace-object" ||
    binding.shape !== "array" ||
    binding.propertyOperations?.some((operation) => operation.kind !== "define")
  ) {
    return undefined;
  }
  const indexedProperties: Array<{
    readonly property: string;
    readonly index: number;
  }> = [];
  for (const property of namespacePropertyNames(binding)) {
    const index = runtimeArrayIndex(property);
    if (
      index === undefined ||
      binding.exactArrayLength !== undefined &&
        index >= binding.exactArrayLength
    ) {
      continue;
    }
    indexedProperties.push({ property, index });
  }
  const properties = new Map<string, RuntimeBinding>();
  const propertyOperations: NamespacePropertyOperation[] = [];
  for (
    const { property, index } of indexedProperties.sort((left, right) =>
      left.index - right.index
    )
  ) {
    if (index < startIndex) continue;
    const name = String(index - startIndex);
    const resolution = runtimePropertyResolution(binding, property);
    propertyOperations.push({
      kind: "define",
      name,
      binding: resolution.binding,
      aliasTargets: resolution.aliasTargets,
      defaultMayRun: resolution.defaultMayRun,
    });
    if (resolution.binding) properties.set(name, resolution.binding);
  }
  return {
    kind: "namespace-object",
    shape: "array",
    exactArrayLength: binding.exactArrayLength === undefined
      ? undefined
      : Math.max(0, binding.exactArrayLength - startIndex),
    properties,
    propertyOperations,
  };
}

function runtimeArrayIndex(property: string): number | undefined {
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 &&
      String(index) === property
    ? index
    : undefined;
}

function conservativeRuntimeArrayRestBinding(
  binding: RuntimeBinding,
): RuntimeBinding {
  const resolution = runtimeUnknownPropertyResolution(binding);
  const aliasTargets = resolution.aliasTargets ?? [];
  return resolution.binding || aliasTargets.length > 0
    ? {
      kind: "namespace-object",
      shape: "array",
      properties: new Map(),
      propertyOperations: [{
        kind: "define-unknown",
        binding: resolution.binding,
        aliasTargets,
        defaultMayRun: true,
        crossesFunctionBoundary: false,
      }],
    }
    : { kind: "namespace-object", shape: "array", properties: new Map() };
}

function runtimePropertyBinding(
  binding: RuntimeBinding,
  property: string,
): RuntimeBinding | undefined {
  return runtimePropertyResolution(binding, property).binding;
}

function runtimePropertyGetterEffectBinding(
  binding: RuntimeBinding,
  property: string,
  onlyEnumerable = false,
): RuntimeBinding | undefined {
  if (!runtimeBindingMayContainGetterEffect(binding)) return undefined;
  const rawBinding = runtimePropertyResolution(
    binding,
    property,
    true,
    onlyEnumerable,
  ).binding;
  return unionRuntimeBindings(
    flattenRuntimeBindings(rawBinding).flatMap((candidate) =>
      candidate.kind === "property-getter-effect" &&
        (!onlyEnumerable || candidate.enumerable !== false)
        ? [candidate.binding]
        : []
    ),
  );
}

function runtimeUnknownPropertyGetterEffectBinding(
  binding: RuntimeBinding | undefined,
  onlyEnumerable = false,
): RuntimeBinding | undefined {
  if (!runtimeBindingMayContainGetterEffect(binding)) return undefined;
  return unionRuntimeBindings(
    flattenRuntimeBindings(binding).flatMap((candidate) =>
      candidate.kind === "namespace-object"
        ? [...namespaceUnknownPropertyNames(candidate)].flatMap((property) =>
          runtimePropertyGetterEffectBinding(
            candidate,
            property,
            onlyEnumerable,
          ) ??
            []
        )
        : []
    ),
  );
}

function runtimeBindingMayContainGetterEffect(
  binding: RuntimeBinding | undefined,
): boolean {
  const roots = flattenRuntimeBindings(binding);
  const pending = [...roots];
  const visited = new Set<RuntimeBinding>();
  const dynamic = new Set<RuntimeBinding>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || visited.has(candidate)) continue;
    const cached = RUNTIME_GETTER_EFFECT_PRESENCE.get(candidate);
    if (cached !== undefined) {
      if (cached) {
        for (const root of roots) {
          RUNTIME_GETTER_EFFECT_PRESENCE.set(root, true);
        }
        return true;
      }
      continue;
    }
    visited.add(candidate);
    if (candidate.kind === "property-getter-effect") {
      for (const root of roots) {
        RUNTIME_GETTER_EFFECT_PRESENCE.set(root, true);
      }
      return true;
    }
    if (candidate.kind === "one-of") {
      pending.push(...candidate.bindings);
      continue;
    }
    if (candidate.kind !== "namespace-object") continue;
    pending.push(...candidate.properties.values());
    for (const operation of candidate.propertyOperations ?? []) {
      if (operation.kind === "spread") {
        pending.push(operation.binding);
      } else {
        if (operation.binding) pending.push(operation.binding);
        if ((operation.aliasTargets?.length ?? 0) > 0) {
          dynamic.add(candidate);
          const current = currentRuntimeAliasBinding(operation.aliasTargets);
          if (current) pending.push(current);
        }
      }
    }
  }
  if (dynamic.size === 0) {
    for (const candidate of visited) {
      RUNTIME_GETTER_EFFECT_PRESENCE.set(candidate, false);
    }
  }
  return false;
}

function runtimePropertySetterBinding(
  binding: RuntimeBinding,
  property: string,
): RuntimeBinding | undefined {
  const rawBinding = runtimePropertyResolution(binding, property, true).binding;
  return unionRuntimeBindings(
    flattenRuntimeBindings(rawBinding).flatMap((candidate) =>
      candidate.kind === "property-setter" ? [candidate.binding] : []
    ),
  );
}

function runtimeUnknownPropertySetterBinding(
  binding: RuntimeBinding,
): RuntimeBinding | undefined {
  return unionRuntimeBindings(
    flattenRuntimeBindings(binding).flatMap((candidate) =>
      candidate.kind === "namespace-object"
        ? [...namespaceUnknownPropertyNames(candidate)].flatMap((property) =>
          runtimePropertySetterBinding(candidate, property) ?? []
        )
        : []
    ),
  );
}

function runtimeReadablePropertyBinding(
  binding: RuntimeBinding | undefined,
): RuntimeBinding | undefined {
  return unionDerivedRuntimeBindingsPreservingPartial(
    binding,
    flattenRuntimeBindings(binding).flatMap((candidate) =>
      candidate.kind === "property-getter-value"
        ? [candidate.binding]
        : candidate.kind === "property-getter-effect" ||
            candidate.kind === "property-setter"
        ? []
        : [candidate]
    ),
  );
}

function runtimeEnumerablePropertyBinding(
  binding: RuntimeBinding,
  property: string,
): RuntimeBinding | undefined {
  const resolution = runtimePropertyResolution(binding, property, true, true);
  if (resolution.enumerable === false) return undefined;
  const rawBinding = resolution.binding;
  return unionDerivedRuntimeBindingsPreservingPartial(
    rawBinding,
    flattenRuntimeBindings(rawBinding).flatMap((candidate) =>
      candidate.kind === "property-getter-value"
        ? candidate.enumerable === false ? [] : [candidate.binding]
        : candidate.kind === "property-getter-effect" ||
            candidate.kind === "property-setter"
        ? []
        : [candidate]
    ),
  );
}

function runtimeUnknownGetterEnumerabilities(
  binding: RuntimeBinding,
): readonly (boolean | undefined)[] {
  return flattenRuntimeBindings(binding).flatMap((candidate) =>
    candidate.kind === "namespace-object"
      ? [...namespaceUnknownPropertyNames(candidate)].flatMap((property) =>
        flattenRuntimeBindings(
          runtimePropertyResolution(candidate, property, true).binding,
        ).flatMap((propertyBinding) =>
          propertyBinding.kind === "property-getter-effect" ||
            propertyBinding.kind === "property-getter-value"
            ? [propertyBinding.enumerable]
            : []
        )
      )
      : []
  );
}

function runtimePropertyResolution(
  binding: RuntimeBinding,
  property: string,
  includeSetters = false,
  ownEnumerableOnly = false,
): RuntimePropertyResolution {
  type ResolutionFrame =
    | {
      readonly kind: "resolve";
      readonly binding: RuntimeBinding;
      readonly ownEnumerableOnly: boolean;
    }
    | { readonly kind: "combine-partial" }
    | { readonly kind: "combine-one-of"; readonly count: number }
    | {
      readonly kind: "combine-namespace";
      readonly binding: Extract<
        RuntimeBinding,
        { readonly kind: "namespace-object" }
      >;
      readonly spreadCount: number;
      readonly ownEnumerableOnly: boolean;
    };
  const frames: ResolutionFrame[] = [{
    kind: "resolve",
    binding,
    ownEnumerableOnly,
  }];
  const resolutions: RuntimePropertyResolution[] = [];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (!frame) continue;
    if (frame.kind === "combine-partial") {
      const resolution = resolutions.pop() ?? { defaultMayRun: true };
      resolutions.push({
        ...resolution,
        binding: resolution.binding
          ? { kind: "partial", binding: resolution.binding }
          : undefined,
        defaultMayRun: true,
      });
      continue;
    }
    if (frame.kind === "combine-one-of") {
      const candidates = frame.count === 0
        ? []
        : resolutions.splice(-frame.count, frame.count);
      resolutions.push({
        binding: unionRuntimeBindingsPreservingPartial(
          candidates.flatMap((resolution) => resolution.binding ?? []),
        ),
        aliasTargets: uniqueRuntimeAliasTargets(
          candidates.flatMap((resolution) => resolution.aliasTargets ?? []),
        ),
        defaultMayRun: candidates.some((resolution) =>
          resolution.defaultMayRun
        ),
        enumerable: candidates.every((resolution) =>
            resolution.enumerable === candidates[0]?.enumerable
          )
          ? candidates[0]?.enumerable
          : undefined,
        configurable: candidates.every((resolution) =>
            resolution.configurable === candidates[0]?.configurable
          )
          ? candidates[0]?.configurable
          : undefined,
      });
      continue;
    }
    if (frame.kind === "combine-namespace") {
      const spreadResolutions = frame.spreadCount === 0
        ? []
        : resolutions.splice(-frame.spreadCount, frame.spreadCount);
      let spreadIndex = 0;
      let resolution: RuntimePropertyResolution = { defaultMayRun: true };
      const fallbackOperations: Extract<
        NamespacePropertyOperation,
        { readonly kind: "define-unknown" }
      >[] = [];
      for (const operation of frame.binding.propertyOperations ?? []) {
        if (operation.kind === "define") {
          if (operation.name === property) {
            if (
              frame.ownEnumerableOnly && operation.enumerable === false
            ) {
              resolution = {
                defaultMayRun: true,
                enumerable: false,
                configurable: operation.configurable,
              };
              continue;
            }
            const operationBinding = unionRuntimeBindingsPreservingPartial(
              [
                operation.binding,
                currentRuntimeAliasBinding(operation.aliasTargets),
              ].flatMap((candidate) => candidate ?? []),
            );
            resolution = operation.preservesPrevious
              ? {
                binding: unionRuntimeBindingsPreservingPartial(
                  [resolution.binding, operationBinding].flatMap(
                    (candidate) => candidate ?? [],
                  ),
                ),
                aliasTargets: uniqueRuntimeAliasTargets([
                  ...(resolution.aliasTargets ?? []),
                  ...(operation.aliasTargets ?? []),
                ]),
                defaultMayRun: resolution.defaultMayRun ||
                  operation.defaultMayRun,
                enumerable: resolution.enumerable === operation.enumerable
                  ? resolution.enumerable
                  : undefined,
                configurable: resolution.configurable === operation.configurable
                  ? resolution.configurable
                  : undefined,
              }
              : {
                binding: operationBinding,
                aliasTargets: operation.aliasTargets,
                defaultMayRun: operation.defaultMayRun,
                enumerable: operation.enumerable,
                configurable: operation.configurable,
              };
          }
          continue;
        }
        if (operation.kind === "define-unknown") {
          if (
            frame.ownEnumerableOnly &&
            (operation.fallbackOnly === true || operation.enumerable === false)
          ) {
            continue;
          }
          if (operation.fallbackOnly === true) {
            fallbackOperations.push(operation);
            continue;
          }
          resolution = applyRuntimeUnknownPropertyOperation(
            resolution,
            operation,
            property,
          );
          continue;
        }
        const spreadResolution = spreadResolutions[spreadIndex++] ?? {
          defaultMayRun: true,
        };
        const spreadBinding = operation.conservativePartial === true &&
            runtimeBindingHasPartialAlternative(spreadResolution.binding)
          ? unionRuntimeBindings([
            spreadResolution.binding,
            conservativeSemanticEffectBinding(),
          ].flatMap((candidate) => candidate ?? []))
          : spreadResolution.binding;
        resolution = {
          binding: unionRuntimeBindingsPreservingPartial(
            [
              spreadBinding,
              spreadResolution.defaultMayRun ? resolution.binding : undefined,
            ].flatMap((candidate) => candidate ?? []),
          ),
          aliasTargets: uniqueRuntimeAliasTargets([
            ...(spreadResolution.aliasTargets ?? []),
            ...(spreadResolution.defaultMayRun
              ? resolution.aliasTargets ?? []
              : []),
          ]),
          defaultMayRun: spreadResolution.defaultMayRun &&
            resolution.defaultMayRun,
          enumerable: spreadResolution.defaultMayRun ? undefined : true,
          configurable: spreadResolution.defaultMayRun ? undefined : true,
        };
      }
      for (const operation of fallbackOperations) {
        if (!resolution.defaultMayRun) break;
        resolution = applyRuntimeUnknownPropertyOperation(
          resolution,
          operation,
          property,
        );
      }
      const mutation = frame.binding.shape === "array" &&
          resolution.defaultMayRun
        ? mutationMethodBinding("Array", property)
        : undefined;
      resolutions.push(finalizeRuntimePropertyResolution(
        mutation
          ? {
            ...resolution,
            binding: unionRuntimeBindingsPreservingPartial(
              [resolution.binding, mutation].flatMap((candidate) =>
                candidate ?? []
              ),
            ),
          }
          : resolution,
        includeSetters,
      ));
      continue;
    }
    if (frame.binding.kind === "partial") {
      frames.push({ kind: "combine-partial" });
      frames.push({
        kind: "resolve",
        binding: frame.binding.binding,
        ownEnumerableOnly: frame.ownEnumerableOnly,
      });
      continue;
    }
    if (frame.binding.kind === "one-of") {
      frames.push({
        kind: "combine-one-of",
        count: frame.binding.bindings.length,
      });
      for (const candidate of [...frame.binding.bindings].reverse()) {
        frames.push({
          kind: "resolve",
          binding: candidate,
          ownEnumerableOnly: frame.ownEnumerableOnly,
        });
      }
      continue;
    }
    if (
      frame.binding.kind === "namespace-object" &&
      frame.binding.propertyOperations
    ) {
      const spreads = frame.binding.propertyOperations.flatMap((operation) =>
        operation.kind === "spread" ? [operation.binding] : []
      );
      frames.push({
        kind: "combine-namespace",
        binding: frame.binding,
        spreadCount: spreads.length,
        ownEnumerableOnly: frame.ownEnumerableOnly,
      });
      for (const spread of [...spreads].reverse()) {
        frames.push({
          kind: "resolve",
          binding: spread,
          ownEnumerableOnly: true,
        });
      }
      continue;
    }
    resolutions.push(directRuntimePropertyResolution(
      frame.binding,
      property,
      includeSetters,
    ));
  }
  return resolutions.at(-1) ?? { defaultMayRun: true };
}

function applyRuntimeUnknownPropertyOperation(
  resolution: RuntimePropertyResolution,
  operation: Extract<
    NamespacePropertyOperation,
    { readonly kind: "define-unknown" }
  >,
  property: string,
): RuntimePropertyResolution {
  const propertyIndex = runtimeArrayIndex(property);
  if (
    operation.minimumArrayIndex !== undefined &&
    (propertyIndex === undefined || propertyIndex < operation.minimumArrayIndex)
  ) {
    return resolution;
  }
  return {
    binding: unionRuntimeBindingsPreservingPartial(
      [
        resolution.binding,
        operation.binding,
        currentRuntimeAliasBinding(operation.aliasTargets),
      ].flatMap((candidate) => candidate ?? []),
    ),
    aliasTargets: uniqueRuntimeAliasTargets([
      ...(resolution.aliasTargets ?? []),
      ...(operation.aliasTargets ?? []),
    ]),
    defaultMayRun: resolution.defaultMayRun || operation.defaultMayRun,
    enumerable: resolution.enumerable === operation.enumerable
      ? resolution.enumerable
      : undefined,
    configurable: resolution.configurable === operation.configurable
      ? resolution.configurable
      : undefined,
  };
}

function directRuntimePropertyResolution(
  binding: Exclude<RuntimeBinding, { readonly kind: "one-of" }>,
  property: string,
  includeSetters: boolean,
): RuntimePropertyResolution {
  let propertyBinding: RuntimeBinding | undefined;
  if (binding.kind === "module") {
    const nestedSource = moduleSourceForProperty(binding.source, property);
    propertyBinding = nestedSource
      ? { kind: "module", source: nestedSource }
      : moduleRuntimeBindingForProperty(binding.source, property);
  } else if (binding.kind === "module-instance") {
    propertyBinding = moduleRuntimeBindingForProperty(binding.source, property);
  } else if (binding.kind === "global-object") {
    propertyBinding = globalObjectPropertyBinding(property);
  } else if (binding.kind === "shared-object") {
    propertyBinding = sharedObjectPropertyBinding(binding.intrinsic, property);
  } else if (binding.kind === "global-runtime") {
    if (
      binding.runtime === "Deno" && FILESYSTEM_OPEN_METHODS.has(property)
    ) {
      propertyBinding = { kind: "filesystem-open", source: "Deno" };
    } else {
      const effect = effectForGlobalRuntimeMethod(binding.runtime, property);
      propertyBinding = !effect ? undefined : property === "env" ||
          (binding.runtime === "Deno" && property === "args") ||
          (binding.runtime === "process" && property === "argv")
        ? { kind: "effect-object", effect }
        : { kind: "effect", effect };
    }
  } else if (binding.kind === "effect-object") {
    propertyBinding = { kind: "effect", effect: binding.effect };
  } else if (binding.kind === "namespace-object") {
    propertyBinding = binding.properties.get(property) ??
      (binding.shape === "array"
        ? mutationMethodBinding("Array", property)
        : undefined);
  }
  return finalizeRuntimePropertyResolution(
    {
      binding: propertyBinding,
      defaultMayRun: propertyBinding === undefined,
      enumerable: binding.kind === "namespace-object" && propertyBinding
        ? true
        : undefined,
      configurable: binding.kind === "namespace-object" && propertyBinding
        ? true
        : undefined,
    },
    includeSetters,
  );
}

function finalizeRuntimePropertyResolution(
  resolution: RuntimePropertyResolution,
  includeSetters: boolean,
): RuntimePropertyResolution {
  const resolvedBinding = includeSetters
    ? resolution.binding
    : runtimeReadablePropertyBinding(resolution.binding);
  const accessorOnly = !includeSetters && resolvedBinding === undefined &&
    flattenRuntimeBindings(resolution.binding).some((candidate) =>
      candidate.kind === "property-getter-effect" ||
      candidate.kind === "property-setter"
    );
  return {
    ...resolution,
    binding: resolvedBinding,
    defaultMayRun: resolution.defaultMayRun || accessorOnly,
  };
}

function mergeRuntimeBinding(
  existing: RuntimeBinding | undefined,
  incoming: RuntimeBinding,
  merge: boolean,
): RuntimeBinding {
  return merge && existing
    ? unionRuntimeBindingsPreservingPartial([existing, incoming]) ?? incoming
    : incoming;
}

function unionRuntimeBindings(
  bindings: readonly RuntimeBinding[],
): RuntimeBinding | undefined {
  const flattened = bindings.flatMap((binding) =>
    flattenRuntimeBindings(binding)
  );
  const unique = new Map<string, RuntimeBinding>();
  const identitySensitive = new Set<RuntimeBinding>();
  for (const binding of flattened) {
    if (binding.kind === "namespace-object") {
      identitySensitive.add(binding);
    } else {
      unique.set(runtimeBindingKey(binding), binding);
    }
  }
  const values = [...unique.values(), ...identitySensitive];
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : { kind: "one-of", bindings: values };
}

function unionRuntimeBindingsPreservingPartial(
  bindings: readonly RuntimeBinding[],
): RuntimeBinding | undefined {
  const partial = bindings.some(runtimeBindingHasPartialAlternative);
  const binding = unionRuntimeBindings(bindings);
  return partial && binding ? { kind: "partial", binding } : binding;
}

function unionDerivedRuntimeBindingsPreservingPartial(
  source: RuntimeBinding | undefined,
  bindings: readonly RuntimeBinding[],
): RuntimeBinding | undefined {
  const binding = unionRuntimeBindingsPreservingPartial(bindings);
  return binding && runtimeBindingHasPartialAlternative(source) &&
      !runtimeBindingHasPartialAlternative(binding)
    ? { kind: "partial", binding }
    : binding;
}

function flattenRuntimeBindings(
  binding: RuntimeBinding | undefined,
): readonly RuntimeBinding[] {
  return binding?.kind === "partial"
    ? flattenRuntimeBindings(binding.binding)
    : binding?.kind === "one-of"
    ? binding.bindings.flatMap((candidate) => flattenRuntimeBindings(candidate))
    : binding
    ? [binding]
    : [];
}

function runtimeBindingHasPartialAlternative(
  binding: RuntimeBinding | undefined,
): boolean {
  return binding?.kind === "partial" ||
    (binding?.kind === "one-of" &&
      binding.bindings.some(runtimeBindingHasPartialAlternative));
}

function runtimePropertyHasCrossFunctionMutation(
  binding: RuntimeBinding | undefined,
  path: readonly string[],
): boolean {
  if (path.length === 0) return false;
  const pending: Array<{
    readonly binding: RuntimeBinding;
    readonly pathIndex: number;
  }> = flattenRuntimeBindings(binding).map((candidate) => ({
    binding: candidate,
    pathIndex: 0,
  }));
  const visited = new Map<RuntimeBinding, Set<number>>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const candidate of flattenRuntimeBindings(current.binding)) {
      if (candidate.kind !== "namespace-object") continue;
      const visitedIndexes = visited.get(candidate) ?? new Set<number>();
      if (visitedIndexes.has(current.pathIndex)) continue;
      visitedIndexes.add(current.pathIndex);
      visited.set(candidate, visitedIndexes);
      const property = path[current.pathIndex];
      const hasRest = current.pathIndex + 1 < path.length;
      if (candidate.propertyOperations) {
        for (const operation of candidate.propertyOperations) {
          if (operation.kind === "spread") {
            pending.push({
              binding: operation.binding,
              pathIndex: current.pathIndex,
            });
            continue;
          }
          if (operation.kind === "define-unknown") {
            const propertyIndex = runtimeArrayIndex(property);
            if (
              operation.minimumArrayIndex !== undefined &&
              (propertyIndex === undefined ||
                propertyIndex < operation.minimumArrayIndex)
            ) continue;
          } else if (operation.name !== property) {
            continue;
          }
          if (operation.crossesFunctionBoundary === true) return true;
          if (hasRest && operation.binding) {
            pending.push({
              binding: operation.binding,
              pathIndex: current.pathIndex + 1,
            });
          }
        }
        continue;
      }
      const nested = candidate.properties.get(property);
      if (hasRest && nested) {
        pending.push({
          binding: nested,
          pathIndex: current.pathIndex + 1,
        });
      }
    }
  }
  return false;
}

function runtimeBindingKey(binding: RuntimeBinding): string {
  if (binding.kind === "effect") return `effect:${binding.effect}`;
  if (binding.kind === "filesystem-open") {
    return `filesystem-open:${binding.source}:${
      JSON.stringify(binding.boundArguments ?? [])
    }`;
  }
  if (binding.kind === "constructor-effect") {
    return `constructor-effect:${binding.effect}`;
  }
  if (binding.kind === "global-runtime") {
    return `global-runtime:${binding.runtime}`;
  }
  if (binding.kind === "module") return `module:${binding.source}`;
  if (binding.kind === "module-constructor") {
    return `module-constructor:${binding.source}`;
  }
  if (binding.kind === "module-instance") {
    return `module-instance:${binding.source}`;
  }
  if (binding.kind === "effect-object") {
    return `effect-object:${binding.effect}`;
  }
  if (binding.kind === "property-getter-effect") {
    return `property-getter-effect:${binding.enumerable ?? "unknown"}:${
      runtimeBindingKey(binding.binding)
    }`;
  }
  if (binding.kind === "property-getter-value") {
    return `property-getter-value:${binding.enumerable ?? "unknown"}:${
      runtimeBindingKey(binding.binding)
    }`;
  }
  if (binding.kind === "property-setter") {
    return `property-setter:${runtimeBindingKey(binding.binding)}`;
  }
  if (binding.kind === "mutation-method") {
    const bound = binding.receiver === "Array"
      ? `:${JSON.stringify(binding.boundTarget ?? null)}:${
        JSON.stringify(binding.boundValues ?? [])
      }`
      : "";
    return `mutation-method:${binding.receiver}.${binding.method}${bound}`;
  }
  if (binding.kind === "reflect-method") {
    return `reflect-method:${binding.method}:${
      JSON.stringify(binding.boundArguments ?? [])
    }`;
  }
  if (binding.kind === "shared-object") {
    return `shared-object:${binding.intrinsic ?? "*"}`;
  }
  if (binding.kind === "partial") {
    return `partial:${runtimeBindingKey(binding.binding)}`;
  }
  if (binding.kind === "namespace-object") return "namespace-object";
  if (binding.kind === "one-of") {
    return `one-of:${
      flattenRuntimeBindings(binding).map(runtimeBindingKey).sort(
        compareOrdinal,
      )
        .join("|")
    }`;
  }
  return binding.kind;
}

function bindPatternToRuntime(
  pattern: Node,
  binding: RuntimeBinding,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
  merge = false,
  clear = false,
): void {
  if (pattern.type === "AssignmentPattern" && isNode(pattern.left)) {
    bindPatternToRuntime(
      pattern.left,
      binding,
      imports,
      scopes,
      scope,
      merge,
      clear,
    );
    return;
  }
  if (pattern.type === "RestElement" && isNode(pattern.argument)) {
    bindPatternToRuntime(
      pattern.argument,
      binding,
      imports,
      scopes,
      scope,
      merge,
      clear,
    );
    return;
  }
  if (pattern.type === "Identifier") {
    const name = pattern.name as string;
    scope.runtimeBindings.set(
      name,
      mergeRuntimeBinding(scope.runtimeBindings.get(name), binding, merge),
    );
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const entry of runtimeArrayPatternEntries(pattern, binding)) {
      const propertyBinding = entry.resolution.binding;
      if (propertyBinding) {
        bindPatternToRuntime(
          entry.pattern,
          propertyBinding,
          imports,
          scopes,
          scope,
          merge,
          clear,
        );
      } else if (clear) {
        clearCurrentScopeRuntimeAssignmentPattern(entry.pattern, [scope]);
      }
      if (entry.resolution.defaultMayRun) {
        bindRuntimePatternDefaults(
          entry.pattern,
          imports,
          scopes,
          (pattern, defaultBinding) =>
            bindPatternToRuntime(
              pattern,
              defaultBinding,
              imports,
              scopes,
              scope,
              merge || propertyBinding !== undefined,
              clear,
            ),
        );
      }
    }
    return;
  }
  if (
    pattern.type !== "ObjectPattern" ||
    (binding.kind !== "module" && binding.kind !== "global-runtime" &&
      binding.kind !== "module-instance" &&
      binding.kind !== "global-object" &&
      binding.kind !== "shared-object" && binding.kind !== "effect-object" &&
      binding.kind !== "namespace-object" && binding.kind !== "one-of" &&
      binding.kind !== "partial")
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
      bindPatternToRuntime(
        property.argument,
        binding,
        imports,
        scopes,
        scope,
        merge,
        clear,
      );
      continue;
    }
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const propertyResolution = runtimePatternPropertyResolution(
      binding,
      property,
    );
    const propertyBinding = propertyResolution.binding;
    if (propertyBinding) {
      bindPatternToRuntime(
        property.value,
        propertyBinding,
        imports,
        scopes,
        scope,
        merge,
        clear,
      );
    } else if (clear) {
      clearCurrentScopeRuntimeAssignmentPattern(property.value, [scope]);
    }
    if (propertyResolution.defaultMayRun) {
      bindRuntimePatternDefaults(
        property.value,
        imports,
        scopes,
        (pattern, defaultBinding) =>
          bindPatternToRuntime(
            pattern,
            defaultBinding,
            imports,
            scopes,
            scope,
            merge || propertyBinding !== undefined,
            clear,
          ),
      );
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
): {
  readonly declared: boolean;
  readonly definitelyNonUndefined?: boolean;
  readonly binding?: RuntimeBinding;
} {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    if (!scope.names.has(name)) continue;
    return {
      declared: true,
      definitelyNonUndefined: scope.definitelyNonUndefinedNames.has(name),
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
    isStandardFilesystemSpecifier(source) ||
    source === CANONICAL_COMPAT_FS_SOURCE ||
    source === "#veryfront/compat/fs.ts" ||
    source === "#veryfront/platform/compat/fs.ts";
}

function isStandardFilesystemSpecifier(source: string): boolean {
  return source === "@std/fs" || source.startsWith("@std/fs/") ||
    source === "#std/fs" || source === "#std/fs.ts" ||
    source.startsWith("#std/fs/");
}

function isProcessSpecifier(source: string): boolean {
  return source === "node:child_process" || source === "child_process" ||
    source === "node:worker_threads" || source === "worker_threads" ||
    source === "node:process" || source === "process" ||
    source === CANONICAL_COMPAT_PROCESS_SOURCE ||
    source === "#veryfront/compat/process.ts" ||
    source === "#veryfront/platform/compat/process.ts";
}

function isTestingRuntimeSpecifier(source: string): boolean {
  return source === "#veryfront/testing" ||
    source === "#veryfront/testing/deno-compat" ||
    source === "#veryfront/testing/deno-compat.ts" ||
    source === "#veryfront/testing/mock-fetch" ||
    source === "#veryfront/testing/mock-fetch.ts" ||
    source === CANONICAL_TESTING_DENO_COMPAT_SOURCE ||
    source === CANONICAL_TESTING_BARREL_SOURCE ||
    source === CANONICAL_TESTING_MOCK_FETCH_SOURCE;
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

function isDnsSpecifier(source: string): boolean {
  return source === "node:dns" || source === "node:dns/promises" ||
    source === "dns" || source === "dns/promises";
}

function isCreateRequireSpecifier(source: string): boolean {
  return source === "node:module" || source === "module";
}

function isRuntimeEffectModule(source: string): boolean {
  return isFilesystemSpecifier(source) || isProcessSpecifier(source) ||
    isServerSpecifier(source) || isDnsSpecifier(source) ||
    isPlaywrightSpecifier(source) ||
    isTestingRuntimeSpecifier(source);
}

function effectForModuleMethod(
  source: string,
  method: string,
): SemanticEffect | undefined {
  if (isTestingRuntimeSpecifier(source)) {
    if (READ_METHODS.has(method)) return "filesystem-read";
    if (
      WRITE_METHODS.has(method) || TESTING_RUNTIME_WRITE_METHODS.has(method)
    ) {
      return "filesystem-write";
    }
    if (SHARED_CWD_METHODS.has(method)) return "shared-cwd";
    if (
      isProcessEffectMethod(method) ||
      TESTING_RUNTIME_PROCESS_METHODS.has(method)
    ) {
      return "process";
    }
    if (TESTING_RUNTIME_NETWORK_METHODS.has(method)) return "network";
  }
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
  if (isProcessSpecifier(source) && method === "argv") return "process";
  if (isServerSpecifier(source) && SERVER_METHODS.has(method)) return "server";
  if (isServerSpecifier(source) && NETWORK_METHODS.has(method)) {
    return "network";
  }
  if (isDnsSpecifier(source) && DNS_NETWORK_METHODS.has(method)) {
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
    if (
      PROCESS_METHODS.has(method) || method === "env" || method === "args"
    ) return "process";
    if (SERVER_METHODS.has(method)) return "server";
    if (NETWORK_METHODS.has(method)) return "network";
    return undefined;
  }
  if (isProcessEffectMethod(method) || method === "argv") return "process";
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
    return propertyKeyValue(property);
  }
  if (property.type === "Identifier") return property.name as string;
  return property.type === "PrivateName" && isNode(property.id) &&
      property.id.type === "Identifier"
    ? `#${property.id.name as string}`
    : undefined;
}

function staticObjectPropertyName(property: Node): string | undefined {
  if (!isNode(property.key)) return undefined;
  if (property.computed === true) return propertyKeyValue(property.key);
  if (property.key.type === "Identifier") return property.key.name as string;
  return property.key.type === "PrivateName" && isNode(property.key.id) &&
      property.key.id.type === "Identifier"
    ? `#${property.key.id.name as string}`
    : propertyKeyValue(property.key);
}

function propertyKeyValue(value: Node): string | undefined {
  if (value.type === "StringLiteral") return value.value as string;
  if (value.type === "NumericLiteral" || value.type === "BigIntLiteral") {
    return String(value.value);
  }
  return undefined;
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
  if (node.type === "ThisExpression") return [THIS_RUNTIME_ROOT];
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

function literalPropertyName(value: unknown): string | undefined {
  const literal = unwrapExpression(value);
  if (!literal) return undefined;
  if (literal.type === "StringLiteral") return literal.value as string;
  return literal.type === "NumericLiteral" &&
      Number.isFinite(literal.value as number)
    ? String(literal.value)
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
    const key = `${marker.effect}\0${marker.line}\0${marker.symbol}\0${
      marker.filesystemReadLocality ?? ""
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
