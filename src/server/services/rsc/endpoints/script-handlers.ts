import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";
import { CLIENT_BOOT_BUNDLE, CLIENT_DOM_BUNDLE } from "./rsc-bundles.generated.ts";

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
  // If a pre-built bundle was injected at compile time, serve it directly
  if (fallbackBundle) return jsResponse(fallbackBundle);

  let esbuild: typeof import("esbuild") | null = null;

  try {
    const src = await adapter.fs.readFile(path);
    esbuild = await import("esbuild");
    const result = await esbuild.build({
      ...esbuildOptions,
      stdin: { ...esbuildOptions.stdin, contents: src },
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return jsResponse(out);
  } catch (error) {
    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );

    try {
      const src = await adapter.fs.readFile(path);
      return new Response(src, {
        headers: { "content-type": "application/typescript" },
      });
    } catch {
      return new Response("// client-boot: source not available", {
        headers: { "content-type": "application/javascript" },
      });
    }
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

// CLIENT_BOOT_BUNDLE and CLIENT_DOM_BUNDLE imported from rsc-bundles.generated.ts

export async function handleClientScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const path = new URL(
    "../../../../rendering/rsc/client-boot.ts",
    import.meta.url,
  ).pathname;

  return buildOrServeScript(adapter, path, CLIENT_BOOT_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents: "",
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

  return buildOrServeScript(adapter, path, CLIENT_DOM_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents: "",
      loader: "ts",
      resolveDir: path.substring(0, path.lastIndexOf("/")),
      sourcefile: path,
    },
  });
}
