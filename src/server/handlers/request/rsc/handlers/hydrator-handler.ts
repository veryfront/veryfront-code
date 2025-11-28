import { dirname, fromFileUrl } from "std/path/mod.ts";
import { serverLogger as logger } from "@veryfront/utils";
import { createError, toError } from "../../../../../core/errors/veryfront-error.ts";
import type { FileSystemAdapter } from "../../../../../platform/adapters/base.ts";

export class HydratorHandler {
  constructor(private fs?: FileSystemAdapter) {}

  async handle(): Promise<Response> {
    // Use correct path to hydrate-client.ts in rendering/rsc
    const hydratorPath = fromFileUrl(
      new URL("../../../../../rendering/rsc/hydrate-client.ts", import.meta.url),
    );

    try {
      // Enable bundling for production-ready JavaScript
      const bundled = await this.bundleHydrator(hydratorPath);
      return this.createJavaScriptResponse(bundled);
    } catch (error) {
      logger.error("[RSC] Hydrator bundling failed:", error);
      // Fallback to serving source if bundling fails
      return await this.fallbackToSource(hydratorPath);
    }
  }

  private async bundleHydrator(path: string): Promise<string> {
    // Use native esbuild for proper file system access during bundling
    const { build, stop } = await import("esbuild/mod.js");

    try {
      const source = this.fs
        ? await this.fs.readFile(path)
        : await Deno.readTextFile(path);

      const result = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        stdin: {
          contents: source,
          loader: "ts",
          resolveDir: dirname(path),
          sourcefile: path,
        },
        external: ["react", "react-dom", "react-dom/client"],
        logLevel: "warning",
      });

      // Validate output exists
      const outputFile = result.outputFiles?.[0];
      if (!outputFile || !outputFile.text) {
        throw toError(createError({
          type: "config",
          message: "esbuild produced no output",
        }));
      }

      logger.debug("[RSC] Hydrator bundled successfully", {
        size: outputFile.text.length,
      });

      return outputFile.text;
    } finally {
      // Cleanup esbuild resources
      await stop();
    }
  }

  private async fallbackToSource(path: string): Promise<Response> {
    try {
      const source = this.fs
        ? await this.fs.readFile(path)
        : await Deno.readTextFile(path);
      return this.createTypeScriptResponse(source);
    } catch (readError) {
      logger.error("[RSC] Failed to read hydrator file:", readError);
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

  private createTypeScriptResponse(content: string): Response {
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
