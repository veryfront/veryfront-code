type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[] | boolean;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  exports?: Record<string, unknown>;
};

import { join } from "#std/path";
import { OPAQUE_DEPENDENCY_VERSIONS } from "../../src/platform/compat/opaque-dependency-versions.ts";
import { isPathContained } from "../lib/path-containment.ts";
import { parseNpmImport } from "./npm-dependency-sources.ts";

const MAX_WORKSPACE_ENTRIES = 1_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_IMPORTS = 4_096;
const MAX_ID_LENGTH = 1_024;
const FIRST_PARTY_EXTENSION_PREFIX = "@veryfront/ext-";
const EXACT_NPM_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_PART_PATTERN = /^[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?$/;

export function resolveNpmBuildVersion(
  configuredVersion: unknown,
  override: string | undefined,
): string {
  const version = override ?? configuredVersion;
  if (typeof version !== "string" || !EXACT_NPM_VERSION_PATTERN.test(version)) {
    throw new TypeError(
      override === undefined
        ? "deno.json version must be an exact semantic version"
        : "VERYFRONT_NPM_VERSION must be an exact semantic version",
    );
  }
  return version;
}

export interface ExtensionManifestSource {
  readonly manifestPath: string;
  readonly manifest: unknown;
}

export interface ExtensionDependencyOwner {
  readonly extensionName: string;
  readonly manifestPath: string;
  readonly version: string;
}

export interface ExtensionDependencyOwnership {
  readonly packages: Readonly<
    Record<string, readonly ExtensionDependencyOwner[]>
  >;
}

export type NpmPackageOwnershipErrorCode =
  | "conflicting-extension-dependency-version"
  | "duplicate-extension-identity"
  | "duplicate-workspace-entry"
  | "empty-extension-inventory"
  | "invalid-extension-manifest"
  | "invalid-generated-package-metadata"
  | "invalid-root-config"
  | "invalid-workspace-entry"
  | "manifest-read-failed"
  | "root-extension-dependency-collision";

export class NpmPackageOwnershipError extends Error {
  readonly code: NpmPackageOwnershipErrorCode;
  readonly location: string;

  constructor(
    code: NpmPackageOwnershipErrorCode,
    location: string,
    reason: string,
  ) {
    super(`Invalid npm dependency ownership at ${location}: ${reason}`);
    this.name = "NpmPackageOwnershipError";
    this.code = code;
    this.location = location;
  }
}

let repositoryOwnership: ExtensionDependencyOwnership | undefined;

export const ROOT_OPTIONAL_RUNTIME_PEERS = [
  "@huggingface/transformers",
  "redis",
] as const;

// Opaque imports are invisible to dnt. Preserve the current package contract
// until the corresponding implementations move fully behind extension package
// boundaries, at which point the ownership gate below can replace this legacy
// normalizer in the npm build.
const ROOT_OPTIONAL_RUNTIME_PEER_FALLBACK_RANGES: Record<string, string> = {
  "@huggingface/transformers": `^${
    OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"]
  }`,
};

export const EXTENSION_OWNED_DEPENDENCIES = [
  "@babel/generator",
  "@babel/parser",
  "@babel/traverse",
  "@babel/types",
  "@types/better-sqlite3",
  "@types/hast",
  "@types/mdast",
  "@types/unist",
  "better-sqlite3",
  "brace-expansion",
  "@kreuzberg/node",
  "@kreuzberg/wasm",
  "@mdx-js/mdx",
  "@mdx-js/react",
  "@opentelemetry/api",
  "@opentelemetry/api-logs",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/context-async-hooks",
  "@opentelemetry/core",
  "@opentelemetry/exporter-logs-otlp-http",
  "@opentelemetry/exporter-metrics-otlp-http",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-logs",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/sdk-node",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/semantic-conventions",
  "@sentry/deno",
  "@sentry/node",
  "ai",
  "bash-tool",
  "brace-expansion",
  "es-module-lexer",
  "jszip",
  "pdf-lib",
  "esbuild",
  "gaxios",
  "gcp-metadata",
  "github-slugger",
  "gaxios",
  "gcp-metadata",
  "jose",
  "just-bash",
  "mdast-util-to-string",
  "protobufjs",
  "rehype-highlight",
  "rehype-raw",
  "rehype-sanitize",
  "rehype-slug",
  "rehype-starry-night",
  "rehype-stringify",
  "remark-frontmatter",
  "remark-gfm",
  "remark-parse",
  "remark-rehype",
  "protobufjs",
  "tailwindcss",
  "unified",
  "unist-util-visit",
  "vfile",
] as const;

const STALE_DEV_DEPENDENCIES = [
  "@types/better-sqlite3",
  "@types/mime-types",
  "@types/ws",
] as const;

const REQUIRED_NPM_OVERRIDES = {
  protobufjs: "8.6.5",
} as const;

export function normalizeNpmPackageMetadata(pkg: PackageJson): PackageJson {
  if (pkg.files) {
    pkg.files = pkg.files.filter((entry) =>
      entry !== "src" && entry !== "/src"
    );
  }

  for (const name of ROOT_OPTIONAL_RUNTIME_PEERS) {
    movePackageToOptionalPeer(pkg, name);
  }

  for (const name of EXTENSION_OWNED_DEPENDENCIES) {
    delete pkg.dependencies?.[name];
    delete pkg.optionalDependencies?.[name];
  }

  for (const name of STALE_DEV_DEPENDENCIES) {
    delete pkg.devDependencies?.[name];
  }

  deleteIfEmpty(pkg, "dependencies");
  deleteIfEmpty(pkg, "optionalDependencies");

  pkg.overrides ??= {};
  for (const [name, version] of Object.entries(REQUIRED_NPM_OVERRIDES)) {
    pkg.overrides[name] = version;
  }

  pinAutomaticDependencyRanges(pkg);

  return pkg;
}

/** Fail if dnt copied any independently published extension implementation into core. */
export async function assertRootArtifactExcludesExtensionImplementations(
  rootEsmDirectory: string,
): Promise<void> {
  const implementationRoot = join(rootEsmDirectory, "extensions");
  let entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(implementationRoot)) {
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  entries = entries.toSorted((left, right) =>
    compareOrdinal(left.name, right.name)
  );
  const implementation = entries.find((entry) => entry.name.startsWith("ext-"));
  if (!implementation) return;

  const path = join(implementationRoot, implementation.name);
  throw ownershipError(
    "root-extension-dependency-collision",
    path,
    `${implementation.name} implementation source was bundled into the root package`,
  );
}

/** Return the validated dependency inventory for this repository checkout. */
export function repositoryExtensionDependencyOwnership(): ExtensionDependencyOwnership {
  repositoryOwnership ??= loadExtensionDependencyOwnership(
    new URL("../../", import.meta.url),
  );
  return repositoryOwnership;
}

/**
 * Load every workspace manifest and derive third-party ownership from the
 * manifests that explicitly declare `veryfront.extension: true`.
 */
export function loadExtensionDependencyOwnership(
  repositoryRoot: URL,
): ExtensionDependencyOwnership {
  if (repositoryRoot.protocol !== "file:") {
    throw ownershipError(
      "invalid-root-config",
      "repositoryRoot",
      "repository root must be a file URL",
    );
  }
  const rootUrl = repositoryRoot.href.endsWith("/")
    ? repositoryRoot
    : new URL(`${repositoryRoot.href}/`);
  let realRoot: string;
  try {
    realRoot = Deno.realPathSync(rootUrl);
  } catch (cause) {
    throw ownershipError(
      "invalid-root-config",
      "repositoryRoot",
      "repository root cannot be resolved",
      cause,
    );
  }

  const rootConfig = snapshotRecord(
    readBoundedJson(new URL("deno.json", rootUrl), "deno.json"),
    "deno.json",
    "invalid-root-config",
  );
  const workspace = snapshotArray(
    rootConfig.workspace,
    "deno.json.workspace",
    MAX_WORKSPACE_ENTRIES,
    "invalid-root-config",
  );
  if (workspace.length === 0) {
    throw ownershipError(
      "empty-extension-inventory",
      "deno.json.workspace",
      "workspace must contain first-party extension manifests",
    );
  }

  const workspaceEntries: string[] = [];
  const portableEntries = new Set<string>();
  for (let index = 0; index < workspace.length; index += 1) {
    const location = `deno.json.workspace[${index}]`;
    const entry = canonicalString(
      workspace[index],
      location,
      "invalid-workspace-entry",
    );
    validateWorkspaceEntry(entry, location);
    const portableEntry = entry.toLowerCase();
    if (portableEntries.has(portableEntry)) {
      throw ownershipError(
        "duplicate-workspace-entry",
        location,
        `workspace entry collides with another entry: ${entry}`,
      );
    }
    portableEntries.add(portableEntry);
    workspaceEntries.push(entry);
  }
  workspaceEntries.sort(compareOrdinal);

  const sources: ExtensionManifestSource[] = [];
  for (const entry of workspaceEntries) {
    const relativeDirectory = entry.slice(2);
    const manifestUrl = new URL(`${relativeDirectory}/deno.json`, rootUrl);
    let realManifestPath: string;
    try {
      realManifestPath = Deno.realPathSync(manifestUrl);
    } catch (cause) {
      throw ownershipError(
        "manifest-read-failed",
        `${entry}/deno.json`,
        "workspace manifest cannot be resolved",
        cause,
      );
    }
    if (!isPathContained(realRoot, realManifestPath)) {
      throw ownershipError(
        "invalid-workspace-entry",
        entry,
        "workspace manifest escapes the repository root",
      );
    }

    const manifestPath = `${relativeDirectory}/deno.json`;
    sources.push({
      manifestPath,
      manifest: readBoundedJson(manifestUrl, manifestPath),
    });
  }
  return deriveExtensionDependencyOwnership(sources);
}

/** Build a canonical immutable ownership index from parsed workspace manifests. */
export function deriveExtensionDependencyOwnership(
  sources: readonly ExtensionManifestSource[],
): ExtensionDependencyOwnership {
  const sourceValues = snapshotArray(
    sources,
    "workspace manifests",
    MAX_WORKSPACE_ENTRIES,
    "invalid-extension-manifest",
  );
  const sortedSources = sourceValues.map((value, index) => {
    const source = snapshotRecord(
      value,
      `workspace manifests[${index}]`,
      "invalid-extension-manifest",
    );
    const manifestPath = canonicalString(
      source.manifestPath,
      `workspace manifests[${index}].manifestPath`,
      "invalid-extension-manifest",
    );
    validateManifestPath(
      manifestPath,
      `workspace manifests[${index}].manifestPath`,
    );
    return { manifestPath, manifest: source.manifest };
  }).sort((left, right) =>
    compareOrdinal(left.manifestPath, right.manifestPath)
  );

  const portableManifestPaths = new Set<string>();
  const extensionNames = new Map<string, string>();
  const owners = new Map<string, ExtensionDependencyOwner[]>();
  let extensionCount = 0;

  for (const source of sortedSources) {
    const portableManifestPath = source.manifestPath.toLowerCase();
    if (portableManifestPaths.has(portableManifestPath)) {
      throw ownershipError(
        "duplicate-workspace-entry",
        source.manifestPath,
        "manifest path collides with another workspace entry",
      );
    }
    portableManifestPaths.add(portableManifestPath);

    const manifest = snapshotRecord(
      source.manifest,
      source.manifestPath,
      "invalid-extension-manifest",
    );
    const veryfrontValue = manifest.veryfront;
    if (veryfrontValue === undefined) continue;
    const veryfront = snapshotRecord(
      veryfrontValue,
      `${source.manifestPath}.veryfront`,
      "invalid-extension-manifest",
    );
    const extensionFlag = veryfront.extension;
    if (extensionFlag !== undefined && typeof extensionFlag !== "boolean") {
      throw ownershipError(
        "invalid-extension-manifest",
        `${source.manifestPath}.veryfront.extension`,
        "extension flag must be a boolean",
      );
    }
    if (extensionFlag !== true) continue;
    const activation = veryfront.activation;
    if (
      activation !== undefined && activation !== "auto" &&
      activation !== "explicit"
    ) {
      throw ownershipError(
        "invalid-extension-manifest",
        `${source.manifestPath}.veryfront.activation`,
        'activation must be either "auto" or "explicit"',
      );
    }
    let runtimeDependencies: ReadonlySet<string> | undefined;
    const npmValue = veryfront.npm;
    if (npmValue !== undefined) {
      const npm = snapshotRecord(
        npmValue,
        `${source.manifestPath}.veryfront.npm`,
        "invalid-extension-manifest",
      );
      if (npm.runtimeDependencies !== undefined) {
        const selected = snapshotArray(
          npm.runtimeDependencies,
          `${source.manifestPath}.veryfront.npm.runtimeDependencies`,
          MAX_MANIFEST_IMPORTS,
          "invalid-extension-manifest",
        );
        const selectedNames = new Set<string>();
        for (let index = 0; index < selected.length; index += 1) {
          const location =
            `${source.manifestPath}.veryfront.npm.runtimeDependencies[${index}]`;
          const dependencyName = packageName(
            selected[index],
            location,
            "invalid-extension-manifest",
          );
          if (selectedNames.has(dependencyName)) {
            throw ownershipError(
              "invalid-extension-manifest",
              location,
              `runtime dependency ${dependencyName} is listed more than once`,
            );
          }
          selectedNames.add(dependencyName);
        }
        runtimeDependencies = selectedNames;
      }
    }
    extensionCount += 1;

    const extensionName = packageName(
      manifest.name,
      `${source.manifestPath}.name`,
      "invalid-extension-manifest",
    );
    if (!extensionName.startsWith(FIRST_PARTY_EXTENSION_PREFIX)) {
      throw ownershipError(
        "invalid-extension-manifest",
        `${source.manifestPath}.name`,
        `first-party extension names must start with ${FIRST_PARTY_EXTENSION_PREFIX}`,
      );
    }
    const extensionVersion = canonicalString(
      manifest.version,
      `${source.manifestPath}.version`,
      "invalid-extension-manifest",
    );
    if (!EXACT_NPM_VERSION_PATTERN.test(extensionVersion)) {
      throw ownershipError(
        "invalid-extension-manifest",
        `${source.manifestPath}.version`,
        "extension version must be an exact semantic version",
      );
    }
    validateManifestExports(manifest.exports, source.manifestPath);
    const previousManifest = extensionNames.get(extensionName);
    if (previousManifest !== undefined) {
      throw ownershipError(
        "duplicate-extension-identity",
        `${source.manifestPath}.name`,
        `extension identity ${extensionName} is already declared by ${previousManifest}`,
      );
    }
    extensionNames.set(extensionName, source.manifestPath);

    const imports = manifest.imports === undefined
      ? Object.freeze(Object.create(null) as Record<string, unknown>)
      : snapshotRecord(
        manifest.imports,
        `${source.manifestPath}.imports`,
        "invalid-extension-manifest",
        MAX_MANIFEST_IMPORTS,
      );
    const manifestDependencies = new Map<string, string>();
    for (const specifier of Object.keys(imports).sort(compareOrdinal)) {
      const location = `${source.manifestPath}.imports[${
        JSON.stringify(specifier)
      }]`;
      canonicalString(specifier, location, "invalid-extension-manifest");
      const target = canonicalString(
        imports[specifier],
        location,
        "invalid-extension-manifest",
      );
      const parsed = parseNpmImport(target);
      const npmLike = target.startsWith("npm:") ||
        target.startsWith("https://esm.sh/");
      if (parsed === null) {
        if (npmLike) {
          throw ownershipError(
            "invalid-extension-manifest",
            location,
            "npm dependency import must include a concrete package and exact version",
          );
        }
        continue;
      }
      const dependencyName = packageName(
        parsed.name,
        location,
        "invalid-extension-manifest",
      );
      if (!EXACT_NPM_VERSION_PATTERN.test(parsed.version)) {
        throw ownershipError(
          "invalid-extension-manifest",
          location,
          `dependency ${dependencyName} must use an exact semantic version`,
        );
      }
      const previousVersion = manifestDependencies.get(dependencyName);
      if (previousVersion !== undefined && previousVersion !== parsed.version) {
        throw ownershipError(
          "conflicting-extension-dependency-version",
          location,
          `${dependencyName} is declared as both ${previousVersion} and ${parsed.version} in ${extensionName}`,
        );
      }
      manifestDependencies.set(dependencyName, parsed.version);
    }

    if (runtimeDependencies !== undefined) {
      for (const dependencyName of runtimeDependencies) {
        if (manifestDependencies.has(dependencyName)) continue;
        throw ownershipError(
          "invalid-extension-manifest",
          `${source.manifestPath}.veryfront.npm.runtimeDependencies`,
          `runtime dependency ${dependencyName} is not backed by an exact npm import`,
        );
      }
    }

    for (
      const [dependencyName, version] of [...manifestDependencies].sort((
        [left],
        [right],
      ) => compareOrdinal(left, right))
    ) {
      if (
        runtimeDependencies !== undefined &&
        !runtimeDependencies.has(dependencyName)
      ) continue;
      const packageOwners = owners.get(dependencyName) ?? [];
      packageOwners.push(Object.freeze({
        extensionName,
        manifestPath: source.manifestPath,
        version,
      }));
      owners.set(dependencyName, packageOwners);
    }
  }

  if (extensionCount === 0) {
    throw ownershipError(
      "empty-extension-inventory",
      "workspace manifests",
      "no first-party extension manifests were found",
    );
  }

  const packages = Object.create(null) as Record<
    string,
    readonly ExtensionDependencyOwner[]
  >;
  for (const dependencyName of [...owners.keys()].sort(compareOrdinal)) {
    const packageOwners = owners.get(dependencyName)!;
    packageOwners.sort((left, right) =>
      compareOrdinal(left.extensionName, right.extensionName) ||
      compareOrdinal(left.manifestPath, right.manifestPath)
    );
    Object.defineProperty(packages, dependencyName, {
      value: Object.freeze(packageOwners),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze({ packages: Object.freeze(packages) });
}

export function assertNoRootExtensionDependencyCollision(
  pkg: PackageJson,
  ownership: ExtensionDependencyOwnership,
): void {
  const sections = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "devDependencies",
    "overrides",
  ] as const;
  for (const section of sections) {
    const value = pkg[section];
    if (value === undefined) continue;
    const entries = snapshotRecord(
      value,
      `package.json.${section}`,
      "invalid-generated-package-metadata",
    );
    for (const dependencyName of Object.keys(entries).sort(compareOrdinal)) {
      const location = `package.json.${section}[${
        JSON.stringify(dependencyName)
      }]`;
      const rawValue = entries[dependencyName];
      if (
        section === "dependencies" || section === "optionalDependencies" ||
        section === "peerDependencies" || section === "devDependencies" ||
        section === "overrides"
      ) {
        canonicalString(
          rawValue,
          location,
          "invalid-generated-package-metadata",
        );
      }

      const declaredName = section === "overrides"
        ? overridePackageName(dependencyName, location)
        : packageName(
          dependencyName,
          location,
          "invalid-generated-package-metadata",
        );
      const candidateNames = [declaredName];
      if (typeof rawValue === "string") {
        const alias = parseNpmImport(rawValue);
        if (alias !== null && alias.name !== dependencyName) {
          candidateNames.push(alias.name);
        }
      }
      for (const candidateName of candidateNames) {
        const packageOwners = ownership.packages[candidateName];
        if (packageOwners === undefined) continue;
        const aliasDetail = candidateName !== declaredName
          ? ` (declared through npm alias ${dependencyName})`
          : declaredName !== dependencyName
          ? ` (declared by override selector ${dependencyName})`
          : "";
        throw ownershipError(
          "root-extension-dependency-collision",
          location,
          `${candidateName}${aliasDetail} is owned by extension manifest(s): ${
            packageOwners.map((owner) => owner.manifestPath).join(", ")
          }`,
        );
      }
    }
  }
}

function overridePackageName(key: string, location: string): string {
  const versionSeparator = key.startsWith("@")
    ? key.indexOf("@", key.indexOf("/") + 1)
    : key.indexOf("@");
  const name = versionSeparator < 0 ? key : key.slice(0, versionSeparator);
  return packageName(
    name,
    location,
    "invalid-generated-package-metadata",
  );
}

function readBoundedJson(url: URL, location: string): unknown {
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(url);
  } catch (cause) {
    throw ownershipError(
      "manifest-read-failed",
      location,
      "manifest cannot be read",
      cause,
    );
  }
  if (!stat.isFile) {
    throw ownershipError(
      "manifest-read-failed",
      location,
      "manifest path is not a regular file",
    );
  }
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw ownershipError(
      "manifest-read-failed",
      location,
      `manifest exceeds ${MAX_MANIFEST_BYTES} bytes`,
    );
  }

  let text: string;
  try {
    text = Deno.readTextFileSync(url);
  } catch (cause) {
    throw ownershipError(
      "manifest-read-failed",
      location,
      "manifest cannot be read",
      cause,
    );
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      "manifest is not valid JSON",
      cause,
    );
  }
}

function snapshotRecord(
  value: unknown,
  location: string,
  code: NpmPackageOwnershipErrorCode,
  maxKeys = MAX_MANIFEST_IMPORTS,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw ownershipError(code, location, "expected a plain record");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw ownershipError(code, location, "record inspection failed", cause);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw ownershipError(
      code,
      location,
      "record must have a plain or null prototype",
    );
  }
  if (keys.length > maxKeys) {
    throw ownershipError(
      code,
      location,
      `record exceeds ${maxKeys} properties`,
    );
  }

  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") {
      throw ownershipError(code, location, "symbol properties are not allowed");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      throw ownershipError(
        code,
        `${location}.${key}`,
        "property inspection failed",
        cause,
      );
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw ownershipError(
        code,
        `${location}.${key}`,
        "properties must be enumerable data properties",
      );
    }
    Object.defineProperty(output, key, {
      value: descriptor.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(output);
}

function snapshotArray(
  value: unknown,
  location: string,
  maxLength: number,
  code: NpmPackageOwnershipErrorCode,
): readonly unknown[] {
  let isArray: boolean;
  let prototype: object | null;
  let length: number;
  let keys: PropertyKey[];
  let array: unknown[] | undefined;
  try {
    isArray = Array.isArray(value);
    array = isArray ? value as unknown[] : undefined;
    prototype = array === undefined ? null : Object.getPrototypeOf(array);
    length = array?.length ?? 0;
    keys = array === undefined ? [] : Reflect.ownKeys(array);
  } catch (cause) {
    throw ownershipError(code, location, "array inspection failed", cause);
  }
  if (!isArray || array === undefined || prototype !== Array.prototype) {
    throw ownershipError(code, location, "expected a plain array");
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) {
    throw ownershipError(code, location, `array exceeds ${maxLength} entries`);
  }
  if (keys.length !== length + 1) {
    throw ownershipError(
      code,
      location,
      "array must be dense and have no extra properties",
    );
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, `${index}`);
    } catch (cause) {
      throw ownershipError(
        code,
        `${location}[${index}]`,
        "array entry inspection failed",
        cause,
      );
    }
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw ownershipError(
        code,
        `${location}[${index}]`,
        "array entries must be enumerable data properties",
      );
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function canonicalString(
  value: unknown,
  location: string,
  code: NpmPackageOwnershipErrorCode,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw ownershipError(code, location, "expected a bounded canonical string");
  }
  return value;
}

function packageName(
  value: unknown,
  location: string,
  code: NpmPackageOwnershipErrorCode,
): string {
  const name = canonicalString(value, location, code);
  const parts = name.startsWith("@")
    ? name.slice(1).split("/")
    : name.split("/");
  if (
    (name.startsWith("@") && parts.length !== 2) ||
    (!name.startsWith("@") && parts.length !== 1) ||
    parts.some((part) => !PACKAGE_PART_PATTERN.test(part))
  ) {
    throw ownershipError(code, location, `invalid package name: ${name}`);
  }
  return name;
}

function validateWorkspaceEntry(entry: string, location: string): void {
  if (
    !entry.startsWith("./") || entry.includes("\\") ||
    /[%?#]/.test(entry)
  ) {
    throw ownershipError(
      "invalid-workspace-entry",
      location,
      "workspace entries must be canonical relative POSIX paths",
    );
  }
  const segments = entry.slice(2).split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw ownershipError(
      "invalid-workspace-entry",
      location,
      "workspace entries cannot contain empty or dot segments",
    );
  }
}

function validateManifestPath(path: string, location: string): void {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /[%?#]/.test(path) ||
    !path.endsWith("/deno.json")
  ) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      "manifest path must be a canonical repository-relative deno.json path",
    );
  }
  const segments = path.split("/");
  if (
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      "manifest path cannot contain empty or dot segments",
    );
  }
}

function validateManifestExports(value: unknown, manifestPath: string): void {
  const location = `${manifestPath}.exports`;
  if (typeof value === "string") {
    validateManifestExportTarget(value, location);
    return;
  }
  const exports = snapshotRecord(
    value,
    location,
    "invalid-extension-manifest",
  );
  if (!Object.hasOwn(exports, ".")) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      'extension exports map must contain "."',
    );
  }
  for (const [key, target] of Object.entries(exports)) {
    canonicalString(key, `${location}.${key}`, "invalid-extension-manifest");
    validateManifestExportTarget(target, `${location}.${key}`);
  }
}

function validateManifestExportTarget(value: unknown, location: string): void {
  const target = canonicalString(
    value,
    location,
    "invalid-extension-manifest",
  );
  if (
    !target.startsWith("./") || target.length === 2 || target.includes("\\")
  ) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      "extension export targets must be canonical relative paths",
    );
  }
  const segments = target.slice(2).split("/");
  if (
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      segment.toLowerCase() === "node_modules"
    )
  ) {
    throw ownershipError(
      "invalid-extension-manifest",
      location,
      "extension export targets cannot contain empty, dot, or node_modules segments",
    );
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownershipError(
  code: NpmPackageOwnershipErrorCode,
  location: string,
  reason: string,
  cause?: unknown,
): NpmPackageOwnershipError {
  const error = new NpmPackageOwnershipError(code, location, reason);
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return error;
}

export function removeInternalNpmEntryPointExports(
  pkg: Pick<PackageJson, "exports">,
  internalEntryPoints: readonly string[],
): void {
  if (!pkg.exports) {
    throw new Error(
      "Generated npm package metadata is missing its exports map",
    );
  }

  for (const entryPoint of internalEntryPoints) {
    if (!Object.hasOwn(pkg.exports, entryPoint)) {
      throw new Error(
        `Generated npm package metadata is missing internal entry point ${entryPoint}`,
      );
    }
    delete pkg.exports[entryPoint];
  }
}

function pinAutomaticDependencyRanges(pkg: PackageJson): void {
  for (
    const key of [
      "dependencies",
      "optionalDependencies",
      "devDependencies",
    ] as const
  ) {
    const dependencies = pkg[key];
    if (!dependencies) continue;

    for (const [name, range] of Object.entries(dependencies)) {
      dependencies[name] = stripLeadingRangeOperator(range);
    }
  }
}

function stripLeadingRangeOperator(range: string): string {
  return range.replace(/^[\^~]/, "");
}

function movePackageToOptionalPeer(pkg: PackageJson, name: string): void {
  const range = pkg.dependencies?.[name] ?? pkg.optionalDependencies?.[name] ??
    ROOT_OPTIONAL_RUNTIME_PEER_FALLBACK_RANGES[name];
  if (!range) return;

  delete pkg.dependencies?.[name];
  delete pkg.optionalDependencies?.[name];

  pkg.peerDependencies ??= {};
  pkg.peerDependencies[name] = range;

  pkg.peerDependenciesMeta ??= {};
  pkg.peerDependenciesMeta[name] = { optional: true };
}

function deleteIfEmpty(
  pkg: PackageJson,
  key: "dependencies" | "optionalDependencies",
): void {
  if (pkg[key] && Object.keys(pkg[key]).length === 0) {
    delete pkg[key];
  }
}
