/** Offline React implementation for Veryfront's local development UIs. */

import { type Extension } from "veryfront/extensions";
import {
  createDevUiAssetProvider,
  type DevUiAssetProvider,
  DevUiAssetProviderName,
} from "veryfront/extensions/dev-ui";
import extensionPackage from "../deno.json" with { type: "json" };
import { DEV_UI_BROWSER_BUNDLE } from "./dev-ui-bundle.generated.ts";

/** Create the auto-activated first-party Dev UI asset extension. */
export const extDevUiReact = (): Extension => {
  const provider = createDevUiAssetProvider(DEV_UI_BROWSER_BUNDLE);
  let active = false;

  return {
    name: "ext-dev-ui-react",
    version: extensionPackage.version,
    contracts: {
      provides: [DevUiAssetProviderName],
    },
    capabilities: [],
    setup(ctx) {
      if (active) throw new Error("ext-dev-ui-react is already set up");
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "The Dev UI extension context was revoked.",
          "AbortError",
        );
      }

      ctx.provide<DevUiAssetProvider>(DevUiAssetProviderName, provider);
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "The Dev UI extension context was revoked.",
          "AbortError",
        );
      }
      ctx.logger.debug("[ext-dev-ui-react] Offline Dev UI bundle registered");
      active = true;
    },
    teardown() {
      active = false;
    },
  };
};

export default extDevUiReact;
