import * as dntShim from "../../../../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../../../../platform/adapters/base.js";
import { serverLogger } from "../../../../../utils/index.js";

function shouldStopEsbuild(): boolean {
  return !(dntShim.dntGlobalThis as Record<string, unknown>).__vfTestPreserveEsbuild;
}

async function buildOrServeScript(
  adapter: RuntimeAdapter,
  path: string,
  fallbackBundle: string,
  esbuildOptions: Omit<import("esbuild").BuildOptions, "stdin"> & {
    stdin: import("esbuild").StdinOptions;
  },
): Promise<dntShim.Response> {
  let esbuild: typeof import("esbuild") | null = null;

  try {
    esbuild = await import("esbuild");
    const src = await adapter.fs.readFile(path);
    const result = await esbuild.build(esbuildOptions);
    const out = result.outputFiles?.[0]?.text ?? src;

    return new dntShim.Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    if (fallbackBundle) {
      return new dntShim.Response(fallbackBundle, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(path);
    return new dntShim.Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    if (shouldStopEsbuild()) {
      try {
        esbuild?.stop?.();
      } catch (stopError) {
        serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
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
): Promise<dntShim.Response> {
  const path = new URL(
    "../../../../../rendering/rsc/client-boot.ts",
    import.meta.url,
  ).pathname;

  return buildOrServeScript(adapter, path, CLIENT_BOOT_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents: await adapter.fs.readFile(path),
      loader: "ts",
      resolveDir: path.substring(0, path.lastIndexOf("/")),
      sourcefile: path,
    },
    external: ["https://esm.sh/*", "/_veryfront/*"],
  });
}

export async function handleDomScript(adapter: RuntimeAdapter): Promise<dntShim.Response> {
  const path = new URL(
    "../../../../../rendering/rsc/client-dom.ts",
    import.meta.url,
  ).pathname;

  return buildOrServeScript(adapter, path, CLIENT_DOM_BUNDLE, {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents: await adapter.fs.readFile(path),
      loader: "ts",
      resolveDir: path.substring(0, path.lastIndexOf("/")),
      sourcefile: path,
    },
  });
}
