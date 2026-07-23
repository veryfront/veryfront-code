import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CACHED_HTTP_MAX_FILES,
  RELEASE_ASSET_CACHED_HTTP_MAX_TOTAL_BYTES,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
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
import { sha256Hex, sha256HexBytes } from "#veryfront/release-assets/hash.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { ensureError } from "#veryfront/errors";

/** Output-relative path for the local release dependency manifest. */
export const LOCAL_RELEASE_ASSET_MANIFEST_PATH = "_veryfront/release-asset-manifest.json";

// Cached dependencies own the largest variable part of this artifact set. The
// fixed React and framework graphs get a separate 256-asset headroom, while
// total retained bytes stay within two publication-concurrency windows.
const LOCAL_RELEASE_ASSET_MAX_FILES = RELEASE_ASSET_CACHED_HTTP_MAX_FILES + 256;
const LOCAL_RELEASE_ASSET_MAX_TOTAL_BYTES = RELEASE_ASSET_CACHED_HTTP_MAX_TOTAL_BYTES * 2;

/** Inputs and injectable transforms for local release dependency publication. */
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
}

function shouldBuildLocalDependencyAssets(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

async function writePreparedAsset(
  adapter: RuntimeAdapter,
  outputDir: string,
  asset: PreparedReleaseAsset,
): Promise<void> {
  const assetPath = join(outputDir, RELEASE_ASSET_BASE_PATH, `${asset.contentHash}.js`);
  await adapter.fs.mkdir(dirname(assetPath), { recursive: true });
  await adapter.fs.writeFile(
    assetPath,
    new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function validateAndIndexAssets(
  assets: readonly PreparedReleaseAsset[],
): Promise<Map<string, PreparedReleaseAsset>> {
  const byHash = new Map<string, PreparedReleaseAsset>();
  let totalBytes = 0;

  for (const asset of assets) {
    if (!(asset.bytes instanceof Uint8Array)) {
      throw new TypeError("Prepared release assets must contain byte content");
    }
    if (!(asset.bytes.buffer instanceof ArrayBuffer)) {
      throw new TypeError("Prepared release assets must use transferable byte content");
    }
    if (
      !Number.isSafeInteger(asset.size) || asset.size < 0 ||
      asset.size !== asset.bytes.byteLength
    ) {
      throw new TypeError("Prepared release asset size does not match its content");
    }
    if (asset.contentType !== RELEASE_ASSET_CONTENT_TYPES.js) {
      throw new TypeError("Local release dependency assets must contain JavaScript");
    }
    if (await sha256HexBytes(asset.bytes as Uint8Array<ArrayBuffer>) !== asset.contentHash) {
      throw new TypeError("Prepared release asset hash does not match its content");
    }

    const existing = byHash.get(asset.contentHash);
    if (existing) {
      if (existing.size !== asset.size || existing.contentType !== asset.contentType) {
        throw new TypeError("Prepared release assets disagree for the same content hash");
      }
      continue;
    }
    if (byHash.size >= LOCAL_RELEASE_ASSET_MAX_FILES) {
      throw new TypeError("Local release dependency asset count exceeds the build limit");
    }
    if (totalBytes > LOCAL_RELEASE_ASSET_MAX_TOTAL_BYTES - asset.size) {
      throw new TypeError("Local release dependency asset bytes exceed the build limit");
    }
    totalBytes += asset.size;
    byHash.set(asset.contentHash, asset);
  }

  return byHash;
}

function assertManifestAssetsPublished(
  manifest: ReleaseAssetManifest,
  assetsByHash: ReadonlyMap<string, PreparedReleaseAsset>,
): void {
  for (const entry of Object.values(manifest.dependencies)) {
    const asset = assetsByHash.get(entry.contentHash);
    if (
      !asset || asset.size !== entry.size || asset.contentType !== entry.contentType
    ) {
      throw new TypeError("Local release manifest references an unpublished dependency asset");
    }
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const errors: Error[] = [];

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await task(items[index]!);
      } catch (error) {
        errors.push(ensureError(error));
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to write local release dependency assets");
  }
}

/** Build, validate, and optionally write immutable local dependency assets. */
export async function generateLocalReleaseAssetManifest(
  options: LocalReleaseAssetOptions,
): Promise<ReleaseAssetManifest | null> {
  if (!shouldBuildLocalDependencyAssets()) return null;

  const tempDir = await options.adapter.fs.makeTempDir("vf-local-release-assets-");
  let result: ReleaseAssetManifest | undefined;
  let generationError: Error | null = null;

  try {
    const reactVersion = await resolveProjectReactVersion({
      projectDir: options.projectDir,
      config: options.config,
    });
    const built = await buildReactImportMapDependencyAssets({
      tempDir,
      reactVersion,
      vendorHttpImports: options.vendorHttpImports,
    });
    const cached = await buildCachedHttpDependencyAssets({
      cacheDir: join(options.projectDir, ".cache", "veryfront-http-bundle"),
      rootDir: options.projectDir,
    });
    let dependencies = { ...cached.dependencies, ...built.dependencies };
    const dependencyUrls = buildReleaseAssetDependencyUrlMap(dependencies);
    const framework = await buildFrameworkDependencyAssets({
      tempDir,
      adapter: options.adapter,
      reactVersion,
      projectId: options.projectId ?? "local",
      transform: options.frameworkTransform,
      dependencyUrls,
    });
    dependencies = { ...dependencies, ...framework.dependencies };
    const assetsByHash = await validateAndIndexAssets([
      ...cached.assets,
      ...built.assets,
      ...framework.assets,
    ]);
    const gaps = [...new Set([...cached.gaps, ...built.gaps, ...framework.gaps])].sort(compareText);
    const dependencyEntries = Object.entries(dependencies).sort(([left], [right]) =>
      compareText(left, right)
    );
    const sourceContentHash = await sha256Hex(
      JSON.stringify([
        reactVersion,
        dependencyEntries.map(([specifier, entry]) => [
          specifier,
          entry.contentHash,
          entry.size,
          entry.contentType,
        ]),
        gaps,
      ]),
    );

    const manifest: ReleaseAssetManifest = {
      schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
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
        dependencyEntries.map(([specifier, entry]) => [specifier, {
          contentHash: entry.contentHash,
          size: entry.size,
          contentType: entry.contentType,
        }]),
      ),
      fallback: { mode: "jit", gaps },
    };
    const validatedManifest = parseReleaseAssetManifest(manifest);
    if (!validatedManifest) {
      throw new TypeError("Generated local release asset manifest is invalid");
    }
    assertManifestAssetsPublished(validatedManifest, assetsByHash);

    if (!options.dryRun) {
      const assets = [...assetsByHash.values()].sort((left, right) =>
        compareText(left.contentHash, right.contentHash)
      );
      await runWithConcurrency(
        assets,
        RELEASE_ASSET_UPLOAD_CONCURRENCY,
        (asset) => writePreparedAsset(options.adapter, options.outputDir, asset),
      );

      const manifestPath = join(options.outputDir, LOCAL_RELEASE_ASSET_MANIFEST_PATH);
      await options.adapter.fs.mkdir(dirname(manifestPath), { recursive: true });
      await options.adapter.fs.writeFile(
        manifestPath,
        JSON.stringify(validatedManifest, null, 2),
      );
    }

    result = validatedManifest;
  } catch (error) {
    generationError = new Error(
      "Failed to generate local release dependency assets",
      { cause: ensureError(error) },
    );
  }

  let cleanupError: Error | null = null;
  try {
    await options.adapter.fs.remove(tempDir, { recursive: true });
  } catch (error) {
    cleanupError = ensureError(error);
  }

  if (generationError && cleanupError) {
    throw new AggregateError(
      [generationError, cleanupError],
      "Release asset generation and temporary-directory cleanup both failed",
    );
  }
  if (generationError) throw generationError;
  if (cleanupError) throw cleanupError;
  if (!result) throw new Error("Release asset generation completed without a manifest");
  return result;
}
