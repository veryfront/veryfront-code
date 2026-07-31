import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { dirname, fromFileUrl } from "#veryfront/compat/path/index.ts";
import { serverLogger } from "#veryfront/utils";
import {
  CLIENT_BOOT_BUNDLE,
  CLIENT_DOM_BUNDLE,
} from "../../../../rendering/rsc/rsc-bundles.generated.ts";

const logger = serverLogger.component("script-handlers");

type BundlerModule = typeof import("veryfront/extensions/bundler");

export interface ScriptHandlerDependencies {
  readonly clientBundle?: string;
  readonly domBundle?: string;
  readonly loadBundler?: () => Promise<BundlerModule>;
  readonly moduleUrl?: string;
}

export interface ScriptHandlers {
  readonly handleClientScript: (adapter: RuntimeAdapter) => Promise<Response>;
  readonly handleDomScript: (adapter: RuntimeAdapter) => Promise<Response>;
}

interface OwnedScriptHandlerDependencies {
  readonly clientBundle: string;
  readonly domBundle: string;
  readonly loadBundler: () => Promise<BundlerModule>;
  readonly moduleUrl: string;
}

const PRODUCTION_SCRIPT_HANDLER_DEPENDENCIES: OwnedScriptHandlerDependencies = Object.freeze({
  clientBundle: CLIENT_BOOT_BUNDLE,
  domBundle: CLIENT_DOM_BUNDLE,
  loadBundler: () => import("veryfront/extensions/bundler"),
  moduleUrl: import.meta.url,
});

function jsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/javascript",
      "cache-control": "no-cache",
    },
  });
}

function unavailableScriptResponse(status: 404 | 500): Response {
  return new Response(status === 404 ? "Not Found" : "Internal Server Error", {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

async function buildOrServeScript(
  adapter: RuntimeAdapter,
  path: string,
  fallbackBundle: string,
  loadBundler: () => Promise<BundlerModule>,
  esbuildOptions: Omit<import("veryfront/extensions/bundler").BuildOptions, "stdin"> & {
    stdin: import("veryfront/extensions/bundler").StdinOptions;
  },
): Promise<Response> {
  // If a pre-built bundle was injected at compile time, serve it directly
  if (fallbackBundle) return jsResponse(fallbackBundle);

  let src: string;
  try {
    src = await adapter.fs.readFile(path);
  } catch (error) {
    if (isNotFoundError(error)) return unavailableScriptResponse(404);
    logger.debug("RSC client script source read failed", error);
    return unavailableScriptResponse(500);
  }

  let esbuild: BundlerModule | null = null;

  try {
    esbuild = await loadBundler();
    const result = await esbuild.build({
      ...esbuildOptions,
      stdin: { ...esbuildOptions.stdin, contents: src },
    });
    const out = result.outputFiles?.[0]?.text;
    if (typeof out !== "string" || out.length === 0) {
      throw new Error("Bundler did not produce an RSC client script output");
    }

    return jsResponse(out);
  } catch (error) {
    logger.debug("RSC client script build failed", error);
    return unavailableScriptResponse(500);
  } finally {
    try {
      await esbuild?.stop?.();
    } catch (stopError) {
      logger.debug("esbuild stop failed", stopError);
    }
  }
}

// CLIENT_BOOT_BUNDLE and CLIENT_DOM_BUNDLE imported from rsc-bundles.generated.ts

/** Create an isolated script-handler instance with immutable owned dependencies. */
export function createScriptHandlers(
  dependencies: ScriptHandlerDependencies = {},
): ScriptHandlers {
  const ownedDependencies: OwnedScriptHandlerDependencies = Object.freeze({
    clientBundle: dependencies.clientBundle ??
      PRODUCTION_SCRIPT_HANDLER_DEPENDENCIES.clientBundle,
    domBundle: dependencies.domBundle ?? PRODUCTION_SCRIPT_HANDLER_DEPENDENCIES.domBundle,
    loadBundler: dependencies.loadBundler ??
      PRODUCTION_SCRIPT_HANDLER_DEPENDENCIES.loadBundler,
    moduleUrl: dependencies.moduleUrl ?? PRODUCTION_SCRIPT_HANDLER_DEPENDENCIES.moduleUrl,
  });
  const clientPath = fromFileUrl(
    new URL(
      "../../../../rendering/rsc/client-boot.ts",
      ownedDependencies.moduleUrl,
    ),
  );
  const domPath = fromFileUrl(
    new URL(
      "../../../../rendering/rsc/client-dom.ts",
      ownedDependencies.moduleUrl,
    ),
  );

  return Object.freeze({
    handleClientScript: (adapter: RuntimeAdapter): Promise<Response> =>
      buildOrServeScript(
        adapter,
        clientPath,
        ownedDependencies.clientBundle,
        ownedDependencies.loadBundler,
        {
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2020",
          stdin: {
            contents: "",
            loader: "ts",
            resolveDir: dirname(clientPath),
            sourcefile: clientPath,
          },
          external: ["https://esm.sh/*", "/_veryfront/*"],
        },
      ),
    handleDomScript: (adapter: RuntimeAdapter): Promise<Response> =>
      buildOrServeScript(
        adapter,
        domPath,
        ownedDependencies.domBundle,
        ownedDependencies.loadBundler,
        {
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2020",
          stdin: {
            contents: "",
            loader: "ts",
            resolveDir: dirname(domPath),
            sourcefile: domPath,
          },
        },
      ),
  });
}

const productionScriptHandlers = createScriptHandlers();

/** Serve the production-owned RSC client script. */
export function handleClientScript(adapter: RuntimeAdapter): Promise<Response> {
  return productionScriptHandlers.handleClientScript(adapter);
}

/** Serve the production-owned RSC DOM script. */
export function handleDomScript(adapter: RuntimeAdapter): Promise<Response> {
  return productionScriptHandlers.handleDomScript(adapter);
}
