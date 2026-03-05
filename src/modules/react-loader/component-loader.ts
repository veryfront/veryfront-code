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

export function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const fileName = filePath.split("/").pop() ?? filePath;
  const projectId = options?.projectId ?? projectDir;
  const dev = options?.dev ?? true;
  const ssr = options?.ssr ?? true;

  return withSpan(
    "modules.react.loadComponentFromSource",
    async () => {
      if (ssr) {
        const loader = new SSRModuleLoader({
          projectDir,
          projectId,
          projectSlug: options?.projectSlug,
          adapter,
          dev,
          contentSourceId: options?.contentSourceId,
          reactVersion: options?.reactVersion,
          mode: options?.mode,
        });

        return loader.loadModule(filePath, source);
      }

      const transformOpts: TransformOptions = {
        projectId,
        dev,
        moduleServerUrl: options?.moduleServerUrl ?? "/_vf_modules",
        vendorBundleHash: options?.vendorBundleHash,
        ssr: false,
        reactVersion: options?.reactVersion,
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
      const fs = createFileSystem();
      await fs.mkdir(componentDir, { recursive: true });
      await fs.writeTextFile(componentFile, transformedCode);

      const mod = await import(`file://${componentFile}?t=${Date.now()}`);
      return extractComponent(mod, filePath);
    },
    {
      "react.file": fileName,
      "react.projectDir": projectDir,
      "react.ssr": ssr,
      "react.sourceLength": source.length,
    },
  );
}
