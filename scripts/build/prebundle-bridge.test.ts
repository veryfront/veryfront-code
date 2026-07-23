import { assert } from "#std/assert";
import { STUDIO_BRIDGE_BUNDLE } from "../../src/studio/bridge/bridge-bundle.generated.ts";
import {
  buildStudioBridgeBundle,
  stopStudioBridgeBundler,
} from "./prebundle-bridge.ts";

Deno.test({
  name: "committed Studio bridge bundle matches the production build",
  async fn() {
    try {
      const rebuiltBundle = await buildStudioBridgeBundle();

      assert(
        rebuiltBundle === STUDIO_BRIDGE_BUNDLE,
        "Studio bridge bundle is stale. Run deno run -A scripts/build/prebundle-bridge.ts and commit the generated file.",
      );
    } finally {
      await stopStudioBridgeBundler();
    }
  },
});
