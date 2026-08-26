import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
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
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { computeHashBytes } from "#veryfront/utils";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { compareStrings } from "#veryfront/utils/compare.ts";

export const LOCAL_RELEASE_ASSET_MANIFEST_PATH = "_veryfront/release-asset-manifest.json";

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

function shouldBuildLocalDependencyAssets(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writePreparedAsset(
  adapter: RuntimeAdapter,
  outputDir: string,
  asset: PreparedReleaseAsset,
): Promise<void> {
  const assetPath = join(outputDir, RELEASE_ASSET_BASE_PATH, `${asset.contentHash}.js`);
  await adapter.fs.mkdir(dirname(assetPath), { recursive: true });
  await adapter.fs.writeFile(assetPath, new TextDecoder().decode(asset.bytes));
}

export async function generateLocalReleaseAssetManifest(
  options: LocalReleaseAssetOptions,
): Promise<ReleaseAssetManifest | null> {
  if (!shouldBuildLocalDependencyAssets()) return null;
  if (!options.vendorHttpImports || !options.frameworkTransform) {
    throw new Error(
      "Local immutable release assets require explicit HTTP vendoring and framework transform providers",
    );
  }
  const vendorHttpImports = options.vendorHttpImports;
  const frameworkTransform = options.frameworkTransform;

  const tempDir = await options.adapter.fs.makeTempDir("vf-local-release-assets-");

  try {
    try {
      const dependencyPinningSource = options.dependencyPinningSource ??
        createDependencyPinningSource({
          projectDir: options.projectDir,
          adapter: options.adapter,
          contentSourceId: "local-release-assets",
          config: options.config,
        });
      const dependencyPinningSnapshot = options.dependencyPinningSnapshot ??
        await resolveDependencyPinningSnapshot(dependencyPinningSource);
      const reactVersion = options.reactVersion ??
        await resolveProjectReactVersion({
          projectDir: options.projectDir,
          config: options.config,
          dependencyPinningSource,
          dependencyPinningCacheKey: dependencyPinningSnapshot.cacheKey,
          dependencyPinningDependencies: dependencyPinningSnapshot.dependencies,
        });
      const built = await buildReactImportMapDependencyAssets({
        tempDir,
        reactVersion,
        vendorHttpImports,
      });
      const cached = await buildCachedHttpDependencyAssets({
        cacheDir: join(options.projectDir, ".cache", "veryfront-http-bundle"),
      });
      let dependencies = { ...cached.dependencies, ...built.dependencies };
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
      dependencies = { ...dependencies, ...framework.dependencies };
      const assetsByHash = new Map<string, PreparedReleaseAsset>();
      for (const asset of [...cached.assets, ...built.assets, ...framework.assets]) {
        assetsByHash.set(asset.contentHash, asset);
      }
      const gaps = [...cached.gaps, ...built.gaps, ...framework.gaps];
      if (gaps.length > 0) {
        throw new Error(
          `Local release asset coverage is incomplete: ${gaps.slice(0, 20).join(", ")}`,
        );
      }
      const sourceContentHash = await computeHashBytes(
        new TextEncoder().encode(
          [
            options.projectDir,
            reactVersion,
            ...Object.entries(dependencies)
              .map(([specifier, entry]) => `${specifier}:${entry.contentHash}`)
              .sort(compareStrings),
          ].join("\n"),
        ) as Uint8Array<ArrayBuffer>,
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
        dependencyMode: "immutable",
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

      if (options.dryRun) return manifest;

      await Promise.all(
        [...assetsByHash.values()].map((asset) =>
          writePreparedAsset(options.adapter, options.outputDir, asset)
        ),
      );

      const manifestPath = join(options.outputDir, LOCAL_RELEASE_ASSET_MANIFEST_PATH);
      await options.adapter.fs.mkdir(dirname(manifestPath), { recursive: true });
      await options.adapter.fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      return manifest;
    } catch (error) {
      throw new Error(
        `Failed to generate local release dependency assets: ${errorMessage(error)}`,
      );
    }
  } finally {
    await options.adapter.fs.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}
