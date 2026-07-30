/** Explicit html2canvas-pro composition for Studio browser capture. */

import {
  createStudioCaptureBundleProvider,
  type Extension,
  type StudioCaptureBundleProvider,
  StudioCaptureBundleProviderName,
} from "veryfront/extensions";
import { HTML2CANVAS_STUDIO_BRIDGE_BUNDLE } from "./studio-bridge-bundle.generated.ts";

/** Create the Studio capture extension. It owns no server-side resources. */
export const extStudioCaptureHtml2Canvas = (): Extension => {
  const provider = createStudioCaptureBundleProvider(HTML2CANVAS_STUDIO_BRIDGE_BUNDLE);
  let active = false;

  return {
    name: "ext-studio-capture-html2canvas",
    version: "0.1.0",
    contracts: {
      provides: [StudioCaptureBundleProviderName],
    },
    capabilities: [],
    setup(ctx) {
      if (active) {
        throw new Error("ext-studio-capture-html2canvas is already set up");
      }
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "The Studio capture extension context was revoked.",
          "AbortError",
        );
      }
      ctx.provide<StudioCaptureBundleProvider>(StudioCaptureBundleProviderName, provider);
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "The Studio capture extension context was revoked.",
          "AbortError",
        );
      }
      ctx.logger.debug(
        "[ext-studio-capture-html2canvas] Studio capture bundle registered",
      );
      active = true;
    },
    teardown() {
      // The immutable bundle owns no server-side handles. Browser resources
      // belong to the served document and its bridge lifecycle.
      active = false;
    },
  };
};

export default extStudioCaptureHtml2Canvas;
