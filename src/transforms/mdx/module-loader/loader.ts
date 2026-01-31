import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { isESMModule, loadESMModule } from "./esm-loader.ts";
import type { MDXModule } from "./types.ts";

export function loadMDXModule(
  modulePath: string,
  projectDir: string,
): Promise<MDXModule | null> {
  return withSpan(
    "transforms.mdx.loadMDXModule",
    async (): Promise<MDXModule | null> => {
      try {
        const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
        const adapter = await runtime.get();
        const moduleCode = await adapter.fs.readFile(modulePath);

        if (!isESMModule(moduleCode)) {
          throw toError(
            createError({
              type: "build",
              message:
                `[SECURITY] Legacy MDX modules are no longer supported. Recompile ${modulePath} using the modern ESM compiler.`,
            }),
          );
        }

        return await loadESMModule(moduleCode, modulePath, projectDir, adapter);
      } catch (error) {
        logger.error(`Failed to load MDX module from ${modulePath}:`, error);
        return null;
      }
    },
    { "mdx.module_path": modulePath },
  );
}
