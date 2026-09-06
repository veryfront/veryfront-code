import { join } from "#veryfront/compat/path/index.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import { normalizeModulePath, resolveRelativePath } from "./path-resolver.ts";
import type { LoadComponentOptions } from "./types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { SSRModuleLoader } from "./ssr-module-loader/index.ts";
import { extractComponent } from "./extract-component.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveDependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { TransformedModuleCoordinator } from "./transformed-module-coordinator.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { throwIfAborted } from "#veryfront/utils/abort.ts";

const transformedModuleFileSystem = createFileSystem();
const transformedModuleCoordinator = new TransformedModuleCoordinator(
  transformedModuleFileSystem,
);

export async function loadModuleFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options: LoadComponentOptions,
): Promise<Record<string, unknown>> {
  const fileName = filePath.split("/").pop() ?? filePath;
  const projectId = options?.projectId ?? projectDir;
  // `dev` is required by the type, so a TypeScript caller cannot reach this
  // without it. The `?? false` is the runtime half of the same rule: if an
  // untyped caller ever supplies nothing, production is the safe landing.
  const dev = options?.dev ?? false;
  const ssr = options?.ssr ?? true;
  const prepared = ssr ? getRuntimeModuleLoader(adapter) : undefined;
  if (prepared) {
    throwIfAborted(options?.signal);
    const module = await prepared.importModule({ kind: "source", path: filePath });
    throwIfAborted(options?.signal);
    return module;
  }

  return await withSpan(
    "modules.react.loadComponentFromSource",
    async () => {
      const dependencyPinningSource = options?.dependencyPinningSource ?? projectDir;
      const dependencySnapshot = await resolveDependencyPinningSnapshot(
        dependencyPinningSource,
        options?.dependencyPinningCacheKey,
        options?.dependencyPinningDependencies,
      );
      const moduleServerOrigin = dependencySnapshot.cacheKey.startsWith("on:")
        ? options?.moduleServerOrigin
        : undefined;

      if (ssr) {
        const loader = new SSRModuleLoader({
          projectDir,
          projectId,
          projectSlug: options?.projectSlug,
          adapter,
          dev,
          contentSourceId: options?.contentSourceId,
          reactVersion: options?.reactVersion,
          serverExternalPackages: options?.serverExternalPackages,
          moduleServerOrigin,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource,
          mode: options?.mode,
          signal: options?.signal,
        });

        return await loader.loadRawModule(filePath, source);
      }

      const transformOpts: TransformOptions = {
        projectId,
        dev,
        moduleServerUrl: options?.moduleServerUrl ?? "/_vf_modules",
        moduleServerOrigin,
        vendorBundleHash: options?.vendorBundleHash,
        ssr: false,
        reactVersion: options?.reactVersion,
        serverExternalPackages: options?.serverExternalPackages,
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
      const relativeFilePath = resolveRelativePath(filePath, projectDir);
      const componentFile = join(tmpDir, normalizeModulePath(relativeFilePath));

      const componentDir = componentFile.substring(0, componentFile.lastIndexOf("/"));
      await transformedModuleFileSystem.mkdir(componentDir, { recursive: true });
      return await transformedModuleCoordinator.importTransformedModule(
        componentFile,
        transformedCode,
        await computeHash(transformedCode),
        tmpDir,
      );
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
  options: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const mod = await loadModuleFromSource(source, filePath, projectDir, adapter, options);
  return extractComponent(mod, filePath);
}
