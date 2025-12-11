import type * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LoadComponentOptions } from "./types.ts";
import { SSRModuleLoader } from "./ssr-module-loader.ts";

export async function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const projectId = options?.projectId || projectDir;
  const dev = options?.dev ?? true;

  const loader = new SSRModuleLoader({
    projectDir,
    projectId,
    adapter,
    dev,
  });
  return loader.loadModule(filePath, source);
}
