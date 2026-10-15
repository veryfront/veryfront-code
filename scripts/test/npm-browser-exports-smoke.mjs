import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { BROWSER_SAFE_EXPORTS } from "../build/browser-safe-exports.mjs";

// Resolve the consumer's actual bundler, never a repository-installed esbuild.
const bundlerRequire = createRequire(
  resolve(
    process.cwd(),
    "node_modules/@veryfront/ext-bundler-esbuild/package.json",
  ),
);
const { build } = bundlerRequire("esbuild");

// The browser replacement must never weaken Node's request-owned context.
const nativeContext = await import(pathToFileURL(resolve(
  process.cwd(),
  "node_modules/veryfront/esm/src/platform/compat/async-context.js",
)));
if (nativeContext.AsyncLocalStorage !== AsyncLocalStorage) {
  throw new Error("The packed Node runtime lost native AsyncLocalStorage");
}

for (const entry of BROWSER_SAFE_EXPORTS) {
  const specifier = `veryfront/${entry.slice(2)}`;
  const result = await build({
    stdin: {
      contents: `import * as entry from ${
        JSON.stringify(specifier)
      }; globalThis.browserExports = entry;`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    // These peers are supplied by the browser application. Everything else
    // must resolve, including third-party packages and lazy split chunks.
    external: ["react", "react/*", "react-dom", "react-dom/*"],
  });
  const leaked = Object.keys(result.metafile.inputs).filter((path) =>
    /(?:_dnt\.(?:shims|polyfills)\.js|@deno\/shim-)/.test(path)
  );
  if (leaked.length) {
    throw new Error(`${specifier} bundles server shims:\n${leaked.join("\n")}`);
  }
  console.log(`Browser bundle OK: ${specifier}`);
}
