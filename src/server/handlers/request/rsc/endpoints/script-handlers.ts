
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils";

export async function handleClientScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const p = new URL(
    "../../../../../rendering/rsc/client-boot.ts",
    import.meta.url,
  ).pathname;
  let esbuild: typeof import("esbuild/mod.js") | null = null;
  try {
    esbuild = await import("esbuild/mod.js");
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
      external: [
        "https://esm.sh/*",
        "/_veryfront/*",
      ],
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    if (CLIENT_BOOT_BUNDLE) {
      return new Response(CLIENT_BOOT_BUNDLE, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    try {
      esbuild?.stop?.();
    } catch (stopError) {
      serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
    }
  }
}

export const CLIENT_BOOT_BUNDLE = "";

export async function handleDomScript(
  adapter: RuntimeAdapter,
): Promise<Response> {
  const p = new URL(
    "../../../../../rendering/rsc/client-dom.ts",
    import.meta.url,
  ).pathname;
  let esbuild: typeof import("esbuild/mod.js") | null = null;
  try {
    esbuild = await import("esbuild/mod.js");
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    if (CLIENT_DOM_BUNDLE) {
      return new Response(CLIENT_DOM_BUNDLE, {
        headers: { "content-type": "application/javascript" },
      });
    }

    serverLogger.debug(
      "[ScriptHandlers] Build failed, serving raw TypeScript",
      error,
    );
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  } finally {
    try {
      esbuild?.stop?.();
    } catch (stopError) {
      serverLogger.debug("[ScriptHandlers] esbuild stop failed", stopError);
    }
  }
}

export const CLIENT_DOM_BUNDLE = "";
