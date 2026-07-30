/** Public browser composition surface for Studio bridge extensions. */

export {
  startStudioBridge,
  type StudioBridgeInstallation,
  type StudioBridgeOptions,
} from "./bridge-coordinator.ts";
export type {
  StudioCaptureProvider,
  StudioCaptureRequest,
  StudioCaptureViewport,
} from "./bridge-screenshot.ts";
