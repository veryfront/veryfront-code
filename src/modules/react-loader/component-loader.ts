import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
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
import { sha256Short } from "#veryfront/cache/hash.ts";
import { CACHE_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_COMPONENT_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_COMPONENT_PATH_LENGTH = 4_096;

function validateLoadInput(source: string, filePath: string, projectDir: string): void {
  if (new TextEncoder().encode(source).byteLength > MAX_COMPONENT_SOURCE_BYTES) {
    throw INVALID_ARGUMENT.create({ detail: "Component source exceeds size limit" });
  }
  for (const value of [filePath, projectDir]) {
    if (
      value.length === 0 || value.length > MAX_COMPONENT_PATH_LENGTH ||
      hasUnsafeControlCharacters(value)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Component path is invalid" });
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
  validateLoadInput(source, filePath, projectDir);
  const fileName = filePath.split("/").pop() ?? filePath;
  const projectId = options?.projectId ?? projectDir;
  const dev = options?.dev ?? true;
  const ssr = options?.ssr ?? true;

  return await withSpan(
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
          signal: options?.signal,
        });

        return await loader.loadRawModule(filePath, source);
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
      const normalizedPath = normalizeModulePath(relativeFilePath);
      const contentHash = await sha256Short(transformedCode);
      const moduleStem = normalizedPath.replace(/\.[^/.]+$/, "");
      const componentFile = join(
        tmpDir,
        `${moduleStem}-${contentHash}.mjs`,
      );

      const fs = createFileSystem();
      const written = await writeCacheFile(
        fs,
        componentFile,
        transformedCode,
        "REACT-MODULE-LOADER",
      );
      if (!written) {
        throw CACHE_ERROR.create({ detail: "Component module cache write failed" });
      }

      return await import(toFileUrl(componentFile).href);
    },
    {
      "react.file": fileName,
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
