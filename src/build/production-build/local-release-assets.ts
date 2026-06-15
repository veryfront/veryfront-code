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
  buildReactImportMapDependencyAssets,
  type PreparedReleaseAsset,
  type ReleaseAssetHttpDependencyVendor,
} from "#veryfront/release-assets/build-executor.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { sha256HexBytes } from "#veryfront/release-assets/hash.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { VERSION } from "#veryfront/utils/version.ts";

export const LOCAL_RELEASE_ASSET_MANIFEST_PATH = "_veryfront/release-asset-manifest.json";

export interface LocalReleaseAssetOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  outputDir: string;
  dryRun: boolean;
  projectId?: string;
  releaseId?: string;
  vendorHttpImports?: ReleaseAssetHttpDependencyVendor;
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

  const tempDir = await options.adapter.fs.makeTempDir("vf-local-release-assets-");

  try {
    try {
      const reactVersion = await resolveProjectReactVersion({ projectDir: options.projectDir });
      const built = await buildReactImportMapDependencyAssets({
        tempDir,
        reactVersion,
        vendorHttpImports: options.vendorHttpImports,
      });
      const cached = await buildCachedHttpDependencyAssets({
        cacheDir: join(options.projectDir, ".cache", "veryfront-http-bundle"),
      });
      const dependencies = { ...cached.dependencies, ...built.dependencies };
      const assetsByHash = new Map<string, PreparedReleaseAsset>();
      for (const asset of [...cached.assets, ...built.assets]) {
        assetsByHash.set(asset.contentHash, asset);
      }
      const gaps = [...cached.gaps, ...built.gaps];
      const sourceContentHash = await sha256HexBytes(
        new TextEncoder().encode(
          [
            options.projectDir,
            reactVersion,
            ...Object.entries(dependencies)
              .map(([specifier, entry]) => `${specifier}:${entry.contentHash}`)
              .sort(),
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
        fallback: { mode: "jit", gaps },
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
