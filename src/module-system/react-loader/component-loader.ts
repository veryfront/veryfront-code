import { join } from "std/path/mod.ts";
import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { getGlobalTmpDir } from "./temp-directory.ts";
import { normalizeModulePath, resolveRelativePath } from "./path-resolver.ts";
import type { LoadComponentOptions } from "./types.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { isNodeRuntime } from "../../platform/compat/runtime.ts";

export async function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const projectId = options?.projectId || projectDir;
  const dev = options?.dev ?? true;
  // Check runtime at call time for correct evaluation in bundled code
  const isNode = isNodeRuntime();
  // On Node.js, always use SSR mode to avoid module server URLs
  // This uses absolute file:// paths instead of /_vf_modules/ paths
  const ssr = isNode ? true : (options?.ssr ?? false);
  // Use relative path for module server (integrated into main dev server at /_vf_modules/)
  // On Node.js, don't use moduleServerUrl since there's no dev server
  const moduleServerUrl = isNode ? undefined : (options?.moduleServerUrl ?? "/_vf_modules");
  const vendorBundleHash = isNode ? undefined : options?.vendorBundleHash;

  const transformOpts: TransformOptions = {
    projectId,
    dev,
    moduleServerUrl,
    vendorBundleHash,
    ssr,
  };

  const transformedCode = await transformToESM(
    source,
    filePath,
    projectDir,
    adapter,
    transformOpts,
  );

  // On Node.js, use a project-relative cache directory so module resolution works
  // Node.js resolves bare imports relative to the file location
  let tmpDir: string;
  if (isNode) {
    tmpDir = join(projectDir, "node_modules", ".cache", "veryfront-components");
  } else {
    tmpDir = await getGlobalTmpDir();
  }

  const relativeFilePath = resolveRelativePath(filePath, projectDir);
  const componentFile = join(tmpDir, normalizeModulePath(relativeFilePath));

  const componentDir = componentFile.substring(0, componentFile.lastIndexOf("/"));
  const fs = createFileSystem();
  await fs.mkdir(componentDir, { recursive: true });

  await fs.writeTextFile(componentFile, transformedCode);

  const cacheBuster = Date.now();
  const mod = await import(`file://${componentFile}?t=${cacheBuster}`);

  const component = extractComponent(mod, filePath);

  return component;
}

function extractComponent(
  mod: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  const moduleObj = mod as Record<string, unknown>;

  let component = moduleObj.default;

  if (!component) {
    const keys = Object.keys(moduleObj);
    const firstKey = keys[0];
    if (firstKey) {
      component = moduleObj[firstKey];
    }
  }

  if (!component) {
    throw toError(createError({
      type: "build",
      message: `No component exported from ${filePath}`,
      context: { file: filePath, phase: "transform" },
    }));
  }

  return component as React.ComponentType<Record<string, unknown>>;
}
