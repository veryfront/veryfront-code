import { createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { isESMModule, loadESMModule } from "./esm-loader.ts";
import type { MDXModule } from "./types.ts";
import { errorLogName, fileLogLabel } from "../../shared/log-context.ts";

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
              message: `[SECURITY] Legacy MDX modules are no longer supported. Recompile ${
                fileLogLabel(modulePath)
              } using the modern ESM compiler.`,
            }),
          );
        }

        return await loadESMModule(moduleCode, modulePath, projectDir, adapter);
      } catch (error) {
        logger.error("Failed to load MDX module", {
          moduleFile: fileLogLabel(modulePath),
          errorName: errorLogName(error),
        });
        return null;
      }
    },
    { "mdx.module_file": fileLogLabel(modulePath) },
  );
}
