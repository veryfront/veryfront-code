/**
 * Browser-only entry point for the generated Studio bridge.
 *
 * The browser dependency boundary owns html2canvas-pro. Both release
 * prebundling and local source-mode bundling use this entry point so the
 * checked-in artifact and development runtime execute the same graph.
 */

import html2canvas from "html2canvas-pro";
import { installStudioScreenshotRenderer } from "../../src/studio/bridge/bridge-screenshot.ts";
import "../../src/studio/bridge/bridge-coordinator.ts";

installStudioScreenshotRenderer(html2canvas);
