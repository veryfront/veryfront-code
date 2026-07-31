import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { FileInfo, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_PENDING_BYTES,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
} from "#veryfront/release-assets/constants.ts";
import {
  buildCachedHttpDependencyAssets,
  buildFrameworkDependencyAssets,
  buildReactImportMapDependencyAssets,
  buildReleaseAssetDependencyUrlMap,
  type PreparedReleaseAsset,
  type ReleaseAssetHttpDependencyVendor,
  type ReleaseAssetTransform,
} from "#veryfront/release-assets/build-executor.ts";
import {
  parseReleaseAssetManifest,
  type ReleaseAssetManifest,
} from "#veryfront/release-assets/manifest-schema.ts";
import { computeHashBytes } from "#veryfront/utils/hash-utils.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

export const LOCAL_RELEASE_ASSET_MANIFEST_PATH = "_veryfront/release-asset-manifest.json";
const LOCAL_RELEASE_ASSET_SOURCE_IDENTITY_VERSION = 2;

export interface LocalReleaseAssetOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  outputDir: string;
  dryRun: boolean;
  config?: VeryfrontConfig;
  projectId?: string;
  releaseId?: string;
  vendorHttpImports?: ReleaseAssetHttpDependencyVendor;
  frameworkTransform?: ReleaseAssetTransform;
  /** React version derived from the build-wide dependency snapshot. */
  reactVersion?: string;
  /** Immutable dependency state shared by the production build. */
  dependencyPinningSnapshot?: DependencyPinningSnapshot;
  /** Package source paired with dependencyPinningSnapshot. */
  dependencyPinningSource?: DependencyPinningSourceInput;
}

interface LocalReleaseDependencyContext {
  readonly source: DependencyPinningSourceInput;
  readonly snapshot: DependencyPinningSnapshot;
  readonly reactVersion: string;
}

function shouldBuildLocalDependencyAssets(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Unknown error";
  }
}

type PreparedAssetMetadata = Omit<PreparedReleaseAsset, "bytes">;

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function preparedMetadataEqual(
  left: PreparedAssetMetadata,
  right: PreparedAssetMetadata,
): boolean {
  return left.contentHash === right.contentHash &&
    left.size === right.size &&
    left.contentType === right.contentType;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function mergeDependencyRecords(
  ...records: Array<Record<string, PreparedAssetMetadata>>
): Record<string, PreparedAssetMetadata> {
  const merged: Record<string, PreparedAssetMetadata> = Object.create(null);
  for (const record of records) {
    for (const [specifier, entry] of Object.entries(record)) {
      const existing = Object.hasOwn(merged, specifier) ? merged[specifier] : undefined;
      if (existing && !preparedMetadataEqual(existing, entry)) {
        throw new Error(`Conflicting local release dependency manifest key: ${specifier}`);
      }
      Object.defineProperty(merged, specifier, {
        value: entry,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => compareText(left, right)),
  );
}

function mergeCoverageFailures(...groups: string[][]): readonly string[] {
  const failures = [...new Set(groups.flat())].sort(compareText);
  if (failures.length > RELEASE_ASSET_MANIFEST_LIMITS.coverageFailures) {
    throw new Error(
      `Local release dependency coverage failures exceed ${RELEASE_ASSET_MANIFEST_LIMITS.coverageFailures} entries`,
    );
  }
  return Object.freeze(failures);
}

function assertCompleteLocalReleaseCoverage(failures: readonly string[]): void {
  if (failures.length === 0) return;
  const summary = failures.slice(0, 3).map((failure) => failure.slice(0, 200)).join(", ");
  const remaining = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
  throw new Error(`Local release dependency coverage is incomplete: ${summary}${remaining}`);
}

async function collectVerifiedAssets(
  groups: PreparedReleaseAsset[][],
  dependencies: Record<string, PreparedAssetMetadata>,
): Promise<PreparedReleaseAsset[]> {
  const assetsByHash = new Map<string, PreparedReleaseAsset>();
  let totalBytes = 0;

  for (const asset of groups.flat()) {
    if (
      !(asset.bytes instanceof Uint8Array) ||
      asset.contentType !== RELEASE_ASSET_CONTENT_TYPES.js ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      asset.size > RELEASE_ASSET_MAX_SIZE_BYTES ||
      asset.bytes.byteLength !== asset.size
    ) {
      throw new Error("Local release dependency asset has invalid metadata");
    }

    const existing = assetsByHash.get(asset.contentHash);
    if (existing) {
      if (!preparedMetadataEqual(existing, asset) || !bytesEqual(existing.bytes, asset.bytes)) {
        throw new Error(`Local release dependency asset hash collision: ${asset.contentHash}`);
      }
      continue;
    }

    totalBytes += asset.size;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > RELEASE_ASSET_MAX_PENDING_BYTES
    ) {
      throw new Error(
        `Local release dependency assets exceed ${RELEASE_ASSET_MAX_PENDING_BYTES} bytes`,
      );
    }
    assetsByHash.set(asset.contentHash, asset);
  }

  const uniqueAssets = [...assetsByHash.values()];
  await runBoundedTasks(
    uniqueAssets,
    RELEASE_ASSET_UPLOAD_CONCURRENCY,
    async (asset) => {
      const actualHash = await computeHashBytes(
        asset.bytes as Uint8Array<ArrayBuffer>,
      );
      if (actualHash !== asset.contentHash) {
        throw new Error(`Local release dependency asset hash mismatch: ${asset.contentHash}`);
      }
    },
  );

  const referencedHashes = new Set<string>();
  for (const [specifier, dependency] of Object.entries(dependencies)) {
    const asset = assetsByHash.get(dependency.contentHash);
    if (!asset || !preparedMetadataEqual(asset, dependency)) {
      throw new Error(`Local release dependency has no matching asset: ${specifier}`);
    }
    referencedHashes.add(dependency.contentHash);
  }
  for (const contentHash of assetsByHash.keys()) {
    if (!referencedHashes.has(contentHash)) {
      throw new Error(`Local release dependency asset is unreferenced: ${contentHash}`);
    }
  }

  return uniqueAssets.sort((left, right) => compareText(left.contentHash, right.contentHash));
}

async function computeSourceContentHash(
  reactVersion: string,
  dependencies: Record<string, PreparedAssetMetadata>,
): Promise<string> {
  const identity = {
    version: LOCAL_RELEASE_ASSET_SOURCE_IDENTITY_VERSION,
    reactVersion,
    dependencies: Object.entries(dependencies).map(([specifier, entry]) => ({
      specifier,
      contentHash: entry.contentHash,
      size: entry.size,
      contentType: entry.contentType,
    })),
  };
  return await computeHashBytes(
    new TextEncoder().encode(JSON.stringify(identity)) as Uint8Array<ArrayBuffer>,
  );
}

async function runBoundedTasks<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Local release asset concurrency must be a positive safe integer");
  }

  let nextIndex = 0;
  let stopScheduling = false;
  const failures: Array<{ index: number; error: unknown }> = [];

  async function worker(): Promise<void> {
    while (!stopScheduling) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await task(items[index]!, index);
      } catch (error) {
        failures.push({ index, error });
        stopScheduling = true;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );

  failures.sort((left, right) => left.index - right.index);
  if (failures.length === 1) throw failures[0]!.error;
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `${failures.length} local release asset operations failed`,
    );
  }
}

async function statPath(
  adapter: RuntimeAdapter,
  path: string,
): Promise<FileInfo> {
  const lstat = adapter.fs.lstat?.bind(adapter.fs);
  return lstat ? await lstat(path) : await adapter.fs.stat(path);
}

async function statPathIfPresent(
  adapter: RuntimeAdapter,
  path: string,
): Promise<FileInfo | null> {
  try {
    return await statPath(adapter, path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function planOutputDirectories(
  adapter: RuntimeAdapter,
  directoryPaths: string[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const path of directoryPaths) {
    const info = await statPathIfPresent(adapter, path);
    if (!info) {
      missing.push(path);
      continue;
    }
    if (info.isSymlink || !info.isDirectory || info.isFile) {
      throw new Error(`Local release asset output path is not a safe directory: ${path}`);
    }
  }
  return missing;
}

async function preflightOutputFiles(
  adapter: RuntimeAdapter,
  paths: string[],
): Promise<void> {
  await runBoundedTasks(
    paths,
    RELEASE_ASSET_UPLOAD_CONCURRENCY,
    async (path) => {
      if (await statPathIfPresent(adapter, path)) {
        throw new Error(`Local release asset output already exists: ${path}`);
      }
    },
  );
}

async function rollbackOutput(
  adapter: RuntimeAdapter,
  attemptedFiles: string[],
  createdDirectories: string[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  const uniqueFiles = [...new Set(attemptedFiles)];
  for (const path of uniqueFiles.reverse()) {
    try {
      await adapter.fs.remove(path);
    } catch (error) {
      if (!isNotFoundError(error)) failures.push(error);
    }
  }
  for (const path of [...createdDirectories].reverse()) {
    try {
      await adapter.fs.remove(path);
    } catch (error) {
      if (!isNotFoundError(error)) failures.push(error);
    }
  }
  return failures;
}

async function writeLocalReleaseOutputs(
  adapter: RuntimeAdapter,
  outputDir: string,
  assets: PreparedReleaseAsset[],
  manifest: ReleaseAssetManifest,
): Promise<void> {
  const writeFileBytes = adapter.fs.writeFileBytes?.bind(adapter.fs);
  if (assets.length > 0 && !writeFileBytes) {
    throw new Error("The selected runtime adapter does not support binary release asset output");
  }

  const assetDir = join(outputDir, RELEASE_ASSET_BASE_PATH);
  const manifestPath = join(outputDir, LOCAL_RELEASE_ASSET_MANIFEST_PATH);
  const directoryPaths = [
    outputDir,
    ...(assets.length > 0 ? [dirname(assetDir), assetDir] : []),
    dirname(manifestPath),
  ].filter((path, index, paths) => paths.indexOf(path) === index);
  const destinationPaths = [
    ...assets.map((asset) => join(assetDir, `${asset.contentHash}.js`)),
    manifestPath,
  ];

  const missingDirectories = await planOutputDirectories(adapter, directoryPaths);
  await preflightOutputFiles(adapter, destinationPaths);

  const createdDirectories: string[] = [];
  const attemptedFiles: string[] = [];
  try {
    for (const path of missingDirectories) {
      await adapter.fs.mkdir(path, { recursive: true });
      createdDirectories.push(path);
    }

    await runBoundedTasks(
      assets,
      RELEASE_ASSET_UPLOAD_CONCURRENCY,
      async (asset) => {
        const assetPath = join(assetDir, `${asset.contentHash}.js`);
        attemptedFiles.push(assetPath);
        await writeFileBytes!(assetPath, asset.bytes);
      },
    );

    attemptedFiles.push(manifestPath);
    await adapter.fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    const rollbackFailures = await rollbackOutput(
      adapter,
      attemptedFiles,
      createdDirectories,
    );
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        "Local release asset output failed and rollback was incomplete",
      );
    }
    throw error;
  }
}

async function buildLocalReleaseAssets(
  options: LocalReleaseAssetOptions,
  tempDir: string,
  dependencyContext: LocalReleaseDependencyContext,
): Promise<{ manifest: ReleaseAssetManifest; assets: PreparedReleaseAsset[] }> {
  const vendorHttpImports = options.vendorHttpImports;
  const frameworkTransform = options.frameworkTransform;
  if (typeof vendorHttpImports !== "function" || typeof frameworkTransform !== "function") {
    throw new Error(
      "Local release dependency assets require explicitly composed transform and vendor extensions",
    );
  }
  const {
    source: dependencyPinningSource,
    snapshot: dependencyPinningSnapshot,
    reactVersion,
  } = dependencyContext;
  const built = await buildReactImportMapDependencyAssets({
    tempDir,
    reactVersion,
    vendorHttpImports,
  });
  const cached = await buildCachedHttpDependencyAssets({
    cacheDir: join(options.projectDir, ".cache", "veryfront-http-bundle"),
  });
  let dependencies = mergeDependencyRecords(cached.dependencies, built.dependencies);
  const dependencyUrls = buildReleaseAssetDependencyUrlMap(dependencies);
  const framework = await buildFrameworkDependencyAssets({
    tempDir,
    adapter: options.adapter,
    reactVersion,
    projectId: options.projectId ?? "local",
    transform: frameworkTransform,
    dependencyUrls,
    dependencyPinningSource,
    dependencyPinningSnapshot,
  });
  dependencies = mergeDependencyRecords(dependencies, framework.dependencies);
  const coverageFailures = mergeCoverageFailures(cached.gaps, built.gaps, framework.gaps);
  assertCompleteLocalReleaseCoverage(coverageFailures);
  const assets = await collectVerifiedAssets(
    [cached.assets, built.assets, framework.assets],
    dependencies,
  );
  const sourceContentHash = await computeSourceContentHash(
    reactVersion,
    dependencies,
  );

  // Local production builds currently precompute dependency assets only.
  // Empty project-module and CSS collections are an explicit per-entry miss,
  // so consumers must retain release-scoped JIT URLs for those resources.
  const candidate: ReleaseAssetManifest = {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    dependencyMode: "immutable",
    projectId: options.projectId ?? "local",
    releaseId: options.releaseId ?? "standalone-dev",
    releaseVersion: 0,
    manifestVersion: 1,
    builderVersion: VERSION,
    sourceContentHash,
    createdAt: new Date().toISOString(),
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules: {},
    css: [],
    routes: {},
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([specifier, entry]) => [specifier, {
        contentHash: entry.contentHash,
        size: entry.size,
        contentType: entry.contentType,
      }]),
    ),
  };
  const manifest = parseReleaseAssetManifest(candidate);
  if (!manifest) {
    throw new Error("Local release asset manifest failed internal validation");
  }
  return { manifest, assets };
}

async function resolveLocalReleaseDependencyContext(
  options: LocalReleaseAssetOptions,
): Promise<LocalReleaseDependencyContext> {
  const source = options.dependencyPinningSource ??
    createDependencyPinningSource({
      projectDir: options.projectDir,
      adapter: options.adapter,
      contentSourceId: "local-release-assets",
      config: options.config,
    });
  const suppliedSnapshot = options.dependencyPinningSnapshot;
  const snapshot = suppliedSnapshot
    ? await resolveDependencyPinningSnapshot(
      source,
      suppliedSnapshot.cacheKey,
      suppliedSnapshot.dependencies,
    )
    : await resolveDependencyPinningSnapshot(source);
  const reactVersion = await resolveProjectReactVersion({
    projectDir: options.projectDir,
    config: options.config,
    dependencyPinningSource: source,
    dependencyPinningCacheKey: snapshot.cacheKey,
    dependencyPinningDependencies: snapshot.dependencies,
  });
  if (options.reactVersion !== undefined && options.reactVersion !== reactVersion) {
    throw new Error(
      `Local release React version ${
        JSON.stringify(options.reactVersion)
      } does not match dependency snapshot ${JSON.stringify(reactVersion)}`,
    );
  }
  return Object.freeze({ source, snapshot, reactVersion });
}

export async function generateLocalReleaseAssetManifest(
  options: LocalReleaseAssetOptions,
): Promise<ReleaseAssetManifest | null> {
  if (!shouldBuildLocalDependencyAssets()) return null;

  let dependencyContext: LocalReleaseDependencyContext;
  try {
    dependencyContext = await resolveLocalReleaseDependencyContext(options);
  } catch (error) {
    throw new Error(
      `Failed to generate local release dependency assets: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let tempDir: string;
  try {
    tempDir = await options.adapter.fs.makeTempDir("vf-local-release-assets-");
  } catch (error) {
    throw new Error(
      `Failed to generate local release dependency assets: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let builtResult:
    | { manifest: ReleaseAssetManifest; assets: PreparedReleaseAsset[] }
    | undefined;
  let generationFailure: Error | undefined;
  try {
    builtResult = await buildLocalReleaseAssets(options, tempDir, dependencyContext);
  } catch (error) {
    generationFailure = new Error(
      `Failed to generate local release dependency assets: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let cleanupFailure: Error | undefined;
  try {
    await options.adapter.fs.remove(tempDir, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) {
      cleanupFailure = new Error(
        "Failed to clean up the local release dependency asset temporary directory",
        { cause: error },
      );
    }
  }

  if (generationFailure && cleanupFailure) {
    throw new AggregateError(
      [generationFailure, cleanupFailure],
      "Local release dependency asset generation and cleanup both failed",
    );
  }
  if (generationFailure) throw generationFailure;
  if (cleanupFailure) throw cleanupFailure;
  if (!builtResult) {
    throw new Error("Local release dependency asset generation produced no manifest");
  }

  // Commit output only after the temporary build state is gone. A cleanup
  // failure therefore cannot report generation failure after durable output
  // has already been published and trigger a misleading retry.
  if (!options.dryRun) {
    try {
      await writeLocalReleaseOutputs(
        options.adapter,
        options.outputDir,
        builtResult.assets,
        builtResult.manifest,
      );
    } catch (error) {
      throw new Error(
        `Failed to generate local release dependency assets: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }
  return builtResult.manifest;
}
