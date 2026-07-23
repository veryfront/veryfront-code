import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";
import { CLIENT_BOOT_BUNDLE, CLIENT_DOM_BUNDLE } from "./rsc-bundles.generated.ts";

const logger = serverLogger.component("script-handlers");

function jsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/javascript",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function unavailableResponse(): Response {
  return new Response("Required client script is unavailable.", {
    status: 500,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function buildOrServeScript(
  adapter: RuntimeAdapter,
  path: string,
  fallbackBundle: string,
  esbuildOptions: Omit<import("veryfront/extensions/bundler").BuildOptions, "stdin"> & {
    stdin: import("veryfront/extensions/bundler").StdinOptions;
  },
): Promise<Response> {
  // If a pre-built bundle was injected at compile time, serve it directly
  if (fallbackBundle) return jsResponse(fallbackBundle);

  try {
    const src = await adapter.fs.readFile(path);
    const esbuild = await import("veryfront/extensions/bundler");
    const result = await esbuild.build({
      ...esbuildOptions,
      logLevel: "silent",
      stdin: { ...esbuildOptions.stdin, contents: src },
    });
    const out = result.outputFiles?.[0]?.text;
    if (!out) {
      logger.error("Client script build produced no output");
      return unavailableResponse();
    }

    return jsResponse(out);
  } catch (error) {
    logger.error("Client script build failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return unavailableResponse();
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
