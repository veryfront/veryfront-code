/**
 * Test-only helper: serve React and react-dom/server to the SSR adapter from
 * the modules the runtime already has, instead of downloading them.
 *
 * `getReactDOMServer` normally caches an esm.sh bundle to disk and imports it,
 * so that project components and the server renderer share one React instance.
 * A unit test that only wants to render a `<div>` pays for that with real
 * network egress, and on Node it pays twice: the bundle esm.sh serves for
 * `react-dom/server` is the browser build, whose module-scope `MessageChannel`
 * is a ref'd libuv handle. The tests then pass and the process still never
 * exits.
 *
 * Import this file as a side effect at the top of any `*.test.ts` that renders
 * through the SSR adapter without asserting on the download path itself.
 *
 * @module react/compat/ssr-adapter/test-setup
 */

import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import { __setServerModuleLoaderForTests, resetReactCache } from "./server-loader.ts";

/** Points the SSR adapter's module loader at the statically imported modules. */
export function useLocalReactForSSRTests(): void {
  resetReactCache();
  __setServerModuleLoaderForTests((_url, label) =>
    Promise.resolve(label === "React" ? { default: React } : ReactDOMServer)
  );
}

useLocalReactForSSRTests();
