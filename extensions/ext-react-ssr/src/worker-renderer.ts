/** Offline React renderer entrypoint imported only inside an explicitly configured worker. */

import type {
  IsolatedSsrRenderer,
  IsolatedSsrRendererModule,
} from "veryfront/extensions/rendering";
import {
  REACT_SSR_RENDERER_BUNDLE_BASE64,
  REACT_SSR_RENDERER_BUNDLE_SHA256,
} from "./worker-renderer-bundle.generated.ts";

const bundleModuleUrl =
  `data:application/javascript;base64,${REACT_SSR_RENDERER_BUNDLE_BASE64}#sha256=${REACT_SSR_RENDERER_BUNDLE_SHA256}`;
const bundleModule = await import(bundleModuleUrl) as Record<string, unknown>;
const bundledFactory = Object.getOwnPropertyDescriptor(
  bundleModule,
  "createIsolatedSsrRenderer",
)?.value;

if (typeof bundledFactory !== "function") {
  throw new TypeError(
    'Generated React SSR bundle must export "createIsolatedSsrRenderer"',
  );
}

/** Construct the renderer from the extension-owned, fully local bundle. */
export const createIsolatedSsrRenderer: IsolatedSsrRendererModule["createIsolatedSsrRenderer"] =
  (): IsolatedSsrRenderer => Reflect.apply(bundledFactory, undefined, []);
