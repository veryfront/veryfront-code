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
  "readFile",
  "readFileSync",
  "readTextFile",
  "readTextFileSync",
  "access",
  "accessSync",
  "exists",
  "existsSync",
  "readDir",
  "readDirSync",
  "readdir",
  "readdirSync",
  "open",
  "openSync",
  "realPath",
  "realPathSync",
  "stat",
  "statSync",
  "lstat",
  "lstatSync",
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
]);

const GLOBAL_RUNTIME_RECEIVERS = new Set(["globalThis", "window", "self"]);

const COMMENT_KEYS = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
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
  readonly filesystemRead: Set<string>;
  readonly filesystemWrite: Set<string>;
  readonly filesystemNamespaces: Set<string>;
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
  const bindings = collectImportBindings(program);
  const markers: SemanticMarker[] = [];

  const visit = (node: Node, scopes: readonly Scope[]): void => {
    const nextScopes = SCOPE_NODES.has(node.type)
      ? [...scopes, createScope(node, bindings, scopes)]
      : scopes;
    const marker = markerForNode(node, bindings, nextScopes);
    if (marker) markers.push(marker);

    for (const key of Object.keys(node)) {
      if (key === "loc" || COMMENT_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, nextScopes);
      } else if (isNode(value)) {
        visit(value, nextScopes);
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
    bindings.importedNames,
  );
  if (globalPropertyMutation) return globalPropertyMutation;

  const processGlobal = processGlobalMarker(
    node,
    line,
    scopes,
    bindings.importedNames,
  );
  if (processGlobal) return processGlobal;

  if (node.type === "MemberExpression") {
    const runtimeMarker = memberRuntimeEffectMarker(node, line, scopes);
    const objectName = memberObjectName(node);
    const effectObject = objectName
      ? resolveLocalBinding(objectName, scopes).binding?.kind ===
        "effect-object"
      : false;
    if (runtimeMarker && (memberProperty(node) === "env" || effectObject)) {
      return runtimeMarker;
    }
  }

  if (node.type === "AssignmentExpression" && isNode(node.left)) {
    const globalMarker = globalFetchMarker(
      node.left,
      line,
      scopes,
      bindings.importedNames,
    );
    if (globalMarker) return globalMarker;
    return memberRuntimeEffectMarker(node.left, line, scopes);
  }

  if (node.type !== "CallExpression" && node.type !== "NewExpression") {
    return undefined;
  }
  const callee = node.callee;
  if (!isNode(callee)) return undefined;

  if (callee.type === "Identifier") {
    const name = callee.name as string;
    const local = resolveLocalBinding(name, scopes);
    if (local.declared) {
      return local.binding?.kind === "effect"
        ? { effect: local.binding.effect, line, symbol: name }
        : undefined;
    }
    if (bindings.filesystemRead.has(name) && !isShadowed(name, scopes)) {
      return { effect: "filesystem-read", line, symbol: name };
    }
    if (bindings.filesystemWrite.has(name) && !isShadowed(name, scopes)) {
      return { effect: "filesystem-write", line, symbol: name };
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
    if (
      node.type === "NewExpression" && name === "Worker" &&
      !isGlobalShadowed("Worker", scopes, bindings.importedNames)
    ) {
      return { effect: "process", line, symbol: "Worker" };
    }
    return undefined;
  }

  if (callee.type !== "MemberExpression") return undefined;
  const method = memberProperty(callee);
  const objectName = memberObjectName(callee);
  if (!method || !objectName) return undefined;

  if (
    node.type === "NewExpression" && method === "Worker" &&
    GLOBAL_RUNTIME_RECEIVERS.has(objectName) &&
    !isGlobalShadowed(objectName, scopes, bindings.importedNames)
  ) {
    return { effect: "process", line, symbol: `${objectName}.Worker` };
  }

  const fetchMarker = globalFetchMarker(
    callee,
    line,
    scopes,
    bindings.importedNames,
  );
  if (fetchMarker) return fetchMarker;

  const runtimeMarker = memberRuntimeEffectMarker(callee, line, scopes);
  if (runtimeMarker) return runtimeMarker;

  if (isPlaywrightFixture(objectName, scopes) && BROWSER_METHODS.has(method)) {
    return { effect: "browser", line, symbol: `${objectName}.${method}` };
  }

  if (resolveLocalBinding(objectName, scopes).declared) return undefined;

  if (
    objectName === "Deno" &&
    !isGlobalShadowed("Deno", scopes, bindings.importedNames)
  ) {
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
    if (method === "chdir") {
      return { effect: "shared-cwd", line, symbol: "Deno.chdir" };
    }
  }

  if (
    bindings.filesystemNamespaces.has(objectName) &&
    !isShadowed(objectName, scopes)
  ) {
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
    !isShadowed(objectName, scopes) &&
    isProcessEffectMethod(method)
  ) {
    return { effect: "process", line, symbol: `${objectName}.${method}` };
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
  return undefined;
}

function memberRuntimeEffectMarker(
  member: Node,
  line: number,
  scopes: readonly Scope[],
): SemanticMarker | undefined {
  if (member.type !== "MemberExpression") return undefined;
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

function globalPropertyMutationMarker(
  node: Node,
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  if (node.type !== "CallExpression" || !isNode(node.callee)) {
    return undefined;
  }
  const callee = memberChain(node.callee);
  if (
    callee?.length !== 2 ||
    !(
      (callee[0] === "Object" && callee[1] === "defineProperty") ||
      (callee[0] === "Reflect" && callee[1] === "deleteProperty")
    ) || isGlobalShadowed(callee[0], scopes, importedNames)
  ) {
    return undefined;
  }
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const target = args[0];
  const property = literalValue(args[1]);
  if (
    !isNode(target) || target.type !== "Identifier" ||
    target.name !== "globalThis" ||
    isGlobalShadowed("globalThis", scopes, importedNames)
  ) {
    return undefined;
  }
  const effect = property === "fetch"
    ? "network"
    : property === "process" || property === "Deno"
    ? "process"
    : undefined;
  return effect
    ? {
      effect,
      line,
      symbol: `${callee.join(".")}(globalThis.${property})`,
    }
    : undefined;
}

function processGlobalMarker(
  node: Node,
  line: number,
  scopes: readonly Scope[],
  importedNames: ReadonlySet<string>,
): SemanticMarker | undefined {
  if (node.type === "MemberExpression") {
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
      chain?.[0] === "globalThis" &&
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
    if (
      chain?.length === 2 && chain[0] === "process" &&
      chain[1] === "chdir" &&
      !isGlobalShadowed("process", scopes, importedNames)
    ) {
      return { effect: "shared-cwd", line, symbol: "process.chdir" };
    }
  }

  if (node.type !== "CallExpression" || !isNode(node.callee)) {
    return undefined;
  }
  const callee = memberChain(node.callee);
  if (
    callee?.length === 2 && callee[0] === "process" &&
    isProcessEffectMethod(callee[1]) &&
    !isGlobalShadowed("process", scopes, importedNames)
  ) {
    return { effect: "process", line, symbol: `process.${callee[1]}` };
  }
  if (
    callee?.[0] === "process" && callee[1] === "chdir" &&
    !isGlobalShadowed("process", scopes, importedNames)
  ) {
    return { effect: "shared-cwd", line, symbol: "process.chdir" };
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
    member.type !== "MemberExpression" || memberProperty(member) !== "fetch"
  ) {
    return undefined;
  }
  const receiver = memberObjectName(member);
  if (
    !receiver || !GLOBAL_RUNTIME_RECEIVERS.has(receiver) ||
    isGlobalShadowed(receiver, scopes, importedNames)
  ) {
    return undefined;
  }
  return { effect: "network", line, symbol: `${receiver}.fetch` };
}

function collectImportBindings(program: Node): ImportBindings {
  const bindings: ImportBindings = {
    filesystemRead: new Set(),
    filesystemWrite: new Set(),
    filesystemNamespaces: new Set(),
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
    if (!isNode(statement) || statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    const source = literalValue(statement.source);
    if (!source) continue;
    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers
      : [];
    for (const specifier of specifiers) {
      if (!isNode(specifier) || !isNode(specifier.local)) continue;
      if (specifier.importKind === "type") continue;
      const local = specifier.local.name as string;
      bindings.importedNames.add(local);
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      ) {
        if (isFilesystemSpecifier(source)) {
          bindings.filesystemNamespaces.add(local);
        }
        if (isProcessSpecifier(source)) bindings.processNamespaces.add(local);
        if (isServerSpecifier(source)) bindings.serverNamespaces.add(local);
        if (isPlaywrightSpecifier(source)) {
          bindings.playwrightNamespaces.add(local);
        }
        continue;
      }
      const importedName =
        isNode(specifier.imported) && specifier.imported.type === "Identifier"
          ? specifier.imported.name as string
          : local;
      if (isFilesystemSpecifier(source)) {
        if (READ_METHODS.has(importedName)) bindings.filesystemRead.add(local);
        if (WRITE_METHODS.has(importedName)) {
          bindings.filesystemWrite.add(local);
        }
      }
      if (isProcessSpecifier(source) && isProcessEffectMethod(importedName)) {
        bindings.process.add(local);
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

function createScope(
  node: Node,
  imports: ImportBindings,
  outerScopes: readonly Scope[],
): Scope {
  const names = new Set<string>();
  const playwrightFixtures = new Set<string>();
  collectLocalDeclaredNames(node, names, playwrightFixtures);
  const scope: Scope = {
    names,
    playwrightFixtures,
    runtimeBindings: new Map(),
  };
  collectLocalRuntimeBindings(node, imports, [...outerScopes, scope]);
  return scope;
}

function collectLocalDeclaredNames(
  node: Node,
  names: Set<string>,
  playwrightFixtures: Set<string>,
): void {
  if (node.type === "Program" || node.type === "BlockStatement") {
    for (const statement of Array.isArray(node.body) ? node.body : []) {
      if (!isNode(statement)) continue;
      if (
        (statement.type === "FunctionDeclaration" ||
          statement.type === "ClassDeclaration") && isNode(statement.id)
      ) {
        names.add(statement.id.name as string);
      }
      if (statement.type === "VariableDeclaration") {
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
    for (const param of Array.isArray(node.params) ? node.params : []) {
      collectPatternNames(param, names);
      collectPlaywrightFixtureNames(param, playwrightFixtures);
    }
    return;
  }
  if (
    node.type === "ForStatement" || node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const declaration = node.type === "ForStatement" ? node.init : node.left;
    if (isNode(declaration) && declaration.type === "VariableDeclaration") {
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
  if (node.type !== "Program" && node.type !== "BlockStatement") return;
  const scope = scopes.at(-1);
  if (!scope) return;

  for (const statement of Array.isArray(node.body) ? node.body : []) {
    if (!isNode(statement) || statement.type !== "VariableDeclaration") {
      continue;
    }
    for (
      const declaration of Array.isArray(statement.declarations)
        ? statement.declarations
        : []
    ) {
      if (!isNode(declaration)) continue;
      bindRuntimeDeclaration(declaration, imports, scopes, scope);
    }
  }
}

function bindRuntimeDeclaration(
  declaration: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
  scope: Scope,
): void {
  const init = unwrapExpression(declaration.init);
  if (!init) return;

  const identifierBinding = identifierRuntimeBinding(init, imports, scopes);
  if (identifierBinding && isNode(declaration.id)) {
    if (identifierBinding.kind === "module") {
      bindPatternToModule(declaration.id, identifierBinding.source, scope);
    } else {
      bindPatternToRuntime(declaration.id, identifierBinding, scope);
    }
    return;
  }

  const globalRuntime = globalRuntimeAliasBinding(init, imports, scopes);
  if (globalRuntime && isNode(declaration.id)) {
    bindPatternToRuntime(declaration.id, globalRuntime, scope);
    return;
  }

  const createRequireBinding = createRequireResultBinding(
    init,
    imports,
    scopes,
  );
  if (createRequireBinding && isNode(declaration.id)) {
    bindPatternToRuntime(declaration.id, createRequireBinding, scope);
    return;
  }

  const moduleSource = runtimeModuleSource(init, imports, scopes);
  if (moduleSource && isNode(declaration.id)) {
    bindPatternToModule(declaration.id, moduleSource, scope);
    return;
  }

  if (init.type === "MemberExpression" && isNode(declaration.id)) {
    const objectName = memberObjectName(init);
    const method = memberProperty(init);
    if (!objectName || !method) return;
    const resolved = resolveLocalBinding(objectName, scopes);
    if (resolved.binding?.kind !== "module") return;
    const effect = effectForModuleMethod(resolved.binding.source, method);
    if (effect) {
      bindPatternToRuntime(
        declaration.id,
        { kind: "effect", effect },
        scope,
      );
    }
  }
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
  if (imports.filesystemRead.has(name)) {
    return { kind: "effect", effect: "filesystem-read" };
  }
  if (imports.filesystemWrite.has(name)) {
    return { kind: "effect", effect: "filesystem-write" };
  }
  if (imports.process.has(name)) return { kind: "effect", effect: "process" };
  if (imports.server.has(name)) return { kind: "effect", effect: "server" };
  if (imports.network.has(name)) return { kind: "effect", effect: "network" };
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
  return undefined;
}

function globalRuntimeAliasBinding(
  init: Node,
  imports: ImportBindings,
  scopes: readonly Scope[],
): RuntimeBinding | undefined {
  if (init.type === "Identifier") {
    const name = init.name as string;
    const resolved = resolveLocalBinding(name, scopes);
    if (resolved.binding?.kind === "global-runtime") return resolved.binding;
    if (
      (name === "Deno" || name === "process") &&
      !isGlobalShadowed(name, scopes, imports.importedNames)
    ) {
      return { kind: "global-runtime", runtime: name };
    }
    return undefined;
  }

  const chain = memberChain(init);
  if (
    chain?.length === 2 && chain[0] === "globalThis" &&
    (chain[1] === "Deno" || chain[1] === "process") &&
    !isGlobalShadowed("globalThis", scopes, imports.importedNames)
  ) {
    return { kind: "global-runtime", runtime: chain[1] };
  }
  return undefined;
}

function bindPatternToRuntime(
  pattern: Node,
  binding: RuntimeBinding,
  scope: Scope,
): void {
  if (pattern.type === "Identifier") {
    scope.runtimeBindings.set(pattern.name as string, binding);
    return;
  }
  if (pattern.type !== "ObjectPattern" || binding.kind !== "global-runtime") {
    return;
  }
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const method = property.key.type === "Identifier"
      ? property.key.name as string
      : property.key.type === "StringLiteral"
      ? property.key.value as string
      : undefined;
    const localName = property.value.type === "Identifier"
      ? property.value.name as string
      : property.value.type === "AssignmentPattern" &&
          isNode(property.value.left) &&
          property.value.left.type === "Identifier"
      ? property.value.left.name as string
      : undefined;
    if (!method || !localName) continue;
    const effect = effectForGlobalRuntimeMethod(binding.runtime, method);
    if (!effect) continue;
    scope.runtimeBindings.set(
      localName,
      method === "env"
        ? { kind: "effect-object", effect }
        : { kind: "effect", effect },
    );
  }
}

function bindPatternToModule(
  pattern: Node,
  source: string,
  scope: Scope,
): void {
  if (pattern.type === "Identifier") {
    scope.runtimeBindings.set(pattern.name as string, {
      kind: "module",
      source,
    });
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  for (
    const property of Array.isArray(pattern.properties)
      ? pattern.properties
      : []
  ) {
    if (
      !isNode(property) || property.type !== "ObjectProperty" ||
      !isNode(property.key) || !isNode(property.value)
    ) continue;
    const importedName = property.key.type === "Identifier"
      ? property.key.name as string
      : property.key.type === "StringLiteral"
      ? property.key.value as string
      : undefined;
    const localName = property.value.type === "Identifier"
      ? property.value.name as string
      : property.value.type === "AssignmentPattern" &&
          isNode(property.value.left) &&
          property.value.left.type === "Identifier"
      ? property.value.left.name as string
      : undefined;
    if (!importedName || !localName) continue;
    const effect = effectForModuleMethod(source, importedName);
    if (effect) {
      scope.runtimeBindings.set(localName, { kind: "effect", effect });
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
  const source = firstStringArgument(init);
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
    source === "#veryfront/compat/fs.ts" ||
    source.endsWith("platform/compat/fs.ts");
}

function isProcessSpecifier(source: string): boolean {
  return source === "node:child_process" || source === "child_process" ||
    source === "node:worker_threads" || source === "worker_threads" ||
    source === "node:process" || source === "process" ||
    source === "#veryfront/compat/process.ts" ||
    source.endsWith("platform/compat/process.ts") ||
    source.endsWith("platform/compat/process.js");
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
    if (READ_METHODS.has(method)) return "filesystem-read";
    if (WRITE_METHODS.has(method)) return "filesystem-write";
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
  if (runtime === "Deno") {
    if (READ_METHODS.has(method)) return "filesystem-read";
    if (WRITE_METHODS.has(method)) return "filesystem-write";
    if (PROCESS_METHODS.has(method) || method === "env") return "process";
    if (SERVER_METHODS.has(method)) return "server";
    if (NETWORK_METHODS.has(method)) return "network";
    if (method === "chdir") return "shared-cwd";
    return undefined;
  }
  if (isProcessEffectMethod(method)) return "process";
  if (method === "chdir") return "shared-cwd";
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
