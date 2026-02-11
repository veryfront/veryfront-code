import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { serverLogger as logger } from "#veryfront/utils";

const log = logger.component("rsc");

const compatFs = createFileSystem();

export class HydratorHandler {
  constructor(private fsAdapter?: FileSystemAdapter) {}

  async handle(): Promise<Response> {
    const hydratorPath = pathHelper.join(
      pathHelper.dirname(pathHelper.fromFileUrl(import.meta.url)),
      "../../../../rendering/rsc/hydrate-client.ts",
    );

    try {
      const bundled = await this.bundleHydrator(hydratorPath);
      return this.createJavaScriptResponse(bundled);
    } catch (error) {
      log.error("Hydrator bundling failed:", error);
      return this.fallbackToSource(hydratorPath);
    }
  }

  private readHydratorFile(filePath: string): Promise<string> {
    return this.fsAdapter?.readFile(filePath) ?? compatFs.readTextFile(filePath);
  }

  private async bundleHydrator(filePath: string): Promise<string> {
    const { build, stop } = await import("esbuild");

    try {
      const source = await this.readHydratorFile(filePath);

      const result = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        stdin: {
          contents: source,
          loader: "ts",
          resolveDir: pathHelper.dirname(filePath),
          sourcefile: filePath,
        },
        external: [
          "react",
          "react-dom",
          "react-dom/client",
          "node:os",
          "node:fs",
          "node:fs/promises",
          "node:process",
        ],
        logLevel: "warning",
      });

      const outputText = result.outputFiles?.[0]?.text;
      if (outputText == null) {
        throw toError(
          createError({
            type: "config",
            message: "esbuild produced no output",
          }),
        );
      }

      log.debug("Hydrator bundled successfully", { size: outputText.length });
      return outputText;
    } finally {
      if (!("__vfTestPreserveEsbuild" in globalThis)) {
        await stop();
      }
    }
  }

  private async fallbackToSource(filePath: string): Promise<Response> {
    try {
      const source = await this.readHydratorFile(filePath);
      return this.createJavaScriptResponse(source);
    } catch (readError) {
      log.error("Failed to read hydrator file:", readError);
      return this.createFallbackResponse();
    }
  }

  private createJavaScriptResponse(content: string): Response {
    return new Response(content, {
      headers: {
        "content-type": "application/javascript",
        "cache-control": "no-cache",
      },
    });
  }

  private createFallbackResponse(): Response {
    const fallback =
      `export async function hydrateRSC(){ console.log('[RSC] Hydrator not available'); }`;
    return this.createJavaScriptResponse(fallback);
  }
}
