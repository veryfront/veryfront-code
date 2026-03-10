/**
 * Bridge Coordinator
 *
 * Entry point for the studio bridge ESM modules.
 * Reads config from window.__VF_BRIDGE_CONFIG__, initializes all modules,
 * and exposes debug internals when configured.
 */

import { getConfig, initConfig } from "./bridge-config.ts";
import { init } from "./bridge-init.ts";

// Initialize config from the global injected by the server
initConfig();

const config = getConfig();

// Run init unless debug skip is set
if (!config.debugSkipInit) {
  init();
}
