
import { createRenderer } from "@veryfront/rendering/index.ts";
import type { HandlerContext } from "../../types.ts";

export async function getRenderer(
  ctx: HandlerContext,
  rendererInit?: Promise<Awaited<ReturnType<typeof createRenderer>>> | null,
): Promise<Awaited<ReturnType<typeof createRenderer>>> {
  if (!rendererInit) {
    rendererInit = createRenderer({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      adapter: ctx.adapter,
      moduleServerUrl: ctx.moduleServerUrl,
    });
  }
  return await rendererInit;
}
