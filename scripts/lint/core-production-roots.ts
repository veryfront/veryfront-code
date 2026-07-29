import { builtinModules, isBuiltin } from "node:module";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "#std/path";
import {
  BROWSER_SAFE_EXPORTS,
  BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
} from "../build/browser-safe-exports.mjs";

export type CoreProductionTarget = "browser" | "node" | "deno" | "universal";

export interface ManifestExportClaim {
  manifestPath: string;
  exportName: string;
  path: string;
  targets?: Array<Exclude<CoreProductionTarget, "universal">>;
}

export interface ProductionEntrypoint {
  id: string;
  path: string;
  manifestClaims: ManifestExportClaim[];
}

export interface SourceAssignment {
  pathPrefix: string;
}

export interface CoreProductionContext {
  id: string;
  target: CoreProductionTarget;
  entrypoints: ProductionEntrypoint[];
  assignedSource: SourceAssignment[];
  configPaths: string[];
  manifestPaths: string[];
}

export interface CoreProductionRegistry {
  contexts: CoreProductionContext[];
  manifestClaims: ManifestExportClaim[];
  configs: ReadonlyMap<string, Record<string, unknown>>;
}

export interface ConfigurationDependencyEdge {
  configPath: string;
  field: string;
  specifier: string;
  target: string;
}

export interface ImportMapLayer {
  path: string;
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

export class CoreProductionRegistryError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "CoreProductionRegistryError";
    this.code = code;
    this.path = path;
  }
}

export interface PathContainmentImplementation {
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
  separator: string;
}

const DEFAULT_PATH_CONTAINMENT_IMPLEMENTATION: PathContainmentImplementation = {
  relative,
  isAbsolute,
  separator: SEPARATOR,
};

export function isPathContained(
  root: string,
  candidate: string,
  implementation: PathContainmentImplementation =
    DEFAULT_PATH_CONTAINMENT_IMPLEMENTATION,
): boolean {
  const relativePath = implementation.relative(root, candidate);
  return relativePath === "" ||
    (!implementation.isAbsolute(relativePath) && relativePath !== ".." &&
      !relativePath.startsWith(`..${implementation.separator}`));
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const BROWSER_SAFE_EXPORT_NAMES = new Set<string>(BROWSER_SAFE_EXPORTS);

// Public node: entrypoints available at the package's Node 18.18.0 minimum.
const NODE_18_18_PUBLIC_BUILTINS = new Set(
  [
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "test",
    "test/reporters",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
  ].map((name) => `node:${name}`),
);

const DENO_PUBLIC_NODE_BUILTINS = new Set(
  builtinModules
    .filter((name) => /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_-]*)*$/.test(name))
    .map((name) => `node:${name}`)
    .filter((specifier) => isBuiltin(specifier)),
);

export const CORE_RUNTIME_ENTRYPOINTS = Object.freeze([
  "src/config/declarative-evaluator.ts",
  "src/config/declarative-evaluator-worker-entry.ts",
  "src/config/declarative-evaluator-worker-runner.ts",
  "src/index.client.ts",
  "src/proxy/main.ts",
  "src/react/public.ts",
  "src/security/sandbox/worker-script.ts",
  "src/server/production-server.ts",
]);

const BROWSER_RUNTIME_ENTRYPOINTS = new Set<string>(
  Object.values(BROWSER_SAFE_INTERNAL_ENTRY_POINTS).map(
    normalizeRepositoryPath,
  ),
);

function normalizeRepositoryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function assertCanonicalPathEncoding(
  path: string,
  label: string,
): void {
  let decoded = path;
  for (let depth = 0; depth < 16; depth++) {
    if (/%[0-9a-f]{2}/i.test(decoded)) {
      throw new Error(
        `${label} contains a percent-encoded path component: ${path}`,
      );
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid URL encoding: ${path}`);
    }
    if (next === decoded) return;
    decoded = next;
  }
  throw new Error(`${label} exceeds URL decoding limit: ${path}`);
}

function assertRepositoryPath(path: string, label: string): string {
  const normalized = normalizeRepositoryPath(path);
  if (
    normalized === "" || isAbsolute(path) || path.includes("\\") ||
    normalized === ".." || normalized.startsWith("../") ||
    normalized.split("/").includes("..") ||
    normalized.split("/").includes(".") ||
    normalized.includes("//")
  ) {
    throw new Error(
      `${label} must be a normalized repository-relative path: ${path}`,
    );
  }
  return normalized;
}

export function expandProductionTarget(
  target: CoreProductionTarget,
): Array<Exclude<CoreProductionTarget, "universal">> {
  return target === "universal" ? ["browser", "node", "deno"] : [target];
}

/** Admit only exact node:-prefixed public builtins supported by each target. */
export function isImportableBuiltin(
  specifier: string,
  target: CoreProductionTarget,
): boolean {
  if (!specifier.startsWith("node:")) return false;
  return expandProductionTarget(target).every((expanded) => {
    if (expanded === "browser") return false;
    return (expanded === "node"
      ? NODE_18_18_PUBLIC_BUILTINS
      : DENO_PUBLIC_NODE_BUILTINS).has(
        specifier,
      );
  });
}

function concreteExportTargets(value: unknown): string[] {
  if (typeof value === "string") {
    return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(concreteExportTargets);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(concreteExportTargets);
}

function exportObjectKeys(content: string): string[] {
  const match = /"exports"\s*:\s*\{/.exec(content);
  if (!match) return [];
  let index = match.index + match[0].length;
  let depth = 1;
  const keys: string[] = [];
  while (index < content.length && depth > 0) {
    const character = content[index];
    if (character === '"') {
      const start = index;
      index++;
      while (index < content.length) {
        if (content[index] === "\\") index += 2;
        else if (content[index] === '"') {
          index++;
          break;
        } else index++;
      }
      if (depth === 1) {
        let cursor = index;
        while (/\s/.test(content[cursor] ?? "")) cursor++;
        if (content[cursor] === ":") {
          keys.push(JSON.parse(content.slice(start, index)));
        }
      }
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") depth--;
    index++;
  }
  return keys;
}

async function readManifest(
  root: string,
  manifestPath: string,
  rootRealPath?: string,
): Promise<{ config: Record<string, unknown>; content: string }> {
  let content: string;
  try {
    const stat = await Deno.lstat(join(root, manifestPath));
    if (!stat.isFile || stat.isSymlink) {
      throw new CoreProductionRegistryError(
        "invalid-manifest",
        `invalid manifest: ${manifestPath}: expected a regular non-symlink file`,
        manifestPath,
      );
    }
    if (rootRealPath) {
      const realPath = await Deno.realPath(join(root, manifestPath));
      if (realPath !== join(rootRealPath, manifestPath)) {
        throw new CoreProductionRegistryError(
          "manifest-path-escape",
          `manifest path escapes repository root: ${manifestPath}`,
          manifestPath,
        );
      }
    }
    content = await Deno.readTextFile(join(root, manifestPath));
  } catch (error) {
    if (error instanceof CoreProductionRegistryError) throw error;
    if (error instanceof Deno.errors.NotFound) {
      throw new CoreProductionRegistryError(
        "missing-manifest",
        `missing-manifest: ${manifestPath}`,
        manifestPath,
      );
    }
    throw new CoreProductionRegistryError(
      "manifest-read-failure",
      `manifest-read-failure: ${manifestPath}`,
      manifestPath,
    );
  }
  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("manifest root must be an object");
    }
    config = parsed as Record<string, unknown>;
  } catch (error) {
    throw new CoreProductionRegistryError(
      "manifest-parse-failure",
      `manifest-parse-failure: ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      manifestPath,
    );
  }
  const seen = new Set<string>();
  for (const key of exportObjectKeys(content)) {
    if (seen.has(key)) {
      throw new CoreProductionRegistryError(
        "duplicate-manifest-export",
        `duplicate manifest export key: ${manifestPath}: ${key}`,
        manifestPath,
      );
    }
    seen.add(key);
  }
  return { config, content };
}

type ConcreteTarget = Exclude<CoreProductionTarget, "universal">;

const ALL_CONCRETE_TARGETS: ConcreteTarget[] = ["browser", "node", "deno"];

function targetsForCondition(
  manifestPath: string,
  exportName: string,
  condition: string,
): ConcreteTarget[] {
  if (condition === "browser") return ["browser"];
  if (condition === "node" || condition === "require") return ["node"];
  if (condition === "deno") return ["deno"];
  if (["default", "import", "types"].includes(condition)) {
    return ALL_CONCRETE_TARGETS;
  }
  throw new Error(
    `unknown manifest export condition: ${manifestPath}: ${exportName}: ${condition}`,
  );
}

function validateConditionalExport(
  manifestPath: string,
  exportName: string,
  value: unknown,
): void {
  if (typeof value === "string") {
    try {
      assertCanonicalPathEncoding(
        value,
        `manifest export ${manifestPath}: ${exportName}`,
      );
    } catch {
      throw new Error(
        `manifest export escapes core roots: ${manifestPath}: ${exportName}`,
      );
    }
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(value)) {
      throw new Error(
        `manifest export is not a supported code target: ${manifestPath}: ${exportName}: ${value}`,
      );
    }
    return;
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      validateConditionalExport(manifestPath, exportName, entry);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error(
      `invalid manifest export branch: ${manifestPath}: ${exportName}`,
    );
  }
  for (const [condition, branch] of Object.entries(value)) {
    targetsForCondition(manifestPath, exportName, condition);
    validateConditionalExport(manifestPath, exportName, branch);
  }
}

function selectConditionalExport(
  manifestPath: string,
  exportName: string,
  value: unknown,
  activeConditions: ReadonlySet<string>,
): string[] | undefined {
  if (typeof value === "string") return [value];
  if (value === null) return [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const selected = selectConditionalExport(
        manifestPath,
        exportName,
        entry,
        activeConditions,
      );
      if (selected !== undefined) return selected;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [condition, branch] of Object.entries(value)) {
    if (condition === "types") continue;
    if (activeConditions.has(condition)) {
      const selected = selectConditionalExport(
        manifestPath,
        exportName,
        branch,
        activeConditions,
      );
      if (selected !== undefined) return selected;
    }
  }
  return undefined;
}

function selectConditionalExportsForTarget(
  manifestPath: string,
  exportName: string,
  value: unknown,
  target: ConcreteTarget,
): string[] {
  const conditionSets = target === "node"
    ? [
      new Set(["node", "require", "default"]),
      new Set(["node", "import", "default"]),
    ]
    : target === "deno"
    ? [new Set(["deno", "import", "default"])]
    : [new Set(["browser", "import", "default"])];
  return [
    ...new Set(
      conditionSets.flatMap((conditions) =>
        selectConditionalExport(
          manifestPath,
          exportName,
          value,
          conditions,
        ) ?? []
      ),
    ),
  ];
}

function manifestClaims(
  manifestPath: string,
  manifest: Record<string, unknown>,
): ManifestExportClaim[] {
  const base = dirname(manifestPath);
  const exportsValue = manifest.exports;
  const entries = typeof exportsValue === "string"
    ? [[".", exportsValue] as const]
    : exportsValue && typeof exportsValue === "object" &&
        !Array.isArray(exportsValue)
    ? Object.keys(exportsValue).some((key) => key.startsWith("."))
      ? Object.entries(exportsValue)
      : [[".", exportsValue] as const]
    : [];
  const byKey = new Map<string, ManifestExportClaim>();
  for (const [exportName, value] of entries) {
    validateConditionalExport(manifestPath, exportName, value);
    for (const concreteTarget of ALL_CONCRETE_TARGETS) {
      for (
        const target of selectConditionalExportsForTarget(
          manifestPath,
          exportName,
          value,
          concreteTarget,
        )
      ) {
        if (
          isAbsolute(target) || target.includes("\\") ||
          target.replace(/^\.\//, "").split("/").some((part) =>
            part === "." || part === ".."
          )
        ) {
          throw new Error(
            `manifest export escapes core roots: ${manifestPath}: ${exportName}`,
          );
        }
        const claim: ManifestExportClaim = {
          manifestPath,
          exportName,
          path: assertRepositoryPath(
            normalizeRepositoryPath(join(base, target)),
            `manifest export ${manifestPath}: ${exportName}`,
          ),
          targets: [concreteTarget],
        };
        if (
          manifestPath === "deno.json" &&
            !claim.path.startsWith("src/") && !claim.path.startsWith("cli/") ||
          manifestPath === "cli/deno.json" && !claim.path.startsWith("cli/")
        ) {
          throw new Error(
            `manifest entrypoint escapes core roots: ${claim.path}`,
          );
        }
        const key = claimKey(claim);
        const existing = byKey.get(key);
        if (existing) {
          existing.targets = [
            ...new Set([...(existing.targets ?? []), concreteTarget]),
          ].sort();
        } else byKey.set(key, claim);
      }
    }
  }
  return [...byKey.values()].sort(compareClaims);
}

function compareClaims(
  left: ManifestExportClaim,
  right: ManifestExportClaim,
): number {
  return compareOrdinal(left.manifestPath, right.manifestPath) ||
    compareOrdinal(left.exportName, right.exportName) ||
    compareOrdinal(left.path, right.path);
}

function claimKey(claim: ManifestExportClaim): string {
  return `${claim.manifestPath}\0${claim.exportName}\0${claim.path}`;
}

function claimEntrypoint(claim: ManifestExportClaim): ProductionEntrypoint {
  return {
    id: `manifest:${claim.manifestPath}:${claim.exportName}:${claim.path}`,
    path: claim.path,
    manifestClaims: [claim],
  };
}

function runtimeEntrypoint(path: string): ProductionEntrypoint {
  return { id: `runtime:${path}`, path, manifestClaims: [] };
}

function uniqueEntrypoints(
  entries: ProductionEntrypoint[],
): ProductionEntrypoint[] {
  const byPath = new Map<string, ProductionEntrypoint>();
  for (const entry of entries) {
    const existing = byPath.get(entry.path);
    if (!existing) {
      byPath.set(entry.path, {
        ...entry,
        manifestClaims: [...entry.manifestClaims],
      });
      continue;
    }
    existing.manifestClaims = [
      ...existing.manifestClaims,
      ...entry.manifestClaims,
    ].sort(
      compareClaims,
    );
    existing.id = `entrypoint:${entry.path}`;
  }
  return [...byPath.values()].sort((left, right) =>
    compareOrdinal(left.path, right.path) || compareOrdinal(left.id, right.id)
  );
}

function duplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

export function validateCoreProductionRegistry(
  registry: CoreProductionRegistry,
  eligiblePaths: readonly string[] = [],
): void {
  if (registry.contexts.length === 0) {
    throw new Error("empty core production context registry");
  }
  const knownClaims = new Map(
    registry.manifestClaims.map((claim) => [claimKey(claim), claim]),
  );
  if (knownClaims.size !== registry.manifestClaims.length) {
    throw new Error("duplicate manifest export claim in registry");
  }
  const assignedClaims = new Set<string>();
  const contextIds = new Set<string>();
  for (const context of registry.contexts) {
    if (contextIds.has(context.id)) {
      throw new Error(`duplicate core production context id: ${context.id}`);
    }
    contextIds.add(context.id);
    if (context.entrypoints.length === 0) {
      throw new Error(`empty core production context: ${context.id}`);
    }
    if (context.configPaths.length === 0) {
      throw new Error(`context has no config paths: ${context.id}`);
    }
    if (context.manifestPaths.length === 0) {
      throw new Error(`context has no manifest paths: ${context.id}`);
    }
    for (
      const [label, values] of [
        [
          "entrypoint id",
          context.entrypoints.map((entrypoint) => entrypoint.id),
        ],
        [
          "entrypoint path",
          context.entrypoints.map((entrypoint) => entrypoint.path),
        ],
        ["config path", context.configPaths],
        ["manifest path", context.manifestPaths],
        [
          "source assignment",
          context.assignedSource.map((assignment) => assignment.pathPrefix),
        ],
      ] as const
    ) {
      const repeated = duplicate(values);
      if (repeated) {
        throw new Error(`duplicate ${label}: ${context.id}: ${repeated}`);
      }
    }
    for (const configPath of context.configPaths) {
      assertRepositoryPath(configPath, `config path for ${context.id}`);
      if (!registry.configs.has(configPath)) {
        throw new Error(
          `context config is not loaded: ${context.id}: ${configPath}`,
        );
      }
    }
    for (const manifestPath of context.manifestPaths) {
      assertRepositoryPath(manifestPath, `manifest path for ${context.id}`);
      if (!registry.configs.has(manifestPath)) {
        throw new Error(
          `context manifest is not loaded: ${context.id}: ${manifestPath}`,
        );
      }
    }
    for (const entrypoint of context.entrypoints) {
      assertRepositoryPath(entrypoint.path, `entrypoint for ${context.id}`);
      for (const claim of entrypoint.manifestClaims) {
        const key = claimKey(claim);
        const canonicalClaim = knownClaims.get(key);
        if (!canonicalClaim) {
          throw new Error(
            `stale manifest export claim: ${context.id}: ${claim.manifestPath}: ${claim.exportName}`,
          );
        }
        const canonicalTargets = [
          ...(canonicalClaim.targets ?? ALL_CONCRETE_TARGETS),
        ].sort(
          compareOrdinal,
        );
        const attachedTargets = [...(claim.targets ?? ALL_CONCRETE_TARGETS)]
          .sort(
            compareOrdinal,
          );
        if (
          canonicalTargets.length !== attachedTargets.length ||
          canonicalTargets.some((target, index) =>
            target !== attachedTargets[index]
          )
        ) {
          throw new Error(
            `manifest claim metadata differs from registry: ${context.id}: ${claim.exportName}`,
          );
        }
        if (claim.path !== entrypoint.path) {
          throw new Error(
            `manifest claim path does not match entrypoint: ${context.id}: ${claim.path}: ${entrypoint.path}`,
          );
        }
        const claimTargets = claim.targets ?? ALL_CONCRETE_TARGETS;
        if (
          !expandProductionTarget(context.target).every((target) =>
            claimTargets.includes(target)
          )
        ) {
          throw new Error(
            `manifest claim target is incompatible with context: ${context.id}: ${claim.exportName}`,
          );
        }
        assignedClaims.add(key);
      }
    }
    for (const assignment of context.assignedSource) {
      const prefix = assertRepositoryPath(
        assignment.pathPrefix,
        `source assignment for ${context.id}`,
      );
      if (!prefix.endsWith("/")) {
        throw new Error(
          `source assignment must end in /: ${context.id}: ${prefix}`,
        );
      }
    }
  }
  for (const claim of registry.manifestClaims) {
    if (!assignedClaims.has(claimKey(claim))) {
      throw new Error(
        `unassigned manifest export claim: ${claim.manifestPath}: ${claim.exportName}`,
      );
    }
  }
  for (const rawPath of eligiblePaths) {
    const path = assertRepositoryPath(rawPath, "eligible production file");
    const owned = registry.contexts.some((context) =>
      context.entrypoints.some((entrypoint) => entrypoint.path === path) ||
      context.assignedSource.some((assignment) =>
        path.startsWith(assignment.pathPrefix)
      )
    );
    if (!owned) {
      throw new Error(
        `eligible production file has no context ownership: ${path}`,
      );
    }
  }
}

/** Load authoritative manifest claims plus explicit non-manifest runtime roots. */
export async function loadCoreProductionRegistry(
  root: string,
): Promise<CoreProductionRegistry> {
  const rootRealPath = await Deno.realPath(root);
  const rootRead = await readManifest(root, "deno.json", rootRealPath);
  const cliRead = await readManifest(root, "cli/deno.json", rootRealPath);
  const rootManifestClaims = manifestClaims("deno.json", rootRead.config);
  const cliManifestClaims = manifestClaims("cli/deno.json", cliRead.config);
  if (rootManifestClaims.length === 0) {
    throw new Error(
      "core manifest exposes zero production entrypoints: deno.json",
    );
  }
  if (cliManifestClaims.length === 0) {
    throw new Error(
      "core manifest exposes zero production entrypoints: cli/deno.json",
    );
  }
  const claims = [...rootManifestClaims, ...cliManifestClaims].sort(
    compareClaims,
  );
  const rootClaims = claims.filter((claim) =>
    claim.manifestPath === "deno.json" && claim.exportName !== "./cli"
  );
  const cliClaims = claims.filter((claim) => claim.path.startsWith("cli/"));
  const runtimeEntries = CORE_RUNTIME_ENTRYPOINTS.map(runtimeEntrypoint);
  const rootEntriesFor = (target: ConcreteTarget) =>
    uniqueEntrypoints([
      ...rootClaims.filter((claim) =>
        (claim.targets ?? ALL_CONCRETE_TARGETS).includes(target)
      ).map(
        claimEntrypoint,
      ),
      ...runtimeEntries,
    ]);
  const cliEntriesFor = (target: ConcreteTarget) =>
    uniqueEntrypoints(
      cliClaims.filter((claim) =>
        (claim.targets ?? ALL_CONCRETE_TARGETS).includes(target)
      ).map(
        claimEntrypoint,
      ),
    );
  const browserEntries = uniqueEntrypoints([
    ...rootClaims.filter((claim) =>
      BROWSER_SAFE_EXPORT_NAMES.has(claim.exportName) &&
      (claim.targets ?? ALL_CONCRETE_TARGETS).includes("browser")
    ).map(claimEntrypoint),
    ...runtimeEntries.filter((entrypoint) =>
      BROWSER_RUNTIME_ENTRYPOINTS.has(entrypoint.path)
    ),
  ]);
  const contexts: CoreProductionContext[] = [
    {
      id: "root-node",
      target: "node",
      entrypoints: rootEntriesFor("node"),
      assignedSource: [{ pathPrefix: "src/" }],
      configPaths: ["deno.json"],
      manifestPaths: ["deno.json"],
    },
    {
      id: "root-deno",
      target: "deno",
      entrypoints: rootEntriesFor("deno"),
      assignedSource: [{ pathPrefix: "src/" }],
      configPaths: ["deno.json"],
      manifestPaths: ["deno.json"],
    },
    {
      id: "cli-node",
      target: "node",
      entrypoints: cliEntriesFor("node"),
      assignedSource: [{ pathPrefix: "cli/" }],
      configPaths: ["deno.json", "cli/deno.json"],
      manifestPaths: ["deno.json", "cli/deno.json"],
    },
    {
      id: "cli-deno",
      target: "deno",
      entrypoints: cliEntriesFor("deno"),
      assignedSource: [{ pathPrefix: "cli/" }],
      configPaths: ["deno.json", "cli/deno.json"],
      manifestPaths: ["deno.json", "cli/deno.json"],
    },
    {
      id: "browser-runtime",
      target: "browser",
      entrypoints: browserEntries,
      assignedSource: [],
      configPaths: ["deno.json"],
      manifestPaths: ["deno.json"],
    },
  ];
  const registry: CoreProductionRegistry = {
    contexts,
    manifestClaims: claims,
    configs: new Map([
      ["deno.json", rootRead.config],
      ["cli/deno.json", cliRead.config],
    ]),
  };
  validateCoreProductionRegistry(registry);
  const registeredRoots = new Map<string, string>();
  for (const sourceRoot of ["src", "cli"]) {
    const sourcePath = join(root, sourceRoot);
    let sourceStat: Deno.FileInfo;
    try {
      sourceStat = await Deno.lstat(sourcePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new CoreProductionRegistryError(
          "missing-production-root",
          `missing production root: ${sourceRoot}`,
          sourceRoot,
        );
      }
      throw new CoreProductionRegistryError(
        "production-root-read-failure",
        `production root read failure: ${sourceRoot}`,
        sourceRoot,
      );
    }
    if (!sourceStat.isDirectory || sourceStat.isSymlink) {
      throw new CoreProductionRegistryError(
        "invalid-production-root",
        `registered production root is invalid: ${sourceRoot}`,
        sourceRoot,
      );
    }
    const realPath = await Deno.realPath(sourcePath);
    if (realPath !== join(rootRealPath, sourceRoot)) {
      throw new CoreProductionRegistryError(
        "production-root-escape",
        `registered production root escapes repository: ${sourceRoot}`,
        sourceRoot,
      );
    }
    registeredRoots.set(sourceRoot, realPath);
  }
  for (const context of contexts) {
    for (const entrypoint of context.entrypoints) {
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.lstat(join(root, entrypoint.path));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new CoreProductionRegistryError(
            "missing-production-entrypoint",
            `missing production entrypoint: ${context.id}: ${entrypoint.path}`,
            entrypoint.path,
          );
        }
        throw new CoreProductionRegistryError(
          "production-entrypoint-read-failure",
          `production entrypoint read failure: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
      if (!stat.isFile || stat.isSymlink) {
        throw new CoreProductionRegistryError(
          "invalid-production-entrypoint",
          `invalid production entrypoint: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
      const realPath = await Deno.realPath(join(root, entrypoint.path));
      const sourceRoot = entrypoint.path.split("/")[0];
      const registeredRoot = registeredRoots.get(sourceRoot);
      if (!registeredRoot || !isPathContained(registeredRoot, realPath)) {
        throw new CoreProductionRegistryError(
          "production-entrypoint-escape",
          `production entrypoint escapes registered root: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
    }
  }
  return registry;
}

function addRecordEdges(
  edges: ConfigurationDependencyEdge[],
  configPath: string,
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  for (const [specifier, target] of Object.entries(value)) {
    if (typeof target !== "string") {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: ${field}`,
      );
    }
    edges.push({ configPath, field, specifier, target });
  }
}

function addArrayEdges(
  edges: ConfigurationDependencyEdge[],
  configPath: string,
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) || value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  for (const entry of value) {
    if (typeof entry === "string") {
      edges.push({ configPath, field, specifier: entry, target: entry });
    }
  }
}

function configurationTargets(
  configPath: string,
  field: string,
  value: unknown,
): Array<{ field: string; target: string }> {
  if (typeof value === "string") return [{ field, target: value }];
  if (value === null || value === false) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      configurationTargets(configPath, field, entry)
    );
  }
  if (!value || typeof value !== "object") {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  return Object.entries(value).flatMap(([branch, entry]) =>
    configurationTargets(configPath, `${field}.${branch}`, entry)
  );
}

export function collectConfigurationDependencyEdges(
  configPath: string,
  config: Record<string, unknown>,
): ConfigurationDependencyEdge[] {
  const edges: ConfigurationDependencyEdge[] = [];
  addRecordEdges(edges, configPath, "imports", config.imports);
  if (config.scopes !== undefined) {
    if (
      !config.scopes || typeof config.scopes !== "object" ||
      Array.isArray(config.scopes)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: scopes`,
      );
    }
    for (const [scope, mappings] of Object.entries(config.scopes)) {
      addRecordEdges(edges, configPath, `scopes.${scope}`, mappings);
    }
  }
  if (config.exports !== undefined) {
    if (typeof config.exports === "string") {
      edges.push({
        configPath,
        field: "exports",
        specifier: ".",
        target: config.exports,
      });
    } else {
      if (
        !config.exports || typeof config.exports !== "object" ||
        Array.isArray(config.exports)
      ) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: exports`,
        );
      }
      const exportObject = config.exports as Record<string, unknown>;
      const exportEntries = Object.keys(exportObject).some((key) =>
          key.startsWith(".")
        )
        ? Object.entries(exportObject)
        : [[".", exportObject] as const];
      for (const [specifier, branch] of exportEntries) {
        for (
          const target of configurationTargets(configPath, "exports", branch)
        ) {
          edges.push({
            configPath,
            field: target.field,
            specifier,
            target: target.target,
          });
        }
      }
    }
  }
  for (
    const field of ["dependencies", "peerDependencies", "optionalDependencies"]
  ) {
    addRecordEdges(edges, configPath, field, config[field]);
  }
  for (const field of ["bundledDependencies", "bundleDependencies"]) {
    addArrayEdges(edges, configPath, field, config[field]);
  }
  for (const field of ["main", "module", "types"]) {
    if (typeof config[field] === "string") {
      edges.push({
        configPath,
        field,
        specifier: field,
        target: config[field] as string,
      });
    } else if (config[field] !== undefined) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: ${field}`,
      );
    }
  }
  if (typeof config.bin === "string") {
    edges.push({
      configPath,
      field: "bin",
      specifier: "bin",
      target: config.bin,
    });
  } else if (config.bin !== undefined) {
    addRecordEdges(edges, configPath, "bin", config.bin);
  }
  if (typeof config.browser === "string") {
    edges.push({
      configPath,
      field: "browser",
      specifier: "browser",
      target: config.browser,
    });
  } else if (config.browser !== undefined) {
    if (
      !config.browser || typeof config.browser !== "object" ||
      Array.isArray(config.browser)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: browser`,
      );
    }
    for (const [specifier, target] of Object.entries(config.browser)) {
      if (typeof target === "string") {
        edges.push({ configPath, field: "browser", specifier, target });
      } else if (target !== false) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: browser`,
        );
      }
    }
  }
  addArrayEdges(edges, configPath, "packageRoots", config.packageRoots);
  addArrayEdges(edges, configPath, "workspace", config.workspace);
  if (Array.isArray(config.workspaces)) {
    addArrayEdges(edges, configPath, "workspaces", config.workspaces);
  } else if (config.workspaces !== undefined) {
    if (
      !config.workspaces || typeof config.workspaces !== "object" ||
      Array.isArray(config.workspaces)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: workspaces`,
      );
    }
    const packages = (config.workspaces as Record<string, unknown>).packages;
    addArrayEdges(edges, configPath, "workspaces", packages);
  }
  const compilerOptions = config.compilerOptions;
  if (compilerOptions !== undefined) {
    if (
      !compilerOptions || typeof compilerOptions !== "object" ||
      Array.isArray(compilerOptions)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: compilerOptions`,
      );
    }
    const options = compilerOptions as Record<string, unknown>;
    for (const field of ["jsxImportSource", "jsxImportSourceTypes"]) {
      if (typeof options[field] === "string") {
        const source = options[field] as string;
        edges.push({
          configPath,
          field: `compilerOptions.${field}`,
          specifier: source,
          target: source,
        });
        for (
          const [label, suffix] of [
            ["runtime", "jsx-runtime"],
            ["dev-runtime", "jsx-dev-runtime"],
          ] as const
        ) {
          const generated = `${source.replace(/\/$/, "")}/${suffix}`;
          edges.push({
            configPath,
            field: `compilerOptions.${field}.${label}`,
            specifier: generated,
            target: generated,
          });
        }
      } else if (options[field] !== undefined) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: compilerOptions.${field}`,
        );
      }
    }
    addArrayEdges(edges, configPath, "compilerOptions.types", options.types);
  }
  return edges;
}

interface ImportMapCandidate {
  key: string;
  target: string;
  owner: string;
  scopeLength: number;
}

function mappingCandidates(
  specifier: string,
  mappings: Record<string, string>,
  owner: string,
  configPath: string,
  scopeLength: number,
): ImportMapCandidate[] {
  const candidates: ImportMapCandidate[] = [];
  for (const [key, target] of Object.entries(mappings)) {
    const mappedTarget = target.startsWith("./") || target.startsWith("../")
      ? (() => {
        const normalized = normalizeRepositoryPath(
          join(dirname(configPath), target),
        );
        if (normalized === ".." || normalized.startsWith("../")) {
          throw new Error(
            `import-map target escapes repository root: ${owner}: ${target}`,
          );
        }
        return `./${normalized}`;
      })()
      : target;
    if (key === specifier) {
      candidates.push({ key, target: mappedTarget, owner, scopeLength });
    } else if (key.endsWith("/") && specifier.startsWith(key)) {
      candidates.push({
        key,
        target: `${mappedTarget}${specifier.slice(key.length)}`,
        owner,
        scopeLength,
      });
    }
  }
  return candidates;
}

function candidatesForSpecifier(
  specifier: string,
  layers: ImportMapLayer[],
  importer?: string,
): ImportMapCandidate[] {
  const normalizedImporter = importer
    ? normalizeRepositoryPath(importer)
    : undefined;
  const scoped: ImportMapCandidate[] = [];
  if (normalizedImporter) {
    for (const layer of layers) {
      for (const [scope, mappings] of Object.entries(layer.scopes ?? {})) {
        const normalizedScope = normalizeRepositoryPath(
          scope.startsWith("./") || scope.startsWith("../")
            ? join(dirname(layer.path), scope)
            : scope,
        );
        if (normalizedImporter.startsWith(normalizedScope)) {
          scoped.push(...mappingCandidates(
            specifier,
            mappings,
            `${layer.path}#${scope}`,
            layer.path,
            normalizedScope.length,
          ));
        }
      }
    }
  }
  if (scoped.length > 0) {
    const longestScope = Math.max(
      ...scoped.map((candidate) => candidate.scopeLength),
    );
    return scoped.filter((candidate) => candidate.scopeLength === longestScope);
  }
  return layers.flatMap((layer) =>
    mappingCandidates(specifier, layer.imports ?? {}, layer.path, layer.path, 0)
  );
}

export function resolveImportMapSpecifier(
  specifier: string,
  layers: ImportMapLayer[],
  importer?: string,
): string {
  const chain: string[] = [];
  const mappings = new Set<string>();
  let current = specifier;
  for (let hop = 0; hop < 256; hop++) {
    if (chain.includes(current)) {
      throw new Error(
        `import-map alias cycle: ${[...chain, current].join(" -> ")}`,
      );
    }
    chain.push(current);
    const candidates = candidatesForSpecifier(current, layers, importer);
    if (candidates.length === 0) return current;
    const longest = Math.max(
      ...candidates.map((candidate) => candidate.key.length),
    );
    const best = candidates.filter((candidate) =>
      candidate.key.length === longest
    );
    const targets = [...new Set(best.map((candidate) => candidate.target))];
    if (targets.length !== 1) {
      throw new Error(
        `ambiguous import-map match for ${current}: ${
          best.map((candidate) => candidate.owner).sort().join(", ")
        }`,
      );
    }
    const identities = [
      ...new Set(
        best.map((candidate) => `${candidate.owner}\0${candidate.key}`),
      ),
    ];
    if (identities.length !== 1 || mappings.has(identities[0])) {
      throw new Error(
        `import-map alias cycle: ${[...chain, targets[0]].join(" -> ")}`,
      );
    }
    mappings.add(identities[0]);
    current = targets[0];
  }
  throw new Error(`import-map resolution exceeded 256 hops: ${specifier}`);
}

export function configImportMapLayer(
  configPath: string,
  config: Record<string, unknown>,
): ImportMapLayer {
  return {
    path: configPath,
    imports: config.imports && typeof config.imports === "object" &&
        !Array.isArray(config.imports)
      ? config.imports as Record<string, string>
      : undefined,
    scopes: config.scopes && typeof config.scopes === "object" &&
        !Array.isArray(config.scopes)
      ? config.scopes as Record<string, Record<string, string>>
      : undefined,
  };
}

export function resolveConfigRelativePath(
  repositoryRoot: string,
  configPath: string,
  target: string,
): string {
  assertCanonicalPathEncoding(target, "configuration target");
  const root = resolve(repositoryRoot);
  let absoluteTarget: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
    if (!target.startsWith("file:")) {
      throw new Error(`unsupported configuration target scheme: ${target}`);
    }
    absoluteTarget = resolve(fromFileUrl(target));
    const path = normalizeRepositoryPath(relative(root, absoluteTarget));
    if (path === ".." || path.startsWith("../")) {
      throw new Error(`file URL escapes repository root: ${target}`);
    }
    return path;
  }
  if (isAbsolute(target)) {
    throw new Error(
      `absolute configuration paths are not permitted: ${target}`,
    );
  }
  const normalizedTarget = normalizeRepositoryPath(target);
  absoluteTarget = target.startsWith("./") &&
      (normalizedTarget.startsWith("src/") ||
        normalizedTarget.startsWith("cli/"))
    ? resolve(root, normalizedTarget)
    : resolve(root, dirname(configPath), target);
  const path = normalizeRepositoryPath(relative(root, absoluteTarget));
  if (path === ".." || path.startsWith("../")) {
    throw new Error(`configuration target escapes repository root: ${target}`);
  }
  return path;
}
