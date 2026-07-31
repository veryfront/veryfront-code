import { dirname, join, toFileUrl } from "#veryfront/compat/path/index.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import { normalizeModulePath, resolveProjectRelativePath } from "./path-resolver.ts";
import type { LoadComponentOptions } from "./types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createSSRImportMapIdentity, SSRModuleLoader } from "./ssr-module-loader/index.ts";
import { extractComponent } from "./extract-component.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { resolveDependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { snapshotLoadComponentOptions } from "./load-options-snapshot.ts";

const outputQueues = new Map<string, Promise<void>>();

async function serializeModuleOutput<T>(
  outputPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = outputQueues.get(outputPath) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  outputQueues.set(outputPath, settled);

  try {
    return await result;
  } finally {
    if (outputQueues.get(outputPath) === settled) {
      outputQueues.delete(outputPath);
    }
  }
}

export async function loadModuleFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<Record<string, unknown>> {
  const optionSnapshot = snapshotLoadComponentOptions(options);
  const fileName = filePath.split("/").pop() ?? filePath;
  const projectId = optionSnapshot?.projectId ?? projectDir;
  const dev = optionSnapshot?.dev ?? true;
  const ssr = optionSnapshot?.ssr ?? true;

  return await withSpan(
    "modules.react.loadComponentFromSource",
    async () => {
      const relativeOutputPath = ssr ? undefined : resolveProjectRelativePath(filePath, projectDir);
      if (!ssr && !relativeOutputPath) {
        throw new TypeError(
          "Component file path must identify a file beneath the project root",
        );
      }
      const dependencyPinningSource = optionSnapshot?.dependencyPinningSource ?? projectDir;
      const dependencySnapshot = await resolveDependencyPinningSnapshot(
        dependencyPinningSource,
        optionSnapshot?.dependencyPinningCacheKey,
        optionSnapshot?.dependencyPinningDependencies,
      );
      const moduleServerOrigin = dependencySnapshot.cacheKey.startsWith("on:")
        ? optionSnapshot?.moduleServerOrigin
        : undefined;

      if (ssr) {
        const importMapIdentity = await createSSRImportMapIdentity(
          optionSnapshot?.importMap ?? await loadImportMap(projectDir, adapter),
        );
        const loader = new SSRModuleLoader({
          projectDir,
          projectId,
          projectSlug: optionSnapshot?.projectSlug,
          adapter,
          dev,
          contentSourceId: optionSnapshot?.contentSourceId,
          reactVersion: optionSnapshot?.reactVersion,
          moduleServerOrigin,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource,
          mode: optionSnapshot?.mode,
          importMapIdentity,
        });

        return await loader.loadRawModule(filePath, source);
      }

      const explicitImportMap = optionSnapshot?.importMap;
      const transformOpts: TransformOptions = {
        projectId,
        dev,
        moduleServerUrl: optionSnapshot?.moduleServerUrl ?? "/_vf_modules",
        moduleServerOrigin,
        vendorBundleHash: optionSnapshot?.vendorBundleHash,
        ssr: false,
        reactVersion: optionSnapshot?.reactVersion,
        ...(explicitImportMap
          ? {
            loadImportMap: async () => explicitImportMap,
          }
          : {}),
        dependencyPinningCacheKey: dependencySnapshot.cacheKey,
        dependencyPinningDependencies: dependencySnapshot.dependencies,
        dependencyPinningSource,
      };

      const transformedCode = await transformToESM(
        source,
        filePath,
        projectDir,
        adapter,
        transformOpts,
      );

      const tmpDir = await getProjectTmpDir(projectId);
      const componentFile = join(
        tmpDir,
        normalizeModulePath(relativeOutputPath!),
      );
      const transformedHash = await computeHash(transformedCode);

      return await serializeModuleOutput(componentFile, async () => {
        const fs = createFileSystem();
        await fs.mkdir(dirname(componentFile), { recursive: true });
        const written = await writeCacheFile(
          fs,
          componentFile,
          transformedCode,
          "REACT-COMPONENT-LOADER",
        );
        if (!written) {
          throw new Error(`Failed to persist transformed module: ${filePath}`);
        }

        const moduleUrl = toFileUrl(componentFile);
        moduleUrl.searchParams.set("v", transformedHash);
        return await import(moduleUrl.href);
      });
    },
    {
      "react.file": fileName,
      "react.projectDir": projectDir,
      "react.ssr": ssr,
      "react.sourceLength": source.length,
    },
  );
}

export async function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const mod = await loadModuleFromSource(source, filePath, projectDir, adapter, options);
  return extractComponent(mod, filePath);
}
