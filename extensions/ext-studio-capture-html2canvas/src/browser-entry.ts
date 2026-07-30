/** Browser entry used only to generate the extension-owned Studio bundle. */

import { startStudioBridge } from "veryfront/studio/bridge";
import { createHtml2CanvasStudioCaptureProvider } from "./provider.ts";

startStudioBridge({
  captureProvider: createHtml2CanvasStudioCaptureProvider(),
});
