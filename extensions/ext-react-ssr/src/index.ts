/** Explicit React implementation of isolated worker SSR rendering. */

import { types as nodeUtilTypes } from "node:util";
import { type ExtensionFactory } from "veryfront/extensions";
import {
  createIsolatedSsrRendererProvider,
  type IsolatedSsrRendererProvider,
  IsolatedSsrRendererProviderName,
} from "veryfront/extensions/rendering";
import extensionPackage from "../deno.json" with { type: "json" };
import {
  resolveReactSsrWorkerModuleUrl,
  resolveReactSsrWorkerReadRootUrl,
} from "./worker-module-url.ts";

const isProxyWithoutHooks = nodeUtilTypes.isProxy;
const workerModuleUrl = resolveReactSsrWorkerModuleUrl(import.meta.url);
const localReadRootUrls = Object.freeze(
  [resolveReactSsrWorkerReadRootUrl(import.meta.url)],
);

export const ReactIsolatedSsrRendererProvider: Readonly<IsolatedSsrRendererProvider> =
  createIsolatedSsrRendererProvider(
    workerModuleUrl,
    localReadRootUrls,
  );

function assertEmptyConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("ext-react-ssr config must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("ext-react-ssr config must not be a proxy");
  }

  let isArray: boolean;
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-react-ssr config could not be inspected", { cause });
  }
  if (isArray) {
    throw new TypeError("ext-react-ssr config must be an object");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ext-react-ssr config must not inherit configuration");
  }
  if (keys.length !== 0) {
    throw new TypeError("ext-react-ssr does not accept configuration properties");
  }
}

/** Create the explicitly installed React isolated-SSR extension. */
export const extReactSsr: ExtensionFactory = (config) => {
  assertEmptyConfig(config);
  let active = false;
  return {
    name: "ext-react-ssr",
    version: extensionPackage.version,
    contracts: {
      provides: [IsolatedSsrRendererProviderName],
    },
    capabilities: [],
    setup(ctx) {
      if (active) throw new Error("ext-react-ssr is already set up");
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "React SSR extension setup was aborted",
          "AbortError",
        );
      }
      ctx.provide(IsolatedSsrRendererProviderName, ReactIsolatedSsrRendererProvider);
      active = true;
      ctx.logger.debug("[ext-react-ssr] isolated SSR renderer registered");
    },
    teardown() {
      active = false;
    },
  };
};

export default extReactSsr;
