
import type { HandlerContext } from "../../types.ts";
import { createRenderer } from "@veryfront/rendering/index.ts";
import { rendererLogger } from "@veryfront/utils";

const rendererRegistry = new Set<Awaited<ReturnType<typeof createRenderer>>>();

export async function getRenderer(
  rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null,
  ctx: HandlerContext,
): Promise<Awaited<ReturnType<typeof createRenderer>>> {
  if (!rendererInit) {
    rendererLogger.debug("[SSRHandler] Creating renderer", {
      mode: ctx.mode,
      projectDir: ctx.projectDir,
    });
    try {
      const renderer = await createRenderer({
        projectDir: ctx.projectDir,
        mode: ctx.mode,
        adapter: ctx.adapter,
        moduleServerUrl: ctx.moduleServerUrl,
      });

      rendererRegistry.add(renderer);

      rendererLogger.debug("[SSRHandler] Renderer created successfully");
      return renderer;
    } catch (error) {
      rendererLogger.error("[SSRHandler] FATAL: Renderer creation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
  return await rendererInit;
}

export async function cleanupRenderers(): Promise<void> {
  rendererLogger.debug("[RendererManager] Cleaning up renderers", {
    count: rendererRegistry.size,
  });

  for (const renderer of rendererRegistry) {
    try {
      if (renderer && typeof renderer.destroy === "function") {
        await renderer.destroy();
      }
    } catch (error) {
      rendererLogger.warn("[RendererManager] Error destroying renderer", { error });
    }
  }

  rendererRegistry.clear();

  rendererLogger.debug("[RendererManager] Renderer cleanup complete");
}
