/**
 * Browser-only entry point for the generated Studio bridge.
 *
 * This base entry is dependency-free. Optional browser capabilities are
 * composed by extension-owned alternative entries and bundles.
 */

import { startStudioBridge } from "../../src/studio/bridge/bridge-coordinator.ts";

startStudioBridge();
