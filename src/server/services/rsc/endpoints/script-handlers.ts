import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("script-handlers");

function shouldStopEsbuild(): boolean {
  return !(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild;
}

function jsResponse(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "application/javascript" },
  });
}

async function buildOrServeScript(
  adapter: RuntimeAdapter,
  path: string,
  fallbackBundle: string,
  esbuildOptions: Omit<import("esbuild").BuildOptions, "stdin"> & {
    stdin: import("esbuild").StdinOptions;
  },
): Promise<Response> {
  let esbuild: typeof import("esbuild") | null = null;

  try {
    esbuild = await import("esbuild");
    const src = await adapter.fs.readFile(path);
    const result = await esbuild.build(esbuildOptions);
    const out = result.outputFiles?.[0]?.text ?? src;

    return jsResponse(out);
  } catch (error) {
    if (fallbackBundle) return jsResponse(fallbackBundle);

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );

    const src = await adapter.fs.readFile(path);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    if (shouldStopEsbuild()) {
      try {
        esbuild?.stop?.();
      } catch (stopError) {
        logger.debug("esbuild stop failed", stopError);
      }
    }
  }
}

// Placeholder for build-time injection
export const CLIENT_BOOT_BUNDLE = "";

// Placeholder for build-time injection
export const CLIENT_DOM_BUNDLE = "";

export async function handleClientScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const path = new URL(
    "../../../../rendering/rsc/client-boot.ts",
    import.meta.url,
  ).pathname;

  const contents = await adapter.fs.readFile(path);

  return buildOrServeScript(adapter, path, CLIENT_BOOT_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents,
      loader: "ts",
      resolveDir: path.substring(0, path.lastIndexOf("/")),
      sourcefile: path,
    },
    external: ["https://esm.sh/*", "/_veryfront/*"],
  });
}

export async function handleDomScript(adapter: RuntimeAdapter): Promise<Response> {
  const path = new URL(
    "../../../../rendering/rsc/client-dom.ts",
    import.meta.url,
  ).pathname;

  const contents = await adapter.fs.readFile(path);

  return buildOrServeScript(adapter, path, CLIENT_DOM_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents,
      loader: "ts",
      resolveDir: path.substring(0, path.lastIndexOf("/")),
      sourcefile: path,
    },
  });
}
