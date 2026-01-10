import { join } from "std/path/mod.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { getGlobalTmpDir } from "./temp-directory.ts";
import { normalizeModulePath, resolveRelativePath } from "./path-resolver.ts";
import type { LoadComponentOptions } from "./types.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { SSRModuleLoader } from "./ssr-module-loader.ts";
import { extractComponent } from "./extract-component.ts";

export async function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const projectId = options?.projectId || projectDir;
  const dev = options?.dev ?? true;
  // Default to SSR mode for server-side execution (both Node and Deno)
  // Browser mode (ssr=false) is only for client-side module transforms
  const ssr = options?.ssr ?? true;

  // SSR mode: Use SSRModuleLoader for proper recursive dependency transformation
  if (ssr) {
    const loader = new SSRModuleLoader({
      projectDir,
      projectId,
      adapter,
      dev,
    });
    return loader.loadModule(filePath, source);
  }

  // Browser mode: Single file transform (dependencies loaded via module server)
  const moduleServerUrl = options?.moduleServerUrl ?? "/_vf_modules";
  const vendorBundleHash = options?.vendorBundleHash;

  const transformOpts: TransformOptions = {
    projectId,
    dev,
    moduleServerUrl,
    vendorBundleHash,
    ssr: false,
  };

  const transformedCode = await transformToESM(
    source,
    filePath,
    projectDir,
    adapter,
    transformOpts,
  );

  const tmpDir = await getGlobalTmpDir();
  const relativeFilePath = resolveRelativePath(filePath, projectDir);
  const componentFile = join(tmpDir, normalizeModulePath(relativeFilePath));

  const componentDir = componentFile.substring(0, componentFile.lastIndexOf("/"));
  const fs = createFileSystem();
  await fs.mkdir(componentDir, { recursive: true });

  await fs.writeTextFile(componentFile, transformedCode);

  const cacheBuster = Date.now();
  const mod = await import(`file://${componentFile}?t=${cacheBuster}`);

  return extractComponent(mod, filePath);
}
